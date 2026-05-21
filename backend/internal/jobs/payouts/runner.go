package payouts

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/integrations/paystack"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Runner polls payout_schedules once per hour and initiates Paystack transfers
// for any schedule whose next_run_at is due.
type Runner struct {
	db       *pgxpool.Pool
	paystack *paystack.Manager
}

// NewRunner constructs a Runner. Both db and paystackMgr are required.
func NewRunner(pool *pgxpool.Pool, paystackMgr *paystack.Manager) *Runner {
	return &Runner{db: pool, paystack: paystackMgr}
}

// Start launches the background polling loop. The loop ticks once per hour and
// calls RunOnce. It exits cleanly when ctx is cancelled.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()

		// Run immediately on start so we don't wait an hour on first launch.
		if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("payouts: RunOnce error: %v", err)
		}

		for {
			select {
			case <-ctx.Done():
				log.Println("payouts: Runner shutting down")
				return
			case <-ticker.C:
				if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("payouts: RunOnce error: %v", err)
				}
			}
		}
	}()
}

// RunOnce processes every payout_schedule whose next_run_at <= now() and is
// active. For each due schedule it:
//  1. Finds the merchant's bank account.
//  2. SUMs eligible order_payments (respecting hold_period_hours).
//  3. Deducts beepbite_payment_fees of kind='transaction' already captured.
//  4. Applies the tier's payout fee.
//  5. Inserts a merchant_payouts row (status='initiated').
//  6. Calls Paystack CreateTransfer.
//  7. Stores the provider_transfer_id and a beepbite_payment_fees row of kind='payout'.
//  8. Advances next_run_at.
func (r *Runner) RunOnce(ctx context.Context) error {
	schedules, err := r.loadDueSchedules(ctx)
	if err != nil {
		return fmt.Errorf("payouts: load due schedules: %w", err)
	}

	for _, sched := range schedules {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if procErr := r.processSchedule(ctx, sched); procErr != nil {
			// Log per-schedule errors but continue processing others.
			log.Printf("payouts: schedule %s (org=%s): %v", sched.ID, sched.OrganizationID, procErr)
		}
	}
	return nil
}

// ---- internal helpers ------------------------------------------------------

func (r *Runner) loadDueSchedules(ctx context.Context) ([]payoutScheduleRow, error) {
	var out []payoutScheduleRow
	err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT
    id, organization_id, location_id,
    cadence, day_of_week, day_of_month, run_at_hour,
    minimum_payout_cents, hold_period_hours,
    last_run_at, next_run_at
FROM payout_schedules
WHERE is_active = true
  AND next_run_at IS NOT NULL
  AND next_run_at <= now()
ORDER BY next_run_at ASC
`)
		if err != nil {
			return fmt.Errorf("query: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var s payoutScheduleRow
			if err := rows.Scan(
				&s.ID, &s.OrganizationID, &s.LocationID,
				&s.Cadence, &s.DayOfWeek, &s.DayOfMonth, &s.RunAtHour,
				&s.MinimumPayoutCents, &s.HoldPeriodHours,
				&s.LastRunAt, &s.NextRunAt,
			); err != nil {
				return fmt.Errorf("scan: %w", err)
			}
			out = append(out, s)
		}
		return rows.Err()
	})
	return out, err
}

func (r *Runner) processSchedule(ctx context.Context, sched payoutScheduleRow) error {
	// 1. Resolve the bank account for this org/location.
	bank, err := r.loadBankAccount(ctx, sched.OrganizationID, sched.LocationID)
	if err != nil {
		return fmt.Errorf("load bank account: %w", err)
	}
	if bank.ProviderRecipientID == nil || *bank.ProviderRecipientID == "" {
		return fmt.Errorf("bank account %s has no provider_recipient_id — skipping", bank.ID)
	}

	// 2. Load the org's subscription plan.
	plan, err := r.loadOrgPlan(ctx, sched.OrganizationID)
	if err != nil {
		return fmt.Errorf("load org plan: %w", err)
	}

	// 3. Determine the period: since last_run_at (or 30 days ago) up to now
	//    minus the hold window.
	holdCutoff := time.Now().UTC().Add(-time.Duration(sched.HoldPeriodHours) * time.Hour)
	var periodStart time.Time
	if sched.LastRunAt != nil {
		periodStart = *sched.LastRunAt
	} else {
		periodStart = holdCutoff.AddDate(0, 0, -30)
	}

	// 4. SUM eligible payments gross.
	var grossCents int64
	var paymentIDs []string
	grossCents, paymentIDs, err = r.sumEligiblePayments(ctx, sched, periodStart, holdCutoff)
	if err != nil {
		return fmt.Errorf("sum payments: %w", err)
	}

	if grossCents < sched.MinimumPayoutCents || grossCents == 0 {
		// Not enough to pay out — still advance the schedule.
		return r.advanceSchedule(ctx, sched)
	}

	// 5. SUM already-captured transaction fees for those payments.
	txnFeesCents, err := r.sumTransactionFees(ctx, paymentIDs)
	if err != nil {
		return fmt.Errorf("sum transaction fees: %w", err)
	}

	// 6. Compute payout fee (percentage + fixed) against gross-after-txn-fees.
	afterTxnFees := grossCents - txnFeesCents
	if afterTxnFees < 0 {
		afterTxnFees = 0
	}
	payoutFeeCents := int64(math.Round(float64(afterTxnFees)*plan.PayoutFeePct/100.0)) + plan.PayoutFeeFixed
	netPayout := afterTxnFees - payoutFeeCents
	if netPayout < 0 {
		netPayout = 0
	}

	// 7. Resolve location_id for Paystack client (use first payment's location
	//    or fall back to any location under the org).
	locationID, err := r.resolveLocationID(ctx, sched)
	if err != nil {
		return fmt.Errorf("resolve location_id: %w", err)
	}

	// 8. Insert merchant_payouts row (status='initiated').
	payoutID, err := r.insertMerchantPayout(ctx, sched, bank, plan, periodStart, holdCutoff,
		grossCents, txnFeesCents, netPayout, payoutFeeCents)
	if err != nil {
		return fmt.Errorf("insert merchant_payout: %w", err)
	}

	// 9. Call Paystack transfer API.
	client, _, paystackErr := r.paystack.ForLocation(ctx, r.db, locationID)
	if paystackErr != nil {
		_ = r.markPayoutFailed(ctx, payoutID, paystackErr.Error())
		return fmt.Errorf("paystack client: %w", paystackErr)
	}

	reason := fmt.Sprintf("BeepBite weekly payout — period %s to %s",
		periodStart.Format("2006-01-02"), holdCutoff.Format("2006-01-02"))
	transferCode, transferErr := client.CreateTransfer(ctx, netPayout, *bank.ProviderRecipientID, reason)
	if transferErr != nil {
		_ = r.markPayoutFailed(ctx, payoutID, transferErr.Error())
		return fmt.Errorf("CreateTransfer: %w", transferErr)
	}

	// 10. Store transfer_code and payout fee row.
	if err := r.finaliseTransfer(ctx, payoutID, transferCode, sched.OrganizationID, plan.SubscriptionPlanID, paymentIDs, payoutFeeCents); err != nil {
		return fmt.Errorf("finalise transfer: %w", err)
	}

	// 11. Advance schedule.
	return r.advanceSchedule(ctx, sched)
}

func (r *Runner) loadBankAccount(ctx context.Context, orgID string, locationID *string) (*bankAccountRow, error) {
	var row bankAccountRow

	err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		if locationID != nil {
			// Prefer the location-specific bank account when one exists.
			err = tx.QueryRow(ctx, `
SELECT id, organization_id, location_id, provider_recipient_id
FROM bank_accounts
WHERE organization_id = $1
  AND location_id = $2
  AND is_active = true
ORDER BY is_default DESC, created_at ASC
LIMIT 1
`, orgID, *locationID).Scan(&row.ID, &row.OrganizationID, &row.LocationID, &row.ProviderRecipientID)
		}

		if locationID == nil || errors.Is(err, pgx.ErrNoRows) {
			// Fall back to the org-level (location_id IS NULL) default.
			err = tx.QueryRow(ctx, `
SELECT id, organization_id, location_id, provider_recipient_id
FROM bank_accounts
WHERE organization_id = $1
  AND location_id IS NULL
  AND is_active = true
ORDER BY is_default DESC, created_at ASC
LIMIT 1
`, orgID).Scan(&row.ID, &row.OrganizationID, &row.LocationID, &row.ProviderRecipientID)
		}

		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("no active bank account for org %s", orgID)
			}
			return fmt.Errorf("query: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *Runner) loadOrgPlan(ctx context.Context, orgID string) (*orgPlanRow, error) {
	var row orgPlanRow
	err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT
    org.id                          AS organization_id,
    sp.id                           AS subscription_plan_id,
    sp.transaction_fee_percentage,
    sp.transaction_fee_fixed_cents,
    sp.payout_fee_percentage,
    sp.payout_fee_fixed_cents
FROM organizations org
JOIN subscription_plans sp ON sp.tier_code = org.subscription_tier
WHERE org.id = $1
`, orgID).Scan(
			&row.OrganizationID,
			&row.SubscriptionPlanID,
			&row.TransactionFeePct,
			&row.TransactionFeeFixed,
			&row.PayoutFeePct,
			&row.PayoutFeeFixed,
		)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("org %s not found or has no plan", orgID)
		}
		return nil, fmt.Errorf("query: %w", err)
	}
	return &row, nil
}

func (r *Runner) sumEligiblePayments(
	ctx context.Context,
	sched payoutScheduleRow,
	periodStart, holdCutoff time.Time,
) (int64, []string, error) {
	var (
		grossCents int64
		ids        []string
	)

	err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT op.id, op.amount_paid_cents
FROM order_payments op
JOIN orders o ON o.id = op.order_id
JOIN locations l ON l.id = o.location_id
WHERE l.organization_id = $1
  AND ($2::uuid IS NULL OR l.id = $2)
  AND op.payment_status = 'completed'
  AND op.paid_at >= $3
  AND op.paid_at <  $4
  -- Exclude payments already covered by a payout fee (already paid out).
  AND NOT EXISTS (
      SELECT 1 FROM beepbite_payment_fees pf
      WHERE pf.order_payment_id = op.id AND pf.fee_kind = 'payout'
  )
`, sched.OrganizationID, sched.LocationID, periodStart, holdCutoff)
		if err != nil {
			return fmt.Errorf("query: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var id string
			var amt int64
			if err := rows.Scan(&id, &amt); err != nil {
				return fmt.Errorf("scan: %w", err)
			}
			grossCents += amt
			ids = append(ids, id)
		}
		return rows.Err()
	})
	if err != nil {
		return 0, nil, err
	}
	return grossCents, ids, nil
}

func (r *Runner) sumTransactionFees(ctx context.Context, paymentIDs []string) (int64, error) {
	if len(paymentIDs) == 0 {
		return 0, nil
	}
	var total int64
	err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// pgx supports []string as a text[] parameter.
		return tx.QueryRow(ctx, `
SELECT COALESCE(SUM(fee_amount_cents), 0)
FROM beepbite_payment_fees
WHERE order_payment_id = ANY($1::uuid[])
  AND fee_kind = 'transaction'
`, paymentIDs).Scan(&total)
	})
	if err != nil {
		return 0, fmt.Errorf("query: %w", err)
	}
	return total, nil
}

func (r *Runner) resolveLocationID(ctx context.Context, sched payoutScheduleRow) (string, error) {
	if sched.LocationID != nil {
		return *sched.LocationID, nil
	}
	// Pick the first active location for the org.
	var locID string
	err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id FROM locations WHERE organization_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1
`, sched.OrganizationID).Scan(&locID)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("org %s has no active locations", sched.OrganizationID)
		}
		return "", fmt.Errorf("query: %w", err)
	}
	return locID, nil
}

func (r *Runner) insertMerchantPayout(
	ctx context.Context,
	sched payoutScheduleRow,
	bank *bankAccountRow,
	plan *orgPlanRow,
	periodStart, periodEnd time.Time,
	grossCents, totalFeesCents, netPayoutCents, payoutFeeCents int64,
) (string, error) {
	var payoutID string
	err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO merchant_payouts (
    location_id,
    period_start, period_end,
    total_sales_cents, total_fees_cents, net_payout_cents,
    payout_status,
    bank_account_id, subscription_plan_id, payout_fee_cents,
    provider, initiated_at
) VALUES (
    $1,
    $2, $3,
    $4, $5, $6,
    'initiated',
    $7, $8, $9,
    'paystack', now()
)
RETURNING id
`,
			sched.LocationID,
			periodStart.UTC(), periodEnd.UTC(),
			grossCents, totalFeesCents, netPayoutCents,
			bank.ID, plan.SubscriptionPlanID, payoutFeeCents,
		).Scan(&payoutID)
	})
	if err != nil {
		return "", fmt.Errorf("insert: %w", err)
	}
	return payoutID, nil
}

func (r *Runner) finaliseTransfer(
	ctx context.Context,
	payoutID, transferCode, orgID, planID string,
	paymentIDs []string,
	payoutFeeCents int64,
) error {
	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Update merchant_payouts with the transfer code.
		_, err := tx.Exec(ctx, `
UPDATE merchant_payouts
SET provider_transfer_id = $2, provider_transfer_status = 'initiated'
WHERE id = $1
`, payoutID, transferCode)
		if err != nil {
			return fmt.Errorf("update merchant_payout: %w", err)
		}

		if len(paymentIDs) == 0 {
			return nil
		}

		// Insert payout-kind fee for each payment so they are marked as paid out.
		for i, pid := range paymentIDs {
			feeAmt := int64(0)
			if i == 0 {
				feeAmt = payoutFeeCents
			}
			_, insErr := tx.Exec(ctx, `
INSERT INTO beepbite_payment_fees
    (order_payment_id, organization_id, subscription_plan_id, fee_kind, fee_amount_cents)
VALUES ($1, $2, $3, 'payout', $4)
ON CONFLICT (order_payment_id, fee_kind) DO NOTHING
`, pid, orgID, planID, feeAmt)
			if insErr != nil {
				return fmt.Errorf("insert payout fee for payment %s: %w", pid, insErr)
			}
		}
		return nil
	})
}

func (r *Runner) markPayoutFailed(ctx context.Context, payoutID, errMsg string) error {
	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE merchant_payouts
SET payout_status = 'failed', provider_transfer_error = $2, failed_at = now()
WHERE id = $1
`, payoutID, errMsg)
		return err
	})
}

func (r *Runner) advanceSchedule(ctx context.Context, sched payoutScheduleRow) error {
	nextRun := computeNextRun(sched)
	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE payout_schedules
SET last_run_at = now(), next_run_at = $2, updated_at = now()
WHERE id = $1
`, sched.ID, nextRun)
		if err != nil {
			return fmt.Errorf("advance schedule %s: %w", sched.ID, err)
		}
		return nil
	})
}

// computeNextRun calculates the next next_run_at based on cadence.
// For 'weekly' it adds 7 days and sets the hour to run_at_hour.
// Other cadences fall back to a simple duration advance.
func computeNextRun(sched payoutScheduleRow) time.Time {
	now := time.Now().UTC()
	h := time.Duration(sched.RunAtHour) * time.Hour

	switch sched.Cadence {
	case "daily":
		base := time.Date(now.Year(), now.Month(), now.Day()+1, sched.RunAtHour, 0, 0, 0, time.UTC)
		return base
	case "weekly":
		base := time.Date(now.Year(), now.Month(), now.Day()+7, sched.RunAtHour, 0, 0, 0, time.UTC)
		return base
	case "biweekly":
		base := time.Date(now.Year(), now.Month(), now.Day()+14, sched.RunAtHour, 0, 0, 0, time.UTC)
		return base
	case "monthly":
		dom := 1
		if sched.DayOfMonth != nil {
			dom = *sched.DayOfMonth
		}
		// Advance to next month, same day-of-month, at run_at_hour.
		next := time.Date(now.Year(), now.Month()+1, dom, sched.RunAtHour, 0, 0, 0, time.UTC)
		return next
	default:
		// Manual / unknown: advance by 7 days.
		return now.Truncate(24 * time.Hour).Add(7*24*time.Hour + h)
	}
}
