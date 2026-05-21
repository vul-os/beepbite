// Package timeclock — DB store for staff time entries.
//
// Schema note: staff_time_entries has no actor_id column. Actor attribution
// (which staff member performed the clock action, when initiated via PIN overlay)
// is recorded by:
//
//  1. The `staff_id` column — the employee being clocked in/out.
//  2. The audit_log `actor_id` / `actor_type` columns — who performed the action.
//  3. The `notes` column — the actor_id is embedded as a prefix when the actor
//     differs from staff_id (e.g. "manager_action:actor=<uuid>; <original notes>").
//
// The UPDATE RLS policy is USING(false) which blocks tenant-scoped UPDATEs.
// Manager edits are therefore done with a service-role elevation (same pattern
// as audit_log inserts in cashdrawer).
package timeclock

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors for HTTP status mapping.
var (
	ErrEntryNotFound = errors.New("time entry not found")
	ErrStaffNotFound = errors.New("staff not found")
	ErrAlreadyClosed = errors.New("staff already clocked out")
	ErrNotClockedIn  = errors.New("staff not currently clocked in")
)

// TimeEntry mirrors a staff_time_entries row.
type TimeEntry struct {
	ID         string    `json:"id"`
	StaffID    string    `json:"staff_id"`
	LocationID string    `json:"location_id"`
	EntryType  string    `json:"entry_type"`
	Timestamp  time.Time `json:"timestamp"`
	Notes      *string   `json:"notes"`
	CreatedAt  time.Time `json:"created_at"`
}

// Store wraps the DB pool with timeclock-specific queries.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const entryCols = `id, staff_id, location_id, entry_type, "timestamp", notes, created_at`

func scanEntry(row pgx.Row, e *TimeEntry) error {
	return row.Scan(&e.ID, &e.StaffID, &e.LocationID, &e.EntryType, &e.Timestamp, &e.Notes, &e.CreatedAt)
}

// resolveStaffLocation returns the location_id for a staff row within the
// current org scope. Returns ErrStaffNotFound when the staff row is invisible.
func (s *Store) resolveStaffLocation(ctx context.Context, staffID string) (string, error) {
	var locID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT location_id FROM staff WHERE id = $1`, staffID,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrStaffNotFound
	}
	return locID, err
}

// ClockIn inserts a clock_in entry for staffID. Returns ErrStaffNotFound
// when the staff row is not visible within the org scope.
func (s *Store) ClockIn(ctx context.Context, staffID, actorID, notes string) (*TimeEntry, error) {
	locID, err := s.resolveStaffLocation(ctx, staffID)
	if err != nil {
		return nil, err
	}

	notesVal := buildNotes(actorID, staffID, notes)

	var out TimeEntry
	err = db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return scanEntry(tx.QueryRow(ctx, `
INSERT INTO staff_time_entries (staff_id, location_id, entry_type, notes)
VALUES ($1, $2, 'clock_in', $3)
RETURNING `+entryCols,
			staffID, locID, nullStr(notesVal)), &out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ClockOut inserts a clock_out entry for staffID. Returns ErrStaffNotFound
// when the staff row is not visible.
func (s *Store) ClockOut(ctx context.Context, staffID, actorID, notes string) (*TimeEntry, error) {
	locID, err := s.resolveStaffLocation(ctx, staffID)
	if err != nil {
		return nil, err
	}

	notesVal := buildNotes(actorID, staffID, notes)

	var out TimeEntry
	err = db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return scanEntry(tx.QueryRow(ctx, `
INSERT INTO staff_time_entries (staff_id, location_id, entry_type, notes)
VALUES ($1, $2, 'clock_out', $3)
RETURNING `+entryCols,
			staffID, locID, nullStr(notesVal)), &out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ListEntries returns time entries for the org, optionally filtered by staff_id.
// Returns at most 200 rows ordered by timestamp DESC.
func (s *Store) ListEntries(ctx context.Context, staffID string, limit int) ([]TimeEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	var out []TimeEntry
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var (
			rows pgx.Rows
			err  error
		)
		if staffID != "" {
			rows, err = tx.Query(ctx,
				`SELECT `+entryCols+` FROM staff_time_entries WHERE staff_id = $1 ORDER BY "timestamp" DESC LIMIT $2`,
				staffID, limit)
		} else {
			rows, err = tx.Query(ctx,
				`SELECT `+entryCols+` FROM staff_time_entries ORDER BY "timestamp" DESC LIMIT $1`,
				limit)
		}
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e TimeEntry
			if err := scanEntry(rows, &e); err != nil {
				return err
			}
			out = append(out, e)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []TimeEntry{}
	}
	return out, nil
}

// GetEntry returns a single time entry by ID, or ErrEntryNotFound.
func (s *Store) GetEntry(ctx context.Context, entryID string) (*TimeEntry, error) {
	var out TimeEntry
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return scanEntry(tx.QueryRow(ctx,
			`SELECT `+entryCols+` FROM staff_time_entries WHERE id = $1`, entryID), &out)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrEntryNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// EditEntry applies a manager correction to an existing entry. Because the RLS
// UPDATE policy is USING(false), the update runs with service-role elevation
// (same pattern as audit_log inserts). An audit_log row is written in the same
// transaction.
//
// Editable fields: entry_type, timestamp override, notes.
func (s *Store) EditEntry(
	ctx context.Context,
	entryID string,
	newEntryType string,
	newTimestamp *time.Time,
	newNotes string,
	actorID, actorLabel, orgID string,
	beforeState, afterState []byte,
) (*TimeEntry, error) {
	// Read current entry first (tenant-scoped — confirms the entry belongs to org).
	before, err := s.GetEntry(ctx, entryID)
	if err != nil {
		return nil, err
	}

	var out TimeEntry
	err = db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Elevation: UPDATE needs service_role because policy is USING(false).
		return db.WithTxServiceRole(ctx, tx, func() error {
			// Build dynamic SET clause.
			sets := []string{"notes = $2"}
			args := []any{entryID, nullStr(newNotes)}
			argN := 3

			if newEntryType != "" && newEntryType != before.EntryType {
				sets = append(sets, fmt.Sprintf("entry_type = $%d", argN))
				args = append(args, newEntryType)
				argN++
			}
			if newTimestamp != nil {
				sets = append(sets, fmt.Sprintf(`"timestamp" = $%d`, argN))
				args = append(args, *newTimestamp)
				argN++
			}

			q := `UPDATE staff_time_entries SET ` + joinComma(sets) + ` WHERE id = $1 RETURNING ` + entryCols
			if err := scanEntry(tx.QueryRow(ctx, q, args...), &out); err != nil {
				return err
			}

			// Audit log — also needs service_role (already elevated).
			_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (organization_id, actor_type, actor_id, actor_label,
     action, entity_type, entity_id, before_state, after_state)
VALUES ($1, 'staff', $2, $3, 'time_entry.edited', 'staff_time_entry', $4, $5, $6)
`,
				nullStr(orgID), nullStr(actorID), nullStr(actorLabel),
				entryID, beforeState, afterState,
			)
			return err
		})
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------- helpers ----------------------------------------------------------

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// buildNotes prefixes the notes with an actor reference when the actor differs
// from the staff being clocked (manager-initiated action).
func buildNotes(actorID, staffID, notes string) string {
	if actorID != "" && actorID != staffID {
		prefix := "actor=" + actorID
		if notes != "" {
			return prefix + "; " + notes
		}
		return prefix
	}
	return notes
}

func joinComma(ss []string) string {
	out := ""
	for i, s := range ss {
		if i > 0 {
			out += ", "
		}
		out += s
	}
	return out
}
