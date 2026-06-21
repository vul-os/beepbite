// Package driver — store layer for driver_assignments, driver_shifts, and
// driver_location_pings (migration 011).
package driver

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

var (
	ErrAssignmentNotFound  = errors.New("driver assignment not found")
	ErrAssignmentForbidden = errors.New("assignment does not belong to this driver")
	ErrIllegalTransition   = errors.New("status transition not allowed")
	ErrAlreadyCanceled     = errors.New("assignment is already in a terminal state")
	ErrShiftConflict       = errors.New("driver already has an open shift")
	ErrShiftNotFound       = errors.New("no open shift found for driver")
	ErrNoActiveContext     = errors.New("driver has no active shift or active assignment")
	ErrMemberNotFound      = errors.New("driver member record not found for calling user")
)

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

// Assignment mirrors a driver_assignments row, extended with order details
// for the GET /driver/assignments list response.
type Assignment struct {
	ID             string     `json:"id"`
	OrderID        string     `json:"order_id"`
	DriverMemberID string     `json:"driver_member_id"`
	Status         string     `json:"status"`
	OfferedAt      time.Time  `json:"offered_at"`
	AcceptedAt     *time.Time `json:"accepted_at"`
	PickedUpAt     *time.Time `json:"picked_up_at"`
	DeliveredAt    *time.Time `json:"delivered_at"`
	CanceledReason *string    `json:"canceled_reason"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`

	// Denormalised from the joined order + location for the driver view.
	DeliveryAddress *string `json:"delivery_address"`
	TotalCents      int64   `json:"total_cents"`
	StoreName       string  `json:"store_name"`
}

// Shift mirrors a driver_shifts row.
type Shift struct {
	ID             string     `json:"id"`
	DriverMemberID string     `json:"driver_member_id"`
	StartedAt      time.Time  `json:"started_at"`
	EndedAt        *time.Time `json:"ended_at"`
	Status         string     `json:"status"`
	Notes          *string    `json:"notes"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// Ping mirrors a driver_location_pings row (insert result).
type Ping struct {
	ID             string    `json:"id"`
	DriverMemberID string    `json:"driver_member_id"`
	Lat            float64   `json:"lat"`
	Lng            float64   `json:"lng"`
	AccuracyM      *float32  `json:"accuracy_m"`
	HeadingDeg     *float32  `json:"heading_deg"`
	SpeedMps       *float32  `json:"speed_mps"`
	RecordedAt     time.Time `json:"recorded_at"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Member-identity helpers
// ---------------------------------------------------------------------------

// MemberIDsForUser returns all organization_member IDs where profile_id matches
// the calling user. Runs under the user-scoped RLS (current_user_id is set via
// the db.Scope injected by RequireOrgScope). Returns ErrMemberNotFound when
// the user has no member rows (new signup or non-member).
func (s *Store) MemberIDsForUser(ctx context.Context, userID string) ([]string, error) {
	var ids []string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Use service_role to bypass RLS on organization_members so this
		// lookup works the same way RequireOrgScope does — the middleware is
		// the trusted identity resolver.
		rows, err := tx.Query(ctx,
			`SELECT id FROM organization_members WHERE profile_id = $1`,
			userID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, ErrMemberNotFound
	}
	return ids, nil
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

const assignmentCols = `
	da.id, da.order_id, da.driver_member_id, da.status,
	da.offered_at, da.accepted_at, da.picked_up_at, da.delivered_at,
	da.canceled_reason, da.created_at, da.updated_at,
	o.delivery_address, o.total_cents, l.name`

func scanAssignment(row pgx.Row, a *Assignment) error {
	return row.Scan(
		&a.ID, &a.OrderID, &a.DriverMemberID, &a.Status,
		&a.OfferedAt, &a.AcceptedAt, &a.PickedUpAt, &a.DeliveredAt,
		&a.CanceledReason, &a.CreatedAt, &a.UpdatedAt,
		&a.DeliveryAddress, &a.TotalCents, &a.StoreName,
	)
}

// ListActiveAssignments returns all active assignments (offered/accepted/picked_up)
// across every org the caller is a driver-member of. The RLS policy for
// driver_assignments allows the driver to see rows where driver_member_id IN
// (their membership IDs) regardless of the OrgScope, so we run one query with
// the full membership ID list.
//
// We deliberately run this under ServiceRoleScope so the query crosses org
// boundaries — the driver legitimately works for multiple restaurants and needs
// to see all their active assignments in one call. The WHERE clause enforces the
// scope: only rows whose driver_member_id is one of the caller's member IDs.
func (s *Store) ListActiveAssignments(ctx context.Context, memberIDs []string) ([]Assignment, error) {
	out := []Assignment{}
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT `+assignmentCols+`
FROM driver_assignments da
JOIN orders    o ON o.id = da.order_id
JOIN locations l ON l.id = o.location_id
WHERE da.driver_member_id = ANY($1::uuid[])
  AND da.status IN ('offered', 'accepted', 'picked_up')
ORDER BY da.offered_at DESC
`, memberIDs)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a Assignment
			if err := scanAssignment(rows, &a); err != nil {
				return err
			}
			out = append(out, a)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// TransitionAssignment atomically validates ownership + legal transition, then
// applies the new status and the matching timestamp column. Returns
// ErrAssignmentNotFound, ErrAssignmentForbidden, or ErrIllegalTransition on
// rejection; ErrAlreadyCanceled when the assignment is terminal.
func (s *Store) TransitionAssignment(
	ctx context.Context,
	assignmentID string,
	memberIDs []string,
	newStatus string,
	cancelReason string,
) (*Assignment, error) {
	var out Assignment
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Lock the row and verify it belongs to this driver.
		var currentStatus string
		var driverMemberID string
		err := tx.QueryRow(ctx, `
SELECT status, driver_member_id
FROM driver_assignments
WHERE id = $1
FOR UPDATE
`, assignmentID).Scan(&currentStatus, &driverMemberID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrAssignmentNotFound
		}
		if err != nil {
			return err
		}

		// Ownership check: driver_member_id must be one of the caller's IDs.
		owned := false
		for _, mid := range memberIDs {
			if mid == driverMemberID {
				owned = true
				break
			}
		}
		if !owned {
			return ErrAssignmentForbidden
		}

		// Terminal-state check for cancel.
		if currentStatus == "delivered" || currentStatus == "canceled" {
			return ErrAlreadyCanceled
		}

		// Legal transition table.
		validTransitions := map[string]string{
			"accepted":  "offered",
			"picked_up": "accepted",
			"delivered": "picked_up",
			"canceled":  "", // any non-terminal state is allowed
		}

		required, ok := validTransitions[newStatus]
		if !ok {
			return ErrIllegalTransition
		}
		if required != "" && currentStatus != required {
			return ErrIllegalTransition
		}

		// Build the SET clause based on the transition.
		var q string
		var args []any

		switch newStatus {
		case "accepted":
			q = `UPDATE driver_assignments
			     SET status = 'accepted', accepted_at = now(), updated_at = now()
			     WHERE id = $1`
			args = []any{assignmentID}
		case "picked_up":
			q = `UPDATE driver_assignments
			     SET status = 'picked_up', picked_up_at = now(), updated_at = now()
			     WHERE id = $1`
			args = []any{assignmentID}
		case "delivered":
			q = `UPDATE driver_assignments
			     SET status = 'delivered', delivered_at = now(), updated_at = now()
			     WHERE id = $1`
			args = []any{assignmentID}
		case "canceled":
			q = `UPDATE driver_assignments
			     SET status = 'canceled', canceled_reason = $2, updated_at = now()
			     WHERE id = $1`
			args = []any{assignmentID, nullStr(cancelReason)}
		}

		if _, err := tx.Exec(ctx, q, args...); err != nil {
			return err
		}

		return scanAssignment(tx.QueryRow(ctx, `
SELECT `+assignmentCols+`
FROM driver_assignments da
JOIN orders    o ON o.id = da.order_id
JOIN locations l ON l.id = o.location_id
WHERE da.id = $1
`, assignmentID), &out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

const shiftCols = `id, driver_member_id, started_at, ended_at, status, notes, created_at, updated_at`

func scanShift(row pgx.Row, s *Shift) error {
	return row.Scan(
		&s.ID, &s.DriverMemberID, &s.StartedAt, &s.EndedAt,
		&s.Status, &s.Notes, &s.CreatedAt, &s.UpdatedAt,
	)
}

// GoOnline opens a new shift (status=online) for the driver. The partial unique
// index `one_open_driver_shift` enforces at most one open/paused shift; a
// 23505 unique-violation is translated to ErrShiftConflict.
func (s *Store) GoOnline(ctx context.Context, driverMemberID string) (*Shift, error) {
	var out Shift
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		err := scanShift(tx.QueryRow(ctx, `
INSERT INTO driver_shifts (driver_member_id, status)
VALUES ($1, 'online')
RETURNING `+shiftCols, driverMemberID), &out)
		if err != nil {
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == "23505" {
				return ErrShiftConflict
			}
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// SetShiftStatus updates the open/paused shift's status to paused or offline.
// For offline, ended_at is set to now() and the shift is closed.
func (s *Store) SetShiftStatus(ctx context.Context, driverMemberID, newStatus string) (*Shift, error) {
	var out Shift
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Find the open shift (online or paused).
		var shiftID string
		var currentStatus string
		err := tx.QueryRow(ctx, `
SELECT id, status
FROM driver_shifts
WHERE driver_member_id = $1 AND status IN ('online', 'paused')
FOR UPDATE
`, driverMemberID).Scan(&shiftID, &currentStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrShiftNotFound
		}
		if err != nil {
			return err
		}

		var q string
		switch newStatus {
		case "paused":
			q = `UPDATE driver_shifts
			     SET status = 'paused', updated_at = now()
			     WHERE id = $1
			     RETURNING ` + shiftCols
		case "offline":
			q = `UPDATE driver_shifts
			     SET status = 'offline', ended_at = now(), updated_at = now()
			     WHERE id = $1
			     RETURNING ` + shiftCols
		default:
			return ErrIllegalTransition
		}

		return scanShift(tx.QueryRow(ctx, q, shiftID), &out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Pings
// ---------------------------------------------------------------------------

// InsertPing writes a driver_location_pings row. It first verifies the driver
// has an active shift (online/paused) OR an active assignment (accepted/picked_up).
// Returns ErrNoActiveContext when neither condition is met.
func (s *Store) InsertPing(
	ctx context.Context,
	driverMemberID string,
	lat, lng float64,
	accuracyM, headingDeg, speedMps *float32,
) (*Ping, error) {
	var out Ping
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Check for an active shift.
		var hasActiveContext bool
		err := tx.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1 FROM driver_shifts
    WHERE driver_member_id = $1 AND status IN ('online', 'paused')
)
`, driverMemberID).Scan(&hasActiveContext)
		if err != nil {
			return err
		}

		if !hasActiveContext {
			// Fall back to active assignment.
			err = tx.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1 FROM driver_assignments
    WHERE driver_member_id = $1 AND status IN ('accepted', 'picked_up')
)
`, driverMemberID).Scan(&hasActiveContext)
			if err != nil {
				return err
			}
		}

		if !hasActiveContext {
			return ErrNoActiveContext
		}

		return tx.QueryRow(ctx, `
INSERT INTO driver_location_pings
    (driver_member_id, lat, lng, accuracy_m, heading_deg, speed_mps)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, driver_member_id, lat, lng, accuracy_m, heading_deg, speed_mps, recorded_at
`, driverMemberID, lat, lng, accuracyM, headingDeg, speedMps).Scan(
			&out.ID, &out.DriverMemberID,
			&out.Lat, &out.Lng,
			&out.AccuracyM, &out.HeadingDeg, &out.SpeedMps,
			&out.RecordedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
