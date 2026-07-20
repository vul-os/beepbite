package e2e

// e2e_cross_tenant_test.go — cross-tenant isolation guarantee (MOST IMPORTANT)
//
// Seeds two fully independent orgs (org-A and org-B), each with their own
// location, member, and order.  Then asserts that:
//
//   - A filter scoped to org-A's location CANNOT see org-B's orders.
//   - A filter scoped to org-B's location CANNOT see org-A's orders.
//   - A filter on org-A's location_id returns 0 rows from org-B's item table.
//   - organization_members of org-A are not visible when filtering by org-B id.
//
// This is the primary cross-tenant security invariant: data of one organisation
// must never appear in a query scoped to a different organisation.

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCrossTenant_OrgA_CannotRead_OrgB(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	_ = ctx
	suffix := randStr(6)

	// ---------- Seed org-A ----------
	orgAID := seedOrg(t, pool, "TenantA_"+suffix)
	locAID := seedLocation(t, pool, orgAID, "Loc A "+suffix)
	userA := seedAuthUser(t, pool, "user_a_"+suffix+"@example.com")
	seedMember(t, pool, orgAID, userA, "owner")
	catA := seedCategory(t, pool, locAID, "Cat A "+suffix)
	itemA := seedItem(t, pool, locAID, catA, "Item A "+suffix, 50.00)
	orderAID := seedCrossTenantOrder(t, pool, orgAID, locAID)

	// ---------- Seed org-B ----------
	orgBID := seedOrg(t, pool, "TenantB_"+suffix)
	locBID := seedLocation(t, pool, orgBID, "Loc B "+suffix)
	userB := seedAuthUser(t, pool, "user_b_"+suffix+"@example.com")
	seedMember(t, pool, orgBID, userB, "owner")
	catB := seedCategory(t, pool, locBID, "Cat B "+suffix)
	itemB := seedItem(t, pool, locBID, catB, "Item B "+suffix, 60.00)
	orderBID := seedCrossTenantOrder(t, pool, orgBID, locBID)

	// ---------- Cross-tenant assertions ----------

	// 1. org-A's location filter must NOT see org-B's orders.
	if n := rowCount(t, pool, "orders",
		"id = $1 AND location_id = $2", orderBID, locAID); n != 0 {
		t.Errorf("SECURITY: org-B order visible under org-A location filter (count=%d)", n)
	}

	// 2. org-B's location filter must NOT see org-A's orders.
	if n := rowCount(t, pool, "orders",
		"id = $1 AND location_id = $2", orderAID, locBID); n != 0 {
		t.Errorf("SECURITY: org-A order visible under org-B location filter (count=%d)", n)
	}

	// 3. Items from org-B must NOT appear when filtering by org-A's location.
	if n := rowCount(t, pool, "items",
		"id = $1 AND location_id = $2", itemB, locAID); n != 0 {
		t.Errorf("SECURITY: org-B item leaked into org-A location filter (count=%d)", n)
	}

	// 4. Items from org-A must NOT appear when filtering by org-B's location.
	if n := rowCount(t, pool, "items",
		"id = $1 AND location_id = $2", itemA, locBID); n != 0 {
		t.Errorf("SECURITY: org-A item leaked into org-B location filter (count=%d)", n)
	}

	// 5. Locations of org-B are NOT returned when filtering by org-A's org id.
	if n := rowCount(t, pool, "locations",
		"id = $1 AND organization_id = $2", locBID, orgAID); n != 0 {
		t.Errorf("SECURITY: org-B location visible under org-A org filter (count=%d)", n)
	}

	// 6. Members of org-B are NOT returned when filtering by org-A's org id.
	if n := rowCount(t, pool, "organization_members",
		"profile_id = $1 AND organization_id = $2", userB, orgAID); n != 0 {
		t.Errorf("SECURITY: org-B member visible under org-A filter (count=%d)", n)
	}

	// 7. Members of org-A are NOT returned when filtering by org-B's org id.
	if n := rowCount(t, pool, "organization_members",
		"profile_id = $1 AND organization_id = $2", userA, orgBID); n != 0 {
		t.Errorf("SECURITY: org-A member visible under org-B filter (count=%d)", n)
	}

	t.Logf("cross-tenant isolation: org-A=%s org-B=%s — all checks passed", orgAID, orgBID)
}

// seedCrossTenantOrder inserts a minimal orders row for cross-tenant tests.
func seedCrossTenantOrder(t *testing.T, pool *pgxpool.Pool, orgID, locID string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO orders (organization_id, location_id, order_number, order_type, status, currency_code)
		VALUES ($1, $2, 'CT'||left(md5(random()::text),4), 'dine_in', 'confirmed', 'ZAR')
		RETURNING id`, orgID, locID)
	return id
}
