package customdomains_test

// Integration tests for customdomains.Store against a real, migrated Postgres
// instance provisioned by cmd/tests/testenv.
//
// Prerequisites:
//   - Either Docker (for testcontainers) or a Postgres instance reachable via
//     TEST_DATABASE_URL / DATABASE_URL.
//   - All migrations applied, including:
//       036_custom_domains.sql  — table + RLS
//       047_wave_audit_fixes.sql — FORCE RLS, verification_token default, partial unique
//
// Run:
//
//	cd backend && go test ./internal/handlers/customdomains/ -run Integration -v

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"testing"
	"time"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/customdomains"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// TestMain — package-level pool shared across all Integration* tests.
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping customdomains integration tests:", err)
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
// Seed helpers (all bypass RLS via ServiceRoleScope)
// ---------------------------------------------------------------------------

func init() {
	rand.Seed(time.Now().UnixNano())
}

func randStr(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

// svcQueryRow runs a QueryRow inside a ServiceRole transaction, scanning dest.
func svcQueryRow(t *testing.T, dest any, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, query, args...).Scan(dest)
	})
	if err != nil {
		t.Fatalf("svcQueryRow: %v\nquery: %s", err, query)
	}
}

// svcExec runs Exec inside a ServiceRole transaction.
func svcExec(t *testing.T, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, query, args...)
		return err
	})
	if err != nil {
		t.Fatalf("svcExec: %v\nquery: %s", err, query)
	}
}

// zaRegionID returns the UUID of the 'ZA' region (seeded by migration 014).
func zaRegionID(t *testing.T) string {
	t.Helper()
	var id string
	ctx := context.Background()
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM regions WHERE code = 'ZA' LIMIT 1`).Scan(&id)
	})
	if err != nil {
		t.Skipf("ZA region not seeded (migrations not applied?): %v", err)
	}
	return id
}

// seedOrg inserts an organization and returns its UUID.
// Registers a t.Cleanup to cascade-delete via the org row.
func seedOrg(t *testing.T, name string) string {
	t.Helper()
	var id string
	svcQueryRow(t, &id,
		`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, name)
	t.Cleanup(func() {
		ctx := context.Background()
		_ = db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// seedLocation inserts a location under orgID (with a unique slug) and returns
// its UUID.  on_delivery_payment_methods is required to be non-empty.
func seedLocation(t *testing.T, orgID, name, slug string, isActive bool) string {
	t.Helper()
	regionID := zaRegionID(t)
	var id string
	svcQueryRow(t, &id,
		`INSERT INTO locations
		 (organization_id, name, region_id, slug, is_active, on_delivery_payment_methods)
		 VALUES ($1, $2, $3, $4, $5, ARRAY['cash']::text[])
		 RETURNING id`,
		orgID, name, regionID, slug, isActive)
	return id
}

// orgScope returns a db.Scope that impersonates tenant access for orgID.
// The RLS policies check current_org_id() (set from app.current_org_id).
func orgScope(orgID string) db.Scope {
	return db.Scope{OrgID: orgID}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestIntegration_AddDomain_VerificationTokenNonEmpty is the key regression
// check for migration 047: the verification_token DEFAULT must be non-empty
// on every INSERT. Before 047 the token was always blank.
func TestIntegration_AddDomain_VerificationTokenNonEmpty(t *testing.T) {
	ctx := context.Background()
	suffix := randStr(8)
	orgID := seedOrg(t, "CustomDomain Org "+suffix)
	locID := seedLocation(t, orgID, "Loc "+suffix, "loc-"+suffix, true)

	store := customdomains.NewStore(testPool)
	hostname := "verify-token-" + suffix + ".example.com"

	d, err := store.AddDomain(ctx, orgScope(orgID), locID, hostname)
	if err != nil {
		t.Fatalf("AddDomain: %v", err)
	}
	if d.VerificationToken == "" {
		t.Error("verification_token is empty — migration 047 DEFAULT not applied (regression)")
	}
	if d.Status != "pending" {
		t.Errorf("expected status=pending, got %q", d.Status)
	}
	if d.LocationID != locID {
		t.Errorf("location_id mismatch: got %q, want %q", d.LocationID, locID)
	}
}

// TestIntegration_AddDomain_ListByLocation checks that AddDomain is visible
// via ListByLocation under the same org scope.
func TestIntegration_AddDomain_ListByLocation(t *testing.T) {
	ctx := context.Background()
	suffix := randStr(8)
	orgID := seedOrg(t, "List Test Org "+suffix)
	locID := seedLocation(t, orgID, "List Loc "+suffix, "list-"+suffix, true)

	store := customdomains.NewStore(testPool)
	hostname := "list-" + suffix + ".example.com"

	added, err := store.AddDomain(ctx, orgScope(orgID), locID, hostname)
	if err != nil {
		t.Fatalf("AddDomain: %v", err)
	}

	list, err := store.ListByLocation(ctx, orgScope(orgID), locID)
	if err != nil {
		t.Fatalf("ListByLocation: %v", err)
	}
	found := false
	for _, d := range list {
		if d.ID == added.ID {
			found = true
			if d.VerificationToken == "" {
				t.Error("verification_token empty in list result")
			}
		}
	}
	if !found {
		t.Errorf("added domain %s not found in ListByLocation result", added.ID)
	}
}

// TestIntegration_AddDomain_DuplicateLiveHostname checks that adding the same
// hostname for an active (non-removed) row returns ErrDuplicate.
func TestIntegration_AddDomain_DuplicateLiveHostname(t *testing.T) {
	ctx := context.Background()
	suffix := randStr(8)
	orgID := seedOrg(t, "Dup Test Org "+suffix)
	locID := seedLocation(t, orgID, "Dup Loc "+suffix, "dup-"+suffix, true)

	store := customdomains.NewStore(testPool)
	hostname := "dup-" + suffix + ".example.com"

	if _, err := store.AddDomain(ctx, orgScope(orgID), locID, hostname); err != nil {
		t.Fatalf("first AddDomain: %v", err)
	}

	_, err := store.AddDomain(ctx, orgScope(orgID), locID, hostname)
	if !errors.Is(err, customdomains.ErrDuplicate) {
		t.Errorf("second AddDomain: want ErrDuplicate, got %v", err)
	}
}

// TestIntegration_StatusFlow exercises the full status lifecycle:
// pending → verified → cert_issuing → live, and verifies that
// ResolveCustomHostname only succeeds when status = 'live'.
func TestIntegration_StatusFlow(t *testing.T) {
	ctx := context.Background()
	suffix := randStr(8)
	orgID := seedOrg(t, "Status Flow Org "+suffix)
	locID := seedLocation(t, orgID, "Flow Loc "+suffix, "flow-"+suffix, true)

	store := customdomains.NewStore(testPool)
	hostname := "flow-" + suffix + ".example.com"

	d, err := store.AddDomain(ctx, orgScope(orgID), locID, hostname)
	if err != nil {
		t.Fatalf("AddDomain: %v", err)
	}
	if d.Status != "pending" {
		t.Fatalf("initial status want=pending got=%s", d.Status)
	}

	// ResolveCustomHostname must fail before status=live.
	if _, err := store.ResolveCustomHostname(ctx, hostname); !errors.Is(err, customdomains.ErrNotFound) {
		t.Errorf("ResolveCustomHostname before live: want ErrNotFound, got %v", err)
	}

	// MarkVerified: pending → verified.
	verified, err := store.MarkVerified(ctx, d.ID)
	if err != nil {
		t.Fatalf("MarkVerified: %v", err)
	}
	if verified.Status != "verified" {
		t.Errorf("MarkVerified: want status=verified, got %s", verified.Status)
	}
	if verified.VerifiedAt == nil {
		t.Error("MarkVerified: verified_at is nil")
	}

	// MarkCertIssuing: verified → cert_issuing.
	if err := store.MarkCertIssuing(ctx, d.ID); err != nil {
		t.Fatalf("MarkCertIssuing: %v", err)
	}

	// MarkLive: cert_issuing → live.
	if err := store.MarkLive(ctx, d.ID); err != nil {
		t.Fatalf("MarkLive: %v", err)
	}

	// ResolveCustomHostname must now succeed.
	gotLocID, err := store.ResolveCustomHostname(ctx, hostname)
	if err != nil {
		t.Fatalf("ResolveCustomHostname after live: %v", err)
	}
	if gotLocID != locID {
		t.Errorf("ResolveCustomHostname: want locID=%s, got=%s", locID, gotLocID)
	}
}

// TestIntegration_ResolveSlug checks that ResolveSlug returns the location ID
// for an active slug and ErrNotFound for an inactive or unknown slug.
func TestIntegration_ResolveSlug(t *testing.T) {
	ctx := context.Background()
	suffix := randStr(8)
	orgID := seedOrg(t, "Slug Test Org "+suffix)

	activeLocID := seedLocation(t, orgID, "Active Loc "+suffix, "active-"+suffix, true)
	_ = seedLocation(t, orgID, "Inactive Loc "+suffix, "inactive-"+suffix, false)

	store := customdomains.NewStore(testPool)

	// Active slug should resolve.
	gotID, err := store.ResolveSlug(ctx, "active-"+suffix)
	if err != nil {
		t.Fatalf("ResolveSlug(active): %v", err)
	}
	if gotID != activeLocID {
		t.Errorf("ResolveSlug(active): want %s, got %s", activeLocID, gotID)
	}

	// Inactive slug must return ErrNotFound.
	if _, err := store.ResolveSlug(ctx, "inactive-"+suffix); !errors.Is(err, customdomains.ErrNotFound) {
		t.Errorf("ResolveSlug(inactive): want ErrNotFound, got %v", err)
	}

	// Unknown slug must return ErrNotFound.
	if _, err := store.ResolveSlug(ctx, "no-such-slug-"+suffix); !errors.Is(err, customdomains.ErrNotFound) {
		t.Errorf("ResolveSlug(unknown): want ErrNotFound, got %v", err)
	}
}

// TestIntegration_SoftDeleteAndReAdd is the key regression check for the
// partial-unique index from migration 047: removing a domain (soft-delete) and
// then re-adding the same hostname must succeed.
func TestIntegration_SoftDeleteAndReAdd(t *testing.T) {
	ctx := context.Background()
	suffix := randStr(8)
	orgID := seedOrg(t, "Readd Test Org "+suffix)
	locID := seedLocation(t, orgID, "Readd Loc "+suffix, "readd-"+suffix, true)

	store := customdomains.NewStore(testPool)
	hostname := "readd-" + suffix + ".example.com"

	// Add then remove.
	d, err := store.AddDomain(ctx, orgScope(orgID), locID, hostname)
	if err != nil {
		t.Fatalf("initial AddDomain: %v", err)
	}
	if err := store.RemoveDomain(ctx, d.ID, []string{locID}); err != nil {
		t.Fatalf("RemoveDomain: %v", err)
	}

	// Verify removed_at is set (GetDomain should return ErrNotFound after removal).
	if _, err := store.GetDomain(ctx, d.ID, []string{locID}); !errors.Is(err, customdomains.ErrNotFound) {
		t.Errorf("GetDomain after removal: want ErrNotFound, got %v", err)
	}

	// Re-add must succeed — the partial unique index ignores soft-deleted rows.
	d2, err := store.AddDomain(ctx, orgScope(orgID), locID, hostname)
	if err != nil {
		t.Fatalf("re-AddDomain after soft-delete: %v (regression: partial unique index from mig 047 not working)", err)
	}
	if d2.ID == d.ID {
		t.Error("re-added domain should have a new ID")
	}
	if d2.VerificationToken == "" {
		t.Error("re-added domain: verification_token is empty")
	}
}

// TestIntegration_RLSIsolation verifies that a domain visible under org-A's
// scope is NOT visible via ListByLocation under org-B's scope.
func TestIntegration_RLSIsolation(t *testing.T) {
	ctx := context.Background()
	sfxA := randStr(8)
	sfxB := randStr(8)

	orgA := seedOrg(t, "RLS Org A "+sfxA)
	orgB := seedOrg(t, "RLS Org B "+sfxB)
	locA := seedLocation(t, orgA, "Loc A "+sfxA, "loc-a-"+sfxA, true)
	locB := seedLocation(t, orgB, "Loc B "+sfxB, "loc-b-"+sfxB, true)

	store := customdomains.NewStore(testPool)

	// Add a domain under org-A / loc-A.
	hostnameA := "rls-a-" + sfxA + ".example.com"
	domA, err := store.AddDomain(ctx, orgScope(orgA), locA, hostnameA)
	if err != nil {
		t.Fatalf("AddDomain orgA: %v", err)
	}

	// Add a domain under org-B / loc-B (just to ensure org-B has rows).
	hostnameB := "rls-b-" + sfxB + ".example.com"
	if _, err := store.AddDomain(ctx, orgScope(orgB), locB, hostnameB); err != nil {
		t.Fatalf("AddDomain orgB: %v", err)
	}

	// org-B's scope must NOT see org-A's domain.
	listUnderB, err := store.ListByLocation(ctx, orgScope(orgB), locA)
	if err != nil {
		t.Fatalf("ListByLocation(orgB scope, locA): %v", err)
	}
	for _, d := range listUnderB {
		if d.ID == domA.ID {
			t.Errorf("RLS isolation failure: org-B's scope can see domain %s belonging to org-A", domA.ID)
		}
	}
}
