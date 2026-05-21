// Package loyaltystamps implements the "buy N get 1 free" punch-card loyalty
// feature.  It is a lightweight overlay on the existing loyalty system:
// it reads/writes the three stamp columns added to loyalty_config by
// migration 026 and the new customer_loyalty_stamps counter table.
//
// Mount under an already-authenticated chi.Router group; the package does NOT
// edit main.go or the existing loyalty / promotions packages.
//
// Routes exposed (all require auth + org scope, wired in by the caller):
//
//	GET  /loyalty/stamps/config                  → Config
//	PUT  /loyalty/stamps/config                  → Config
//	GET  /customers/{customer_id}/stamps         → CustomerStamps
//	POST /customers/{customer_id}/stamps/accrue  → AccrueResult
package loyaltystamps

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler wires the loyaltystamps endpoints.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by a connection pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all stamp routes onto r.
// Call this inside an already-authenticated chi.Router group so that auth
// middleware (auth.Middleware + auth.RequireOrgScope) is already in the chain.
//
//	r.Route("/loyalty/stamps", func(r chi.Router) { h.Mount(r) })
//	r.Route("/customers/{customer_id}", func(r chi.Router) { h.MountCustomer(r) })
//
// For convenience both route groups are registered from a single Mount call:
//
//	h.Mount(apiRouter)
func (h *Handler) Mount(r chi.Router) {
	// Config endpoints -------------------------------------------------------
	r.Route("/loyalty/stamps", func(r chi.Router) {
		r.Get("/config", h.getConfig)
		r.Put("/config", h.putConfig)
	})

	// Per-customer endpoints — full-path registration (not r.Route) so this can
	// coexist with other handlers under the /customers/{customer_id} prefix
	// (chi panics on two Mount/Route calls for the same path pattern).
	r.Get("/customers/{customer_id}/stamps", h.getCustomerStamps)
	r.Post("/customers/{customer_id}/stamps/accrue", h.accrueStamp)
}

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

type putConfigReq struct {
	StampsEnabled  bool    `json:"stamps_enabled"`
	StampsRequired int     `json:"stamps_required"`
	StampItemID    *string `json:"stamp_item_id"` // omit or null → any item
}

type accrueReq struct {
	Count *int `json:"count"` // optional; defaults to 1
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// GET /loyalty/stamps/config
func (h *Handler) getConfig(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.store.GetConfig(r.Context())
	switch {
	case errors.Is(err, ErrConfigNotFound):
		// No config row yet — return a safe zero-value default so the UI can
		// render the form without a 404.
		writeJSON(w, http.StatusOK, &Config{
			StampsEnabled:  false,
			StampsRequired: 10,
		})
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// PUT /loyalty/stamps/config
func (h *Handler) putConfig(w http.ResponseWriter, r *http.Request) {
	var req putConfigReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.StampsRequired <= 0 {
		req.StampsRequired = 10
	}

	cfg, err := h.store.UpsertConfig(r.Context(), req.StampsEnabled, req.StampsRequired, req.StampItemID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// GET /customers/{customer_id}/stamps
func (h *Handler) getCustomerStamps(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}

	cs, err := h.store.GetCustomerStamps(r.Context(), customerID)
	switch {
	case errors.Is(err, ErrCustomerNotFound):
		writeErr(w, http.StatusNotFound, "customer not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, cs)
}

// POST /customers/{customer_id}/stamps/accrue
func (h *Handler) accrueStamp(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}

	var req accrueReq
	// Body is optional — an empty body (or missing count) means +1.
	if r.ContentLength > 0 {
		if err := decodeJSON(r, &req); err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	count := 1
	if req.Count != nil {
		if *req.Count <= 0 {
			writeErr(w, http.StatusBadRequest, "count must be > 0")
			return
		}
		count = *req.Count
	}

	result, err := h.store.AccrueStamp(r.Context(), customerID, count)
	switch {
	case errors.Is(err, ErrCustomerNotFound):
		writeErr(w, http.StatusNotFound, "customer not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

// ---------------------------------------------------------------------------
// JSON helpers (local to the package, same pattern as cashdrawer)
// ---------------------------------------------------------------------------

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
