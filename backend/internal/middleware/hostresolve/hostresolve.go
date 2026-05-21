// Package hostresolve provides a chi middleware that resolves the HTTP Host
// header to a BeepBite location_id and injects it into the request context.
//
// # Resolution rules (evaluated in order)
//
//  1. Hosts matching a reserved subdomain (app, api, www, admin, *.beepbite.io
//     with a reserved prefix) are passed through without modification.
//  2. Hosts matching the pattern <slug>.beepbite.io are resolved via the
//     locations table (slug → location_id).
//  3. Any other host is looked up in custom_domains WHERE status='live'.
//
// If resolution succeeds the location_id is injected into the request context
// via ContextWithLocationID. Downstream handlers retrieve it via LocationIDFrom.
//
// If resolution fails (no matching row) the middleware passes through without
// injecting a location_id — handlers that require a resolved location must
// check for the zero value and return 404.
//
// # Wiring in main.go
//
//	resolver := hostresolve.NewResolver(pool)
//	// On the top-level chi router (before auth middleware):
//	r.Use(hostresolve.Middleware(resolver))
package hostresolve

import (
	"context"
	"log"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/handlers/customdomains"
)

// ---------------------------------------------------------------------------
// Context key & accessors
// ---------------------------------------------------------------------------

// LocationIDKey is the exported context key type for the resolved location_id.
// Use LocationIDFrom to retrieve the value rather than reading the key directly.
type locationIDContextKey struct{}

// LocationIDKey is the exported singleton used to read the context value.
// Exported so tests and other packages can use context.Value(LocationIDKey)
// directly if needed; prefer LocationIDFrom for idiomatic access.
var LocationIDKey = locationIDContextKey{}

// ContextWithLocationID injects a resolved location_id into ctx.
// Called internally by the middleware; also available for tests.
func ContextWithLocationID(ctx context.Context, locationID string) context.Context {
	return context.WithValue(ctx, LocationIDKey, locationID)
}

// LocationIDFrom returns the location_id injected by the middleware.
// Returns an empty string when no location has been resolved (e.g. the request
// is for the main app domain or resolution failed).
func LocationIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(LocationIDKey).(string); ok {
		return v
	}
	return ""
}

// ---------------------------------------------------------------------------
// Resolver (DB queries)
// ---------------------------------------------------------------------------

// Resolver wraps the Store methods needed for host resolution.
// Separated from the middleware so it can be mocked in tests.
type Resolver interface {
	ResolveSlug(ctx context.Context, slug string) (string, error)
	ResolveCustomHostname(ctx context.Context, hostname string) (string, error)
}

// storeResolver delegates to customdomains.Store.
type storeResolver struct{ store *customdomains.Store }

func (r *storeResolver) ResolveSlug(ctx context.Context, slug string) (string, error) {
	// customdomains.Store is in the same module; call unexported-friendly method.
	return r.store.ResolveSlug(ctx, slug)
}

func (r *storeResolver) ResolveCustomHostname(ctx context.Context, hostname string) (string, error) {
	return r.store.ResolveCustomHostname(ctx, hostname)
}

// NewResolver constructs the production Resolver backed by pool.
func NewResolver(pool *pgxpool.Pool) Resolver {
	return &storeResolver{store: customdomains.NewStore(pool)}
}

// ---------------------------------------------------------------------------
// Reserved subdomains
// ---------------------------------------------------------------------------

// reservedSubdomains is the set of <slug>.beepbite.io prefixes that belong to
// the platform infrastructure and must not be resolved to store location_ids.
var reservedSubdomains = map[string]struct{}{
	"app":   {},
	"api":   {},
	"www":   {},
	"admin": {},
}

const beepbiteApex = "beepbite.io"

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Middleware returns a chi-compatible middleware that resolves the Host header
// to a location_id and injects it into the request context.
//
// Pass the Resolver returned by NewResolver(pool) for production use.
func Middleware(r Resolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			host := canonicalHost(req.Host)
			if host == "" {
				next.ServeHTTP(w, req)
				return
			}

			ctx := req.Context()

			// --- Rule 1: beepbite.io subdomain? ---
			if strings.HasSuffix(host, "."+beepbiteApex) {
				sub := strings.TrimSuffix(host, "."+beepbiteApex)

				// Reserved subdomains pass through without resolution.
				if _, reserved := reservedSubdomains[sub]; reserved {
					next.ServeHTTP(w, req)
					return
				}

				// Attempt slug resolution.
				locationID, err := r.ResolveSlug(ctx, sub)
				if err != nil {
					// Unknown slug — pass through; handler decides what to do.
					if !isNotFound(err) {
						log.Printf("[hostresolve] slug lookup error host=%q slug=%q: %v", host, sub, err)
					}
					next.ServeHTTP(w, req)
					return
				}

				req = req.WithContext(ContextWithLocationID(ctx, locationID))
				next.ServeHTTP(w, req)
				return
			}

			// --- Rule 2: plain apex (beepbite.io) — pass through ---
			if host == beepbiteApex {
				next.ServeHTTP(w, req)
				return
			}

			// --- Rule 3: custom hostname ---
			locationID, err := r.ResolveCustomHostname(ctx, host)
			if err != nil {
				if !isNotFound(err) {
					log.Printf("[hostresolve] custom hostname lookup error host=%q: %v", host, err)
				}
				next.ServeHTTP(w, req)
				return
			}

			req = req.WithContext(ContextWithLocationID(ctx, locationID))
			next.ServeHTTP(w, req)
		})
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// canonicalHost strips the port from the Host header value and lowercases it.
func canonicalHost(hostHeader string) string {
	if hostHeader == "" {
		return ""
	}
	// Handle "host:port" form.
	if idx := strings.LastIndex(hostHeader, ":"); idx != -1 {
		// Make sure it's not an IPv6 literal "[::1]:8080".
		if hostHeader[0] != '[' {
			hostHeader = hostHeader[:idx]
		}
	}
	return strings.ToLower(strings.TrimSpace(hostHeader))
}

// isNotFound reports whether err signals a missing-row condition.
func isNotFound(err error) bool {
	return err != nil && err.Error() == customdomains.ErrNotFound.Error()
}
