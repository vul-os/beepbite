// Package userprefs manages per-user workspace view preferences.
//
// DB table: user_preferences (migration 041_user_preferences.sql)
//
//	user_preferences(profile_id pk references profiles,
//	                 last_view_pos text, last_view_kds text, updated_at)
//
// RLS: each row is readable/writable only by the owning profile or service_role.
// The Store runs under a user-scoped db.Scope so RLS is enforced automatically.
package userprefs

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

// ErrNotFound is returned when no preference row exists for the caller.
var ErrNotFound = errors.New("user_preferences: not found")

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

// Prefs is the data-transfer object for GET /me/preferences and
// PUT /me/preferences responses.
type Prefs struct {
	ProfileID   string    `json:"profile_id"`
	LastViewPOS *string   `json:"last_view_pos"`
	LastViewKDS *string   `json:"last_view_kds"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// UpdateReq carries the fields the caller may change via PUT.
// Both fields are optional — supply only those you want to update.
type UpdateReq struct {
	LastViewPOS *string `json:"last_view_pos"`
	LastViewKDS *string `json:"last_view_kds"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store wraps the DB pool for user_preferences queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

// Get returns the preference row for profileID.
// The query runs under a user-scoped db.Scope (UserID set to profileID) so
// RLS lets the caller see only their own row.
// Returns ErrNotFound when no row exists yet.
func (s *Store) Get(ctx context.Context, profileID string) (*Prefs, error) {
	scope := db.Scope{UserID: profileID}

	var out Prefs
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT profile_id, last_view_pos, last_view_kds, updated_at
			FROM user_preferences
			WHERE profile_id = $1
		`, profileID).Scan(
			&out.ProfileID,
			&out.LastViewPOS,
			&out.LastViewKDS,
			&out.UpdatedAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

// Upsert inserts or updates the preference row for profileID.
// Only non-nil fields in req are changed; a nil field leaves the existing
// column value untouched (via COALESCE).
// Runs under a user-scoped db.Scope so RLS enforces ownership.
func (s *Store) Upsert(ctx context.Context, profileID string, req UpdateReq) (*Prefs, error) {
	scope := db.Scope{UserID: profileID}

	var out Prefs
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO user_preferences (profile_id, last_view_pos, last_view_kds)
			VALUES ($1, $2, $3)
			ON CONFLICT (profile_id) DO UPDATE
			SET last_view_pos = COALESCE($2, user_preferences.last_view_pos),
			    last_view_kds = COALESCE($3, user_preferences.last_view_kds),
			    updated_at    = timezone('utc', now())
			RETURNING profile_id, last_view_pos, last_view_kds, updated_at
		`, profileID, req.LastViewPOS, req.LastViewKDS,
		).Scan(
			&out.ProfileID,
			&out.LastViewPOS,
			&out.LastViewKDS,
			&out.UpdatedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}
