// Package recipecost provides a background job that recomputes items.cost_price
// whenever new ingredient_price_history rows appear (i.e. raw ingredient costs
// change).  It uses the existing Postgres function calculate_recipe_cost() from
// migration 5 so all recursive sub-recipe traversal happens in SQL.
package recipecost

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Runner polls ingredient_price_history every 5 minutes and recomputes the
// cost of every menu item whose recipe depends on changed ingredients.
type Runner struct {
	db *pgxpool.Pool
}

// NewRunner constructs a Runner backed by the given connection pool.
func NewRunner(pool *pgxpool.Pool) *Runner {
	return &Runner{db: pool}
}

// Start launches the background polling loop in a new goroutine.  It runs
// immediately on startup (so the first recompute does not wait 5 minutes)
// and then ticks every 5 minutes until ctx is cancelled.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		// Run once immediately so we catch any prices that landed while the
		// service was offline.
		if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("recipecost: RunOnce error on startup: %v", err)
		}

		for {
			select {
			case <-ctx.Done():
				log.Println("recipecost: Runner shutting down")
				return
			case <-ticker.C:
				if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("recipecost: RunOnce error: %v", err)
				}
			}
		}
	}()
}

// RunOnce performs one complete pass:
//  1. Read the watermark from recipe_cost_runs.
//  2. Fetch all ingredient_price_history rows newer than the watermark.
//  3. For each distinct inventory_item_id, call RecomputeForIngredient.
//  4. Write a new recipe_cost_runs row with the updated watermark.
func (r *Runner) RunOnce(ctx context.Context) error {
	startedAt := time.Now().UTC()

	// All DB work runs inside a service-role transaction so that RLS policies
	// that require is_service_role() are satisfied for recipe_cost_runs,
	// ingredient_price_history, and items.
	var historyRows []priceHistoryRow
	var lastRun costRunRow

	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		// 1. Load watermark.
		lastRun, err = loadLastRun(ctx, tx)
		if err != nil {
			return fmt.Errorf("load last run: %w", err)
		}

		// 2. Fetch new price-history rows since the watermark.
		historyRows, err = newPriceHistorySince(ctx, tx, lastRun.LastPriceHistoryID)
		return err
	}); err != nil {
		return fmt.Errorf("recipecost: fetch watermark/history: %w", err)
	}

	if len(historyRows) == 0 {
		// Nothing new — write a no-op run record so we keep a heartbeat.
		if wErr := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := insertRun(ctx, tx, startedAt, lastRun.LastPriceHistoryID, 0, nil)
			return err
		}); wErr != nil {
			log.Printf("recipecost: insert no-op run: %v", wErr)
		}
		return nil
	}

	// 3. Deduplicate inventory_item_ids and recompute.
	seen := make(map[string]struct{}, len(historyRows))
	var runErr error
	totalUpdated := 0

	for _, h := range historyRows {
		if ctx.Err() != nil {
			runErr = ctx.Err()
			break
		}
		if _, ok := seen[h.InventoryItemID]; ok {
			continue
		}
		seen[h.InventoryItemID] = struct{}{}

		n, err := r.recomputeForInventoryItem(ctx, h.InventoryItemID)
		if err != nil {
			log.Printf("recipecost: recompute for inventory_item %s: %v", h.InventoryItemID, err)
			runErr = err
			// Continue with remaining ingredients rather than aborting the whole pass.
			continue
		}
		totalUpdated += n
	}

	// Advance the watermark to the last history row we processed.
	newWatermark := &historyRows[len(historyRows)-1].ID

	var errMsg *string
	if runErr != nil {
		s := runErr.Error()
		errMsg = &s
	}

	if wErr := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := insertRun(ctx, tx, startedAt, newWatermark, totalUpdated, errMsg)
		return err
	}); wErr != nil {
		log.Printf("recipecost: insert run record: %v", wErr)
	}

	if runErr != nil {
		return fmt.Errorf("recipecost: one or more recompute errors (last: %w)", runErr)
	}
	return nil
}

// RecomputeForIngredient recomputes the cost of every item whose recipe tree
// includes the given inventoryItemID (directly or transitively).  It returns
// the number of items whose cost_price was actually changed.
func (r *Runner) RecomputeForIngredient(ctx context.Context, inventoryItemID string) error {
	_, err := r.recomputeForInventoryItem(ctx, inventoryItemID)
	return err
}

// recomputeForInventoryItem is the internal implementation; it returns the
// count of items updated so RunOnce can accumulate a total.
func (r *Runner) recomputeForInventoryItem(ctx context.Context, inventoryItemID string) (int, error) {
	// Determine which top-level items need recomputing.
	// We recompute all items that have auto_calculate_cost=true and a recipe;
	// this is safe because calculate_recipe_cost() is idempotent and the set
	// is usually small.  A more targeted approach would require an explicit
	// inventory_item_id → item_id mapping table which does not exist today.
	var ids []string
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		ids, err = affectedItems(ctx, tx)
		return err
	}); err != nil {
		return 0, fmt.Errorf("affected items for inventory_item %s: %w", inventoryItemID, err)
	}

	updated := 0
	for _, itemID := range ids {
		if ctx.Err() != nil {
			return updated, ctx.Err()
		}
		var changed bool
		if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			var err error
			changed, err = recomputeItemCost(ctx, tx, itemID)
			return err
		}); err != nil {
			return updated, err
		}
		if changed {
			updated++
			log.Printf("recipecost: updated cost_price for item %s (triggered by inventory_item %s)", itemID, inventoryItemID)
		}
	}
	return updated, nil
}
