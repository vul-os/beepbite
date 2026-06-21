// Package driverinvite — database access for driver invitations (Wave 16).
//
// Schema note: organization_invites has `role` (CHECK includes 'driver') but
// NO `capabilities` column. Driver invites store role='driver' in the existing
// table. The capabilities column ({"can_drive":true}) is written to
// organization_members at accept time by AcceptMatchingInvites — it is NOT
// stored on the invite row itself. A future migration adding
// organization_invites.capabilities jsonb NOT NULL DEFAULT '{}'
// would let the orchestrator round-trip capability sets through invites; until
// then the driver's can_drive capability is hard-coded in AcceptMatchingInvites.
package driverinvite

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
	ErrInviteNotFound = errors.New("driver invite not found")
	ErrAlreadyMember  = errors.New("user is already a member of this organization")
	ErrAlreadyInvited = errors.New("a pending driver invite already exists for this email")
	ErrDriverNotFound = errors.New("driver not found in this organization")
)

// DriverInvite mirrors the organization_invites row (role='driver' subset).
type DriverInvite struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	Email          string    `json:"email"`
	Role           string    `json:"role"`
	Status         string    `json:"status"`
	InvitedBy      *string   `json:"invited_by"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

const inviteCols = `id, organization_id, email, role, status, invited_by, created_at, updated_at`

func scanInvite(row pgx.Row, inv *DriverInvite) error {
	return row.Scan(
		&inv.ID, &inv.OrganizationID, &inv.Email, &inv.Role,
		&inv.Status, &inv.InvitedBy, &inv.CreatedAt, &inv.UpdatedAt,
	)
}

// Store holds a pgxpool and exposes all DB operations for driver invites.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by the given connection pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// CreateInvite inserts a new driver invite for the given email into orgID.
// The caller must have already verified that the requester is owner/manager.
// Returns ErrAlreadyMember when the email belongs to an existing member,
// and ErrAlreadyInvited when a pending driver invite for that email exists.
func (s *Store) CreateInvite(ctx context.Context, orgID, email, invitedByProfileID string) (*DriverInvite, error) {
	var inv DriverInvite
	// Check membership existence under service-role scope so the query is not
	// blocked by the FORCE RLS policy on profiles (which restricts rows to
	// id = current_user_id() OR is_service_role()). The manager can only see
	// their own profile row under tenant scope, making the guard a no-op for
	// any other email. Bypassing RLS here is safe: email is only the lookup
	// key and no row data is returned.
	var isMember bool
	if err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT EXISTS(
    SELECT 1
      FROM organization_members om
      JOIN profiles p ON om.profile_id = p.id
     WHERE om.organization_id = $1
       AND lower(p.email) = lower($2)
)`, orgID, email).Scan(&isMember)
	}); err != nil {
		return nil, err
	}
	if isMember {
		return nil, ErrAlreadyMember
	}

	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {

		// Reject if a pending driver invite already exists for this email+org.
		var exists bool
		if err := tx.QueryRow(ctx, `
SELECT EXISTS(
    SELECT 1
      FROM organization_invites
     WHERE organization_id = $1
       AND lower(email) = lower($2)
       AND role = 'driver'
       AND status = 'pending'
)`, orgID, email).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrAlreadyInvited
		}

		return scanInvite(tx.QueryRow(ctx, `
INSERT INTO organization_invites (organization_id, email, role, status, invited_by)
VALUES ($1, $2, 'driver', 'pending', $3)
RETURNING `+inviteCols,
			orgID, email, nullStr(invitedByProfileID),
		), &inv)
	})
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// ListPendingInvites returns all pending driver invites for orgID.
func (s *Store) ListPendingInvites(ctx context.Context, orgID string) ([]DriverInvite, error) {
	out := []DriverInvite{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT `+inviteCols+`
  FROM organization_invites
 WHERE organization_id = $1
   AND role = 'driver'
   AND status = 'pending'
 ORDER BY created_at DESC
 LIMIT 200`,
			orgID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var inv DriverInvite
			if err := scanInvite(rows, &inv); err != nil {
				return err
			}
			out = append(out, inv)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RevokeInvite marks the invite as rejected (soft-revoke).
// Returns ErrInviteNotFound when no pending driver invite with that id exists
// in the caller's org.
func (s *Store) RevokeInvite(ctx context.Context, orgID, inviteID string) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
UPDATE organization_invites
   SET status = 'rejected', updated_at = now()
 WHERE id = $1
   AND organization_id = $2
   AND role = 'driver'
   AND status = 'pending'`,
			inviteID, orgID,
		)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrInviteNotFound
		}
		return nil
	})
}

// ActiveDriver is an accepted driver member (role='driver') joined to its
// profile for display.
type ActiveDriver struct {
	ProfileID string    `json:"profile_id"`
	Email     string    `json:"email"`
	FullName  string    `json:"full_name"`
	JoinedAt  time.Time `json:"joined_at"`
}

// ListActiveDrivers returns the org's accepted driver members. It runs under
// ServiceRoleScope because profiles RLS is per-user (an owner can't read a
// co-member's profile under their own scope); access is bounded by filtering
// strictly on the caller's resolved orgID — the same pattern used by the
// data-export / admin reads.
func (s *Store) ListActiveDrivers(ctx context.Context, orgID string) ([]ActiveDriver, error) {
	out := []ActiveDriver{}
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT m.profile_id, COALESCE(p.email, ''), COALESCE(p.full_name, ''), m.created_at
  FROM organization_members m
  JOIN profiles p ON p.id = m.profile_id
 WHERE m.organization_id = $1
   AND m.role = 'driver'
 ORDER BY p.email
 LIMIT 500`, orgID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d ActiveDriver
			if err := rows.Scan(&d.ProfileID, &d.Email, &d.FullName, &d.JoinedAt); err != nil {
				return err
			}
			out = append(out, d)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RemoveDriver deletes the driver-role membership for profileID in orgID,
// revoking that user's driver access (and can_drive). Only role='driver' rows
// are touched, so it never removes an owner/manager membership. Returns
// ErrDriverNotFound when no matching driver membership exists. Service-role +
// strict org filter.
func (s *Store) RemoveDriver(ctx context.Context, orgID, profileID string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
DELETE FROM organization_members
 WHERE organization_id = $1
   AND profile_id = $2
   AND role = 'driver'`, orgID, profileID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrDriverNotFound
		}
		return nil
	})
}

// AcceptMatchingInvites is called immediately after a new user is created
// (signup flow). It finds all pending driver invites matching the user's email,
// inserts organization_members rows (role=driver, capabilities={"can_drive":true}),
// and marks each invite as accepted — all within a single service-role
// transaction that bypasses RLS.
//
// WHERE TO CALL: in the signup handler, after the profile row has been created
// and the profileID is known:
//
//	if err := driverinvite.AcceptMatchingInvites(ctx, pool, profileID, email); err != nil {
//	    log.Printf("warn: AcceptMatchingInvites: %v", err)
//	    // non-fatal: invite acceptance failure should not block signup
//	}
//
// The function is intentionally exported (not on *Store) so it can be imported
// and called directly by the signup orchestrator without constructing a full
// Handler / Store.
func AcceptMatchingInvites(ctx context.Context, pool *pgxpool.Pool, profileID, email string) error {
	return db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Fetch all pending driver invites for this email.
		rows, err := tx.Query(ctx, `
SELECT id, organization_id
  FROM organization_invites
 WHERE lower(email) = lower($1)
   AND role = 'driver'
   AND status = 'pending'`,
			email,
		)
		if err != nil {
			return err
		}

		type pending struct {
			id    string
			orgID string
		}
		var invites []pending
		for rows.Next() {
			var p pending
			if err := rows.Scan(&p.id, &p.orgID); err != nil {
				rows.Close()
				return err
			}
			invites = append(invites, p)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		if len(invites) == 0 {
			return nil // nothing to do
		}

		for _, inv := range invites {
			// Insert org member with role=driver and can_drive capability.
			// ON CONFLICT: if the user is already a member (e.g. via another
			// path), don't overwrite — just skip.
			_, err := tx.Exec(ctx, `
INSERT INTO organization_members (organization_id, profile_id, role, capabilities)
VALUES ($1, $2, 'driver', '{"can_drive":true}')
ON CONFLICT (organization_id, profile_id) DO NOTHING`,
				inv.orgID, profileID,
			)
			if err != nil {
				return err
			}

			// Mark invite accepted.
			if _, err := tx.Exec(ctx, `
UPDATE organization_invites
   SET status = 'accepted', updated_at = now()
 WHERE id = $1`,
				inv.id,
			); err != nil {
				return err
			}
		}
		return nil
	})
}

// ---- helpers -----------------------------------------------------------------

// nullStr converts an empty string to nil (for nullable UUID columns).
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
