package metering

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// UsageSummary is a single quota_usage row for the current period.
type UsageSummary struct {
	Resource      string
	PeriodStart   time.Time
	PeriodEnd     time.Time
	UsedCount     int64
	IncludedCount int64
}

// Store provides read-only helpers for metering data. Writes go through Meter.Record.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store backed by the given connection pool.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// ListPeriodUsage returns all quota_usage rows for an org/location for the
// current billing month. Useful for dashboards and operator tooling.
//
// Runs under service-role scope so it is not filtered by tenant RLS.
func (s *Store) ListPeriodUsage(ctx context.Context, orgID, locationID string) ([]UsageSummary, error) {
	periodStart, _ := currentPeriod()

	var rows []UsageSummary
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		pgrows, err := tx.Query(ctx, `
SELECT resource, period_start, period_end, used_count, included_count
FROM quota_usage
WHERE organization_id = $1
  AND location_id      = $2
  AND period_start     = $3
ORDER BY resource
`,
			orgID, locationID, periodStart,
		)
		if err != nil {
			return fmt.Errorf("metering: list period usage: %w", err)
		}
		defer pgrows.Close()

		for pgrows.Next() {
			var r UsageSummary
			if err := pgrows.Scan(
				&r.Resource,
				&r.PeriodStart,
				&r.PeriodEnd,
				&r.UsedCount,
				&r.IncludedCount,
			); err != nil {
				return fmt.Errorf("metering: scan usage row: %w", err)
			}
			rows = append(rows, r)
		}
		return pgrows.Err()
	})
	if err != nil {
		return nil, err
	}
	return rows, nil
}
