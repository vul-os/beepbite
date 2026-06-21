package inventory

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors mapped to HTTP status codes in handler.go.
var (
	ErrNotFound          = errors.New("record not found")
	ErrAlreadyReceived   = errors.New("GRN has already been received")
	ErrAlreadyMatched    = errors.New("invoice already matched")
	ErrInvalidTransition = errors.New("invalid status transition")
)

// Store holds a pgxpool.Pool and is the only layer that touches SQL.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---------------------------------------------------------------------------
// GRN receive
// ---------------------------------------------------------------------------

// GRNItem is one row from goods_receipt_items joined to the parent PO item.
type GRNItem struct {
	ID                  string  // goods_receipt_items.id
	PurchaseOrderItemID string  // purchase_order_items.id
	InventoryItemID     string  // inventory_items.id
	QuantityReceived    float64 // decimal(12,4) from DB
	UnitPriceCents      int64
	// loaded from inventory_items
	CurrentStock   float64
	CurrentCostPer float64 // cost_per_unit as float64
	// supplier_id from goods_receipts → purchase_orders → suppliers
	SupplierID string
}

// ReceiveGRN executes the full GRN receive transaction:
//  1. Locks goods_receipt row; fails if received_at already set.
//  2. For each goods_receipt_items row: bump current_stock, compute weighted-
//     average cost_per_unit, insert ingredient_price_history, insert
//     stock_movements, update goods_receipt_items.stock_movement_id.
//  3. Sets goods_receipts.received_at = now().
//
// Returns the number of line items processed.
func (s *Store) ReceiveGRN(ctx context.Context, grnID string) (int, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	// --- 1. Lock GRN header; detect double-receive ---
	var receivedAt *time.Time
	var poID string
	err = tx.QueryRow(ctx, `
		SELECT purchase_order_id, received_at
		FROM goods_receipts
		WHERE id = $1
		FOR UPDATE`, grnID).Scan(&poID, &receivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if receivedAt != nil {
		return 0, ErrAlreadyReceived
	}

	// --- 2. Fetch supplier from PO ---
	var supplierID *string
	if err := tx.QueryRow(ctx,
		`SELECT supplier_id FROM purchase_orders WHERE id = $1`, poID,
	).Scan(&supplierID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}

	// --- 3. Load GRN line items ---
	rows, err := tx.Query(ctx, `
		SELECT
			gri.id,
			gri.purchase_order_item_id,
			poi.inventory_item_id,
			gri.quantity_received,
			gri.unit_price_cents,
			inv.current_stock,
			COALESCE(inv.cost_per_unit, 0)
		FROM goods_receipt_items gri
		JOIN purchase_order_items poi ON poi.id = gri.purchase_order_item_id
		JOIN inventory_items inv      ON inv.id = poi.inventory_item_id
		WHERE gri.goods_receipt_id = $1
		FOR UPDATE OF inv`, grnID)
	if err != nil {
		return 0, err
	}

	var items []GRNItem
	for rows.Next() {
		var item GRNItem
		if err := rows.Scan(
			&item.ID,
			&item.PurchaseOrderItemID,
			&item.InventoryItemID,
			&item.QuantityReceived,
			&item.UnitPriceCents,
			&item.CurrentStock,
			&item.CurrentCostPer,
		); err != nil {
			rows.Close()
			return 0, err
		}
		if supplierID != nil {
			item.SupplierID = *supplierID
		}
		items = append(items, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	if len(items) == 0 {
		return 0, fmt.Errorf("GRN %s has no line items", grnID)
	}

	// --- 4. Process each line ---
	for _, item := range items {
		// Weighted-average cost (spec: use float64 for divide, store as int64
		// cents → cost_per_unit is decimal(10,2) in the schema so we store as
		// decimal via float64 directly).
		newCostPer := item.CurrentCostPer
		totalQty := item.CurrentStock + item.QuantityReceived
		if totalQty > 0 {
			incomingCostPer := float64(item.UnitPriceCents) / 100.0
			newCostPer = (item.CurrentStock*item.CurrentCostPer + item.QuantityReceived*incomingCostPer) / totalQty
		}

		// 4a. Bump inventory_items.current_stock and cost_per_unit.
		if _, err := tx.Exec(ctx, `
			UPDATE inventory_items
			SET current_stock = current_stock + $2,
			    cost_per_unit  = $3,
			    updated_at     = now()
			WHERE id = $1`,
			item.InventoryItemID, item.QuantityReceived, newCostPer,
		); err != nil {
			return 0, fmt.Errorf("bump stock for item %s: %w", item.InventoryItemID, err)
		}

		// 4b. Insert stock_movements (movement_type='purchase' — the CHECK
		// constraint on stock_movements only allows: purchase, sale, waste,
		// adjustment; 'grn' is not in the constraint so we map it to 'purchase').
		var movementID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO stock_movements
				(inventory_item_id, movement_type, quantity, unit_cost, reference_id, notes)
			VALUES ($1, 'purchase', $2, $3, $4, 'GRN receive')
			RETURNING id`,
			item.InventoryItemID,
			item.QuantityReceived,
			newCostPer,
			nullStr(grnID),
		).Scan(&movementID); err != nil {
			return 0, fmt.Errorf("insert stock_movement for item %s: %w", item.InventoryItemID, err)
		}

		// 4c. Update goods_receipt_items.stock_movement_id back-reference.
		if _, err := tx.Exec(ctx, `
			UPDATE goods_receipt_items SET stock_movement_id = $2 WHERE id = $1`,
			item.ID, movementID,
		); err != nil {
			return 0, fmt.Errorf("update stock_movement_id for gri %s: %w", item.ID, err)
		}

		// 4d. Append ingredient_price_history.
		pricePerBaseUnit := int64(item.UnitPriceCents)
		if _, err := tx.Exec(ctx, `
			INSERT INTO ingredient_price_history
				(inventory_item_id, supplier_id, source_type, goods_receipt_item_id,
				 price_per_base_unit_cents, effective_at)
			VALUES ($1, $2, 'goods_receipt', $3, $4, now())`,
			item.InventoryItemID,
			nullStr(item.SupplierID),
			item.ID,
			pricePerBaseUnit,
		); err != nil {
			return 0, fmt.Errorf("insert price_history for item %s: %w", item.InventoryItemID, err)
		}
	}

	// --- 5. Stamp received_at on the GRN header ---
	if _, err := tx.Exec(ctx,
		`UPDATE goods_receipts SET received_at = now() WHERE id = $1`, grnID,
	); err != nil {
		return 0, err
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(items), nil
}

// ---------------------------------------------------------------------------
// 3-way match
// ---------------------------------------------------------------------------

// MatchLine is the per-line variance result fed to RunMatch.
type MatchLine struct {
	InvoiceLineID       string  `json:"invoice_line_id"`
	PurchaseOrderItemID *string `json:"purchase_order_item_id,omitempty"`
	InvoiceQty          float64 `json:"invoice_qty"`
	POQty               float64 `json:"po_qty"`
	GRNQty              float64 `json:"grn_qty"`
	InvoicePriceCents   int64   `json:"invoice_price_cents"`
	POPriceCents        int64   `json:"po_price_cents"`
	GRNPriceCents       int64   `json:"grn_price_cents"`
	QtyVariancePct      float64 `json:"qty_variance_pct"`
	PriceVariancePct    float64 `json:"price_variance_pct"`
	HasVariance         bool    `json:"has_variance"`
}

// InvoiceMatchData holds everything needed to run the 3-way match.
type InvoiceMatchData struct {
	InvoiceID     string
	CurrentStatus string
	Lines         []MatchLine
}

// LoadInvoiceForMatch fetches the invoice header + line data needed for the
// 3-way match. Lines that have no PO link are included but their PO/GRN
// figures will be zero (and flagged as variance if the tolerance is >0).
func (s *Store) LoadInvoiceForMatch(ctx context.Context, invoiceID string) (*InvoiceMatchData, error) {
	var out InvoiceMatchData
	out.InvoiceID = invoiceID

	if err := s.pool.QueryRow(ctx,
		`SELECT match_status FROM supplier_invoices WHERE id = $1`, invoiceID,
	).Scan(&out.CurrentStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT
			sil.id                                        AS invoice_line_id,
			sil.purchase_order_item_id,
			sil.quantity                                  AS invoice_qty,
			sil.unit_price_cents                          AS invoice_price_cents,
			COALESCE(poi.ordered_quantity,   0)           AS po_qty,
			COALESCE(poi.ordered_unit_price_cents, 0)     AS po_price_cents,
			COALESCE(gri.quantity_received,  0)           AS grn_qty,
			COALESCE(gri.unit_price_cents,   0)           AS grn_price_cents
		FROM supplier_invoice_lines sil
		LEFT JOIN purchase_order_items poi ON poi.id = sil.purchase_order_item_id
		LEFT JOIN goods_receipt_items  gri ON gri.id = sil.goods_receipt_item_id
		WHERE sil.supplier_invoice_id = $1`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var l MatchLine
		if err := rows.Scan(
			&l.InvoiceLineID,
			&l.PurchaseOrderItemID,
			&l.InvoiceQty,
			&l.InvoicePriceCents,
			&l.POQty,
			&l.POPriceCents,
			&l.GRNQty,
			&l.GRNPriceCents,
		); err != nil {
			return nil, err
		}
		out.Lines = append(out.Lines, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &out, nil
}

// SetInvoiceMatchStatus persists the match_status on the invoice.
func (s *Store) SetInvoiceMatchStatus(ctx context.Context, invoiceID, status string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE supplier_invoices SET match_status = $2, updated_at = now() WHERE id = $1`,
		invoiceID, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Low-stock auto-PO suggestions
// ---------------------------------------------------------------------------

// LowStockItem is one inventory item that has fallen below minimum_stock and
// has a preferred supplier via supplier_inventory_items.
type LowStockItem struct {
	InventoryItemID     string   `json:"inventory_item_id"`
	Name                string   `json:"name"`
	Unit                string   `json:"unit"`
	CurrentStock        float64  `json:"current_stock"`
	MinimumStock        float64  `json:"minimum_stock"`
	SuggestedOrderQty   float64  `json:"suggested_order_qty"`
	PreferredSupplierID string   `json:"preferred_supplier_id"`
	SupplierName        string   `json:"supplier_name"`
	LastPriceCents      *int64   `json:"last_price_per_pack_cents,omitempty"`
	PackSize            *float64 `json:"pack_size,omitempty"`
	PackUnit            *string  `json:"pack_unit,omitempty"`
}

// GetLowStockItems returns all inventory_items below minimum_stock that have
// a preferred supplier, scoped by location_id.
func (s *Store) GetLowStockItems(ctx context.Context, locationID string) ([]LowStockItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT
			inv.id,
			inv.name,
			inv.unit,
			inv.current_stock,
			inv.minimum_stock,
			sii.supplier_id,
			sup.name,
			sii.last_price_per_pack_cents,
			sii.pack_size,
			sii.pack_unit
		FROM inventory_items inv
		JOIN supplier_inventory_items sii ON sii.inventory_item_id = inv.id AND sii.is_preferred = true AND sii.is_active = true
		JOIN suppliers sup                ON sup.id = sii.supplier_id AND sup.is_active = true
		WHERE inv.location_id = $1
		  AND inv.current_stock < inv.minimum_stock
		ORDER BY (inv.minimum_stock - inv.current_stock) DESC`, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []LowStockItem
	for rows.Next() {
		var item LowStockItem
		if err := rows.Scan(
			&item.InventoryItemID,
			&item.Name,
			&item.Unit,
			&item.CurrentStock,
			&item.MinimumStock,
			&item.PreferredSupplierID,
			&item.SupplierName,
			&item.LastPriceCents,
			&item.PackSize,
			&item.PackUnit,
		); err != nil {
			return nil, err
		}
		// Suggest enough to bring stock back to minimum (simple heuristic).
		item.SuggestedOrderQty = item.MinimumStock - item.CurrentStock
		if item.SuggestedOrderQty < 0 {
			item.SuggestedOrderQty = 0
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Purchase Orders
// ---------------------------------------------------------------------------

// POLineInput is one line of the create-PO request body.
type POLineInput struct {
	InventoryItemID         string  `json:"inventory_item_id"`
	SupplierInventoryItemID string  `json:"supplier_inventory_item_id,omitempty"`
	OrderedQuantity         float64 `json:"ordered_quantity"`
	OrderedUnit             string  `json:"ordered_unit"`
	OrderedUnitPriceCents   int64   `json:"ordered_unit_price_cents"`
	Notes                   string  `json:"notes,omitempty"`
}

// CreatePOInput is the full body for POST /inventory/purchase-orders.
type CreatePOInput struct {
	LocationID           string        `json:"location_id"`
	SupplierID           string        `json:"supplier_id"`
	PONumber             string        `json:"po_number"`
	Currency             string        `json:"currency,omitempty"`
	ExpectedDeliveryDate string        `json:"expected_delivery_date,omitempty"` // YYYY-MM-DD or ""
	Notes                string        `json:"notes,omitempty"`
	Lines                []POLineInput `json:"lines"`
}

// PurchaseOrder mirrors the purchase_orders row returned to the caller.
type PurchaseOrder struct {
	ID                   string    `json:"id"`
	LocationID           string    `json:"location_id"`
	SupplierID           *string   `json:"supplier_id"`
	PONumber             string    `json:"po_number"`
	Status               string    `json:"status"`
	Currency             string    `json:"currency"`
	SubtotalCents        int64     `json:"subtotal_cents"`
	TaxCents             int64     `json:"tax_cents"`
	ShippingCents        int64     `json:"shipping_cents"`
	TotalCents           int64     `json:"total_cents"`
	Notes                *string   `json:"notes"`
	ExpectedDeliveryDate *string   `json:"expected_delivery_date"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// CreatePO inserts purchase_orders + purchase_order_items in one transaction.
func (s *Store) CreatePO(ctx context.Context, in CreatePOInput) (*PurchaseOrder, error) {
	if len(in.Lines) == 0 {
		return nil, fmt.Errorf("at least one line item is required")
	}

	currency := in.Currency
	if currency == "" {
		currency = "ZAR"
	}

	// Compute totals from lines.
	var subtotal int64
	for _, l := range in.Lines {
		subtotal += int64(l.OrderedQuantity * float64(l.OrderedUnitPriceCents))
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var po PurchaseOrder
	var expectedDate *string
	if in.ExpectedDeliveryDate != "" {
		expectedDate = &in.ExpectedDeliveryDate
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO purchase_orders
			(location_id, supplier_id, po_number, status, currency,
			 subtotal_cents, tax_cents, shipping_cents, total_cents,
			 notes, expected_delivery_date)
		VALUES ($1, $2, $3, 'draft', $4, $5, 0, 0, $5, $6, $7)
		RETURNING id, location_id, supplier_id, po_number, status, currency,
			subtotal_cents, tax_cents, shipping_cents, total_cents,
			notes, expected_delivery_date::text, created_at, updated_at`,
		in.LocationID,
		nullStr(in.SupplierID),
		in.PONumber,
		currency,
		subtotal,
		nullStr(in.Notes),
		expectedDate,
	).Scan(
		&po.ID, &po.LocationID, &po.SupplierID, &po.PONumber, &po.Status, &po.Currency,
		&po.SubtotalCents, &po.TaxCents, &po.ShippingCents, &po.TotalCents,
		&po.Notes, &po.ExpectedDeliveryDate, &po.CreatedAt, &po.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("insert purchase_order: %w", err)
	}

	for _, l := range in.Lines {
		lineTotal := int64(l.OrderedQuantity * float64(l.OrderedUnitPriceCents))
		if _, err := tx.Exec(ctx, `
			INSERT INTO purchase_order_items
				(purchase_order_id, inventory_item_id, supplier_inventory_item_id,
				 ordered_quantity, ordered_unit, ordered_unit_price_cents,
				 line_total_cents, notes)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			po.ID,
			l.InventoryItemID,
			nullStr(l.SupplierInventoryItemID),
			l.OrderedQuantity,
			l.OrderedUnit,
			l.OrderedUnitPriceCents,
			lineTotal,
			nullStr(l.Notes),
		); err != nil {
			return nil, fmt.Errorf("insert po line for item %s: %w", l.InventoryItemID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &po, nil
}

// SubmitPO transitions a draft PO to 'submitted' and writes an audit log row.
// The schema's status CHECK allows 'sent' but not 'submitted'; the business
// term is "submit" → DB value is 'sent'.
func (s *Store) SubmitPO(ctx context.Context, poID, actorLabel string) (*PurchaseOrder, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var currentStatus string
	var locationID string
	err = tx.QueryRow(ctx,
		`SELECT status, location_id FROM purchase_orders WHERE id = $1 FOR UPDATE`, poID,
	).Scan(&currentStatus, &locationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if currentStatus != "draft" {
		return nil, ErrInvalidTransition
	}

	var po PurchaseOrder
	err = tx.QueryRow(ctx, `
		UPDATE purchase_orders
		SET status     = 'sent',
		    ordered_at = now(),
		    updated_at = now()
		WHERE id = $1
		RETURNING id, location_id, supplier_id, po_number, status, currency,
			subtotal_cents, tax_cents, shipping_cents, total_cents,
			notes, expected_delivery_date::text, created_at, updated_at`, poID,
	).Scan(
		&po.ID, &po.LocationID, &po.SupplierID, &po.PONumber, &po.Status, &po.Currency,
		&po.SubtotalCents, &po.TaxCents, &po.ShippingCents, &po.TotalCents,
		&po.Notes, &po.ExpectedDeliveryDate, &po.CreatedAt, &po.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Audit log entry for the status transition.
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log
			(organization_id, location_id, actor_type, actor_label,
			 action, entity_type, entity_id,
			 before_state, after_state)
		SELECT
			loc.organization_id,
			$2::uuid,
			'system',
			$3,
			'purchase_order.submitted',
			'purchase_order',
			$1::uuid,
			jsonb_build_object('status', 'draft'),
			jsonb_build_object('status', 'sent')
		FROM locations loc WHERE loc.id = $2::uuid`,
		poID, locationID, nullStr(actorLabel),
	); err != nil {
		return nil, fmt.Errorf("insert audit_log: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &po, nil
}
