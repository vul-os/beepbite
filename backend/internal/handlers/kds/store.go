package kds

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors for HTTP-layer mapping.
var (
	ErrTicketNotFound = errors.New("kds ticket not found")
	ErrOrderNotFound  = errors.New("order not found")
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
// routing exists, or no routing exists at all, so the kitchen is never
// silently missed.
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

// kdsTicketItemsInsertReturningSQL inserts kds_ticket_items for order_items
// that resolve to a given station and returns the full inserted rows.
// The shared CTE binds $1 = order_id, so this uses $2 = ticket_id, $3 = station_id.
const kdsTicketItemsInsertReturningSQL = kdsItemRoutesCTE + `
	INSERT INTO kds_ticket_items (ticket_id, order_item_id, quantity, item_status, notes)
	SELECT $2, ir.order_item_id, ir.quantity, 'fired', ir.special_instructions
	FROM item_routes ir
	WHERE ir.station_id = $3
	ON CONFLICT (ticket_id, order_item_id) DO NOTHING
	RETURNING id, ticket_id, order_item_id,
		quantity::text, item_status, started_at, ready_at, bumped_at,
		notes, created_at, updated_at`

// ---------------------------------------------------------------------------
// Wire types (DTOs that map directly to DB rows / query results)
// ---------------------------------------------------------------------------

// Ticket mirrors a kds_tickets row.
type Ticket struct {
	ID           string     `json:"id"`
	OrderID      string     `json:"order_id"`
	StationID    string     `json:"station_id"`
	TicketNumber int        `json:"ticket_number"`
	Status       string     `json:"status"`
	FiredAt      time.Time  `json:"fired_at"`
	StartedAt    *time.Time `json:"started_at"`
	ReadyAt      *time.Time `json:"ready_at"`
	BumpedAt     *time.Time `json:"bumped_at"`
	BumpedBy     *string    `json:"bumped_by"`
	CourseNumber *int       `json:"course_number"`
	Priority     int        `json:"priority"`
	Notes        *string    `json:"notes"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// TicketItem mirrors a kds_ticket_items row.
type TicketItem struct {
	ID          string     `json:"id"`
	TicketID    string     `json:"ticket_id"`
	OrderItemID string     `json:"order_item_id"`
	Quantity    string     `json:"quantity"` // decimal(10,3) -> string to avoid float noise
	ItemStatus  string     `json:"item_status"`
	StartedAt   *time.Time `json:"started_at"`
	ReadyAt     *time.Time `json:"ready_at"`
	BumpedAt    *time.Time `json:"bumped_at"`
	Notes       *string    `json:"notes"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// TicketWithItems bundles a ticket and its items for list endpoints.
type TicketWithItems struct {
	Ticket
	Items []TicketItem `json:"items"`
}

// TicketEventRow mirrors a kds_ticket_events row.
type TicketEventRow struct {
	ID           string     `json:"id"`
	TicketID     string     `json:"ticket_id"`
	TicketItemID *string    `json:"ticket_item_id"`
	EventType    string     `json:"event_type"`
	PerformedBy  *string    `json:"performed_by"`
	CreatedAt    time.Time  `json:"created_at"`
}

// ExpoRow mirrors one row from kds_expo_view.
type ExpoRow struct {
	OrderID        string    `json:"order_id"`
	LocationID     string    `json:"location_id"`
	EarliestFiredAt time.Time `json:"earliest_fired_at"`
	AllReady       bool      `json:"all_ready"`
	AnyInProgress  bool      `json:"any_in_progress"`
	StationTickets []byte    `json:"station_tickets"` // raw jsonb
	MaxPriority    int       `json:"max_priority"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// nullStr converts an empty string to nil (SQL NULL).
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// ---------------------------------------------------------------------------
// Fanout
// ---------------------------------------------------------------------------

// FanoutOrder fans order_items for the given order out into kds_tickets /
// kds_ticket_items using item_station_routing. One ticket per (order, station).
// Returns the list of tickets created.
func (s *Store) FanoutOrder(ctx context.Context, orderID string) ([]TicketWithItems, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Verify the order exists and get course_number.
	var courseNumber *int
	err = tx.QueryRow(ctx,
		`SELECT course_number FROM orders WHERE id = $1`, orderID).Scan(&courseNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}

	// Derive (station_id, ticket_number) groups from routing.
	// ticket_number = next value in a per-location sequence using a simple
	// SELECT MAX(ticket_number)+1 approach (good enough; a real sequence
	// would need a migration).
	type stationGroup struct {
		stationID string
	}
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

	_ = stationGroup{} // suppress unused-type lint if any

	var result []TicketWithItems

	for _, stationID := range stations {
		// Next ticket number for this station's location.
		var ticketNumber int
		err = tx.QueryRow(ctx, `
			SELECT COALESCE(MAX(kt.ticket_number), 0) + 1
			FROM kds_tickets kt
			JOIN kitchen_stations ks ON ks.id = kt.station_id
			WHERE ks.location_id = (SELECT location_id FROM kitchen_stations WHERE id = $1)
		`, stationID).Scan(&ticketNumber)
		if err != nil {
			return nil, err
		}

		// Insert the ticket (ON CONFLICT DO NOTHING so re-fanout is idempotent).
		var t Ticket
		err = tx.QueryRow(ctx, `
			INSERT INTO kds_tickets (
				order_id, station_id, ticket_number, status,
				course_number, priority
			) VALUES ($1, $2, $3, 'fired', $4, 0)
			ON CONFLICT (order_id, station_id) DO UPDATE
				SET updated_at = now()
			RETURNING id, order_id, station_id, ticket_number, status,
				fired_at, started_at, ready_at, bumped_at, bumped_by,
				course_number, priority, notes, created_at, updated_at
		`, orderID, stationID, ticketNumber, courseNumber).Scan(
			&t.ID, &t.OrderID, &t.StationID, &t.TicketNumber, &t.Status,
			&t.FiredAt, &t.StartedAt, &t.ReadyAt, &t.BumpedAt, &t.BumpedBy,
			&t.CourseNumber, &t.Priority, &t.Notes, &t.CreatedAt, &t.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		// Insert ticket items for order_items that resolve to this station via
		// the routing fallback chain (item -> category -> location default).
		itemRows, err := tx.Query(ctx, kdsTicketItemsInsertReturningSQL, orderID, t.ID, stationID)
		if err != nil {
			return nil, err
		}
		var items []TicketItem
		for itemRows.Next() {
			var ti TicketItem
			if err := itemRows.Scan(
				&ti.ID, &ti.TicketID, &ti.OrderItemID,
				&ti.Quantity, &ti.ItemStatus, &ti.StartedAt, &ti.ReadyAt, &ti.BumpedAt,
				&ti.Notes, &ti.CreatedAt, &ti.UpdatedAt,
			); err != nil {
				itemRows.Close()
				return nil, err
			}
			items = append(items, ti)
		}
		itemRows.Close()
		if err := itemRows.Err(); err != nil {
			return nil, err
		}

		// Write the 'fired' event.
		if _, err := tx.Exec(ctx, `
			INSERT INTO kds_ticket_events (ticket_id, event_type)
			VALUES ($1, 'fired')
		`, t.ID); err != nil {
			return nil, err
		}

		result = append(result, TicketWithItems{Ticket: t, Items: items})
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// Ticket state transitions
// ---------------------------------------------------------------------------

// writeTicketEvent updates the ticket status and appends an event row.
// Returns the event row so the caller can publish it to the broker.
func (s *Store) writeTicketEvent(
	ctx context.Context,
	ticketID, newStatus, eventType, performedBy string,
	extraUpdate string, // optional extra SET clauses, e.g. ", bumped_at = now()"
) (*Ticket, *TicketEventRow, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	var t Ticket
	err = tx.QueryRow(ctx, `
		UPDATE kds_tickets
		SET status = $2, updated_at = now()`+extraUpdate+`
		WHERE id = $1
		RETURNING id, order_id, station_id, ticket_number, status,
			fired_at, started_at, ready_at, bumped_at, bumped_by,
			course_number, priority, notes, created_at, updated_at
	`, ticketID, newStatus).Scan(
		&t.ID, &t.OrderID, &t.StationID, &t.TicketNumber, &t.Status,
		&t.FiredAt, &t.StartedAt, &t.ReadyAt, &t.BumpedAt, &t.BumpedBy,
		&t.CourseNumber, &t.Priority, &t.Notes, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, nil, err
	}

	var ev TicketEventRow
	err = tx.QueryRow(ctx, `
		INSERT INTO kds_ticket_events (ticket_id, event_type, performed_by)
		VALUES ($1, $2, $3)
		RETURNING id, ticket_id, ticket_item_id, event_type, performed_by, created_at
	`, ticketID, eventType, nullStr(performedBy)).Scan(
		&ev.ID, &ev.TicketID, &ev.TicketItemID, &ev.EventType, &ev.PerformedBy, &ev.CreatedAt,
	)
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return &t, &ev, nil
}

// BumpTicket marks the ticket bumped (done at station).
func (s *Store) BumpTicket(ctx context.Context, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
	return s.writeTicketEvent(ctx, ticketID, "bumped", "bumped", performedBy, ", bumped_at = now()")
}

// RecallTicket un-bumps the ticket back to 'fired'.
func (s *Store) RecallTicket(ctx context.Context, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
	return s.writeTicketEvent(ctx, ticketID, "fired", "recalled", performedBy, ", bumped_at = NULL")
}

// RefireTicket re-issues a bumped/cancelled ticket back to 'fired'.
func (s *Store) RefireTicket(ctx context.Context, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
	return s.writeTicketEvent(ctx, ticketID, "fired", "re_fired", performedBy, "")
}

// RushTicket marks priority and emits a 'rushed' event.
func (s *Store) RushTicket(ctx context.Context, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	var t Ticket
	err = tx.QueryRow(ctx, `
		UPDATE kds_tickets
		SET priority = priority + 1, updated_at = now()
		WHERE id = $1
		RETURNING id, order_id, station_id, ticket_number, status,
			fired_at, started_at, ready_at, bumped_at, bumped_by,
			course_number, priority, notes, created_at, updated_at
	`, ticketID).Scan(
		&t.ID, &t.OrderID, &t.StationID, &t.TicketNumber, &t.Status,
		&t.FiredAt, &t.StartedAt, &t.ReadyAt, &t.BumpedAt, &t.BumpedBy,
		&t.CourseNumber, &t.Priority, &t.Notes, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, nil, err
	}

	var ev TicketEventRow
	err = tx.QueryRow(ctx, `
		INSERT INTO kds_ticket_events (ticket_id, event_type, performed_by)
		VALUES ($1, 'rushed', $2)
		RETURNING id, ticket_id, ticket_item_id, event_type, performed_by, created_at
	`, ticketID, nullStr(performedBy)).Scan(
		&ev.ID, &ev.TicketID, &ev.TicketItemID, &ev.EventType, &ev.PerformedBy, &ev.CreatedAt,
	)
	if err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return &t, &ev, nil
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// ListStationTickets returns active (non-bumped, non-cancelled) tickets for a
// station, ordered by priority desc then fired_at asc.
func (s *Store) ListStationTickets(ctx context.Context, stationID string) ([]TicketWithItems, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, order_id, station_id, ticket_number, status,
			fired_at, started_at, ready_at, bumped_at, bumped_by,
			course_number, priority, notes, created_at, updated_at
		FROM kds_tickets
		WHERE station_id = $1
		  AND status IN ('fired', 'in_progress', 'ready')
		ORDER BY priority DESC, fired_at ASC
	`, stationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tickets []TicketWithItems
	for rows.Next() {
		var t Ticket
		if err := rows.Scan(
			&t.ID, &t.OrderID, &t.StationID, &t.TicketNumber, &t.Status,
			&t.FiredAt, &t.StartedAt, &t.ReadyAt, &t.BumpedAt, &t.BumpedBy,
			&t.CourseNumber, &t.Priority, &t.Notes, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		tickets = append(tickets, TicketWithItems{Ticket: t})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Fetch items for each ticket.
	for i, tw := range tickets {
		items, err := s.ticketItems(ctx, tw.ID)
		if err != nil {
			return nil, err
		}
		tickets[i].Items = items
	}
	return tickets, nil
}

func (s *Store) ticketItems(ctx context.Context, ticketID string) ([]TicketItem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, ticket_id, order_item_id,
			quantity::text, item_status, started_at, ready_at, bumped_at,
			notes, created_at, updated_at
		FROM kds_ticket_items
		WHERE ticket_id = $1
		ORDER BY created_at
	`, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []TicketItem
	for rows.Next() {
		var ti TicketItem
		if err := rows.Scan(
			&ti.ID, &ti.TicketID, &ti.OrderItemID,
			&ti.Quantity, &ti.ItemStatus, &ti.StartedAt, &ti.ReadyAt, &ti.BumpedAt,
			&ti.Notes, &ti.CreatedAt, &ti.UpdatedAt,
		); err != nil {
			return nil, err
		}
		items = append(items, ti)
	}
	return items, rows.Err()
}

// GetExpoOrder returns the kds_expo_view row(s) for a specific order_id.
func (s *Store) GetExpoOrder(ctx context.Context, orderID string) (*ExpoRow, error) {
	var e ExpoRow
	err := s.pool.QueryRow(ctx, `
		SELECT order_id, location_id, earliest_fired_at,
			all_ready, any_in_progress, station_tickets, max_priority
		FROM kds_expo_view
		WHERE order_id = $1
	`, orderID).Scan(
		&e.OrderID, &e.LocationID, &e.EarliestFiredAt,
		&e.AllReady, &e.AnyInProgress, &e.StationTickets, &e.MaxPriority,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// GetTicketStationID returns just the station_id for a ticket (used to resolve
// the broker publish target after a state mutation).
func (s *Store) GetTicketStationID(ctx context.Context, ticketID string) (string, error) {
	var sid string
	err := s.pool.QueryRow(ctx,
		`SELECT station_id FROM kds_tickets WHERE id = $1`, ticketID).Scan(&sid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTicketNotFound
	}
	return sid, err
}

// ---------------------------------------------------------------------------
// Ticket detail types
// ---------------------------------------------------------------------------

// PrepStep is one row from item_prep_steps.
type PrepStep struct {
	StepNumber  int    `json:"step_number"`
	Instruction string `json:"instruction"`
}

// Ingredient is one ingredient from item_recipes resolved to item name + unit.
type Ingredient struct {
	Name     string  `json:"name"`
	Quantity float64 `json:"quantity"`
	Unit     string  `json:"unit"`
}

// TicketDetailItem is one kds_ticket_items row enriched with item name,
// variations, ingredients, and prep steps.
type TicketDetailItem struct {
	TicketItemID string       `json:"ticket_item_id"`
	ItemName     string       `json:"item_name"`
	Quantity     string       `json:"quantity"`
	Status       string       `json:"status"`
	Notes        *string      `json:"notes"`
	Variations   []string     `json:"variations"`
	Ingredients  []Ingredient `json:"ingredients"`
	PrepSteps    []PrepStep   `json:"prep_steps"`
}

// TicketDetail is the full response for GET /kds/tickets/{id}/details.
type TicketDetail struct {
	TicketID    string             `json:"ticket_id"`
	OrderNumber string             `json:"order_number"`
	StationName string             `json:"station_name"`
	TableNumber *string            `json:"table_number"`
	FiredAt     time.Time          `json:"fired_at"`
	Items       []TicketDetailItem `json:"items"`
}

// GetTicketDetail fetches the enriched ticket detail for the given ticket_id.
// Ingredients come from item_recipes (child_item_id → items.name).
// Prep steps come from item_prep_steps (added in migration-44).
func (s *Store) GetTicketDetail(ctx context.Context, ticketID string) (*TicketDetail, error) {
	var detail TicketDetail
	var rawNotes *string // orders.notes may carry "Table: T-12"
	err := s.pool.QueryRow(ctx, `
		SELECT
			kt.id,
			o.order_number,
			ks.name         AS station_name,
			o.notes         AS order_notes,
			kt.fired_at
		FROM kds_tickets kt
		JOIN orders           o  ON o.id  = kt.order_id
		JOIN kitchen_stations ks ON ks.id = kt.station_id
		WHERE kt.id = $1
	`, ticketID).Scan(
		&detail.TicketID,
		&detail.OrderNumber,
		&detail.StationName,
		&rawNotes,
		&detail.FiredAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrTicketNotFound
	}
	if err != nil {
		return nil, err
	}

	// Extract table number stored as "Table: T-12" in orders.notes.
	if rawNotes != nil {
		const prefix = "Table: "
		if len(*rawNotes) > len(prefix) && (*rawNotes)[:len(prefix)] == prefix {
			t := (*rawNotes)[len(prefix):]
			detail.TableNumber = &t
		}
	}

	// --- Ticket items ---
	itemRows, err := s.pool.Query(ctx, `
		SELECT
			kti.id,
			i.name,
			kti.quantity::text,
			kti.item_status,
			kti.notes,
			oi.id AS order_item_id,
			oi.item_id
		FROM kds_ticket_items kti
		JOIN order_items oi ON oi.id = kti.order_item_id
		JOIN items        i  ON i.id  = oi.item_id
		WHERE kti.ticket_id = $1
		ORDER BY kti.created_at
	`, ticketID)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()

	type rawItem struct {
		ticketItemID string
		itemName     string
		quantity     string
		status       string
		notes        *string
		orderItemID  string
		itemID       string
	}
	var rawItems []rawItem
	for itemRows.Next() {
		var ri rawItem
		if err := itemRows.Scan(
			&ri.ticketItemID, &ri.itemName, &ri.quantity,
			&ri.status, &ri.notes, &ri.orderItemID, &ri.itemID,
		); err != nil {
			return nil, err
		}
		rawItems = append(rawItems, ri)
	}
	if err := itemRows.Err(); err != nil {
		return nil, err
	}

	detail.Items = make([]TicketDetailItem, 0, len(rawItems))

	for _, ri := range rawItems {
		di := TicketDetailItem{
			TicketItemID: ri.ticketItemID,
			ItemName:     ri.itemName,
			Quantity:     ri.quantity,
			Status:       ri.status,
			Notes:        ri.notes,
		}

		// Variations
		varRows, err := s.pool.Query(ctx, `
			SELECT ivo.name
			FROM order_item_variations oiv
			JOIN item_variation_options ivo ON ivo.id = oiv.option_id
			WHERE oiv.order_item_id = $1
			ORDER BY oiv.created_at
		`, ri.orderItemID)
		if err != nil {
			return nil, err
		}
		di.Variations = []string{}
		for varRows.Next() {
			var vname string
			if err := varRows.Scan(&vname); err != nil {
				varRows.Close()
				return nil, err
			}
			di.Variations = append(di.Variations, vname)
		}
		varRows.Close()
		if err := varRows.Err(); err != nil {
			return nil, err
		}

		// Ingredients (item_recipes.child_item_id → items.name)
		ingRows, err := s.pool.Query(ctx, `
			SELECT
				ci.name,
				ir.quantity_needed,
				COALESCE(ir.unit, 'ea')
			FROM item_recipes ir
			JOIN items ci ON ci.id = ir.child_item_id
			WHERE ir.parent_item_id = $1
			ORDER BY ir.recipe_level, ci.name
		`, ri.itemID)
		if err != nil {
			return nil, err
		}
		di.Ingredients = []Ingredient{}
		for ingRows.Next() {
			var ing Ingredient
			if err := ingRows.Scan(&ing.Name, &ing.Quantity, &ing.Unit); err != nil {
				ingRows.Close()
				return nil, err
			}
			di.Ingredients = append(di.Ingredients, ing)
		}
		ingRows.Close()
		if err := ingRows.Err(); err != nil {
			return nil, err
		}

		// Prep steps (item_prep_steps — migration-44)
		psRows, err := s.pool.Query(ctx, `
			SELECT step_number, instruction
			FROM item_prep_steps
			WHERE item_id = $1
			ORDER BY step_number
		`, ri.itemID)
		if err != nil {
			return nil, err
		}
		di.PrepSteps = []PrepStep{}
		for psRows.Next() {
			var ps PrepStep
			if err := psRows.Scan(&ps.StepNumber, &ps.Instruction); err != nil {
				psRows.Close()
				return nil, err
			}
			di.PrepSteps = append(di.PrepSteps, ps)
		}
		psRows.Close()
		if err := psRows.Err(); err != nil {
			return nil, err
		}

		detail.Items = append(detail.Items, di)
	}

	return &detail, nil
}
