// Package apiauth — API-key authentication middleware (Wave 22).
//
// # Overview
//
// RequireAPIKey is an HTTP middleware that accepts bearer tokens of the form:
//
//	Authorization: Bearer bb_live_<random>
//	Authorization: Bearer bb_test_<random>
//
// When a valid key is found it injects the SAME context values that
// auth.RequireOrgScope injects — an auth.OrgScope and a db.Scope — so all
// existing downstream handlers work without modification.
//
// # Wire order
//
// RequireAPIKey is a standalone middleware; it does NOT require auth.Middleware
// (JWT) to run first. Wire it on routes that should accept API-key callers:
//
//	r.With(apiauth.RequireAPIKey(pool)).Post("/external/orders", h.createOrder)
//
// Or chain it with JWT auth so either credential works:
//
//	r.Use(auth.Middleware(svc))          // sets JWT claims if present
//	r.Use(apiauth.RequireAPIKey(pool))   // overrides with API-key scope if bb_ token
//	r.Use(auth.RequireOrgScope(pool))    // fills scope from JWT if no API key
//
// # Strict 401 behaviour
//
// RequireAPIKey always responds 401 when the Authorization header starts with
// "bb_" but the key is invalid, revoked, or expired. When the header is absent
// or carries a non-bb_ token the middleware returns 401 too — this variant
// is designed for routes that exclusively serve API-key callers.
//
// Use [OptionalAPIKey] (pass-through on missing/non-bb_ header) when you want
// to chain with JWT auth.
//
// # Lookup + verify flow
//
//  1. Extract the raw key from Authorization: Bearer <key>.
//  2. Derive prefix_visible = first prefixLen characters of the key.
//  3. Query api_keys WHERE prefix_visible = $1 via service_role (bypasses RLS).
//  4. bcrypt.CompareHashAndPassword on each candidate until one matches.
//  5. Validate: revoked_at IS NULL, expires_at IS NULL OR expires_at > now().
//  6. Inject auth.OrgScope + db.Scope into the request context.
//  7. Stamp last_used_at asynchronously (best-effort goroutine).
//
// # Scope → Capability mapping
//
// The api_keys.scopes text[] column carries strings like "write:orders".
// ScopeToCapabilities maps each scope string to the canonical capability keys
// used by auth.RequireCapability / auth.HasCapability. A scope may grant
// multiple capabilities.
//
// # HasScope helper
//
// HasScope(ctx, "write:orders") is provided for handlers that need fine-grained
// scope checks beyond the capability system.
package apiauth

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// prefixLen is the number of characters taken from the start of the raw key
// to form prefix_visible. This must match how keys are minted.
const prefixLen = 12

// bearer prefix that identifies API keys (covers both bb_live_ and bb_test_).
const bbPrefix = "bb_"

// ---------------------------------------------------------------------------
// Context keys
// ---------------------------------------------------------------------------

// apiKeyScopesKey carries the raw scopes slice from the matched api_key row.
type apiKeyScopesKey struct{}

// apiKeyIDKey carries the matched key's UUID (for audit / HasScope helpers).
type apiKeyIDKey struct{}

// ---------------------------------------------------------------------------
// Scope → Capability mapping
// ---------------------------------------------------------------------------

// scopeCapabilities maps an API scope string to the set of capability keys it
// grants. These capability keys are the same strings checked by
// auth.RequireCapability and auth.HasCapability on normal member sessions.
//
// Extend this map as new scopes are introduced. A scope may appear in multiple
// entries, and a single scope may grant multiple capabilities.
var scopeCapabilities = map[string][]string{
	// Order operations
	"write:orders": {"can_pos", "can_void", "can_discount", "can_adjust"},
	"read:orders":  {"can_pos"},

	// Menu catalogue
	"write:menu": {"can_manage_menu"},
	"read:menu":  {},

	// Staff / HR
	"write:staff": {"can_manage_staff"},
	"read:staff":  {},

	// Reporting
	"read:reports": {"can_reports"},

	// Kitchen display
	"write:kds": {"can_kds"},
	"read:kds":  {},

	// Cash drawer
	"write:cash": {"can_cash_drawer"},
	"read:cash":  {},

	// Full access (superscope — grants everything)
	"write:*": {
		"can_pos", "can_void", "can_discount", "can_adjust",
		"can_manage_menu", "can_manage_staff", "can_reports",
		"can_kds", "can_cash_drawer",
	},
	"read:*": {
		"can_pos", "can_reports", "can_kds",
	},
}

// ScopeToCapabilities converts a slice of API scope strings to the deduplicated
// set of capability keys they collectively grant.
func ScopeToCapabilities(scopes []string) []string {
	seen := make(map[string]struct{})
	var caps []string
	for _, s := range scopes {
		for _, c := range scopeCapabilities[s] {
			if _, ok := seen[c]; !ok {
				seen[c] = struct{}{}
				caps = append(caps, c)
			}
		}
	}
	return caps
}

// capabilitiesSliceToJSON converts []string capabilities to the JSON object
// format {"cap":true,...} expected by db.Scope.Capabilities and the RLS
// helper function has_capability().
func capabilitiesSliceToJSON(caps []string) []byte {
	if len(caps) == 0 {
		return []byte("{}")
	}
	m := make(map[string]bool, len(caps))
	for _, c := range caps {
		m[c] = true
	}
	b, err := json.Marshal(m)
	if err != nil {
		return []byte("{}")
	}
	return b
}

// ---------------------------------------------------------------------------
// HasScope context helper
// ---------------------------------------------------------------------------

// HasScope reports whether the request context carries an API-key scope that
// exactly matches the given scope string (e.g. "write:orders"). This is
// independent from the capability system and is intended for endpoints that
// need to gate on the raw API scope rather than a derived capability.
//
// Returns false when the context was not populated by RequireAPIKey (e.g. for
// regular JWT sessions — use auth.HasCapability instead).
func HasScope(ctx context.Context, scope string) bool {
	scopes, _ := ctx.Value(apiKeyScopesKey{}).([]string)
	for _, s := range scopes {
		if s == scope {
			return true
		}
	}
	return false
}

// APIKeyIDFromContext returns the UUID of the API key that authenticated this
// request, or an empty string for non-API-key sessions.
func APIKeyIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(apiKeyIDKey{}).(string)
	return id
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// RequireAPIKey returns an HTTP middleware that authenticates requests using
// API keys (Authorization: Bearer bb_...). Returns 401 for any request that
// does not carry a valid, unrevoked, unexpired API key — including requests
// with no Authorization header or a non-bb_ bearer token.
//
// On success it injects into the request context:
//   - auth.OrgScope  (readable via auth.OrgScopeFrom)
//   - db.Scope       (readable via db.ScopeFromContext)
//   - raw scopes     (readable via HasScope)
//   - key ID         (readable via APIKeyIDFromContext)
//
// The injected scope is structurally identical to what auth.RequireOrgScope
// injects, so all existing handlers work unchanged.
func RequireAPIKey(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	store := NewStore(pool)
	return requireAPIKeyWith(store)
}

// OptionalAPIKey is like RequireAPIKey but passes through (calls next) when no
// bb_ bearer token is present. Wire it before auth.RequireOrgScope when a
// route should accept either API-key or JWT callers:
//
//	r.Use(auth.Middleware(svc))
//	r.Use(apiauth.OptionalAPIKey(pool))   // injects scope if bb_ token found
//	r.Use(auth.RequireOrgScope(pool))     // fills scope from JWT if no API key
func OptionalAPIKey(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	store := NewStore(pool)
	return optionalAPIKeyWith(store)
}

// ---------------------------------------------------------------------------
// Testable cores (accept a keyLookup interface)
// ---------------------------------------------------------------------------

// keyLookup abstracts the Store for testing.
type keyLookup interface {
	GetByPrefix(ctx context.Context, prefix string) ([]apiKeyRow, error)
	StampLastUsed(ctx context.Context, keyID string)
}

// writeUnauthorizedJSON emits a 401 with the same {"error": "..."} body every
// other error path in this API returns, rather than http.Error's plain text.
func writeUnauthorizedJSON(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
}

func requireAPIKeyWith(store keyLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, ok := resolveAPIKey(r, store)
			if !ok {
				writeUnauthorizedJSON(w)
				return
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func optionalAPIKeyWith(store keyLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rawKey := extractBearerKey(r)
			if rawKey == "" || !strings.HasPrefix(rawKey, bbPrefix) {
				// Not an API-key request — pass through for JWT auth to handle.
				next.ServeHTTP(w, r)
				return
			}
			ctx, ok := resolveAPIKey(r, store)
			if !ok {
				writeUnauthorizedJSON(w)
				return
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ---------------------------------------------------------------------------
// Core resolve logic (shared by both middleware variants)
// ---------------------------------------------------------------------------

// resolveAPIKey extracts and validates the API key from the request. On
// success it returns a context enriched with OrgScope + db.Scope values and
// true. On any failure (missing header, bad key, revoked, expired) it returns
// nil, false.
func resolveAPIKey(r *http.Request, store keyLookup) (context.Context, bool) {
	rawKey := extractBearerKey(r)
	if rawKey == "" || !strings.HasPrefix(rawKey, bbPrefix) {
		return nil, false
	}

	// Pass the FULL presented key; the store matches the row whose stored
	// prefix_visible is a prefix of it (robust to the stored prefix length).
	ctx := r.Context()

	candidates, err := store.GetByPrefix(ctx, rawKey)
	if err != nil {
		// ErrKeyNotFound or a DB error — treat as invalid.
		if err != ErrKeyNotFound {
			log.Printf("apiauth: prefix lookup error: %v", err)
		}
		return nil, false
	}

	// Find the first candidate whose bcrypt hash matches the presented key.
	var matched *apiKeyRow
	for i := range candidates {
		if err := bcrypt.CompareHashAndPassword(
			[]byte(candidates[i].KeyHash),
			[]byte(rawKey),
		); err == nil {
			matched = &candidates[i]
			break
		}
	}
	if matched == nil {
		return nil, false
	}

	// Validate: not revoked.
	if matched.RevokedAt != nil {
		return nil, false
	}

	// Validate: not expired.
	if matched.ExpiresAt != nil && matched.ExpiresAt.Before(time.Now()) {
		return nil, false
	}

	// Derive capabilities from the key's scopes.
	caps := ScopeToCapabilities(matched.Scopes)
	capsJSON := capabilitiesSliceToJSON(caps)

	// --- Build OrgScope (matches what auth.RequireOrgScope injects) ---
	//
	// The OrgScope for an API key has a single synthetic membership: the
	// organization the key belongs to, with capabilities derived from scopes.
	// We do not know (or need) the location list at this layer — handlers that
	// need location-scoped data will query within the org via db.Scope.OrgID.
	// AllowedLocations is set to nil to preserve the allow-all stub behaviour
	// for backward-compatible handlers (same as a fresh JWT session with no
	// location data yet fetched).
	orgScope := auth.OrgScope{
		// No UserID — API keys are not user-scoped.
		Memberships: []auth.Membership{
			{
				OrgID:        matched.OrganizationID,
				Role:         "api_key",
				Capabilities: capsJSON,
			},
		},
		// LocationIDs left nil — handlers must not rely on AllowsLocation for
		// API-key sessions unless the middleware is extended to fetch them.
		AllowedLocations: nil, // nil == allow-all (stub mode)
	}

	// --- Build db.Scope (matches what auth.RequireOrgScope injects) ---
	//
	// Uses the same fields populated by RequireOrgScope for a single-org user.
	// UserID is left empty because API keys are not user-principals; OrgID is
	// the api_keys.org_id so RLS policies scoped to app.current_org_id
	// allow the request.
	dbScope := db.Scope{
		OrgID:        matched.OrganizationID,
		Capabilities: capsJSON,
	}

	// Inject into context.
	ctx = auth.ContextWithOrgScope(ctx, orgScope)
	ctx = db.ContextWithScope(ctx, dbScope)
	ctx = context.WithValue(ctx, apiKeyScopesKey{}, matched.Scopes)
	ctx = context.WithValue(ctx, apiKeyIDKey{}, matched.ID)

	// Stamp last_used_at asynchronously — best-effort, non-blocking.
	go store.StampLastUsed(context.Background(), matched.ID)

	return ctx, true
}

// ---------------------------------------------------------------------------
// Header extraction
// ---------------------------------------------------------------------------

// extractBearerKey returns the token value from "Authorization: Bearer <tok>",
// or an empty string when the header is absent or malformed.
func extractBearerKey(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if h == "" {
		return ""
	}
	const bearerPrefix = "Bearer "
	if !strings.HasPrefix(h, bearerPrefix) {
		return ""
	}
	tok := strings.TrimSpace(h[len(bearerPrefix):])
	return tok
}
