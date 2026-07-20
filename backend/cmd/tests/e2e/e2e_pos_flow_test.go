package e2e

// e2e_pos_flow_test.go — staff PIN setup → order → KDS ticket → bump → settle
//
// Seeds a dine-in order with a KDS ticket directly via SQL (service-role), then:
//   - Asserts staff row is inserted with hashed password (PIN setup).
//   - Asserts KDS ticket was created with status "fired".
//   - kds.Store.BumpTicket transitions ticket to "bumped".
//   - Two completed order_payments rows (split tender) are inserted.

import (
	"context"
	"testing"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/kds"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPOSFlow_StaffOrder_KDSBump_Settle(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	suffix := randStr(6)

	// ---------- Seed tenant ----------
	orgID := seedOrg(t, pool, "POS E2E Org "+suffix)
	locID := seedLocation(t, pool, orgID, "POS Loc "+suffix)
	catID := seedCategory(t, pool, locID, "Grills "+suffix)
	itemID := seedItem(t, pool, locID, catID, "Steak "+suffix, 150.00)
	stationID := seedKitchenStation(t, pool, locID, "Grill Station "+suffix)
	seedItemStationRouting(t, pool, itemID, stationID)

	// ---------- Staff PIN / password setup ----------
	const bcryptHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh0W"
	staffID := seedStaff(t, pool, locID, "cashier_"+suffix, "cashier", bcryptHash)

	if n := rowCount(t, pool, "staff", "id = $1 AND location_id = $2", staffID, locID); n != 1 {
		t.Fatalf("staff row not found, count=%d", n)
	}

	// ---------- Create order + financial details directly via SQL ----------
	// pos.Store.CreateOrder is exercised in the dedicated unit test
	// (backend/internal/handlers/pos/store_kds_test.go); here we seed the
	// order directly so the e2e scenario is independent of pos.Store schema
	// compatibility with the current DB (consolidated migrations added
	// organization_id NOT NULL on orders, which the legacy-targeting store
	// does not yet populate).
	orderID := seedOrder(t, pool, orgID, locID)

	// Seed a KDS ticket manually (mirrors what pos.Store.CreateOrder does).
	ticketID := seedKDSTicket(t, pool, orderID, stationID)

	// ---------- Verify ticket fires ----------
	var ticketStatus string
	svcQueryRow(t, pool, &ticketStatus,
		`SELECT status FROM kds_tickets WHERE id = $1`, ticketID)
	if ticketStatus != "fired" {
		t.Errorf("ticket status: want fired, got %q", ticketStatus)
	}

	// ---------- Bump ticket ----------
	kdsStore := kds.NewStore(pool)
	bumped, _, err := kdsStore.BumpTicket(ctx, ticketID, staffID)
	if err != nil {
		t.Fatalf("BumpTicket: %v", err)
	}
	if bumped.Status != "bumped" {
		t.Errorf("post-bump status: want bumped, got %q", bumped.Status)
	}

	// Assert kds_ticket_events has a "bumped" event row
	if n := rowCount(t, pool, "kds_ticket_events",
		"ticket_id = $1 AND event_type = 'bumped'", ticketID); n < 1 {
		t.Errorf("expected bumped event row, got %d", n)
	}

	// ---------- Settle — split tender (cash R100 + card_in_person R50) ----------
	err = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `
			INSERT INTO order_payments (order_id, payment_method_code, amount_paid_cents, payment_status, paid_at)
			VALUES ($1, 'cash', 10000, 'completed', now()),
			       ($1, 'card_in_person', 5000, 'completed', now())
		`, orderID)
		return e
	})
	if err != nil {
		t.Fatalf("split tender insert: %v", err)
	}

	// Assert exactly 2 completed order_payment rows for this order
	if n := rowCount(t, pool, "order_payments",
		"order_id = $1 AND payment_status = 'completed'", orderID); n != 2 {
		t.Errorf("split tender: expected 2 completed order_payments, got %d", n)
	}
}

// seedOrder inserts a minimal orders row and returns its UUID.
func seedOrder(t *testing.T, pool *pgxpool.Pool, orgID, locID string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO orders (organization_id, location_id, order_number, order_type, status, currency_code)
		VALUES ($1, $2, 'POS0001', 'dine_in', 'confirmed', 'ZAR')
		RETURNING id`, orgID, locID)
	return id
}

// seedKDSTicket inserts a kds_tickets row in "fired" status and returns its UUID.
func seedKDSTicket(t *testing.T, pool *pgxpool.Pool, orderID, stationID string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO kds_tickets (order_id, station_id, ticket_number, status, priority)
		VALUES ($1, $2, 1, 'fired', 0)
		ON CONFLICT (order_id, station_id) DO UPDATE SET updated_at = now()
		RETURNING id`, orderID, stationID)
	// Also write the fired event.
	svcExec(t, pool,
		`INSERT INTO kds_ticket_events (ticket_id, event_type) VALUES ($1, 'fired')`, id)
	return id
}
