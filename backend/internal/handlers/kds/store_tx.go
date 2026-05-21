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
// Optimised: single batched query for all ticket items (WHERE ticket_id = ANY($1))
// instead of 1+N per-ticket queries.
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
	var ticketIDs []string
	for rows.Next() {
		var t Ticket
		if err := rows.Scan(
			&t.ID, &t.OrderID, &t.StationID, &t.TicketNumber, &t.Status,
			&t.FiredAt, &t.StartedAt, &t.ReadyAt, &t.BumpedAt, &t.BumpedBy,
			&t.CourseNumber, &t.Priority, &t.Notes, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, err
		}
		tickets = append(tickets, TicketWithItems{Ticket: t, Items: []TicketItem{}})
		ticketIDs = append(ticketIDs, t.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(ticketIDs) == 0 {
		return tickets, nil
	}

	// Single batched query for all items across all tickets.
	// ORDER BY ticket_id groups items by ticket; created_at preserves per-ticket order.
	itemRows, err := tx.Query(ctx, `
		SELECT id, ticket_id, order_item_id,
			quantity::text, item_status, started_at, ready_at, bumped_at,
			notes, created_at, updated_at
		FROM kds_ticket_items
		WHERE ticket_id = ANY($1)
		ORDER BY ticket_id, created_at
	`, ticketIDs)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()

	// Build a lookup index so we can assign items without a second pass over tickets.
	ticketIdx := make(map[string]int, len(tickets))
	for i, tw := range tickets {
		ticketIdx[tw.ID] = i
	}

	for itemRows.Next() {
		var ti TicketItem
		if err := itemRows.Scan(
			&ti.ID, &ti.TicketID, &ti.OrderItemID,
			&ti.Quantity, &ti.ItemStatus, &ti.StartedAt, &ti.ReadyAt, &ti.BumpedAt,
			&ti.Notes, &ti.CreatedAt, &ti.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if idx, ok := ticketIdx[ti.TicketID]; ok {
			tickets[idx].Items = append(tickets[idx].Items, ti)
		}
	}
	if err := itemRows.Err(); err != nil {
		return nil, err
	}

	return tickets, nil
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
// Delegates to the shared getTicketDetailUsing helper so pool and tx variants
// stay in sync. Queries from 2+3N to 5 regardless of item count.
func (s *Store) GetTicketDetailTx(ctx context.Context, tx pgx.Tx, ticketID string) (*TicketDetail, error) {
	return getTicketDetailUsing(ctx, ticketID, newQuerier(tx))
}
