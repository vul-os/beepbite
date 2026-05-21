// Package datarights exposes REST endpoints for Wave 31 data-rights features:
//
//	DELETE /settings/account          — soft-delete the caller's organisation
//	POST   /settings/account/restore  — reverse a soft-delete within the 30-day window
//	POST   /settings/data-export      — enqueue + build a JSON archive and return it
//	POST   /customers/{customer_id}/forget     — right-to-be-forgotten: redact customer PII
//
// All routes require an org-scoped JWT (auth.RequireOrgScope applied by the
// caller's router group) plus the "can_owner" capability. Mount example:
//
//	r.Mount("/", datarights.NewHandler(pool).Mount)
package datarights

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler wires together the store and chi routes.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all data-rights routes on r.
//
// Capability gate: every route requires "can_owner". The router group that
// calls Mount must already be protected by auth.RequireOrgScope so the
// OrgScope and db.Scope are present in context.
func (h *Handler) Mount(r chi.Router) {
	ownerOnly := auth.RequireCapability("can_owner")

	// Account / org lifecycle.
	r.With(ownerOnly).Delete("/settings/account", h.softDelete)
	r.With(ownerOnly).Post("/settings/account/restore", h.restore)

	// Data export.
	r.With(ownerOnly).Post("/settings/data-export", h.dataExport)

	// Right-to-be-forgotten.
	r.With(ownerOnly).Post("/customers/{customer_id}/forget", h.forgetCustomer)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// DELETE /settings/account
func (h *Handler) softDelete(w http.ResponseWriter, r *http.Request) {
	scope := auth.OrgScopeFrom(r.Context())
	orgID := primaryOrgID(scope)
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no organisation membership")
		return
	}

	var req struct {
		Confirm bool `json:"confirm"`
	}
	// Body is optional; ignore decode errors (empty body means confirm=false).
	_ = decodeJSON(r, &req)
	if !req.Confirm {
		writeErr(w, http.StatusBadRequest, "set confirm:true to delete the account")
		return
	}

	if err := h.store.SoftDeleteOrg(r.Context(), orgID, scope.UserID); err != nil {
		switch {
		case errors.Is(err, ErrOrgNotFound):
			writeErr(w, http.StatusNotFound, "organisation not found")
		case errors.Is(err, ErrOrgAlreadyDeleted):
			writeErr(w, http.StatusConflict, "organisation is already scheduled for deletion")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "soft_deleted",
		"message": "Organisation scheduled for permanent deletion in 30 days. Use POST /settings/account/restore to cancel.",
	})
}

// POST /settings/account/restore
func (h *Handler) restore(w http.ResponseWriter, r *http.Request) {
	scope := auth.OrgScopeFrom(r.Context())
	orgID := primaryOrgID(scope)
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no organisation membership")
		return
	}

	if err := h.store.RestoreOrg(r.Context(), orgID, scope.UserID); err != nil {
		switch {
		case errors.Is(err, ErrOrgNotFound):
			writeErr(w, http.StatusNotFound, "organisation not found")
		case errors.Is(err, ErrOrgNotDeleted):
			writeErr(w, http.StatusConflict, "organisation is not currently scheduled for deletion")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "restored",
		"message": "Organisation deletion cancelled. Your account is active.",
	})
}

// POST /settings/data-export
func (h *Handler) dataExport(w http.ResponseWriter, r *http.Request) {
	scope := auth.OrgScopeFrom(r.Context())
	orgID := primaryOrgID(scope)
	if orgID == "" {
		writeErr(w, http.StatusForbidden, "no organisation membership")
		return
	}

	job, archive, err := h.store.EnqueueExport(r.Context(), orgID, scope.UserID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Return the job metadata and the inline JSON archive in one response.
	writeJSON(w, http.StatusOK, map[string]any{
		"job":     job,
		"archive": json.RawMessage(archive),
	})
}

// POST /customers/{customer_id}/forget
func (h *Handler) forgetCustomer(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer id required")
		return
	}

	scope := auth.OrgScopeFrom(r.Context())
	if len(scope.Memberships) == 0 {
		writeErr(w, http.StatusForbidden, "no organisation membership")
		return
	}

	if err := h.store.ForgetCustomer(r.Context(), customerID, scope.UserID); err != nil {
		switch {
		case errors.Is(err, ErrCustomerNotFound):
			writeErr(w, http.StatusNotFound, "customer not found")
		case errors.Is(err, ErrAlreadyForgotten):
			writeErr(w, http.StatusConflict, "customer PII has already been purged")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "forgotten",
		"message": "Customer PII has been redacted. Order history is retained anonymised.",
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// primaryOrgID returns the first org ID from the scope's Memberships, or "".
func primaryOrgID(scope auth.OrgScope) string {
	if len(scope.Memberships) > 0 {
		return scope.Memberships[0].OrgID
	}
	return ""
}
