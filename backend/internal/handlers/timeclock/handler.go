// Package timeclock — REST handler for staff time entries.
//
// Routes (mount under an org-scoped, actor-overlay-aware router):
//
//	POST   /timeclock/clock-in              — clock a staff member in
//	POST   /timeclock/clock-out             — clock a staff member out
//	GET    /timeclock/entries               — list entries (manager)
//	PATCH  /timeclock/entries/{id}          — manager edit + audit_log row
//
// Wiring snippet for main.go:
//
//	import "github.com/beepbite/backend/internal/handlers/timeclock"
//
//	tcHandler := timeclock.NewHandler(pool)
//	tcHandler.Mount(authedRouter)  // authedRouter already has RequireOrgScope + ActorOverlay
//
// Routes.jsx entry (add to the authenticated section):
//
//	{ path: '/timeclock', lazy: () => import('@/pages/timeclock') }
package timeclock

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

const managerCap = "can_manage_staff"

// Handler wires the timeclock REST routes.
type Handler struct {
	store *Store
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

func (h *Handler) Mount(r chi.Router) {
	r.Route("/timeclock", func(r chi.Router) {
		r.Post("/clock-in", h.clockIn)
		r.Post("/clock-out", h.clockOut)
		r.With(auth.RequireCapability(managerCap)).Get("/entries", h.listEntries)
		r.With(auth.RequireCapability(managerCap)).Patch("/entries/{id}", h.editEntry)
	})
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

type clockReq struct {
	StaffID string `json:"staff_id"` // required
	Notes   string `json:"notes"`    // optional
}

type editReq struct {
	EntryType string  `json:"entry_type"` // optional; must be valid type
	Timestamp *string `json:"timestamp"`  // optional; RFC3339 string
	Notes     string  `json:"notes"`      // optional
	Reason    string  `json:"reason"`     // optional; stored in audit_log
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (h *Handler) clockIn(w http.ResponseWriter, r *http.Request) {
	h.doClockAction("clock_in", w, r)
}

func (h *Handler) clockOut(w http.ResponseWriter, r *http.Request) {
	h.doClockAction("clock_out", w, r)
}

func (h *Handler) doClockAction(action string, w http.ResponseWriter, r *http.Request) {
	var req clockReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.StaffID == "" {
		writeErr(w, http.StatusBadRequest, "staff_id required")
		return
	}

	// Actor attribution: prefer overlay actor, fall back to member UserID.
	actorID := auth.ActorIDFromContext(r.Context())
	if actorID == "" {
		actorID = auth.OrgScopeFrom(r.Context()).UserID
	}

	var (
		entry *TimeEntry
		err   error
	)
	switch action {
	case "clock_in":
		entry, err = h.store.ClockIn(r.Context(), req.StaffID, actorID, req.Notes)
	case "clock_out":
		entry, err = h.store.ClockOut(r.Context(), req.StaffID, actorID, req.Notes)
	}

	switch {
	case errors.Is(err, ErrStaffNotFound):
		writeErr(w, http.StatusNotFound, "staff not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, entry)
	}
}

func (h *Handler) listEntries(w http.ResponseWriter, r *http.Request) {
	staffID := r.URL.Query().Get("staff_id")
	entries, err := h.store.ListEntries(r.Context(), staffID, 50)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, entries)
}

func (h *Handler) editEntry(w http.ResponseWriter, r *http.Request) {
	entryID := chi.URLParam(r, "id")
	if entryID == "" {
		writeErr(w, http.StatusBadRequest, "entry id required")
		return
	}

	var req editReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}

	// Validate entry_type if provided.
	validTypes := map[string]bool{
		"clock_in": true, "clock_out": true, "break_start": true, "break_end": true,
	}
	if req.EntryType != "" && !validTypes[req.EntryType] {
		writeErr(w, http.StatusBadRequest, "invalid entry_type; must be clock_in|clock_out|break_start|break_end")
		return
	}

	var newTS *time.Time
	if req.Timestamp != nil {
		t, err := time.Parse(time.RFC3339, *req.Timestamp)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "timestamp must be RFC3339 (e.g. 2006-01-02T15:04:05Z)")
			return
		}
		newTS = &t
	}

	// Actor + org for audit log.
	actorID := auth.ActorIDFromContext(r.Context())
	if actorID == "" {
		actorID = auth.OrgScopeFrom(r.Context()).UserID
	}
	orgScope := auth.OrgScopeFrom(r.Context())
	orgID := db.ScopeFromContext(r.Context()).OrgID
	if orgID == "" && len(orgScope.Memberships) > 0 {
		orgID = orgScope.Memberships[0].OrgID
	}

	// Snapshot before/after states for audit.
	before, err := h.store.GetEntry(r.Context(), entryID)
	if errors.Is(err, ErrEntryNotFound) {
		writeErr(w, http.StatusNotFound, "entry not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	beforeJSON, _ := json.Marshal(before)
	afterFields := map[string]any{
		"entry_type": req.EntryType,
		"timestamp":  req.Timestamp,
		"notes":      req.Notes,
		"reason":     req.Reason,
	}
	afterJSON, _ := json.Marshal(afterFields)

	// Compute actor_label for audit readability.
	actorLabel := actorID

	updated, err := h.store.EditEntry(
		r.Context(), entryID,
		req.EntryType, newTS, req.Notes,
		actorID, actorLabel, orgID,
		beforeJSON, afterJSON,
	)
	switch {
	case errors.Is(err, ErrEntryNotFound):
		writeErr(w, http.StatusNotFound, "entry not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, updated)
	}
}

// ---------------------------------------------------------------------------
// IO helpers (local to avoid a shared package dependency)
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
