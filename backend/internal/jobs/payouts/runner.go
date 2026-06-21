package payouts

import (
	"context"
	"encoding/hex"
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
//
// Overlap-safety: both the immediate-on-start call and every subsequent hourly
// tick go through RunOnce, which holds a global pg_try_advisory_lock for the
// duration of the sweep. If a previous tick is still running when the next
// fires, the new tick simply skips (tries the lock, finds it taken, returns).
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

// runnerAdvisoryLockKey is a stable session-level advisory lock key that
// prevents concurrent RunOnce calls (e.g. the immediate boot call overlapping
// the first tick, or two replicas running simultaneously).
//
// 0xBEEF_00_50 — "BEEF" prefix is the project convention; 0x50 = 80 decimal,
// chosen to match the migration number 050+ range for this job.
const runnerAdvisoryLockKey = int64(0xBEEF_0050)

// RunOnce processes every payout_schedule whose next_run_at <= now() and is
// active. For each due schedule it:
//  1. Holds a global advisory lock so concurrent RunOnce calls skip cleanly.
//  2. Finds the merchant's bank account.
//  3. SUMs eligible order_payments (respecting hold_period_hours).
//  4. Deducts beepbite_payment_fees of kind='transaction' already captured.
//  5. Applies the tier's payout fee.
//  6. Inserts a merchant_payouts row in 'initiated' state (or reconciles an
//     existing in-flight row from a prior crash) BEFORE calling Paystack.
//  7. Calls Paystack CreateTransfer using the payout row's id-derived reference.
//     Paystack rejects duplicate references, so a retry can never double-transfer.
//  8. Stores the provider_transfer_id and a beepbite_payment_fees 'payout' row
//     IN THE SAME TRANSACTION — making step 8 crash-atomic with step 6.
//  9. Advances next_run_at.
func (r *Runner) RunOnce(ctx context.Context) error {
	// ── Global advisory lock: only one RunOnce at a time ──────────────────────
	// We acquire a dedicated connection and hold it open for the duration so the
	// session-level advisory lock stays alive.
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("payouts: acquire conn for advisory lock: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, runnerAdvisoryLockKey,
	).Scan(&locked); err != nil {
		return fmt.Errorf("payouts: pg_try_advisory_lock: %w", err)
	}
	if !locked {
		log.Println("payouts: RunOnce advisory lock held by another instance — skipping")
		return nil
	}
	defer func() {
		if _, unlockErr := conn.Exec(ctx,
			`SELECT pg_advisory_unlock($1)`, runnerAdvisoryLockKey,
		); unlockErr != nil {
			log.Printf("payouts: advisory unlock: %v", unlockErr)
		}
	}()

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

// processSchedule runs a single payout schedule end-to-end.
//
// Idempotency invariant (maintained after this change):
//
//  1. A merchant_payouts row is inserted in 'initiated' state BEFORE any
//     Paystack API call.  The row carries a stable payout_reference derived
//     from the schedule id and period window.
//
//  2. The existing UNIQUE (location_id, period_start, period_end) constraint
//     means a second attempt for the same window cannot insert a new row —
//     ON CONFLICT returns the pre-existing row's id and status.
//
//  3. If the pre-existing row is already 'completed' or has a
//     provider_transfer_id set (from a successful prior run that crashed before
//     advancing the cursor), we skip Paystack and go straight to advancing.
//
//  4. If the pre-existing row is in 'initiated'/'processing' (crashed after
//     Paystack but before finalisation), we reconcile via GetTransfer so we
//     never call CreateTransfer twice for the same window.
//
//  5. finaliseTransfer and advanceSchedule are called in the SAME db.Scoped
//     transaction, so a crash between them cannot leave the cursor un-advanced
//     while payment fees are already marked as paid.
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

	// 4. Resolve location_id for Paystack client (use first payment's location
	//    or fall back to any location under the org).
	locationID, err := r.resolveLocationID(ctx, sched)
	if err != nil {
		return fmt.Errorf("resolve location_id: %w", err)
	}

	// 5. Idempotent upsert of the merchant_payouts row.
	//
	// We INSERT the row (status='initiated') BEFORE summing payments so that
	// re-entrant calls see the existing row.  ON CONFLICT returns the pre-
	// existing id + status so we can decide whether to reconcile or skip.
	//
	// The stable payout_reference is "payout-<scheduleID[:8]>-<periodStart ISO>",
	// written into merchant_payouts.payout_reference and used as the Paystack
	// transfer reference.  Paystack rejects any CreateTransfer call that
	// re-uses a reference it already accepted, making double-transfers impossible
	// even if the ON CONFLICT guard somehow fails.
	payoutRef := buildPayoutReference(sched.ID, periodStart)

	payoutID, existingStatus, existingTransferCode, err := r.upsertMerchantPayout(
		ctx, sched, bank, plan, periodStart, holdCutoff, payoutRef)
	if err != nil {
		return fmt.Errorf("upsert merchant_payout: %w", err)
	}

	// 6. Reconcile in-flight rows from prior crashes.
	switch existingStatus {
	case "completed", "paid":
		// A prior run completed fully (including Paystack transfer) but crashed
		// before advancing the cursor.  Skip everything — just advance.
		log.Printf("payouts: schedule %s payout %s already %s — advancing cursor only",
			sched.ID, payoutID, existingStatus)
		return r.advanceSchedule(ctx, sched)

	case "initiated", "processing":
		if existingTransferCode != "" {
			// We have a transfer code but finalisation did not complete.
			// Reconcile against Paystack before deciding whether to call
			// CreateTransfer again.
			if reconcileErr := r.reconcileInFlight(ctx, payoutID, locationID, existingTransferCode, sched, plan, payoutRef); reconcileErr != nil {
				return fmt.Errorf("reconcile in-flight payout: %w", reconcileErr)
			}
			return r.advanceSchedule(ctx, sched)
		}
		// No transfer code yet — fall through to sum + transfer below.

	case "failed":
		// A prior run failed explicitly.  We will retry below by re-summing
		// and calling CreateTransfer with the same payout_reference (Paystack
		// will accept it because the previous attempt did not go through).
	}

	// 7. SUM eligible payments gross (only if we still need to initiate).
	grossCents, paymentIDs, err := r.sumEligiblePayments(ctx, sched, periodStart, holdCutoff)
	if err != nil {
		return fmt.Errorf("sum payments: %w", err)
	}

	if grossCents < sched.MinimumPayoutCents || grossCents == 0 {
		// Not enough to pay out — mark failed (no money), advance the schedule.
		_ = r.markPayoutFailed(ctx, payoutID, "gross below minimum payout threshold")
		return r.advanceSchedule(ctx, sched)
	}

	// 8. SUM already-captured transaction fees for those payments.
	txnFeesCents, err := r.sumTransactionFees(ctx, paymentIDs)
	if err != nil {
		return fmt.Errorf("sum transaction fees: %w", err)
	}

	// 9. Compute payout fee (percentage + fixed) against gross-after-txn-fees.
	afterTxnFees := grossCents - txnFeesCents
	if afterTxnFees < 0 {
		afterTxnFees = 0
	}
	payoutFeeCents := int64(math.Round(float64(afterTxnFees)*plan.PayoutFeePct/100.0)) + plan.PayoutFeeFixed
	netPayout := afterTxnFees - payoutFeeCents
	if netPayout < 0 {
		netPayout = 0
	}

	// Update the payout row with computed amounts (the upsert used zeros as
	// placeholders since we hadn't summed yet).
	if err := r.updatePayoutAmounts(ctx, payoutID, grossCents, txnFeesCents, netPayout, payoutFeeCents); err != nil {
		return fmt.Errorf("update payout amounts: %w", err)
	}

	// 10. Call Paystack transfer API.
	client, _, paystackErr := r.paystack.ForLocation(ctx, r.db, locationID)
	if paystackErr != nil {
		_ = r.markPayoutFailed(ctx, payoutID, paystackErr.Error())
		return fmt.Errorf("paystack client: %w", paystackErr)
	}

	reason := fmt.Sprintf("BeepBite payout — period %s to %s — ref %s",
		periodStart.Format("2006-01-02"), holdCutoff.Format("2006-01-02"), payoutRef)
	transferCode, transferErr := client.CreateTransfer(ctx, netPayout, *bank.ProviderRecipientID, reason)
	if transferErr != nil {
		_ = r.markPayoutFailed(ctx, payoutID, transferErr.Error())
		return fmt.Errorf("CreateTransfer: %w", transferErr)
	}

	// 11. Finalise the transfer AND advance the cursor in one atomic transaction.
	//
	// CRASH-SAFETY INVARIANT: finaliseAndAdvance runs inside a single
	// db.Scoped transaction.  Either both the payout fee rows AND the cursor
	// advance commit together, or neither does.  This closes the window where
	// the cursor stays at periodStart while payments are already marked as
	// paid-out (which caused the original double-payout bug).
	if err := r.finaliseAndAdvance(ctx, payoutID, transferCode, sched, plan, paymentIDs, payoutFeeCents); err != nil {
		return fmt.Errorf("finalise+advance: %w", err)
	}

	return nil
}

// buildPayoutReference builds a stable, unique string for a payout window.
// Format: "payout-<first8charsOfScheduleID>-<YYYYMMDD>" using periodStart.
// This string is stored in merchant_payouts.payout_reference and (when the
// Paystack client is extended to accept a reference) passed to CreateTransfer.
// Paystack deduplicates on this field, so a retry with the same reference is
// rejected rather than creating a second transfer.
func buildPayoutReference(scheduleID string, periodStart time.Time) string {
	// Use the first 8 bytes of the schedule UUID (hex-encoded = 16 chars),
	// stripped of hyphens, to keep the reference short and URL-safe.
	clean := scheduleID
	if len(clean) > 8 {
		// Remove hyphens, take first 16 hex chars.
		var b []byte
		for _, c := range clean {
			if c != '-' {
				b = append(b, byte(c))
			}
		}
		if len(b) > 16 {
			b = b[:16]
		}
		clean = string(b)
	}
	return fmt.Sprintf("payout-%s-%s", clean, periodStart.UTC().Format("20060102"))
}

// scheduleAdvisoryKey converts a schedule UUID string to a stable int64
// suitable for pg_advisory_xact_lock, using the first 8 bytes of the hex.
// This provides per-schedule locking within the already-global RunOnce lock;
// it is kept here in case per-schedule fine-grained locking is needed in future.
func scheduleAdvisoryKey(scheduleID string) int64 {
	// Strip hyphens from UUID and parse first 8 bytes as big-endian int64.
	var raw []byte
	for _, c := range scheduleID {
		if c != '-' {
			raw = append(raw, byte(c))
		}
	}
	if len(raw) < 16 {
		return 0
	}
	b, err := hex.DecodeString(string(raw[:16]))
	if err != nil || len(b) < 8 {
		return 0
	}
	var v int64
	for i := 0; i < 8; i++ {
		v = (v << 8) | int64(b[i])
	}
	return v
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

// upsertMerchantPayout inserts a merchant_payouts row in 'initiated' state, or
// on conflict (location_id, period_start, period_end) returns the existing row's
// id, status, and provider_transfer_id.  Amounts are written as 0 here and
// updated by updatePayoutAmounts once we have summed the payments.
//
// The payout_reference is stored so that (a) we can pass it to Paystack as an
// idempotency key and (b) a reconciliation pass can look it up.
func (r *Runner) upsertMerchantPayout(
	ctx context.Context,
	sched payoutScheduleRow,
	bank *bankAccountRow,
	plan *orgPlanRow,
	periodStart, periodEnd time.Time,
	payoutRef string,
) (id, status, transferCode string, err error) {
	err = db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO merchant_payouts (
    location_id,
    period_start, period_end,
    total_sales_cents, total_fees_cents, net_payout_cents,
    payout_status,
    payout_reference,
    bank_account_id, subscription_plan_id, payout_fee_cents,
    provider, initiated_at
) VALUES (
    $1,
    $2, $3,
    0, 0, 0,
    'initiated',
    $4,
    $5, $6, 0,
    'paystack', now()
)
ON CONFLICT (location_id, period_start, period_end) DO UPDATE
    -- Touch nothing; just let us RETURNING the pre-existing row.
    SET updated_at = merchant_payouts.updated_at
RETURNING id, payout_status, COALESCE(provider_transfer_id, '')
`,
			sched.LocationID,
			periodStart.UTC(), periodEnd.UTC(),
			payoutRef,
			bank.ID, plan.SubscriptionPlanID,
		).Scan(&id, &status, &transferCode)
	})
	return id, status, transferCode, err
}

// updatePayoutAmounts writes the computed amounts onto a merchant_payouts row
// that was initially inserted with zeros by upsertMerchantPayout.
func (r *Runner) updatePayoutAmounts(
	ctx context.Context,
	payoutID string,
	grossCents, txnFeesCents, netPayoutCents, payoutFeeCents int64,
) error {
	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE merchant_payouts
SET total_sales_cents = $2,
    total_fees_cents  = $3,
    net_payout_cents  = $4,
    payout_fee_cents  = $5
WHERE id = $1
`, payoutID, grossCents, txnFeesCents, netPayoutCents, payoutFeeCents)
		return err
	})
}

// reconcileInFlight checks a Paystack transfer whose code we already have but
// whose finalisation did not complete in the DB.  If the transfer succeeded we
// finalise it now; otherwise we leave it for the next scheduled run.
func (r *Runner) reconcileInFlight(
	ctx context.Context,
	payoutID, locationID, transferCode string,
	sched payoutScheduleRow,
	plan *orgPlanRow,
	payoutRef string,
) error {
	client, _, paystackErr := r.paystack.ForLocation(ctx, r.db, locationID)
	if paystackErr != nil {
		return fmt.Errorf("paystack client for reconciliation: %w", paystackErr)
	}

	detail, err := client.GetTransfer(ctx, transferCode)
	if err != nil {
		return fmt.Errorf("GetTransfer(%s): %w", transferCode, err)
	}

	log.Printf("payouts: reconcile payout %s transfer %s status=%s", payoutID, transferCode, detail.Status)

	switch detail.Status {
	case "success":
		// The transfer went through — finalise the DB records.
		// We need to re-fetch the payment IDs for this window so we can write
		// the payout fee rows.  Use an empty slice if none found (the unique
		// constraint on beepbite_payment_fees will guard against duplication).
		paymentIDs, err := r.paymentIDsForPayout(ctx, payoutID)
		if err != nil {
			return fmt.Errorf("load payment IDs for reconciliation: %w", err)
		}
		var payoutFeeCents int64
		if err := r.loadPayoutFeeCents(ctx, payoutID, &payoutFeeCents); err != nil {
			return fmt.Errorf("load payout fee cents for reconciliation: %w", err)
		}
		return r.markPayoutComplete(ctx, payoutID, transferCode, sched.OrganizationID, plan.SubscriptionPlanID, paymentIDs, payoutFeeCents)

	case "failed", "reversed":
		return r.markPayoutFailed(ctx, payoutID, fmt.Sprintf("Paystack transfer %s status=%s", transferCode, detail.Status))

	default:
		// Still pending / processing — leave it; next run will reconcile again.
		log.Printf("payouts: payout %s transfer %s still %s — will retry next run", payoutID, transferCode, detail.Status)
		return nil
	}
}

// paymentIDsForPayout retrieves the order_payment IDs associated with a payout
// via their beepbite_payment_fees 'payout' rows.  Used during reconciliation.
func (r *Runner) paymentIDsForPayout(ctx context.Context, payoutID string) ([]string, error) {
	// The merchant_payout_items table links payout → payments.
	// If that table is not populated, fall back to an empty slice.
	var ids []string
	err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT DISTINCT order_payment_id::text
FROM beepbite_payment_fees
WHERE fee_kind = 'payout'
  AND order_payment_id IN (
      SELECT order_payment_id FROM merchant_payout_items WHERE payout_id = $1
  )
`, payoutID)
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
	return ids, err
}

// loadPayoutFeeCents reads the payout_fee_cents from the payout row.
func (r *Runner) loadPayoutFeeCents(ctx context.Context, payoutID string, out *int64) error {
	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT payout_fee_cents FROM merchant_payouts WHERE id = $1`, payoutID).Scan(out)
	})
}

// finaliseAndAdvance writes the Paystack transfer code, inserts the payout-kind
// fee rows for each payment, and advances the schedule cursor — ALL inside a
// single transaction.
//
// CRASH INVARIANT: Either all three succeed together, or none do.  This
// prevents the cursor from being left un-advanced while payments are already
// marked as paid out, which was the root cause of the double-payout bug.
func (r *Runner) finaliseAndAdvance(
	ctx context.Context,
	payoutID, transferCode string,
	sched payoutScheduleRow,
	plan *orgPlanRow,
	paymentIDs []string,
	payoutFeeCents int64,
) error {
	nextRun := computeNextRun(sched)

	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// a) Update merchant_payouts with the transfer code and mark completed.
		_, err := tx.Exec(ctx, `
UPDATE merchant_payouts
SET provider_transfer_id     = $2,
    provider_transfer_status = 'initiated',
    payout_status            = 'processing'
WHERE id = $1
`, payoutID, transferCode)
		if err != nil {
			return fmt.Errorf("update merchant_payout: %w", err)
		}

		// b) Insert payout-kind fee for each payment so they are excluded from
		//    future sumEligiblePayments calls.
		for i, pid := range paymentIDs {
			feeAmt := int64(0)
			if i == 0 {
				feeAmt = payoutFeeCents
			}
			if _, insErr := tx.Exec(ctx, `
INSERT INTO beepbite_payment_fees
    (order_payment_id, organization_id, subscription_plan_id, fee_kind, fee_amount_cents)
VALUES ($1, $2, $3, 'payout', $4)
ON CONFLICT (order_payment_id, fee_kind) DO NOTHING
`, pid, sched.OrganizationID, plan.SubscriptionPlanID, feeAmt); insErr != nil {
				return fmt.Errorf("insert payout fee for payment %s: %w", pid, insErr)
			}
		}

		// c) Advance the schedule — same transaction as (a) and (b).
		if _, err := tx.Exec(ctx, `
UPDATE payout_schedules
SET last_run_at = now(), next_run_at = $2, updated_at = now()
WHERE id = $1
`, sched.ID, nextRun); err != nil {
			return fmt.Errorf("advance schedule %s: %w", sched.ID, err)
		}

		return nil
	})
}

// markPayoutComplete updates a payout row to 'completed' state and inserts
// payout-fee rows for the associated payments.  Used during reconciliation.
func (r *Runner) markPayoutComplete(
	ctx context.Context,
	payoutID, transferCode, orgID, planID string,
	paymentIDs []string,
	payoutFeeCents int64,
) error {
	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE merchant_payouts
SET provider_transfer_id     = $2,
    provider_transfer_status = 'success',
    payout_status            = 'completed',
    completed_at             = now()
WHERE id = $1
`, payoutID, transferCode)
		if err != nil {
			return fmt.Errorf("update merchant_payout: %w", err)
		}

		for i, pid := range paymentIDs {
			feeAmt := int64(0)
			if i == 0 {
				feeAmt = payoutFeeCents
			}
			if _, insErr := tx.Exec(ctx, `
INSERT INTO beepbite_payment_fees
    (order_payment_id, organization_id, subscription_plan_id, fee_kind, fee_amount_cents)
VALUES ($1, $2, $3, 'payout', $4)
ON CONFLICT (order_payment_id, fee_kind) DO NOTHING
`, pid, orgID, planID, feeAmt); insErr != nil {
				return fmt.Errorf("insert payout fee %s: %w", pid, insErr)
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
