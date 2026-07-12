package main

import (
	"fmt"
	"log"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5"
)

// seedLive adds a slice of in-progress "current service" orders dated today,
// spread across the active order statuses, plus KDS tickets routed to stations —
// so the home dashboard's Live Orders, the KDS expo, and the reports order-status
// distribution all look like a restaurant mid-service rather than a dead archive.
func seedLive(s *seeder, c *Ctx) error {
	// Idempotency: skip if any non-completed order already exists for the org.
	var existing int
	if err := s.pool.QueryRow(s.ctx,
		`SELECT count(*) FROM orders WHERE organization_id=$1 AND status <> 'completed'`,
		c.OrgID).Scan(&existing); err != nil {
		return fmt.Errorf("seedLive: count active orders: %w", err)
	}
	if existing > 0 {
		log.Printf("  live service: %d active orders already present — skipping", existing)
		return nil
	}

	if len(c.Items) == 0 {
		log.Printf("  live service: no items — skipping")
		return nil
	}

	// Stable ordered item list for deterministic selection.
	itemNames := make([]string, 0, len(c.Items))
	for name := range c.Items {
		itemNames = append(itemNames, name)
	}
	// Sort for determinism (map iteration order is random).
	for i := 1; i < len(itemNames); i++ {
		for j := i; j > 0 && itemNames[j] < itemNames[j-1]; j-- {
			itemNames[j], itemNames[j-1] = itemNames[j-1], itemNames[j]
		}
	}

	rng := rand.New(rand.NewSource(90210))

	// Continue order numbering after the historical archive.
	var maxSeq int
	_ = s.pool.QueryRow(s.ctx, `SELECT count(*) FROM orders WHERE organization_id=$1`, c.OrgID).Scan(&maxSeq)

	// The mix of active orders to create. Each entry: status + how many.
	plan := []struct {
		status string
		n      int
	}{
		{"pending", 3},
		{"confirmed", 3},
		{"preparing", 5},
		{"ready", 4},
		{"out_for_delivery", 3},
	}

	ticketNo := 0
	created := 0
	tickets := 0

	err := s.tx(func(tx pgx.Tx) error {
		for _, p := range plan {
			for k := 0; k < p.n; k++ {
				maxSeq++
				created++

				// Placed sometime in the last ~90 minutes.
				placedAgo := time.Duration(5+rng.Intn(85)) * time.Minute
				placedAt := c.Now.Add(-placedAgo)

				// Fulfillment: ready/out_for_delivery lean delivery/collection;
				// preparing/confirmed lean dine_in.
				var fulfillment, orderType string
				switch p.status {
				case "out_for_delivery":
					fulfillment, orderType = "delivery", "delivery"
				default:
					switch rng.Intn(3) {
					case 0:
						fulfillment, orderType = "dine_in", "dine_in"
					case 1:
						fulfillment, orderType = "collection", "pickup"
					default:
						fulfillment, orderType = "delivery", "delivery"
					}
				}

				// 1–4 line items.
				nItems := 1 + rng.Intn(4)
				perm := rng.Perm(len(itemNames))
				if nItems > len(itemNames) {
					nItems = len(itemNames)
				}
				type line struct {
					name   string
					itemID string
					qty    int64
					unit   int64
				}
				var lines []line
				var subtotal int64
				for _, idx := range perm[:nItems] {
					name := itemNames[idx]
					id := c.Items[name]
					if id == "" {
						continue
					}
					qty := int64(1 + rng.Intn(2))
					unit := c.ItemPrice[name]
					subtotal += unit * qty
					lines = append(lines, line{name, id, qty, unit})
				}
				if len(lines) == 0 {
					continue
				}

				var deliveryFee, gratuity int64
				if fulfillment == "delivery" {
					deliveryFee = 3500
				}
				if fulfillment == "dine_in" && rng.Intn(2) == 0 {
					gratuity = subtotal * 12 / 100
				}
				total := subtotal + deliveryFee + gratuity

				var custID *string
				if len(c.Customers) > 0 && rng.Intn(10) < 8 {
					id := c.Customers[rng.Intn(len(c.Customers))].ID
					custID = &id
				}

				// Status timestamps.
				var readyAt, deliveredAt *time.Time
				switch p.status {
				case "ready":
					t := placedAt.Add(15 * time.Minute)
					readyAt = &t
				case "out_for_delivery":
					t := placedAt.Add(18 * time.Minute)
					readyAt = &t
				}

				orderNum := fmt.Sprintf("CT-%05d", maxSeq)
				var orderID string
				if err := tx.QueryRow(s.ctx, `
					INSERT INTO orders (
						location_id, organization_id, customer_id, order_number,
						status, fulfillment_type, order_type,
						subtotal_cents, delivery_fee_cents, gratuity_cents, total_cents,
						tax_rate, tax_inclusive, currency_code,
						ready_at, created_at, updated_at
					) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,15.00,true,'ZAR',$12,$13,$13)
					RETURNING id
				`, c.LocID, c.OrgID, custID, orderNum,
					p.status, fulfillment, orderType,
					subtotal, deliveryFee, gratuity, total,
					readyAt, placedAt).Scan(&orderID); err != nil {
					return fmt.Errorf("insert live order %s: %w", orderNum, err)
				}
				_ = deliveredAt

				// The orders AFTER INSERT trigger queue_kds_fanout elevates and then
				// RESETS app.is_service_role to '' (transaction-local) for active
				// statuses — which would drop our scope and make the child inserts
				// below fail RLS. Re-assert service role.
				if _, err := tx.Exec(s.ctx, `SELECT set_config('app.is_service_role','true',true)`); err != nil {
					return fmt.Errorf("re-elevate service role: %w", err)
				}

				// order_items + capture their ids for KDS routing.
				orderItemIDs := make(map[string]string, len(lines)) // item_id -> order_item_id
				for _, ln := range lines {
					var oiID string
					if err := tx.QueryRow(s.ctx, `
						INSERT INTO order_items (order_id, item_id, quantity, unit_price_cents, total_price_cents, created_at, updated_at)
						VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id
					`, orderID, ln.itemID, ln.qty, ln.unit, ln.unit*ln.qty, placedAt).Scan(&oiID); err != nil {
						return fmt.Errorf("insert live order_item: %w", err)
					}
					orderItemIDs[ln.itemID] = oiID
				}

				// Payment: prepaid pickup/delivery -> completed; dine-in open tab -> pending.
				payStatus := "completed"
				payCode := "card_in_person"
				if fulfillment == "dine_in" {
					payStatus = "pending"
				}
				if fulfillment == "delivery" {
					payCode = "card_on_delivery"
				}
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO order_payments (order_id, payment_method_code, amount_paid_cents, tip_amount_cents, payment_status, paid_at)
					VALUES ($1,$2,$3,$4,$5,$6)
				`, orderID, payCode, total, gratuity, payStatus, placedAt); err != nil {
					return fmt.Errorf("insert live payment: %w", err)
				}

				// KDS tickets for orders that have been fired to the kitchen.
				// pending = not yet fired; out_for_delivery = already left the pass.
				if p.status == "confirmed" || p.status == "preparing" || p.status == "ready" {
					n, err := s.fireTickets(tx, orderID, orderItemIDs, p.status, placedAt, &ticketNo)
					if err != nil {
						return err
					}
					tickets += n
				}
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	log.Printf("  live service: %d active orders, %d KDS tickets", created, tickets)
	return nil
}

// fireTickets groups an order's items by their primary KDS station and creates one
// kds_ticket (+ kds_ticket_items) per station, with statuses reflecting the order.
func (s *seeder) fireTickets(tx pgx.Tx, orderID string, orderItemIDs map[string]string, orderStatus string, placedAt time.Time, ticketNo *int) (int, error) {
	// Map each order_item to its primary station.
	rows, err := tx.Query(s.ctx, `
		SELECT oi.id, oi.item_id, oi.quantity, isr.station_id
		FROM order_items oi
		JOIN item_station_routing isr ON isr.item_id = oi.item_id AND isr.is_primary = true
		WHERE oi.order_id = $1
	`, orderID)
	if err != nil {
		return 0, fmt.Errorf("fireTickets: route items: %w", err)
	}
	type oiRow struct {
		oiID    string
		qty     int64
		station string
	}
	byStation := map[string][]oiRow{}
	for rows.Next() {
		var oiID, itemID, station string
		var qty int64
		if err := rows.Scan(&oiID, &itemID, &qty, &station); err != nil {
			rows.Close()
			return 0, err
		}
		byStation[station] = append(byStation[station], oiRow{oiID, qty, station})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	// Ticket + item statuses derived from the order status.
	var ticketStatus, itemStatus string
	var startedAt, readyAt *time.Time
	switch orderStatus {
	case "confirmed":
		ticketStatus, itemStatus = "fired", "fired"
	case "preparing":
		ticketStatus, itemStatus = "in_progress", "in_progress"
		t := placedAt.Add(4 * time.Minute)
		startedAt = &t
	case "ready":
		ticketStatus, itemStatus = "ready", "ready"
		t1 := placedAt.Add(3 * time.Minute)
		t2 := placedAt.Add(15 * time.Minute)
		startedAt, readyAt = &t1, &t2
	}

	count := 0
	for station, items := range byStation {
		*ticketNo++
		var ticketID string
		if err := tx.QueryRow(s.ctx, `
			INSERT INTO kds_tickets (order_id, station_id, ticket_number, status, fired_at, started_at, ready_at, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$5) RETURNING id
		`, orderID, station, *ticketNo, ticketStatus, placedAt, startedAt, readyAt).Scan(&ticketID); err != nil {
			return count, fmt.Errorf("insert kds_ticket: %w", err)
		}
		for _, it := range items {
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO kds_ticket_items (ticket_id, order_item_id, quantity, item_status, started_at, ready_at, created_at, updated_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
			`, ticketID, it.oiID, it.qty, itemStatus, startedAt, readyAt, placedAt); err != nil {
				return count, fmt.Errorf("insert kds_ticket_item: %w", err)
			}
		}
		count++
		_ = station
	}
	return count, nil
}
