package driver

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// GET /driver/assignments
// Returns all active assignments (offered/accepted/picked_up) across every org
// the caller has a driver membership in.
func (h *Handler) listAssignments(w http.ResponseWriter, r *http.Request) {
	userID := callerUserID(r)
	if userID == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	memberIDs, err := h.store.MemberIDsForUser(r.Context(), userID)
	if errors.Is(err, ErrMemberNotFound) {
		writeJSON(w, http.StatusOK, []Assignment{})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	assignments, err := h.store.ListActiveAssignments(r.Context(), memberIDs)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, assignments)
}

// POST /driver/assignments/{id}/accept
func (h *Handler) acceptAssignment(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, "accepted", "")
}

// POST /driver/assignments/{id}/pickup
func (h *Handler) pickupAssignment(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, "picked_up", "")
}

// POST /driver/assignments/{id}/deliver
func (h *Handler) deliverAssignment(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, "delivered", "")
}

// POST /driver/assignments/{id}/cancel
func (h *Handler) cancelAssignment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reason string `json:"reason"`
	}
	// reason is optional — decode if a body was sent, ignore decode errors.
	_ = decodeJSON(r, &req)
	h.transition(w, r, "canceled", req.Reason)
}

// transition is the shared logic for all status-change endpoints.
func (h *Handler) transition(w http.ResponseWriter, r *http.Request, newStatus, cancelReason string) {
	assignmentID := chi.URLParam(r, "id")
	if assignmentID == "" {
		writeErr(w, http.StatusBadRequest, "assignment id required")
		return
	}

	userID := callerUserID(r)
	if userID == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	memberIDs, err := h.store.MemberIDsForUser(r.Context(), userID)
	if errors.Is(err, ErrMemberNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	a, err := h.store.TransitionAssignment(r.Context(), assignmentID, memberIDs, newStatus, cancelReason)
	switch {
	case errors.Is(err, ErrAssignmentNotFound):
		writeErr(w, http.StatusNotFound, "not found")
	case errors.Is(err, ErrAssignmentForbidden):
		writeErr(w, http.StatusNotFound, "not found") // 404 to avoid leaking existence
	case errors.Is(err, ErrIllegalTransition):
		writeErr(w, http.StatusConflict, "illegal status transition")
	case errors.Is(err, ErrAlreadyCanceled):
		writeErr(w, http.StatusConflict, "assignment is already in a terminal state")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, a)
	}
}
