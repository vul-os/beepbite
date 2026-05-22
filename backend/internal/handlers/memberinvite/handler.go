// Package memberinvite exposes organisation member-invite REST endpoints.
//
// Mount under an already-authenticated + org-scoped chi.Router group:
//
//	h := memberinvite.NewHandler(pool)
//	h.Mount(r) // registers /member-invites, /member-invites/{id}/revoke, /members, /members/{id}
//
// All mutating endpoints require role 'owner' or 'manager' in the org scope.
// Capability checks use the OrgScope Memberships resolved by auth.RequireOrgScope.
package memberinvite

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
	// Notifier, when set, is called best-effort after a successful invite
	// create to send the invite email (email, role, orgID). Optional.
	Notifier func(email, role, orgID string)
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers member-invite routes on r.
//
// Routes:
//
//	POST   /member-invites              — create a member invite
//	GET    /member-invites              — list pending non-driver invites for the org
//	POST   /member-invites/{id}/revoke  — revoke a pending member invite
//	GET    /members                     — list active non-driver members for the org
//	DELETE /members/{profile_id}        — remove a member's access
func (h *Handler) Mount(r chi.Router) {
	r.Route("/member-invites", func(r chi.Router) {
		r.Post("/", h.createInvite)
		r.Get("/", h.listInvites)
		r.Post("/{id}/revoke", h.revokeInvite)
	})
	r.Route("/members", func(r chi.Router) {
		r.Get("/", h.listMembers)
		r.Delete("/{profile_id}", h.removeMember)
	})
}

// ---- request / response types ------------------------------------------------

type createInviteReq struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

// ---- handlers ----------------------------------------------------------------

// POST /member-invites
//
// Body: {"email":"user@example.com","role":"staff"}
// role must be one of: manager, staff, kitchen, pos.
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

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Email == "" {
		writeErr(w, http.StatusBadRequest, "email is required")
		return
	}
	if !looksLikeEmail(req.Email) {
		writeErr(w, http.StatusBadRequest, "invalid email format")
		return
	}

	req.Role = strings.ToLower(strings.TrimSpace(req.Role))
	if !allowedRoles[req.Role] {
		writeErr(w, http.StatusBadRequest, "role must be one of: manager, staff, kitchen, pos")
		return
	}

	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}

	inv, err := h.store.CreateInvite(r.Context(), scope.OrgID, req.Email, req.Role, scope.UserID)
	switch {
	case errors.Is(err, ErrAlreadyMember):
		writeErr(w, http.StatusConflict, "user is already a member of this organization")
		return
	case errors.Is(err, ErrAlreadyInvited):
		writeErr(w, http.StatusConflict, "a pending invite already exists for this email")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	if h.Notifier != nil {
		h.Notifier(inv.Email, inv.Role, inv.OrganizationID)
	}
	writeJSON(w, http.StatusCreated, inv)
}

// GET /member-invites
//
// Returns pending non-driver invites for the caller's org.
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

// POST /member-invites/{id}/revoke
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

// GET /members
//
// Returns active non-driver members for the caller's org.
// Requires: owner or manager role.
func (h *Handler) listMembers(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}
	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}
	members, err := h.store.ListActiveMembers(r.Context(), scope.OrgID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// DELETE /members/{profile_id}
//
// Removes a member's org membership. Returns 204 on success.
// Requires: owner or manager role. A caller cannot remove their own membership.
// Removing the last owner is rejected with 409.
func (h *Handler) removeMember(w http.ResponseWriter, r *http.Request) {
	if !callerIsOwnerOrManager(r) {
		writeErr(w, http.StatusForbidden, "requires owner or manager role")
		return
	}
	profileID := chi.URLParam(r, "profile_id")
	if profileID == "" {
		writeErr(w, http.StatusBadRequest, "profile_id required")
		return
	}
	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID == "" {
		writeErr(w, http.StatusBadRequest, "no org scope resolved")
		return
	}
	if profileID == scope.UserID {
		writeErr(w, http.StatusBadRequest, "cannot remove yourself")
		return
	}
	if err := h.store.RemoveMember(r.Context(), scope.OrgID, profileID); err != nil {
		switch {
		case errors.Is(err, ErrMemberNotFound):
			writeErr(w, http.StatusNotFound, "member not found in this organization")
		case errors.Is(err, ErrLastOwner):
			writeErr(w, http.StatusConflict, "cannot remove the last owner")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- authorization helper ----------------------------------------------------

// callerIsOwnerOrManager returns true when the OrgScope in context contains at
// least one membership with role 'owner' or 'manager'.
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
