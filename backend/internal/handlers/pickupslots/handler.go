// Package pickupslots exposes a public endpoint that returns available pickup
// time slots for a location on a given date.
//
// Mount path (suggested, wired by the orchestrator):
//
//	r.Mount("/", pickupslots.NewHandler(pool).Mount)
//
// The customer-facing GET endpoint is PUBLIC (no auth required) so that the
// checkout page can call it before the customer is signed in, matching the
// pattern used by the marketplace store-detail endpoint.
//
// Assumption: operating window defaults to 10:00–21:00 local time because
// the locations table does not yet model opening hours. When an opening-hours
// table is added this function should be updated to read from it instead.
package pickupslots

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// defaultOpenHour is the start of the assumed operating window (10:00).
	defaultOpenHour = 10
	// defaultCloseHour is the end of the assumed operating window (21:00).
	// Slots whose start time is >= closeHour are omitted.
	defaultCloseHour = 21
)

// Slot is one entry in the pickup-slot list response.
type Slot struct {
	// SlotTime is the ISO-8601 timestamp of the slot start in UTC.
	// Clients should display this in the location's local timezone.
	SlotTime  string `json:"slot_time"`
	// Capacity is the max orders for this slot (0 = unlimited).
	Capacity  int    `json:"capacity"`
	// Scheduled is how many orders already have pickup_at in this slot.
	// Returns 0 until orders.pickup_at column exists (see FLAG in store.go).
	Scheduled int    `json:"scheduled"`
	// IsFull is true when Capacity > 0 && Scheduled >= Capacity.
	IsFull    bool   `json:"is_full"`
}

// Handler handles pickup-slot HTTP requests.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by the given connection pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers routes onto r. Call this from the orchestrator.
//
//	Endpoint:
//	  GET /locations/{location_id}/pickup-slots?date=YYYY-MM-DD
//
// This endpoint is intentionally PUBLIC (no auth middleware applied here) so
// it is accessible from the marketplace checkout page without a user token.
// Mount it under a public router group in your server wiring.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/locations/{location_id}/pickup-slots", h.listSlots)
}

func (h *Handler) listSlots(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id path param required")
		return
	}

	dateStr := r.URL.Query().Get("date")
	if dateStr == "" {
		writeErr(w, http.StatusBadRequest, "date query param required (YYYY-MM-DD)")
		return
	}

	date, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "date must be YYYY-MM-DD")
		return
	}

	cfg, err := h.store.GetSlotConfig(r.Context(), locationID)
	switch {
	case errors.Is(err, ErrLocationNotFound):
		writeErr(w, http.StatusNotFound, "location not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	slotMinutes := cfg.PickupSlotMinutes
	if slotMinutes <= 0 {
		slotMinutes = 15
	}

	// Generate slots over the default operating window (10:00–21:00 UTC).
	// ASSUMPTION: operating hours are not yet modelled; we use a fixed window.
	// Replace with a query against an opening_hours table when available.
	slots := generateSlots(date, defaultOpenHour, defaultCloseHour, slotMinutes)

	// Count bookings per slot. If pickup_at column doesn't exist yet (returns
	// a db error), we treat the count as 0 and continue — safe degradation.
	result := make([]Slot, 0, len(slots))
	for _, slotTime := range slots {
		slotISO := slotTime.UTC().Format(time.RFC3339)
		count, countErr := h.store.CountOrdersInSlot(r.Context(), locationID, slotISO, slotMinutes)
		if countErr != nil {
			// FLAG: orders.pickup_at not yet present — degrade gracefully.
			count = 0
		}
		isFull := cfg.PickupSlotCapacity > 0 && count >= cfg.PickupSlotCapacity
		result = append(result, Slot{
			SlotTime:  slotISO,
			Capacity:  cfg.PickupSlotCapacity,
			Scheduled: count,
			IsFull:    isFull,
		})
	}

	writeJSON(w, http.StatusOK, result)
}

// generateSlots returns slot start times for [date openHour, date closeHour)
// at granularity slotMinutes. All times are expressed in UTC (no TZ shift
// since we don't yet model per-location timezone).
func generateSlots(date time.Time, openHour, closeHour, slotMinutes int) []time.Time {
	// Build a UTC start time for the operating window on the requested date.
	start := time.Date(date.Year(), date.Month(), date.Day(), openHour, 0, 0, 0, time.UTC)
	end := time.Date(date.Year(), date.Month(), date.Day(), closeHour, 0, 0, 0, time.UTC)

	dur := time.Duration(slotMinutes) * time.Minute
	if dur <= 0 {
		dur = 15 * time.Minute
	}

	var slots []time.Time
	for t := start; t.Before(end); t = t.Add(dur) {
		slots = append(slots, t)
	}
	return slots
}

