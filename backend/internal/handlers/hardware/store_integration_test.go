// Package hardware_test holds DB-backed integration tests for the hardware Store.
//
// Run:
//
//	cd backend && go test ./internal/handlers/hardware/ -run Integration -v
//
// Tests skip automatically when no Postgres backend is available (Docker absent
// and TEST_DATABASE_URL / DATABASE_URL unset).
package hardware_test

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"os"
	"testing"
	"time"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/hardware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Package-level pool (shared across all Integration* tests)
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping hardware integration tests:", err)
		os.Exit(0)
	}
	if err != nil {
		log.Fatal("testenv.StartPostgres:", err)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

func init() {
	rand.Seed(time.Now().UnixNano()) //nolint:staticcheck
}

func randStr(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

// svcQueryRow executes a single-row query under service-role scope.
func svcQueryRow(t *testing.T, pool *pgxpool.Pool, dest any, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, query, args...).Scan(dest)
	})
	if err != nil {
		t.Fatalf("svcQueryRow: %v\nquery: %s\nargs: %v", err, query, args)
	}
}

// seedOrg inserts a fresh organization and registers cleanup (cascade-deletes
// all child rows including locations and location_printers).
func seedOrg(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	name := "HW Test Org " + randStr(8)
	var id string
	svcQueryRow(t, pool, &id, `INSERT INTO organizations (name) VALUES ($1) RETURNING id`, name)
	t.Cleanup(func() {
		ctx := context.Background()
		_ = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// zaRegionID returns the UUID of the seeded ZA region; skips if missing.
func zaRegionID(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	ctx := context.Background()
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM regions WHERE code = 'ZA' LIMIT 1`).Scan(&id)
	})
	if err != nil {
		t.Skipf("ZA region not seeded (migrations not applied?): %v", err)
	}
	return id
}

// seedLocation inserts a test location under orgID and returns its UUID.
func seedLocation(t *testing.T, pool *pgxpool.Pool, orgID string) string {
	t.Helper()
	regionID := zaRegionID(t, pool)
	name := "HW Test Location " + randStr(8)
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO locations (organization_id, region_id, name, on_delivery_payment_methods)
		 VALUES ($1, $2, $3, ARRAY['cash']::text[]) RETURNING id`,
		orgID, regionID, name)
	return id
}

// seedKitchenStation inserts a kitchen_stations row under locationID.
func seedKitchenStation(t *testing.T, pool *pgxpool.Pool, locationID string) string {
	t.Helper()
	name := "HW Station " + randStr(6)
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO kitchen_stations (location_id, name, station_type) VALUES ($1, $2, 'prep') RETURNING id`,
		locationID, name)
	return id
}

// tenantCtx returns a context carrying the org-scoped RLS session variables.
func tenantCtx(orgID string) context.Context {
	return db.ContextWithScope(context.Background(), db.Scope{OrgID: orgID})
}

// ptr returns a pointer to the given value (generic helper).
func ptr[T any](v T) *T { return &v }

// ---------------------------------------------------------------------------
// Test 1 — Printer CRUD
// ---------------------------------------------------------------------------

func TestIntegrationPrinterCRUD(t *testing.T) {
	orgID := seedOrg(t, testPool)
	locID := seedLocation(t, testPool, orgID)
	store := hardware.NewStore(testPool)
	ctx := tenantCtx(orgID)

	host := "192.168.1.50"

	// --- CreatePrinter ---
	created, err := store.CreatePrinter(ctx, hardware.CreatePrinterReq{
		LocationID: locID,
		Name:       "Receipt Printer A",
		Kind:       "receipt",
		Connection: "network",
		Host:       &host,
		Port:       ptr(9100),
		IsActive:   ptr(true),
	})
	if err != nil {
		t.Fatalf("CreatePrinter: %v", err)
	}
	if created.ID == "" {
		t.Fatal("CreatePrinter returned empty ID")
	}
	if created.Name != "Receipt Printer A" {
		t.Errorf("Name: got %q want %q", created.Name, "Receipt Printer A")
	}
	if created.LocationID != locID {
		t.Errorf("LocationID: got %q want %q", created.LocationID, locID)
	}

	// --- ListPrinters ---
	printers, err := store.ListPrinters(ctx, locID)
	if err != nil {
		t.Fatalf("ListPrinters: %v", err)
	}
	found := false
	for _, p := range printers {
		if p.ID == created.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("ListPrinters did not return newly created printer %s", created.ID)
	}

	// --- GetPrinter ---
	got, err := store.GetPrinter(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetPrinter: %v", err)
	}
	if got.ID != created.ID {
		t.Errorf("GetPrinter ID: got %q want %q", got.ID, created.ID)
	}
	if got.Host == nil || *got.Host != host {
		t.Errorf("GetPrinter Host: got %v want %q", got.Host, host)
	}

	// --- UpdatePrinter (patch name and port) ---
	updated, err := store.UpdatePrinter(ctx, created.ID, hardware.UpdatePrinterReq{
		Name: ptr("Receipt Printer A Updated"),
		Port: ptr(9200),
	})
	if err != nil {
		t.Fatalf("UpdatePrinter: %v", err)
	}
	if updated.Name != "Receipt Printer A Updated" {
		t.Errorf("UpdatePrinter Name: got %q want %q", updated.Name, "Receipt Printer A Updated")
	}
	if updated.Port != 9200 {
		t.Errorf("UpdatePrinter Port: got %d want 9200", updated.Port)
	}
	// Non-patched fields must be preserved
	if updated.Kind != "receipt" {
		t.Errorf("UpdatePrinter Kind unchanged: got %q want %q", updated.Kind, "receipt")
	}

	// --- DeletePrinter ---
	if err := store.DeletePrinter(ctx, created.ID); err != nil {
		t.Fatalf("DeletePrinter: %v", err)
	}

	// Confirm deletion: Get must return ErrPrinterNotFound
	_, err = store.GetPrinter(ctx, created.ID)
	if !errors.Is(err, hardware.ErrPrinterNotFound) {
		t.Errorf("GetPrinter after Delete: got %v want ErrPrinterNotFound", err)
	}

	// Confirm deletion: List must not contain the deleted printer
	printers2, err := store.ListPrinters(ctx, locID)
	if err != nil {
		t.Fatalf("ListPrinters after Delete: %v", err)
	}
	for _, p := range printers2 {
		if p.ID == created.ID {
			t.Errorf("ListPrinters still returned deleted printer %s", created.ID)
		}
	}
}

// ---------------------------------------------------------------------------
// Test 2 — Kitchen routing query
// ---------------------------------------------------------------------------

func TestIntegrationKitchenRouting(t *testing.T) {
	orgID := seedOrg(t, testPool)
	locID := seedLocation(t, testPool, orgID)
	stationID := seedKitchenStation(t, testPool, locID)
	store := hardware.NewStore(testPool)
	ctx := tenantCtx(orgID)

	host := "10.0.0.1"

	// Seed 1: receipt printer (kind=receipt, active)
	_, err := store.CreatePrinter(ctx, hardware.CreatePrinterReq{
		LocationID: locID,
		Name:       "Receipt Printer",
		Kind:       "receipt",
		Connection: "network",
		Host:       &host,
		IsActive:   ptr(true),
	})
	if err != nil {
		t.Fatalf("CreatePrinter receipt: %v", err)
	}

	// Seed 2: kitchen printer bound to station (active)
	kitchen1, err := store.CreatePrinter(ctx, hardware.CreatePrinterReq{
		LocationID: locID,
		Name:       "Kitchen Printer Station",
		Kind:       "kitchen",
		Connection: "network",
		Host:       &host,
		StationID:  &stationID,
		IsActive:   ptr(true),
	})
	if err != nil {
		t.Fatalf("CreatePrinter kitchen+station: %v", err)
	}

	// Seed 3: kitchen printer with NO station (active)
	kitchen2, err := store.CreatePrinter(ctx, hardware.CreatePrinterReq{
		LocationID: locID,
		Name:       "Kitchen Printer No Station",
		Kind:       "kitchen",
		Connection: "network",
		Host:       &host,
		IsActive:   ptr(true),
	})
	if err != nil {
		t.Fatalf("CreatePrinter kitchen no-station: %v", err)
	}

	// Seed 4: kitchen printer that is INACTIVE
	kitchenInactive, err := store.CreatePrinter(ctx, hardware.CreatePrinterReq{
		LocationID: locID,
		Name:       "Kitchen Printer Inactive",
		Kind:       "kitchen",
		Connection: "network",
		Host:       &host,
		IsActive:   ptr(false),
	})
	if err != nil {
		t.Fatalf("CreatePrinter kitchen inactive: %v", err)
	}

	// GetPrintersForLocation(kind="kitchen") should return the two ACTIVE kitchen printers
	kitchenPrinters, err := store.GetPrintersForLocation(ctx, locID, "kitchen")
	if err != nil {
		t.Fatalf("GetPrintersForLocation kitchen: %v", err)
	}

	idSet := map[string]bool{}
	for _, p := range kitchenPrinters {
		idSet[p.ID] = true
	}

	if !idSet[kitchen1.ID] {
		t.Errorf("GetPrintersForLocation: missing kitchen printer with station %s", kitchen1.ID)
	}
	if !idSet[kitchen2.ID] {
		t.Errorf("GetPrintersForLocation: missing kitchen printer without station %s", kitchen2.ID)
	}
	if idSet[kitchenInactive.ID] {
		t.Errorf("GetPrintersForLocation: inactive printer %s must be excluded", kitchenInactive.ID)
	}
	// Receipt printer must not appear in kitchen results
	for _, p := range kitchenPrinters {
		if p.Kind != "kitchen" {
			t.Errorf("GetPrintersForLocation returned non-kitchen printer: %s kind=%s", p.ID, p.Kind)
		}
	}
	// Exactly 2 kitchen printers
	if len(kitchenPrinters) != 2 {
		t.Errorf("GetPrintersForLocation: got %d kitchen printers, want 2", len(kitchenPrinters))
	}
}

// ---------------------------------------------------------------------------
// Test 3 — RLS isolation
// ---------------------------------------------------------------------------

func TestIntegrationRLSIsolation(t *testing.T) {
	// Org A seeds a printer
	orgA := seedOrg(t, testPool)
	locA := seedLocation(t, testPool, orgA)
	storeA := hardware.NewStore(testPool)
	ctxA := tenantCtx(orgA)

	host := "172.16.0.1"
	printerA, err := storeA.CreatePrinter(ctxA, hardware.CreatePrinterReq{
		LocationID: locA,
		Name:       "Org A Printer",
		Kind:       "receipt",
		Connection: "network",
		Host:       &host,
		IsActive:   ptr(true),
	})
	if err != nil {
		t.Fatalf("CreatePrinter org-A: %v", err)
	}

	// Org B is a separate tenant
	orgB := seedOrg(t, testPool)
	locB := seedLocation(t, testPool, orgB)
	ctxB := tenantCtx(orgB)
	storeB := hardware.NewStore(testPool)

	// Listing org-B's location must NOT return org-A's printer
	printersB, err := storeB.ListPrinters(ctxB, locB)
	if err != nil {
		t.Fatalf("ListPrinters org-B: %v", err)
	}
	for _, p := range printersB {
		if p.ID == printerA.ID {
			t.Errorf("RLS isolation breach: org-B can see org-A printer %s", printerA.ID)
		}
	}

	// Org-B's context trying to Get org-A's printer ID must get ErrPrinterNotFound
	_, err = storeB.GetPrinter(ctxB, printerA.ID)
	if !errors.Is(err, hardware.ErrPrinterNotFound) {
		t.Errorf("RLS isolation: cross-tenant GetPrinter got %v, want ErrPrinterNotFound", err)
	}

	// Org-A can still see its own printer under its own scope
	got, err := storeA.GetPrinter(ctxA, printerA.ID)
	if err != nil {
		t.Fatalf("GetPrinter org-A own printer: %v", err)
	}
	if got.ID != printerA.ID {
		t.Errorf("GetPrinter org-A: got %q want %q", got.ID, printerA.ID)
	}
}
