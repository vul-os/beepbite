// Package ownerassistant provides store-level DB operations for the owner
// assistant feature. All writes run through db.Scoped with the request's
// org scope so Postgres RLS restricts mutations to the caller's tenant.
package ownerassistant

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/bizday"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/locations"
)

// ErrItemNotFound is returned when the requested item does not exist or is
// not visible to the caller's org scope.
var ErrItemNotFound = errors.New("item not found")

// Store handles DB access for the owner assistant feature.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// LLM usage metering
// ---------------------------------------------------------------------------

// RecordLLMUsage inserts a row into llm_messages under ServiceRoleScope
// (the table's INSERT policy requires is_service_role()). orgID must be set —
// llm_messages.organization_id is NOT NULL with an FK to organizations, so
// metering is skipped when the org is unknown.
func (s *Store) RecordLLMUsage(ctx context.Context, orgID, convID, provider, model string, tokensIn, tokensOut int) {
	if orgID == "" {
		return
	}
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
INSERT INTO llm_messages (organization_id, conversation_id, provider, model, tokens_in, tokens_out, cost_cents)
VALUES ($1, $2, $3, $4, $5, $6, 0)`,
			orgID, convID, provider, model, tokensIn, tokensOut,
		)
		return err
	})
	if err != nil {
		log.Printf("ownerassistant: RecordLLMUsage: %v", err)
	}
}

// ---------------------------------------------------------------------------
// Item reads (used by LLM tools and direct commands)
// ---------------------------------------------------------------------------

// ItemRow is a thin projection of the items table.
type ItemRow struct {
	ID          string
	Name        string
	Description string
	Price       float64
	Is86ed      bool
	IsActive    bool
	CategoryID  string
	LocationID  string
}

// FindItemByName looks up the first active item whose name matches (case-
// insensitive prefix or exact match) within any location visible to the
// caller's org scope. The match is: ILIKE <name>% OR exact ILIKE.
func (s *Store) FindItemByName(ctx context.Context, name string) (*ItemRow, error) {
	var row ItemRow
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, name, COALESCE(description,''), price, is_86ed, is_active,
       COALESCE(category_id::text,''), location_id::text
FROM items
WHERE is_active = true
  AND (name ILIKE $1 OR name ILIKE $2)
ORDER BY name ILIKE $1 DESC
LIMIT 1
`, name, name+"%").Scan(
			&row.ID, &row.Name, &row.Description, &row.Price,
			&row.Is86ed, &row.IsActive, &row.CategoryID, &row.LocationID,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrItemNotFound
	}
	return &row, err
}

// ListItems returns all active items visible to the caller's org scope.
func (s *Store) ListItems(ctx context.Context) ([]ItemRow, error) {
	var rows []ItemRow
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		r, err := tx.Query(ctx, `
SELECT id, name, COALESCE(description,''), price, is_86ed, is_active,
       COALESCE(category_id::text,''), location_id::text
FROM items
WHERE is_active = true
ORDER BY name
LIMIT 200
`)
		if err != nil {
			return err
		}
		defer r.Close()
		for r.Next() {
			var item ItemRow
			if err := r.Scan(&item.ID, &item.Name, &item.Description, &item.Price,
				&item.Is86ed, &item.IsActive, &item.CategoryID, &item.LocationID); err != nil {
				return err
			}
			rows = append(rows, item)
		}
		return r.Err()
	})
	return rows, err
}

// ---------------------------------------------------------------------------
// Item writes
// ---------------------------------------------------------------------------

// Set86 sets is_86ed on the given item and writes an audit row.
// Returns ErrItemNotFound when the item is not visible to the caller's scope.
func (s *Store) Set86(ctx context.Context, itemID, orgID string, flag bool) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
UPDATE items
   SET is_86ed    = $1,
       updated_at = timezone('utc', now())
 WHERE id = $2
`, flag, itemID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrItemNotFound
		}

		action := "item.eighty_six"
		if !flag {
			action = "item.un_eighty_six"
		}
		return db.WithTxServiceRole(ctx, tx, func() error {
			_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (organization_id, actor_type, actor_id, action, entity_type, entity_id, after_state)
VALUES (
    $1::uuid, 'member', NULL, $2, 'item', $3::uuid,
    jsonb_build_object('is_86ed', $4::boolean)
)
`, orgID, action, itemID, flag)
			return err
		})
	})
}

// SetPrice updates the price of the given item and writes an audit row.
// Returns ErrItemNotFound when the item is not visible to the caller's scope.
func (s *Store) SetPrice(ctx context.Context, itemID, orgID string, newPrice float64) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Capture old price for audit.
		var oldPrice float64
		if err := tx.QueryRow(ctx, `SELECT price FROM items WHERE id = $1`, itemID).Scan(&oldPrice); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrItemNotFound
			}
			return err
		}

		tag, err := tx.Exec(ctx, `
UPDATE items
   SET price      = $1,
       updated_at = timezone('utc', now())
 WHERE id = $2
`, newPrice, itemID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrItemNotFound
		}

		return db.WithTxServiceRole(ctx, tx, func() error {
			_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (organization_id, actor_type, actor_id, action, entity_type, entity_id,
     before_state, after_state)
VALUES (
    $1::uuid, 'member', NULL, 'item.price_changed', 'item', $2::uuid,
    jsonb_build_object('price', $3::numeric),
    jsonb_build_object('price', $4::numeric)
)
`, orgID, itemID, oldPrice, newPrice)
			return err
		})
	})
}

// CreateItem inserts a new item. Returns the new item's ID.
func (s *Store) CreateItem(ctx context.Context, orgID, locationID, categoryID, name, description string, price float64) (string, error) {
	var id string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
VALUES ($1, $2, $3, NULLIF($4,''), $5, true, 0)
RETURNING id
`, locationID, categoryID, name, description, price).Scan(&id); err != nil {
			return err
		}
		return db.WithTxServiceRole(ctx, tx, func() error {
			_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (organization_id, actor_type, actor_id, action, entity_type, entity_id, after_state)
VALUES (
    $1::uuid, 'member', NULL, 'item.created', 'item', $2::uuid,
    jsonb_build_object('name', $3, 'price', $4::numeric)
)
`, orgID, id, name, price)
			return err
		})
	})
	return id, err
}

// UpdateItem updates name/description/price fields of an item.
func (s *Store) UpdateItem(ctx context.Context, orgID, itemID, name, description string, price float64) error {
	return db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
UPDATE items
   SET name        = COALESCE(NULLIF($1,''), name),
       description = CASE WHEN $2 = '' THEN description ELSE NULLIF($2,'') END,
       price       = CASE WHEN $3 <= 0 THEN price ELSE $3 END,
       updated_at  = timezone('utc', now())
 WHERE id = $4
`, name, description, price, itemID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrItemNotFound
		}
		return db.WithTxServiceRole(ctx, tx, func() error {
			_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (organization_id, actor_type, actor_id, action, entity_type, entity_id, after_state)
VALUES (
    $1::uuid, 'member', NULL, 'item.updated', 'item', $2::uuid,
    jsonb_build_object('name', $3, 'price', $4::numeric)
)
`, orgID, itemID, name, price)
			return err
		})
	})
}

// ---------------------------------------------------------------------------
// Category reads / writes
// ---------------------------------------------------------------------------

// CategoryRow is a thin projection of the categories table.
type CategoryRow struct {
	ID         string
	Name       string
	LocationID string
}

// ListCategories returns all active categories visible to the caller's scope.
func (s *Store) ListCategories(ctx context.Context) ([]CategoryRow, error) {
	var rows []CategoryRow
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		r, err := tx.Query(ctx, `
SELECT id, name, location_id::text
FROM categories
WHERE is_active = true
ORDER BY name
LIMIT 200
`)
		if err != nil {
			return err
		}
		defer r.Close()
		for r.Next() {
			var cat CategoryRow
			if err := r.Scan(&cat.ID, &cat.Name, &cat.LocationID); err != nil {
				return err
			}
			rows = append(rows, cat)
		}
		return r.Err()
	})
	return rows, err
}

// CreateCategory inserts a new category. Returns the new ID.
func (s *Store) CreateCategory(ctx context.Context, orgID, locationID, name string) (string, error) {
	var id string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
INSERT INTO categories (location_id, name, is_active, sort_order)
VALUES ($1, $2, true, 0)
RETURNING id
`, locationID, name).Scan(&id); err != nil {
			return err
		}
		return db.WithTxServiceRole(ctx, tx, func() error {
			_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (organization_id, actor_type, actor_id, action, entity_type, entity_id, after_state)
VALUES (
    $1::uuid, 'member', NULL, 'category.created', 'category', $2::uuid,
    jsonb_build_object('name', $3)
)
`, orgID, id, name)
			return err
		})
	})
	return id, err
}

// ---------------------------------------------------------------------------
// Sales / KDS / stock reads
// ---------------------------------------------------------------------------

// TodaySalesRow holds a brief daily-sales summary.
type TodaySalesRow struct {
	OrderCount         int64
	GrossSalesCents    int64
	NetSalesCents      int64
	AvgOrderValueCents int64
}

// TodaySales returns today's completed-order summary for the location
// matching the caller's first org membership location. If locationID is ""
// the query falls back to all visible locations.
func (s *Store) TodaySales(ctx context.Context, locationID string) (TodaySalesRow, error) {
	var row TodaySalesRow
	// "Today" has to mean the store's today. Cut in UTC, an owner in Los
	// Angeles asking the assistant about today's sales at 17:00 gets a figure
	// that already rolled over an hour earlier and shows almost nothing, while
	// the afternoon's takings sit under "yesterday".
	//
	// With no location_id the query spans every location the caller can see, so
	// there is no single correct zone; that path stays on UTC boundaries (see
	// the else branch below).
	zone := time.UTC
	if locationID != "" {
		if settings, err := locations.SettingsFor(ctx, s.pool, locationID); err == nil {
			zone = settings.Zone()
		}
	}

	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Half-open [dayStart, dayEnd): an order struck at exactly midnight
		// belongs to the day that is starting and to no other. bizday.Bounds
		// steps by calendar date, so DST days keep their true 23- or 25-hour
		// length instead of being assumed to be 24.
		dayStart, dayEnd := bizday.Bounds(time.Now(), zone)

		var q string
		var args []any
		if locationID != "" {
			q = `
SELECT COUNT(*)::bigint,
       COALESCE(SUM(total_cents),0)::bigint,
       COALESCE(SUM(subtotal_cents),0)::bigint,
       CASE WHEN COUNT(*) = 0 THEN 0 ELSE (SUM(total_cents)/COUNT(*))::bigint END
FROM orders
WHERE location_id = $1
  AND status = 'completed'
  AND created_at >= $2 AND created_at < $3`
			args = []any{locationID, dayStart, dayEnd}
		} else {
			// Cross-location aggregate: the visible locations may sit in
			// different zones, so no single local midnight applies. UTC is kept
			// here deliberately rather than picking one store's day arbitrarily.
			q = `
SELECT COUNT(*)::bigint,
       COALESCE(SUM(total_cents),0)::bigint,
       COALESCE(SUM(subtotal_cents),0)::bigint,
       CASE WHEN COUNT(*) = 0 THEN 0 ELSE (SUM(total_cents)/COUNT(*))::bigint END
FROM orders
WHERE status = 'completed'
  AND created_at >= $1 AND created_at < $2`
			args = []any{dayStart, dayEnd}
		}
		return tx.QueryRow(ctx, q, args...).Scan(
			&row.OrderCount,
			&row.GrossSalesCents,
			&row.NetSalesCents,
			&row.AvgOrderValueCents,
		)
	})
	return row, err
}

// KDSStatusRow holds a summary of in-flight KDS tickets.
type KDSStatusRow struct {
	Pending    int64
	InProgress int64
	Done       int64
}

// KDSStatus returns the count of KDS tickets by status for the given location.
// Status values from migration 008: 'fired','in_progress','ready','bumped','recalled','cancelled'.
// We map: fired→Pending, in_progress→InProgress, ready→Done.
func (s *Store) KDSStatus(ctx context.Context, locationID string) (KDSStatusRow, error) {
	var row KDSStatusRow
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		r, err := tx.Query(ctx, `
SELECT kt.status, COUNT(*)::bigint
FROM kds_tickets kt
JOIN orders o ON o.id = kt.order_id
WHERE o.location_id = $1
  AND kt.status IN ('fired','in_progress','ready')
  AND kt.created_at >= NOW() - INTERVAL '4 hours'
GROUP BY kt.status
`, locationID)
		if err != nil {
			return err
		}
		defer r.Close()
		for r.Next() {
			var status string
			var cnt int64
			if err := r.Scan(&status, &cnt); err != nil {
				return err
			}
			switch status {
			case "fired":
				row.Pending = cnt
			case "in_progress":
				row.InProgress = cnt
			case "ready":
				row.Done = cnt
			}
		}
		return r.Err()
	})
	return row, err
}

// LowStockRow describes an item that is running low on stock.
type LowStockRow struct {
	ItemID   string
	ItemName string
	Stock    float64
}

// LowStockItems returns items that have linked inventory_items below the
// item's low_stock_threshold (defaults to 5).
func (s *Store) LowStockItems(ctx context.Context) ([]LowStockRow, error) {
	var rows []LowStockRow
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		r, err := tx.Query(ctx, `
SELECT i.id::text, i.name, ii.current_stock::float8
FROM items i
JOIN inventory_items ii ON ii.link_to_item_id = i.id
WHERE i.is_active = true
  AND ii.current_stock < i.low_stock_threshold
ORDER BY ii.current_stock ASC
LIMIT 50
`)
		if err != nil {
			return err
		}
		defer r.Close()
		for r.Next() {
			var row LowStockRow
			if err := r.Scan(&row.ItemID, &row.ItemName, &row.Stock); err != nil {
				return err
			}
			rows = append(rows, row)
		}
		return r.Err()
	})
	return rows, err
}
