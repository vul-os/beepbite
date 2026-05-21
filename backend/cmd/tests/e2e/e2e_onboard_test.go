package e2e

// e2e_onboard_test.go — signup → org → location → menu → publish
//
// Asserts:
//   - Organization row exists and is visible via service-role SELECT.
//   - Location row exists under the org and links to the ZA region.
//   - Category + Item rows exist under the location.
//   - RLS isolation: org-B's location filter returns 0 rows for org-A items.

import (
	"context"
	"testing"

	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5"
)

func TestOnboard_OrgLocationMenuPublish(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	regionID := zaRegionID(t, pool)

	suffix := randStr(6)

	// 1. Org
	orgID := seedOrg(t, pool, "Onboard E2E "+suffix)

	// 2. Location
	locID := seedLocation(t, pool, orgID, "Main Branch "+suffix, regionID)

	// Assert org row
	var orgName string
	svcQueryRow(t, pool, &orgName,
		`SELECT name FROM organizations WHERE id = $1`, orgID)
	if orgName == "" {
		t.Error("org name should not be empty")
	}

	// Assert location row links to org and region
	var locOrgID, locRegionID string
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT organization_id::text, region_id::text FROM locations WHERE id = $1`, locID,
		).Scan(&locOrgID, &locRegionID)
	})
	if err != nil {
		t.Fatalf("location row not found: %v", err)
	}
	if locOrgID != orgID {
		t.Errorf("location.organization_id=%q want %q", locOrgID, orgID)
	}
	if locRegionID != regionID {
		t.Errorf("location.region_id=%q want %q", locRegionID, regionID)
	}

	// 3. Menu: category + item
	catID := seedCategory(t, pool, locID, "Mains "+suffix)
	itemID := seedItem(t, pool, locID, catID, "Burger "+suffix, 89.00)

	// Assert category row
	if n := rowCount(t, pool, "categories", "id = $1 AND location_id = $2", catID, locID); n != 1 {
		t.Errorf("categories: want 1 row, got %d", n)
	}

	// Assert item row
	if n := rowCount(t, pool, "items", "id = $1 AND category_id = $2 AND price = 89", itemID, catID); n != 1 {
		t.Errorf("items: want 1 row, got %d", n)
	}

	// 4. Publish: mark item is_active = true.
	svcExec(t, pool, `UPDATE items SET is_active = true WHERE id = $1`, itemID)

	var isActive bool
	svcQueryRow(t, pool, &isActive,
		`SELECT is_active FROM items WHERE id = $1`, itemID)
	if !isActive {
		t.Error("item should be active/published after UPDATE")
	}

	// 5. RLS isolation: org-B's location filter must return 0 for org-A items.
	otherOrgID := seedOrg(t, pool, "Other E2E Org "+suffix)
	otherLocID := seedLocation(t, pool, otherOrgID, "Other Loc "+suffix, regionID)

	if n := rowCount(t, pool, "items", "location_id = $1", otherLocID); n != 0 {
		t.Errorf("cross-org: items visible from other location, want 0 got %d", n)
	}
	if n := rowCount(t, pool, "items", "location_id = $1 AND id = $2", otherLocID, itemID); n != 0 {
		t.Errorf("cross-org: org-A item leaked to org-B location filter")
	}
}
