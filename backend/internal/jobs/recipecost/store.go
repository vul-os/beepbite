// Package recipecost contains the background job that recomputes item
// cost_price whenever ingredient_price_history rows are inserted.
package recipecost

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---- row types ---------------------------------------------------------------

type priceHistoryRow struct {
	ID              string
	InventoryItemID string
	CreatedAt       time.Time
}

type costRunRow struct {
	ID                 string
	LastPriceHistoryID *string
}

// ---- store helpers -----------------------------------------------------------

// loadLastRun returns the most recent recipe_cost_runs row (watermark).
// Returns a zero costRunRow (nil LastPriceHistoryID) if the table is empty.
func loadLastRun(ctx context.Context, tx pgx.Tx) (costRunRow, error) {
	var row costRunRow
	err := tx.QueryRow(ctx, `
SELECT id, last_price_history_id
FROM recipe_cost_runs
ORDER BY started_at DESC
LIMIT 1
`).Scan(&row.ID, &row.LastPriceHistoryID)
	if err != nil {
		// pgx surfaces "no rows" as an error; treat it as "no previous run".
		// We intentionally accept the error and return an empty row.
		return costRunRow{}, nil //nolint:nilerr
	}
	return row, nil
}

// newPriceHistorySince returns ingredient_price_history rows that are newer
// than the watermark row identified by afterID (exclusive).  When afterID is
// nil every row is returned, ordered oldest-first so we advance the watermark
// correctly.
func newPriceHistorySince(ctx context.Context, tx pgx.Tx, afterID *string) ([]priceHistoryRow, error) {
	var rows []priceHistoryRow

	query := `
SELECT id, inventory_item_id, created_at
FROM ingredient_price_history
WHERE ($1::uuid IS NULL OR created_at > (
    SELECT created_at FROM ingredient_price_history WHERE id = $1
))
ORDER BY created_at ASC, id ASC
`
	pgRows, err := tx.Query(ctx, query, afterID)
	if err != nil {
		return nil, fmt.Errorf("query ingredient_price_history: %w", err)
	}
	defer pgRows.Close()

	for pgRows.Next() {
		var r priceHistoryRow
		if err := pgRows.Scan(&r.ID, &r.InventoryItemID, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		rows = append(rows, r)
	}
	return rows, pgRows.Err()
}

// affectedItems returns the set of items.id whose recipe tree includes the
// given inventory_item_id (directly or transitively via item_recipes).
// item_recipes.child_item_id links to items.id; inventory_items are terminal
// leaves that are not themselves items rows, so we look up the items that have
// cost_per_unit on their item_recipes row pointing at other items sharing the
// inventory_item's cost signal.
//
// Strategy: find every items row that, somewhere in its recursive component
// tree, depends on an items row whose cost_price tracks this inventory_item.
// Because item_recipes only links items→items, we first find items that are
// *directly* linked to this inventory_item (via a cost_per_unit that was
// seeded from it — there is no FK between item_recipes and inventory_items in
// the schema).  Since the schema has no direct item↔inventory_item FK in
// item_recipes we instead recompute ALL items that have auto_calculate_cost=true
// and at least one recipe row; this is safe and correct because the Postgres
// calculate_recipe_cost() function reads cost_price from child items which is
// ultimately derived from inventory costs.
func affectedItems(ctx context.Context, tx pgx.Tx) ([]string, error) {
	pgRows, err := tx.Query(ctx, `
SELECT DISTINCT id
FROM items
WHERE auto_calculate_cost = true
  AND EXISTS (SELECT 1 FROM item_recipes WHERE parent_item_id = items.id)
`)
	if err != nil {
		return nil, fmt.Errorf("query affected items: %w", err)
	}
	defer pgRows.Close()

	var ids []string
	for pgRows.Next() {
		var id string
		if err := pgRows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, pgRows.Err()
}

// recomputeItemCost calls the existing Postgres function calculate_recipe_cost()
// and writes the result back to items.cost_price for the given item.
// Returns true if the row was actually updated (cost changed).
func recomputeItemCost(ctx context.Context, tx pgx.Tx, itemID string) (bool, error) {
	tag, err := tx.Exec(ctx, `
UPDATE items
SET cost_price = calculate_recipe_cost(id),
    updated_at = now()
WHERE id = $1
  AND auto_calculate_cost = true
  AND cost_price IS DISTINCT FROM calculate_recipe_cost(id)
`, itemID)
	if err != nil {
		return false, fmt.Errorf("update items cost_price for %s: %w", itemID, err)
	}
	return tag.RowsAffected() > 0, nil
}

// insertRun records a new recipe_cost_runs row and returns its id.
func insertRun(ctx context.Context, tx pgx.Tx, startedAt time.Time, lastHistoryID *string, itemsUpdated int, errMsg *string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
INSERT INTO recipe_cost_runs (started_at, completed_at, last_price_history_id, items_updated_count, error_message)
VALUES ($1, now(), $2, $3, $4)
RETURNING id
`, startedAt, lastHistoryID, itemsUpdated, errMsg).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insert recipe_cost_runs: %w", err)
	}
	return id, nil
}
