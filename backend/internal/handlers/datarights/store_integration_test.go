package datarights

// DB-backed integration tests for the datarights Store.
//
// Infrastructure: cmd/tests/testenv.StartPostgres — boots an ephemeral
// Postgres with all migrations applied (including 039_data_rights which adds
// soft-delete + pii_purged_at columns, and 047_wave_audit_fixes which drops
// customers.whatsapp_number NOT NULL so ForgetCustomer no longer 500s).
//
// Run:
//
//	cd backend && go test ./internal/handlers/datarights/ -run Integration -v

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// TestMain — single ephemeral Postgres shared across the package.
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping datarights integration tests: no postgres backend available:", err)
		os.Exit(0)
	}
	if err != nil {
		log.Fatalf("testenv.StartPostgres: %v", err)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Seed helpers — all writes use ServiceRoleScope to bypass RLS.
// Each integration test gets a unique org to avoid cross-test interference.
// ---------------------------------------------------------------------------

// seedOrg inserts a minimal organization and returns its ID.
func seedOrg(t *testing.T, ctx context.Context, label string) string {
	t.Helper()
	var id string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			"IntegOrg-"+label+"-"+fmt.Sprint(time.Now().UnixNano()),
		).Scan(&id)
	})
	if err != nil {
		t.Fatalf("seedOrg(%q): %v", label, err)
	}
	return id
}

// seedRegion ensures a ZA region row exists (referenced by locations).
// Uses ON CONFLICT DO NOTHING so parallel tests are safe.
func seedRegion(t *testing.T, ctx context.Context) string {
	t.Helper()
	var id string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Prefer existing ZA region (seeded by migration 014).
		scanErr := tx.QueryRow(ctx,
			`SELECT id FROM regions WHERE code = 'ZA' LIMIT 1`,
		).Scan(&id)
		if scanErr == nil {
			return nil // already exists
		}
		if !errors.Is(scanErr, pgx.ErrNoRows) {
			return scanErr
		}
		// Insert a minimal region if the seed migration wasn't run.
		return tx.QueryRow(ctx, `
INSERT INTO regions (code, name, currency, timezone, default_tax_rate, default_tax_name)
VALUES ('ZA', 'South Africa', 'ZAR', 'Africa/Johannesburg', 15.00, 'VAT')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
RETURNING id`,
		).Scan(&id)
	})
	if err != nil {
		t.Fatalf("seedRegion: %v", err)
	}
	return id
}

// seedLocation inserts a location row for orgID.
func seedLocation(t *testing.T, ctx context.Context, orgID, regionID string) string {
	t.Helper()
	var id string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO locations (organization_id, region_id, name)
VALUES ($1, $2, 'Test Location')
RETURNING id`,
			orgID, regionID,
		).Scan(&id)
	})
	if err != nil {
		t.Fatalf("seedLocation(org=%s): %v", orgID, err)
	}
	return id
}

// seedCustomer inserts a customer with PII columns set, owned by orgID.
// whatsapp_number uniqueness is per-org, so we embed the org suffix.
func seedCustomer(t *testing.T, ctx context.Context, orgID string) string {
	t.Helper()
	var id string
	phone := "+27" + fmt.Sprint(time.Now().UnixNano()%900000000+100000000)
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO customers (organization_id, whatsapp_number, first_name, last_name, email)
VALUES ($1, $2, 'Alice', 'Test', 'alice@example.com')
RETURNING id`,
			orgID, phone,
		).Scan(&id)
	})
	if err != nil {
		t.Fatalf("seedCustomer(org=%s): %v", orgID, err)
	}
	return id
}

// seedOrder inserts a minimal order row linked to locationID and customerID.
func seedOrder(t *testing.T, ctx context.Context, locationID, orgID, customerID string) string {
	t.Helper()
	var id string
	orderNum := fmt.Sprintf("INT-%d", time.Now().UnixNano()%1_000_000)
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO orders (location_id, organization_id, customer_id, order_number, status, fulfillment_type)
VALUES ($1, $2, $3, $4, 'pending', 'collection')
RETURNING id`,
			locationID, orgID, customerID, orderNum,
		).Scan(&id)
	})
	if err != nil {
		t.Fatalf("seedOrder(loc=%s cust=%s): %v", locationID, customerID, err)
	}
	return id
}

// tenantCtx returns a context that carries a db.Scope for orgID (tenant role).
// This is what Store methods using db.ScopeFromContext expect.
func tenantCtx(orgID string) context.Context {
	scope := db.Scope{
		OrgID:         orgID,
		UserID:        "00000000-0000-0000-0000-000000000001", // fake actor UUID
		IsServiceRole: false,
	}
	return db.ContextWithScope(context.Background(), scope)
}

// actorID is a synthetic UUID used as actorID for store calls.
const actorID = "00000000-0000-0000-0000-000000000001"

// ---------------------------------------------------------------------------
// Test 1: SoftDeleteOrg
// ---------------------------------------------------------------------------

func TestIntegration_SoftDeleteOrg(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx, "softdelete")

	store := NewStore(testPool)
	tCtx := tenantCtx(orgID)

	// 1a. First soft-delete should succeed.
	if err := store.SoftDeleteOrg(tCtx, orgID, actorID); err != nil {
		t.Fatalf("SoftDeleteOrg: unexpected error: %v", err)
	}

	// 1b. Verify deleted_at and scheduled_purge_at are set.
	var deletedAt, purgeAt *time.Time
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT deleted_at, scheduled_purge_at FROM organizations WHERE id = $1`, orgID,
		).Scan(&deletedAt, &purgeAt)
	})
	if err != nil {
		t.Fatalf("read organization after SoftDeleteOrg: %v", err)
	}
	if deletedAt == nil {
		t.Fatal("expected deleted_at to be set after SoftDeleteOrg")
	}
	if purgeAt == nil {
		t.Fatal("expected scheduled_purge_at to be set after SoftDeleteOrg")
	}
	// scheduled_purge_at should be approximately 30 days from now.
	in30d := time.Now().UTC().Add(29 * 24 * time.Hour)
	if purgeAt.Before(in30d) {
		t.Errorf("scheduled_purge_at %v is not ~30d from now", purgeAt)
	}

	// 1c. A second soft-delete on an already-deleted org should return ErrOrgAlreadyDeleted.
	if err := store.SoftDeleteOrg(tCtx, orgID, actorID); !errors.Is(err, ErrOrgAlreadyDeleted) {
		t.Fatalf("expected ErrOrgAlreadyDeleted, got: %v", err)
	}

	// 1d. RestoreOrg should clear both timestamps.
	if err := store.RestoreOrg(tCtx, orgID, actorID); err != nil {
		t.Fatalf("RestoreOrg: unexpected error: %v", err)
	}
	err = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT deleted_at, scheduled_purge_at FROM organizations WHERE id = $1`, orgID,
		).Scan(&deletedAt, &purgeAt)
	})
	if err != nil {
		t.Fatalf("read organization after RestoreOrg: %v", err)
	}
	if deletedAt != nil {
		t.Errorf("expected deleted_at to be NULL after RestoreOrg, got %v", deletedAt)
	}
	if purgeAt != nil {
		t.Errorf("expected scheduled_purge_at to be NULL after RestoreOrg, got %v", purgeAt)
	}

	// 1e. Restoring a non-deleted org should return ErrOrgNotDeleted.
	if err := store.RestoreOrg(tCtx, orgID, actorID); !errors.Is(err, ErrOrgNotDeleted) {
		t.Fatalf("expected ErrOrgNotDeleted on already-active org, got: %v", err)
	}

	t.Log("SoftDeleteOrg / RestoreOrg: PASS")
}

// ---------------------------------------------------------------------------
// Test 2: ForgetCustomer — verifies mig-047 fix (whatsapp_number NOT NULL dropped)
// ---------------------------------------------------------------------------

func TestIntegration_ForgetCustomer(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx, "forget")
	regionID := seedRegion(t, ctx)
	locationID := seedLocation(t, ctx, orgID, regionID)
	customerID := seedCustomer(t, ctx, orgID)

	// Seed an order linked to the customer — must survive ForgetCustomer.
	orderID := seedOrder(t, ctx, locationID, orgID, customerID)

	store := NewStore(testPool)
	tCtx := tenantCtx(orgID)

	// 2a. ForgetCustomer should succeed (pre-mig-047 this 500'd because
	//     whatsapp_number was NOT NULL and the UPDATE set it to NULL).
	if err := store.ForgetCustomer(tCtx, customerID, actorID); err != nil {
		t.Fatalf("ForgetCustomer: unexpected error (was this mig-047 NOT NULL bug?): %v", err)
	}

	// 2b. Verify PII columns are redacted / NULL and pii_purged_at is set.
	type custRow struct {
		FirstName      *string
		LastName       *string
		Email          *string
		WhatsappNumber *string
		Notes          *string
		PiiPurgedAt    *time.Time
	}
	var c custRow
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT first_name, last_name, email, whatsapp_number, notes, pii_purged_at
FROM customers WHERE id = $1`, customerID,
		).Scan(&c.FirstName, &c.LastName, &c.Email, &c.WhatsappNumber, &c.Notes, &c.PiiPurgedAt)
	})
	if err != nil {
		t.Fatalf("read customer after ForgetCustomer: %v", err)
	}
	if c.FirstName != nil {
		t.Errorf("expected first_name NULL, got %q", *c.FirstName)
	}
	if c.LastName != nil {
		t.Errorf("expected last_name NULL, got %q", *c.LastName)
	}
	if c.Email != nil {
		t.Errorf("expected email NULL, got %q", *c.Email)
	}
	if c.WhatsappNumber != nil {
		t.Errorf("expected whatsapp_number NULL after ForgetCustomer (mig-047 fix), got %q", *c.WhatsappNumber)
	}
	if c.PiiPurgedAt == nil {
		t.Error("expected pii_purged_at to be set after ForgetCustomer")
	}

	// 2c. CRITICAL: orders must be retained — ForgetCustomer must NOT delete order rows.
	var orderCount int
	err = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT count(*) FROM orders WHERE id = $1`, orderID,
		).Scan(&orderCount)
	})
	if err != nil {
		t.Fatalf("count orders after ForgetCustomer: %v", err)
	}
	if orderCount != 1 {
		t.Errorf("expected order row to be retained after ForgetCustomer, got count=%d", orderCount)
	}

	// 2d. Calling ForgetCustomer again should return ErrAlreadyForgotten.
	if err := store.ForgetCustomer(tCtx, customerID, actorID); !errors.Is(err, ErrAlreadyForgotten) {
		t.Fatalf("expected ErrAlreadyForgotten on repeat call, got: %v", err)
	}

	// 2e. ForgetCustomer on a non-existent customer returns ErrCustomerNotFound.
	fakeID := "00000000-dead-beef-0000-000000000000"
	if err := store.ForgetCustomer(tCtx, fakeID, actorID); !errors.Is(err, ErrCustomerNotFound) {
		t.Fatalf("expected ErrCustomerNotFound for unknown customer, got: %v", err)
	}

	t.Log("ForgetCustomer: PASS — mig-047 whatsapp_number NOT NULL fix confirmed")
}

// ---------------------------------------------------------------------------
// Test 3: EnqueueExport — archive is org-scoped and non-empty
// ---------------------------------------------------------------------------

func TestIntegration_EnqueueExport(t *testing.T) {
	ctx := context.Background()

	// Org A — will have a customer and an order.
	orgA := seedOrg(t, ctx, "export-A")
	regionID := seedRegion(t, ctx)
	locA := seedLocation(t, ctx, orgA, regionID)
	custA := seedCustomer(t, ctx, orgA)
	_ = seedOrder(t, ctx, locA, orgA, custA)

	// Org B — separate org; its rows must NOT appear in Org A's export.
	orgB := seedOrg(t, ctx, "export-B")
	locB := seedLocation(t, ctx, orgB, regionID)
	custB := seedCustomer(t, ctx, orgB)
	_ = seedOrder(t, ctx, locB, orgB, custB)

	store := NewStore(testPool)
	tCtxA := tenantCtx(orgA)

	// 3a. EnqueueExport for org A should succeed.
	// Pass "" as requestedBy so data_export_jobs.requested_by is NULL (avoids a
	// FK violation — requested_by references profiles(id) and we have no profile
	// row in this test).
	job, archiveBytes, err := store.EnqueueExport(tCtxA, orgA, "")
	if err != nil {
		t.Fatalf("EnqueueExport: %v", err)
	}
	if job == nil {
		t.Fatal("EnqueueExport returned nil job")
	}
	if job.Status != "complete" {
		t.Errorf("expected job status 'complete', got %q", job.Status)
	}
	if job.StorageKey == nil || *job.StorageKey == "" {
		t.Error("expected non-empty storage_key on completed job")
	}
	if archiveBytes == nil {
		t.Fatal("EnqueueExport returned nil archive")
	}

	// 3b. Parse the archive JSON.
	var archive struct {
		OrgID     string           `json:"org_id"`
		Orders    []map[string]any `json:"orders"`
		Customers []map[string]any `json:"customers"`
	}
	if err := json.Unmarshal(archiveBytes, &archive); err != nil {
		t.Fatalf("parse archive JSON: %v — raw: %s", err, string(archiveBytes))
	}

	// 3c. Archive must be scoped to org A.
	if archive.OrgID != orgA {
		t.Errorf("archive org_id %q != org A %q", archive.OrgID, orgA)
	}

	// 3d. At least one order and one customer row for org A.
	if len(archive.Orders) == 0 {
		t.Error("expected at least 1 order in archive for org A")
	}
	if len(archive.Customers) == 0 {
		t.Error("expected at least 1 customer in archive for org A")
	}

	// 3e. Archive must NOT contain org B's customer or location.
	//     Orders are joined via locations; customers have direct organization_id.
	//     We verify no row has org B's customer ID.
	custBStr := custB
	for _, row := range archive.Customers {
		if idVal, ok := row["id"]; ok {
			if fmt.Sprint(idVal) == custBStr {
				t.Errorf("org B customer %s appeared in org A export — RLS isolation broken", custBStr)
			}
		}
	}

	// 3f. Verify the job row is persisted and marked complete.
	var storedStatus string
	err = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT status FROM data_export_jobs WHERE id = $1`, job.ID,
		).Scan(&storedStatus)
	})
	if err != nil {
		t.Fatalf("read data_export_jobs row: %v", err)
	}
	if storedStatus != "complete" {
		t.Errorf("stored job status %q != 'complete'", storedStatus)
	}

	t.Logf("EnqueueExport: PASS — archive has %d orders, %d customers (org-scoped)",
		len(archive.Orders), len(archive.Customers))
}
