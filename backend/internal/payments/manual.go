package payments

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Querier is the subset of pgx that ManualTender needs. Both *pgxpool.Pool and
// pgx.Tx satisfy it, so the provider can be constructed against an in-flight
// transaction (the POS charge path, where the tender must commit atomically
// with the order status and the drawer link) or against the pool (read-only
// status polling).
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ManualTender is the only PaymentProvider BeepBite ships.
//
// It records what the operator says happened at the counter: cash into the
// drawer, a card swiped on the shop's own machine, an EFT that landed, a
// voucher redeemed. Nothing is authorised, captured or settled by BeepBite —
// the money has already moved by the time Charge is called, which is why every
// receipt comes back StatusSettled.
type ManualTender struct {
	db Querier
}

// NewManualTender constructs the provider against db, which may be a pool or an
// in-flight transaction.
func NewManualTender(db Querier) *ManualTender {
	return &ManualTender{db: db}
}

// Code implements PaymentProvider.
func (m *ManualTender) Code() string { return "manual" }

// Charge records a tender against an order and returns the persisted receipt.
//
// The caller is responsible for validating org scope and for supplying a
// transaction when the write must be atomic with surrounding order state.
// Idempotency is enforced upstream by internal/idempotency; req.IdempotencyKey
// is carried here only so it lands in the audit trail.
func (m *ManualTender) Charge(ctx context.Context, req ChargeRequest) (Receipt, error) {
	tender := strings.ToLower(strings.TrimSpace(req.Tender))
	if !ValidTender(tender) {
		return Receipt{}, fmt.Errorf("%w: %q", ErrUnknownTender, req.Tender)
	}
	if req.OrderID == "" {
		return Receipt{}, errors.New("payments: order_id is required")
	}
	if req.Amount.Cents < 0 {
		return Receipt{}, errors.New("payments: amount must be >= 0")
	}

	var (
		id   string
		when time.Time
	)
	err := m.db.QueryRow(ctx, `
		INSERT INTO order_payments
		    (order_id, payment_method_code, amount_paid_cents,
		     payment_reference, payment_status)
		VALUES ($1, $2, $3, NULLIF($4, ''), 'completed')
		RETURNING id, paid_at
	`, req.OrderID, tender, req.Amount.Cents, req.Reference).Scan(&id, &when)
	if err != nil {
		return Receipt{}, err
	}

	return Receipt{
		ID:         id,
		Tender:     tender,
		Amount:     req.Amount,
		Status:     StatusSettled,
		Reference:  req.Reference,
		OccurredAt: when,
	}, nil
}

// Refund records money handed back for a previously recorded charge.
//
// As with Charge, the refund has already physically happened — the operator
// opened the drawer or reversed on the card machine. BeepBite writes the row so
// reporting and drawer reconciliation stay honest.
func (m *ManualTender) Refund(ctx context.Context, req RefundRequest) (Receipt, error) {
	if req.ChargeID == "" {
		return Receipt{}, errors.New("payments: charge_id is required")
	}
	if req.Amount.Cents <= 0 {
		return Receipt{}, errors.New("payments: refund amount must be > 0")
	}

	var (
		id     string
		tender string
		when   time.Time
	)
	err := m.db.QueryRow(ctx, `
		INSERT INTO refunds (payment_id, order_id, refund_amount_cents, refund_reason, refund_status)
		SELECT op.id, op.order_id, $2, NULLIF($3, ''), 'completed'
		FROM order_payments op
		WHERE op.id = $1
		RETURNING id,
		          (SELECT payment_method_code FROM order_payments WHERE id = $1),
		          created_at
	`, req.ChargeID, req.Amount.Cents, req.Reason).Scan(&id, &tender, &when)
	if errors.Is(err, pgx.ErrNoRows) {
		return Receipt{}, ErrNotFound
	}
	if err != nil {
		return Receipt{}, err
	}

	return Receipt{
		ID:         id,
		Tender:     tender,
		Amount:     req.Amount,
		Status:     StatusSettled,
		OccurredAt: when,
	}, nil
}

// GetStatus re-reads a recorded tender. For manual tender the answer never
// changes after the fact, but the method exists so an asynchronous adapter
// (poll-first, never webhooks) can be dropped in behind the same seam.
func (m *ManualTender) GetStatus(ctx context.Context, chargeID string) (Receipt, error) {
	if chargeID == "" {
		return Receipt{}, ErrNotFound
	}

	var (
		tender    string
		cents     int64
		reference *string
		dbStatus  string
		when      time.Time
	)
	err := m.db.QueryRow(ctx, `
		SELECT payment_method_code, amount_paid_cents, payment_reference,
		       payment_status::text, paid_at
		FROM order_payments
		WHERE id = $1
	`, chargeID).Scan(&tender, &cents, &reference, &dbStatus, &when)
	if errors.Is(err, pgx.ErrNoRows) {
		return Receipt{}, ErrNotFound
	}
	if err != nil {
		return Receipt{}, err
	}

	ref := ""
	if reference != nil {
		ref = *reference
	}

	return Receipt{
		ID:         chargeID,
		Tender:     tender,
		Amount:     Amount{Cents: cents},
		Status:     statusFromDB(dbStatus),
		Reference:  ref,
		OccurredAt: when,
	}, nil
}

// statusFromDB maps the payment_status enum onto the seam's Status vocabulary.
func statusFromDB(s string) Status {
	switch s {
	case "completed":
		return StatusSettled
	case "failed", "cancelled":
		return StatusFailed
	default:
		return StatusPending
	}
}

// compile-time assertion: ManualTender is the PaymentProvider implementation.
var _ PaymentProvider = (*ManualTender)(nil)
