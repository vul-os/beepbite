package marketplace_test

// checkout_rls_integration_test.go — the public checkout must resolve tax
// through a SCOPED connection.
//
// CreateCheckoutOrder's tax lookup used to run on the raw pool
// (pool.QueryRow), with no app.* session variables set. tax_rates carries
// FORCE ROW LEVEL SECURITY plus a tenant SELECT policy
// (location_id IN (SELECT id FROM locations WHERE organization_id =
// current_org_id()) OR is_service_role()), so on a fresh pooled connection
// current_org_id() is NULL, the policy evaluates false, and the query returns
// pgx.ErrNoRows for a row that plainly exists.
//
// That is indistinguishable from "this location has no tax_rates row", so the
// lookup fell through to the location's own tax_rate column and charged a
// DIFFERENT, entirely plausible rate. Unlike the "store not found" symptom the
// same bug produced in the location lookup, nothing here looks broken: the
// receipt shows a real-looking tax line, for the wrong tax.
//
// Run:
//
//	cd backend && go test ./internal/handlers/marketplace/ -run RLS -v

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/marketplace"
	"github.com/beepbite/backend/internal/locations"
)

// seedTaxRatesRow inserts an active tax_rates row for a location, as an
// operator with a named rate (a reduced food rate, an excise duty) would have.
// Inserted under ServiceRoleScope because that is how fixtures cross the tenant
// boundary; the point of the test is what the PRODUCTION read path can see.
func seedTaxRatesRow(t *testing.T, ctx context.Context, locationID, name string, rate float64, inclusive bool) {
	t.Helper()
	err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `
			INSERT INTO tax_rates (location_id, name, rate, is_inclusive, is_active)
			VALUES ($1, $2, $3, $4, true)`,
			locationID, name, rate, inclusive)
		return e
	})
	if err != nil {
		t.Fatalf("seed tax_rates row: %v", err)
	}
}

// enableCashOnDelivery gives the store a tender. SeedLocationIn leaves
// on_delivery_payment_methods empty, and with no online gateway configured
// CreateCheckoutOrder rejects such a store with ErrNoPaymentMethod before it
// ever reaches the tax arithmetic this file is about.
func enableCashOnDelivery(t *testing.T, ctx context.Context, locationID string) {
	t.Helper()
	err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx,
			`UPDATE locations SET on_delivery_payment_methods = ARRAY['cash']::text[] WHERE id = $1`,
			locationID)
		return e
	})
	if err != nil {
		t.Fatalf("enable cash on delivery: %v", err)
	}
}

// TestIntegrationRLSCheckout_TaxRatesRowDecidesTheTax is the end-to-end
// statement of the bug: the operator configured a 25% EXCLUSIVE excise in
// tax_rates, and the location row still carries the ZA fixture's 15% INCLUSIVE
// VAT. Those two produce different totals from the same basket, so the order
// row says unambiguously which one the checkout actually used.
func TestIntegrationRLSCheckout_TaxRatesRowDecidesTheTax(t *testing.T) {
	ctx := context.Background()
	slug, locationID, itemIDs := seedMarketplaceStore(t, ctx, onlineTestPool, "rls-tax")
	t.Cleanup(func() { locations.InvalidateSettings(locationID) })

	enableCashOnDelivery(t, ctx, locationID)

	// The location itself is LocaleZA: tax_rate 15.00, tax_inclusive true.
	// The operator's named rate is deliberately different in BOTH dimensions.
	seedTaxRatesRow(t, ctx, locationID, "Excise", 25.00, false)

	// One Burger at 89.00 ZAR → subtotal 8900 cents.
	body, _ := json.Marshal(map[string]any{
		"fulfillment_type": "collection",
		"items":            []map[string]any{{"item_id": itemIDs[0], "quantity": 1}},
	})
	req := httptest.NewRequest(http.MethodPost, "/stores/"+slug+"/orders", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	checkoutRouterFor(marketplace.NewHandler(onlineTestPool)).ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("checkout status = %d, want 201; body = %s", rr.Code, rr.Body.String())
	}
	var resp struct {
		OrderID string `json:"order_id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode checkout response: %v", err)
	}

	var (
		subtotal, taxCents, total int64
		gotRate                   float64
		gotInclusive              bool
	)
	if err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT subtotal_cents, tax_cents, total_cents, CAST(tax_rate AS float8), tax_inclusive
			FROM orders WHERE id = $1`, resp.OrderID).
			Scan(&subtotal, &taxCents, &total, &gotRate, &gotInclusive)
	}); err != nil {
		t.Fatalf("read back order: %v", err)
	}

	if subtotal != 8900 {
		t.Fatalf("subtotal_cents = %d, want 8900 — the fixture basket changed and the tax "+
			"expectations below no longer mean anything", subtotal)
	}

	// 25% exclusive on 8900 → 2225 tax, 11125 gross.
	// The bug's answer was the location's 15% INCLUSIVE VAT: 1161 tax, 8900 gross.
	if gotRate != 25 {
		t.Errorf("orders.tax_rate = %v, want 25 — the active tax_rates row was not used. "+
			"15 means the tax_rates lookup was hidden by RLS and fell through to "+
			"locations.tax_rate, which is a real-looking rate for the wrong tax", gotRate)
	}
	if gotInclusive {
		t.Errorf("orders.tax_inclusive = true, want false — the convention came from the " +
			"location row, not from the tax_rates row that decides it")
	}
	if taxCents != 2225 {
		t.Errorf("tax_cents = %d, want 2225 (25%% exclusive on 8900); 1161 is 15%% inclusive", taxCents)
	}
	if total != 11125 {
		t.Errorf("total_cents = %d, want 11125; 8900 means no tax was added at all", total)
	}
}

// TestIntegrationRLSCheckout_TaxRatesIsInvisibleOnAnUnscopedConnection pins the
// MECHANISM, separately from the symptom above, so that a future refactor that
// reintroduces a bare pool query fails here with a message naming the cause
// rather than only shifting a total by a few cents somewhere else.
//
// It also proves the fix is a real fix: the same SELECT, on a connection scoped
// to the owning organisation, returns the row.
func TestIntegrationRLSCheckout_TaxRatesIsInvisibleOnAnUnscopedConnection(t *testing.T) {
	ctx := context.Background()
	_, locationID, _ := seedMarketplaceStore(t, ctx, onlineTestPool, "rls-visibility")
	t.Cleanup(func() { locations.InvalidateSettings(locationID) })
	seedTaxRatesRow(t, ctx, locationID, "Excise", 25.00, false)

	var orgID string
	if err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT organization_id FROM locations WHERE id = $1`, locationID).Scan(&orgID)
	}); err != nil {
		t.Fatalf("resolve org: %v", err)
	}

	const q = `SELECT CAST(rate AS float8) FROM tax_rates
	           WHERE location_id = $1 AND is_active = true ORDER BY created_at LIMIT 1`

	// 1. Raw pool, no session variables — what the buggy call site did.
	var rate float64
	err := onlineTestPool.QueryRow(ctx, q, locationID).Scan(&rate)
	if err == nil {
		t.Fatalf("an unscoped connection read tax_rates and got %v — either FORCE ROW LEVEL "+
			"SECURITY or the tenant SELECT policy on tax_rates has been lost, and every "+
			"'this read is safe because RLS covers it' comment in this package is now false", rate)
	}
	if err != pgx.ErrNoRows {
		t.Fatalf("unscoped tax_rates read failed with %v, want pgx.ErrNoRows — the silent "+
			"fall-through this test is about depends on it being ErrNoRows specifically", err)
	}

	// 2. Same query, scoped to the owning organisation — the fix.
	if err := db.Scoped(ctx, onlineTestPool, db.Scope{OrgID: orgID}, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, q, locationID).Scan(&rate)
	}); err != nil {
		t.Fatalf("org-scoped tax_rates read: %v — scoping to the owning org must make the "+
			"row visible, otherwise the fix cannot work", err)
	}
	if rate != 25 {
		t.Errorf("org-scoped rate = %v, want 25", rate)
	}
}
