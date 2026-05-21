// Package driver exposes the driver-facing REST surface for delivery assignments,
// shift management, and GPS location pings (migration 011).
//
// Mount under the authenticated + org-scoped chi.Router group:
//
//	driverH := driver.NewHandler(pool)
//	r.Route("/driver", driverH.Mount)
//
// All endpoints require the can_drive capability on at least one membership.
// Driver identity is resolved from the authenticated user's organization_member
// rows — the client never supplies a driver ID.
package driver

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// driveCap is the capability key that marks an org-member as a driver.
const driveCap = "can_drive"

// Handler is the HTTP handler for all /driver routes.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all /driver sub-routes on r. r must already be inside the
// authenticated + org-scoped middleware group.
//
// Paths registered (relative to the mount point):
//
//	GET  /assignments
//	POST /assignments/{id}/accept
//	POST /assignments/{id}/pickup
//	POST /assignments/{id}/deliver
//	POST /assignments/{id}/cancel
//	POST /shifts/online
//	POST /shifts/paused
//	POST /shifts/offline
//	POST /pings
func (h *Handler) Mount(r chi.Router) {
	// All driver routes require the can_drive capability.
	r.With(auth.RequireCapability(driveCap)).Group(func(r chi.Router) {
		r.Get("/assignments", h.listAssignments)
		r.Post("/assignments/{id}/accept", h.acceptAssignment)
		r.Post("/assignments/{id}/pickup", h.pickupAssignment)
		r.Post("/assignments/{id}/deliver", h.deliverAssignment)
		r.Post("/assignments/{id}/cancel", h.cancelAssignment)

		r.Post("/shifts/online", h.goOnline)
		r.Post("/shifts/paused", h.goPaused)
		r.Post("/shifts/offline", h.goOffline)

		r.Post("/pings", h.postPing)
	})
}

// callerUserID extracts the authenticated user's ID from context. Returns ""
// when the JWT claims are missing (should not happen inside the auth middleware
// group, but handled defensively).
func callerUserID(r *http.Request) string {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil {
		return ""
	}
	return claims.UserID
}
