// Package tracking exposes GET /track/{token} for customer live-tracking.
//
// Security model:
//   - The tracking token is the bearer of access. No JWT / org-scope is needed.
//   - DB access uses ServiceRoleScope; the token itself is the parameterised
//     WHERE clause boundary (see store.go).
//   - Precise driver coordinates are returned only when
//     pings_visible_to_customer() passes all three gates (out_for_delivery,
//     driver within 5 km, and caller's user_id matches the token's
//     customer_profile_id). For anonymous / unauthenticated callers the
//     response includes order progress without the driver marker.
//
// Mount:
//
//	This handler MUST be mounted OUTSIDE the org-scoped auth group —
//	alongside the marketplace and webhook routes, before auth middleware.
//	Example (cmd/server/main.go):
//
//	    trackingH := tracking.NewHandler(pool)
//	    trackingH.Mount(r)                  // registers GET /track/{token}
package tracking

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler serves the public customer-tracking endpoint.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers GET /track/{token} on r.
// r must be the top-level router (no auth middleware in scope).
func (h *Handler) Mount(r chi.Router) {
	r.Route("/track", func(r chi.Router) {
		r.Get("/{token}", h.getTracking)
	})
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

// ---- handler ----

// getTracking handles GET /track/{token}.
//
// Response shape (always present):
//
//	{
//	  "token":           "...",
//	  "order_id":        "...",
//	  "status":          "out_for_delivery",
//	  "fulfillment_type":"delivery",
//	  "estimated_delivery_time": "...",  // nullable
//	  "store_lat":       12.345,          // nullable
//	  "store_lng":       45.678,          // nullable
//	  "delivery_address":"...",           // nullable
//	  "delivery_lat":    12.346,          // only when out_for_delivery
//	  "delivery_lng":    45.679,          // only when out_for_delivery
//	  "driver": {                         // only when pings_visible_to_customer passes
//	    "lat":         12.347,
//	    "lng":         45.680,
//	    "recorded_at": "..."
//	  }
//	}
func (h *Handler) getTracking(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		writeErr(w, http.StatusBadRequest, "token is required")
		return
	}

	info, err := h.store.GetTrackingInfo(r.Context(), token)
	switch {
	case errors.Is(err, ErrTokenNotFound):
		writeErr(w, http.StatusNotFound, "tracking token not found or expired")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, "internal error")
	default:
		writeJSON(w, http.StatusOK, info)
	}
}
