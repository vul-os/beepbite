// Package stats provides owner-analytics aggregation queries.
// All queries run through db.Scoped so Postgres RLS restricts rows to the
// caller's organisation automatically (session var app.current_org_id).
//
// View usage:
//   - summary endpoint: direct aggregation from orders (status='completed').
//     daily_sales_summary groups by order_type and uses status<>'cancelled',
//     which differs from the spec's status='completed' requirement, so we
//     query orders directly for correctness.
//   - heatmap endpoint: direct aggregation from orders. hourly_sales_heatmap
//     uses ISO DOW (1=Mon..7=Sun) and a hard-coded 90-day window; the spec
//     requires EXTRACT(DOW) (0=Sun..6=Sat) and a caller-supplied week count.
//
// net_sales_cents definition: subtotal_cents (sum of unit prices × qty,
// pre-tax). We use orders.subtotal_cents directly — it equals total_cents
// minus tax_cents and matches the "net = gross - tax" instruction cleanly.
//
// new_customers definition: customers whose first completed order falls inside
// the requested window (MIN(created_at) per customer_id within the location
// and status='completed'). This relies entirely on the orders table and needs
// no JOIN to a customers table, making it robust when customer rows may be
// absent for walk-in orders with a customer_id.
package stats

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Store holds the database pool for stats queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a new Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Summary types
// ---------------------------------------------------------------------------

// KPIRow holds the aggregated KPIs for a single time window.
type KPIRow struct {
	GrossSalesCents    int64 `json:"gross_sales_cents"`
	NetSalesCents      int64 `json:"net_sales_cents"`
	OrderCount         int64 `json:"order_count"`
	AvgOrderValueCents int64 `json:"avg_order_value_cents"`
	NewCustomers       int64 `json:"new_customers"`
}

// SeriesBucket is one data point in the time-series response.
type SeriesBucket struct {
	Bucket     string `json:"bucket"`
	SalesCents int64  `json:"sales_cents"`
	OrderCount int64  `json:"order_count"`
}

// SummaryResult is the full response for GET /stats/summary.
type SummaryResult struct {
	Period   string         `json:"period"`
	Range    DateRange      `json:"range"`
	KPIs     KPIRow         `json:"kpis"`
	Previous KPIRow         `json:"previous"`
	Series   []SeriesBucket `json:"series"`
}

// DateRange describes the inclusive start/end of the query window.
type DateRange struct {
	From string `json:"from"` // YYYY-MM-DD
	To   string `json:"to"`   // YYYY-MM-DD
}

// ---------------------------------------------------------------------------
// Heatmap types
// ---------------------------------------------------------------------------

// HeatmapCell is one (dow, hour) cell in the heatmap response.
type HeatmapCell struct {
	DOW        int   `json:"dow"`  // 0=Sunday … 6=Saturday
	Hour       int   `json:"hour"` // 0–23
	OrderCount int64 `json:"order_count"`
	SalesCents int64 `json:"sales_cents"`
}

// ---------------------------------------------------------------------------
// Summary query
// ---------------------------------------------------------------------------

// kpiQuery aggregates gross_sales_cents, net_sales_cents (= subtotal_cents),
// order_count, avg_order_value_cents, and new_customers (first order in window)
// for completed orders in [from, to).
//
// new_customers counts distinct customer_ids whose earliest completed order
// at the given location falls within [from, to). Walk-in orders with a NULL
// customer_id are excluded from the new-customer count.
const kpiQuery = `
SELECT
    COALESCE(SUM(total_cents), 0)::bigint                                AS gross_sales_cents,
    COALESCE(SUM(subtotal_cents), 0)::bigint                             AS net_sales_cents,
    COUNT(*)::bigint                                                      AS order_count,
    CASE WHEN COUNT(*) = 0 THEN 0
         ELSE (SUM(total_cents) / COUNT(*))::bigint
    END                                                                   AS avg_order_value_cents,
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
    ), 0)::bigint                                                         AS new_customers
FROM orders
WHERE location_id = $1
  AND status = 'completed'
  AND created_at >= $2
  AND created_at <  $3
`

func (s *Store) QueryKPI(ctx context.Context, locationID string, from, to time.Time) (KPIRow, error) {
	var row KPIRow
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, kpiQuery, locationID, from, to).Scan(
			&row.GrossSalesCents,
			&row.NetSalesCents,
			&row.OrderCount,
			&row.AvgOrderValueCents,
			&row.NewCustomers,
		)
	})
	return row, err
}

// ---------------------------------------------------------------------------
// Series query (bucket granularity varies by period)
// ---------------------------------------------------------------------------

// QuerySeriesHour returns hourly buckets formatted as "YYYY-MM-DDTHH" (24 buckets).
func (s *Store) QuerySeriesHour(ctx context.Context, locationID string, from, to time.Time) ([]SeriesBucket, error) {
	const q = `
SELECT
    TO_CHAR(DATE_TRUNC('hour', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24') AS bucket,
    COALESCE(SUM(total_cents), 0)::bigint                                             AS sales_cents,
    COUNT(*)::bigint                                                                   AS order_count
FROM orders
WHERE location_id = $1
  AND status = 'completed'
  AND created_at >= $2
  AND created_at <  $3
GROUP BY DATE_TRUNC('hour', created_at AT TIME ZONE 'UTC')
ORDER BY bucket
`
	return s.queryBuckets(ctx, q, locationID, from, to)
}

// QuerySeriesDay returns daily buckets formatted as "YYYY-MM-DD".
func (s *Store) QuerySeriesDay(ctx context.Context, locationID string, from, to time.Time) ([]SeriesBucket, error) {
	const q = `
SELECT
    TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
    COALESCE(SUM(total_cents), 0)::bigint                                    AS sales_cents,
    COUNT(*)::bigint                                                          AS order_count
FROM orders
WHERE location_id = $1
  AND status = 'completed'
  AND created_at >= $2
  AND created_at <  $3
GROUP BY DATE_TRUNC('day', created_at AT TIME ZONE 'UTC')
ORDER BY bucket
`
	return s.queryBuckets(ctx, q, locationID, from, to)
}

// QuerySeriesMonth returns monthly buckets formatted as "YYYY-MM".
func (s *Store) QuerySeriesMonth(ctx context.Context, locationID string, from, to time.Time) ([]SeriesBucket, error) {
	const q = `
SELECT
    TO_CHAR(DATE_TRUNC('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS bucket,
    COALESCE(SUM(total_cents), 0)::bigint                                   AS sales_cents,
    COUNT(*)::bigint                                                         AS order_count
FROM orders
WHERE location_id = $1
  AND status = 'completed'
  AND created_at >= $2
  AND created_at <  $3
GROUP BY DATE_TRUNC('month', created_at AT TIME ZONE 'UTC')
ORDER BY bucket
`
	return s.queryBuckets(ctx, q, locationID, from, to)
}

func (s *Store) queryBuckets(ctx context.Context, q, locationID string, from, to time.Time) ([]SeriesBucket, error) {
	var buckets []SeriesBucket
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, locationID, from, to)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b SeriesBucket
			if err := rows.Scan(&b.Bucket, &b.SalesCents, &b.OrderCount); err != nil {
				return err
			}
			buckets = append(buckets, b)
		}
		return rows.Err()
	})
	if buckets == nil {
		buckets = []SeriesBucket{}
	}
	return buckets, err
}

// ---------------------------------------------------------------------------
// Heatmap query
// ---------------------------------------------------------------------------

// QueryHeatmap aggregates completed orders over the last `weeks` weeks by
// (DOW, hour). DOW uses EXTRACT(DOW ...) which gives 0=Sunday … 6=Saturday,
// matching the spec. Only cells that have at least one order are returned.
func (s *Store) QueryHeatmap(ctx context.Context, locationID string, weeks int) ([]HeatmapCell, error) {
	const q = `
SELECT
    EXTRACT(DOW  FROM created_at AT TIME ZONE 'UTC')::int  AS dow,
    EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int  AS hour,
    COUNT(*)::bigint                                        AS order_count,
    COALESCE(SUM(total_cents), 0)::bigint                  AS sales_cents
FROM orders
WHERE location_id = $1
  AND status = 'completed'
  AND created_at >= NOW() - ($2::int * INTERVAL '1 week')
GROUP BY
    EXTRACT(DOW  FROM created_at AT TIME ZONE 'UTC'),
    EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')
ORDER BY dow, hour
`
	var cells []HeatmapCell
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, locationID, weeks)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c HeatmapCell
			if err := rows.Scan(&c.DOW, &c.Hour, &c.OrderCount, &c.SalesCents); err != nil {
				return err
			}
			cells = append(cells, c)
		}
		return rows.Err()
	})
	if cells == nil {
		cells = []HeatmapCell{}
	}
	return cells, err
}
