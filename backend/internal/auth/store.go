package auth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// withServiceTx runs fn inside a transaction with the service-role session
// variable set, bypassing tenant RLS. Auth flows (signup, signin, refresh)
// run before any tenant identity exists; they must operate at service level.
func (s *Store) withServiceTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), fn)
}

var (
	ErrUserExists        = errors.New("user already exists")
	ErrInvalidCredential = errors.New("invalid email or password")
	ErrUserNotFound      = errors.New("user not found")
	ErrRefreshInvalid    = errors.New("refresh token invalid or revoked")
	ErrRefreshReused     = errors.New("refresh token reused")
)

type User struct {
	ID            string
	Email         string
	PasswordHash  *string
	GoogleSub     *string
	EmailVerified bool
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

func (s *Store) CreateEmailUser(ctx context.Context, email, passwordHash string, meta map[string]any) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	metaJSON, err := jsonBytes(meta)
	if err != nil {
		return nil, err
	}
	var u User
	err = s.withServiceTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO auth_users (email, password_hash, raw_user_meta_data)
VALUES ($1, $2, $3::jsonb)
RETURNING id, email, password_hash, google_sub, email_verified
`, email, passwordHash, string(metaJSON)).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.GoogleSub, &u.EmailVerified)
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrUserExists
		}
		return nil, err
	}
	return &u, nil
}

// UpsertGoogleUser looks up by google_sub first, falling back to email.
// Returns the resulting user record.
func (s *Store) UpsertGoogleUser(ctx context.Context, email, googleSub string, meta map[string]any) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	metaJSON, err := jsonBytes(meta)
	if err != nil {
		return nil, err
	}

	var u User
	if err := s.withServiceTx(ctx, func(tx pgx.Tx) error {
		qerr := tx.QueryRow(ctx, `
SELECT id, email, password_hash, google_sub, email_verified
FROM auth_users
WHERE google_sub = $1 OR lower(email) = $2
LIMIT 1
`, googleSub, email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.GoogleSub, &u.EmailVerified)

		switch {
		case errors.Is(qerr, pgx.ErrNoRows):
			return tx.QueryRow(ctx, `
INSERT INTO auth_users (email, google_sub, email_verified, raw_user_meta_data)
VALUES ($1, $2, true, $3::jsonb)
RETURNING id, email, password_hash, google_sub, email_verified
`, email, googleSub, string(metaJSON)).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.GoogleSub, &u.EmailVerified)
		case qerr != nil:
			return qerr
		default:
			if u.GoogleSub == nil || *u.GoogleSub != googleSub {
				if _, qerr := tx.Exec(ctx, `
UPDATE auth_users
SET google_sub = $1, email_verified = true, updated_at = now()
WHERE id = $2
`, googleSub, u.ID); qerr != nil {
					return qerr
				}
				u.GoogleSub = &googleSub
				u.EmailVerified = true
			}
			return nil
		}
	}); err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) FindByEmail(ctx context.Context, email string) (*User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var u User
	err := s.withServiceTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, email, password_hash, google_sub, email_verified
FROM auth_users
WHERE lower(email) = $1
`, email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.GoogleSub, &u.EmailVerified)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return &u, err
}

func (s *Store) FindByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := s.withServiceTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, email, password_hash, google_sub, email_verified
FROM auth_users
WHERE id = $1
`, id).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.GoogleSub, &u.EmailVerified)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	return &u, err
}

func (s *Store) RecordSignIn(ctx context.Context, userID string) {
	_ = s.withServiceTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE auth_users SET last_sign_in_at = now() WHERE id = $1`, userID)
		return err
	})
}

// --- Refresh tokens ---

func (s *Store) InsertRefreshToken(ctx context.Context, userID, tokenHash, userAgent string, ttl time.Duration) (string, error) {
	var id string
	err := s.withServiceTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
VALUES ($1, $2, now() + $3::interval, $4)
RETURNING id
`, userID, tokenHash, ttl.String(), nullString(userAgent)).Scan(&id)
	})
	return id, err
}

type RefreshRow struct {
	ID         string
	UserID     string
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	ReplacedBy *string
}

func (s *Store) FindRefresh(ctx context.Context, tokenHash string) (*RefreshRow, error) {
	var r RefreshRow
	err := s.withServiceTx(ctx, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, user_id, expires_at, revoked_at, replaced_by
FROM refresh_tokens
WHERE token_hash = $1
`, tokenHash).Scan(&r.ID, &r.UserID, &r.ExpiresAt, &r.RevokedAt, &r.ReplacedBy)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRefreshInvalid
	}
	return &r, err
}

// RotateRefresh revokes the current token and inserts a new one atomically.
// Returns the new row id.
func (s *Store) RotateRefresh(ctx context.Context, oldID, userID, newHash, userAgent string, ttl time.Duration) (string, error) {
	var newID string
	err := s.withServiceTx(ctx, func(tx pgx.Tx) error {
		if qerr := tx.QueryRow(ctx, `
INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
VALUES ($1, $2, now() + $3::interval, $4)
RETURNING id
`, userID, newHash, ttl.String(), nullString(userAgent)).Scan(&newID); qerr != nil {
			return qerr
		}
		_, qerr := tx.Exec(ctx, `
UPDATE refresh_tokens
SET revoked_at = now(), replaced_by = $1
WHERE id = $2
`, newID, oldID)
		return qerr
	})
	if err != nil {
		return "", err
	}
	return newID, nil
}

// RevokeRefresh marks a token as revoked without rotating.
func (s *Store) RevokeRefresh(ctx context.Context, tokenHash string) error {
	return s.withServiceTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE refresh_tokens
SET revoked_at = now()
WHERE token_hash = $1 AND revoked_at IS NULL
`, tokenHash)
		return err
	})
}

// RevokeAllForUser revokes every outstanding refresh for a user (used when we
// detect reuse — treat it as a session compromise).
func (s *Store) RevokeAllForUser(ctx context.Context, userID string) {
	_ = s.withServiceTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
			userID)
		return err
	})
}
