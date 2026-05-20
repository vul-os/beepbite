package data

// Scoped-query helpers for the data handler. Wraps each pool query in a
// transaction with the request's session vars set (via db.Scoped), so RLS
// policies see app.current_user_id / app.current_org_id / etc.
//
// Before this layer existed the handler used h.pool.Query directly, which
// ran against a connection with NO session vars set. Postgres helper
// functions (current_user_id(), current_org_id(), is_service_role(),
// is_marketplace_role()) all returned NULL/false, every USING clause
// evaluated to false, and queries either returned 0 rows (SELECTs) or
// "new row violates row-level security policy" errors (INSERTs).

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// scopeForRequest extracts the db.Scope injected by the RequireOrgScope
// middleware. When the user has no resolved org (fresh signup), the scope's
// UserID is still set from auth.Claims so RLS policies that gate on
// current_user_id() work for self-read / self-onboard cases.
func scopeForRequest(r *http.Request) db.Scope {
	s := db.ScopeFromContext(r.Context())
	if s.UserID == "" {
		if claims, ok := auth.ClaimsFrom(r.Context()); ok && claims != nil {
			s.UserID = claims.UserID
		}
	}
	return s
}

// runScoped wraps fn in a db.Scoped transaction using the request's scope.
func (h *Handler) runScoped(ctx context.Context, r *http.Request, fn func(tx pgx.Tx) error) error {
	return db.Scoped(ctx, h.pool, scopeForRequest(r), fn)
}
