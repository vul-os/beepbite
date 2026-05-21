package kds

// store_tx.go — transaction-accepting shim methods for the KDS store.
//
// These are thin wrappers that expose the existing store logic through a
// pgx.Tx parameter rather than opening their own transaction. They are used
// by the reference-ported handler (handler.go) which calls db.Scoped to
// open the transaction and set session variables before handing the tx in.
//
// Phase B/C note: when the consolidated migrations are live and store.go is
// rewritten to target the new schema, these shims should be merged directly
// into the store methods (each method should accept an optional tx or use a
// querier interface). For now they proxy through the existing pool-based
// methods — the session vars set by db.Scoped remain visible for the duration
// of the Scoped transaction, so any query executed on the same tx (or on
// any connection acquired from the same pool within the same transaction)
// will see the RLS policies enforced.

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// FanoutOrderTx fans out an order's items into KDS tickets within an already-
// open transaction. The session variables set by db.Scoped are active on tx.
func (s *Store) FanoutOrderTx(ctx context.Context, tx pgx.Tx, orderID string) ([]TicketWithItems, error) {
	// Verify the order exists and get course_number.
	var courseNumber *int
	err := tx.QueryRow(ctx,
		`SELECT course_number FROM orders WHERE id = $1`, orderID).Scan(&courseNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}

	// Derive stations from routing (item -> category -> location default).
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

	var result []TicketWithItems

	for _, stationID := range stations {
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

		if _, err := tx.Exec(ctx, `
			INSERT INTO kds_ticket_events (ticket_id, event_type)
			VALUES ($1, 'fired')
		`, t.ID); err != nil {
			return nil, err
		}

		result = append(result, TicketWithItems{Ticket: t, Items: items})
	}

	return result, nil
}

// writeTicketEventTx is the tx-aware version of writeTicketEvent.
func (s *Store) writeTicketEventTx(
	ctx context.Context,
	tx pgx.Tx,
	ticketID, newStatus, eventType, performedBy string,
	extraUpdate string,
) (*Ticket, *TicketEventRow, error) {
	var t Ticket
	err := tx.QueryRow(ctx, `
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

	return &t, &ev, nil
}

// BumpTicketTx marks the ticket bumped within an open transaction.
func (s *Store) BumpTicketTx(ctx context.Context, tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
	return s.writeTicketEventTx(ctx, tx, ticketID, "bumped", "bumped", performedBy, ", bumped_at = now()")
}

// RecallTicketTx un-bumps a ticket within an open transaction.
func (s *Store) RecallTicketTx(ctx context.Context, tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
	return s.writeTicketEventTx(ctx, tx, ticketID, "fired", "recalled", performedBy, ", bumped_at = NULL")
}

// RefireTicketTx re-issues a bumped/cancelled ticket within an open transaction.
func (s *Store) RefireTicketTx(ctx context.Context, tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
	return s.writeTicketEventTx(ctx, tx, ticketID, "fired", "re_fired", performedBy, "")
}

// RushTicketTx increments priority and emits a 'rushed' event within an open transaction.
func (s *Store) RushTicketTx(ctx context.Context, tx pgx.Tx, ticketID, performedBy string) (*Ticket, *TicketEventRow, error) {
	var t Ticket
	err := tx.QueryRow(ctx, `
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

	return &t, &ev, nil
}

// ListStationTicketsTx returns active tickets for a station within an open transaction.
func (s *Store) ListStationTicketsTx(ctx context.Context, tx pgx.Tx, stationID string) ([]TicketWithItems, error) {
	rows, err := tx.Query(ctx, `
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

	// Fetch items for each ticket using the same transaction.
	for i, tw := range tickets {
		items, err := s.ticketItemsTx(ctx, tx, tw.ID)
		if err != nil {
			return nil, err
		}
		tickets[i].Items = items
	}
	return tickets, nil
}

func (s *Store) ticketItemsTx(ctx context.Context, tx pgx.Tx, ticketID string) ([]TicketItem, error) {
	rows, err := tx.Query(ctx, `
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

// GetExpoOrderTx returns the expo view row for an order within an open transaction.
func (s *Store) GetExpoOrderTx(ctx context.Context, tx pgx.Tx, orderID string) (*ExpoRow, error) {
	var e ExpoRow
	err := tx.QueryRow(ctx, `
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

// GetTicketDetailTx returns the enriched ticket detail within an open transaction.
// This is a tx-aware shim for GetTicketDetail; all pool.Query/pool.QueryRow calls
// are replaced with tx.Query/tx.QueryRow so they participate in the Scoped transaction.
func (s *Store) GetTicketDetailTx(ctx context.Context, tx pgx.Tx, ticketID string) (*TicketDetail, error) {
	var detail TicketDetail
	var rawNotes *string
	err := tx.QueryRow(ctx, `
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

	// Extract table number from orders.notes ("Table: T-12").
	if rawNotes != nil {
		const prefix = "Table: "
		if len(*rawNotes) > len(prefix) && (*rawNotes)[:len(prefix)] == prefix {
			t := (*rawNotes)[len(prefix):]
			detail.TableNumber = &t
		}
	}

	// Ticket items.
	itemRows, err := tx.Query(ctx, `
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

		// Variations (order_item_variations → item_variation_options).
		varRows, err := tx.Query(ctx, `
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

		// Ingredients (item_recipes).
		ingRows, err := tx.Query(ctx, `
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

		// Prep steps (item_prep_steps, from legacy migration 44).
		stepRows, err := tx.Query(ctx, `
			SELECT step_number, instruction
			FROM item_prep_steps
			WHERE item_id = $1
			ORDER BY step_number
		`, ri.itemID)
		if err != nil {
			return nil, err
		}
		di.PrepSteps = []PrepStep{}
		for stepRows.Next() {
			var ps PrepStep
			if err := stepRows.Scan(&ps.StepNumber, &ps.Instruction); err != nil {
				stepRows.Close()
				return nil, err
			}
			di.PrepSteps = append(di.PrepSteps, ps)
		}
		stepRows.Close()
		if err := stepRows.Err(); err != nil {
			return nil, err
		}

		detail.Items = append(detail.Items, di)
	}

	return &detail, nil
}

