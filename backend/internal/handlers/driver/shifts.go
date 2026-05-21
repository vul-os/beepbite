package driver

import (
	"errors"
	"net/http"
)

// POST /driver/shifts/online
// Opens a new shift (status=online). Fails with 409 if a shift is already open.
func (h *Handler) goOnline(w http.ResponseWriter, r *http.Request) {
	driverMemberID, ok := h.resolveDriverMemberID(w, r)
	if !ok {
		return
	}

	shift, err := h.store.GoOnline(r.Context(), driverMemberID)
	switch {
	case errors.Is(err, ErrShiftConflict):
		writeErr(w, http.StatusConflict, "driver already has an open shift")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, shift)
	}
}

// POST /driver/shifts/paused
// Transitions the open shift to paused.
func (h *Handler) goPaused(w http.ResponseWriter, r *http.Request) {
	driverMemberID, ok := h.resolveDriverMemberID(w, r)
	if !ok {
		return
	}

	shift, err := h.store.SetShiftStatus(r.Context(), driverMemberID, "paused")
	switch {
	case errors.Is(err, ErrShiftNotFound):
		writeErr(w, http.StatusNotFound, "no open shift found")
	case errors.Is(err, ErrIllegalTransition):
		writeErr(w, http.StatusConflict, "illegal shift transition")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, shift)
	}
}

// POST /driver/shifts/offline
// Closes the open shift (status=offline, ended_at=now()).
func (h *Handler) goOffline(w http.ResponseWriter, r *http.Request) {
	driverMemberID, ok := h.resolveDriverMemberID(w, r)
	if !ok {
		return
	}

	shift, err := h.store.SetShiftStatus(r.Context(), driverMemberID, "offline")
	switch {
	case errors.Is(err, ErrShiftNotFound):
		writeErr(w, http.StatusNotFound, "no open shift found")
	case errors.Is(err, ErrIllegalTransition):
		writeErr(w, http.StatusConflict, "illegal shift transition")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, shift)
	}
}

// resolveDriverMemberID looks up the first membership ID for the calling user
// that has the can_drive capability. For shift operations the driver is always
// a single-org actor (shifts are per-member, not cross-org), so we pick the
// first membership ID. Returns false and writes an error response on failure.
//
// Note: because a driver can have memberships in multiple orgs, we take the
// first member ID returned by MemberIDsForUser. Shift uniqueness is enforced
// per driver_member_id by the partial unique index on driver_shifts, so each
// membership represents an independent shift context. The typical case is a
// driver with one membership; multi-org drivers use org-specific member IDs.
func (h *Handler) resolveDriverMemberID(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID := callerUserID(r)
	if userID == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return "", false
	}

	memberIDs, err := h.store.MemberIDsForUser(r.Context(), userID)
	switch {
	case errors.Is(err, ErrMemberNotFound):
		writeErr(w, http.StatusNotFound, "driver member not found")
		return "", false
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return "", false
	}

	// Return the first member ID (callers that need the full list use
	// MemberIDsForUser directly, as in listAssignments).
	return memberIDs[0], true
}
