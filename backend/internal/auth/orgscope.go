// Package auth — org-scope helpers.
//
// T6.1: Full implementation of RequireOrgScope HTTP middleware. Resolves the
// JWT UserID against organization_members and locations, injects an OrgScope
// into context, and also injects a db.Scope so handlers can call db.Scoped.
//
// Backward-compatible with the T6.2 stub interface:
//
//	OrgScopeFrom(ctx)            — returns the OrgScope value (not pointer).
//	scope.AllowsLocation(locID)  — O(n) check against LocationIDs.
//	scope.AllowsStation(staID)   — O(1) check via AllowedStations map.
//	ContextWithOrgScope(ctx, s)  — injects OrgScope (used by tests).
//
// New T6.1 surface:
//
//	RequireOrgScope(pool)        — HTTP middleware constructor.
//	ScopeAllowsLocation(s, id)   — standalone helper (nil-safe).
//	ScopeAllowsOrg(s, id)        — standalone helper (nil-safe).
//	Capabilities(ctx)            — merged capability keys from all memberships.
package auth

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Context key
// ---------------------------------------------------------------------------

// orgScopeKey is the context key for the OrgScope value.
type orgScopeKey struct{}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Membership represents a single organization_members row resolved for the
// authenticated user.
type Membership struct {
	OrgID        string // organizations.id (UUID string)
	Role         string // organization_members.role
	Capabilities []byte // organization_members.capabilities (raw JSON, e.g. {"can_pos":true})
}

// OrgScope captures the resolved org memberships and associated location IDs
// for the authenticated request. Injected by RequireOrgScope and consumed via
// OrgScopeFrom.
//
// The AllowedLocations and AllowedStations maps are kept for backward
// compatibility with T6.2 handlers. When RequireOrgScope populates the scope
// it builds AllowedLocations from LocationIDs. AllowedStations is left nil
// (T6.2 handlers pre-resolve station→location themselves).
type OrgScope struct {
	UserID string // auth_users.id (UUID string)

	// Memberships holds one entry per organization_members row for this user.
	Memberships []Membership
	// LocationIDs lists every location.id belonging to the user's orgs.
	LocationIDs []string

	// AllowedLocations is a set derived from LocationIDs for O(1) AllowsLocation
	// checks. Nil means allow-all (stub / service-role behaviour — preserved for
	// endpoints that don't run RequireOrgScope yet).
	AllowedLocations map[string]struct{}
	// AllowedStations maps station_id → location_id, resolved by middleware or
	// handler. Nil means allow-all (stub behaviour).
	AllowedStations map[string]string
}

// AllowsLocation returns true if the scope permits access to the given
// location UUID string. Returns true when AllowedLocations is nil (open /
// stub mode).
func (s OrgScope) AllowsLocation(locationID string) bool {
	if s.AllowedLocations == nil {
		return true
	}
	_, ok := s.AllowedLocations[locationID]
	return ok
}

// AllowsStation returns true if the scope permits access to the given station
// UUID. The middleware (or T6.2 handler) pre-resolves station→location into
// AllowedStations. Returns true when AllowedStations is nil (open / stub mode).
func (s OrgScope) AllowsStation(stationID string) bool {
	if s.AllowedStations == nil {
		return true
	}
	locID, ok := s.AllowedStations[stationID]
	if !ok {
		return false
	}
	return s.AllowsLocation(locID)
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

// OrgScopeFrom extracts the OrgScope from a context. Returns an open
// (allow-all) zero-value OrgScope when none has been injected, preserving
// backward compatibility with handlers that run before RequireOrgScope is
// wired in.
func OrgScopeFrom(ctx context.Context) OrgScope {
	if s, ok := ctx.Value(orgScopeKey{}).(OrgScope); ok {
		return s
	}
	return OrgScope{} // nil maps → allow-all
}

// ContextWithOrgScope injects an OrgScope into a context. Used by
// RequireOrgScope and tests.
func ContextWithOrgScope(ctx context.Context, s OrgScope) context.Context {
	return context.WithValue(ctx, orgScopeKey{}, s)
}

// ---------------------------------------------------------------------------
// Standalone helpers (T6.1 public API)
// ---------------------------------------------------------------------------

// ScopeAllowsLocation reports whether locID appears in scope.LocationIDs.
// Returns false for a nil scope pointer.
func ScopeAllowsLocation(scope *OrgScope, locID string) bool {
	if scope == nil {
		return false
	}
	for _, id := range scope.LocationIDs {
		if id == locID {
			return true
		}
	}
	return false
}

// ScopeAllowsOrg reports whether orgID appears in scope.Memberships.
// Returns false for a nil scope pointer.
func ScopeAllowsOrg(scope *OrgScope, orgID string) bool {
	if scope == nil {
		return false
	}
	for _, m := range scope.Memberships {
		if m.OrgID == orgID {
			return true
		}
	}
	return false
}

// Capabilities returns the deduplicated set of capability keys whose value is
// JSON true across all memberships in the context's OrgScope.
//
// Example: capabilities {"can_pos":true,"can_void":true} → ["can_pos","can_void"]
//
// Returns nil when no OrgScope is present or all capabilities are empty.
func Capabilities(ctx context.Context) []string {
	s := OrgScopeFrom(ctx)
	if len(s.Memberships) == 0 {
		return nil
	}

	seen := make(map[string]struct{})
	var caps []string
	for _, m := range s.Memberships {
		if len(m.Capabilities) == 0 {
			continue
		}
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(m.Capabilities, &obj); err != nil {
			continue
		}
		for key, val := range obj {
			if _, already := seen[key]; already {
				continue
			}
			var boolVal bool
			if err := json.Unmarshal(val, &boolVal); err == nil && boolVal {
				seen[key] = struct{}{}
				caps = append(caps, key)
			}
		}
	}
	return caps
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// orgMembershipQuerier abstracts the pgxpool.Pool rows used by
// RequireOrgScope so tests can inject a stub without a live database.
type orgMembershipQuerier interface {
	queryMemberships(ctx context.Context, userID string) ([]Membership, error)
	queryLocationIDs(ctx context.Context, orgIDs []string) ([]string, error)
}

// poolQuerier is the production implementation of orgMembershipQuerier.
type poolQuerier struct{ pool *pgxpool.Pool }

// queryMemberships resolves the user's org memberships. This is a privileged
// identity-resolution query (the middleware IS the trusted resolver), so it
// runs as service-role to bypass RLS on organization_members — otherwise the
// query runs with no session vars set and current_user_id() is NULL, returning
// zero rows even for users who ARE members.
func (p *poolQuerier) queryMemberships(ctx context.Context, userID string) ([]Membership, error) {
	var out []Membership
	err := db.Scoped(ctx, p.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT organization_id, role, capabilities
			   FROM organization_members
			  WHERE profile_id = $1`,
			userID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m Membership
			if err := rows.Scan(&m.OrgID, &m.Role, &m.Capabilities); err != nil {
				return err
			}
			out = append(out, m)
		}
		return rows.Err()
	})
	return out, err
}

// queryLocationIDs resolves the location IDs for the user's orgs. Same
// service-role rationale as queryMemberships.
func (p *poolQuerier) queryLocationIDs(ctx context.Context, orgIDs []string) ([]string, error) {
	var out []string
	err := db.Scoped(ctx, p.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id FROM locations WHERE organization_id = ANY($1::uuid[])`,
			orgIDs,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			out = append(out, id)
		}
		return rows.Err()
	})
	return out, err
}

// RequireOrgScope returns an HTTP middleware that:
//  1. Reads Claims injected by auth.Middleware (returns 401 if absent).
//  2. Queries organization_members for all org memberships of the user.
//  3. Returns 403 when the user has no memberships.
//  4. Queries locations to build the full set of location IDs.
//  5. Injects an OrgScope (with AllowedLocations populated) into context.
//  6. Injects a db.Scope (using the first membership) into context so
//     handlers can call db.Scoped without re-resolving org.
//
// Wire after auth.Middleware:
//
//	r.Use(auth.Middleware(svc))
//	r.Use(auth.RequireOrgScope(pool))
func RequireOrgScope(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return requireOrgScopeWith(&poolQuerier{pool: pool})
}

// requireOrgScopeWith is the testable core, accepting any orgMembershipQuerier.
func requireOrgScopeWith(q orgMembershipQuerier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := ClaimsFrom(r.Context())
			if !ok || claims == nil || claims.UserID == "" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			ctx := r.Context()

			memberships, err := q.queryMemberships(ctx, claims.UserID)
			if err != nil {
				http.Error(w, "internal error resolving org scope", http.StatusInternalServerError)
				return
			}
			// NOTE: a fresh signup has 0 memberships. We pass through with an
			// empty scope so the user can hit /data/organizations (POST) to
			// create their first org via the onboarding flow. Handlers that
			// require a real membership must enforce it themselves (e.g. via
			// RequireCapability or ScopeAllowsLocation, both of which return
			// false on empty scope).
			if len(memberships) == 0 {
				scope := OrgScope{
					UserID:           claims.UserID,
					AllowedLocations: map[string]struct{}{},
				}
				dbScope := db.Scope{UserID: claims.UserID}
				ctx = ContextWithOrgScope(ctx, scope)
				ctx = db.ContextWithScope(ctx, dbScope)
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			// Collect unique org IDs.
			orgIDSet := make(map[string]struct{}, len(memberships))
			for _, m := range memberships {
				orgIDSet[m.OrgID] = struct{}{}
			}
			orgIDs := make([]string, 0, len(orgIDSet))
			for id := range orgIDSet {
				orgIDs = append(orgIDs, id)
			}

			locationIDs, err := q.queryLocationIDs(ctx, orgIDs)
			if err != nil {
				http.Error(w, "internal error resolving locations", http.StatusInternalServerError)
				return
			}

			// Build AllowedLocations set for O(1) AllowsLocation checks.
			allowed := make(map[string]struct{}, len(locationIDs))
			for _, id := range locationIDs {
				allowed[id] = struct{}{}
			}

			scope := OrgScope{
				UserID:           claims.UserID,
				Memberships:      memberships,
				LocationIDs:      locationIDs,
				AllowedLocations: allowed,
			}

			// db.Scope uses the first membership for session-variable injection.
			// Multi-org handlers must call db.Scoped with an explicit scope.
			dbScope := db.Scope{
				UserID:       claims.UserID,
				OrgID:        memberships[0].OrgID,
				Capabilities: memberships[0].Capabilities,
			}

			ctx = ContextWithOrgScope(ctx, scope)
			ctx = db.ContextWithScope(ctx, dbScope)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
