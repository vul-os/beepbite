// Package waittime exposes a single GET endpoint that estimates the current
// kitchen wait time for a location based on live KDS load.
//
// # Endpoint
//
//	GET /locations/{location_id}/wait-time
//
// # Response
//
//	{
//	  "estimated_minutes": 18,
//	  "active_tickets":    3,
//	  "active_items":      7
//	}
//
// # Formula
//
// The estimate is computed in three steps:
//
//  1. Start from the operator-configured baseline:
//     baseline = locations.avg_prep_minutes  (default 15)
//
//  2. Add a load adjustment that scales with how many items are queued per
//     active kitchen station:
//
//     items_per_station = active_item_count / max(station_count, 1)
//     load_delta        = items_per_station * perItemFactor
//
//     perItemFactor (1.5 min/item/station) is a tunable constant that
//     approximates the marginal delay each additional item adds when stations
//     work in parallel.  A single station with 10 items in flight adds
//     10 × 1.5 = 15 min on top of baseline; two stations with the same 10
//     items adds only 5 × 1.5 = 7.5 min.
//
//  3. Clamp to [minEstimate, maxEstimate] = [5, 90] minutes so the UI never
//     shows implausible values (< 5 min implies an idle kitchen, > 90 min
//     is better communicated via a separate "very busy" state).
//
// # Assumptions
//
//   - Station parallelism: items are evenly distributed across prep stations.
//     This is an optimistic model — a station-aware model (weighing items by
//     their routed station) would be more accurate but requires routing data
//     joins that are expensive at query time.
//   - Item weight: every item counts equally.  Modifiers and complex items
//     may take longer; a future Wave can multiply by a per-category factor.
//   - Idle kitchen: when there are no active tickets the estimate equals the
//     baseline (clamped to [5, 90]), not zero, because prep always takes
//     *some* time.
//   - Staleness: the estimate is point-in-time and not cached.  If latency
//     becomes a concern, a short TTL cache keyed on location_id is trivial
//     to add.
//
// # Marketplace note
//
// This handler is mounted org-scoped (requires RequireOrgScope middleware),
// which is appropriate for POS and back-office consumers.  A future public
// marketplace variant can reuse [Store.FetchLoadData] directly with a
// [db.MarketplaceScope] — only locations with is_marketplace_visible=true
// would need an extra policy, which is a one-line store change.
package waittime

import (
	"errors"
	"math"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// perItemFactor is the number of minutes each additional item-per-station
// contributes to the estimated wait.  Calibrated at 1.5 min for a typical
// quick-service line.
const perItemFactor = 1.5

// minEstimate and maxEstimate bound the result to a sane display range.
const minEstimate = 5
const maxEstimate = 90

// Handler handles wait-time estimation requests.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler with the given connection pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers the wait-time route under r.
// Callers should wire this inside an already-authenticated, org-scoped router
// group, e.g.:
//
//	r.Route("/locations/{location_id}", func(r chi.Router) {
//	    waittime.NewHandler(pool).Mount(r)
//	})
func (h *Handler) Mount(r chi.Router) {
	r.Get("/locations/{location_id}/wait-time", h.getWaitTime)
}

// WaitTimeResponse is the JSON body returned by GET /locations/{id}/wait-time.
type WaitTimeResponse struct {
	// EstimatedMinutes is the computed wait estimate, clamped to [5, 90].
	EstimatedMinutes int `json:"estimated_minutes"`
	// ActiveTickets is the number of KDS tickets currently in 'fired' or
	// 'in_progress' state at this location.
	ActiveTickets int `json:"active_tickets"`
	// ActiveItems is the total item quantity across those active tickets
	// (excluding voided/bumped/86ed items).
	ActiveItems float64 `json:"active_items"`
}

// getWaitTime implements GET /locations/{location_id}/wait-time.
func (h *Handler) getWaitTime(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}

	// Org-scope check: AllowsLocation returns false when the location does not
	// belong to the authenticated user's org, or when RLS would hide it.
	// We return 404 (not 403) to avoid existence leaks.
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	data, err := h.store.FetchLoadData(r.Context(), locationID)
	switch {
	case errors.Is(err, ErrLocationNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	est := estimate(data.AvgPrepMinutes, data.ActiveItems, data.StationCount)

	writeJSON(w, http.StatusOK, WaitTimeResponse{
		EstimatedMinutes: est,
		ActiveTickets:    data.ActiveTickets,
		ActiveItems:      data.ActiveItems,
	})
}

// estimate computes the wait-time estimate.  Extracted to a pure function so
// it can be unit-tested without a database.
//
// Formula:
//
//	items_per_station = activeItems / max(stations, 1)
//	est               = avgPrepMinutes + items_per_station * perItemFactor
//	est               = clamp(est, minEstimate, maxEstimate)
func estimate(avgPrepMinutes int, activeItems float64, stations int) int {
	if stations < 1 {
		stations = 1
	}
	itemsPerStation := activeItems / float64(stations)
	est := float64(avgPrepMinutes) + itemsPerStation*perItemFactor
	est = math.Max(minEstimate, math.Min(maxEstimate, est))
	return int(math.Round(est))
}
