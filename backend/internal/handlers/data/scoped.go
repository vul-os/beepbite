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
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/sync/emit"
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

// runScopedEmitting is runScoped plus multi-branch replication: fn records the
// row-level writes it makes, and the operations for them are written to
// sync_ops inside the SAME transaction, then admitted to this node's replica
// after it commits.
//
// This is where the emit layer meets the write path, and this handler is where
// it meets it FIRST because it is the one genuine chokepoint in this backend:
// three functions — insert, update, delete — cover about a hundred tables. The
// ~343 hand-written statements in internal/handlers/*/store.go have no such
// seam and are converted one at a time through emit.Emitter.Scoped, which has
// exactly this shape.
//
// h.emitter is nil unless a deployment configures sync, and a nil *emit.Emitter
// runs the transaction and emits nothing — so this is a no-op for every install
// that never enrols a peer, and internal/sync/emit's wiring test asserts that
// cmd/server still does not link the engine.
func (h *Handler) runScopedEmitting(ctx context.Context, r *http.Request, fn func(tx pgx.Tx, rec *emit.Recorder) error) error {
	return h.emitter.Scoped(ctx, h.pool, scopeForRequest(r), fn)
}

// record notes a set of rows the generic layer just wrote.
//
// cols is the columns the write NAMED — nil for an insert, which asserts the
// whole row, and the PATCH body's keys for an update, which asserts only what
// it changed. See emit.Touched for why the distinction matters: republishing
// every column of a row on a one-column edit would outrank a concurrent edit
// from another branch to a column this write never touched.
func record(rec *emit.Recorder, table string, kind emit.Kind, rows []map[string]any, cols []string) {
	for _, row := range rows {
		rec.Record(emit.Change{
			Table: table,
			Kind:  kind,
			Row:   emit.Touched(table, row, cols),
		})
	}
}

// keysOf returns a PATCH body's column names, sorted so the operations one
// update emits are minted in a stable order.
func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
