package payouts

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CaptureTransactionFee looks up the order_payment identified by paymentID,
// resolves the organisation's subscription-plan tier, computes the platform
// transaction fee, and writes it to beepbite_payment_fees.
//
// The UNIQUE (order_payment_id, fee_kind) constraint makes this idempotent —
// a second call for the same payment silently returns nil.
//
// Fee formula:
//
//	fee = round(amount_paid_cents × transaction_fee_percentage / 100 / 100)
//	      + transaction_fee_fixed_cents
//
// The percentage is stored as e.g. 2.900 (i.e. 2.9%), so we divide by 100
// to convert to a fraction, then apply to the amount.
func CaptureTransactionFee(ctx context.Context, pool *pgxpool.Pool, paymentID string) error {
	// 1. Load order_payment → order → location → organisation → plan in one query.
	var (
		amountPaidCents    int64
		paymentStatus      string
		orgID              string
		planID             string
		txnFeePct          float64
		txnFeeFixed        int64
	)

	err := pool.QueryRow(ctx, `
SELECT
    op.amount_paid_cents,
    op.payment_status,
    l.organization_id,
    sp.id                          AS subscription_plan_id,
    sp.transaction_fee_percentage,
    sp.transaction_fee_fixed_cents
FROM order_payments op
JOIN orders o ON o.id = op.order_id
JOIN locations l ON l.id = o.location_id
JOIN organizations org ON org.id = l.organization_id
JOIN subscription_plans sp ON sp.tier_code = org.subscription_tier
WHERE op.id = $1
`, paymentID).Scan(
		&amountPaidCents,
		&paymentStatus,
		&orgID,
		&planID,
		&txnFeePct,
		&txnFeeFixed,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("payouts: CaptureTransactionFee: payment %s not found: %w", paymentID, err)
		}
		return fmt.Errorf("payouts: CaptureTransactionFee: load payment: %w", err)
	}

	if paymentStatus != "completed" {
		// Only capture fees for completed (successful) payments.
		return nil
	}

	// 2. Compute fee.
	// transaction_fee_percentage is e.g. 2.900 (percent), divide by 100 for fraction.
	feeCents := int64(math.Round(float64(amountPaidCents)*txnFeePct/100.0)) + txnFeeFixed

	// 3. Write to beepbite_payment_fees; ignore unique-violation (idempotent).
	_, err = pool.Exec(ctx, `
INSERT INTO beepbite_payment_fees
    (order_payment_id, organization_id, subscription_plan_id, fee_kind, fee_amount_cents)
VALUES ($1, $2, $3, 'transaction', $4)
ON CONFLICT (order_payment_id, fee_kind) DO NOTHING
`, paymentID, orgID, planID, feeCents)
	if err != nil {
		return fmt.Errorf("payouts: CaptureTransactionFee: insert fee: %w", err)
	}

	return nil
}
