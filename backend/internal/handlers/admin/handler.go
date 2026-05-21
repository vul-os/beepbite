package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler holds the store and exposes the Mount method.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount wires the admin endpoints onto r. The caller must apply
// RequirePlatformAdmin (and auth.Middleware) before calling Mount so that all
// routes are protected.
//
// Typical wiring in main.go:
//
//	r.Group(func(r chi.Router) {
//	    r.Use(auth.Middleware(authSvc))
//	    r.Use(admin.RequirePlatformAdmin(pool))
//	    adminH.Mount(r)
//	})
func (h *Handler) Mount(r chi.Router) {
	r.Route("/admin", func(r chi.Router) {
		r.Get("/tenants", h.listTenants)
		r.Get("/tenants/{org_id}", h.getTenant)
		r.Post("/tenants/{org_id}/pause", h.pauseTenant)
		r.Post("/tenants/{org_id}/unpause", h.unpauseTenant)
		r.Post("/tenants/{org_id}/quota-override", h.quotaOverride)
	})
}

// ---------------------------------------------------------------------------
// GET /admin/tenants?q=
// ---------------------------------------------------------------------------

func (h *Handler) listTenants(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	tenants, err := h.store.SearchTenants(r.Context(), q)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tenants)
}

// ---------------------------------------------------------------------------
// GET /admin/tenants/{org_id}
// ---------------------------------------------------------------------------

func (h *Handler) getTenant(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "org_id")
	if orgID == "" {
		writeErr(w, http.StatusBadRequest, "org_id required")
		return
	}

	detail, err := h.store.GetTenantDetail(r.Context(), orgID)
	switch {
	case errors.Is(err, ErrOrgNotFound):
		writeErr(w, http.StatusNotFound, "organisation not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

// ---------------------------------------------------------------------------
// POST /admin/tenants/{org_id}/pause
// ---------------------------------------------------------------------------

func (h *Handler) pauseTenant(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "org_id")
	if orgID == "" {
		writeErr(w, http.StatusBadRequest, "org_id required")
		return
	}

	claims, _ := auth.ClaimsFrom(r.Context())
	err := h.store.PauseTenant(r.Context(), claims.UserID, orgID)
	switch {
	case errors.Is(err, ErrOrgNotFound):
		writeErr(w, http.StatusNotFound, "organisation not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "paused"})
}

// ---------------------------------------------------------------------------
// POST /admin/tenants/{org_id}/unpause
// ---------------------------------------------------------------------------

func (h *Handler) unpauseTenant(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "org_id")
	if orgID == "" {
		writeErr(w, http.StatusBadRequest, "org_id required")
		return
	}

	claims, _ := auth.ClaimsFrom(r.Context())
	err := h.store.UnpauseTenant(r.Context(), claims.UserID, orgID)
	switch {
	case errors.Is(err, ErrOrgNotFound):
		writeErr(w, http.StatusNotFound, "organisation not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "unpaused"})
}

// ---------------------------------------------------------------------------
// POST /admin/tenants/{org_id}/quota-override
// ---------------------------------------------------------------------------

type quotaOverrideBody struct {
	Resource      string `json:"resource"`
	IncludedCount int64  `json:"included_count"`
}

func (h *Handler) quotaOverride(w http.ResponseWriter, r *http.Request) {
	orgID := chi.URLParam(r, "org_id")
	if orgID == "" {
		writeErr(w, http.StatusBadRequest, "org_id required")
		return
	}

	var body quotaOverrideBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if body.Resource == "" {
		writeErr(w, http.StatusBadRequest, "resource is required")
		return
	}
	if body.IncludedCount < 0 {
		writeErr(w, http.StatusBadRequest, "included_count must be >= 0")
		return
	}

	claims, _ := auth.ClaimsFrom(r.Context())
	err := h.store.QuotaOverride(r.Context(), claims.UserID, orgID, QuotaOverrideReq{
		Resource:      body.Resource,
		IncludedCount: body.IncludedCount,
	})
	switch {
	case errors.Is(err, ErrOrgNotFound):
		writeErr(w, http.StatusNotFound, "organisation not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":         "ok",
		"resource":       body.Resource,
		"included_count": body.IncludedCount,
	})
}

// ---------------------------------------------------------------------------
// JSON helpers (local to the package — mirrors cashdrawer/io.go pattern)
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
