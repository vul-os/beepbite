// Package fiscal provides gap-free fiscal receipt sequencing for tax-authority
// compliance. Each location maintains an independent counter persisted in
// fiscal_sequences; the FOR UPDATE lock inside a single pgx transaction
// guarantees no two concurrent writers can claim the same number or create a
// gap.
package fiscal

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors for HTTP-layer mapping.
var (
	ErrOrderNotFound        = errors.New("order not found")
	ErrReceiptAlreadyIssued = errors.New("order already has a fiscal receipt number")
	ErrSequenceNotFound     = errors.New("fiscal sequence not found for location")
)

// FiscalSequence mirrors a fiscal_sequences row.
type FiscalSequence struct {
	LocationID    string     `json:"location_id"`
	CurrentNumber int64      `json:"current_number"`
	Prefix        string     `json:"prefix"`
	ResetPolicy   string     `json:"reset_policy"`
	LastResetAt   *time.Time `json:"last_reset_at"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// ReceiptAssignment is returned after a successful assign-receipt call.
type ReceiptAssignment struct {
	OrderID                 string    `json:"order_id"`
	FiscalReceiptNumber     string    `json:"fiscal_receipt_number"`
	FiscalReceiptAssignedAt time.Time `json:"fiscal_receipt_assigned_at"`
}

// Store wraps pgxpool for fiscal operations.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store from an existing pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// CreateSequence inserts a new fiscal_sequences row for a location. If a row
// already exists the call is idempotent (DO NOTHING) and the existing row is
// returned.
func (s *Store) CreateSequence(
	ctx context.Context,
	locationID, prefix, resetPolicy string,
	startingNumber int64,
) (*FiscalSequence, error) {
	var seq FiscalSequence
	err := s.pool.QueryRow(ctx, `
INSERT INTO fiscal_sequences (location_id, prefix, reset_policy, current_number)
VALUES ($1, $2, $3, $4)
ON CONFLICT (location_id) DO UPDATE
  SET prefix       = EXCLUDED.prefix,
      reset_policy = EXCLUDED.reset_policy
RETURNING location_id, current_number, prefix, reset_policy,
          last_reset_at, created_at, updated_at
`, locationID, prefix, resetPolicy, startingNumber).Scan(
		&seq.LocationID, &seq.CurrentNumber, &seq.Prefix, &seq.ResetPolicy,
		&seq.LastResetAt, &seq.CreatedAt, &seq.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &seq, nil
}

// GetSequence returns the current state of a fiscal sequence for a location.
func (s *Store) GetSequence(ctx context.Context, locationID string) (*FiscalSequence, error) {
	var seq FiscalSequence
	err := s.pool.QueryRow(ctx, `
SELECT location_id, current_number, prefix, reset_policy,
       last_reset_at, created_at, updated_at
FROM fiscal_sequences
WHERE location_id = $1
`, locationID).Scan(
		&seq.LocationID, &seq.CurrentNumber, &seq.Prefix, &seq.ResetPolicy,
		&seq.LastResetAt, &seq.CreatedAt, &seq.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSequenceNotFound
	}
	if err != nil {
		return nil, err
	}
	return &seq, nil
}

// AssignReceipt atomically allocates the next receipt number for an order.
// It acquires a FOR UPDATE lock on the fiscal_sequences row so that concurrent
// callers serialize. If the order already has a number, ErrReceiptAlreadyIssued
// is returned and nothing is changed.
func (s *Store) AssignReceipt(ctx context.Context, orderID string) (*ReceiptAssignment, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 1. Read order — confirm it exists and is not yet receipted.
	var locationID string
	var existingReceipt *string
	err = tx.QueryRow(ctx,
		`SELECT location_id, fiscal_receipt_number FROM orders WHERE id = $1`,
		orderID,
	).Scan(&locationID, &existingReceipt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	if existingReceipt != nil {
		return nil, ErrReceiptAlreadyIssued
	}

	// 2. Lock the sequence row for this location.
	var seq FiscalSequence
	err = tx.QueryRow(ctx, `
SELECT location_id, current_number, prefix, reset_policy, last_reset_at
FROM fiscal_sequences
WHERE location_id = $1
FOR UPDATE
`, locationID).Scan(
		&seq.LocationID, &seq.CurrentNumber, &seq.Prefix, &seq.ResetPolicy, &seq.LastResetAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSequenceNotFound
	}
	if err != nil {
		return nil, err
	}

	// 3. Apply reset policy if applicable.
	now := time.Now().UTC()
	needsReset := false
	if seq.ResetPolicy == "yearly" {
		if seq.LastResetAt == nil || seq.LastResetAt.UTC().Year() < now.Year() {
			needsReset = true
		}
	} else if seq.ResetPolicy == "monthly" {
		if seq.LastResetAt == nil ||
			seq.LastResetAt.UTC().Year() < now.Year() ||
			(seq.LastResetAt.UTC().Year() == now.Year() && int(seq.LastResetAt.UTC().Month()) < int(now.Month())) {
			needsReset = true
		}
	}

	nextNumber := seq.CurrentNumber + 1
	if needsReset {
		nextNumber = 1
	}

	// 4. Format the receipt number: <prefix><zero-padded-8-digit-number>.
	receiptNumber := fmt.Sprintf("%s%08d", seq.Prefix, nextNumber)

	// 5. Update the sequence counter.
	var newLastResetAt any
	if needsReset {
		newLastResetAt = now
	} else {
		newLastResetAt = seq.LastResetAt
	}
	if _, err := tx.Exec(ctx, `
UPDATE fiscal_sequences
SET current_number = $2,
    last_reset_at  = $3
WHERE location_id = $1
`, locationID, nextNumber, newLastResetAt); err != nil {
		return nil, err
	}

	// 6. Stamp the order.
	var out ReceiptAssignment
	if err := tx.QueryRow(ctx, `
UPDATE orders
SET fiscal_receipt_number     = $2,
    fiscal_receipt_assigned_at = now()
WHERE id = $1
RETURNING id, fiscal_receipt_number, fiscal_receipt_assigned_at
`, orderID, receiptNumber).Scan(
		&out.OrderID, &out.FiscalReceiptNumber, &out.FiscalReceiptAssignedAt,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetReceipt returns the fiscal receipt details for an order, or
// ErrOrderNotFound / ErrReceiptAlreadyIssued(nil number) when appropriate.
func (s *Store) GetReceipt(ctx context.Context, orderID string) (*ReceiptAssignment, error) {
	var out ReceiptAssignment
	var receiptNumber *string
	var assignedAt *time.Time

	err := s.pool.QueryRow(ctx, `
SELECT id, fiscal_receipt_number, fiscal_receipt_assigned_at
FROM orders
WHERE id = $1
`, orderID).Scan(&out.OrderID, &receiptNumber, &assignedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	if receiptNumber == nil {
		return nil, errors.New("no fiscal receipt assigned to this order yet")
	}
	out.FiscalReceiptNumber = *receiptNumber
	out.FiscalReceiptAssignedAt = *assignedAt
	return &out, nil
}
