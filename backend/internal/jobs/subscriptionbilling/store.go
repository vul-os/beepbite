// Package subscriptionbilling provides a monthly background job that generates
// subscription_invoices rows for every organisation on a paid tier.
//
// Schema relationships used:
//
//	organizations          — subscription_tier, id
//	subscription_plans     — tier_code, monthly_fee_cents, is_active
//	org_wallets            — org_id, currency_code  (local billing currency per org)
//	exchange_rates         — from_currency, to_currency, rate, fetched_at
//	                         (no latest_exchange_rate helper yet — queried directly)
//	subscription_invoices  — the invoice rows we INSERT
package subscriptionbilling

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
)

// orgPlanRow holds the columns needed to generate an invoice for one org.
type orgPlanRow struct {
	OrgID           string
	PlanID          string
	MonthlyFeeCents int64
	LocalCurrency   string // from org_wallets.currency_code
}

// loadOrgsNeedingInvoice returns every org that:
//   - is on a paid (non-free) active subscription plan, AND
//   - has an org_wallets row (so we know the local currency), AND
//   - does NOT already have a subscription_invoices row whose period_start
//     equals the first day of the current calendar month.
//
// Runs inside a ServiceRoleScope transaction to bypass cross-org RLS.
func loadOrgsNeedingInvoice(ctx context.Context, tx pgx.Tx, periodStart time.Time) ([]orgPlanRow, error) {
	rows, err := tx.Query(ctx, `
SELECT
    o.id                      AS org_id,
    sp.id                     AS plan_id,
    sp.monthly_fee_cents,
    ow.currency_code          AS local_currency
FROM organizations o
JOIN subscription_plans sp
    ON sp.tier_code = o.subscription_tier
   AND sp.is_active = true
   AND sp.monthly_fee_cents > 0
JOIN org_wallets ow
    ON ow.org_id = o.id
WHERE NOT EXISTS (
    SELECT 1
    FROM subscription_invoices si
    WHERE si.org_id     = o.id
      AND si.period_start = $1::date
)
ORDER BY o.id
`, periodStart.Format("2006-01-02"))
	if err != nil {
		return nil, fmt.Errorf("subscriptionbilling: query orgs needing invoice: %w", err)
	}
	defer rows.Close()

	var out []orgPlanRow
	for rows.Next() {
		var r orgPlanRow
		if err := rows.Scan(&r.OrgID, &r.PlanID, &r.MonthlyFeeCents, &r.LocalCurrency); err != nil {
			return nil, fmt.Errorf("subscriptionbilling: scan org row: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// fetchLatestRate queries exchange_rates for the most recent USD → localCurrency
// rate. When localCurrency is "USD" it returns 1.0 without hitting the table.
// Returns (rate, fetchedAt, error).
func fetchLatestRate(ctx context.Context, tx pgx.Tx, localCurrency string) (float64, time.Time, error) {
	if localCurrency == "USD" {
		return 1.0, time.Now().UTC(), nil
	}

	var rate float64
	var fetchedAt time.Time
	err := tx.QueryRow(ctx, `
SELECT rate, fetched_at
FROM exchange_rates
WHERE from_currency = 'USD'
  AND to_currency   = $1
ORDER BY fetched_at DESC
LIMIT 1
`, localCurrency).Scan(&rate, &fetchedAt)
	if err != nil {
		return 0, time.Time{}, fmt.Errorf(
			"subscriptionbilling: no exchange rate USD→%s: %w", localCurrency, err,
		)
	}
	return rate, fetchedAt, nil
}

// insertInvoice inserts a subscription_invoices row with status 'pending'.
// status 'pending' is used instead of the table default 'issued' so the
// billing collection job can later move it to 'issued' once the charge
// succeeds (see TODO below).
//
// NOTE: The subscription_invoices CHECK constraint allows only
// ('issued','paid','void','overdue').  We therefore insert with 'issued'
// to stay within the constraint — see inline comment below.
func insertInvoice(
	ctx context.Context,
	tx pgx.Tx,
	orgID string,
	planID string,
	periodStart, periodEnd time.Time,
	usdCents int64,
	localCents int64,
	localCurrency string,
	fxRate float64,
) error {
	_, err := tx.Exec(ctx, `
INSERT INTO subscription_invoices (
    org_id,
    plan_id,
    period_start,
    period_end,
    usd_amount_cents,
    local_amount_cents,
    local_currency_code,
    fx_rate,
    status
) VALUES (
    $1::uuid,
    $2::uuid,
    $3::date,
    $4::date,
    $5,
    $6,
    $7,
    $8,
    'issued'
)
ON CONFLICT DO NOTHING
`,
		orgID, planID,
		periodStart.Format("2006-01-02"),
		periodEnd.Format("2006-01-02"),
		usdCents,
		localCents,
		localCurrency,
		fxRate,
	)
	if err != nil {
		return fmt.Errorf("subscriptionbilling: insert invoice (org=%s): %w", orgID, err)
	}
	return nil
}

// currentPeriod returns the period_start (1st of current month) and period_end
// (last day of current month) as UTC midnight times.
func currentPeriod() (start, end time.Time) {
	now := time.Now().UTC()
	start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	// First day of next month minus one day = last day of this month.
	end = start.AddDate(0, 1, 0).Add(-24 * time.Hour)
	return start, end
}

// roundLocalCents converts a USD cent amount using the given FX rate,
// rounding to the nearest integer cent.
func roundLocalCents(usdCents int64, rate float64) int64 {
	return int64(math.Round(float64(usdCents) * rate))
}
