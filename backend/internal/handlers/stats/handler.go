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

	"github.com/beepbite/backend/internal/auth"
)

// Handler serves the owner-analytics stats endpoints.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
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

	now := time.Now().UTC()
	from, to, prevFrom, prevTo := windowBounds(now, period)

	// Clamp to, prevTo to end-of-day (exclusive upper bound already is midnight
	// of the next day from windowBounds).

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
		series, err = h.store.QuerySeriesHour(ctx, locID, from, to)
	case "week", "month":
		series, err = h.store.QuerySeriesDay(ctx, locID, from, to)
	case "year":
		series, err = h.store.QuerySeriesMonth(ctx, locID, from, to)
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

	cells, err := h.store.QueryHeatmap(r.Context(), locID, weeks)
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
// window. All times are UTC midnight boundaries.
//
//   - day    → today 00:00 … tomorrow 00:00;  previous = yesterday
//   - week   → 7 days ago 00:00 … tomorrow 00:00 (7-day rolling);
//     previous = 14 days ago … 7 days ago
//   - month  → first of current calendar month … first of next month;
//     previous = first of prior month … first of current month
//   - year   → 12 months ago (first of that month) … first of next month;
//     previous = 24 months ago … 12 months ago
func windowBounds(now time.Time, period string) (from, to, prevFrom, prevTo time.Time) {
	midnight := func(t time.Time) time.Time {
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	}
	today := midnight(now)

	switch period {
	case "day":
		from = today
		to = today.AddDate(0, 0, 1)
		prevFrom = today.AddDate(0, 0, -1)
		prevTo = today

	case "week":
		from = today.AddDate(0, 0, -6) // last 7 days incl. today
		to = today.AddDate(0, 0, 1)
		prevFrom = from.AddDate(0, 0, -7)
		prevTo = from

	case "month":
		from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		to = from.AddDate(0, 1, 0)
		prevFrom = from.AddDate(0, -1, 0)
		prevTo = from

	case "year":
		// Last 12 complete months + current partial month up to now.
		// Start = first day of the month that was 12 months ago.
		startMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(-1, 0, 0)
		endMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 1, 0)
		from = startMonth
		to = endMonth
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
