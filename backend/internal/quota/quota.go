// Package quota tracks and enforces per-resource usage quotas stored in
// the quota_usage table (created by migration 024).
//
// # RLS / scope choice
//
// All writes and reads in this package use db.ServiceRoleScope() internally.
// Quota accounting must always succeed regardless of the caller's tenant scope
// (a handler may run under a user scope that cannot see quota_usage rows, and
// a failed Increment would silently under-count usage). This mirrors how
// audit_log writes work elsewhere in the codebase. The caller never needs to
// pass a scope parameter.
package quota

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Resource constants for the resource column.
const (
	ResourceOrders          = "orders"
	ResourceWhatsappOut     = "whatsapp_outbound"
	ResourceLLMMessages     = "llm_messages"
	ResourceEmailOutbound   = "email_outbound"
	ResourceBulkImports     = "bulk_imports"
)

// PeriodRow is a single quota_usage row returned by ListPeriod.
type PeriodRow struct {
	Resource      string
	PeriodStart   time.Time
	PeriodEnd     time.Time
	UsedCount     int64
	IncludedCount int64
	UpdatedAt     time.Time
}

// ErrNoUsageRow is returned by Check when no quota_usage row exists yet for
// the current period (i.e. nothing has been incremented). Callers should
// treat this as used=0, included=0 and decide policy accordingly.
var ErrNoUsageRow = errors.New("quota: no usage row for current period")

// Checker provides quota increment and check operations against the
// quota_usage table. All DB operations run under service-role scope so
// that writes always succeed regardless of the caller's tenant RLS scope.
type Checker struct {
	pool *pgxpool.Pool
}

// New creates a Checker backed by the given connection pool.
func New(pool *pgxpool.Pool) *Checker {
	return &Checker{pool: pool}
}

// currentPeriod returns the first and last calendar day of the current UTC
// month as midnight-UTC time.Time values.
func currentPeriod() (start, end time.Time) {
	now := time.Now().UTC()
	start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	// First day of next month, then subtract one day.
	end = time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	return start, end
}

// Increment adds n to the used_count for the current billing period's
// quota_usage row identified by (orgID, locationID, resource). If no row
// exists yet for the current period it is created with included_count = 0
// (the billing layer writes the included_count separately, or a separate
// provisioning step sets it).
//
// The UPSERT is atomic: concurrent callers will serialize on the unique
// index (organization_id, location_id, resource, period_start).
func (c *Checker) Increment(ctx context.Context, orgID, locationID, resource string, n int64) error {
	start, end := currentPeriod()
	return db.Scoped(ctx, c.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
INSERT INTO quota_usage (
    organization_id, location_id, resource,
    period_start, period_end,
    used_count, included_count
) VALUES ($1, $2, $3, $4, $5, $6, 0)
ON CONFLICT (organization_id, location_id, resource, period_start)
DO UPDATE SET
    used_count = quota_usage.used_count + EXCLUDED.used_count,
    updated_at = now()
`,
			orgID, locationID, resource,
			start, end,
			n,
		)
		return err
	})
}

// Usage holds the result of a Check call.
type Usage struct {
	Used     int64
	Included int64
}

// Check returns the current billing period's used_count and included_count
// for the given (orgID, locationID, resource) tuple.
//
// Returns (false, 0, 0, ErrNoUsageRow) when no row exists yet.
// The boolean allowed = used_count <= included_count; the caller may
// override this logic for paid-tier overage billing.
func (c *Checker) Check(ctx context.Context, orgID, locationID, resource string) (allowed bool, used int64, included int64, err error) {
	start, _ := currentPeriod()
	err = db.Scoped(ctx, c.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT used_count, included_count
FROM quota_usage
WHERE organization_id = $1
  AND location_id      = $2
  AND resource         = $3
  AND period_start     = $4
`,
			orgID, locationID, resource, start,
		).Scan(&used, &included)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, 0, 0, ErrNoUsageRow
	}
	if err != nil {
		return false, 0, 0, err
	}
	return used <= included, used, included, nil
}

// Remaining returns max(0, included - used). It is a convenience helper
// so callers do not need to repeat the subtraction and clamp.
func Remaining(used, included int64) int64 {
	r := included - used
	if r < 0 {
		return 0
	}
	return r
}
