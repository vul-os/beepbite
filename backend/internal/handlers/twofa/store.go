package twofa

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/secretbox"
)

// Sentinel errors.
var (
	ErrUserNotFound    = errors.New("user not found")
	ErrTOTPNotEnrolled = errors.New("totp not enrolled")
	ErrTOTPAlreadyOn   = errors.New("totp already enabled")
	ErrInvalidCode     = errors.New("invalid or expired totp code")
	ErrNoBox           = errors.New("TOTP_KEY_ENCRYPTION_SECRET not configured")
	ErrBackupCodeUsed  = errors.New("backup code already used")
	ErrBackupCodeBad   = errors.New("backup code not found or already used")
)

// Store wraps pgxpool for all 2FA-related queries.
type Store struct {
	pool *pgxpool.Pool
	box  *secretbox.Box // may be nil if env var unset
}

// NewStore creates a Store. box may be nil, in which case encrypt/decrypt ops
// return ErrNoBox (callers must handle gracefully by returning 503).
func NewStore(pool *pgxpool.Pool, box *secretbox.Box) *Store {
	return &Store{pool: pool, box: box}
}

// ---------------------------------------------------------------------------
// Secret ciphertext helpers
// ---------------------------------------------------------------------------

func (s *Store) encryptSecret(plain string) (string, error) {
	if s.box == nil {
		return "", ErrNoBox
	}
	return s.box.Encrypt(plain)
}

func (s *Store) decryptSecret(ct string) (string, error) {
	if s.box == nil {
		return "", ErrNoBox
	}
	return s.box.Decrypt(ct)
}

// ---------------------------------------------------------------------------
// Pending enroll: store secret (not yet enabled)
// ---------------------------------------------------------------------------

// StorePendingSecret writes the encrypted TOTP secret to auth_users without
// setting totp_enabled. Returns the ciphertext for the handler to send back
// (the handler does NOT need to call encrypt again).
func (s *Store) StorePendingSecret(ctx context.Context, userID, plainSecret string) error {
	ct, err := s.encryptSecret(plainSecret)
	if err != nil {
		return fmt.Errorf("twofa: encrypt secret: %w", err)
	}

	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
UPDATE auth_users
   SET totp_secret_ciphertext = $1,
       totp_enabled            = false
 WHERE id = $2
`, ct, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrUserNotFound
		}
		return nil
	})
}

// LoadPendingSecret returns the decrypted TOTP secret for the given user.
// Returns ErrTOTPNotEnrolled if no secret is stored.
func (s *Store) LoadPendingSecret(ctx context.Context, userID string) (string, error) {
	var ct *string
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT totp_secret_ciphertext FROM auth_users WHERE id = $1`,
			userID,
		).Scan(&ct)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrUserNotFound
	}
	if err != nil {
		return "", err
	}
	if ct == nil || *ct == "" {
		return "", ErrTOTPNotEnrolled
	}
	return s.decryptSecret(*ct)
}

// ---------------------------------------------------------------------------
// Enable TOTP + issue backup codes (atomic)
// ---------------------------------------------------------------------------

// hashBackupCode returns the SHA-256 hex of a raw backup code.
func hashBackupCode(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// generateBackupCode returns an 8-character alphanumeric code.
func generateBackupCode() (string, error) {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // unambiguous chars
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, 8)
	for i, b := range buf {
		out[i] = charset[int(b)%len(charset)]
	}
	return string(out), nil
}

// EnableTOTP marks totp_enabled = true and inserts 8 fresh backup codes.
// Returns the plaintext backup codes (returned to caller exactly once).
// The caller must already have validated the TOTP code before calling this.
func (s *Store) EnableTOTP(ctx context.Context, userID string) ([]string, error) {
	codes := make([]string, 8)
	for i := range codes {
		c, err := generateBackupCode()
		if err != nil {
			return nil, fmt.Errorf("twofa: generate backup code: %w", err)
		}
		codes[i] = c
	}

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// 1. Enable TOTP.
		tag, err := tx.Exec(ctx, `
UPDATE auth_users SET totp_enabled = true WHERE id = $1
`, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrUserNotFound
		}

		// 2. Delete any existing backup codes for this user.
		if _, err := tx.Exec(ctx, `
DELETE FROM user_backup_codes WHERE profile_id = $1
`, userID); err != nil {
			return err
		}

		// 3. Insert new hashed codes.
		for _, c := range codes {
			if _, err := tx.Exec(ctx, `
INSERT INTO user_backup_codes (profile_id, code_hash)
VALUES ($1, $2)
`, userID, hashBackupCode(c)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return codes, nil
}

// ---------------------------------------------------------------------------
// Disable TOTP
// ---------------------------------------------------------------------------

// DisableTOTP clears the TOTP secret and backup codes.
func (s *Store) DisableTOTP(ctx context.Context, userID string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
UPDATE auth_users
   SET totp_secret_ciphertext = NULL,
       totp_enabled            = false
 WHERE id = $1
`, userID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrUserNotFound
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM user_backup_codes WHERE profile_id = $1`, userID,
		); err != nil {
			return err
		}
		return nil
	})
}

// ---------------------------------------------------------------------------
// Backup code redemption
// ---------------------------------------------------------------------------

// RedeemBackupCode marks the first matching unused backup code as used.
// Returns ErrBackupCodeBad if no valid match is found.
func (s *Store) RedeemBackupCode(ctx context.Context, userID, rawCode string) error {
	h := hashBackupCode(rawCode)
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var id string
		err := tx.QueryRow(ctx, `
SELECT id FROM user_backup_codes
 WHERE profile_id = $1
   AND code_hash  = $2
   AND used_at IS NULL
 LIMIT 1
`, userID, h).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrBackupCodeBad
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
UPDATE user_backup_codes
   SET used_at = now()
 WHERE id = $1
`, id)
		return err
	})
}

// ---------------------------------------------------------------------------
// Status query
// ---------------------------------------------------------------------------

// TOTPStatus holds the current TOTP state for a user.
type TOTPStatus struct {
	Enabled     bool `json:"enabled"`
	Enrolled    bool `json:"enrolled"` // secret stored but not yet verified
	BackupCount int  `json:"backup_codes_remaining"`
}

// GetStatus returns the TOTP status for the given user.
func (s *Store) GetStatus(ctx context.Context, userID string) (*TOTPStatus, error) {
	var enabled bool
	var secretCT *string
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT totp_enabled, totp_secret_ciphertext FROM auth_users WHERE id = $1`,
			userID,
		).Scan(&enabled, &secretCT)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, err
	}

	enrolled := secretCT != nil && *secretCT != ""

	var backupCount int
	if enabled {
		_ = db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT COUNT(*) FROM user_backup_codes WHERE profile_id = $1 AND used_at IS NULL`,
				userID,
			).Scan(&backupCount)
		})
	}

	return &TOTPStatus{
		Enabled:     enabled,
		Enrolled:    enrolled,
		BackupCount: backupCount,
	}, nil
}
