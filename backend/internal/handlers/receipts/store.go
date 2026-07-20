// Package receipts implements the GET /orders/{order_id}/receipt endpoint,
// returning a structured receipt JSON suitable for reprint from order history.
// Mount under an already-authenticated, org-scoped chi.Router group.
package receipts

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrOrderNotFound is returned when the order does not exist (or is not
// visible to the current org scope).
var ErrOrderNotFound = errors.New("order not found")

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

// ModifierLine is a single modifier (add-on, variation) on an order line.
type ModifierLine struct {
	Name               string `json:"name"`
	PriceCentsSnapshot int64  `json:"price_cents_snapshot"`
}

// LineItem is one order_items row enriched with the item name and modifiers.
type LineItem struct {
	OrderItemID     string         `json:"order_item_id"`
	ItemName        string         `json:"item_name"`
	Quantity        int64          `json:"quantity"`
	UnitPriceCents  int64          `json:"unit_price_cents"`
	TotalPriceCents int64          `json:"total_price_cents"`
	Modifiers       []ModifierLine `json:"modifiers"`
}

// PaymentLine is one order_payments row trimmed to receipt-relevant fields.
type PaymentLine struct {
	PaymentID        string    `json:"payment_id"`
	Method           string    `json:"method"`
	AmountPaidCents  int64     `json:"amount_paid_cents"`
	TipAmountCents   int64     `json:"tip_amount_cents"`
	ChangeGivenCents int64     `json:"change_given_cents"`
	PaymentReference *string   `json:"payment_reference,omitempty"`
	PaidAt           time.Time `json:"paid_at"`
}

// Receipt is the full structured receipt returned by GET /orders/{id}/receipt.
type Receipt struct {
	// Store / location info
	StoreName    string  `json:"store_name"`
	StoreAddress *string `json:"store_address,omitempty"`

	// Order identity
	OrderID     string    `json:"order_id"`
	OrderNumber string    `json:"order_number"`
	CreatedAt   time.Time `json:"created_at"`

	// Line items
	LineItems []LineItem `json:"line_items"`

	// Financial summary (cents)
	SubtotalCents int64  `json:"subtotal_cents"`
	TaxCents      int64  `json:"tax_cents"`
	TipCents      int64  `json:"tip_cents"`
	TotalCents    int64  `json:"total_cents"`
	CurrencyCode  string `json:"currency_code"`

	// Payments
	Payments []PaymentLine `json:"payments"`

	// Fiscal
	FiscalReceiptNumber *string `json:"fiscal_receipt_number,omitempty"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store holds the DB pool and runs all receipt queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// OrderLocationID returns the location_id for the given order so the handler
// can enforce org-scope before doing the heavier join query.
// Returns ErrOrderNotFound when the order does not exist under the current scope.
func (s *Store) OrderLocationID(ctx context.Context, orderID string) (string, error) {
	var locID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT location_id FROM orders WHERE id = $1`,
			orderID,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrderNotFound
	}
	return locID, err
}

// GetReceipt fetches the full receipt for orderID. The caller must have already
// verified that the order's location is within the request's org scope.
func (s *Store) GetReceipt(ctx context.Context, orderID string) (*Receipt, error) {
	var r Receipt
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// ---- 1. Order header + location info --------------------------------
		var storeAddress *string
		err := tx.QueryRow(ctx, `
			SELECT
				o.id,
				o.order_number,
				o.created_at,
				o.subtotal_cents,
				o.tax_cents,
				o.total_cents,
				-- A receipt is the customer's legal record of what they paid. If
				-- the order has no currency_code, stamping 'ZAR' on it is a false
				-- statement about the transaction for every non-ZA operator. ''
				-- renders as a bare number, which is visibly incomplete instead.
				COALESCE(o.currency_code, ''),
				o.fiscal_receipt_number,
				l.name,
				l.address
			FROM orders o
			JOIN locations l ON l.id = o.location_id
			WHERE o.id = $1
		`, orderID).Scan(
			&r.OrderID,
			&r.OrderNumber,
			&r.CreatedAt,
			&r.SubtotalCents,
			&r.TaxCents,
			&r.TotalCents,
			&r.CurrencyCode,
			&r.FiscalReceiptNumber,
			&r.StoreName,
			&storeAddress,
		)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrOrderNotFound
			}
			return err
		}
		r.StoreAddress = storeAddress

		// ---- 2. Line items --------------------------------------------------
		rows, err := tx.Query(ctx, `
			SELECT
				oi.id,
				i.name,
				oi.quantity,
				oi.unit_price_cents,
				oi.total_price_cents
			FROM order_items oi
			JOIN items i ON i.id = oi.item_id
			WHERE oi.order_id = $1
			ORDER BY oi.created_at ASC
		`, orderID)
		if err != nil {
			return err
		}
		defer rows.Close()

		// Collect items and build a map of order_item_id → *LineItem index so we
		// can attach modifiers efficiently in a single second query.
		itemIndexByID := make(map[string]int)
		for rows.Next() {
			var li LineItem
			if err := rows.Scan(
				&li.OrderItemID,
				&li.ItemName,
				&li.Quantity,
				&li.UnitPriceCents,
				&li.TotalPriceCents,
			); err != nil {
				return err
			}
			li.Modifiers = []ModifierLine{} // never emit null
			itemIndexByID[li.OrderItemID] = len(r.LineItems)
			r.LineItems = append(r.LineItems, li)
		}
		if err := rows.Err(); err != nil {
			return err
		}

		// ---- 3. Modifiers (order_item_modifiers) ----------------------------
		if len(r.LineItems) > 0 {
			modRows, err := tx.Query(ctx, `
				SELECT order_item_id, name_snapshot, price_cents_snapshot
				FROM order_item_modifiers
				WHERE order_item_id IN (
					SELECT id FROM order_items WHERE order_id = $1
				)
				ORDER BY order_item_id, created_at ASC
			`, orderID)
			if err != nil {
				return err
			}
			defer modRows.Close()

			for modRows.Next() {
				var oiID string
				var m ModifierLine
				if err := modRows.Scan(&oiID, &m.Name, &m.PriceCentsSnapshot); err != nil {
					return err
				}
				if idx, ok := itemIndexByID[oiID]; ok {
					r.LineItems[idx].Modifiers = append(r.LineItems[idx].Modifiers, m)
				}
			}
			if err := modRows.Err(); err != nil {
				return err
			}
		}

		// ---- 4. Payments ----------------------------------------------------
		pRows, err := tx.Query(ctx, `
			SELECT
				id,
				payment_method_code,
				amount_paid_cents,
				tip_amount_cents,
				change_given_cents,
				payment_reference,
				paid_at
			FROM order_payments
			WHERE order_id = $1
			ORDER BY paid_at ASC
		`, orderID)
		if err != nil {
			return err
		}
		defer pRows.Close()

		var totalTip int64
		for pRows.Next() {
			var p PaymentLine
			if err := pRows.Scan(
				&p.PaymentID,
				&p.Method,
				&p.AmountPaidCents,
				&p.TipAmountCents,
				&p.ChangeGivenCents,
				&p.PaymentReference,
				&p.PaidAt,
			); err != nil {
				return err
			}
			totalTip += p.TipAmountCents
			r.Payments = append(r.Payments, p)
		}
		if err := pRows.Err(); err != nil {
			return err
		}
		if r.Payments == nil {
			r.Payments = []PaymentLine{} // never emit null
		}

		// TipCents is the sum across all payment rows so the receipt header
		// has it without the frontend summing itself.
		r.TipCents = totalTip

		return nil
	})
	if err != nil {
		return nil, err
	}
	return &r, nil
}
