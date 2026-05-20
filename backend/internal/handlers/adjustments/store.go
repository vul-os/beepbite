package adjustments

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors used by the HTTP layer for status-code mapping.
var (
	ErrOrderNotFound    = errors.New("order not found")
	ErrItemNotFound     = errors.New("order item not found")
	ErrAlreadyVoided    = errors.New("order already has an active void")
	ErrOrderAlreadyPaid = errors.New("order already has a completed payment")
	ErrApproverNotFound = errors.New("approver staff not found")
	ErrNotManager       = errors.New("approver is not a manager or owner")
	ErrPINMismatch      = errors.New("manager PIN is incorrect")
)

// Adjustment mirrors an order_adjustments row.
type Adjustment struct {
	ID                 string     `json:"id"`
	OrderID            string     `json:"order_id"`
	OrderItemID        *string    `json:"order_item_id"`
	AdjustmentType     string     `json:"adjustment_type"`
	ReasonID           *string    `json:"reason_id"`
	ReasonText         *string    `json:"reason_text"`
	AmountCents        int64      `json:"amount_cents"`
	OriginalAmountCents *int64    `json:"original_amount_cents"`
	AppliedBy          *string    `json:"applied_by"`
	ApprovedBy         *string    `json:"approved_by"`
	ApprovalStatus     string     `json:"approval_status"`
	CreatedAt          time.Time  `json:"created_at"`
}

// Store wraps pgxpool for all adjustment-related queries.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// GetOrderLocationID returns the location_id for the given order without
// opening a transaction. Returns ErrOrderNotFound when no row is found.
func (s *Store) GetOrderLocationID(ctx context.Context, orderID string) (string, error) {
	var locID string
	err := s.pool.QueryRow(ctx,
		`SELECT location_id FROM orders WHERE id = $1`, orderID,
	).Scan(&locID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrderNotFound
	}
	return locID, err
}

// GetApproverByID loads the minimal staff fields needed for PIN + role checks.
func (s *Store) GetApproverByID(ctx context.Context, staffID string) (*approverRow, error) {
	var r approverRow
	err := s.pool.QueryRow(ctx, `
SELECT id, role, pin_hash
FROM staff
WHERE id = $1
`, staffID).Scan(&r.ID, &r.Role, &r.PinHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrApproverNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// orderState is a compact view of an order used by pre-flight checks.
type orderState struct {
	ID         string
	Status     string
	LocationID string
}

// GetOrderState fetches the order row for pre-flight checks.
func (s *Store) GetOrderState(ctx context.Context, tx pgx.Tx, orderID string) (*orderState, error) {
	var o orderState
	err := tx.QueryRow(ctx, `
SELECT id, status, location_id
FROM orders
WHERE id = $1
FOR UPDATE
`, orderID).Scan(&o.ID, &o.Status, &o.LocationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	return &o, err
}

// HasCompletedPayment returns true if there is at least one completed
// order_payment for the given order.
func (s *Store) HasCompletedPayment(ctx context.Context, tx pgx.Tx, orderID string) (bool, error) {
	var cnt int
	err := tx.QueryRow(ctx, `
SELECT COUNT(*)
FROM order_payments
WHERE order_id = $1 AND payment_status = 'completed'
`, orderID).Scan(&cnt)
	return cnt > 0, err
}

// HasActiveVoid returns true if the order already carries a non-rejected void.
func (s *Store) HasActiveVoid(ctx context.Context, tx pgx.Tx, orderID string) (bool, error) {
	var cnt int
	err := tx.QueryRow(ctx, `
SELECT COUNT(*)
FROM order_adjustments
WHERE order_id = $1
  AND adjustment_type = 'void'
  AND approval_status != 'rejected'
`, orderID).Scan(&cnt)
	return cnt > 0, err
}

// GetOrderItemAmountCents returns the unit_price_cents * quantity for an item
// (used as original_amount_cents on comp / price_override rows).
func (s *Store) GetOrderItemAmountCents(ctx context.Context, tx pgx.Tx, orderID, itemID string) (int64, error) {
	var cents int64
	err := tx.QueryRow(ctx, `
SELECT unit_price_cents * quantity
FROM order_items
WHERE id = $1 AND order_id = $2
`, itemID, orderID).Scan(&cents)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrItemNotFound
	}
	return cents, err
}

// insertAdjustment writes a single order_adjustments row inside tx.
func (s *Store) insertAdjustment(
	ctx context.Context,
	tx pgx.Tx,
	orderID string,
	orderItemID *string,
	adjType string,
	reasonText *string,
	amountCents int64,
	originalAmountCents *int64,
	appliedBy string,
	approvedBy string,
) (*Adjustment, error) {
	var a Adjustment
	err := tx.QueryRow(ctx, `
INSERT INTO order_adjustments (
    order_id, order_item_id, adjustment_type,
    reason_text, amount_cents, original_amount_cents,
    applied_by, approved_by, approval_status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'approved')
RETURNING id, order_id, order_item_id, adjustment_type,
          reason_id, reason_text, amount_cents, original_amount_cents,
          applied_by, approved_by, approval_status, created_at
`,
		orderID, orderItemID, adjType,
		reasonText, amountCents, originalAmountCents,
		nullStr(appliedBy), nullStr(approvedBy),
	).Scan(
		&a.ID, &a.OrderID, &a.OrderItemID, &a.AdjustmentType,
		&a.ReasonID, &a.ReasonText, &a.AmountCents, &a.OriginalAmountCents,
		&a.AppliedBy, &a.ApprovedBy, &a.ApprovalStatus, &a.CreatedAt,
	)
	return &a, err
}

// insertAuditLog writes a single audit_log row inside tx.
// before / after are arbitrary structs serialised to jsonb.
func (s *Store) insertAuditLog(
	ctx context.Context,
	tx pgx.Tx,
	actorID string,
	action string,
	entityType string,
	entityID string,
	before any,
	after any,
) error {
	bJSON, err := json.Marshal(before)
	if err != nil {
		return err
	}
	aJSON, err := json.Marshal(after)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
INSERT INTO audit_log (
    actor_type, actor_id,
    action, entity_type, entity_id,
    before_state, after_state
) VALUES ('staff', $1, $2, $3, $4, $5, $6)
`,
		nullStr(actorID), action, entityType, nullStr(entityID),
		bJSON, aJSON,
	)
	return err
}

// -------------------------------------------------------------------
// Public write methods — each wraps the two-insert sequence in a tx.
// -------------------------------------------------------------------

// VoidOrder records a void adjustment for a whole order.
func (s *Store) VoidOrder(
	ctx context.Context,
	orderID string,
	reasonText string,
	appliedBy string,
	approvedBy string,
) (*Adjustment, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	order, err := s.GetOrderState(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}

	paid, err := s.HasCompletedPayment(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}
	if paid {
		return nil, ErrOrderAlreadyPaid
	}

	voided, err := s.HasActiveVoid(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}
	if voided {
		return nil, ErrAlreadyVoided
	}

	rt := nullableStr(reasonText)
	adj, err := s.insertAdjustment(
		ctx, tx, orderID, nil, "void", rt, 0, nil, appliedBy, approvedBy,
	)
	if err != nil {
		return nil, err
	}

	if err := s.insertAuditLog(ctx, tx, appliedBy, "order.void", "orders", orderID,
		map[string]any{"status": order.Status},
		map[string]any{"adjustment_id": adj.ID, "adjustment_type": "void"},
	); err != nil {
		return nil, err
	}

	return adj, tx.Commit(ctx)
}

// CompItem comps a single order item.
func (s *Store) CompItem(
	ctx context.Context,
	orderID string,
	itemID string,
	reasonText string,
	appliedBy string,
	approvedBy string,
) (*Adjustment, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := s.GetOrderState(ctx, tx, orderID); err != nil {
		return nil, err
	}

	origCents, err := s.GetOrderItemAmountCents(ctx, tx, orderID, itemID)
	if err != nil {
		return nil, err
	}

	rt := nullableStr(reasonText)
	iid := itemID
	adj, err := s.insertAdjustment(
		ctx, tx, orderID, &iid, "comp", rt, origCents, &origCents, appliedBy, approvedBy,
	)
	if err != nil {
		return nil, err
	}

	if err := s.insertAuditLog(ctx, tx, appliedBy, "order.comp", "orders", orderID,
		map[string]any{"order_item_id": itemID, "original_amount_cents": origCents},
		map[string]any{"adjustment_id": adj.ID, "adjustment_type": "comp", "amount_cents": origCents},
	); err != nil {
		return nil, err
	}

	return adj, tx.Commit(ctx)
}

// PriceOverrideItem overrides the price of a single item.
func (s *Store) PriceOverrideItem(
	ctx context.Context,
	orderID string,
	itemID string,
	newPriceCents int64,
	reasonText string,
	appliedBy string,
	approvedBy string,
) (*Adjustment, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := s.GetOrderState(ctx, tx, orderID); err != nil {
		return nil, err
	}

	origCents, err := s.GetOrderItemAmountCents(ctx, tx, orderID, itemID)
	if err != nil {
		return nil, err
	}

	delta := origCents - newPriceCents // positive = price lowered
	if delta < 0 {
		delta = -delta
	}

	rt := nullableStr(reasonText)
	iid := itemID
	adj, err := s.insertAdjustment(
		ctx, tx, orderID, &iid, "price_override", rt, delta, &origCents, appliedBy, approvedBy,
	)
	if err != nil {
		return nil, err
	}

	if err := s.insertAuditLog(ctx, tx, appliedBy, "order.price_override", "orders", orderID,
		map[string]any{"order_item_id": itemID, "original_amount_cents": origCents},
		map[string]any{"adjustment_id": adj.ID, "new_price_cents": newPriceCents},
	); err != nil {
		return nil, err
	}

	return adj, tx.Commit(ctx)
}

// RefundOrder records a post-payment refund adjustment.
// The actual payment-provider API call is OUT OF SCOPE — left as a TODO.
func (s *Store) RefundOrder(
	ctx context.Context,
	orderID string,
	reasonText string,
	appliedBy string,
	approvedBy string,
) (*Adjustment, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	order, err := s.GetOrderState(ctx, tx, orderID)
	if err != nil {
		return nil, err
	}

	// TODO: trigger payment-provider refund API call here before writing DB rows.
	// Suggested shape: refundProvider(ctx, orderID, amountCents)

	rt := nullableStr(reasonText)
	adj, err := s.insertAdjustment(
		ctx, tx, orderID, nil, "refund", rt, 0, nil, appliedBy, approvedBy,
	)
	if err != nil {
		return nil, err
	}

	if err := s.insertAuditLog(ctx, tx, appliedBy, "order.refund", "orders", orderID,
		map[string]any{"status": order.Status},
		map[string]any{"adjustment_id": adj.ID, "adjustment_type": "refund"},
	); err != nil {
		return nil, err
	}

	return adj, tx.Commit(ctx)
}

// ListAdjustments returns all adjustment rows for an order, newest first.
func (s *Store) ListAdjustments(ctx context.Context, orderID string) ([]Adjustment, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, order_id, order_item_id, adjustment_type,
       reason_id, reason_text, amount_cents, original_amount_cents,
       applied_by, approved_by, approval_status, created_at
FROM order_adjustments
WHERE order_id = $1
ORDER BY created_at DESC
`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Adjustment{}
	for rows.Next() {
		var a Adjustment
		if err := rows.Scan(
			&a.ID, &a.OrderID, &a.OrderItemID, &a.AdjustmentType,
			&a.ReasonID, &a.ReasonText, &a.AmountCents, &a.OriginalAmountCents,
			&a.AppliedBy, &a.ApprovedBy, &a.ApprovalStatus, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// nullStr returns nil for empty strings so Postgres stores SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullableStr returns a *string pointer (nil for empty) for nullable text cols.
func nullableStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
