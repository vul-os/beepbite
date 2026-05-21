// Package driverinvite exposes driver-invite REST endpoints (Wave 16).
//
// Mount under an already-authenticated + org-scoped chi.Router group:
//
//	h := driverinvite.NewHandler(pool)
//	h.Mount(r) // registers /driver-invites and /driver-invites/{id}/revoke
//
// All three mutating endpoints require the caller to have role 'owner' or
// 'manager' in the request's org scope. Capability checks use the OrgScope
// Memberships resolved by auth.RequireOrgScope.
package driverinvite

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// Handler wires HTTP routes to the Store.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers driver-invite routes on r.
//
// Routes:
//
//	POST   /driver-invites              — create a driver invite
//	GET    /driver-invites              — list pending driver invites for the org
//	POST   /driver-invites/{id}/revoke  — revoke a pending driver invite
func (h *Handler) Mount(r chi.Router) {
	r.Route("/driver-invites", func(r chi.Router) {
		r.Post("/", h.createInvite)
		r.Get("/", h.listInvites)
		r.Post("/{id}/revoke", h.revokeInvite)
	})
}

// ---- request / response types ------------------------------------------------

type createInviteReq struct {
	Email string `json:"email"`
}

// ---- handlers ----------------------------------------------------------------

// POST /driver-invites
//
// Body: {"email":"driver@example.com"}
// Requires: owner or manager role in the caller's org.
func (h *Handler) createInvite(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	var req createInviteReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" {
		writeErr(w, http.StatusBadRequest, "email is required")
		return
	}
	if !looksLikeEmail(req.Email) {
		writeErr(w, http.StatusBadRequest, "invalid email format")
		return
	}

	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	inv, err := h.store.CreateInvite(r.Context(), scope.OrgID, req.Email, scope.UserID)
	switch {
	case errors.Is(err, ErrAlreadyMember):
		writeErr(w, http.StatusConflict, "user is already a member of this organization")
		return
	case errors.Is(err, ErrAlreadyInvited):
		writeErr(w, http.StatusConflict, "a pending driver invite already exists for this email")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, inv)
}

// GET /driver-invites
//
// Returns pending driver invites for the caller's org.
// Requires: owner or manager role.
func (h *Handler) listInvites(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	invites, err := h.store.ListPendingInvites(r.Context(), scope.OrgID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, invites)
}

// POST /driver-invites/{id}/revoke
//
// Marks the invite as rejected. Returns 204 on success.
// Requires: owner or manager role.
func (h *Handler) revokeInvite(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}

	inviteID := chi.URLParam(r, "id")
	if inviteID == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	if err := h.store.RevokeInvite(r.Context(), scope.OrgID, inviteID); err != nil {
		if errors.Is(err, ErrInviteNotFound) {
			writeErr(w, http.StatusNotFound, "invite not found or already processed")
			return
		}
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- authorization helper ----------------------------------------------------

// callerIsOwnerOrManager returns true when the OrgScope in context contains at
// least one membership with role 'owner' or 'manager'. This matches the
// permission gate used by the legacy send_invitation / cancel_invitation DB
// functions (which also permit 'admin'), but for driver invites we restrict to
// owner/manager only per the Wave 16 spec.
func callerIsOwnerOrManager(r *http.Request) bool {
	scope := auth.OrgScopeFrom(r.Context())
	for _, m := range scope.Memberships {
		if m.Role == "owner" || m.Role == "manager" {
			return true
		}
	}
	return false
}

// ---- tiny HTTP helpers -------------------------------------------------------

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

// looksLikeEmail is a lightweight sanity check (not RFC-5321 complete).
func looksLikeEmail(s string) bool {
	at := strings.Index(s, "@")
	if at < 1 {
		return false
	}
	domain := s[at+1:]
	return strings.Contains(domain, ".")
}
