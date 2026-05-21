package driver

import (
	"errors"
	"net/http"
)

// pingReq is the request body for POST /driver/pings.
type pingReq struct {
	Lat        float64  `json:"lat"`
	Lng        float64  `json:"lng"`
	AccuracyM  *float32 `json:"accuracy_m"`
	HeadingDeg *float32 `json:"heading_deg"`
	SpeedMps   *float32 `json:"speed_mps"`
}

// POST /driver/pings
// Records a GPS ping for the calling driver. The driver must have either an
// active shift (online/paused) or an active assignment (accepted/picked_up).
func (h *Handler) postPing(w http.ResponseWriter, r *http.Request) {
	userID := callerUserID(r)
	if userID == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req pingReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// Basic coordinate validation.
	if req.Lat < -90 || req.Lat > 90 {
		writeErr(w, http.StatusBadRequest, "lat must be between -90 and 90")
		return
	}
	if req.Lng < -180 || req.Lng > 180 {
		writeErr(w, http.StatusBadRequest, "lng must be between -180 and 180")
		return
	}

	// Resolve driver member ID — ping is tied to a single membership.
	memberIDs, err := h.store.MemberIDsForUser(r.Context(), userID)
	switch {
	case errors.Is(err, ErrMemberNotFound):
		writeErr(w, http.StatusNotFound, "driver member not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Use the first member ID. If the driver has multiple memberships we still
	// need a single driver_member_id for the ping; the active-shift/assignment
	// check inside InsertPing will verify at least one of the driver's member
	// contexts is live. For multi-org drivers, pings are recorded against the
	// first member ID (the primary identity). A future endpoint can accept an
	// explicit member_id if multi-org ping attribution is required.
	driverMemberID := memberIDs[0]

	ping, err := h.store.InsertPing(
		r.Context(),
		driverMemberID,
		req.Lat, req.Lng,
		req.AccuracyM, req.HeadingDeg, req.SpeedMps,
	)
	switch {
	case errors.Is(err, ErrNoActiveContext):
		writeErr(w, http.StatusForbidden, "no active shift or assignment — cannot record location ping")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, ping)
	}
}
