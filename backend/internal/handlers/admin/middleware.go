// Package admin exposes BeepBite internal platform-ops endpoints, gated
// behind RequirePlatformAdmin. All queries run under db.ServiceRoleScope so
// they span all tenants; RequirePlatformAdmin is the sole security boundary.
package admin

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// RequirePlatformAdmin is a chi middleware that must run after auth.Middleware
// (which attaches JWT claims). It looks up auth_users.is_platform_admin for
// the caller under service-role scope (bypasses RLS) and returns 403 if the
// flag is false or the user row is absent.
//
// On success the handler chain continues unchanged. Downstream handlers obtain
// the caller's UserID from auth.ClaimsFrom(r.Context()) and run their own DB
// queries under db.ServiceRoleScope for cross-tenant access.
func RequirePlatformAdmin(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := auth.ClaimsFrom(r.Context())
			if !ok || claims.UserID == "" {
				writeErr(w, http.StatusUnauthorized, "missing auth claims")
				return
			}

			isAdmin, err := checkPlatformAdmin(r.Context(), pool, claims.UserID)
			if err != nil {
				writeErr(w, http.StatusInternalServerError, "admin check failed")
				return
			}
			if !isAdmin {
				writeErr(w, http.StatusForbidden, "platform admin access required")
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// checkPlatformAdmin returns true when the auth_users row for userID has
// is_platform_admin = true. The query runs under service-role scope so it
// bypasses the "id = current_user_id()" RLS policy on auth_users.
// A missing user row (deleted between JWT issuance and this call) returns
// (false, nil) — treated as not-an-admin, never as an error.
func checkPlatformAdmin(ctx context.Context, pool *pgxpool.Pool, userID string) (bool, error) {
	var isAdmin bool
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT is_platform_admin FROM auth_users WHERE id = $1`,
			userID,
		).Scan(&isAdmin)
	})
	if err != nil {
		// pgx.ErrNoRows means the user was deleted — deny without an error.
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return isAdmin, nil
}
