package pos

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/locations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors returned by Store and mapped to HTTP status codes by Handler.
var (
	ErrLocationNotFound         = errors.New("location not found")
	ErrItemNotFound             = errors.New("one or more items not found")
	ErrBadVariation             = errors.New("one or more variation option IDs are invalid")
	ErrBadModifier              = errors.New("one or more modifier IDs are invalid or do not belong to the requested item")
	ErrOrderNotFound            = errors.New("order not found")
	ErrOrderAlreadyPaid         = errors.New("order already paid")
	ErrPaymentMethodNotFound    = errors.New("payment method not found")
	ErrNoPaymentMethodAvailable = errors.New("no payment method available")
	// ErrItemSoldOut is returned when a daily-countdown item has insufficient
	// remaining stock for the requested quantity.
	ErrItemSoldOut = errors.New("item sold out for today")
)

// KDS routing fallback chain.
//
// For each order_item we resolve a target kitchen station using, in priority
// order:
//  1. item_station_routing  — explicit per-item routing (is_primary first)
//  2. category_station_routing — routing inherited from the item's category
//  3. any active kitchen_station in the item's location (lowest sort_order)
//
// This ensures every order produces KDS tickets even when only category-level
// routing exists (as the seeded demo data does) or when no routing exists at
// all, so the kitchen is never silently missed.
const kdsItemRoutesCTE = `
	WITH item_routes AS (
		SELECT
			oi.id AS order_item_id,
			oi.item_id,
			oi.quantity,
			oi.special_instructions,
			COALESCE(
				(SELECT isr.station_id
				   FROM item_station_routing isr
				  WHERE isr.item_id = oi.item_id
				  ORDER BY isr.is_primary DESC
				  LIMIT 1),
				(SELECT csr.station_id
				   FROM category_station_routing csr
				   JOIN items it ON it.id = oi.item_id
				  WHERE csr.category_id = it.category_id
				  ORDER BY csr.is_primary DESC
				  LIMIT 1),
				(SELECT ks.id
				   FROM kitchen_stations ks
				   JOIN items it2 ON it2.id = oi.item_id
				  WHERE ks.location_id = it2.location_id
				    AND ks.is_active
				  ORDER BY ks.sort_order ASC, ks.created_at ASC
				  LIMIT 1)
			) AS station_id
		FROM order_items oi
		WHERE oi.order_id = $1
	)`

// kdsStationDiscoverySQL returns the DISTINCT non-null stations an order fans
// out to. Bind $1 = order_id.
const kdsStationDiscoverySQL = kdsItemRoutesCTE + `
	SELECT DISTINCT station_id
	FROM item_routes
	WHERE station_id IS NOT NULL`

// kdsTicketItemsInsertSQL inserts kds_ticket_items for the order_items that
// resolve to a given station. The shared CTE binds $1 = order_id, so this query
// keeps that and uses $2 = ticket_id, $3 = station_id.
const kdsTicketItemsInsertSQL = kdsItemRoutesCTE + `
	INSERT INTO kds_ticket_items (ticket_id, order_item_id, quantity, item_status, notes)
	SELECT $2, ir.order_item_id, ir.quantity, 'fired', ir.special_instructions
	FROM item_routes ir
	WHERE ir.station_id = $3
	ON CONFLICT (ticket_id, order_item_id) DO NOTHING
	RETURNING id`

// Store holds the pgx pool for POS order operations.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

// ModifierSelection is a single modifier chosen for a line item.
type ModifierSelection struct {
	ModifierID string `json:"modifier_id"`
}

// OrderLineInput is one line in the create-order request.
type OrderLineInput struct {
	ItemID             string   `json:"item_id"`
	Quantity           int      `json:"quantity"`
	VariationOptionIDs []string `json:"variation_option_ids"`
	Notes              string   `json:"notes"`
	// CourseID is an optional reference to courses.id for kitchen course firing.
	// Added in Wave 11 (migration 022 adds order_items.course_id).
	CourseID string `json:"course_id"`
	// Modifiers is an optional list of selected modifiers for this line.
	// Each modifier's price_delta_cents is added to the item's base unit price.
	Modifiers []ModifierSelection `json:"modifiers"`
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
	Gratuity     float64  `json:"gratuity"`
	Total        float64  `json:"total"`
	CurrencyCode string   `json:"currency_code"`
	KDSTicketIDs []string `json:"kds_ticket_ids"`
	// Status reflects the on-delivery fallback: "pending_on_delivery" when
	// payment is deferred to handover; "confirmed" for the normal path.
	Status        string `json:"status"`
	PaymentMethod string `json:"payment_method"`
}

// ---------------------------------------------------------------------------
// CreateOrder
// ---------------------------------------------------------------------------

// CreateOrder inserts the order, its items, variations, and financial details in
// one transaction, then fans the order out to KDS stations synchronously.
//
// orderType must be a value accepted by the orders.order_type_check constraint:
// 'delivery', 'pickup', 'dine_in'. The handler translates 'takeaway' → 'pickup'.
//
// onDeliveryMethod is the customer-selected on-delivery tender ("cash" or
// "card_machine"). Ignored unless the fallback path is triggered (no active
// online payment credential). When the fallback is triggered:
//   - If locations.on_delivery_payment_methods is empty → ErrNoPaymentMethodAvailable.
//   - Otherwise (delivery order) → status='pending_on_delivery', payment_method set.
func (s *Store) CreateOrder(
	ctx context.Context,
	locationID string,
	orderType string,
	tableNumber string,
	tableSessionID string,
	registerSessionID string,
	customerID string,
	lines []OrderLineInput,
	onDeliveryMethod string,
	customerNote string,
	partySize int,
) (*CreatedOrder, error) {
	// Use the request's db.Scope (injected by RequireOrgScope middleware) so RLS
	// session variables (current_org_id, current_user_id) are set on the
	// transaction. Without this, RLS blocks the location existence check and
	// returns ErrLocationNotFound even when the location is valid.
	scope := db.ScopeFromContext(ctx)
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// Set session vars for RLS policies.
	if err := setTxScope(ctx, tx, scope); err != nil {
		return nil, err
	}

	// --- 1. Verify location exists and resolve org + on-delivery fallback ---
	// organization_id is read from the location: orders.organization_id is NOT
	// NULL and the orders RLS WITH CHECK requires it to equal current_org_id(),
	// so it must be the location's owning org.
	//
	// Also fetch auto-gratuity config (columns added by migration 026):
	//   auto_gratuity_enabled bool
	//   auto_gratuity_percent numeric
	//   auto_gratuity_min_party int
	var orgID *string
	var onDeliveryMethods []string
	var autoGratuityEnabled bool
	var autoGratuityPercent float64
	var autoGratuityMinParty int
	if err := tx.QueryRow(ctx,
		`SELECT organization_id, on_delivery_payment_methods,
		        COALESCE(auto_gratuity_enabled, false),
		        COALESCE(auto_gratuity_percent, 0),
		        COALESCE(auto_gratuity_min_party, 0)
		 FROM locations WHERE id = $1`,
		locationID,
	).Scan(&orgID, &onDeliveryMethods,
		&autoGratuityEnabled, &autoGratuityPercent, &autoGratuityMinParty,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrLocationNotFound
		}
		return nil, err
	}
	if orgID == nil {
		return nil, ErrLocationNotFound
	}

	// --- 1b. Determine initial order status and payment method ---
	// Check whether an active online payment credential exists for this location.
	initialStatus := "confirmed"
	initialPaymentMethod := "cash"

	var hasActiveCredential bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM location_payment_credentials WHERE location_id = $1 AND is_active = true)`,
		locationID,
	).Scan(&hasActiveCredential); err != nil {
		return nil, err
	}

	// In-store POS orders (dine_in / takeaway / counter) are settled at the till
	// in cash or on the card machine — they never require an online payment
	// credential or an on-delivery method, so the cash defaults above stand.
	// Only DELIVERY orders need a way to collect payment: an online credential,
	// or a configured on-delivery method (cash / card machine at handover).
	if !hasActiveCredential && orderType == "delivery" {
		if len(onDeliveryMethods) == 0 {
			return nil, ErrNoPaymentMethodAvailable
		}
		// Delivery orders with on-delivery fallback are pending payment at handover.
		initialStatus = "pending_on_delivery"
		// Map the customer-selected tender to a payment_method_code.
		switch onDeliveryMethod {
		case "card_machine":
			initialPaymentMethod = "card_on_delivery"
		default:
			// Default to cash on delivery when not specified or "cash".
			initialPaymentMethod = "cash_on_delivery"
		}
	}

	// --- 2. Resolve item prices and validate items exist ---
	// Also fetch daily-countdown fields (columns added by migration 026):
	//   daily_quantity int (NULL = unlimited)
	//   daily_sold_count int
	//   daily_counter_date date
	type itemRow struct {
		id               string
		price            float64
		name             string
		dailyQuantity    *int // NULL means unlimited
		dailySoldCount   int
		dailyCounterDate *string // date as string, NULL when never set
	}
	itemCache := make(map[string]itemRow, len(lines))
	for _, line := range lines {
		if _, cached := itemCache[line.ItemID]; cached {
			continue
		}
		var ir itemRow
		err := tx.QueryRow(ctx,
			`SELECT id, price, name,
			        daily_quantity, daily_sold_count, daily_counter_date::text
			 FROM items WHERE id = $1`, line.ItemID,
		).Scan(&ir.id, &ir.price, &ir.name,
			&ir.dailyQuantity, &ir.dailySoldCount, &ir.dailyCounterDate)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrItemNotFound
		}
		if err != nil {
			return nil, err
		}
		itemCache[line.ItemID] = ir
	}

	// --- 3. Resolve modifier prices and compute per-line unit prices ---
	// resolvedModifier holds the DB-fetched data for one selected modifier.
	type resolvedModifier struct {
		modifierID      string
		name            string
		priceDeltaCents int64
	}
	// lineUnitCents[i] is the total unit price for lines[i] in integer cents:
	// item base price + sum of selected modifier price_delta_cents values.
	lineUnitCents := make([]int64, len(lines))
	// lineModifiers[i] holds the resolved modifier rows for lines[i], in
	// the same order as the request, so the INSERT loop can correlate them.
	lineModifiers := make([][]resolvedModifier, len(lines))

	for i, line := range lines {
		baseItem := itemCache[line.ItemID]
		baseCents := int64(math.Round(baseItem.price * 100))
		extra := int64(0)

		if len(line.Modifiers) > 0 {
			mods := make([]resolvedModifier, 0, len(line.Modifiers))
			for _, sel := range line.Modifiers {
				// Look up the modifier and validate it belongs to a modifier_group
				// whose item_id matches this line's item. A mismatch (or missing row)
				// means the caller sent an invalid modifier_id for this item.
				var rm resolvedModifier
				rm.modifierID = sel.ModifierID
				err := tx.QueryRow(ctx, `
					SELECT m.name, m.price_delta_cents
					FROM modifiers m
					JOIN modifier_groups mg ON mg.id = m.modifier_group_id
					WHERE m.id = $1
					  AND mg.item_id = $2
					  AND m.is_active = true
				`, sel.ModifierID, line.ItemID).Scan(&rm.name, &rm.priceDeltaCents)
				if errors.Is(err, pgx.ErrNoRows) {
					return nil, fmt.Errorf("%w: modifier %s is not valid for item %s",
						ErrBadModifier, sel.ModifierID, line.ItemID)
				}
				if err != nil {
					return nil, fmt.Errorf("resolving modifier %s: %w", sel.ModifierID, err)
				}
				extra += rm.priceDeltaCents
				mods = append(mods, rm)
			}
			lineModifiers[i] = mods
		}

		lineUnitCents[i] = baseCents + extra
	}

	// --- 4. Compute order totals (integer cents) ---
	var subtotalCents int64
	for i, line := range lines {
		subtotalCents += lineUnitCents[i] * int64(line.Quantity)
	}

	taxRate, err := TaxRateFor(ctx, s.pool, locationID)
	if err != nil {
		return nil, fmt.Errorf("resolving tax rate: %w", err)
	}
	// Tax-exclusive: tax is added on top of the subtotal (matches prior behaviour).
	taxCents := int64(math.Round(float64(subtotalCents) * taxRate / 100.0))
	totalCents := subtotalCents + taxCents

	// --- 4b. Auto-gratuity (Wave 24) ---
	// If the location has auto_gratuity_enabled and the order's party_size meets
	// the minimum threshold, compute and add a gratuity on top of the subtotal.
	// partySize=0 means the caller did not supply a party_size; treat as 1.
	effectivePartySize := partySize
	if effectivePartySize <= 0 {
		effectivePartySize = 1
	}
	var gratuityCents int64
	if autoGratuityEnabled &&
		autoGratuityPercent > 0 &&
		autoGratuityMinParty > 0 &&
		effectivePartySize >= autoGratuityMinParty {
		gratuityCents = int64(math.Round(float64(subtotalCents) * autoGratuityPercent / 100.0))
		totalCents += gratuityCents
	}

	// Resolve per-store currency (with 5-min cache).
	cur, err := locations.CurrencyFor(ctx, s.pool, locationID)
	if err != nil {
		return nil, fmt.Errorf("resolving currency: %w", err)
	}

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
	// The schema consolidation folded order_details (estimated_prep_time, notes)
	// and order_financial_details (subtotal/tax/total) directly onto orders, all
	// in integer cents. Payment method/status is no longer stored here — it is
	// recorded in order_payments at charge time.
	//
	// notes: prefer the explicit customerNote from the request; fall back to a
	// table-number annotation so existing behaviour for table orders is preserved.
	var notes any
	switch {
	case customerNote != "":
		notes = customerNote
	case tableNumber != "":
		notes = "Table: " + tableNumber
	}
	var orderID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO orders (
		    organization_id, location_id, customer_id, order_number,
		    order_type, fulfillment_type, status, table_session_id,
		    subtotal_cents, tax_cents, total_cents, tax_rate, tax_inclusive,
		    currency_code, estimated_prep_time, notes, gratuity_cents
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13, 20, $14, $15)
		RETURNING id
	`,
		*orgID, locationID, nullStr(customerID), orderNumber,
		orderType, fulfillmentTypeFor(orderType), initialStatus, nullStr(tableSessionID),
		subtotalCents, taxCents, totalCents, taxRate,
		cur.Code, notes, gratuityCents,
	).Scan(&orderID); err != nil {
		return nil, err
	}

	// --- 7. Insert order_items and order_item_modifiers ---
	// Migration 022 adds order_items.course_id (nullable uuid) and the
	// order_item_modifiers table. Both are coded against that schema; they
	// compile and work once migration 022 has been applied at runtime.
	for i, line := range lines {
		unitCents := lineUnitCents[i]

		// --- 7a. Daily-countdown decrement (Wave 24, migration 026 columns) ---
		// For items with a non-NULL daily_quantity we atomically:
		//   1. Reset daily_sold_count if daily_counter_date is not today.
		//   2. Check remaining = daily_quantity - daily_sold_count.
		//   3. Reject with ErrItemSoldOut if remaining < requested quantity.
		//   4. Increment daily_sold_count by the requested quantity.
		// Items with NULL daily_quantity are unlimited and skip this block.
		item := itemCache[line.ItemID]
		if item.dailyQuantity != nil {
			// Use a SELECT … FOR UPDATE on the items row so concurrent orders
			// for the same item serialise at the row level within the tx.
			var remaining int
			if err := tx.QueryRow(ctx, `
				UPDATE items
				SET daily_sold_count = CASE
				        WHEN daily_counter_date IS DISTINCT FROM CURRENT_DATE
				        THEN $1
				        ELSE daily_sold_count + $1
				    END,
				    daily_counter_date = CURRENT_DATE
				WHERE id = $2
				  AND daily_quantity IS NOT NULL
				RETURNING daily_quantity - CASE
				        WHEN (daily_counter_date IS DISTINCT FROM CURRENT_DATE
				              OR daily_counter_date IS NULL)
				        THEN 0
				        ELSE daily_sold_count
				    END
			`, line.Quantity, line.ItemID).Scan(&remaining); err != nil {
				return nil, fmt.Errorf("daily countdown for item %s: %w", line.ItemID, err)
			}
			// remaining = daily_quantity - new_sold_count (stock left AFTER this
			// order's quantity was added). A negative value means we oversold;
			// reject only in that case to avoid false-rejecting valid orders.
			if remaining < 0 {
				return nil, fmt.Errorf("%w: %q is sold out for today", ErrItemSoldOut, item.name)
			}
		}

		var orderItemID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO order_items (order_id, item_id, quantity, unit_price_cents, total_price_cents, special_instructions, course_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id
		`, orderID, line.ItemID, line.Quantity, unitCents, unitCents*int64(line.Quantity),
			nullStr(line.Notes), nullStr(line.CourseID),
		).Scan(&orderItemID); err != nil {
			return nil, err
		}

		// Persist selected modifiers as order_item_modifiers rows.
		// price_cents_snapshot captures the modifier's price_delta_cents at order
		// time so that later repricing never retroactively alters historical totals.
		for _, rm := range lineModifiers[i] {
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_item_modifiers (order_item_id, modifier_id, price_cents_snapshot, name_snapshot)
				VALUES ($1, $2, $3, $4)
			`, orderItemID, rm.modifierID, rm.priceDeltaCents, rm.name,
			); err != nil {
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
		// Non-fatal: order is committed; enqueue for the KDS fanout job so the
		// kitchen is never silently missed. Capture the original error so ops
		// can inspect it via kds_fanout_queue.error_message. kds_fanout_queue
		// INSERT is service-role-only (migration 008/020), so elevate for this
		// write — the surrounding order mutations stay tenant-scoped.
		qErr := db.WithTxServiceRole(ctx, tx, func() error {
			_, e := tx.Exec(ctx, `
				INSERT INTO kds_fanout_queue (order_id, error_message, retry_count, state)
				VALUES ($1, $2, 0, 'pending')
				ON CONFLICT (order_id) DO NOTHING
			`, orderID, err.Error())
			return e
		})
		if qErr != nil {
			// Last-resort: log both errors so nothing is silently swallowed.
			log.Printf("pos: fanout failed (%v) AND enqueue failed (%v) for order=%s — kitchen may miss this order", err, qErr, orderID)
		}
		kdsTicketIDs = []string{}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &CreatedOrder{
		OrderID:       orderID,
		OrderNumber:   orderNumber,
		Subtotal:      float64(subtotalCents) / 100,
		Tax:           float64(taxCents) / 100,
		Gratuity:      float64(gratuityCents) / 100,
		Total:         float64(totalCents) / 100,
		CurrencyCode:  cur.Code,
		KDSTicketIDs:  kdsTicketIDs,
		Status:        initialStatus,
		PaymentMethod: initialPaymentMethod,
	}, nil
}

// fulfillmentTypeFor maps the order_type text to the fulfillment_type enum
// (collection | delivery | dine_in). pickup/whatsapp/collection all map to
// 'collection'; dine_in and delivery map to themselves.
func fulfillmentTypeFor(orderType string) string {
	switch orderType {
	case "dine_in":
		return "dine_in"
	case "delivery":
		return "delivery"
	default:
		return "collection"
	}
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

	// Gather distinct stations using the routing fallback chain
	// (item routing -> category routing -> location default station). This
	// guarantees every order_item resolves to a station so the kitchen is
	// never silently missed when only category-level routing (or none) exists.
	rows, err := tx.Query(ctx, kdsStationDiscoverySQL, orderID)
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

		// Insert ticket items for order_items that resolve to this station via
		// the same routing fallback chain used for station discovery.
		itemRows, err := tx.Query(ctx, kdsTicketItemsInsertSQL, orderID, ticketID, stationID)
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

// GetOrderLocationID returns the location_id for the given order.
// Returns ErrOrderNotFound when no order with that ID exists.
// Uses the request's db.Scope so RLS session variables are set.
func (s *Store) GetOrderLocationID(ctx context.Context, orderID string) (string, error) {
	scope := db.ScopeFromContext(ctx)
	var locID string
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT location_id FROM orders WHERE id = $1`, orderID,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrderNotFound
	}
	return locID, err
}

// GetTableSessionLocationID returns the location_id for the given table session.
// Returns ErrOrderNotFound when no session with that ID exists (avoids leaking
// existence of a foreign session via a distinct sentinel).
// Uses the request's db.Scope so RLS session variables are set.
func (s *Store) GetTableSessionLocationID(ctx context.Context, sessionID string) (string, error) {
	scope := db.ScopeFromContext(ctx)
	var locID string
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT location_id FROM table_sessions WHERE id = $1`, sessionID,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrOrderNotFound
	}
	return locID, err
}

// setTxScope writes the request's db.Scope session variables into an already-open
// transaction so RLS policies can evaluate current_org_id(), current_user_id(),
// etc. Must be called immediately after BeginTx and before any DML.
func setTxScope(ctx context.Context, tx pgx.Tx, scope db.Scope) error {
	vars := []struct{ name, val string }{
		{"app.current_user_id", scope.UserID},
		{"app.current_org_id", scope.OrgID},
		{"app.is_service_role", boolStr(scope.IsServiceRole)},
	}
	for _, v := range vars {
		if _, err := tx.Exec(ctx, `SELECT set_config($1, $2, true)`, v.name, v.val); err != nil {
			return fmt.Errorf("setTxScope %s: %w", v.name, err)
		}
	}
	return nil
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return ""
}

// nullStr converts an empty string to nil so optional DB columns receive NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
