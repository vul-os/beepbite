// Package auth — actor-overlay middleware (T9.3).
//
// ActorOverlay reads either the X-Actor-Token request header or the
// actor_token query parameter (fallback for screen readers / EventSource
// clients that cannot set headers). When the token is valid it extends the
// db.Scope already in context with ActorID + Capabilities and attaches actor
// context values consumable via ActorIDFromContext / ActorCapabilities.
//
// On parse failure (expired, bad signature, missing) the middleware passes the
// request through silently — member identity injected by auth.Middleware is
// preserved. The endpoint or a downstream RequireCapability middleware decides
// whether an actor overlay is required.
//
// Wire order (authed+scoped sub-group):
//
//	auth.Middleware(svc) → auth.RequireOrgScope(pool) → auth.ActorOverlay(secret)
package auth

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/golang-jwt/jwt/v5"
)

// ---------------------------------------------------------------------------
// Actor token claims
// ---------------------------------------------------------------------------

// actorAudience is the JWT audience that distinguishes actor-overlay tokens
// from staff-session tokens (audience "staff") and email-auth tokens (no aud).
// A stolen staff JWT cannot be submitted as an actor-overlay token and vice-versa.
const actorAudience = "actor-overlay"

// ActorClaims are the payload fields in an actor-overlay JWT issued by
// POST /pos/pin-verify (T9.2).
//
// MemberID   — the authenticated org-member who initiated the PIN verify;
//
//	matches auth.Claims.UserID for the session.
//
// StaffID    — the staff row whose PIN was verified; becomes db.Scope.ActorID.
// LocationID — the location the staff row belongs to (scope check).
// Capabilities — the staff row's capability set; overrides the member's for
//
//	the duration of the request.
type ActorClaims struct {
	MemberID     string   `json:"member_id"`
	StaffID      string   `json:"staff_id"`
	LocationID   string   `json:"location_id"`
	Capabilities []string `json:"capabilities"`
	jwt.RegisteredClaims
}

// ParseActorToken validates the signature, expiry, and audience of an
// actor-overlay JWT. Returns an error on any failure; callers treat errors
// as "no overlay" (pass-through).
func ParseActorToken(token string, secret []byte) (*ActorClaims, error) {
	claims := &ActorClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("actor token: unexpected signing method %v", t.Header["alg"])
		}
		return secret, nil
	}, jwt.WithAudience(actorAudience))
	if err != nil {
		return nil, err
	}
	if claims.StaffID == "" {
		return nil, fmt.Errorf("actor token: missing staff_id")
	}
	return claims, nil
}

// IssueActorToken signs a short-lived actor-overlay JWT. Called by the
// POST /pos/pin-verify handler (T9.2) after a successful PIN check.
func IssueActorToken(memberID, staffID, locationID string, capabilities []string, secret []byte, ttl time.Duration) (string, time.Time, error) {
	now := time.Now().UTC()
	exp := now.Add(ttl)
	claims := ActorClaims{
		MemberID:     memberID,
		StaffID:      staffID,
		LocationID:   locationID,
		Capabilities: capabilities,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   staffID,
			Audience:  jwt.ClaimStrings{actorAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString(secret)
	if err != nil {
		return "", time.Time{}, err
	}
	return s, exp, nil
}

// ---------------------------------------------------------------------------
// Context keys + values
// ---------------------------------------------------------------------------

type actorCtxKey struct{}

// actorOverlay holds the resolved actor identity injected into context.
type actorOverlay struct {
	staffID      string
	capabilities []string
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// ActorOverlay returns an HTTP middleware that reads an actor-overlay token
// (from X-Actor-Token header or actor_token query param), parses it with the
// given secret, and on success:
//
//   - Stores the actor overlay in context (accessible via ActorIDFromContext /
//     ActorCapabilities).
//   - Replaces db.Scope.ActorID with the staff_id from the token.
//   - Replaces db.Scope.Capabilities with the JSON encoding of the overlay's
//     capabilities, so RLS session vars reflect the actor's rights.
//
// On any error (missing header, expired token, bad signature) the request
// passes through unchanged — member identity from auth.Middleware is preserved
// and ActorIDFromContext returns an empty string.
//
// Chain after auth.Middleware + auth.RequireOrgScope:
//
//	r.Use(auth.Middleware(svc))
//	r.Use(auth.RequireOrgScope(pool))
//	r.Use(auth.ActorOverlay([]byte(cfg.JWTSecret)))
func ActorOverlay(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := r.Header.Get("X-Actor-Token")
			if raw == "" {
				raw = r.URL.Query().Get("actor_token")
			}

			if raw != "" {
				if claims, err := ParseActorToken(raw, secret); err == nil {
					// Extend the existing db.Scope with actor identity + capabilities.
					scope := db.ScopeFromContext(r.Context())
					scope.ActorID = claims.StaffID
					scope.Capabilities = capabilitiesSliceToJSON(claims.Capabilities)

					// Store the overlay for ActorIDFromContext / ActorCapabilities.
					overlay := actorOverlay{
						staffID:      claims.StaffID,
						capabilities: claims.Capabilities,
					}

					ctx := r.Context()
					ctx = db.ContextWithScope(ctx, scope)
					ctx = context.WithValue(ctx, actorCtxKey{}, overlay)
					r = r.WithContext(ctx)
				}
				// On error: silently pass through — no 401.
			}

			next.ServeHTTP(w, r)
		})
	}
}

// ---------------------------------------------------------------------------
// Public context accessors
// ---------------------------------------------------------------------------

// ActorIDFromContext returns the staff_id from a valid actor-overlay token, or
// an empty string when no overlay is present.
func ActorIDFromContext(ctx context.Context) string {
	if o, ok := ctx.Value(actorCtxKey{}).(actorOverlay); ok {
		return o.staffID
	}
	return ""
}

// ActorCapabilities returns the capabilities active for this request:
//   - If an actor overlay is present, returns the overlay's capabilities.
//   - Otherwise falls back to the member capabilities from auth.Capabilities(ctx).
func ActorCapabilities(ctx context.Context) []string {
	if o, ok := ctx.Value(actorCtxKey{}).(actorOverlay); ok {
		return o.capabilities
	}
	return Capabilities(ctx)
}

// HasCapability reports whether the active capabilities (overlay or member)
// include the named capability key.
func HasCapability(ctx context.Context, cap string) bool {
	for _, c := range ActorCapabilities(ctx) {
		if c == cap {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// capabilitiesSliceToJSON converts []string → JSON bytes for db.Scope.Capabilities.
// The format {"cap1":true,"cap2":true,...} matches the organization_members.capabilities
// jsonb column shape that RLS helper functions (has_capability) read.
func capabilitiesSliceToJSON(caps []string) []byte {
	if len(caps) == 0 {
		return []byte("{}")
	}
	// Hand-build the JSON to avoid an encoding/json round-trip for what is
	// always a small, ASCII-safe list of capability key strings.
	out := make([]byte, 0, 2+len(caps)*20)
	out = append(out, '{')
	for i, c := range caps {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, '"')
		out = append(out, []byte(c)...)
		out = append(out, '"', ':', 't', 'r', 'u', 'e')
	}
	out = append(out, '}')
	return out
}
