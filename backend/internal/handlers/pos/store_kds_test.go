package pos_test

// Integration test: CreateOrder → KDS ticket carries recipe info.
//
// This used to open its own pool from TEST_DATABASE_URL and t.Skip when the
// variable was absent, which in practice meant it never ran: nothing in the
// repo, CI included, sets TEST_DATABASE_URL, so a test asserting that KDS
// tickets carry recipe information reported SKIP forever while reading as part
// of a green suite.
//
// It now uses the package's testenv pool (see tax_rls_integration_test.go's
// TestMain), which is a migrated Postgres reached as the NON-SUPERUSER bb_app
// role. That matters: RLS is actually enforced, so the seeds go through
// db.ServiceRoleScope and the reads go through a scope the way production does.
// The old TEST_DATABASE_URL pool was whatever role the developer had, usually a
// superuser, which silently bypasses RLS under FORCE.
//
// Run:
//
//	cd backend && go test ./internal/handlers/pos/... -run KDS -v -count=1

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/kds"
	"github.com/beepbite/backend/internal/handlers/pos"
)

// TestCreateOrder_KDSTicketCarriesRecipeInfo seeds the minimum required rows,
// creates a POS order, then uses kds.Store.GetTicketDetail to assert that the
// resulting KDS ticket carries the ingredient name and prep step instruction
// that were seeded for the item.
func TestCreateOrder_KDSTicketCarriesRecipeInfo(t *testing.T) {
	pool := taxTestPool
	ctx := context.Background()

	// ------------------------------------------------------------------
	// SEED — one explicit transaction, scoped to the service role.
	//
	// The scope is not optional now that the pool is bb_app rather than a
	// superuser: every table touched below carries FORCE ROW LEVEL SECURITY, so
	// an unscoped INSERT fails its WITH CHECK. ServiceRoleScope is the fixture
	// escape hatch the RLS policies provide (is_service_role()), and it is what
	// cmd/tests/fixtures uses for exactly this reason.
	// ------------------------------------------------------------------
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	// Always roll back at the end so the test leaves no trace.
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := db.ApplyScope(ctx, tx, db.ServiceRoleScope()); err != nil {
		t.Fatalf("scope seed tx: %v", err)
	}

	// 1. Organisation
	var orgID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO organizations (name) VALUES ('KDS Test Org') RETURNING id`,
	).Scan(&orgID); err != nil {
		t.Fatalf("insert org: %v", err)
	}

	// 2. Location. The pre-fold `regions` table and locations.region_id are both
	// gone — the consolidated baseline has neither — so this inserts neither.
	// currency_code has no default and orders carry a foreign key to it, so a
	// location without one cannot have an order written against it.
	var locID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO locations (organization_id, name, currency_code)
		VALUES ($1, 'KDS Test Location', 'USD')
		RETURNING id`,
		orgID,
	).Scan(&locID); err != nil {
		t.Fatalf("insert location: %v", err)
	}

	// 3. Category
	var catID string
	if err := tx.QueryRow(ctx,
		`INSERT INTO categories (organization_id, location_id, name)
		 VALUES ($1, $2, 'KDS Test Category') RETURNING id`,
		orgID, locID,
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
		_ = db.Scoped(context.Background(), pool, db.ServiceRoleScope(), func(ctx pgx.Tx) error {
			_, e := ctx.Exec(context.Background(),
				`DELETE FROM organizations WHERE id = $1`, orgID)
			return e
		})
	})

	// ------------------------------------------------------------------
	// ACT — create a POS order through pos.Store
	// ------------------------------------------------------------------
	// pos.CreateOrder reads its scope from the context (db.ScopeFromContext) and
	// writes it onto its own transaction, exactly as RequireOrgScope middleware
	// arranges in production. Without this the location lookup inside CreateOrder
	// is hidden by RLS and comes back as "location not found".
	orderCtx := db.ContextWithScope(ctx, db.Scope{OrgID: orgID})

	posStore := pos.NewStore(pool)
	created, err := posStore.CreateOrder(
		orderCtx,
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
	// GetTicketDetail (the pool-based method) opens a bare pool.BeginTx with no
	// session variables — see internal/handlers/kds/store.go and the migration
	// note in store_tx.go. Under an RLS-enforcing role that reads zero rows. The
	// Tx variant is the migrated path the handler already uses, so the test
	// exercises what production exercises.
	kdsStore := kds.NewStore(pool)
	var detail *kds.TicketDetail
	if err := db.Scoped(ctx, pool, db.Scope{OrgID: orgID}, func(tx pgx.Tx) error {
		d, e := kdsStore.GetTicketDetailTx(ctx, tx, ticketID)
		detail = d
		return e
	}); err != nil {
		t.Fatalf("GetTicketDetailTx(%s): %v", ticketID, err)
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
