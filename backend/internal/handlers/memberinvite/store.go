// Package memberinvite — database access for organisation member invitations.
//
// Schema note: organization_invites has a `role` CHECK that includes all
// non-driver member roles (manager, staff, kitchen, pos). Capabilities are
// written to organization_members at accept time by AcceptMatchingInvites;
// they are NOT stored on the invite row.
package memberinvite

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
	ErrInviteNotFound   = errors.New("member invite not found")
	ErrAlreadyMember    = errors.New("user is already a member of this organization")
	ErrAlreadyInvited   = errors.New("a pending invite already exists for this email")
	ErrMemberNotFound   = errors.New("member not found in this organization")
	ErrCannotRemoveSelf = errors.New("cannot remove yourself")
	ErrLastOwner        = errors.New("cannot remove the last owner")
)

// allowedRoles is the set of roles this package manages. 'owner' and 'driver'
// are excluded: owner is too privileged to invite; driver has its own package.
var allowedRoles = map[string]bool{
	"manager": true,
	"staff":   true,
	"kitchen": true,
	"pos":     true,
}

// MemberInvite mirrors the organization_invites row for non-driver roles.
type MemberInvite struct {
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

func scanInvite(row pgx.Row, inv *MemberInvite) error {
	return row.Scan(
		&inv.ID, &inv.OrganizationID, &inv.Email, &inv.Role,
		&inv.Status, &inv.InvitedBy, &inv.CreatedAt, &inv.UpdatedAt,
	)
}

// ActiveMember is an accepted organisation member (non-driver) joined to its
// profile for display.
type ActiveMember struct {
	ProfileID string    `json:"profile_id"`
	Email     string    `json:"email"`
	FullName  string    `json:"full_name"`
	Role      string    `json:"role"`
	JoinedAt  time.Time `json:"joined_at"`
}

// Store holds a pgxpool and exposes all DB operations for member invites.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by the given connection pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// CreateInvite inserts a new member invite for the given email and role into
// orgID. Returns ErrAlreadyMember when the email belongs to an existing member,
// and ErrAlreadyInvited when a pending (non-driver) invite for that email exists.
func (s *Store) CreateInvite(ctx context.Context, orgID, email, role, invitedByProfileID string) (*MemberInvite, error) {
	// Check existing membership under service-role so we can read the profiles
	// table (which has per-user RLS) for any email, not just the caller's own.
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

	var inv MemberInvite
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Reject if a pending non-driver invite already exists for this email+org.
		var exists bool
		if err := tx.QueryRow(ctx, `
SELECT EXISTS(
    SELECT 1
      FROM organization_invites
     WHERE organization_id = $1
       AND lower(email) = lower($2)
       AND role != 'driver'
       AND status = 'pending'
)`, orgID, email).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrAlreadyInvited
		}

		return scanInvite(tx.QueryRow(ctx, `
INSERT INTO organization_invites (organization_id, email, role, status, invited_by)
VALUES ($1, $2, $3, 'pending', $4)
RETURNING `+inviteCols,
			orgID, email, role, nullStr(invitedByProfileID),
		), &inv)
	})
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// ListPendingInvites returns all pending non-driver invites for orgID.
func (s *Store) ListPendingInvites(ctx context.Context, orgID string) ([]MemberInvite, error) {
	out := []MemberInvite{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT `+inviteCols+`
  FROM organization_invites
 WHERE organization_id = $1
   AND role != 'driver'
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
			var inv MemberInvite
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

// RevokeInvite marks the invite as rejected. Returns ErrInviteNotFound when no
// pending non-driver invite with that id exists in the caller's org.
func (s *Store) RevokeInvite(ctx context.Context, orgID, inviteID string) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
UPDATE organization_invites
   SET status = 'rejected', updated_at = now()
 WHERE id = $1
   AND organization_id = $2
   AND role != 'driver'
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

// ListActiveMembers returns the org's accepted non-driver members. Uses
// ServiceRoleScope to read profiles (per-user RLS), bounded by orgID filter.
func (s *Store) ListActiveMembers(ctx context.Context, orgID string) ([]ActiveMember, error) {
	out := []ActiveMember{}
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT m.profile_id, COALESCE(p.email, ''), COALESCE(p.full_name, ''), m.role, m.created_at
  FROM organization_members m
  JOIN profiles p ON p.id = m.profile_id
 WHERE m.organization_id = $1
   AND m.role != 'driver'
 ORDER BY p.email
 LIMIT 500`, orgID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m ActiveMember
			if err := rows.Scan(&m.ProfileID, &m.Email, &m.FullName, &m.Role, &m.JoinedAt); err != nil {
				return err
			}
			out = append(out, m)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RemoveMember deletes the non-driver membership for profileID in orgID.
// Returns ErrMemberNotFound when no matching non-driver membership exists.
// The caller must already have checked:
//   - profileID != callerID  (cannot remove yourself)
//   - at least one owner remains after removal  (ErrLastOwner — checked here)
//
// Uses ServiceRoleScope + strict org filter.
func (s *Store) RemoveMember(ctx context.Context, orgID, profileID string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Determine the role of the target member before deleting.
		var targetRole string
		err := tx.QueryRow(ctx, `
SELECT role
  FROM organization_members
 WHERE organization_id = $1
   AND profile_id = $2
   AND role != 'driver'`, orgID, profileID).Scan(&targetRole)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrMemberNotFound
			}
			return err
		}

		// Guard: cannot remove the last owner.
		if targetRole == "owner" {
			var ownerCount int
			if err := tx.QueryRow(ctx, `
SELECT count(*)
  FROM organization_members
 WHERE organization_id = $1
   AND role = 'owner'`, orgID).Scan(&ownerCount); err != nil {
				return err
			}
			if ownerCount <= 1 {
				return ErrLastOwner
			}
		}

		tag, err := tx.Exec(ctx, `
DELETE FROM organization_members
 WHERE organization_id = $1
   AND profile_id = $2
   AND role != 'driver'`, orgID, profileID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrMemberNotFound
		}
		return nil
	})
}

// AcceptMatchingInvites is called immediately after a new user is created
// (signup flow). It finds all pending non-driver invites matching the user's
// email, inserts organization_members rows with role-appropriate default
// capabilities, and marks each invite as accepted — all within a single
// service-role transaction.
//
// Default capabilities per role:
//   - manager : can_pos, can_kds, can_manage_staff, can_manage_menu, can_view_reports
//   - staff   : can_pos
//   - pos     : can_pos
//   - kitchen : can_kds
//
// WHERE TO CALL: in the signup handler, after the profile row is created:
//
//	if err := memberinvite.AcceptMatchingInvites(ctx, pool, profileID, email); err != nil {
//	    log.Printf("warn: memberinvite.AcceptMatchingInvites: %v", err)
//	    // non-fatal: invite acceptance failure must not block signup
//	}
//
// The function is intentionally exported (not on *Store) so it can be imported
// and called directly by the signup orchestrator without constructing a Handler.
func AcceptMatchingInvites(ctx context.Context, pool *pgxpool.Pool, profileID, email string) error {
	return db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT id, organization_id, role
  FROM organization_invites
 WHERE lower(email) = lower($1)
   AND role != 'driver'
   AND status = 'pending'`,
			email,
		)
		if err != nil {
			return err
		}

		type pending struct {
			id    string
			orgID string
			role  string
		}
		var invites []pending
		for rows.Next() {
			var p pending
			if err := rows.Scan(&p.id, &p.orgID, &p.role); err != nil {
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
			caps := defaultCapabilities(inv.role)

			// Insert org member. ON CONFLICT: if the user is already a member via
			// another path, skip rather than overwrite their existing capabilities.
			_, err := tx.Exec(ctx, `
INSERT INTO organization_members (organization_id, profile_id, role, capabilities)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, profile_id) DO NOTHING`,
				inv.orgID, profileID, inv.role, caps,
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

// defaultCapabilities returns a JSON capabilities object for the given role.
// The database trigger trg_default_member_capabilities also runs on INSERT, so
// these values act as a belt-and-suspenders default that is consistent with the
// trigger's own logic. Any overlap is harmless (trigger runs BEFORE INSERT so
// our explicit value here is overridden by the trigger if the trigger does the
// same merge).
func defaultCapabilities(role string) string {
	switch role {
	case "manager":
		return `{"can_pos":true,"can_kds":true,"can_manage_staff":true,"can_manage_menu":true,"can_view_reports":true}`
	case "kitchen":
		return `{"can_kds":true}`
	case "pos", "staff":
		return `{"can_pos":true}`
	default:
		return `{}`
	}
}

// ---- helpers -----------------------------------------------------------------

// nullStr converts an empty string to nil (for nullable UUID columns).
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
