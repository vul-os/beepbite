// Package wallet exposes the org-wallet REST surface.
// Mount under an already-authenticated, org-scoped chi.Router group:
//
//	h := wallet.NewHandler(pool)
//	r.Route("/wallet", h.Mount)   // or h.Mount(r.Route("/wallet", ...))
//
// All paths are org-scoped via RLS session variables set by db.Scoped.
package wallet

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds the store and exposes Mount for wiring into the router.
type Handler struct {
	store *Store
}

// NewHandler creates a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all /wallet routes onto r.  The caller mounts r at /wallet
// (or whatever prefix is desired) so the final paths are e.g. /wallet,
// /wallet/transactions, /wallet/topup, /wallet/auto-refill.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/wallet", func(r chi.Router) {
		r.Get("/", h.getWallet)
		r.Get("/transactions", h.listTransactions)
		r.Post("/topup", h.initiateTopup)
		r.Put("/auto-refill", h.updateAutoRefill)
	})
}

// ---------------------------------------------------------------------------
// GET /wallet
// ---------------------------------------------------------------------------

// getWallet returns the caller's org wallet, creating the row lazily if it
// doesn't exist yet.
func (h *Handler) getWallet(w http.ResponseWriter, r *http.Request) {
	wallet, err := h.store.GetOrCreateWallet(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, wallet)
}

// ---------------------------------------------------------------------------
// GET /wallet/transactions
// ---------------------------------------------------------------------------

// listTransactions returns a paginated newest-first slice of wallet_transactions.
//
//	?limit=N    — rows per page (1–200, default 50)
//	?before=UUID — exclusive cursor: only rows older than this transaction ID
func (h *Handler) listTransactions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	limit := 50
	if s := q.Get("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > 200 {
			writeErr(w, http.StatusBadRequest, "limit must be an integer between 1 and 200")
			return
		}
		limit = n
	}

	before := q.Get("before")

	txns, err := h.store.ListTransactions(r.Context(), limit, before)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, txns)
}

// ---------------------------------------------------------------------------
// POST /wallet/topup
// ---------------------------------------------------------------------------

type topupReq struct {
	AmountCents int64 `json:"amount_cents"`
}

// initiateTopup inserts a wallet_topups row with status='initiated'.
// The actual payment-provider charge is wired outside this package — see the
// payment webhook handler which transitions the topup to 'succeeded' and
// inserts the matching wallet_transactions credit (which triggers the balance
// update via trg_fn_wallet_transaction_balance).
func (h *Handler) initiateTopup(w http.ResponseWriter, r *http.Request) {
	var req topupReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	topup, err := h.store.InitiateTopup(r.Context(), req.AmountCents)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, topup)
}

// ---------------------------------------------------------------------------
// PUT /wallet/auto-refill
// ---------------------------------------------------------------------------

type autoRefillReq struct {
	// Enabled toggles auto-refill on/off (auto_refill_enabled column).
	Enabled *bool `json:"enabled"`
	// ThresholdCents and TargetCents are pointers so the client can explicitly
	// null them out (disabling the thresholds) by sending JSON null.
	ThresholdCents *int64 `json:"threshold_cents"`
	TargetCents    *int64 `json:"target_cents"`
}

// updateAutoRefill sets the auto-refill thresholds on the org wallet.
// Send null values to clear a threshold.
func (h *Handler) updateAutoRefill(w http.ResponseWriter, r *http.Request) {
	var req autoRefillReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Basic sanity: if both are set, target must be > threshold.
	if req.ThresholdCents != nil && *req.ThresholdCents < 0 {
		writeErr(w, http.StatusBadRequest, "threshold_cents must be >= 0")
		return
	}
	if req.TargetCents != nil && *req.TargetCents <= 0 {
		writeErr(w, http.StatusBadRequest, "target_cents must be > 0")
		return
	}
	if req.ThresholdCents != nil && req.TargetCents != nil &&
		*req.TargetCents <= *req.ThresholdCents {
		writeErr(w, http.StatusBadRequest, "target_cents must be > threshold_cents")
		return
	}

	wallet, err := h.store.UpdateAutoRefill(r.Context(), req.Enabled, req.ThresholdCents, req.TargetCents)
	if errors.Is(err, pgx.ErrNoRows) {
		// Wallet row doesn't exist yet — tell the client to call GET /wallet first.
		writeErr(w, http.StatusNotFound, "wallet not found; call GET /wallet to initialise it")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, wallet)
}
