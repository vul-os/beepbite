// Package apikeys — database access for API-key management (Wave 22).
//
// Schema (migration 007 + 027): table api_keys with columns:
//
//	id, org_id, name, prefix_visible, key_hash (bcrypt),
//	scopes text[], environment ('live'|'test'), expires_at, last_used_at,
//	created_by, revoked_at, created_at, updated_at.
package apikeys

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors for HTTP-layer status-code mapping.
var (
	ErrKeyNotFound = errors.New("api key not found")
)

// APIKey mirrors an api_keys row. key_hash is never returned; full plaintext
// is returned only at creation time (CreateResult). The NEVER-retrievable
// hash stays in the DB only.
type APIKey struct {
	ID            string     `json:"id"`
	OrganizationID string    `json:"organization_id"`
	Name          string     `json:"name"`
	PrefixVisible string     `json:"prefix_visible"`
	Scopes        []string   `json:"scopes"`
	Environment   string     `json:"environment"`
	ExpiresAt     *time.Time `json:"expires_at"`
	LastUsedAt    *time.Time `json:"last_used_at"`
	CreatedBy     *string    `json:"created_by"`
	RevokedAt     *time.Time `json:"revoked_at"`
	CreatedAt     time.Time  `json:"created_at"`
}

// CreateResult is returned from POST /api-keys. It embeds the APIKey row plus
// the full plaintext key which is shown ONCE and never stored.
type CreateResult struct {
	APIKey
	// PlaintextKey is the full key (e.g. bb_live_<32chars>). It is shown
	// exactly once at creation time; no endpoint can retrieve it again.
	PlaintextKey string `json:"key"`
}

// Store wraps pgxpool for all API-key queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const keyCols = `id, org_id, name, prefix_visible, scopes, environment,
	expires_at, last_used_at, created_by, revoked_at, created_at`

func scanKey(row pgx.Row, k *APIKey) error {
	return row.Scan(
		&k.ID, &k.OrganizationID, &k.Name, &k.PrefixVisible,
		&k.Scopes, &k.Environment,
		&k.ExpiresAt, &k.LastUsedAt, &k.CreatedBy, &k.RevokedAt, &k.CreatedAt,
	)
}

// InsertKey persists a new API key row.  The caller has already generated the
// plaintext key, bcrypt-hashed it, and computed the visible prefix.
func (s *Store) InsertKey(
	ctx context.Context,
	orgID, name, prefixVisible, keyHash, environment string,
	scopes []string,
	expiresAt *time.Time,
	createdBy string,
) (*APIKey, error) {
	var k APIKey
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return scanKey(tx.QueryRow(ctx, `
INSERT INTO api_keys
	(org_id, name, prefix_visible, key_hash, scopes, environment, expires_at, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING `+keyCols,
			orgID, name, prefixVisible, keyHash, scopes, environment,
			nullTime(expiresAt), nullStr(createdBy),
		), &k)
	})
	if err != nil {
		return nil, err
	}
	return &k, nil
}

// ListKeys returns all api_keys rows for orgID (never the hash), newest first.
func (s *Store) ListKeys(ctx context.Context, orgID string) ([]APIKey, error) {
	out := []APIKey{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+keyCols+`
			   FROM api_keys
			  WHERE org_id = $1
			  ORDER BY created_at DESC`, orgID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var k APIKey
			if err := scanKey(rows, &k); err != nil {
				return err
			}
			out = append(out, k)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RevokeKey sets revoked_at = now() for a key that belongs to orgID.
// Returns ErrKeyNotFound when no matching, un-revoked row exists.
func (s *Store) RevokeKey(ctx context.Context, orgID, keyID string) error {
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
UPDATE api_keys
   SET revoked_at = now()
 WHERE id = $1
   AND org_id = $2
   AND revoked_at IS NULL`, keyID, orgID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrKeyNotFound
		}
		return nil
	})
	return err
}

// --- helpers ---

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}
