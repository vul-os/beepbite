// Package eodemail — store.go holds the DB queries for the EOD email runner.
package eodemail

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// locationRow carries per-location data needed by the runner.
type locationRow struct {
	LocationID   string
	LocationName string
	CurrencyCode string
	OwnerEmail   string // from profiles via organization_members (role='owner')
}

// dayKPI holds the aggregated metrics for a single trading day.
type dayKPI struct {
	GrossCents   int64 // total_cents of completed orders
	NetCents     int64 // subtotal_cents (gross - tax, pre-discount)
	TaxCents     int64 // tax_cents
	TipsCents    int64 // gratuity_cents
	OrderCount   int64
	NewCustomers int64 // customers whose first completed order is today
}

// loadActiveLocations returns all is_active locations together with the owner's
// email address.  The owner is the organization_members row with role='owner';
// email is sourced from profiles.email.
//
// SCHEMA FLAG: locations.eod_email_enabled is MISSING.
// When that column is added, add AND l.eod_email_enabled = true to the WHERE
// clause and remove this comment.  Until then all active locations receive the
// summary (preference defaults to ON).
func loadActiveLocations(ctx context.Context, pool *pgxpool.Pool) ([]locationRow, error) {
	const q = `
SELECT
    l.id                                            AS location_id,
    l.name                                          AS location_name,
    COALESCE(l.currency_code, 'ZAR')                AS currency_code,
    COALESCE(p.email, '')                           AS owner_email
FROM locations l
JOIN organizations o ON o.id = l.organization_id
LEFT JOIN organization_members om
       ON om.organization_id = o.id
      AND om.role = 'owner'
LEFT JOIN profiles p ON p.id = om.profile_id
WHERE l.is_active = true
  AND o.is_active = true
ORDER BY l.organization_id, l.id
`
	var rows []locationRow
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		pgrows, err := tx.Query(ctx, q)
		if err != nil {
			return err
		}
		defer pgrows.Close()
		for pgrows.Next() {
			var row locationRow
			if err := pgrows.Scan(&row.LocationID, &row.LocationName, &row.CurrencyCode, &row.OwnerEmail); err != nil {
				return err
			}
			rows = append(rows, row)
		}
		return pgrows.Err()
	})
	return rows, err
}

// queryDayKPI aggregates completed-order metrics for locationID in [from, to).
//
// Columns used:
//
//	orders.total_cents    → gross sales
//	orders.subtotal_cents → net sales (pre-tax)
//	orders.tax_cents      → tax collected
//	orders.gratuity_cents → tips
//	orders.created_at     → day window
//	orders.status         → 'completed' only
//	orders.customer_id    → new-customer subquery
func queryDayKPI(ctx context.Context, tx pgx.Tx, locationID string, from, to time.Time) (dayKPI, error) {
	const q = `
SELECT
    COALESCE(SUM(total_cents),     0)::bigint AS gross_cents,
    COALESCE(SUM(subtotal_cents),  0)::bigint AS net_cents,
    COALESCE(SUM(tax_cents),       0)::bigint AS tax_cents,
    COALESCE(SUM(gratuity_cents),  0)::bigint AS tips_cents,
    COUNT(*)::bigint                           AS order_count,
    COALESCE((
        SELECT COUNT(DISTINCT o2.customer_id)
        FROM orders o2
        WHERE o2.location_id = $1
          AND o2.status = 'completed'
          AND o2.customer_id IS NOT NULL
          AND o2.created_at >= $2
          AND o2.created_at <  $3
          AND NOT EXISTS (
              SELECT 1 FROM orders o3
              WHERE o3.customer_id = o2.customer_id
                AND o3.location_id = $1
                AND o3.status = 'completed'
                AND o3.created_at < $2
          )
    ), 0)::bigint                              AS new_customers
FROM orders
WHERE location_id = $1
  AND status = 'completed'
  AND created_at >= $2
  AND created_at <  $3
`
	var kpi dayKPI
	err := tx.QueryRow(ctx, q, locationID, from, to).Scan(
		&kpi.GrossCents,
		&kpi.NetCents,
		&kpi.TaxCents,
		&kpi.TipsCents,
		&kpi.OrderCount,
		&kpi.NewCustomers,
	)
	return kpi, err
}
