package dualdrawer

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler wires HTTP endpoints for the dual cash drawer feature.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers the dual-drawer routes under r.
// Intended to be called on an already-authenticated chi.Router (auth.Middleware
// and auth.RequireOrgScope must be wired upstream).
//
//	r.Mount("/dual-drawer", dualdrawer.NewHandler(pool).Mount)
//	  — or inline —
//	r.Route("/dual-drawer", dualdrawer.NewHandler(pool).Mount)
func (h *Handler) Mount(r chi.Router) {
	// GET  /dual-drawer/sessions?location_id=<uuid>
	//   List all currently-open sessions at a location, each with cashier_label,
	//   opening float, and the drawer name. Used to render the side-by-side view.
	r.Get("/sessions", h.listOpenSessions)

	// POST /dual-drawer/open
	//   Open an additional drawer session for a second cashier on a shared
	//   terminal. Requires: drawer_id, cashier_label, opening_float_cents.
	r.Post("/open", h.openSession)
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

type openReq struct {
	DrawerID          string `json:"drawer_id"`
	CashierLabel      string `json:"cashier_label"`
	OpeningFloatCents int64  `json:"opening_float_cents"`
	OpenedByStaffID   string `json:"opened_by_staff_id"`
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// GET /dual-drawer/sessions?location_id=<uuid>
//
// Returns the list of currently-open cash_drawer_sessions at the location.
// Each item includes the drawer name, cashier_label, and opening float so the
// front-end can render both cashiers side-by-side without a second round trip.
//
// Org-scope: resolved via AllowsLocation(location_id) → 404 on mismatch.
func (h *Handler) listOpenSessions(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id query param required")
		return
	}

	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	sessions, err := h.store.ListOpenSessions(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sessions)
}

// POST /dual-drawer/open
//
// Opens a new cash_drawer_session on the specified drawer with a required
// cashier_label, so a second cashier can run their own drawer on a shared
// terminal. The opening float is recorded and an opening count row is inserted
// in the same transaction (matching the cashdrawer package convention).
//
// Returns 409 Conflict when the drawer already has an open session — the caller
// should assign a different (second) physical drawer to the second cashier.
//
// Org-scope: resolved via AllowsLocation(drawer.location_id) → 404 on mismatch.
func (h *Handler) openSession(w http.ResponseWriter, r *http.Request) {
	var req openReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.DrawerID == "" {
		writeErr(w, http.StatusBadRequest, "drawer_id is required")
		return
	}
	if req.CashierLabel == "" {
		writeErr(w, http.StatusBadRequest, "cashier_label is required")
		return
	}
	if req.OpeningFloatCents < 0 {
		writeErr(w, http.StatusBadRequest, "opening_float_cents must be >= 0")
		return
	}

	// Cross-tenant guard: load the drawer's location and verify org scope.
	// Returns 404 (not 403) to avoid existence leaks.
	locID, err := h.store.LocationIDForDrawer(r.Context(), req.DrawerID)
	switch {
	case errors.Is(err, ErrDrawerNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	sess, err := h.store.OpenSession(
		r.Context(),
		req.DrawerID,
		req.CashierLabel,
		req.OpeningFloatCents,
		req.OpenedByStaffID,
	)
	switch {
	case errors.Is(err, ErrLabelRequired):
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, ErrDrawerHasOpen):
		writeErr(w, http.StatusConflict,
			"drawer already has an open session — assign a second physical drawer to this cashier")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, sess)
}

// ---------------------------------------------------------------------------
// IO helpers (self-contained — avoids a shared httpx dependency)
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
