// Package waste provides SQL access for waste movements and prep batches.
package waste

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/locations"
)

// Sentinel errors mapped to HTTP status codes in handler.go.
var ErrNotFound = errors.New("record not found")

// Store is the only layer that touches SQL.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// tzFor returns the location's IANA timezone name for use as a Postgres
// AT TIME ZONE operand, falling back to "UTC" when it cannot be resolved.
func (s *Store) tzFor(ctx context.Context, locationID string) string {
	settings, err := locations.SettingsFor(ctx, s.pool, locationID)
	if err != nil || settings.Timezone == "" {
		return "UTC"
	}
	return settings.Timezone
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// WasteMovement mirrors the data returned for a recorded waste event.
type WasteMovement struct {
	ID                 string    `json:"id"`
	InventoryItemID    string    `json:"inventory_item_id"`
	InventoryItemName  string    `json:"inventory_item_name"`
	Quantity           float64   `json:"quantity"`
	Unit               string    `json:"unit"`
	WasteReason        *string   `json:"waste_reason"`
	PerformedByStaffID *string   `json:"performed_by_staff_id"`
	Notes              *string   `json:"notes"`
	CreatedAt          time.Time `json:"created_at"`
}

// WasteReportRow is one row of the aggregate waste report.
type WasteReportRow struct {
	WasteReason     *string `json:"waste_reason"`
	Day             string  `json:"day"`
	TotalQty        float64 `json:"total_qty"`
	TotalValueCents float64 `json:"total_value"`
}

// PrepBatch is a recorded prep run.
type PrepBatch struct {
	ID                      string    `json:"id"`
	OrganizationID          string    `json:"organization_id"`
	LocationID              string    `json:"location_id"`
	ProducedInventoryItemID string    `json:"produced_inventory_item_id"`
	ProducedQuantity        float64   `json:"produced_quantity"`
	ProducedUnit            string    `json:"produced_unit"`
	RecipeYieldPct          *float64  `json:"recipe_yield_pct"`
	PreparedByStaffID       *string   `json:"prepared_by_staff_id"`
	PreparedAt              time.Time `json:"prepared_at"`
	Notes                   *string   `json:"notes"`
	CreatedAt               time.Time `json:"created_at"`
	UpdatedAt               time.Time `json:"updated_at"`
}

// PrepBatchInput is one input consumed by a prep batch.
type PrepBatchInput struct {
	InventoryItemID  string  `json:"inventory_item_id"`
	QuantityConsumed float64 `json:"quantity_consumed"`
	Unit             string  `json:"unit"`
}

// ---------------------------------------------------------------------------
// Waste helpers
// ---------------------------------------------------------------------------

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---------------------------------------------------------------------------
// Waste mutations
// ---------------------------------------------------------------------------

// RecordWaste inserts a stock_movements row with movement_type='waste' and
// decrements inventory_items.current_stock, all inside one transaction.
func (s *Store) RecordWaste(
	ctx context.Context,
	inventoryItemID string,
	quantity float64,
	unit string,
	wasteReason string,
	performedByStaffID string,
	notes string,
) (*WasteMovement, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Lock the inventory row and get cost_per_unit for value reporting.
	var itemName string
	var costPerUnit *float64
	err = tx.QueryRow(ctx,
		`SELECT name, cost_per_unit FROM inventory_items WHERE id = $1 FOR UPDATE`,
		inventoryItemID).Scan(&itemName, &costPerUnit)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	// Decrement current_stock (clamp to 0 to avoid negative stock).
	if _, err := tx.Exec(ctx, `
UPDATE inventory_items
   SET current_stock = GREATEST(current_stock - $2, 0),
       updated_at    = now()
 WHERE id = $1
`, inventoryItemID, quantity); err != nil {
		return nil, err
	}

	// Insert the movement. unit_cost is stored from the item's current cost_per_unit.
	var m WasteMovement
	err = tx.QueryRow(ctx, `
INSERT INTO stock_movements
       (inventory_item_id, movement_type, quantity, unit_cost, waste_reason, notes)
VALUES ($1, 'waste', $2, $3, $4, $5)
RETURNING id, inventory_item_id, quantity, waste_reason, notes, created_at
`,
		inventoryItemID,
		-quantity, // negative = outgoing
		costPerUnit,
		nullStr(wasteReason),
		nullStr(notes),
	).Scan(&m.ID, &m.InventoryItemID, &m.Quantity, &m.WasteReason, &m.Notes, &m.CreatedAt)
	if err != nil {
		return nil, err
	}

	m.InventoryItemName = itemName
	m.Unit = unit
	if performedByStaffID != "" {
		m.PerformedByStaffID = &performedByStaffID
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &m, nil
}

// ---------------------------------------------------------------------------
// Waste queries
// ---------------------------------------------------------------------------

// ListWaste returns waste movements for a location filtered by time range.
//
// since/until are inclusive local calendar dates, interpreted in the location's
// timezone so that this list and WasteReport below cover exactly the same
// events. Compared as raw timestamps they would be resolved in the Postgres
// session zone, and the list would show rows the report omitted.
func (s *Store) ListWaste(ctx context.Context, locationID, since, until string) ([]WasteMovement, error) {
	args := []any{locationID}
	query := `
SELECT sm.id,
       sm.inventory_item_id,
       ii.name                  AS inventory_item_name,
       ABS(sm.quantity)         AS quantity,
       ii.unit,
       sm.waste_reason,
       sm.notes,
       sm.created_at
  FROM stock_movements sm
  JOIN inventory_items ii ON ii.id = sm.inventory_item_id
 WHERE ii.location_id  = $1
   AND sm.movement_type = 'waste'`

	// The timezone is only bound when a date filter actually uses it: Postgres
	// rejects a statement supplied more parameters than it references.
	argIdx := 2
	if since != "" || until != "" {
		args = append(args, s.tzFor(ctx, locationID))
		tzIdx := itoa(argIdx)
		argIdx++
		if since != "" {
			query += " AND (sm.created_at AT TIME ZONE $" + tzIdx + ")::date >= $" + itoa(argIdx) + "::date"
			args = append(args, since)
			argIdx++
		}
		if until != "" {
			query += " AND (sm.created_at AT TIME ZONE $" + tzIdx + ")::date <= $" + itoa(argIdx) + "::date"
			args = append(args, until)
			argIdx++
		}
	}
	query += " ORDER BY sm.created_at DESC LIMIT 500"

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WasteMovement{}
	for rows.Next() {
		var m WasteMovement
		if err := rows.Scan(
			&m.ID, &m.InventoryItemID, &m.InventoryItemName,
			&m.Quantity, &m.Unit, &m.WasteReason, &m.Notes, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// WasteReport aggregates waste by reason and day for a location.
//
// The day a waste event belongs to is the local one. Grouped in UTC, an LA
// kitchen's evening close-down waste — thrown away after 16:00 local — is
// reported against the following day, so the day a chef over-prepped and the
// day the report blames never line up.
//
// `since` and `until` are inclusive local calendar dates, compared against the
// same locally-derived date as the group key so the filter and the buckets
// agree.
func (s *Store) WasteReport(ctx context.Context, locationID, since, until string) ([]WasteReportRow, error) {
	tz := s.tzFor(ctx, locationID)
	args := []any{locationID, tz}
	query := `
SELECT sm.waste_reason,
       to_char(sm.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS day,
       SUM(ABS(sm.quantity))                                AS total_qty,
       SUM(ABS(sm.quantity) * COALESCE(sm.unit_cost, 0))    AS total_value
  FROM stock_movements sm
  JOIN inventory_items ii ON ii.id = sm.inventory_item_id
 WHERE ii.location_id   = $1
   AND sm.movement_type = 'waste'`

	argIdx := 3
	if since != "" {
		query += " AND (sm.created_at AT TIME ZONE $2)::date >= $" + itoa(argIdx) + "::date"
		args = append(args, since)
		argIdx++
	}
	if until != "" {
		query += " AND (sm.created_at AT TIME ZONE $2)::date <= $" + itoa(argIdx) + "::date"
		args = append(args, until)
		argIdx++
	}
	query += " GROUP BY sm.waste_reason, day ORDER BY day DESC, sm.waste_reason"

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WasteReportRow{}
	for rows.Next() {
		var r WasteReportRow
		if err := rows.Scan(&r.WasteReason, &r.Day, &r.TotalQty, &r.TotalValueCents); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Prep batches
// ---------------------------------------------------------------------------

// RecordPrepBatch inserts a prep_batches row and its inputs, decrements each
// input's inventory, and increments the produced item's inventory — all in one
// transaction. yieldPct (0..100) scales how much of produced_quantity is added
// to stock; pass 100 to add the full amount.
func (s *Store) RecordPrepBatch(
	ctx context.Context,
	organizationID string,
	locationID string,
	producedInventoryItemID string,
	producedQuantity float64,
	producedUnit string,
	yieldPct *float64,
	inputs []PrepBatchInput,
	preparedByStaffID string,
	notes string,
) (*PrepBatch, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var batch PrepBatch
	err = tx.QueryRow(ctx, `
INSERT INTO prep_batches
       (organization_id, location_id, produced_inventory_item_id,
        produced_quantity, produced_unit, recipe_yield_pct,
        prepared_by_staff_id, notes)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, organization_id, location_id, produced_inventory_item_id,
          produced_quantity, produced_unit, recipe_yield_pct,
          prepared_by_staff_id, prepared_at, notes, created_at, updated_at
`,
		organizationID,
		locationID,
		producedInventoryItemID,
		producedQuantity,
		producedUnit,
		yieldPct,
		nullStr(preparedByStaffID),
		nullStr(notes),
	).Scan(
		&batch.ID, &batch.OrganizationID, &batch.LocationID,
		&batch.ProducedInventoryItemID, &batch.ProducedQuantity,
		&batch.ProducedUnit, &batch.RecipeYieldPct,
		&batch.PreparedByStaffID, &batch.PreparedAt,
		&batch.Notes, &batch.CreatedAt, &batch.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Insert each input and decrement its stock.
	for _, inp := range inputs {
		if _, err := tx.Exec(ctx, `
INSERT INTO prep_batch_inputs (prep_batch_id, inventory_item_id, quantity_consumed, unit)
VALUES ($1, $2, $3, $4)
`, batch.ID, inp.InventoryItemID, inp.QuantityConsumed, inp.Unit); err != nil {
			return nil, err
		}

		// Decrement input inventory (clamp to 0).
		if _, err := tx.Exec(ctx, `
UPDATE inventory_items
   SET current_stock = GREATEST(current_stock - $2, 0),
       updated_at    = now()
 WHERE id = $1
`, inp.InventoryItemID, inp.QuantityConsumed); err != nil {
			return nil, err
		}

		// Record a stock movement for the consumed input.
		if _, err := tx.Exec(ctx, `
INSERT INTO stock_movements (inventory_item_id, movement_type, quantity, notes)
VALUES ($1, 'waste', $2, 'prep_batch_input')
`, inp.InventoryItemID, -inp.QuantityConsumed); err != nil {
			return nil, err
		}
	}

	// Determine how much produced stock to add (apply yield %).
	effectiveYield := 1.0
	if yieldPct != nil && *yieldPct > 0 {
		effectiveYield = *yieldPct / 100.0
	}
	stockToAdd := producedQuantity * effectiveYield

	// Increment produced item's inventory.
	if _, err := tx.Exec(ctx, `
UPDATE inventory_items
   SET current_stock = current_stock + $2,
       updated_at    = now()
 WHERE id = $1
`, producedInventoryItemID, stockToAdd); err != nil {
		return nil, err
	}

	// Record a stock movement for the produced output.
	if _, err := tx.Exec(ctx, `
INSERT INTO stock_movements (inventory_item_id, movement_type, quantity, notes)
VALUES ($1, 'adjustment', $2, 'prep_batch_output')
`, producedInventoryItemID, stockToAdd); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &batch, nil
}

// ListPrepBatches returns prep batches for a location, optionally filtered by since.
func (s *Store) ListPrepBatches(ctx context.Context, locationID, since string) ([]PrepBatch, error) {
	args := []any{locationID}
	query := `
SELECT id, organization_id, location_id, produced_inventory_item_id,
       produced_quantity, produced_unit, recipe_yield_pct,
       prepared_by_staff_id, prepared_at, notes, created_at, updated_at
  FROM prep_batches
 WHERE location_id = $1`

	if since != "" {
		query += " AND prepared_at >= $2"
		args = append(args, since)
	}
	query += " ORDER BY prepared_at DESC LIMIT 200"

	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []PrepBatch{}
	for rows.Next() {
		var b PrepBatch
		if err := rows.Scan(
			&b.ID, &b.OrganizationID, &b.LocationID,
			&b.ProducedInventoryItemID, &b.ProducedQuantity,
			&b.ProducedUnit, &b.RecipeYieldPct,
			&b.PreparedByStaffID, &b.PreparedAt,
			&b.Notes, &b.CreatedAt, &b.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Tiny helper (avoids importing strconv just for this)
// ---------------------------------------------------------------------------

func itoa(n int) string {
	const digits = "0123456789"
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = digits[n%10]
		n /= 10
	}
	return string(buf[pos:])
}
