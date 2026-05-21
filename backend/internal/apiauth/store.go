// Package apiauth — API-key authentication for external callers (Wave 22).
//
// Schema (migration 007 + 027 — api_keys table):
//
//	CREATE TABLE api_keys (
//	    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
//	    org_id           uuid NOT NULL REFERENCES organizations(id),
//	    key_hash         text NOT NULL,          -- bcrypt hash of the full key
//	    prefix_visible   text NOT NULL,          -- first ~12 chars, stored in clear
//	    scopes           text[] NOT NULL DEFAULT '{}',
//	    environment      text NOT NULL DEFAULT 'live',
//	    expires_at       timestamptz,
//	    last_used_at     timestamptz,
//	    revoked_at       timestamptz,
//	    created_at       timestamptz NOT NULL DEFAULT now(),
//	    updated_at       timestamptz NOT NULL DEFAULT now()
//	);
//
// All lookups run as service_role (same pattern as internal/staffauth/store.go)
// because api_keys is outside RLS tenant context — the key IS the identity.
// The WHERE clause (prefix_visible = $1) is the security boundary for the
// initial fan-out; bcrypt comparison then narrows it to a single valid key.
package apiauth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrKeyNotFound is returned when no api_key row matches the presented prefix.
var ErrKeyNotFound = errors.New("api key not found")

// ErrKeyRevoked is returned when a matching key has been revoked.
var ErrKeyRevoked = errors.New("api key has been revoked")

// ErrKeyExpired is returned when a matching key is past its expiry.
var ErrKeyExpired = errors.New("api key has expired")

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

// apiKeyRow is the subset of api_keys columns needed by the middleware.
type apiKeyRow struct {
	ID             string
	OrganizationID string
	KeyHash        string   // bcrypt hash
	Scopes         []string // e.g. ["write:orders","read:menu"]
	RevokedAt      *time.Time
	ExpiresAt      *time.Time
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store provides database operations for API key lookups.
// It always uses db.ServiceRoleScope() — the key itself is the credential.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store backed by the given connection pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// GetByPrefix returns all api_keys rows whose prefix_visible equals the given
// prefix. Multiple rows can match a prefix in theory (very unlikely in practice
// but the caller MUST bcrypt-compare all of them). Runs as service_role so
// FORCE RLS on api_keys does not hide rows.
func (s *Store) GetByPrefix(ctx context.Context, prefix string) ([]apiKeyRow, error) {
	var out []apiKeyRow
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Match the row whose stored prefix_visible is a prefix of the presented
		// full key. This is robust to the exact prefix length the key-management
		// handler chose to store (it stores ~16 chars), instead of assuming one.
		rows, err := tx.Query(ctx,
			`SELECT id, org_id, key_hash, scopes, revoked_at, expires_at
			   FROM api_keys
			  WHERE $1 LIKE prefix_visible || '%'`,
			prefix,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r apiKeyRow
			if err := rows.Scan(
				&r.ID,
				&r.OrganizationID,
				&r.KeyHash,
				&r.Scopes,
				&r.RevokedAt,
				&r.ExpiresAt,
			); err != nil {
				return err
			}
			out = append(out, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, ErrKeyNotFound
	}
	return out, nil
}

// StampLastUsed updates last_used_at for the given key ID. Best-effort: errors
// are silently discarded. Intended to be called in a goroutine.
func (s *Store) StampLastUsed(ctx context.Context, keyID string) {
	// Use a background context so a cancelled request context doesn't abort
	// the update — we want this to fire even after the response is sent.
	bgCtx := context.Background()
	_ = db.Scoped(bgCtx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(bgCtx,
			`UPDATE api_keys SET last_used_at = now(), updated_at = now() WHERE id = $1`,
			keyID,
		)
		return err
	})
}
