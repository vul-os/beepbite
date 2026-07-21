package payments

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Executor is the subset of pgx that SettleOnlinePayment and
// EnsureOnlineTenderSeeded need: reads via Querier, plus writes. Both
// *pgxpool.Pool and pgx.Tx satisfy it, so callers can pass either an
// in-flight transaction (settling atomically alongside other order state) or
// the bare pool (a one-off write with no surrounding transaction to join).
type Executor interface {
	Querier
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// EnsureOnlineTenderSeeded upserts a payment_methods row for an online
// gateway's tender code (see PatalaGatewayProvider.Code) so that
// order_payments.payment_method_code's foreign key to payment_methods(code)
// is satisfiable for online-gateway rows. It is idempotent (ON CONFLICT DO
// NOTHING) and safe to call on every startup, mirroring cmd/seeddemo's own
// ensurePaymentMethods for the manual tenders.
//
// kind is hard-CHECK-constrained by the schema to the literal string
// "offline" for EVERY payment_methods row (payment_methods_kind_check) — a
// leftover from when "offline" was the only kind this table ever recorded.
// That constraint is satisfied trivially here (kind is still "offline"); it
// does not claim the tender itself settles offline, only that no other kind
// value exists to pick from. Loosening this constraint would need a
// migration, out of scope for this seam (see docs/ONLINE-PAYMENTS.md).
func EnsureOnlineTenderSeeded(ctx context.Context, db Executor, code, displayName string) error {
	_, err := db.Exec(ctx, `
		INSERT INTO payment_methods (code, name, kind, requires_reference, supports_tips, is_active)
		VALUES ($1, $2, 'offline', false, false, true)
		ON CONFLICT (code) DO NOTHING
	`, code, displayName)
	return err
}

// SettleOnlinePayment is the ONE place an online-gateway charge is ever
// marked paid. Both the customer-facing verify-on-return handler
// (internal/handlers/marketplace/payreturn.go, triggered by the buyer's
// browser landing back on ChargeRequest.ReturnURL) and the staff-facing
// "recheck payment" backstop (internal/handlers/pos) call through here, so
// there is exactly one settlement code path to reason about — not two
// hand-rolled copies that could drift.
//
// It re-reads the most recent order_payments row for orderID, and:
//
//   - if it is already 'completed' or 'failed', returns that status verbatim
//     — idempotent, no gateway call, no write (a second hit of the same
//     return URL, or a staff recheck after the browser already settled it,
//     must be a safe no-op);
//   - if it is 'pending' but carries no external_transaction_id (not an
//     online-gateway row at all — e.g. a manual/on-delivery tender still
//     mid-flight for some other reason), reports StatusPending unchanged;
//   - otherwise decodes external_transaction_id as this adapter's own
//     charge token and calls gateway.GetStatus EXACTLY ONCE. Only a
//     StatusSettled response moves order_payments to 'completed' and the
//     order from 'pending' to 'confirmed' (guarded so it only ever
//     transitions FROM those exact states — never clobbers a status staff
//     already advanced by hand). Any error, or a still-StatusPending
//     response, changes nothing: fail closed, never mark paid on doubt.
func SettleOnlinePayment(ctx context.Context, db Executor, gateway PaymentProvider, orderID string) (Status, error) {
	if gateway == nil {
		return "", errors.New("payments: SettleOnlinePayment: no online gateway configured")
	}
	if orderID == "" {
		return "", ErrNotFound
	}

	var (
		paymentID   string
		chargeToken *string
		dbStatus    string
	)
	err := db.QueryRow(ctx, `
		SELECT id, external_transaction_id, payment_status::text
		FROM order_payments
		WHERE order_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, orderID).Scan(&paymentID, &chargeToken, &dbStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}

	switch dbStatus {
	case "completed":
		return StatusSettled, nil
	case "failed":
		return StatusFailed, nil
	}
	// dbStatus == "pending" (order_payments' default / only other value this
	// seam ever writes) from here down.

	if chargeToken == nil || *chargeToken == "" {
		return StatusPending, nil
	}

	receipt, err := gateway.GetStatus(ctx, *chargeToken)
	if err != nil {
		// Fail closed: a verify error is reported as "still pending" to the
		// caller, but as a non-nil error so it can be logged/surfaced —
		// never silently swallowed, and never upgraded to settled.
		return StatusPending, fmt.Errorf("payments: verify online payment: %w", err)
	}

	switch receipt.Status {
	case StatusSettled:
		if _, err := db.Exec(ctx, `
			UPDATE order_payments
			SET payment_status = 'completed', confirmed_at = timezone('utc'::text, now())
			WHERE id = $1 AND payment_status = 'pending'
		`, paymentID); err != nil {
			return StatusPending, err
		}
		if _, err := db.Exec(ctx, `
			UPDATE orders SET status = 'confirmed'
			WHERE id = $1 AND status = 'pending'
		`, orderID); err != nil {
			return StatusPending, err
		}
		return StatusSettled, nil
	case StatusFailed:
		// Not produced by patala_gateway.go today (it never returns
		// StatusFailed from GetStatus — see that file's own doc comment) but
		// handled here for interface correctness against any future
		// PaymentProvider that does distinguish "declined" from "pending".
		if _, err := db.Exec(ctx, `
			UPDATE order_payments SET payment_status = 'failed'
			WHERE id = $1 AND payment_status = 'pending'
		`, paymentID); err != nil {
			return StatusPending, err
		}
		return StatusFailed, nil
	default:
		return StatusPending, nil
	}
}
