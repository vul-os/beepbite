package e2e

// e2e_capabilities_test.go — capability enforcement
//
// Asserts:
//   - An owner member gets full capability set (can_void=true, can_comp=true,
//     can_settle=true, can_view_reports=true, can_manage_menu=true, ...) via
//     the default_member_capabilities trigger (migration 019).
//   - A staff-role member with empty capabilities has NO capabilities set.
//   - auth.Capabilities(ctx) returns the expected keys for owner scope.
//   - When hasCapability is simulated for a staff member with empty caps,
//     can_void / can_comp / can_settle all return false.

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/beepbite/backend/internal/auth"
)

func TestCapabilities_Owner_HasFullCaps(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	_ = ctx
	suffix := randStr(6)

	orgID := seedOrg(t, pool, "Caps E2E Org "+suffix)
	userID := seedAuthUser(t, pool, "caps_owner_"+suffix+"@example.com")

	// Insert owner member — trigger should auto-fill capabilities.
	memberID := seedMember(t, pool, orgID, userID, "owner")
	if memberID == "" {
		t.Fatal("seedMember returned empty id")
	}

	// Read back the capabilities column via service-role.
	var capsJSON []byte
	svcQueryRow(t, pool, &capsJSON,
		`SELECT capabilities FROM organization_members WHERE id = $1`, memberID)

	var caps map[string]bool
	if err := json.Unmarshal(capsJSON, &caps); err != nil {
		t.Fatalf("unmarshal capabilities: %v", err)
	}

	requiredCaps := []string{
		"can_void", "can_comp", "can_settle",
		"can_view_reports", "can_manage_menu", "can_pos",
		"can_refund", "can_manage_inventory",
	}
	for _, name := range requiredCaps {
		if !caps[name] {
			t.Errorf("owner capabilities missing or false: %q; got %v", name, caps)
		}
	}
}

func TestCapabilities_Staff_EmptyCaps_DeniedVoidCompSettle(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	_ = ctx
	suffix := randStr(6)

	orgID := seedOrg(t, pool, "Caps Staff E2E "+suffix)
	userID := seedAuthUser(t, pool, "caps_staff_"+suffix+"@example.com")

	// Insert staff-role member — trigger leaves capabilities empty (role='staff').
	memberID := seedMember(t, pool, orgID, userID, "staff")
	if memberID == "" {
		t.Fatal("seedMember returned empty id")
	}

	var capsJSON []byte
	svcQueryRow(t, pool, &capsJSON,
		`SELECT COALESCE(capabilities, '{}'::jsonb) FROM organization_members WHERE id = $1`, memberID)

	var caps map[string]bool
	if err := json.Unmarshal(capsJSON, &caps); err != nil {
		t.Fatalf("unmarshal capabilities: %v", err)
	}

	// Staff with no explicit grants must lack these sensitive capabilities.
	deniedCaps := []string{"can_void", "can_comp", "can_settle"}
	for _, name := range deniedCaps {
		if caps[name] {
			t.Errorf("staff member should NOT have capability %q, but does", name)
		}
	}

	// Simulate auth.Capabilities(ctx) for the staff member: inject an OrgScope
	// with the raw capability bytes from the DB and verify the helper returns
	// none of the denied caps.
	scope := auth.OrgScope{
		UserID: userID,
		Memberships: []auth.Membership{
			{OrgID: orgID, Role: "staff", Capabilities: capsJSON},
		},
	}
	scopeCtx := auth.ContextWithOrgScope(context.Background(), scope)
	authCaps := auth.Capabilities(scopeCtx)

	capSet := make(map[string]bool, len(authCaps))
	for _, c := range authCaps {
		capSet[c] = true
	}
	for _, name := range deniedCaps {
		if capSet[name] {
			t.Errorf("auth.Capabilities returned denied cap %q for staff member", name)
		}
	}
}

func TestCapabilities_Owner_AuthCapabilities_IncludesAll(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	_ = ctx
	suffix := randStr(6)

	orgID := seedOrg(t, pool, "Caps Owner Auth "+suffix)
	userID := seedAuthUser(t, pool, "caps_owner2_"+suffix+"@example.com")
	memberID := seedMember(t, pool, orgID, userID, "owner")

	var capsJSON []byte
	svcQueryRow(t, pool, &capsJSON,
		`SELECT capabilities FROM organization_members WHERE id = $1`, memberID)

	// Simulate what RequireOrgScope would inject into context.
	scope := auth.OrgScope{
		UserID: userID,
		Memberships: []auth.Membership{
			{OrgID: orgID, Role: "owner", Capabilities: capsJSON},
		},
	}
	scopeCtx := auth.ContextWithOrgScope(context.Background(), scope)
	authCaps := auth.Capabilities(scopeCtx)

	capSet := make(map[string]bool, len(authCaps))
	for _, c := range authCaps {
		capSet[c] = true
	}

	wantCaps := []string{"can_void", "can_comp", "can_settle"}
	for _, name := range wantCaps {
		if !capSet[name] {
			t.Errorf("auth.Capabilities for owner missing %q; got %v", name, authCaps)
		}
	}
}
