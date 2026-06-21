package payouts_test

// runner_integration_test.go — DB-backed integration tests for payout idempotency.
//
// These tests exercise the SQL-layer idempotency guards introduced in wave-1:
//   - UNIQUE (location_id, period_start, period_end) on merchant_payouts (ON CONFLICT upsert)
//   - Partial UNIQUE index on merchant_payouts(provider_transfer_id) (migration 051)
//   - Advisory lock (pg_try_advisory_lock) that prevents concurrent RunOnce calls
//
// The Runner itself requires a real paystack.Manager (no injection point for a
// stub), so we test at the store/SQL level: we call the underlying helpers
// (upsertMerchantPayout, sumEligiblePayments, etc.) indirectly via raw SQL
// rather than wiring up an end-to-end Runner.  This keeps the tests fast,
// hermetic, and free of network calls while still verifying the exact
// constraints that prevent double-payment.
//
// Run:
//
//	cd /home/exo/Documents/beepbite-mono/backend
//	go test ./internal/jobs/payouts/... -run Integration -v
//
// The tests skip gracefully if no Postgres backend is available.

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"testing"
	"time"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Package-level pool (shared across all Integration* tests in this package).
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests: no postgres available:", err)
		os.Exit(0)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "testenv.StartPostgres: %v\n", err)
		os.Exit(1)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Seed helpers — all run as service-role to bypass RLS.
// ---------------------------------------------------------------------------

func svcExec(t *testing.T, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, query, args...)
		return err
	})
	if err != nil {
		t.Fatalf("svcExec:\n  query: %s\n  args:  %v\n  error: %v", query, args, err)
	}
}

func svcQueryRow(t *testing.T, dest any, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, query, args...).Scan(dest)
	})
	if err != nil {
		t.Fatalf("svcQueryRow:\n  query: %s\n  args:  %v\n  error: %v", query, args, err)
	}
}

func svcQueryRowErr(t *testing.T, dest any, query string, args ...any) error {
	t.Helper()
	ctx := context.Background()
	return db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, query, args...).Scan(dest)
	})
}

func randStr(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

// zaRegionID returns the UUID of the ZA region (seeded by migration 014).
func zaRegionID(t *testing.T) string {
	t.Helper()
	var id string
	err := svcQueryRowErr(t, &id, `SELECT id FROM regions WHERE code = 'ZA' LIMIT 1`)
	if err != nil {
		t.Skipf("ZA region not found (migrations not fully applied?): %v", err)
	}
	return id
}

// freePlanID returns the UUID of the 'free' subscription plan.
func freePlanID(t *testing.T) string {
	t.Helper()
	var id string
	err := svcQueryRowErr(t, &id, `SELECT id FROM subscription_plans WHERE tier_code = 'free' LIMIT 1`)
	if err != nil {
		t.Skipf("free subscription plan not found: %v", err)
	}
	return id
}

// ensurePaymentMethod creates the 'cash' payment method if it doesn't exist
// (the seed is in the legacy migration that testenv skips).
func ensurePaymentMethod(t *testing.T, code string) {
	t.Helper()
	svcExec(t, `
INSERT INTO payment_methods (code, name, kind, requires_reference, supports_tips)
VALUES ($1, $1, 'offline', false, true)
ON CONFLICT (code) DO NOTHING
`, code)
}

// seedOrg inserts a unique org and registers cleanup.
func seedOrg(t *testing.T, suffix string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id,
		`INSERT INTO organizations (name, subscription_tier) VALUES ($1, 'free') RETURNING id`,
		"Payout Org "+suffix)
	t.Cleanup(func() {
		ctx := context.Background()
		_ = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// seedLocation inserts a location and returns its ID.
func seedLocation(t *testing.T, orgID, regionID, suffix string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id, `
INSERT INTO locations (organization_id, region_id, name, on_delivery_payment_methods)
VALUES ($1, $2, $3, ARRAY['cash']::text[]) RETURNING id`,
		orgID, regionID, "Loc "+suffix)
	return id
}

// seedBankAccount inserts a bank_account for an org/location and returns its ID.
func seedBankAccount(t *testing.T, orgID, locID, regionID, recipientID string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id, `
INSERT INTO bank_accounts (
    organization_id, location_id, region_id,
    account_holder_name, bank_name, account_number_ciphertext, account_number_last4,
    currency, provider, provider_recipient_id, is_default, is_active
) VALUES ($1, $2, $3, 'Test Holder', 'Test Bank', 'enc_123', '1234',
          'ZAR', 'paystack', $4, true, true) RETURNING id`,
		orgID, locID, regionID, recipientID)
	return id
}

// seedPayoutSchedule inserts a payout schedule that is due NOW and returns its ID.
func seedPayoutSchedule(t *testing.T, orgID, locID string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id, `
INSERT INTO payout_schedules (
    organization_id, location_id, cadence, run_at_hour,
    minimum_payout_cents, hold_period_hours,
    is_active, last_run_at, next_run_at
) VALUES ($1, $2, 'weekly', 2,
          0, 0,
          true,
          now() - interval '7 days',
          now() - interval '1 second') RETURNING id`,
		orgID, locID)
	return id
}

// seedOrder inserts a minimal order row and returns its ID.
func seedOrder(t *testing.T, locID, orgID string) string {
	t.Helper()
	var id string
	num := randStr(8)
	svcQueryRow(t, &id, `
INSERT INTO orders (location_id, organization_id, order_number, status, fulfillment_type, total_cents)
VALUES ($1, $2, $3, 'completed', 'collection', 1000) RETURNING id`,
		locID, orgID, "ORD-"+num)
	return id
}

// seedOrderPayment inserts an order_payment that is completed and returns its ID.
// paid_at is set in the payout window (between periodStart and now).
func seedOrderPayment(t *testing.T, orderID, methodCode string, amountCents int64, paidAt time.Time) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id, `
INSERT INTO order_payments (order_id, payment_method_code, amount_paid_cents, payment_status, paid_at)
VALUES ($1, $2, $3, 'completed', $4) RETURNING id`,
		orderID, methodCode, amountCents, paidAt)
	return id
}

// rowCount counts rows matching a WHERE clause using service-role.
func rowCount(t *testing.T, table, where string, args ...any) int {
	t.Helper()
	var n int
	q := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s`, table, where)
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, q, args...).Scan(&n)
	})
	if err != nil {
		t.Fatalf("rowCount(%s WHERE %s): %v", table, where, err)
	}
	return n
}

// upsertMerchantPayout directly exercises the ON CONFLICT upsert SQL that
// runner.upsertMerchantPayout uses, returning (id, status, transferCode).
func upsertMerchantPayout(
	t *testing.T,
	locID string,
	periodStart, periodEnd time.Time,
	payoutRef, bankAcctID, planID string,
) (id, status, transferCode string) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO merchant_payouts (
    location_id, period_start, period_end,
    total_sales_cents, total_fees_cents, net_payout_cents,
    payout_status, payout_reference, bank_account_id, subscription_plan_id,
    payout_fee_cents, provider, initiated_at
) VALUES (
    $1, $2, $3,
    0, 0, 0,
    'initiated', $4, $5, $6,
    0, 'paystack', now()
)
ON CONFLICT (location_id, period_start, period_end) DO UPDATE
    SET updated_at = merchant_payouts.updated_at
RETURNING id, payout_status, COALESCE(provider_transfer_id, '')
`, locID, periodStart.UTC(), periodEnd.UTC(), payoutRef, bankAcctID, planID,
		).Scan(&id, &status, &transferCode)
	})
	if err != nil {
		t.Fatalf("upsertMerchantPayout: %v", err)
	}
	return id, status, transferCode
}

// ---------------------------------------------------------------------------
// Test 1: ON CONFLICT upsert prevents a second merchant_payouts row for the
//         same (location_id, period_start, period_end) window.
// ---------------------------------------------------------------------------

func TestIntegration_PayoutUpsert_NoDuplicateRow(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)
	planID := freePlanID(t)

	orgID := seedOrg(t, suffix)
	locID := seedLocation(t, orgID, regionID, suffix)
	bankID := seedBankAccount(t, orgID, locID, regionID, "RCP_"+suffix)

	periodStart := time.Now().UTC().Add(-7 * 24 * time.Hour).Truncate(24 * time.Hour)
	periodEnd := time.Now().UTC().Truncate(24 * time.Hour)
	payoutRef := "payout-test-" + suffix

	// First insert → creates the row.
	id1, status1, _ := upsertMerchantPayout(t, locID, periodStart, periodEnd, payoutRef, bankID, planID)
	if id1 == "" {
		t.Fatal("first upsert returned empty id")
	}
	if status1 != "initiated" {
		t.Errorf("first upsert status = %q; want 'initiated'", status1)
	}

	// Second insert for the same window → ON CONFLICT, must return the SAME id.
	id2, status2, _ := upsertMerchantPayout(t, locID, periodStart, periodEnd, payoutRef+"-retry", bankID, planID)
	if id2 != id1 {
		t.Errorf("second upsert returned different id: got %s want %s — duplicate row was created", id2, id1)
	}
	if status2 != "initiated" {
		t.Errorf("second upsert status = %q; want 'initiated'", status2)
	}

	// Verify exactly ONE row exists in the DB for this window.
	n := rowCount(t, "merchant_payouts",
		"location_id = $1 AND period_start = $2 AND period_end = $3",
		locID, periodStart.UTC(), periodEnd.UTC())
	if n != 1 {
		t.Errorf("merchant_payouts row count for window = %d; want 1 (idempotency failure)", n)
	}
}

// ---------------------------------------------------------------------------
// Test 2: Completed rows are not re-processed (existingStatus guard).
//
// After a row reaches 'completed' / 'paid', a retry call to upsertMerchantPayout
// must return the same row id + 'completed' status so the runner skips the
// Paystack call and only advances the cursor.
// ---------------------------------------------------------------------------

func TestIntegration_PayoutUpsert_CompletedRowSkipped(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)
	planID := freePlanID(t)

	orgID := seedOrg(t, suffix)
	locID := seedLocation(t, orgID, regionID, suffix)
	bankID := seedBankAccount(t, orgID, locID, regionID, "RCP2_"+suffix)

	periodStart := time.Now().UTC().Add(-14 * 24 * time.Hour).Truncate(24 * time.Hour)
	periodEnd := time.Now().UTC().Add(-7 * 24 * time.Hour).Truncate(24 * time.Hour)
	payoutRef := "payout-complete-" + suffix

	// Simulate first run: insert 'initiated' row.
	id1, _, _ := upsertMerchantPayout(t, locID, periodStart, periodEnd, payoutRef, bankID, planID)

	// Mark it completed (as finaliseAndAdvance would do).
	svcExec(t, `
UPDATE merchant_payouts
SET payout_status = 'completed', provider_transfer_id = $2, completed_at = now()
WHERE id = $1`, id1, "XFER_"+suffix)

	// Simulate retry: upsert for the same window.
	id2, status2, transferCode2 := upsertMerchantPayout(t, locID, periodStart, periodEnd, payoutRef+"-retry", bankID, planID)
	if id2 != id1 {
		t.Errorf("retry upsert returned different id: got %s want %s", id2, id1)
	}
	if status2 != "completed" {
		t.Errorf("retry upsert status = %q; want 'completed'", status2)
	}
	if transferCode2 != "XFER_"+suffix {
		t.Errorf("retry upsert transferCode = %q; want 'XFER_%s'", transferCode2, suffix)
	}
}

// ---------------------------------------------------------------------------
// Test 3: The partial UNIQUE index on provider_transfer_id (migration 051)
//         rejects a duplicate transfer code.
// ---------------------------------------------------------------------------

func TestIntegration_PayoutProviderTransferID_UniqueIndex(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)
	planID := freePlanID(t)

	orgID := seedOrg(t, suffix)

	// We need two separate locations for the two payout rows (each location can
	// only have one row per period window, so two rows with the same transfer
	// code must belong to different locations/periods).
	locA := seedLocation(t, orgID, regionID, suffix+"a")
	locB := seedLocation(t, orgID, regionID, suffix+"b")
	bankA := seedBankAccount(t, orgID, locA, regionID, "RCPA_"+suffix)
	bankB := seedBankAccount(t, orgID, locB, regionID, "RCPB_"+suffix)

	periodStart := time.Now().UTC().Add(-7 * 24 * time.Hour).Truncate(24 * time.Hour)
	periodEnd := time.Now().UTC().Truncate(24 * time.Hour)
	transferCode := "XFER_UNIQUE_" + suffix

	// Insert first payout row for locA and stamp with a transfer code.
	idA, _, _ := upsertMerchantPayout(t, locA, periodStart, periodEnd, "ref-a-"+suffix, bankA, planID)
	svcExec(t, `
UPDATE merchant_payouts SET provider_transfer_id = $2 WHERE id = $1`, idA, transferCode)

	// Insert second payout row for locB (different window to avoid (loc,period) conflict).
	periodStartB := periodStart.Add(-7 * 24 * time.Hour)
	idB, _, _ := upsertMerchantPayout(t, locB, periodStartB, periodStart, "ref-b-"+suffix, bankB, planID)

	// Attempt to stamp the SAME transfer code on the second row → must violate
	// uidx_merchant_payouts_provider_transfer_id.
	ctx := context.Background()
	updateErr := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE merchant_payouts SET provider_transfer_id = $2 WHERE id = $1`, idB, transferCode)
		return err
	})
	if updateErr == nil {
		t.Error("expected unique index violation when stamping duplicate provider_transfer_id; got nil error")
	} else {
		// 23505 = unique_violation
		if !isUniqueViolation(updateErr) {
			t.Errorf("expected unique_violation (23505) for duplicate transfer_id; got: %v", updateErr)
		} else {
			t.Logf("correctly rejected duplicate provider_transfer_id with: %v", updateErr)
		}
	}
}

// ---------------------------------------------------------------------------
// Test 4: Advisory lock prevents two concurrent RunOnce sweeps.
//
// We hold the advisory lock on one connection, then verify that a second
// pg_try_advisory_lock on the SAME key returns false.
// ---------------------------------------------------------------------------

func TestIntegration_AdvisoryLock_PreventsConcurrentRunOnce(t *testing.T) {
	const lockKey = int64(0xBEEF_0050) // runnerAdvisoryLockKey from runner.go

	ctx := context.Background()

	// Acquire a dedicated connection and take the advisory lock.
	conn1, err := testPool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire conn1: %v", err)
	}
	defer conn1.Release()

	var locked bool
	if err := conn1.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, lockKey,
	).Scan(&locked); err != nil {
		t.Fatalf("pg_try_advisory_lock (conn1): %v", err)
	}
	if !locked {
		// Someone else has it; skip rather than fail, to avoid flakiness.
		t.Skip("advisory lock already held by another process — skipping concurrent lock test")
	}
	defer func() {
		_, _ = conn1.Exec(ctx, `SELECT pg_advisory_unlock($1)`, lockKey)
	}()

	// A second connection must NOT be able to acquire the same lock.
	conn2, err := testPool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire conn2: %v", err)
	}
	defer conn2.Release()

	var locked2 bool
	if err := conn2.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, lockKey,
	).Scan(&locked2); err != nil {
		t.Fatalf("pg_try_advisory_lock (conn2): %v", err)
	}
	if locked2 {
		// Clean up the spurious lock so we don't leave it dangling.
		_, _ = conn2.Exec(ctx, `SELECT pg_advisory_unlock($1)`, lockKey)
		t.Error("conn2 acquired the advisory lock while conn1 still holds it — concurrent RunOnce would not be blocked")
	} else {
		t.Log("correctly: conn2 could not acquire the advisory lock held by conn1")
	}
}

// ---------------------------------------------------------------------------
// Test 5: sumEligiblePayments excludes payments already covered by a 'payout'
//         fee row (double-inclusion guard).
// ---------------------------------------------------------------------------

func TestIntegration_SumEligiblePayments_ExcludesAlreadyPaidOut(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)
	planID := freePlanID(t)

	orgID := seedOrg(t, suffix)
	locID := seedLocation(t, orgID, regionID, suffix)

	ensurePaymentMethod(t, "cash")

	periodStart := time.Now().UTC().Add(-7 * 24 * time.Hour)
	holdCutoff := time.Now().UTC()

	// Seed two completed payments in the window.
	orderID := seedOrder(t, locID, orgID)
	paidAt := time.Now().UTC().Add(-3 * 24 * time.Hour)
	pmID1 := seedOrderPayment(t, orderID, "cash", 50000, paidAt)
	pmID2 := seedOrderPayment(t, orderID, "cash", 30000, paidAt)

	// Verify both are visible in a sumEligiblePayments-style query BEFORE fee marking.
	var sumBefore int64
	svcQueryRow(t, &sumBefore, `
SELECT COALESCE(SUM(op.amount_paid_cents), 0)
FROM order_payments op
JOIN orders o ON o.id = op.order_id
JOIN locations l ON l.id = o.location_id
WHERE l.organization_id = $1
  AND op.payment_status = 'completed'
  AND op.paid_at >= $2
  AND op.paid_at <  $3
  AND NOT EXISTS (
      SELECT 1 FROM beepbite_payment_fees pf
      WHERE pf.order_payment_id = op.id AND pf.fee_kind = 'payout'
  )
`, orgID, periodStart, holdCutoff)

	// Must include at least our two payments.
	if sumBefore < 80000 {
		t.Errorf("sumBefore = %d; want >= 80000 (our two payments not visible)", sumBefore)
	}

	// Mark payment 1 as paid out via a payout fee row.
	svcExec(t, `
INSERT INTO beepbite_payment_fees (order_payment_id, organization_id, subscription_plan_id, fee_kind, fee_amount_cents)
VALUES ($1, $2, $3, 'payout', 0)
ON CONFLICT (order_payment_id, fee_kind) DO NOTHING
`, pmID1, orgID, planID)

	// Re-run the sum — payment 1 must now be excluded.
	var sumAfter int64
	svcQueryRow(t, &sumAfter, `
SELECT COALESCE(SUM(op.amount_paid_cents), 0)
FROM order_payments op
JOIN orders o ON o.id = op.order_id
JOIN locations l ON l.id = o.location_id
WHERE l.organization_id = $1
  AND op.payment_status = 'completed'
  AND op.paid_at >= $2
  AND op.paid_at <  $3
  AND NOT EXISTS (
      SELECT 1 FROM beepbite_payment_fees pf
      WHERE pf.order_payment_id = op.id AND pf.fee_kind = 'payout'
  )
`, orgID, periodStart, holdCutoff)

	// pmID2 (30000) should still be included; pmID1 (50000) must be excluded.
	if sumAfter > sumBefore-50000+1 {
		t.Errorf("sumAfter = %d; expected pmID1 (50000) to be excluded (was %d before)", sumAfter, sumBefore)
	}
	t.Logf("sum before payout fee: %d; sum after marking pmID1 paid out: %d", sumBefore, sumAfter)

	// Verify pmID2 is still included.
	var pmID2Count int
	svcQueryRow(t, &pmID2Count, `
SELECT COUNT(*) FROM order_payments op
WHERE op.id = $1
  AND NOT EXISTS (
      SELECT 1 FROM beepbite_payment_fees pf
      WHERE pf.order_payment_id = op.id AND pf.fee_kind = 'payout'
  )`, pmID2)
	if pmID2Count != 1 {
		t.Errorf("pmID2 should still be eligible (no payout fee row); count = %d", pmID2Count)
	}
}

// ---------------------------------------------------------------------------
// Test 6: beepbite_payment_fees ON CONFLICT (order_payment_id, fee_kind) DO NOTHING
//         — stamping the same payment as paid-out twice is idempotent.
// ---------------------------------------------------------------------------

func TestIntegration_PayoutFeeInsert_Idempotent(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)
	planID := freePlanID(t)

	orgID := seedOrg(t, suffix)
	locID := seedLocation(t, orgID, regionID, suffix)

	ensurePaymentMethod(t, "cash")

	orderID := seedOrder(t, locID, orgID)
	pmID := seedOrderPayment(t, orderID, "cash", 10000, time.Now().UTC().Add(-1*time.Hour))

	// First insert.
	svcExec(t, `
INSERT INTO beepbite_payment_fees (order_payment_id, organization_id, subscription_plan_id, fee_kind, fee_amount_cents)
VALUES ($1, $2, $3, 'payout', 100)
ON CONFLICT (order_payment_id, fee_kind) DO NOTHING
`, pmID, orgID, planID)

	// Second insert (retry) — must be a no-op, not an error.
	svcExec(t, `
INSERT INTO beepbite_payment_fees (order_payment_id, organization_id, subscription_plan_id, fee_kind, fee_amount_cents)
VALUES ($1, $2, $3, 'payout', 100)
ON CONFLICT (order_payment_id, fee_kind) DO NOTHING
`, pmID, orgID, planID)

	// Exactly one fee row must exist.
	n := rowCount(t, "beepbite_payment_fees",
		"order_payment_id = $1 AND fee_kind = 'payout'", pmID)
	if n != 1 {
		t.Errorf("expected 1 payout fee row after two inserts; got %d", n)
	}
}

// ---------------------------------------------------------------------------
// isUniqueViolation checks for Postgres error code 23505.
// ---------------------------------------------------------------------------

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	type pgErr interface {
		SQLState() string
	}
	var pge pgErr
	if errors.As(err, &pge) {
		return pge.SQLState() == "23505"
	}
	// Fallback: string match for environments where the error is wrapped.
	return containsStr(err.Error(), "23505") || containsStr(err.Error(), "unique")
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && searchStr(s, sub))
}

func searchStr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
