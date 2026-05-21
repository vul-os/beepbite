// Package reorder exposes the "quick re-order / the usual?" surface.
// Store returns a customer's recent orders with enough detail to clone one
// into a new POS cart. Queries are always org-scoped via db.Scoped so RLS
// prevents cross-tenant reads.
package reorder

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors bubbled up to the HTTP layer.
var (
	ErrCustomerNotFound = errors.New("customer not found")
)

// RecentOrder is the top-level shape returned for each past order.
type RecentOrder struct {
	ID           string      `json:"id"`
	OrderNumber  string      `json:"order_number"`
	CreatedAt    time.Time   `json:"created_at"`
	TotalCents   int64       `json:"total_cents"`
	Items        []OrderItem `json:"items"`
}

// OrderItem is a single line from the past order, ready to clone.
type OrderItem struct {
	ItemID    string     `json:"item_id"`
	ItemName  string     `json:"item_name"`
	Quantity  int        `json:"quantity"`
	Modifiers []Modifier `json:"modifiers"`
}

// Modifier is a snapshot of a modifier choice recorded on the original order.
type Modifier struct {
	ModifierID string `json:"modifier_id"`
	Name       string `json:"name"`
	PriceCents int64  `json:"price_cents"`
}

// Store owns the DB pool and executes org-scoped queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore returns a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// CustomerOrgID verifies that the customer exists AND belongs to the
// requesting org (enforced by RLS via db.Scoped). Returns ErrCustomerNotFound
// when absent or not in scope.
func (s *Store) CustomerOrgID(ctx context.Context, customerID string) (string, error) {
	var orgID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT organization_id FROM customers WHERE id = $1`, customerID,
		).Scan(&orgID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrCustomerNotFound
	}
	return orgID, err
}

// RecentOrders returns the last `limit` completed orders for the customer
// (newest first), each with its line items and modifier snapshots.
// The outer query is constrained by the org-scope session vars so RLS on the
// `orders` table prevents cross-tenant reads.
func (s *Store) RecentOrders(ctx context.Context, customerID string, limit int) ([]RecentOrder, error) {
	if limit <= 0 {
		limit = 3
	}
	if limit > 20 {
		limit = 20
	}

	// Step 1: fetch the most recent N orders for this customer, org-scoped.
	type orderRow struct {
		id          string
		orderNumber string
		createdAt   time.Time
		totalCents  int64
	}

	var orderRows []orderRow
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT id, order_number, created_at, total_cents
FROM   orders
WHERE  customer_id = $1
ORDER  BY created_at DESC
LIMIT  $2
`, customerID, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r orderRow
			if err := rows.Scan(&r.id, &r.orderNumber, &r.createdAt, &r.totalCents); err != nil {
				return err
			}
			orderRows = append(orderRows, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	if len(orderRows) == 0 {
		return []RecentOrder{}, nil
	}

	// Build a lookup slice of order IDs for the item query.
	orderIDs := make([]string, len(orderRows))
	for i, r := range orderRows {
		orderIDs[i] = r.id
	}

	// Step 2: fetch all line items + item name for those orders, org-scoped.
	// items is scoped via the org's location (RLS on items), and order_items
	// inherits orders' org scope — so a tenant cannot pull another tenant's data.
	type itemRow struct {
		orderID  string
		itemID   string
		itemName string
		quantity int
	}

	var itemRows []itemRow
	err = db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT oi.order_id, oi.item_id, i.name, oi.quantity
FROM   order_items oi
JOIN   items       i  ON i.id = oi.item_id
WHERE  oi.order_id = ANY($1::uuid[])
ORDER  BY oi.created_at
`, orderIDs)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r itemRow
			if err := rows.Scan(&r.orderID, &r.itemID, &r.itemName, &r.quantity); err != nil {
				return err
			}
			itemRows = append(itemRows, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	// Step 3: fetch modifier snapshots for those order items.
	// Keyed by order_item_id; we need to correlate via order_items.id.
	// Re-query for order_item ids in those orders.
	type modRow struct {
		orderItemID string
		modifierID  string
		name        string
		priceCents  int64
	}

	var modRows []modRow
	err = db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT oim.order_item_id, oim.modifier_id, oim.name_snapshot, oim.price_cents_snapshot
FROM   order_item_modifiers oim
JOIN   order_items          oi  ON oi.id = oim.order_item_id
WHERE  oi.order_id = ANY($1::uuid[])
ORDER  BY oim.created_at
`, orderIDs)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r modRow
			if err := rows.Scan(&r.orderItemID, &r.modifierID, &r.name, &r.priceCents); err != nil {
				return err
			}
			modRows = append(modRows, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	// Step 4: fetch order_items.id alongside the data we need, so we can
	// correlate modifier rows. We need the order_item id → (orderID, itemID) map.
	// Simplest: do a fourth scoped query to get order_item IDs.
	type oiIDRow struct {
		id      string
		orderID string
		itemID  string
	}
	var oiIDRows []oiIDRow
	err = db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT id, order_id, item_id
FROM   order_items
WHERE  order_id = ANY($1::uuid[])
`, orderIDs)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var r oiIDRow
			if err := rows.Scan(&r.id, &r.orderID, &r.itemID); err != nil {
				return err
			}
			oiIDRows = append(oiIDRows, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	// --- Assemble ---

	// orderItemID → (orderID, itemID)
	oiMap := make(map[string]struct{ orderID, itemID string }, len(oiIDRows))
	for _, r := range oiIDRows {
		oiMap[r.id] = struct{ orderID, itemID string }{r.orderID, r.itemID}
	}

	// (orderID, itemID) → []Modifier
	modsByKey := make(map[[2]string][]Modifier)
	for _, r := range modRows {
		key, ok := oiMap[r.orderItemID]
		if !ok {
			continue
		}
		k := [2]string{key.orderID, key.itemID}
		modsByKey[k] = append(modsByKey[k], Modifier{
			ModifierID: r.modifierID,
			Name:       r.name,
			PriceCents: r.priceCents,
		})
	}

	// orderID → []OrderItem
	itemsByOrder := make(map[string][]OrderItem, len(orderRows))
	for _, r := range itemRows {
		k := [2]string{r.orderID, r.itemID}
		mods := modsByKey[k]
		if mods == nil {
			mods = []Modifier{}
		}
		itemsByOrder[r.orderID] = append(itemsByOrder[r.orderID], OrderItem{
			ItemID:    r.itemID,
			ItemName:  r.itemName,
			Quantity:  r.quantity,
			Modifiers: mods,
		})
	}

	// Build final slice preserving newest-first order.
	out := make([]RecentOrder, 0, len(orderRows))
	for _, r := range orderRows {
		items := itemsByOrder[r.id]
		if items == nil {
			items = []OrderItem{}
		}
		out = append(out, RecentOrder{
			ID:          r.id,
			OrderNumber: r.orderNumber,
			CreatedAt:   r.createdAt,
			TotalCents:  r.totalCents,
			Items:       items,
		})
	}
	return out, nil
}
