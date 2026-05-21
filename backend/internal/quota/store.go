package quota

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/db"
)

// SetIncluded sets the included_count for the current billing period,
// creating the row if it does not yet exist. This is called by the
// provisioning / plan-change path, not by metering code.
//
// It is separate from Increment so that the billing layer can set the
// allowance independently of metered usage.
func (c *Checker) SetIncluded(ctx context.Context, orgID, locationID, resource string, included int64) error {
	start, end := currentPeriod()
	return db.Scoped(ctx, c.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
INSERT INTO quota_usage (
    organization_id, location_id, resource,
    period_start, period_end,
    used_count, included_count
) VALUES ($1, $2, $3, $4, $5, 0, $6)
ON CONFLICT (organization_id, location_id, resource, period_start)
DO UPDATE SET
    included_count = EXCLUDED.included_count,
    updated_at     = now()
`,
			orgID, locationID, resource,
			start, end,
			included,
		)
		return err
	})
}

// ListPeriod returns all quota_usage rows for an org/location pair for the
// current billing period. Useful for billing dashboards and operator tooling.
func (c *Checker) ListPeriod(ctx context.Context, orgID, locationID string) ([]PeriodRow, error) {
	start, _ := currentPeriod()
	var rows []PeriodRow
	err := db.Scoped(ctx, c.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		pgrows, err := tx.Query(ctx, `
SELECT resource, period_start, period_end, used_count, included_count, updated_at
FROM quota_usage
WHERE organization_id = $1
  AND location_id      = $2
  AND period_start     = $3
ORDER BY resource
`,
			orgID, locationID, start,
		)
		if err != nil {
			return err
		}
		defer pgrows.Close()

		for pgrows.Next() {
			var r PeriodRow
			if err := pgrows.Scan(
				&r.Resource, &r.PeriodStart, &r.PeriodEnd,
				&r.UsedCount, &r.IncludedCount, &r.UpdatedAt,
			); err != nil {
				return err
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

