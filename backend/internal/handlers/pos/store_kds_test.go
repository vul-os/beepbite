package pos_test

// Integration test: CreateOrder → KDS ticket carries recipe info.
//
// Prerequisites:
//   - TEST_DATABASE_URL must point at a fully-migrated PostgreSQL instance.
//   - The test SKIPS automatically when the env var is absent.
//
// Run:
//
//	cd backend && go test ./internal/handlers/pos/... -run KDS -v -count=1

import (
	"context"
	"os"
	"testing"

	"github.com/beepbite/backend/internal/handlers/kds"
	"github.com/beepbite/backend/internal/handlers/pos"
	"github.com/jackc/pgx/v5/pgxpool"
)

func openTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestCreateOrder_KDSTicketCarriesRecipeInfo seeds the minimum required rows,
// creates a POS order, then uses kds.Store.GetTicketDetail to assert that the
// resulting KDS ticket carries the ingredient name and prep step instruction
// that were seeded for the item.
func TestCreateOrder_KDSTicketCarriesRecipeInfo(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()

	// ------------------------------------------------------------------
	// SEED — run inside an explicit transaction so the test is isolated
	// and the data is cleaned up automatically on rollback.
	// ------------------------------------------------------------------
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	// Always roll back at the end so the test leaves no trace.
	defer tx.Rollback(ctx) //nolint:errcheck

	// 1. Organisation
	var orgID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO organizations (name) VALUES ('KDS Test Org') RETURNING id`,
	).Scan(&orgID); err != nil {
		t.Fatalf("insert org: %v", err)
	}

	// 2. Location — region_id is NOT NULL (added by migration-26); use the seeded ZA region.
	var locID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO locations (organization_id, name, region_id)
		VALUES ($1, 'KDS Test Location', (SELECT id FROM regions WHERE code = 'ZA' LIMIT 1))
		RETURNING id`,
		orgID,
	).Scan(&locID); err != nil {
		t.Fatalf("insert location: %v", err)
	}

	// 3. Category
	var catID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO categories (location_id, name) VALUES ($1, 'KDS Test Category') RETURNING id`,
		locID,
	).Scan(&catID); err != nil {
		t.Fatalf("insert category: %v", err)
	}

	// 4. Parent item (the menu item that will be ordered)
	var itemID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO items (location_id, category_id, name, price) VALUES ($1, $2, 'Test Burger', 89.00) RETURNING id`,
		locID, catID,
	).Scan(&itemID); err != nil {
		t.Fatalf("insert item: %v", err)
	}

	// 5. Ingredient item (child in item_recipes)
	var ingItemID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO items (location_id, category_id, name, price) VALUES ($1, $2, 'Sesame Bun', 5.00) RETURNING id`,
		locID, catID,
	).Scan(&ingItemID); err != nil {
		t.Fatalf("insert ingredient item: %v", err)
	}

	// 6. Recipe link: Test Burger → Sesame Bun
	if _, err := tx.Exec(ctx,
		`INSERT INTO item_recipes (parent_item_id, child_item_id, quantity_needed, unit)
		 VALUES ($1, $2, 1, 'piece')`,
		itemID, ingItemID,
	); err != nil {
		t.Fatalf("insert recipe: %v", err)
	}

	// 7. Prep step for the item
	const wantInstruction = "Toast bun on flat-top until golden"
	if _, err := tx.Exec(ctx,
		`INSERT INTO item_prep_steps (item_id, step_number, instruction) VALUES ($1, 1, $2)`,
		itemID, wantInstruction,
	); err != nil {
		t.Fatalf("insert prep step: %v", err)
	}

	// 8. Kitchen station
	var stationID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO kitchen_stations (location_id, name, station_type) VALUES ($1, 'Grill', 'prep') RETURNING id`,
		locID,
	).Scan(&stationID); err != nil {
		t.Fatalf("insert kitchen_station: %v", err)
	}

	// 9. Route item → station
	if _, err := tx.Exec(ctx,
		`INSERT INTO item_station_routing (item_id, station_id, is_primary) VALUES ($1, $2, true)`,
		itemID, stationID,
	); err != nil {
		t.Fatalf("insert routing: %v", err)
	}

	// Commit the seed data so the pos.Store (which opens its own tx) can see it.
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit seed: %v", err)
	}

	// We committed — register a cleanup to delete the seed rows.
	t.Cleanup(func() {
		// Items cascade-delete recipes, prep_steps, order_items, routing, etc.
		// Stations cascade-delete kds_tickets → kds_ticket_items.
		// Location cascades everything under it.
		conn, _ := pool.Acquire(context.Background())
		if conn == nil {
			return
		}
		defer conn.Release()
		_, _ = conn.Exec(context.Background(),
			`DELETE FROM organizations WHERE id = $1`, orgID)
	})

	// ------------------------------------------------------------------
	// ACT — create a POS order through pos.Store
	// ------------------------------------------------------------------
	posStore := pos.NewStore(pool)
	created, err := posStore.CreateOrder(
		ctx,
		locID,
		"dine_in",
		"", // tableNumber
		"", // tableSessionID
		"", // registerSessionID
		"", // customerID
		[]pos.OrderLineInput{
			{ItemID: itemID, Quantity: 1},
		},
		"", // onDeliveryMethod — not applicable for dine_in
		"", // customerNote
		0,  // partySize
	)
	if err != nil {
		t.Fatalf("CreateOrder: %v", err)
	}

	// ------------------------------------------------------------------
	// ASSERT — KDS ticket must exist
	// ------------------------------------------------------------------
	if len(created.KDSTicketIDs) == 0 {
		t.Fatal("expected at least one KDS ticket ID in CreateOrder response, got none")
	}

	ticketID := created.KDSTicketIDs[0]
	t.Logf("order_id=%s ticket_id=%s", created.OrderID, ticketID)

	// ------------------------------------------------------------------
	// ASSERT — GetTicketDetail must return ingredient + prep step
	// ------------------------------------------------------------------
	kdsStore := kds.NewStore(pool)
	detail, err := kdsStore.GetTicketDetail(ctx, ticketID)
	if err != nil {
		t.Fatalf("GetTicketDetail(%s): %v", ticketID, err)
	}

	if len(detail.Items) == 0 {
		t.Fatal("ticket detail has no items")
	}

	item := detail.Items[0]

	// Ingredient assertion
	if len(item.Ingredients) == 0 {
		t.Error("FAIL: ticket item has no ingredients — recipe info missing from KDS ticket detail")
	} else {
		found := false
		for _, ing := range item.Ingredients {
			if ing.Name == "Sesame Bun" {
				found = true
				t.Logf("PASS: ingredient found: name=%q qty=%v unit=%q", ing.Name, ing.Quantity, ing.Unit)
				break
			}
		}
		if !found {
			t.Errorf("FAIL: ingredient 'Sesame Bun' not found in ticket item; got %+v", item.Ingredients)
		}
	}

	// Prep step assertion
	if len(item.PrepSteps) == 0 {
		t.Error("FAIL: ticket item has no prep steps — prep_steps missing from KDS ticket detail")
	} else {
		found := false
		for _, ps := range item.PrepSteps {
			if ps.Instruction == wantInstruction {
				found = true
				t.Logf("PASS: prep step found: step=%d instruction=%q", ps.StepNumber, ps.Instruction)
				break
			}
		}
		if !found {
			t.Errorf("FAIL: prep step %q not found; got %+v", wantInstruction, item.PrepSteps)
		}
	}
}
