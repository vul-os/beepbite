// Package stats exposes owner-analytics HTTP endpoints for the dashboard.
// Mount under an already-authenticated, org-scoped chi.Router group.
//
// Routes:
//
//	GET /stats/summary?location_id=<uuid>&period=day|week|month|year
//	GET /stats/heatmap?location_id=<uuid>&weeks=<1..52>
package stats

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/bizday"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/locations"
)

// Handler serves the owner-analytics stats endpoints.
type Handler struct {
	store *Store
	// pool is retained alongside store so the handler can resolve the
	// location's timezone before it computes any window. The window is a
	// property of the room the till is standing in, not of the server.
	pool *pgxpool.Pool
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool), pool: pool}
}

// zoneFor resolves the location's IANA timezone name and *time.Location.
//
// It never fails the request: an unreadable location row falls back to UTC,
// which is the same behaviour the dashboard had before timezones existed. A
// store that cannot load its settings must still be able to see its numbers.
func (h *Handler) zoneFor(r *http.Request, locationID string) (string, *time.Location) {
	settings, err := locations.SettingsFor(r.Context(), h.pool, locationID)
	if err != nil {
		return bizday.UTC, time.UTC
	}
	return settings.Timezone, settings.Zone()
}

// Mount registers the stats routes on r.
// r is expected to be mounted at /stats by the caller.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/summary", h.getSummary)
	r.Get("/heatmap", h.getHeatmap)
}

// ---------------------------------------------------------------------------
// GET /stats/summary
// ---------------------------------------------------------------------------

func (h *Handler) getSummary(w http.ResponseWriter, r *http.Request) {
	locID := r.URL.Query().Get("location_id")
	if locID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}

	period := r.URL.Query().Get("period")
	switch period {
	case "day", "week", "month", "year":
	default:
		writeErr(w, http.StatusBadRequest, "period must be one of: day, week, month, year")
		return
	}

	// Verify the caller's scope allows access to this location.
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	// The window must be anchored to the store's own midnight. Computed in UTC,
	// a Los Angeles store's "today" would begin at 16:00 the previous
	// afternoon, so the dinner service an owner is looking at would be split
	// across two of the dashboard's days.
	tzName, loc := h.zoneFor(r, locID)
	from, to, prevFrom, prevTo := windowBounds(time.Now().In(loc), period, loc)

	ctx := r.Context()

	kpis, err := h.store.QueryKPI(ctx, locID, from, to)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to query KPIs")
		return
	}

	prev, err := h.store.QueryKPI(ctx, locID, prevFrom, prevTo)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to query previous KPIs")
		return
	}

	var series []SeriesBucket
	switch period {
	case "day":
		series, err = h.store.QuerySeriesHour(ctx, locID, from, to, tzName)
	case "week", "month":
		series, err = h.store.QuerySeriesDay(ctx, locID, from, to, tzName)
	case "year":
		series, err = h.store.QuerySeriesMonth(ctx, locID, from, to, tzName)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to query series")
		return
	}

	writeJSON(w, http.StatusOK, SummaryResult{
		Period: period,
		Range: DateRange{
			From: from.Format("2006-01-02"),
			To:   toInclusive(to).Format("2006-01-02"),
		},
		KPIs:     kpis,
		Previous: prev,
		Series:   series,
	})
}

// ---------------------------------------------------------------------------
// GET /stats/heatmap
// ---------------------------------------------------------------------------

func (h *Handler) getHeatmap(w http.ResponseWriter, r *http.Request) {
	locID := r.URL.Query().Get("location_id")
	if locID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}

	// Verify the caller's scope allows access to this location.
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	weeks := 12
	if v := r.URL.Query().Get("weeks"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			n = 1
		}
		if n > 52 {
			n = 52
		}
		weeks = n
	}

	// The heatmap's whole purpose is "which hours of which weekday are busy",
	// so its buckets have to be local hours. In UTC an LA store's Friday dinner
	// rush lands in Saturday's early-morning cells.
	tzName, _ := h.zoneFor(r, locID)

	cells, err := h.store.QueryHeatmap(r.Context(), locID, weeks, tzName)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to query heatmap")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"cells": cells})
}

// ---------------------------------------------------------------------------
// Time-window helpers
// ---------------------------------------------------------------------------

// windowBounds returns the [from, to) half-open interval for the current
// period and [prevFrom, prevTo) for the immediately preceding equivalent
// window. All boundaries are midnight in loc — the store's own timezone, not
// the server's and not UTC.
//
// Every boundary is built with time.Date in loc and stepped with AddDate rather
// than by adding 24h. That is what keeps the two DST nights per year honest: on
// a 23-hour spring-forward day, "+24h" would put the boundary at 01:00 the next
// morning and quietly move an hour of orders into the wrong day.
//
//   - day    → today 00:00 … tomorrow 00:00;  previous = yesterday
//   - week   → 7 days ago 00:00 … tomorrow 00:00 (7-day rolling);
//     previous = 14 days ago … 7 days ago
//   - month  → first of current calendar month … first of next month;
//     previous = first of prior month … first of current month
//   - year   → 12 months ago (first of that month) … first of next month;
//     previous = 24 months ago … 12 months ago
func windowBounds(now time.Time, period string, loc *time.Location) (from, to, prevFrom, prevTo time.Time) {
	if loc == nil {
		loc = time.UTC
	}
	local := now.In(loc)
	today, tomorrow := bizday.Bounds(local, loc)
	firstOfMonth := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, loc)

	switch period {
	case "day":
		from = today
		to = tomorrow
		prevFrom = today.AddDate(0, 0, -1)
		prevTo = today

	case "week":
		from = today.AddDate(0, 0, -6) // last 7 days incl. today
		to = tomorrow
		prevFrom = from.AddDate(0, 0, -7)
		prevTo = from

	case "month":
		from = firstOfMonth
		to = from.AddDate(0, 1, 0)
		prevFrom = from.AddDate(0, -1, 0)
		prevTo = from

	case "year":
		// Last 12 complete months + current partial month up to now.
		// Start = first day of the month that was 12 months ago.
		startMonth := firstOfMonth.AddDate(-1, 0, 0)
		from = startMonth
		to = firstOfMonth.AddDate(0, 1, 0)
		prevFrom = startMonth.AddDate(-1, 0, 0)
		prevTo = startMonth
	}
	return
}

// toInclusive converts an exclusive upper bound (midnight of next day) to the
// inclusive last day of the range for the Range.To display field.
func toInclusive(exclusiveTo time.Time) time.Time {
	return exclusiveTo.AddDate(0, 0, -1)
}
