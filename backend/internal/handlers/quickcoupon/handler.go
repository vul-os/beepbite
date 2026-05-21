// Package quickcoupon provides one-tap coupon generation from a customer
// detail screen. It reuses the promotions + coupon_codes tables from
// migration 010 and follows the cashdrawer org-scope pattern.
//
// Routes (mount under an authenticated chi group):
//
//	POST /quick-coupons   — create a coupon; body {customer_id?, percent_off?, amount_off_cents?, expires_in_days?}
//	GET  /quick-coupons   — list coupons for this org; ?customer_id= to filter
//
// Requires capability: can_manage_promotions (owner / manager).
package quickcoupon

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

const manageCap = "can_manage_promotions"

// Handler exposes the quick-coupon REST surface.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers routes on r. Call after auth.Middleware and
// auth.RequireOrgScope are already wired.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/quick-coupons", func(r chi.Router) {
		r.With(auth.RequireCapability(manageCap)).Post("/", h.create)
		r.With(auth.RequireCapability(manageCap)).Get("/", h.list)
	})
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

type createReq struct {
	CustomerID    *string  `json:"customer_id"`
	PercentOff    *float64 `json:"percent_off"`
	AmountOffCents *int64  `json:"amount_off_cents"`
	ExpiresInDays *int     `json:"expires_in_days"`
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	orgID := db.ScopeFromContext(r.Context()).OrgID
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no org scope")
		return
	}

	var req createReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	// Exactly one of percent_off or amount_off_cents must be provided.
	if req.PercentOff == nil && req.AmountOffCents == nil {
		writeErr(w, http.StatusBadRequest, "one of percent_off or amount_off_cents is required")
		return
	}
	if req.PercentOff != nil && req.AmountOffCents != nil {
		writeErr(w, http.StatusBadRequest, "provide only one of percent_off or amount_off_cents")
		return
	}
	if req.PercentOff != nil && (*req.PercentOff <= 0 || *req.PercentOff > 100) {
		writeErr(w, http.StatusBadRequest, "percent_off must be between 0 and 100 (exclusive)")
		return
	}
	if req.AmountOffCents != nil && *req.AmountOffCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_off_cents must be > 0")
		return
	}

	claims, _ := auth.ClaimsFrom(r.Context())
	var createdBy *string
	if claims != nil && claims.UserID != "" {
		createdBy = &claims.UserID
	}

	coupon, err := h.store.Create(r.Context(), CreateParams{
		OrgID:         orgID,
		CustomerID:    req.CustomerID,
		PercentOff:    req.PercentOff,
		FixedOffCents: req.AmountOffCents,
		ExpiresInDays: req.ExpiresInDays,
		CreatedBy:     createdBy,
	})
	if err != nil {
		if errors.Is(err, ErrDuplicateCode) {
			writeErr(w, http.StatusConflict, "could not generate unique code; please retry")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, coupon)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	orgID := db.ScopeFromContext(r.Context()).OrgID
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no org scope")
		return
	}

	var customerID *string
	if cid := r.URL.Query().Get("customer_id"); cid != "" {
		customerID = &cid
	}

	coupons, err := h.store.List(r.Context(), orgID, customerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, coupons)
}
