// Package tabs implements the open-tab / open-check feature (Wave 32).
// A tab is an orders row with is_open_tab=true that accumulates order_items
// over time before being closed for normal charge/settle processing.
package tabs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors mapped to HTTP status codes by Handler.
var (
	ErrTabNotFound     = errors.New("tab not found")
	ErrTabAlreadyClosed = errors.New("tab is already closed")
	ErrItemNotFound    = errors.New("one or more items not found for this location")
)

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

// Tab is the view of an open tab returned by OpenTab and ListTabs.
type Tab struct {
	ID             string     `json:"id"`
	OrderNumber    string     `json:"order_number"`
	LocationID     string     `json:"location_id"`
	OrganizationID string     `json:"organization_id"`
	CustomerID     *string    `json:"customer_id,omitempty"`
	TabName        *string    `json:"tab_name,omitempty"`
	Status         string     `json:"status"`
	IsOpenTab      bool       `json:"is_open_tab"`
	SubtotalCents  int64      `json:"subtotal_cents"`
	TaxCents       int64      `json:"tax_cents"`
	TotalCents     int64      `json:"total_cents"`
	TaxRate        float64    `json:"tax_rate"`
	TaxInclusive   bool       `json:"tax_inclusive"`
	ItemCount      int64      `json:"item_count"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// AppendedItem is returned after a successful POST /tabs/{id}/items call.
type AppendedItem struct {
	OrderItemID   string `json:"order_item_id"`
	ItemID        string `json:"item_id"`
	Quantity      int    `json:"quantity"`
	UnitPriceCents int64 `json:"unit_price_cents"`
	TotalPriceCents int64 `json:"total_price_cents"`
}

// AppendResult is the full response from POST /tabs/{id}/items.
type AppendResult struct {
	TabID          string         `json:"tab_id"`
	AppendedItems  []AppendedItem `json:"appended_items"`
	SubtotalCents  int64          `json:"subtotal_cents"`
	TaxCents       int64          `json:"tax_cents"`
	TotalCents     int64          `json:"total_cents"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store holds the pgx pool for tab operations.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// OpenTab
// ---------------------------------------------------------------------------

// OpenTab creates a new order row flagged as is_open_tab=true with status
// 'confirmed' (kitchen-visible but not yet settled).
//
// order_number follows the per-location per-day pattern used by the POS handler:
// it uses the count of today's orders at the location to produce a short number.
// The unique partial index (location_id, order_number, date_trunc(day)) prevents
// duplicates and the RETURNING clause gives us the final row.
func (s *Store) OpenTab(
	ctx context.Context,
	locationID, tabName, customerID string,
) (*Tab, error) {
	scope := db.ScopeFromContext(ctx)

	var t Tab
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		// Resolve organization_id from the location (also validates the location exists).
		var orgID string
		if err := tx.QueryRow(ctx,
			`SELECT organization_id FROM locations WHERE id = $1`,
			locationID,
		).Scan(&orgID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrTabNotFound // location unknown to this org (RLS hides it)
			}
			return err
		}

		// Generate a short per-day order number:
		//   count all orders at this location today + 1 → "1", "2", …
		// This mirrors the pattern used by the pos package.
		var seq int64
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) + 1
			FROM orders
			WHERE location_id = $1
			  AND date_trunc('day', created_at AT TIME ZONE 'UTC')
			    = date_trunc('day', now() AT TIME ZONE 'UTC')
		`, locationID).Scan(&seq); err != nil {
			return err
		}
		orderNumber := fmt.Sprintf("%d", seq)

		nullCustomer := nullStr(customerID)
		nullTabName  := nullStr(tabName)

		// Insert the open-tab order.  Tax values are 0 until items are added.
		const q = `
			INSERT INTO orders (
				location_id,
				organization_id,
				order_number,
				status,
				fulfillment_type,
				order_type,
				is_open_tab,
				tab_name,
				customer_id,
				subtotal_cents,
				delivery_fee_cents,
				discount_cents,
				tax_cents,
				total_cents,
				tax_rate,
				tax_inclusive
			) VALUES (
				$1, $2, $3,
				'confirmed',
				'dine_in',
				'dine_in',
				true,
				$4,
				$5,
				0, 0, 0, 0, 0,
				15.00,
				true
			)
			RETURNING
				id, order_number, location_id, organization_id,
				customer_id, tab_name, status, is_open_tab,
				subtotal_cents, tax_cents, total_cents,
				tax_rate, tax_inclusive,
				0::bigint AS item_count,
				created_at, updated_at`

		return scanTab(tx.QueryRow(ctx, q,
			locationID, orgID, orderNumber,
			nullTabName, nullCustomer,
		), &t)
	})
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// ---------------------------------------------------------------------------
// ListTabs
// ---------------------------------------------------------------------------

// ListTabs returns all open tabs (is_open_tab=true, status not in closed/paid)
// for a location, newest first, including a running item count.
func (s *Store) ListTabs(ctx context.Context, locationID string) ([]Tab, error) {
	scope := db.ScopeFromContext(ctx)

	out := []Tab{}
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT
				o.id,
				o.order_number,
				o.location_id,
				o.organization_id,
				o.customer_id,
				o.tab_name,
				o.status,
				o.is_open_tab,
				o.subtotal_cents,
				o.tax_cents,
				o.total_cents,
				o.tax_rate,
				o.tax_inclusive,
				COUNT(oi.id) AS item_count,
				o.created_at,
				o.updated_at
			FROM orders o
			LEFT JOIN order_items oi ON oi.order_id = o.id
			WHERE o.location_id = $1
			  AND o.is_open_tab = true
			  AND o.status NOT IN ('cancelled', 'completed')
			GROUP BY o.id
			ORDER BY o.created_at DESC
		`, locationID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var t Tab
			if err := scanTabRow(rows, &t); err != nil {
				return err
			}
			out = append(out, t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// AppendItems
// ---------------------------------------------------------------------------

// ItemInput is a single line item to append to the tab.
type ItemInput struct {
	ItemID               string `json:"item_id"`
	Quantity             int    `json:"quantity"`
	SpecialInstructions  string `json:"special_instructions"`
}

// AppendItems inserts new order_items onto the tab and recomputes order totals
// in one atomic transaction.
//
// Cents math:
//   unit_price_cents  — read from items.price_cents (already in cents)
//   total_price_cents — unit_price_cents * quantity
//   subtotal_cents    — SUM(order_items.total_price_cents) for the whole tab
//   tax_cents         — computed from subtotal using the order's tax_rate and
//                       tax_inclusive flag:
//                         inclusive: tax = subtotal * rate/(100+rate)
//                         exclusive: tax = subtotal * rate/100
//   total_cents       — subtotal + tax  (inclusive: subtotal unchanged since tax
//                       is already embedded; exclusive: subtotal + tax)
func (s *Store) AppendItems(
	ctx context.Context,
	orderID string,
	lines []ItemInput,
) (*AppendResult, error) {
	scope := db.ScopeFromContext(ctx)

	var result AppendResult
	result.TabID = orderID

	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		// Lock the order and confirm it is still an open tab.
		var isOpenTab bool
		var taxRate     float64
		var taxInclusive bool
		var locationID  string
		if err := tx.QueryRow(ctx, `
			SELECT is_open_tab, tax_rate, tax_inclusive, location_id
			FROM orders
			WHERE id = $1
			FOR UPDATE
		`, orderID).Scan(&isOpenTab, &taxRate, &taxInclusive, &locationID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrTabNotFound
			}
			return err
		}
		if !isOpenTab {
			return ErrTabAlreadyClosed
		}

		// Validate and resolve prices for each line.
		type resolvedLine struct {
			itemID          string
			quantity        int
			unitPriceCents  int64
			totalPriceCents int64
			notes           string
		}
		resolved := make([]resolvedLine, 0, len(lines))
		for _, l := range lines {
			if l.Quantity <= 0 {
				l.Quantity = 1
			}
			var unitPrice int64
			err := tx.QueryRow(ctx,
				`SELECT round(price * 100)::bigint FROM items WHERE id = $1 AND location_id = $2`,
				l.ItemID, locationID,
			).Scan(&unitPrice)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrItemNotFound
			}
			if err != nil {
				return err
			}
			resolved = append(resolved, resolvedLine{
				itemID:          l.ItemID,
				quantity:        l.Quantity,
				unitPriceCents:  unitPrice,
				totalPriceCents: unitPrice * int64(l.Quantity),
				notes:           l.SpecialInstructions,
			})
		}

		// Insert order_items and collect results.
		var appended []AppendedItem
		for _, rl := range resolved {
			var oi AppendedItem
			if err := tx.QueryRow(ctx, `
				INSERT INTO order_items (
					order_id, item_id, quantity,
					unit_price_cents, total_price_cents,
					special_instructions
				) VALUES ($1, $2, $3, $4, $5, $6)
				RETURNING id, item_id, quantity, unit_price_cents, total_price_cents
			`, orderID, rl.itemID, rl.quantity,
				rl.unitPriceCents, rl.totalPriceCents,
				nullStr(rl.notes),
			).Scan(
				&oi.OrderItemID, &oi.ItemID, &oi.Quantity,
				&oi.UnitPriceCents, &oi.TotalPriceCents,
			); err != nil {
				return err
			}
			appended = append(appended, oi)
		}

		// Recompute totals from all order_items for this order (not just the new ones).
		var subtotalCents int64
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(SUM(total_price_cents), 0) FROM order_items WHERE order_id = $1`,
			orderID,
		).Scan(&subtotalCents); err != nil {
			return err
		}

		// Tax computation — mirrors the POS store convention:
		//   inclusive (e.g. South African VAT 15%):
		//     tax_cents   = round(subtotal * rate / (100 + rate))
		//     total_cents = subtotal  (tax is already embedded)
		//   exclusive:
		//     tax_cents   = round(subtotal * rate / 100)
		//     total_cents = subtotal + tax_cents
		var taxCents, totalCents int64
		if taxInclusive {
			taxCents   = int64(float64(subtotalCents) * taxRate / (100.0 + taxRate))
			totalCents = subtotalCents
		} else {
			taxCents   = int64(float64(subtotalCents) * taxRate / 100.0)
			totalCents = subtotalCents + taxCents
		}

		// Update the order's financial summary.
		if _, err := tx.Exec(ctx, `
			UPDATE orders
			SET subtotal_cents = $2,
			    tax_cents      = $3,
			    total_cents    = $4,
			    updated_at     = now()
			WHERE id = $1
		`, orderID, subtotalCents, taxCents, totalCents); err != nil {
			return err
		}

		result.AppendedItems = appended
		result.SubtotalCents = subtotalCents
		result.TaxCents      = taxCents
		result.TotalCents    = totalCents
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &result, nil
}

// ---------------------------------------------------------------------------
// CloseTab
// ---------------------------------------------------------------------------

// CloseTab marks the tab is_open_tab=false so the normal charge/settle flow
// can process it. The order status is left as-is (typically 'confirmed').
// Returns the updated tab summary.
func (s *Store) CloseTab(ctx context.Context, orderID string) (*Tab, error) {
	scope := db.ScopeFromContext(ctx)

	var t Tab
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		// Confirm the tab exists and is still open before mutating.
		var isOpenTab bool
		if err := tx.QueryRow(ctx,
			`SELECT is_open_tab FROM orders WHERE id = $1 FOR UPDATE`,
			orderID,
		).Scan(&isOpenTab); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrTabNotFound
			}
			return err
		}
		if !isOpenTab {
			return ErrTabAlreadyClosed
		}

		return scanTab(tx.QueryRow(ctx, `
			UPDATE orders
			SET is_open_tab = false,
			    updated_at  = now()
			WHERE id = $1
			RETURNING
				id, order_number, location_id, organization_id,
				customer_id, tab_name, status, is_open_tab,
				subtotal_cents, tax_cents, total_cents,
				tax_rate, tax_inclusive,
				0::bigint AS item_count,
				created_at, updated_at
		`, orderID), &t)
	})
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// ---------------------------------------------------------------------------
// TabLocationID — org-scope helper
// ---------------------------------------------------------------------------

// TabLocationID returns the location_id for an order, or ErrTabNotFound.
// Used by org-scope checks before any mutation.
func (s *Store) TabLocationID(ctx context.Context, orderID string) (string, error) {
	scope := db.ScopeFromContext(ctx)
	var locID string
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT location_id FROM orders WHERE id = $1`, orderID,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTabNotFound
	}
	return locID, err
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

// scanTab scans a single row returned by QueryRow (RETURNING clause).
// The SELECT list must match: id, order_number, location_id, organization_id,
// customer_id, tab_name, status, is_open_tab, subtotal_cents, tax_cents,
// total_cents, tax_rate, tax_inclusive, item_count, created_at, updated_at.
func scanTab(row pgx.Row, t *Tab) error {
	return row.Scan(
		&t.ID, &t.OrderNumber, &t.LocationID, &t.OrganizationID,
		&t.CustomerID, &t.TabName,
		&t.Status, &t.IsOpenTab,
		&t.SubtotalCents, &t.TaxCents, &t.TotalCents,
		&t.TaxRate, &t.TaxInclusive,
		&t.ItemCount,
		&t.CreatedAt, &t.UpdatedAt,
	)
}

// scanTabRow scans a Rows cursor row (includes item_count from GROUP BY).
func scanTabRow(rows pgx.Rows, t *Tab) error {
	return rows.Scan(
		&t.ID, &t.OrderNumber, &t.LocationID, &t.OrganizationID,
		&t.CustomerID, &t.TabName,
		&t.Status, &t.IsOpenTab,
		&t.SubtotalCents, &t.TaxCents, &t.TotalCents,
		&t.TaxRate, &t.TaxInclusive,
		&t.ItemCount,
		&t.CreatedAt, &t.UpdatedAt,
	)
}

// nullStr converts an empty string to nil so optional fields land as SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
