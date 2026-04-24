package staffauth

import (
	"context"
	"net/http"
	"strings"
)

type ctxKey int

const claimsKey ctxKey = 1

// RequireStaff validates the Authorization bearer token and attaches the
// resulting *StaffClaims to the request context. Handlers use FromContext
// to read them. Mirrors auth.Middleware in shape, but scoped to staff tokens
// (audience check happens inside VerifyAccess).
func RequireStaff(svc *Service) func(http.Handler) http.Handler {
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
			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func FromContext(ctx context.Context) (*StaffClaims, bool) {
	c, ok := ctx.Value(claimsKey).(*StaffClaims)
	return c, ok
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(h[len("Bearer "):])
}
