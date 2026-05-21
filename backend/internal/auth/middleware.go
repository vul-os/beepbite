package auth

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey int

const claimsKey ctxKey = 1

// Middleware validates the Authorization bearer token and puts the Claims
// into the request context. Handlers use ClaimsFrom(ctx) to read them.
func Middleware(svc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearer(r)
			if token == "" {
				http.Error(w, "missing bearer token", http.StatusUnauthorized)
				return
			}
			claims, err := svc.VerifyAccess(token)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			// Audience boundary: member/owner email-auth tokens carry NO audience.
			// Staff ("staff"), actor-overlay ("actor-overlay") and elevation
			// ("manager-elevation") tokens are signed with the same secret but are
			// NOT valid as a member bearer — reject them here so a staff JWT can't
			// reach member endpoints (defense against audience-claim confusion).
			if len(claims.Audience) > 0 {
				http.Error(w, "invalid token audience", http.StatusUnauthorized)
				return
			}
			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Optional does not reject anonymous requests; it only attaches claims when
// present. Useful for public endpoints that behave slightly differently when
// a user is signed in.
func Optional(svc *Service) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if token := bearer(r); token != "" {
				if claims, err := svc.VerifyAccess(token); err == nil {
					r = r.WithContext(context.WithValue(r.Context(), claimsKey, claims))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func ClaimsFrom(ctx context.Context) (*Claims, bool) {
	c, ok := ctx.Value(claimsKey).(*Claims)
	return c, ok
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		// EventSource compatibility: browsers cannot set headers, so fall back to ?token= query param.
		if t := r.URL.Query().Get("token"); t != "" {
			return t
		}
		return ""
	}
	return strings.TrimSpace(h[len("Bearer "):])
}
