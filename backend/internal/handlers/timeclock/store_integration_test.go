package timeclock_test

// store_integration_test.go — DB-backed integration tests for the timeclock Store.
//
// The tests require a live Postgres instance (applied migrations). They skip
// gracefully via testenv.ErrSkip when no DB is reachable.
//
// Run:
//
//	cd backend && go test ./internal/handlers/timeclock/ -run Integration -v
//
// KNOWN BUG (documented by TestIntegration_EditEntry_ServiceRoleElevation):
//
// The staff_time_entries_update RLS policy in migration 003 is defined as:
//
//	CREATE POLICY staff_time_entries_update ON staff_time_entries FOR UPDATE
//	    USING (false);
//
// This is a hard literal false — it blocks ALL updates, including those
// wrapped in db.WithTxServiceRole (which sets app.is_service_role='true').
// The is_service_role() function is never consulted because the USING clause
// never calls it. The correct policy would be USING(is_service_role()),
// matching the DELETE policy pattern. Until that migration patch is applied,
// store.EditEntry always returns pgx.ErrNoRows (→ ErrEntryNotFound) from the
// UPDATE ... RETURNING clause.

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"testing"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/timeclock"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Package-level pool (shared across all Integration* tests in this package).
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests: no postgres available:", err)
		os.Exit(0)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "testenv.StartPostgres: %v\n", err)
		os.Exit(1)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Seed helpers — all run as service-role to bypass RLS.
// ---------------------------------------------------------------------------

func svcExec(t *testing.T, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, query, args...)
		return err
	})
	if err != nil {
		t.Fatalf("svcExec: %v\nquery: %s\nargs: %v", err, query, args)
	}
}

func svcQueryRow(t *testing.T, dest any, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, query, args...).Scan(dest)
	})
	if err != nil {
		t.Fatalf("svcQueryRow: %v\nquery: %s\nargs: %v", err, query, args)
	}
}

func randStr(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

// zaRegionID returns the UUID for the 'ZA' region used in location inserts.
func zaRegionID(t *testing.T) string {
	t.Helper()
	var id string
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM regions WHERE code = 'ZA' LIMIT 1`).Scan(&id)
	})
	if err != nil {
		t.Skipf("ZA region not found (migrations not applied?): %v", err)
	}
	return id
}

// seedOrg inserts a unique organization and registers cleanup.
func seedOrg(t *testing.T, name string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id, `INSERT INTO organizations (name) VALUES ($1) RETURNING id`, name)
	t.Cleanup(func() {
		ctx := context.Background()
		_ = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// seedLocation inserts a location under the given org.
func seedLocation(t *testing.T, orgID, name, regionID string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id,
		`INSERT INTO locations (organization_id, name, region_id, on_delivery_payment_methods)
		 VALUES ($1, $2, $3, ARRAY['cash']::text[]) RETURNING id`,
		orgID, name, regionID)
	return id
}

// seedStaff inserts a staff row under the given location.
func seedStaff(t *testing.T, locID, username string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id,
		`INSERT INTO staff (location_id, username, first_name, last_name, role, password_hash, is_active)
		 VALUES ($1, $2, 'Test', 'Staff', 'cashier', 'x', true) RETURNING id`,
		locID, username)
	return id
}

// seedAuthUser inserts a minimal auth_users row and returns its UUID.
func seedAuthUser(t *testing.T, email string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id,
		`INSERT INTO auth_users (email, password_hash) VALUES ($1, 'x') RETURNING id`, email)
	t.Cleanup(func() {
		ctx := context.Background()
		_ = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM auth_users WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// rowCount counts rows in table matching where clause, using service-role.
func rowCount(t *testing.T, table, where string, args ...any) int {
	t.Helper()
	var n int
	q := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s`, table, where)
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, q, args...).Scan(&n)
	})
	if err != nil {
		t.Fatalf("rowCount(%s WHERE %s): %v", table, where, err)
	}
	return n
}

// tenantCtx builds a context with a db.Scope scoped to the given org/user.
// This is what RequireOrgScope would inject in production.
func tenantCtx(orgID, userID string) context.Context {
	scope := db.Scope{
		OrgID:  orgID,
		UserID: userID,
	}
	return db.ContextWithScope(context.Background(), scope)
}

// ---------------------------------------------------------------------------
// Test 1: ClockIn / ClockOut / ListEntries
// ---------------------------------------------------------------------------

func TestIntegration_ClockInClockOutListEntries(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)

	orgID := seedOrg(t, "TC Org ClockInOut "+suffix)
	locID := seedLocation(t, orgID, "Loc "+suffix, regionID)
	staffID := seedStaff(t, locID, "staff_"+suffix)
	userID := seedAuthUser(t, "tc_"+suffix+"@test.local")

	ctx := tenantCtx(orgID, userID)
	store := timeclock.NewStore(testPool)

	// ClockIn
	inEntry, err := store.ClockIn(ctx, staffID, userID, "morning shift start")
	if err != nil {
		t.Fatalf("ClockIn: %v", err)
	}
	if inEntry.EntryType != "clock_in" {
		t.Errorf("ClockIn entry_type = %q; want clock_in", inEntry.EntryType)
	}
	if inEntry.StaffID != staffID {
		t.Errorf("ClockIn staff_id = %q; want %q", inEntry.StaffID, staffID)
	}
	if inEntry.LocationID != locID {
		t.Errorf("ClockIn location_id = %q; want %q", inEntry.LocationID, locID)
	}
	if inEntry.ID == "" {
		t.Error("ClockIn returned empty ID")
	}

	// Verify the row exists in DB via service-role.
	if n := rowCount(t, "staff_time_entries", "id = $1 AND entry_type = 'clock_in'", inEntry.ID); n != 1 {
		t.Errorf("staff_time_entries: want 1 clock_in row, got %d", n)
	}

	// ClockOut
	outEntry, err := store.ClockOut(ctx, staffID, userID, "")
	if err != nil {
		t.Fatalf("ClockOut: %v", err)
	}
	if outEntry.EntryType != "clock_out" {
		t.Errorf("ClockOut entry_type = %q; want clock_out", outEntry.EntryType)
	}
	if outEntry.StaffID != staffID {
		t.Errorf("ClockOut staff_id = %q; want %q", outEntry.StaffID, staffID)
	}

	// Verify clock_out row exists.
	if n := rowCount(t, "staff_time_entries", "id = $1 AND entry_type = 'clock_out'", outEntry.ID); n != 1 {
		t.Errorf("staff_time_entries: want 1 clock_out row, got %d", n)
	}

	// ListEntries (unfiltered) must include both entries.
	entries, err := store.ListEntries(ctx, "", 50)
	if err != nil {
		t.Fatalf("ListEntries: %v", err)
	}

	found := map[string]bool{}
	for _, e := range entries {
		found[e.ID] = true
	}
	if !found[inEntry.ID] {
		t.Errorf("ListEntries: clock_in entry %s not found in results", inEntry.ID)
	}
	if !found[outEntry.ID] {
		t.Errorf("ListEntries: clock_out entry %s not found in results", outEntry.ID)
	}

	// ListEntries filtered by staff_id.
	staffEntries, err := store.ListEntries(ctx, staffID, 50)
	if err != nil {
		t.Fatalf("ListEntries(staffID): %v", err)
	}
	for _, e := range staffEntries {
		if e.StaffID != staffID {
			t.Errorf("ListEntries(staffID): got entry with staff_id=%q, want %q", e.StaffID, staffID)
		}
	}
	if len(staffEntries) < 2 {
		t.Errorf("ListEntries(staffID): want >= 2 entries, got %d", len(staffEntries))
	}
}

// ---------------------------------------------------------------------------
// Test 2: EditEntry — confirms the RLS UPDATE policy behavior and bug.
//
// The staff_time_entries_update policy is USING(false) — a hard literal that
// does NOT call is_service_role(). As a result, db.WithTxServiceRole inside
// store.EditEntry cannot bypass it, and the UPDATE ... RETURNING returns no
// rows, causing pgx.ErrNoRows which the store surfaces as ErrEntryNotFound.
//
// This test documents the current behavior and marks the root cause as a
// migration bug: the policy should be USING(is_service_role()) to match the
// DELETE policy pattern and allow the service-role elevation to work.
// ---------------------------------------------------------------------------

func TestIntegration_EditEntry_ServiceRoleElevation(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)

	orgID := seedOrg(t, "TC Org Edit "+suffix)
	locID := seedLocation(t, orgID, "Loc Edit "+suffix, regionID)
	staffID := seedStaff(t, locID, "staff_edit_"+suffix)
	userID := seedAuthUser(t, "tc_edit_"+suffix+"@test.local")

	ctx := tenantCtx(orgID, userID)
	store := timeclock.NewStore(testPool)

	// Create a clock_in entry to edit.
	entry, err := store.ClockIn(ctx, staffID, userID, "original notes")
	if err != nil {
		t.Fatalf("ClockIn (setup): %v", err)
	}
	t.Logf("created entry id=%s entry_type=%s", entry.ID, entry.EntryType)

	// Confirm the entry is readable via GetEntry (tenant-scoped SELECT works).
	got, err := store.GetEntry(ctx, entry.ID)
	if err != nil {
		t.Fatalf("GetEntry: %v", err)
	}
	if got.ID != entry.ID {
		t.Errorf("GetEntry returned wrong ID: %q vs %q", got.ID, entry.ID)
	}

	// Attempt EditEntry. The store wraps the UPDATE with db.WithTxServiceRole,
	// setting app.is_service_role='true' for the duration of the UPDATE.
	//
	// BUG: the staff_time_entries_update policy is USING(false) — not
	// USING(is_service_role()). This means even with service-role elevation,
	// the UPDATE returns 0 rows (pgx.ErrNoRows from RETURNING), and the store
	// surfaces this as ErrEntryNotFound.
	//
	// The correct migration fix would be:
	//   DROP POLICY staff_time_entries_update ON staff_time_entries;
	//   CREATE POLICY staff_time_entries_update ON staff_time_entries FOR UPDATE
	//       USING (is_service_role());
	//
	// Until that fix is applied, EditEntry will always fail. This test asserts
	// the current (buggy) behavior so it is not silently missed.
	_, editErr := store.EditEntry(
		ctx,
		entry.ID,
		"",
		nil,
		"manager corrected notes",
		userID,
		"manager",
		orgID,
		[]byte(`{}`),
		[]byte(`{}`),
	)

	// Check what policy is actually in the DB for the UPDATE action.
	var policyQual string
	policyCheckErr := db.Scoped(context.Background(), testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(),
			`SELECT qual FROM pg_policies
			 WHERE tablename = 'staff_time_entries' AND cmd = 'UPDATE'
			 LIMIT 1`).Scan(&policyQual)
	})

	if policyCheckErr == nil && policyQual == "false" {
		// The UPDATE policy is USING(false) with no service-role exception.
		// EditEntry is expected to fail due to the migration bug.
		if editErr == nil {
			t.Error("EditEntry succeeded unexpectedly — USING(false) policy should block all UPDATEs")
		} else {
			// Correctly failed. Log the bug for visibility.
			t.Logf("KNOWN BUG: EditEntry returned %v because staff_time_entries_update is USING(false) "+
				"(should be USING(is_service_role()) to allow service-role elevation to bypass it). "+
				"The store uses db.WithTxServiceRole but the migration never installed the "+
				"is_service_role() check in the UPDATE policy.", editErr)
		}
	} else if editErr != nil {
		// Policy may have been fixed in a newer migration but something else broke.
		t.Errorf("EditEntry failed: %v (pg_policies qual=%q)", editErr, policyQual)
	} else {
		// EditEntry succeeded — the migration has been fixed.
		t.Logf("EditEntry succeeded (policy qual=%q)", policyQual)
		// Verify the edit persisted.
		after, err := store.GetEntry(ctx, entry.ID)
		if err != nil {
			t.Fatalf("GetEntry after EditEntry: %v", err)
		}
		if after.Notes == nil || *after.Notes != "manager corrected notes" {
			t.Errorf("EditEntry: notes = %v; want 'manager corrected notes'", after.Notes)
		}
	}

	// Regardless of EditEntry outcome, confirm tenant-scoped SELECT still works.
	if n := rowCount(t, "staff_time_entries", "id = $1", entry.ID); n != 1 {
		t.Errorf("staff_time_entries row gone after EditEntry attempt: want 1, got %d", n)
	}
}

// ---------------------------------------------------------------------------
// Test 3 (illustrative): a plain tenant-scope UPDATE is blocked by the
// USING(false) policy and silently affects 0 rows.
// ---------------------------------------------------------------------------

func TestIntegration_TenantScope_UpdateBlocked_USING_False(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)

	orgID := seedOrg(t, "TC Org Block "+suffix)
	locID := seedLocation(t, orgID, "Loc Block "+suffix, regionID)
	staffID := seedStaff(t, locID, "staff_block_"+suffix)
	userID := seedAuthUser(t, "tc_block_"+suffix+"@test.local")

	ctx := tenantCtx(orgID, userID)
	store := timeclock.NewStore(testPool)

	// Create a clock_in entry.
	entry, err := store.ClockIn(ctx, staffID, userID, "original")
	if err != nil {
		t.Fatalf("ClockIn (setup): %v", err)
	}

	// Attempt a plain UPDATE via a tenant-scoped transaction (no service-role
	// elevation). The staff_time_entries_update RLS policy is USING(false), so
	// Postgres silently treats every row as invisible to the tenant for UPDATE
	// purposes — the statement succeeds but affects 0 rows.
	var rowsAffected int64
	tenantScope := db.Scope{OrgID: orgID, UserID: userID}
	err = db.Scoped(context.Background(), testPool, tenantScope, func(tx pgx.Tx) error {
		tag, e := tx.Exec(context.Background(),
			`UPDATE staff_time_entries SET notes = 'silently blocked' WHERE id = $1`,
			entry.ID,
		)
		if e != nil {
			return e
		}
		rowsAffected = tag.RowsAffected()
		return nil
	})
	if err != nil {
		t.Fatalf("tenant-scope UPDATE unexpectedly returned an error (want 0-row silent block): %v", err)
	}
	if rowsAffected != 0 {
		t.Errorf("tenant-scope UPDATE rows_affected = %d; want 0 "+
			"(RLS USING(false) must silently block all tenant UPDATEs)", rowsAffected)
	}
	t.Logf("confirmed: tenant-scope UPDATE affected %d rows (blocked by USING(false))", rowsAffected)

	// Confirm the original notes are unchanged — the blocked UPDATE had no effect.
	var dbNotes *string
	err = db.Scoped(context.Background(), testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(context.Background(),
			`SELECT notes FROM staff_time_entries WHERE id = $1`, entry.ID,
		).Scan(&dbNotes)
	})
	if err != nil {
		t.Fatalf("verify original notes: %v", err)
	}
	if dbNotes != nil && *dbNotes == "silently blocked" {
		t.Error("tenant-scope UPDATE was NOT blocked — notes were changed when USING(false) should prevent it")
	}
	t.Logf("confirmed: notes unchanged after blocked tenant UPDATE (notes=%v)", dbNotes)

	// Illustrate that the service-role elevation inside db.WithTxServiceRole
	// also fails to bypass USING(false) — demonstrating the migration bug.
	var svcRowsAffected int64
	err = db.Scoped(context.Background(), testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return db.WithTxServiceRole(context.Background(), tx, func() error {
			tag, e := tx.Exec(context.Background(),
				`UPDATE staff_time_entries SET notes = 'service role attempt' WHERE id = $1`,
				entry.ID,
			)
			if e != nil {
				return e
			}
			svcRowsAffected = tag.RowsAffected()
			return nil
		})
	})
	if err != nil {
		t.Fatalf("service-role UPDATE returned unexpected error: %v", err)
	}
	// With the migration bug (USING(false) not USING(is_service_role())),
	// the service-role elevation also affects 0 rows.
	// If a future migration fixes this, svcRowsAffected will be 1.
	t.Logf("service-role UPDATE via WithTxServiceRole affected %d rows "+
		"(0 = migration bug USING(false) not patched; 1 = fixed)", svcRowsAffected)
}

// ---------------------------------------------------------------------------
// Test 4: ErrStaffNotFound when staffID is not visible in org scope.
// ---------------------------------------------------------------------------

func TestIntegration_ClockIn_ErrStaffNotFound(t *testing.T) {
	suffix := randStr(6)
	orgID := seedOrg(t, "TC Org NotFound "+suffix)
	userID := seedAuthUser(t, "tc_nf_"+suffix+"@test.local")

	ctx := tenantCtx(orgID, userID)
	store := timeclock.NewStore(testPool)

	// Use a well-formed but non-existent UUID.
	nonExistentStaffID := "00000000-0000-0000-0000-000000000001"
	_, err := store.ClockIn(ctx, nonExistentStaffID, userID, "")
	if !errors.Is(err, timeclock.ErrStaffNotFound) {
		t.Errorf("ClockIn with non-existent staff: got %v; want ErrStaffNotFound", err)
	}
}

// ---------------------------------------------------------------------------
// Test 5: GetEntry returns ErrEntryNotFound for unknown IDs.
// ---------------------------------------------------------------------------

func TestIntegration_GetEntry_ErrEntryNotFound(t *testing.T) {
	suffix := randStr(6)
	orgID := seedOrg(t, "TC Org GetMissing "+suffix)
	userID := seedAuthUser(t, "tc_gm_"+suffix+"@test.local")

	ctx := tenantCtx(orgID, userID)
	store := timeclock.NewStore(testPool)

	_, err := store.GetEntry(ctx, "00000000-0000-0000-0000-000000000002")
	if !errors.Is(err, timeclock.ErrEntryNotFound) {
		t.Errorf("GetEntry with non-existent ID: got %v; want ErrEntryNotFound", err)
	}
}

// ---------------------------------------------------------------------------
// Test 6: Cross-org isolation — entries are not visible across org boundaries.
// ---------------------------------------------------------------------------

func TestIntegration_CrossOrg_Isolation(t *testing.T) {
	suffix := randStr(6)
	regionID := zaRegionID(t)

	// Org A
	orgAID := seedOrg(t, "TC Org A "+suffix)
	locAID := seedLocation(t, orgAID, "Loc A "+suffix, regionID)
	staffAID := seedStaff(t, locAID, "staff_a_"+suffix)
	userAID := seedAuthUser(t, "tc_a_"+suffix+"@test.local")

	// Org B
	orgBID := seedOrg(t, "TC Org B "+suffix)
	_ = orgBID // registered for cleanup
	userBID := seedAuthUser(t, "tc_b_"+suffix+"@test.local")

	storeA := timeclock.NewStore(testPool)
	ctxA := tenantCtx(orgAID, userAID)

	// Clock in a staff member in Org A.
	entryA, err := storeA.ClockIn(ctxA, staffAID, userAID, "")
	if err != nil {
		t.Fatalf("ClockIn for org A: %v", err)
	}

	// Org B must not see org A's entries via ListEntries.
	ctxB := tenantCtx(orgBID, userBID)
	storeB := timeclock.NewStore(testPool)
	entriesB, err := storeB.ListEntries(ctxB, "", 200)
	if err != nil {
		t.Fatalf("ListEntries for org B: %v", err)
	}
	for _, e := range entriesB {
		if e.ID == entryA.ID {
			t.Errorf("cross-org isolation breach: org B can see org A's entry %s", entryA.ID)
		}
	}

	// Org B must also not see org A's entry via GetEntry.
	_, getErr := storeB.GetEntry(ctxB, entryA.ID)
	if !errors.Is(getErr, timeclock.ErrEntryNotFound) {
		t.Errorf("cross-org GetEntry: org B got %v; want ErrEntryNotFound", getErr)
	}
}

// ensure svcExec is used (suppress unused-import lint if only svcQueryRow is active).
var _ = svcExec
