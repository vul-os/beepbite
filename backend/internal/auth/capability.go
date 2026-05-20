// Package auth — capability-gate middleware (T9.4a, extended T9.5e).
//
// RequireCapability is an HTTP middleware factory that enforces a named
// capability before allowing a request to proceed. The capability set is
// sourced from ActorCapabilities(ctx) (defined in actor_middleware.go), which
// returns the actor-overlay capabilities when an X-Actor-Token is present, or
// falls back to the member's merged OrgScope capabilities otherwise.
//
// T9.5e elevation path: RequireCapabilityWithElevation is the variant to use
// when a manager-elevation bypass should be accepted. When the actor lacks the
// capability the middleware falls back to X-Elevation-Token validation via the
// ElevationChecker, consuming the single-use token if valid.
//
// HasCapability and ActorCapabilities live in actor_middleware.go.
package auth

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// ElevationChecker validates and consumes a raw elevation JWT for a specific
// (capability, action, targetID) triple. It returns the manager's staff_id on
// success, or an error on any failure.
//
// The only production implementation is ElevationCheckerFunc, which wraps
// ConsumeElevationToken + ParseElevationToken. Tests may substitute a stub.
type ElevationChecker interface {
	CheckElevation(ctx context.Context, rawToken, capability, action, targetID string) (grantedByStaffID string, err error)
}

// elevationCtxKey is the context key for the injected ElevationContext value.
type elevationCtxKey struct{}

// ElevationContext carries the identities for an elevation-approved request.
// Handlers read this to attribute audit log rows correctly.
type ElevationContext struct {
	// ActorID is the staff_id from the X-Actor-Token (the cashier making the
	// request). Empty when no actor overlay is present.
	ActorID string
	// ElevatedBy is the staff_id of the manager whose PIN was verified when
	// the elevation token was minted.
	ElevatedBy string
	// GrantedCapability is the capability the elevation token grants.
	GrantedCapability string
}

// ElevationFromContext extracts the ElevationContext injected by
// RequireCapabilityWithElevation, or a zero-value struct when the request was
// not elevated.
func ElevationFromContext(ctx context.Context) (ElevationContext, bool) {
	ec, ok := ctx.Value(elevationCtxKey{}).(ElevationContext)
	return ec, ok
}

// RequireCapability returns an HTTP middleware that enforces the presence of a
// named capability. The capability list is sourced from ActorCapabilities(ctx),
// which reads the actor-overlay (when present) or the OrgScope member
// capabilities populated by RequireOrgScope.
//
// Wire after auth.Middleware + auth.RequireOrgScope (+ optional ActorOverlay):
//
//	r.With(auth.RequireCapability("can_void")).Post("/{order_id}/void", h.voidOrder)
//
// On failure the response body is:
//
//	{"error":"missing_capability","capability":"<name>"}
func RequireCapability(name string) func(http.Handler) http.Handler {
	return requireCapabilityImpl(name, "", "", nil)
}

// RequireCapabilityWithElevation is the elevation-aware variant. When the
// actor lacks the named capability it looks for an X-Elevation-Token header.
// The token must grant the same capability, the same action name, and a
// target_id that matches the chi URL parameter named by targetParam (empty
// string means no target matching is required).
//
// On a valid and unconsumed elevation token the middleware:
//  1. Consumes the token (marks it used in the DB — single-use enforced).
//  2. Injects an ElevationContext into the request context for audit logging.
//  3. Calls the next handler.
//
// Wire exactly like RequireCapability; just swap the function:
//
//	r.With(auth.RequireCapabilityWithElevation("can_void","void","order_id",checker)).Post(...)
func RequireCapabilityWithElevation(name, action, targetParam string, checker ElevationChecker) func(http.Handler) http.Handler {
	return requireCapabilityImpl(name, action, targetParam, checker)
}

// requireCapabilityImpl is the shared core.
func requireCapabilityImpl(name, action, targetParam string, checker ElevationChecker) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()

			if HasCapability(ctx, name) {
				next.ServeHTTP(w, r)
				return
			}

			// Actor lacks the named capability — try elevation token when configured.
			if checker != nil {
				if rawTok := r.Header.Get("X-Elevation-Token"); rawTok != "" {
					targetID := ""
					if targetParam != "" {
						targetID = chi.URLParam(r, targetParam)
					}

					grantedBy, err := checker.CheckElevation(ctx, rawTok, name, action, targetID)
					if err == nil {
						// Token valid and consumed — inject elevation context.
						ec := ElevationContext{
							ActorID:           ActorIDFromContext(ctx),
							ElevatedBy:        grantedBy,
							GrantedCapability: name,
						}
						ctx = context.WithValue(ctx, elevationCtxKey{}, ec)
						next.ServeHTTP(w, r.WithContext(ctx))
						return
					}
					// Token present but invalid — map to 403 with a specific error
					// so the client knows to request a fresh elevation.
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusForbidden)
					_ = json.NewEncoder(w).Encode(map[string]string{
						"error":      elevationErrCode(err),
						"capability": name,
					})
					return
				}
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error":      "missing_capability",
				"capability": name,
			})
		})
	}
}

// elevationErrCode maps elevation sentinel errors to API error codes.
func elevationErrCode(err error) string {
	switch err {
	case ErrElevationExpired:
		return "elevation_expired"
	case ErrElevationUsed:
		return "elevation_used"
	case ErrElevationMismatch:
		return "elevation_mismatch"
	default:
		return "elevation_invalid"
	}
}
