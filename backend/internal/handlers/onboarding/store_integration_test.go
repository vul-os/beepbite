package onboarding

// DB-backed integration tests for the onboarding Store.
//
// Run:
//
//	cd /home/exo/Documents/beepbite-mono/backend
//	go test ./internal/handlers/onboarding/ -run Integration -v
//
// Tests skip automatically when no Postgres backend is available
// (Docker absent and DATABASE_URL/TEST_DATABASE_URL unset) via
// testenv.ErrSkip → os.Exit(0).
//
// Covered:
//  1. GetProgress on a fresh org → step=0, completed_steps=[] (no error, not 404 to caller).
//  2. UpsertProgress + GetProgress round-trip; second Upsert updates in-place (no duplicate row).
//  3. GetStatus with no data → all flags false; after seeding each prerequisite the
//     corresponding flag becomes true; driver member branch (role='driver' in
//     organization_members) causes HasStaffOrDriver to become true.
//  4. RLS isolation: org-A's progress row is invisible under org-B's scope.

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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Package-level pool — shared across all Integration* tests.
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests: no postgres backend available:", err)
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
// Seed helpers — all inserts use ServiceRoleScope to bypass RLS.
// ---------------------------------------------------------------------------

func init() {
	rand.Seed(time.Now().UnixNano())
}

func randSuffix() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// seedOrg inserts a fresh organization and returns its UUID.
// Cleanup deletes the org on test completion (cascades to child rows).
func seedOrg(t *testing.T, ctx context.Context, name string) string {
	t.Helper()
	var orgID string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, name,
		).Scan(&orgID)
	})
	if err != nil {
		t.Fatalf("seedOrg(%q): %v", name, err)
	}
	t.Cleanup(func() {
		_ = db.Scoped(context.Background(), testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, e := tx.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
			return e
		})
	})
	return orgID
}

// seedLocation inserts a location under orgID and returns its UUID.
func seedLocation(t *testing.T, ctx context.Context, orgID string) string {
	t.Helper()
	var locID string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Resolve the ZA region required for the FK.
		var regionID string
		if err := tx.QueryRow(ctx,
			`SELECT id FROM regions WHERE code = 'ZA' AND is_active = true LIMIT 1`,
		).Scan(&regionID); err != nil {
			// fallback: any region
			if err2 := tx.QueryRow(ctx,
				`SELECT id FROM regions WHERE is_active = true LIMIT 1`,
			).Scan(&regionID); err2 != nil {
				return fmt.Errorf("resolve region: %w", err2)
			}
		}
		return tx.QueryRow(ctx, `
			INSERT INTO locations (organization_id, region_id, name, on_delivery_payment_methods)
			VALUES ($1, $2, $3, ARRAY['cash']::text[])
			RETURNING id`,
			orgID, regionID, "Test Location",
		).Scan(&locID)
	})
	if err != nil {
		t.Fatalf("seedLocation(org=%s): %v", orgID, err)
	}
	return locID
}

// seedItems inserts n active menu items under locID.
func seedItems(t *testing.T, ctx context.Context, locID string, n int) {
	t.Helper()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Ensure a category exists for the location.
		var catID string
		if err := tx.QueryRow(ctx, `
			INSERT INTO categories (location_id, organization_id, name)
			SELECT $1, organization_id, 'Test Category'
			FROM locations WHERE id = $1
			RETURNING id`, locID,
		).Scan(&catID); err != nil {
			return fmt.Errorf("insert category: %w", err)
		}
		for i := 0; i < n; i++ {
			if _, err := tx.Exec(ctx, `
				INSERT INTO items (location_id, category_id, name, price, is_active)
				VALUES ($1, $2, $3, 50.00, true)`,
				locID, catID, fmt.Sprintf("Item %d", i+1),
			); err != nil {
				return fmt.Errorf("insert item %d: %w", i, err)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seedItems(loc=%s, n=%d): %v", locID, n, err)
	}
}

// seedStaff inserts a staff member under locID and returns its UUID.
func seedStaff(t *testing.T, ctx context.Context, locID string) string {
	t.Helper()
	sfx := randSuffix()
	var staffID string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO staff (location_id, username, first_name, last_name, role, password_hash, is_active)
			VALUES ($1, $2, 'Test', 'Staff', 'cashier', 'dummy-hash', true)
			RETURNING id`,
			locID, "staff_"+sfx,
		).Scan(&staffID)
	})
	if err != nil {
		t.Fatalf("seedStaff(loc=%s): %v", locID, err)
	}
	return staffID
}

// seedDriverMember inserts an organization_members row with role='driver'
// and returns its UUID. Inserts auth_users row only; the on_auth_user_created
// trigger (migration 002) auto-creates the matching profiles row so we must
// NOT insert into profiles manually.
func seedDriverMember(t *testing.T, ctx context.Context, orgID string) string {
	t.Helper()
	sfx := randSuffix()
	email := fmt.Sprintf("driver-%s@test.invalid", sfx)

	var memberID string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Insert auth_user; the on_auth_user_created trigger creates the profile.
		var userID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO auth_users (email, password_hash) VALUES ($1, 'dummy') RETURNING id`,
			email,
		).Scan(&userID); err != nil {
			return fmt.Errorf("insert auth_user: %w", err)
		}
		// driver membership (profile was auto-created by trigger)
		if err := tx.QueryRow(ctx, `
			INSERT INTO organization_members (organization_id, profile_id, role)
			VALUES ($1, $2, 'driver')
			RETURNING id`,
			orgID, userID,
		).Scan(&memberID); err != nil {
			return fmt.Errorf("insert org_member(driver): %w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seedDriverMember(org=%s): %v", orgID, err)
	}
	// Cleanup the auth_user (org delete cascades membership but not auth_users).
	t.Cleanup(func() {
		_ = db.Scoped(context.Background(), testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, e := tx.Exec(context.Background(),
				`DELETE FROM auth_users WHERE email = $1`, email)
			return e
		})
	})
	return memberID
}

// seedCompletedOrder inserts an order with status 'completed'.
func seedCompletedOrder(t *testing.T, ctx context.Context, orgID, locID string) {
	t.Helper()
	orderNum := fmt.Sprintf("TST-%s", randSuffix())
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `
			INSERT INTO orders (organization_id, location_id, order_number, status, currency_code)
			VALUES ($1, $2, $3, 'completed', 'ZAR')`,
			orgID, locID, orderNum,
		)
		return e
	})
	if err != nil {
		t.Fatalf("seedCompletedOrder(org=%s, loc=%s): %v", orgID, locID, err)
	}
}

// orgScopedCtx returns a context carrying org-scope session vars so that
// Store methods (which call db.ScopeFromContext) resolve to orgID.
func orgScopedCtx(orgID string) context.Context {
	return db.ContextWithScope(context.Background(), db.Scope{OrgID: orgID})
}

// countProgressRows returns the number of onboarding_progress rows for orgID
// using ServiceRoleScope (bypasses RLS so we can verify exact row counts).
func countProgressRows(t *testing.T, orgID string) int {
	t.Helper()
	var n int
	err := db.Scoped(context.Background(), testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM onboarding_progress WHERE org_id = $1`, orgID,
		).Scan(&n)
	})
	if err != nil {
		t.Fatalf("countProgressRows(org=%s): %v", orgID, err)
	}
	return n
}

// ---------------------------------------------------------------------------
// Test 1: GetProgress on fresh org returns zeroed progress (no error).
// ---------------------------------------------------------------------------

func TestIntegrationGetProgress_FreshOrg(t *testing.T) {
	ctx := orgScopedCtx(seedOrg(t, context.Background(), "Onboard GetProgress Fresh "+randSuffix()))
	orgID := db.ScopeFromContext(ctx).OrgID

	store := NewStore(testPool)

	// The handler converts ErrNotFound into a zeroed 200 response;
	// the store itself returns ErrNotFound which callers must handle.
	// Here we test the store directly: a fresh org has no row → ErrNotFound.
	p, err := store.GetProgress(ctx)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetProgress on fresh org: want ErrNotFound, got err=%v, progress=%+v", err, p)
	}
	// Confirm no row exists in the DB.
	if n := countProgressRows(t, orgID); n != 0 {
		t.Errorf("expected 0 progress rows for fresh org, got %d", n)
	}
}

// ---------------------------------------------------------------------------
// Test 2: UpsertProgress + GetProgress round-trip; second Upsert updates in-place.
// ---------------------------------------------------------------------------

func TestIntegrationUpsertProgress_RoundTrip(t *testing.T) {
	sfx := randSuffix()
	orgID := seedOrg(t, context.Background(), "Onboard Upsert "+sfx)
	ctx := orgScopedCtx(orgID)

	store := NewStore(testPool)

	// --- First upsert ---
	steps1 := []string{"email", "location"}
	p1, err := store.UpsertProgress(ctx, 2, steps1)
	if err != nil {
		t.Fatalf("UpsertProgress (first): %v", err)
	}
	if p1.Step != 2 {
		t.Errorf("UpsertProgress: step = %d, want 2", p1.Step)
	}
	if len(p1.CompletedSteps) != 2 || p1.CompletedSteps[0] != "email" || p1.CompletedSteps[1] != "location" {
		t.Errorf("UpsertProgress: completed_steps = %v, want [email location]", p1.CompletedSteps)
	}
	if p1.OrgID != orgID {
		t.Errorf("UpsertProgress: org_id = %q, want %q", p1.OrgID, orgID)
	}

	// --- GetProgress round-trip ---
	p2, err := store.GetProgress(ctx)
	if err != nil {
		t.Fatalf("GetProgress after upsert: %v", err)
	}
	if p2.Step != 2 {
		t.Errorf("GetProgress: step = %d, want 2", p2.Step)
	}
	if len(p2.CompletedSteps) != 2 {
		t.Errorf("GetProgress: completed_steps len = %d, want 2", len(p2.CompletedSteps))
	}

	// --- Second upsert must update in-place, no duplicate row ---
	steps3 := []string{"email", "location", "menu"}
	p3, err := store.UpsertProgress(ctx, 3, steps3)
	if err != nil {
		t.Fatalf("UpsertProgress (second): %v", err)
	}
	if p3.Step != 3 {
		t.Errorf("UpsertProgress (second): step = %d, want 3", p3.Step)
	}
	if len(p3.CompletedSteps) != 3 {
		t.Errorf("UpsertProgress (second): completed_steps len = %d, want 3", len(p3.CompletedSteps))
	}

	// Exactly one row must exist — no duplicate was inserted.
	if n := countProgressRows(t, orgID); n != 1 {
		t.Errorf("expected exactly 1 progress row after two upserts, got %d", n)
	}

	// GetProgress reflects the updated values.
	p4, err := store.GetProgress(ctx)
	if err != nil {
		t.Fatalf("GetProgress after second upsert: %v", err)
	}
	if p4.Step != 3 {
		t.Errorf("GetProgress after second upsert: step = %d, want 3", p4.Step)
	}
}

// ---------------------------------------------------------------------------
// Test 3: GetStatus — all flags false on empty org; each seed flips one flag.
// ---------------------------------------------------------------------------

func TestIntegrationGetStatus(t *testing.T) {
	sfx := randSuffix()
	orgID := seedOrg(t, context.Background(), "Onboard Status "+sfx)
	ctx := orgScopedCtx(orgID)

	store := NewStore(testPool)

	// --- 3a: No data → all flags false ---
	st, err := store.GetStatus(ctx)
	if err != nil {
		t.Fatalf("GetStatus (empty org): %v", err)
	}
	if st.HasLocation {
		t.Error("GetStatus empty: HasLocation should be false")
	}
	if st.HasFiveItems {
		t.Error("GetStatus empty: HasFiveItems should be false")
	}
	if st.HasStaffOrDriver {
		t.Error("GetStatus empty: HasStaffOrDriver should be false")
	}
	if st.HasOrder {
		t.Error("GetStatus empty: HasOrder should be false")
	}

	// --- 3b: Add a location → HasLocation = true ---
	locID := seedLocation(t, context.Background(), orgID)
	st, err = store.GetStatus(ctx)
	if err != nil {
		t.Fatalf("GetStatus (after location): %v", err)
	}
	if !st.HasLocation {
		t.Error("GetStatus after location: HasLocation should be true")
	}
	if st.HasFiveItems {
		t.Error("GetStatus after location only: HasFiveItems should still be false")
	}

	// --- 3c: Add 5 active items → HasFiveItems = true ---
	seedItems(t, context.Background(), locID, 5)
	st, err = store.GetStatus(ctx)
	if err != nil {
		t.Fatalf("GetStatus (after 5 items): %v", err)
	}
	if !st.HasFiveItems {
		t.Error("GetStatus after 5 items: HasFiveItems should be true")
	}
	if st.HasStaffOrDriver {
		t.Error("GetStatus after items: HasStaffOrDriver should still be false")
	}

	// --- 3d: Add a staff member → HasStaffOrDriver = true (staff branch) ---
	seedStaff(t, context.Background(), locID)
	st, err = store.GetStatus(ctx)
	if err != nil {
		t.Fatalf("GetStatus (after staff): %v", err)
	}
	if !st.HasStaffOrDriver {
		t.Error("GetStatus after staff: HasStaffOrDriver should be true (staff branch)")
	}

	// --- 3e: Use a SECOND org that only has a driver member, no staff row.
	//         This specifically tests the driver branch in GetStatus:
	//           OR EXISTS (SELECT 1 FROM organization_members WHERE organization_id=$1 AND role='driver')
	orgB := seedOrg(t, context.Background(), "Onboard Driver Only "+sfx)
	ctxB := orgScopedCtx(orgB)

	st0, err := store.GetStatus(ctxB)
	if err != nil {
		t.Fatalf("GetStatus driver-only org (before driver): %v", err)
	}
	if st0.HasStaffOrDriver {
		t.Error("GetStatus driver-only org before driver: HasStaffOrDriver should be false")
	}

	seedDriverMember(t, context.Background(), orgB)
	stD, err := store.GetStatus(ctxB)
	if err != nil {
		t.Fatalf("GetStatus driver-only org (after driver): %v", err)
	}
	if !stD.HasStaffOrDriver {
		t.Error("GetStatus: HasStaffOrDriver should be true after seeding a role='driver' organization_member (driver branch)")
	}

	if st.HasOrder {
		t.Error("GetStatus before order: HasOrder should still be false")
	}

	// --- 3f: Add a completed order → HasOrder = true ---
	seedCompletedOrder(t, context.Background(), orgID, locID)
	st, err = store.GetStatus(ctx)
	if err != nil {
		t.Fatalf("GetStatus (after completed order): %v", err)
	}
	if !st.HasOrder {
		t.Error("GetStatus after completed order: HasOrder should be true")
	}

	// All four flags must now be true for the main org.
	if !st.HasLocation || !st.HasFiveItems || !st.HasStaffOrDriver || !st.HasOrder {
		t.Errorf("GetStatus: not all flags true: %+v", st)
	}
}

// ---------------------------------------------------------------------------
// Test 4: RLS isolation — org-A's progress is not readable under org-B's scope.
// ---------------------------------------------------------------------------

func TestIntegrationRLSIsolation(t *testing.T) {
	sfx := randSuffix()
	orgA := seedOrg(t, context.Background(), "Onboard RLS OrgA "+sfx)
	orgB := seedOrg(t, context.Background(), "Onboard RLS OrgB "+sfx)

	ctxA := orgScopedCtx(orgA)
	ctxB := orgScopedCtx(orgB)

	store := NewStore(testPool)

	// Write progress under org-A.
	_, err := store.UpsertProgress(ctxA, 1, []string{"email"})
	if err != nil {
		t.Fatalf("UpsertProgress org-A: %v", err)
	}

	// Verify the row exists from org-A's scope.
	p, err := store.GetProgress(ctxA)
	if err != nil {
		t.Fatalf("GetProgress org-A: %v", err)
	}
	if p.Step != 1 {
		t.Errorf("GetProgress org-A: step = %d, want 1", p.Step)
	}

	// Read from org-B's scope → must return ErrNotFound (RLS blocks the row).
	pB, errB := store.GetProgress(ctxB)
	if !errors.Is(errB, ErrNotFound) {
		t.Errorf("GetProgress org-B (RLS isolation): want ErrNotFound, got err=%v, progress=%+v", errB, pB)
	}

	// Also verify that org-B can upsert its own independent row.
	_, errU := store.UpsertProgress(ctxB, 5, []string{"email", "location", "menu", "staff", "payment"})
	if errU != nil {
		t.Fatalf("UpsertProgress org-B: %v", errU)
	}

	// After org-B's upsert, org-A's progress is still its own value (not overwritten).
	pA2, errA2 := store.GetProgress(ctxA)
	if errA2 != nil {
		t.Fatalf("GetProgress org-A after org-B write: %v", errA2)
	}
	if pA2.Step != 1 {
		t.Errorf("GetProgress org-A after org-B write: step = %d, want 1 (org-B must not overwrite org-A)", pA2.Step)
	}

	// Confirm exactly 1 row per org.
	if n := countProgressRows(t, orgA); n != 1 {
		t.Errorf("org-A progress rows: want 1, got %d", n)
	}
	if n := countProgressRows(t, orgB); n != 1 {
		t.Errorf("org-B progress rows: want 1, got %d", n)
	}
}
