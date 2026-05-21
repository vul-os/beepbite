// Package fixtures provides typed seed helpers for integration tests and
// the HTTP smoke runner. All helpers use db.ServiceRoleScope() to bypass RLS
// so they can insert across tenant boundaries during test setup.
//
// Every helper is idempotent-friendly: it creates rows with gen_random_uuid()
// defaults and returns the new IDs. Cleanup cascades via the org DELETE.
package fixtures

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// ---------------------------------------------------------------------------
// SeedResult — bundle of all IDs created by SeedTwoOrgs
// ---------------------------------------------------------------------------

// SeedResult holds identifiers created by the seed helpers and provides
// CleanupResult to delete both orgs and their auth_users.
type SeedResult struct {
	// Org A
	OrgAID         string
	OrgAOwnerID    string // auth_users.id
	OrgALocID      string
	OrgAMemberID   string // org owner's organization_members.id
	OrgACatIDs     []string
	OrgAItemIDs    []string
	OrgAStationIDs []string

	// Org B
	OrgBID         string
	OrgBOwnerID    string
	OrgBLocID      string
	OrgBMemberID   string
	OrgBCatIDs     []string
	OrgBItemIDs    []string
	OrgBStationIDs []string

	// Extra staff seeded on both orgs (may be empty)
	ExtraStaffIDs []string
}

// Cleanup deletes both orgs (which cascades to all child rows) and removes
// the two owner auth_user rows. Safe to call multiple times.
func (s *SeedResult) Cleanup(ctx context.Context, pool *pgxpool.Pool) error {
	return CleanupResult(ctx, pool, s)
}

// CleanupResult removes all data created by a seed run, cascading from orgs.
func CleanupResult(ctx context.Context, pool *pgxpool.Pool, r *SeedResult) error {
	scope := db.ServiceRoleScope()

	orgIDs := []string{}
	if r.OrgAID != "" {
		orgIDs = append(orgIDs, r.OrgAID)
	}
	if r.OrgBID != "" {
		orgIDs = append(orgIDs, r.OrgBID)
	}
	userIDs := []string{}
	if r.OrgAOwnerID != "" {
		userIDs = append(userIDs, r.OrgAOwnerID)
	}
	if r.OrgBOwnerID != "" {
		userIDs = append(userIDs, r.OrgBOwnerID)
	}

	return db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		for _, orgID := range orgIDs {
			if _, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, orgID); err != nil {
				return fmt.Errorf("cleanup org %s: %w", orgID, err)
			}
		}
		for _, uid := range userIDs {
			if _, err := tx.Exec(ctx, `DELETE FROM auth_users WHERE id = $1`, uid); err != nil {
				return fmt.Errorf("cleanup auth_user %s: %w", uid, err)
			}
		}
		return nil
	})
}

// ---------------------------------------------------------------------------
// SeedOrg — auth_user + profile + org + owner membership
// ---------------------------------------------------------------------------

// SeedOrg creates a minimal tenant: one auth_user (the org owner), a profile,
// an organization, and an owner organization_members row with full capabilities.
// Returns (orgID, ownerUserID, error).
func SeedOrg(ctx context.Context, pool *pgxpool.Pool, name string) (orgID, ownerUserID string, err error) {
	scope := db.ServiceRoleScope()

	email := fmt.Sprintf("owner-%s-%d@fixtures.test", sanitizeSlug(name), time.Now().UnixNano())
	hashBytes, herr := bcrypt.GenerateFromPassword([]byte("fixture-pass-123!"), bcrypt.MinCost)
	if herr != nil {
		return "", "", fmt.Errorf("SeedOrg bcrypt: %w", herr)
	}
	hash := string(hashBytes)

	fullCaps := `{"can_pos":true,"can_kitchen":true,"can_void":true,"can_comp":true,"can_settle":true,"can_view_reports":true,"can_drive":true}`

	err = db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		// 1. auth_user
		if err2 := tx.QueryRow(ctx,
			`INSERT INTO auth_users (email, password_hash, email_verified)
			 VALUES ($1, $2, true) RETURNING id`,
			email, hash,
		).Scan(&ownerUserID); err2 != nil {
			return fmt.Errorf("insert auth_user: %w", err2)
		}

		// 2. profile
		if _, err2 := tx.Exec(ctx,
			`INSERT INTO profiles (id, full_name, email) VALUES ($1, $2, $3)`,
			ownerUserID, name+" Owner", email,
		); err2 != nil {
			return fmt.Errorf("insert profile: %w", err2)
		}

		// 3. organization
		if err2 := tx.QueryRow(ctx,
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			name,
		).Scan(&orgID); err2 != nil {
			return fmt.Errorf("insert organization: %w", err2)
		}

		// 4. owner membership with full caps
		if _, err2 := tx.Exec(ctx,
			`INSERT INTO organization_members (organization_id, profile_id, role, capabilities)
			 VALUES ($1, $2, 'owner', $3::jsonb)`,
			orgID, ownerUserID, fullCaps,
		); err2 != nil {
			return fmt.Errorf("insert org member: %w", err2)
		}

		return nil
	})
	if err != nil {
		return "", "", err
	}
	return orgID, ownerUserID, nil
}

// ---------------------------------------------------------------------------
// SeedLocation
// ---------------------------------------------------------------------------

// SeedLocation creates a location for the given org in the ZA region.
// Returns locationID.
func SeedLocation(ctx context.Context, pool *pgxpool.Pool, orgID, name, slug string) (locationID string, err error) {
	scope := db.ServiceRoleScope()

	err = db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		// Resolve ZA region ID.
		var regionID string
		if err2 := tx.QueryRow(ctx, `SELECT id FROM regions WHERE code = 'ZA' LIMIT 1`).Scan(&regionID); err2 != nil {
			return fmt.Errorf("resolve ZA region: %w", err2)
		}

		if err2 := tx.QueryRow(ctx,
			`INSERT INTO locations (organization_id, region_id, name, slug, city, country, currency_code)
			 VALUES ($1, $2, $3, $4, 'Johannesburg', 'ZA', 'ZAR')
			 RETURNING id`,
			orgID, regionID, name, slug,
		).Scan(&locationID); err2 != nil {
			return fmt.Errorf("insert location: %w", err2)
		}
		return nil
	})
	return locationID, err
}

// ---------------------------------------------------------------------------
// SeedMember
// ---------------------------------------------------------------------------

// SeedMember adds a new auth_user + profile + organization_members row to an
// existing org. caps is a list of capability keys (e.g. "can_pos","can_void").
// Returns (userID, memberID, error).
func SeedMember(ctx context.Context, pool *pgxpool.Pool, orgID, role string, caps []string) (userID, memberID string, err error) {
	scope := db.ServiceRoleScope()

	email := fmt.Sprintf("member-%s-%d@fixtures.test", role, time.Now().UnixNano())
	hashBytes, herr := bcrypt.GenerateFromPassword([]byte("fixture-pass-123!"), bcrypt.MinCost)
	if herr != nil {
		return "", "", fmt.Errorf("SeedMember bcrypt: %w", herr)
	}
	hash := string(hashBytes)

	capsJSON := buildCapsJSON(caps)

	err = db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		if err2 := tx.QueryRow(ctx,
			`INSERT INTO auth_users (email, password_hash, email_verified) VALUES ($1, $2, true) RETURNING id`,
			email, hash,
		).Scan(&userID); err2 != nil {
			return fmt.Errorf("insert auth_user: %w", err2)
		}
		if _, err2 := tx.Exec(ctx,
			`INSERT INTO profiles (id, full_name, email) VALUES ($1, $2, $3)`,
			userID, role+" Member", email,
		); err2 != nil {
			return fmt.Errorf("insert profile: %w", err2)
		}
		if err2 := tx.QueryRow(ctx,
			`INSERT INTO organization_members (organization_id, profile_id, role, capabilities)
			 VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
			orgID, userID, role, capsJSON,
		).Scan(&memberID); err2 != nil {
			return fmt.Errorf("insert org member: %w", err2)
		}
		return nil
	})
	return userID, memberID, err
}

// ---------------------------------------------------------------------------
// SeedStaff
// ---------------------------------------------------------------------------

// SeedStaff creates a staff row with a bcrypt-hashed PIN (matching how
// staffauth stores PINs). The password_hash is separately bcrypted from the
// username to satisfy the per-location uniqueness constraint. Returns staffID.
func SeedStaff(ctx context.Context, pool *pgxpool.Pool, locationID, displayName, username, pin string) (staffID string, err error) {
	scope := db.ServiceRoleScope()

	pinHashBytes, herr := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.MinCost)
	if herr != nil {
		return "", fmt.Errorf("SeedStaff bcrypt pin: %w", herr)
	}
	pinHash := string(pinHashBytes)

	// password_hash must be unique per (location_id, password_hash). Include a
	// nano-timestamp to avoid collisions when seeding multiple staff rows.
	pwHashBytes, herr := bcrypt.GenerateFromPassword(
		[]byte(fmt.Sprintf("staff-pw-%s-%d", username, time.Now().UnixNano())),
		bcrypt.MinCost,
	)
	if herr != nil {
		return "", fmt.Errorf("SeedStaff bcrypt pw: %w", herr)
	}
	pwHash := string(pwHashBytes)

	err = db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		if err2 := tx.QueryRow(ctx,
			`INSERT INTO staff
			   (location_id, first_name, last_name, display_name, username,
			    role, pin_hash, password_hash, is_active)
			 VALUES ($1, $2, $3, $4, $5, 'cashier', $6, $7, true)
			 RETURNING id`,
			locationID,
			displayName, "Fixture",
			displayName,
			username,
			pinHash, pwHash,
		).Scan(&staffID); err2 != nil {
			return fmt.Errorf("insert staff: %w", err2)
		}
		return nil
	})
	return staffID, err
}

// ---------------------------------------------------------------------------
// SeedMenu
// ---------------------------------------------------------------------------

// SeedMenu creates two categories and three items for the given location.
// Returns (categoryIDs, itemIDs, error).
func SeedMenu(ctx context.Context, pool *pgxpool.Pool, locationID string) (categoryIDs, itemIDs []string, err error) {
	scope := db.ServiceRoleScope()

	// Resolve the org for categories.organization_id (required NOT NULL column).
	var orgID string
	if err = db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT organization_id FROM locations WHERE id = $1`,
			locationID,
		).Scan(&orgID)
	}); err != nil {
		return nil, nil, fmt.Errorf("SeedMenu: resolve org: %w", err)
	}

	err = db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		catNames := []string{"Mains", "Drinks"}
		for i, name := range catNames {
			var cid string
			if err2 := tx.QueryRow(ctx,
				`INSERT INTO categories (location_id, organization_id, name, sort_order)
				 VALUES ($1, $2, $3, $4) RETURNING id`,
				locationID, orgID, name, i,
			).Scan(&cid); err2 != nil {
				return fmt.Errorf("insert category %s: %w", name, err2)
			}
			categoryIDs = append(categoryIDs, cid)
		}

		type itemSpec struct {
			catIdx int
			name   string
			price  string
		}
		items := []itemSpec{
			{0, "Burger", "89.00"},
			{0, "Chips", "35.00"},
			{1, "Coke", "20.00"},
		}
		for _, it := range items {
			var iid string
			if err2 := tx.QueryRow(ctx,
				`INSERT INTO items (location_id, category_id, name, price)
				 VALUES ($1, $2, $3, $4) RETURNING id`,
				locationID, categoryIDs[it.catIdx], it.name, it.price,
			).Scan(&iid); err2 != nil {
				return fmt.Errorf("insert item %s: %w", it.name, err2)
			}
			itemIDs = append(itemIDs, iid)
		}
		return nil
	})
	return categoryIDs, itemIDs, err
}

// ---------------------------------------------------------------------------
// SeedKitchen
// ---------------------------------------------------------------------------

// SeedKitchen creates two kitchen stations (prep + bar) for the location.
// Returns stationIDs.
func SeedKitchen(ctx context.Context, pool *pgxpool.Pool, locationID string) (stationIDs []string, err error) {
	scope := db.ServiceRoleScope()

	type stationSpec struct {
		name        string
		stationType string
	}
	stations := []stationSpec{
		{"Hot Kitchen", "prep"},
		{"Bar", "bar"},
	}

	err = db.Scoped(ctx, pool, scope, func(tx pgx.Tx) error {
		for i, s := range stations {
			var sid string
			if err2 := tx.QueryRow(ctx,
				`INSERT INTO kitchen_stations (location_id, name, station_type, sort_order)
				 VALUES ($1, $2, $3, $4) RETURNING id`,
				locationID, s.name, s.stationType, i,
			).Scan(&sid); err2 != nil {
				return fmt.Errorf("insert station %s: %w", s.name, err2)
			}
			stationIDs = append(stationIDs, sid)
		}
		return nil
	})
	return stationIDs, err
}

// ---------------------------------------------------------------------------
// SeedTwoOrgs — convenience helper for cross-tenant tests
// ---------------------------------------------------------------------------

// SeedTwoOrgs creates two fully seeded tenants (org A and org B), each with:
//   - owner auth_user + profile + org + membership
//   - one location (ZA region)
//   - one staff member with PIN
//   - a small menu (2 categories, 3 items)
//   - two kitchen stations
//
// Call result.Cleanup(ctx, pool) to delete everything created.
func SeedTwoOrgs(ctx context.Context, pool *pgxpool.Pool) (*SeedResult, error) {
	r := &SeedResult{}

	// --- Org A ---
	orgAID, ownerAID, err := SeedOrg(ctx, pool, "Fixture Org A")
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgA: %w", err)
	}
	r.OrgAID = orgAID
	r.OrgAOwnerID = ownerAID

	if err = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id FROM organization_members WHERE organization_id = $1 AND role = 'owner' LIMIT 1`,
			orgAID,
		).Scan(&r.OrgAMemberID)
	}); err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgA member: %w", err)
	}

	locAID, err := SeedLocation(ctx, pool, orgAID, "Org A Joburg", "org-a-joburg")
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgA location: %w", err)
	}
	r.OrgALocID = locAID

	catAIDs, itemAIDs, err := SeedMenu(ctx, pool, locAID)
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgA menu: %w", err)
	}
	r.OrgACatIDs = catAIDs
	r.OrgAItemIDs = itemAIDs

	stationAIDs, err := SeedKitchen(ctx, pool, locAID)
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgA kitchen: %w", err)
	}
	r.OrgAStationIDs = stationAIDs

	staffAID, err := SeedStaff(ctx, pool, locAID, "Alice Cashier", "alice", "1234")
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgA staff: %w", err)
	}
	r.ExtraStaffIDs = append(r.ExtraStaffIDs, staffAID)

	// --- Org B ---
	orgBID, ownerBID, err := SeedOrg(ctx, pool, "Fixture Org B")
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgB: %w", err)
	}
	r.OrgBID = orgBID
	r.OrgBOwnerID = ownerBID

	if err = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id FROM organization_members WHERE organization_id = $1 AND role = 'owner' LIMIT 1`,
			orgBID,
		).Scan(&r.OrgBMemberID)
	}); err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgB member: %w", err)
	}

	locBID, err := SeedLocation(ctx, pool, orgBID, "Org B Cape Town", "org-b-capetown")
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgB location: %w", err)
	}
	r.OrgBLocID = locBID

	catBIDs, itemBIDs, err := SeedMenu(ctx, pool, locBID)
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgB menu: %w", err)
	}
	r.OrgBCatIDs = catBIDs
	r.OrgBItemIDs = itemBIDs

	stationBIDs, err := SeedKitchen(ctx, pool, locBID)
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgB kitchen: %w", err)
	}
	r.OrgBStationIDs = stationBIDs

	staffBID, err := SeedStaff(ctx, pool, locBID, "Bob Manager", "bob", "5678")
	if err != nil {
		return nil, fmt.Errorf("SeedTwoOrgs OrgB staff: %w", err)
	}
	r.ExtraStaffIDs = append(r.ExtraStaffIDs, staffBID)

	return r, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// sanitizeSlug lowercases and replaces non-alphanumeric runes with '-'.
func sanitizeSlug(s string) string {
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		if r >= 'A' && r <= 'Z' {
			return r + 32
		}
		return '-'
	}, s)
}

// buildCapsJSON encodes a list of capability key names as a JSON object
// where every named key has value true.
// e.g. ["can_pos","can_void"] → {"can_pos":true,"can_void":true}
func buildCapsJSON(caps []string) string {
	if len(caps) == 0 {
		return "{}"
	}
	parts := make([]string, 0, len(caps))
	for _, c := range caps {
		parts = append(parts, fmt.Sprintf(`"%s":true`, c))
	}
	return "{" + strings.Join(parts, ",") + "}"
}
