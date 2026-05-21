package staffauth

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

var (
	ErrStaffNotFound     = errors.New("staff not found")
	ErrInvalidCredential = errors.New("invalid username or password")
	ErrStaffLocked       = errors.New("staff account is locked")
	ErrStaffInactive     = errors.New("staff account is inactive")
	ErrRefreshInvalid    = errors.New("refresh token invalid or revoked")
	ErrRefreshReused     = errors.New("refresh token reused")
	ErrResetTokenInvalid = errors.New("password reset token invalid or expired")
)

// lockoutThreshold is how many consecutive failed logins trigger a temporary
// lockout. Mirrors what the POS industry tends to use; tweak via config later.
const lockoutThreshold = 5
const lockoutDuration = 15 * time.Minute

// StaffUser is the subset of the staff row we pass around the auth layer.
// The full staff record (phone, hire_date, notes, etc.) is fetched through
// the data API — this package only cares about what's needed to sign in
// and issue tokens.
type StaffUser struct {
	ID                 string
	LocationID         string
	Username           *string
	FirstName          string
	LastName           string
	Role               string
	IsActive           bool
	MustChangePassword bool
	PasswordHash       *string
	PinHash            *string
	LockedUntil        *time.Time
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// GetByUsername looks up a staff row by (location_id, username) case-insensitively.
// Returns ErrStaffNotFound if no row matches — callers should map that to
// ErrInvalidCredential so attackers can't enumerate usernames.
func (s *Store) GetByUsername(ctx context.Context, locationID, username string) (*StaffUser, error) {
	username = strings.TrimSpace(username)
	// This route runs outside RequireOrgScope, so under FORCE RLS the raw-pool
	// query would see zero rows. We run as service_role to bypass row visibility;
	// the explicit (location_id, username) WHERE filter remains the lookup boundary.
	var u StaffUser
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, location_id, username, first_name, last_name, role,
       is_active, must_change_password, password_hash, pin_hash, locked_until
FROM staff
WHERE location_id = $1 AND lower(username) = lower($2)
LIMIT 1
`, locationID, username).Scan(
			&u.ID, &u.LocationID, &u.Username, &u.FirstName, &u.LastName, &u.Role,
			&u.IsActive, &u.MustChangePassword, &u.PasswordHash, &u.PinHash, &u.LockedUntil,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrStaffNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) GetByID(ctx context.Context, staffID string) (*StaffUser, error) {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS visibility.
	// The id = $1 filter is the lookup boundary and is preserved verbatim.
	var u StaffUser
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, location_id, username, first_name, last_name, role,
       is_active, must_change_password, password_hash, pin_hash, locked_until
FROM staff
WHERE id = $1
`, staffID).Scan(
			&u.ID, &u.LocationID, &u.Username, &u.FirstName, &u.LastName, &u.Role,
			&u.IsActive, &u.MustChangePassword, &u.PasswordHash, &u.PinHash, &u.LockedUntil,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrStaffNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Store) UpdateLastLogin(ctx context.Context, staffID string) error {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS visibility.
	// The id = $1 filter is unchanged.
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE staff SET last_login_at = now(), updated_at = now() WHERE id = $1`,
			staffID)
		return err
	})
}

// IncrementFailedAttempts bumps the counter and, if we cross the threshold,
// sets locked_until. Done in a single UPDATE so two parallel failed logins
// can't race past the threshold without locking.
func (s *Store) IncrementFailedAttempts(ctx context.Context, staffID string) error {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS visibility.
	// The single-UPDATE lockout logic and threshold are preserved verbatim.
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE staff
SET failed_login_attempts = failed_login_attempts + 1,
    locked_until = CASE
        WHEN failed_login_attempts + 1 >= $2 THEN now() + $3::interval
        ELSE locked_until
    END,
    updated_at = now()
WHERE id = $1
`, staffID, lockoutThreshold, lockoutDuration.String())
		return err
	})
}

func (s *Store) ClearFailedAttempts(ctx context.Context, staffID string) error {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS visibility.
	// The id = $1 filter is unchanged.
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE staff
SET failed_login_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE id = $1
`, staffID)
		return err
	})
}

// --- Refresh tokens ---

func (s *Store) InsertRefreshToken(ctx context.Context, staffID, tokenHash, userAgent string, ttl time.Duration) (string, error) {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS on
	// staff_refresh_tokens. The inserted values are unchanged.
	var id string
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO staff_refresh_tokens (staff_id, token_hash, expires_at, user_agent)
VALUES ($1, $2, now() + $3::interval, $4)
RETURNING id
`, staffID, tokenHash, ttl.String(), nullString(userAgent)).Scan(&id)
	})
	return id, err
}

type RefreshRow struct {
	ID         string
	StaffID    string
	ExpiresAt  time.Time
	RevokedAt  *time.Time
	ReplacedBy *string
}

func (s *Store) GetRefreshTokenByHash(ctx context.Context, tokenHash string) (*RefreshRow, error) {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS visibility.
	// The token_hash = $1 filter is the lookup boundary and is unchanged.
	var r RefreshRow
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, staff_id, expires_at, revoked_at, replaced_by
FROM staff_refresh_tokens
WHERE token_hash = $1
`, tokenHash).Scan(&r.ID, &r.StaffID, &r.ExpiresAt, &r.RevokedAt, &r.ReplacedBy)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRefreshInvalid
	}
	return &r, err
}

// ReplaceRefreshToken inserts the new row and revokes the old one atomically,
// linking them via replaced_by so reuse detection works.
func (s *Store) ReplaceRefreshToken(ctx context.Context, oldID, staffID, newHash, userAgent string, ttl time.Duration) (string, error) {
	// Runs outside RequireOrgScope; the insert + revoke stay in a SINGLE
	// service_role transaction so rotation remains atomic. service_role only
	// changes row visibility under FORCE RLS — the SQL is unchanged.
	var newID string
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
INSERT INTO staff_refresh_tokens (staff_id, token_hash, expires_at, user_agent)
VALUES ($1, $2, now() + $3::interval, $4)
RETURNING id
`, staffID, newHash, ttl.String(), nullString(userAgent)).Scan(&newID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
UPDATE staff_refresh_tokens
SET revoked_at = now(), replaced_by = $1
WHERE id = $2
`, newID, oldID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return newID, nil
}

func (s *Store) RevokeRefreshToken(ctx context.Context, tokenHash string) error {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS visibility.
	// The token_hash + revoked_at IS NULL filter is unchanged.
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE staff_refresh_tokens
SET revoked_at = now()
WHERE token_hash = $1 AND revoked_at IS NULL
`, tokenHash)
		return err
	})
}

// RevokeAllForStaff revokes every outstanding refresh for a staff member —
// used when we detect reuse and treat it as a session compromise.
func (s *Store) RevokeAllForStaff(ctx context.Context, staffID string) {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS visibility.
	// Best-effort semantics (errors swallowed) preserved; filter unchanged.
	_ = db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, _ = tx.Exec(ctx,
			`UPDATE staff_refresh_tokens SET revoked_at = now() WHERE staff_id = $1 AND revoked_at IS NULL`,
			staffID)
		return nil
	})
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// SetPinHash overwrites pin_hash for a staff row, enforcing that the row
// belongs to an org where the calling user has a manager/owner role. Returns
// ErrStaffNotFound when no such row exists or the org membership check fails
// (treated identically to prevent enumeration).
func (s *Store) SetPinHash(ctx context.Context, staffID, callerUserID, newHash string) error {
	// This route runs outside RequireOrgScope (no app.current_org_id on the
	// connection), so under FORCE RLS the membership subquery below would see
	// zero rows and the UPDATE would silently match nothing. We run it as
	// service_role to bypass RLS; the owner/manager membership subquery in the
	// WHERE clause is itself the authorization boundary (a caller can only
	// touch staff at a location of an org they own/manage).
	var affected int64
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
UPDATE staff
SET pin_hash    = $1,
    updated_at  = now()
WHERE id = $2
  AND location_id IN (
      SELECT l.id
      FROM   locations l
      JOIN   organization_members om
             ON om.organization_id = l.organization_id
            AND om.profile_id      = $3
            AND om.role IN ('owner', 'manager')
  )
`, newHash, staffID, callerUserID)
		if err != nil {
			return err
		}
		affected = ct.RowsAffected()
		return nil
	})
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrStaffNotFound
	}
	return nil
}

// SetPasswordHashByManager overwrites password_hash and forces a must_change_password
// flag (set true so the staff member is required to change it on next login).
// Same org-membership guard as SetPinHash.
func (s *Store) SetPasswordHashByManager(ctx context.Context, staffID, callerUserID, newHash string) error {
	// Same RLS rationale as SetPinHash: service_role bypass with the owner/manager
	// membership subquery as the authorization boundary.
	var affected int64
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
UPDATE staff
SET password_hash        = $1,
    password_set_at      = now(),
    must_change_password = true,
    failed_login_attempts = 0,
    locked_until         = NULL,
    updated_at           = now()
WHERE id = $2
  AND location_id IN (
      SELECT l.id
      FROM   locations l
      JOIN   organization_members om
             ON om.organization_id = l.organization_id
            AND om.profile_id      = $3
            AND om.role IN ('owner', 'manager')
  )
`, newHash, staffID, callerUserID)
		if err != nil {
			return err
		}
		affected = ct.RowsAffected()
		return nil
	})
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrStaffNotFound
	}
	return nil
}

// --- Password reset tokens ---

// ResetTokenRow is the subset of staff_password_reset_tokens the password-set
// flow cares about. Managers create these rows out-of-band (via the data API);
// this package only consumes them.
type ResetTokenRow struct {
	ID         string
	StaffID    string
	ExpiresAt  time.Time
	ConsumedAt *time.Time
}

func (s *Store) GetResetTokenByHash(ctx context.Context, tokenHash string) (*ResetTokenRow, error) {
	// Runs outside RequireOrgScope; service_role bypasses FORCE RLS visibility.
	// The token_hash = $1 filter is the lookup boundary and is unchanged.
	var r ResetTokenRow
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, staff_id, expires_at, consumed_at
FROM staff_password_reset_tokens
WHERE token_hash = $1
`, tokenHash).Scan(&r.ID, &r.StaffID, &r.ExpiresAt, &r.ConsumedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrResetTokenInvalid
	}
	return &r, err
}

// ConsumePasswordReset applies the new password, marks the reset row consumed,
// and revokes every outstanding refresh for the staff member — all in one
// transaction so a partial failure can't leave a half-rotated account. The
// consume step checks row count to defend against two clients racing on the
// same raw token; the loser gets ErrResetTokenInvalid.
func (s *Store) ConsumePasswordReset(ctx context.Context, tokenID, staffID, newPasswordHash string) error {
	// Runs outside RequireOrgScope; the password update, consume, and refresh
	// revoke stay in a SINGLE service_role transaction so a partial failure
	// can't leave a half-rotated account. service_role only changes row
	// visibility under FORCE RLS — the SQL and the RowsAffected()==0 race-guard
	// (loser gets ErrResetTokenInvalid) are preserved verbatim.
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
UPDATE staff
SET password_hash = $1,
    password_set_at = now(),
    must_change_password = false,
    failed_login_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE id = $2
`, newPasswordHash, staffID); err != nil {
			return err
		}

		ct, err := tx.Exec(ctx, `
UPDATE staff_password_reset_tokens
SET consumed_at = now()
WHERE id = $1 AND consumed_at IS NULL
`, tokenID)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return ErrResetTokenInvalid
		}

		if _, err := tx.Exec(ctx, `
UPDATE staff_refresh_tokens
SET revoked_at = now()
WHERE staff_id = $1 AND revoked_at IS NULL
`, staffID); err != nil {
			return err
		}

		return nil
	})
}
