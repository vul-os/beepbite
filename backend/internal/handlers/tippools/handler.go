// Package tippools exposes the tip-pooling REST surface on top of migration-32
// tables. Mount under an already-authenticated chi.Router group.
package tippools

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler wires HTTP routes to the Store.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all tip-pool routes on r (relative to whatever prefix the
// caller chose, e.g. "/tip-pools").
func (h *Handler) Mount(r chi.Router) {
	r.Route("/tip-pools", func(r chi.Router) {
		r.Post("/", h.createPool)
		r.Get("/", h.listPools)
		r.Get("/{id}", h.getPool)
		r.Patch("/{id}", h.updatePool)
		r.Post("/{id}/contribute", h.contribute)
		r.Post("/{id}/distribute", h.distribute)
	})
}

// ---- request / response types -----------------------------------------------

type createPoolReq struct {
	OrganizationID string         `json:"organization_id"`
	LocationID     string         `json:"location_id"`
	Name           string         `json:"name"`
	RuleType       string         `json:"rule_type"`
	Config         map[string]any `json:"config"`
	ShiftDate      string         `json:"shift_date"` // "YYYY-MM-DD" or ""
}

type updatePoolReq struct {
	Name     string         `json:"name"`
	RuleType string         `json:"rule_type"`
	Config   map[string]any `json:"config"`
	IsActive *bool          `json:"is_active"`
}

type contributeReq struct {
	OrderPaymentID string `json:"order_payment_id"`
	AmountCents    int64  `json:"amount_cents"`
}

// RecipientReq is also referenced by store.go for the DistributePool call.
type RecipientReq struct {
	StaffID      string  `json:"staff_id"`
	HoursWorked  float64 `json:"hours_worked"`
	WeightPoints float64 `json:"weight_points"`
}

type distributeReq struct {
	Recipients []RecipientReq `json:"recipients"`
}

// ---- handlers ---------------------------------------------------------------

func (h *Handler) createPool(w http.ResponseWriter, r *http.Request) {
	var req createPoolReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrganizationID == "" {
		writeErr(w, http.StatusBadRequest, "organization_id is required")
		return
	}
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.RuleType == "" {
		writeErr(w, http.StatusBadRequest, "rule_type is required")
		return
	}
	if req.Config == nil {
		req.Config = map[string]any{}
	}

	// Cross-tenant guard: when a location_id is provided, verify it is in scope.
	// Returns 404 (not 403) to avoid existence leaks.
	if req.LocationID != "" && !auth.OrgScopeFrom(r.Context()).AllowsLocation(req.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	pool, err := h.store.CreatePool(
		r.Context(),
		req.OrganizationID, req.LocationID, req.Name, req.RuleType, req.Config, req.ShiftDate,
	)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, pool)
}

func (h *Handler) listPools(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	shiftDate := r.URL.Query().Get("shift_date")

	// Cross-tenant guard: when a location_id filter is supplied, verify scope.
	if locationID != "" && !auth.OrgScopeFrom(r.Context()).AllowsLocation(locationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	pools, err := h.store.ListPools(r.Context(), locationID, shiftDate)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pools)
}

func (h *Handler) getPool(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	// Cross-tenant guard: load pool first to resolve its location_id.
	pool, err := h.store.GetPool(r.Context(), id)
	switch {
	case errors.Is(err, ErrPoolNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if pool.LocationID != nil && !auth.OrgScopeFrom(r.Context()).AllowsLocation(*pool.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	detail, err := h.store.GetPoolDetail(r.Context(), id)
	switch {
	case errors.Is(err, ErrPoolNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) updatePool(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	// Cross-tenant guard: load pool first to resolve its location_id.
	existing, err := h.store.GetPool(r.Context(), id)
	switch {
	case errors.Is(err, ErrPoolNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if existing.LocationID != nil && !auth.OrgScopeFrom(r.Context()).AllowsLocation(*existing.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	var req updatePoolReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	pool, err := h.store.UpdatePool(r.Context(), id, req.Name, req.RuleType, req.Config, req.IsActive)
	switch {
	case errors.Is(err, ErrPoolNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pool)
}

func (h *Handler) contribute(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	var req contributeReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.AmountCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_cents must be > 0")
		return
	}

	// Load pool (verifies existence) and check cross-tenant scope.
	pool, err := h.store.GetPool(r.Context(), id)
	switch {
	case errors.Is(err, ErrPoolNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if pool.LocationID != nil && !auth.OrgScopeFrom(r.Context()).AllowsLocation(*pool.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	c, err := h.store.AddContribution(r.Context(), id, req.OrderPaymentID, req.AmountCents)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (h *Handler) distribute(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	var req distributeReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Recipients) == 0 {
		writeErr(w, http.StatusBadRequest, "recipients must not be empty")
		return
	}
	for _, rr := range req.Recipients {
		if rr.StaffID == "" {
			writeErr(w, http.StatusBadRequest, "each recipient must have a staff_id")
			return
		}
	}

	pool, err := h.store.GetPool(r.Context(), id)
	switch {
	case errors.Is(err, ErrPoolNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Cross-tenant guard: verify the pool's location is in scope.
	if pool.LocationID != nil && !auth.OrgScopeFrom(r.Context()).AllowsLocation(*pool.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	dists, err := h.store.DistributePool(r.Context(), pool, req.Recipients)
	switch {
	case errors.Is(err, ErrAlreadyDistributed):
		writeErr(w, http.StatusConflict, "pool has already been distributed")
		return
	case err != nil:
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, dists)
}
