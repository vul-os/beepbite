package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Context key
// ---------------------------------------------------------------------------

type scopeContextKey struct{}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

// Scope captures the session-variable values for a single request.
// Each field maps to one of the app.* Postgres session variables
// that the RLS helper functions (in migration 001) read:
//
//	app.current_user_id       — auth_users.id of the authenticated member
//	app.current_org_id        — organization the request is scoped to
//	app.current_capabilities  — organization_members.capabilities jsonb
//	app.current_actor_id      — staff doing the action (PIN overlay)
//	app.is_service_role       — 'true' for system-level jobs
//	app.is_marketplace_role   — 'true' for public marketplace reads
//
// UUID fields are plain strings matching Postgres uuid type (e.g. "aaaabbbb-...").
// An empty string is written to Postgres, which causes the SQL helper function
// to return NULL via nullif(”, ”)::uuid → all RLS policies evaluate to false.
// This is the safe default for unauthenticated or improperly scoped connections.
type Scope struct {
	UserID        string // app.current_user_id  (UUID string or "")
	OrgID         string // app.current_org_id   (UUID string or "")
	Capabilities  []byte // app.current_capabilities (JSON-encoded jsonb)
	ActorID       string // app.current_actor_id (UUID string or "")
	IsServiceRole bool   // app.is_service_role
	IsMarketplace bool   // app.is_marketplace_role
}

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

// ServiceRoleScope returns a Scope that bypasses tenant RLS.
// Use for background jobs, the migration runner, and admin scripts.
// Never expose this scope on a path that processes untrusted input.
func ServiceRoleScope() Scope {
	return Scope{IsServiceRole: true}
}

// MarketplaceScope returns a Scope for anonymous public marketplace reads.
// Only tables with a marketplace_role SELECT policy are visible.
func MarketplaceScope() Scope {
	return Scope{IsMarketplace: true}
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

// ContextWithScope injects a Scope into a context. Call this in auth
// middleware after resolving the JWT and loading org membership.
func ContextWithScope(ctx context.Context, s Scope) context.Context {
	return context.WithValue(ctx, scopeContextKey{}, s)
}

// ScopeFromContext extracts a Scope from a context. Returns a zero Scope
// (all empty fields → empty session vars → zero visible rows) if no scope
// has been injected.
func ScopeFromContext(ctx context.Context) Scope {
	if s, ok := ctx.Value(scopeContextKey{}).(Scope); ok {
		return s
	}
	return Scope{}
}

// ---------------------------------------------------------------------------
// Scoped: transaction + session-variable injection
// ---------------------------------------------------------------------------

// Scoped runs fn inside a transaction with all session variables set according
// to scope. It:
//
//  1. Begins a transaction.
//  2. Calls setSessionVars(tx, scope) to SET LOCAL the six app.* variables.
//  3. Calls fn(tx).
//  4. Commits on success; rolls back on any error.
//
// The deferred Rollback is a no-op after a successful Commit.
// The caller must not call Commit or Rollback on tx directly.
func Scoped(ctx context.Context, pool *pgxpool.Pool, scope Scope, fn func(tx pgx.Tx) error) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("db.Scoped begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := setSessionVars(ctx, tx, scope); err != nil {
		return fmt.Errorf("db.Scoped set session vars: %w", err)
	}

	if err := fn(tx); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("db.Scoped commit: %w", err)
	}
	return nil
}

// setSessionVars writes all six app.* session variables into the transaction
// using SET LOCAL (transaction-scoped only).
//
// Every variable is always written — even zero/empty values — to prevent
// ambiguity between "variable never set" and "variable set to empty".
// An empty string causes the SQL helper function to return NULL, which makes
// all RLS predicates evaluate to false.
func setSessionVars(ctx context.Context, tx pgx.Tx, s Scope) error {
	vars := []struct {
		name  string
		value string
	}{
		{"app.current_user_id", s.UserID},
		{"app.current_org_id", s.OrgID},
		{"app.current_capabilities", capabilitiesToStr(s.Capabilities)},
		{"app.current_actor_id", s.ActorID},
		{"app.is_service_role", boolToStr(s.IsServiceRole)},
		{"app.is_marketplace_role", boolToStr(s.IsMarketplace)},
	}

	for _, v := range vars {
		// set_config(name, value, is_local=true) — local to the current transaction.
		if _, err := tx.Exec(ctx,
			`SELECT set_config($1, $2, true)`,
			v.name, v.value,
		); err != nil {
			return fmt.Errorf("set_config(%q): %w", v.name, err)
		}
	}
	return nil
}

// WithTxServiceRole elevates app.is_service_role to true for the duration of fn
// inside an already-open transaction, then restores it to false. Use it to wrap
// an append-only audit_log insert inside an otherwise tenant-scoped transaction:
// migration 013 restricts audit_log INSERT to service_role (so a compromised
// tenant session cannot forge audit entries), while the surrounding data
// mutations must stay under tenant RLS. The toggle is transaction-local
// (set_config is_local=true), so it never leaks past commit/rollback.
func WithTxServiceRole(ctx context.Context, tx pgx.Tx, fn func() error) error {
	if _, err := tx.Exec(ctx, `SELECT set_config('app.is_service_role', 'true', true)`); err != nil {
		return fmt.Errorf("elevate service role: %w", err)
	}
	if err := fn(); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.is_service_role', '', true)`); err != nil {
		return fmt.Errorf("restore tenant scope: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// capabilitiesToStr converts a JSON byte slice to a string for the session var.
// Returns '{}' (empty JSON object) for nil/empty input so current_capabilities()
// and has_capability() never receive a NULL jsonb parse error.
func capabilitiesToStr(b []byte) string {
	if len(b) == 0 {
		return "{}"
	}
	return string(b)
}

// boolToStr converts a bool to 'true' or ” (empty string → SQL NULL via nullif).
func boolToStr(b bool) string {
	if b {
		return "true"
	}
	return ""
}
