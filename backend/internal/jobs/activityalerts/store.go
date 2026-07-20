// Package activityalerts — store.go holds the DB queries for the activity
// alerts runner.
package activityalerts

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ─── Void surge detection ────────────────────────────────────────────────────

// voidSurgeHit is returned when a location exceeds the void threshold.
type voidSurgeHit struct {
	OrgID      string
	LocationID string
	VoidCount  int64
}

// queryVoidSurges returns locations where the number of void order_adjustments
// in the window [since, now) meets or exceeds threshold.
//
// Tables: order_adjustments (adjustment_type='void', created_at)
//
//	JOIN orders (location_id, organization_id)
func queryVoidSurges(ctx context.Context, pool *pgxpool.Pool, since time.Time, threshold int) ([]voidSurgeHit, error) {
	const q = `
SELECT
    o.organization_id,
    o.location_id,
    COUNT(*)::bigint AS void_count
FROM order_adjustments oa
JOIN orders o ON o.id = oa.order_id
WHERE oa.adjustment_type = 'void'
  AND oa.created_at >= $1
GROUP BY o.organization_id, o.location_id
HAVING COUNT(*) >= $2
ORDER BY void_count DESC
`
	var hits []voidSurgeHit
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, since, threshold)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var h voidSurgeHit
			if err := rows.Scan(&h.OrgID, &h.LocationID, &h.VoidCount); err != nil {
				return err
			}
			hits = append(hits, h)
		}
		return rows.Err()
	})
	return hits, err
}

// ─── PIN failure detection ────────────────────────────────────────────────────

// pinFailureHit is returned when a staff member exceeds the PIN failure threshold.
type pinFailureHit struct {
	OrgID          string
	LocationID     string
	StaffID        string
	DisplayName    string
	FailedAttempts int64
}

// queryPINFailures returns staff rows whose failed_login_attempts >= threshold.
//
// SCHEMA NOTE: There is no per-device PIN-attempt table.  staff.failed_login_attempts
// is a cumulative counter reset on successful login.  It serves as the best
// available proxy for "failed PIN attempts on one device."
//
// Tables: staff (failed_login_attempts, location_id, id, display_name, first_name, last_name)
//
//	JOIN locations (organization_id)
func queryPINFailures(ctx context.Context, pool *pgxpool.Pool, threshold int) ([]pinFailureHit, error) {
	const q = `
SELECT
    l.organization_id,
    s.location_id,
    s.id                                                AS staff_id,
    COALESCE(s.display_name, s.first_name || ' ' || s.last_name, s.id::text) AS display_name,
    s.failed_login_attempts::bigint                    AS failed_attempts
FROM staff s
JOIN locations l ON l.id = s.location_id
WHERE s.failed_login_attempts >= $1
  AND s.is_active = true
ORDER BY s.failed_login_attempts DESC
`
	var hits []pinFailureHit
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, threshold)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var h pinFailureHit
			if err := rows.Scan(&h.OrgID, &h.LocationID, &h.StaffID, &h.DisplayName, &h.FailedAttempts); err != nil {
				return err
			}
			hits = append(hits, h)
		}
		return rows.Err()
	})
	return hits, err
}

// ─── Wallet drop detection ───────────────────────────────────────────────────
