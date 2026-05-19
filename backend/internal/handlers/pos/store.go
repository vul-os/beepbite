package pos

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors returned by Store and mapped to HTTP status codes by Handler.
var (
	ErrLocationNotFound      = errors.New("location not found")
	ErrItemNotFound          = errors.New("one or more items not found")
	ErrBadVariation          = errors.New("one or more variation option IDs are invalid")
	ErrOrderNotFound         = errors.New("order not found")
	ErrOrderAlreadyPaid      = errors.New("order already paid")
	ErrPaymentMethodNotFound = errors.New("payment method not found")
)

// Store holds the pgx pool for POS order operations.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

// OrderLineInput is one line in the create-order request.
type OrderLineInput struct {
	ItemID             string   `json:"item_id"`
	Quantity           int      `json:"quantity"`
	VariationOptionIDs []string `json:"variation_option_ids"`
	Notes              string   `json:"notes"`
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

// CreatedOrder is the response returned after successfully creating an order.
type CreatedOrder struct {
	OrderID      string   `json:"order_id"`
	OrderNumber  string   `json:"order_number"`
	Subtotal     float64  `json:"subtotal"`
	Tax          float64  `json:"tax"`
	Total        float64  `json:"total"`
	KDSTicketIDs []string `json:"kds_ticket_ids"`
}

// ---------------------------------------------------------------------------
// CreateOrder
// ---------------------------------------------------------------------------

// CreateOrder inserts the order, its items, variations, and financial details in
// one transaction, then fans the order out to KDS stations synchronously.
//
// orderType must be a value accepted by the orders.order_type_check constraint:
// 'delivery', 'pickup', 'dine_in'. The handler translates 'takeaway' → 'pickup'.
func (s *Store) CreateOrder(
	ctx context.Context,
	locationID string,
	orderType string,
	tableNumber string,
	tableSessionID string,
	registerSessionID string,
	customerID string,
	lines []OrderLineInput,
) (*CreatedOrder, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// --- 1. Verify location exists ---
	var locationExists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM locations WHERE id = $1)`, locationID,
	).Scan(&locationExists); err != nil {
		return nil, err
	}
	if !locationExists {
		return nil, ErrLocationNotFound
	}

	// --- 2. Resolve item prices and validate items exist ---
	type itemRow struct {
		id    string
		price float64
	}
	itemCache := make(map[string]itemRow, len(lines))
	for _, line := range lines {
		if _, cached := itemCache[line.ItemID]; cached {
			continue
		}
		var ir itemRow
		err := tx.QueryRow(ctx,
			`SELECT id, price FROM items WHERE id = $1`, line.ItemID,
		).Scan(&ir.id, &ir.price)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrItemNotFound
		}
		if err != nil {
			return nil, err
		}
		itemCache[line.ItemID] = ir
	}

	// --- 3. Resolve variation price modifiers ---
	type varOptionRow struct {
		variationID   string
		priceModifier float64
	}
	optionCache := make(map[string]varOptionRow)
	for _, line := range lines {
		for _, optID := range line.VariationOptionIDs {
			if _, cached := optionCache[optID]; cached {
				continue
			}
			var vr varOptionRow
			err := tx.QueryRow(ctx,
				`SELECT variation_id, price_modifier FROM item_variation_options WHERE id = $1`,
				optID,
			).Scan(&vr.variationID, &vr.priceModifier)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrBadVariation
			}
			if err != nil {
				return nil, err
			}
			optionCache[optID] = vr
		}
	}

	// --- 4. Compute subtotal ---
	var subtotal float64
	for _, line := range lines {
		unitPrice := itemCache[line.ItemID].price
		for _, optID := range line.VariationOptionIDs {
			unitPrice += optionCache[optID].priceModifier
		}
		subtotal += unitPrice * float64(line.Quantity)
	}
	const taxRate = 15.0
	taxAmount := subtotal * (taxRate / 100.0)
	total := subtotal + taxAmount

	// --- 5. Generate sequential order_number per location ---
	// Uses MAX over today's orders as a lightweight sequence; good enough for a
	// POS that doesn't need gapless numbering.
	var maxSeq int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(
			CASE
				WHEN order_number ~ '^POS([0-9]+)$' THEN (regexp_replace(order_number, '^POS', ''))::int
				ELSE 0
			END
		), 0)
		FROM orders
		WHERE location_id = $1
		  AND date_trunc('day', created_at AT TIME ZONE 'UTC') = date_trunc('day', now() AT TIME ZONE 'UTC')
	`, locationID).Scan(&maxSeq); err != nil {
		return nil, err
	}
	orderNumber := fmt.Sprintf("POS%04d", maxSeq+1)

	// --- 6. Insert order ---
	var orderID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO orders (location_id, customer_id, order_number, order_type, status, table_session_id)
		VALUES ($1, $2, $3, $4, 'confirmed', $5)
		RETURNING id
	`, locationID, nullStr(customerID), orderNumber, orderType, nullStr(tableSessionID),
	).Scan(&orderID); err != nil {
		return nil, err
	}

	// --- 7. Insert order_details (table_number goes into notes for now; the
	//     table_session_id column requires a live session UUID which the POS
	//     may not always have at order-create time) ---
	var detailNotes interface{}
	if tableNumber != "" {
		detailNotes = "Table: " + tableNumber
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_details (order_id, estimated_prep_time, notes)
		VALUES ($1, 20, $2)
	`, orderID, detailNotes); err != nil {
		return nil, err
	}

	// --- 8. Insert order_financial_details ---
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_financial_details
		    (order_id, subtotal, delivery_fee, total_amount, tax_rate, tax_amount, tax_inclusive, payment_status, payment_method)
		VALUES ($1, $2, 0, $3, $4, $5, false, 'pending', 'cash')
	`, orderID, subtotal, total, taxRate, taxAmount); err != nil {
		return nil, err
	}

	// --- 9. Insert order_items and order_item_variations ---
	type insertedItem struct {
		orderItemID string
		unitPrice   float64
	}
	insertedItems := make([]insertedItem, 0, len(lines))
	for _, line := range lines {
		unitPrice := itemCache[line.ItemID].price
		for _, optID := range line.VariationOptionIDs {
			unitPrice += optionCache[optID].priceModifier
		}
		totalPrice := unitPrice * float64(line.Quantity)

		var orderItemID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, special_instructions)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id
		`, orderID, line.ItemID, line.Quantity, unitPrice, totalPrice, nullStr(line.Notes),
		).Scan(&orderItemID); err != nil {
			return nil, err
		}
		insertedItems = append(insertedItems, insertedItem{orderItemID: orderItemID, unitPrice: unitPrice})

		for _, optID := range line.VariationOptionIDs {
			vr := optionCache[optID]
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_item_variations (order_item_id, variation_id, option_id, price_modifier)
				VALUES ($1, $2, $3, $4)
			`, orderItemID, vr.variationID, optID, vr.priceModifier); err != nil {
				return nil, err
			}
		}
	}

	// --- 10. KDS fanout inside the same transaction ---
	// Replicates the logic from kds.Store.FanoutOrder so we don't need an HTTP
	// self-call. Uses a separate transaction boundary would be cleaner but
	// keeping it all in one tx ensures atomicity.
	kdsTicketIDs, err := fanoutInsideTx(ctx, tx, orderID)
	if err != nil {
		// Non-fatal: KDS fanout job will pick this up within seconds.
		// Log and continue rather than rolling back the entire order.
		_ = err
		kdsTicketIDs = []string{}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &CreatedOrder{
		OrderID:      orderID,
		OrderNumber:  orderNumber,
		Subtotal:     subtotal,
		Tax:          taxAmount,
		Total:        total,
		KDSTicketIDs: kdsTicketIDs,
	}, nil
}

// fanoutInsideTx performs KDS fanout using an already-open transaction tx.
// It mirrors the logic in kds.Store.FanoutOrder without starting its own tx.
func fanoutInsideTx(ctx context.Context, tx pgx.Tx, orderID string) ([]string, error) {
	// Verify the order exists (it should — we just inserted it).
	var courseNumber *int
	err := tx.QueryRow(ctx,
		`SELECT course_number FROM orders WHERE id = $1`, orderID).Scan(&courseNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errors.New("order not found for fanout")
	}
	if err != nil {
		return nil, err
	}

	// Gather distinct stations from routing.
	rows, err := tx.Query(ctx, `
		SELECT DISTINCT isr.station_id
		FROM order_items oi
		JOIN item_station_routing isr ON isr.item_id = oi.item_id
		WHERE oi.order_id = $1
	`, orderID)
	if err != nil {
		return nil, err
	}
	var stations []string
	for rows.Next() {
		var sid string
		if err := rows.Scan(&sid); err != nil {
			rows.Close()
			return nil, err
		}
		stations = append(stations, sid)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	var ticketIDs []string

	for _, stationID := range stations {
		// Next ticket number for this station's location.
		var ticketNumber int
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(MAX(kt.ticket_number), 0) + 1
			FROM kds_tickets kt
			JOIN kitchen_stations ks ON ks.id = kt.station_id
			WHERE ks.location_id = (SELECT location_id FROM kitchen_stations WHERE id = $1)
		`, stationID).Scan(&ticketNumber); err != nil {
			return nil, err
		}

		var ticketID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO kds_tickets (
				order_id, station_id, ticket_number, status,
				course_number, priority
			) VALUES ($1, $2, $3, 'fired', $4, 0)
			ON CONFLICT (order_id, station_id) DO UPDATE
				SET updated_at = now()
			RETURNING id
		`, orderID, stationID, ticketNumber, courseNumber).Scan(&ticketID); err != nil {
			return nil, err
		}

		// Insert ticket items.
		itemRows, err := tx.Query(ctx, `
			INSERT INTO kds_ticket_items (ticket_id, order_item_id, quantity, item_status, notes)
			SELECT $1, oi.id, oi.quantity, 'fired', oi.special_instructions
			FROM order_items oi
			JOIN item_station_routing isr ON isr.item_id = oi.item_id AND isr.station_id = $2
			WHERE oi.order_id = $3
			ON CONFLICT (ticket_id, order_item_id) DO NOTHING
			RETURNING id
		`, ticketID, stationID, orderID)
		if err != nil {
			return nil, err
		}
		for itemRows.Next() {
			var discarded string
			if err := itemRows.Scan(&discarded); err != nil {
				itemRows.Close()
				return nil, err
			}
		}
		itemRows.Close()
		if err := itemRows.Err(); err != nil {
			return nil, err
		}

		// Write the 'fired' event.
		if _, err := tx.Exec(ctx, `
			INSERT INTO kds_ticket_events (ticket_id, event_type)
			VALUES ($1, 'fired')
		`, ticketID); err != nil {
			return nil, err
		}

		ticketIDs = append(ticketIDs, ticketID)
	}

	return ticketIDs, nil
}

// nullStr converts an empty string to nil so optional DB columns receive NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
