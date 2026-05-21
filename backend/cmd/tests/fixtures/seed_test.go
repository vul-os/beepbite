package fixtures_test

import (
	"context"
	"os"
	"testing"

	"github.com/beepbite/backend/cmd/tests/fixtures"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestSeedTwoOrgs verifies that SeedTwoOrgs creates the expected rows and that
// Cleanup removes them without leaving orphans.
// The test is skipped unless TEST_DATABASE_URL is set.
func TestSeedTwoOrgs(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping fixtures integration test")
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	result, err := fixtures.SeedTwoOrgs(ctx, pool)
	if err != nil {
		t.Fatalf("SeedTwoOrgs: %v", err)
	}

	// ---- assert expected IDs are non-empty ----
	checks := []struct {
		label string
		val   string
	}{
		{"OrgAID", result.OrgAID},
		{"OrgAOwnerID", result.OrgAOwnerID},
		{"OrgALocID", result.OrgALocID},
		{"OrgAMemberID", result.OrgAMemberID},
		{"OrgBID", result.OrgBID},
		{"OrgBOwnerID", result.OrgBOwnerID},
		{"OrgBLocID", result.OrgBLocID},
		{"OrgBMemberID", result.OrgBMemberID},
	}
	for _, c := range checks {
		if c.val == "" {
			t.Errorf("%s is empty", c.label)
		}
	}

	if len(result.OrgACatIDs) != 2 {
		t.Errorf("expected 2 OrgA categories, got %d", len(result.OrgACatIDs))
	}
	if len(result.OrgAItemIDs) != 3 {
		t.Errorf("expected 3 OrgA items, got %d", len(result.OrgAItemIDs))
	}
	if len(result.OrgAStationIDs) != 2 {
		t.Errorf("expected 2 OrgA stations, got %d", len(result.OrgAStationIDs))
	}
	if len(result.OrgBCatIDs) != 2 {
		t.Errorf("expected 2 OrgB categories, got %d", len(result.OrgBCatIDs))
	}
	if len(result.OrgBItemIDs) != 3 {
		t.Errorf("expected 3 OrgB items, got %d", len(result.OrgBItemIDs))
	}
	if len(result.OrgBStationIDs) != 2 {
		t.Errorf("expected 2 OrgB stations, got %d", len(result.OrgBStationIDs))
	}
	if len(result.ExtraStaffIDs) != 2 {
		t.Errorf("expected 2 staff (one per org), got %d", len(result.ExtraStaffIDs))
	}

	// Orgs must be distinct.
	if result.OrgAID == result.OrgBID {
		t.Error("OrgAID == OrgBID; cross-tenant isolation would be meaningless")
	}

	// ---- count rows before cleanup ----
	countOrgs := func() int {
		row := pool.QueryRow(ctx,
			`SELECT count(*) FROM organizations WHERE id IN ($1, $2)`,
			result.OrgAID, result.OrgBID,
		)
		var n int
		_ = row.Scan(&n)
		return n
	}
	if n := countOrgs(); n != 2 {
		t.Errorf("expected 2 org rows before cleanup, got %d", n)
	}

	// ---- cleanup ----
	if err := result.Cleanup(ctx, pool); err != nil {
		t.Fatalf("Cleanup: %v", err)
	}

	// ---- assert rows are gone ----
	if n := countOrgs(); n != 0 {
		t.Errorf("expected 0 org rows after cleanup, got %d", n)
	}

	// auth_users should be gone too (cascaded or explicitly deleted).
	row := pool.QueryRow(ctx,
		`SELECT count(*) FROM auth_users WHERE id IN ($1, $2)`,
		result.OrgAOwnerID, result.OrgBOwnerID,
	)
	var userCount int
	_ = row.Scan(&userCount)
	if userCount != 0 {
		t.Errorf("expected 0 auth_user rows after cleanup, got %d", userCount)
	}
}
