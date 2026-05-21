// Package e2e contains end-to-end scenario tests that drive the store/handler
// layer directly against a real Postgres instance.
//
// # How to run
//
//	cd backend && TEST_DATABASE_URL="postgres://..." go test ./cmd/tests/e2e/... -v
//
// All tests skip gracefully when TEST_DATABASE_URL is unset or the DB is
// unreachable, so they are safe to include in CI pipelines that don't provision
// a test database.
//
// # RLS bypass
//
// Seed helpers run their INSERTs inside a db.Scoped(ServiceRoleScope()) call so
// that RLS policies (which require app.is_service_role = 'true') are satisfied.
// This matches how background jobs and the migration runner write data.
package e2e

import (
	"context"
	"fmt"
	"math/rand"
	"os"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func init() {
	rand.Seed(time.Now().UnixNano())
}

// openPool returns a pgxpool.Pool connected to TEST_DATABASE_URL, or calls
// t.Skip when the env var is absent or the ping fails.
//
// The pool is configured with BeforeAcquire that sets app.is_service_role='true'
// so that all queries run with full RLS bypass — matching how the production
// store methods are called after RequireOrgScope has set session vars.
func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping e2e test")
	}
	ctx := context.Background()

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Skipf("testenv unavailable: parse config: %v", err)
	}

	// Inject service-role session vars on every acquired connection so that
	// RLS policies (which call is_service_role()) allow unrestricted access.
	// This mirrors what db.Scoped(ServiceRoleScope()) does inside a transaction,
	// but at the connection level for store methods that manage their own tx.
	cfg.BeforeAcquire = func(ctx context.Context, conn *pgx.Conn) bool {
		_, err := conn.Exec(ctx, `SELECT set_config('app.is_service_role','true',false)`)
		return err == nil
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Skipf("testenv unavailable: pgxpool.New: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("testenv unavailable: ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// randStr returns a short random lowercase string for unique test identifiers.
func randStr(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}

// svcExec runs query inside a service-role transaction to bypass RLS.
func svcExec(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, query, args...)
		return err
	})
	if err != nil {
		t.Fatalf("svcExec: %v\nquery: %s\nargs: %v", err, query, args)
	}
}

// svcQueryRow runs a QueryRow in a service-role transaction and scans dest.
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

// zaRegionID returns the UUID of the 'ZA' region required for location inserts.
// Skips the test when the seed row is missing (migrations not applied).
func zaRegionID(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	ctx := context.Background()
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM regions WHERE code = 'ZA' LIMIT 1`).Scan(&id)
	})
	if err != nil {
		t.Skipf("ZA region not found in DB (migrations not applied?): %v", err)
	}
	return id
}

// seedOrg inserts a test organisation and returns its UUID.
// Registers a t.Cleanup that deletes the org (cascades to locations etc.).
func seedOrg(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, name)
	t.Cleanup(func() {
		ctx := context.Background()
		_ = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// seedLocation inserts a test location under orgID and returns its UUID.
// on_delivery_payment_methods is seeded with ["cash"] so that
// pos.Store.CreateOrder can fall back to on-delivery when no payment
// credential is configured (avoiding ErrNoPaymentMethodAvailable).
func seedLocation(t *testing.T, pool *pgxpool.Pool, orgID, name, regionID string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO locations (organization_id, name, region_id, on_delivery_payment_methods)
		 VALUES ($1, $2, $3, ARRAY['cash']::text[]) RETURNING id`, orgID, name, regionID)
	return id
}

// seedMember inserts an organization_members row and returns the row id.
// The trigger default_member_capabilities auto-populates capabilities for
// owner/manager/admin/kitchen/pos/driver roles.
func seedMember(t *testing.T, pool *pgxpool.Pool, orgID, profileID, role string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO organization_members (organization_id, profile_id, role)
		 VALUES ($1, $2, $3) RETURNING id`, orgID, profileID, role)
	return id
}

// seedAuthUser inserts a minimal auth_users row and returns its UUID.
func seedAuthUser(t *testing.T, pool *pgxpool.Pool, email string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO auth_users (email, password_hash)
		 VALUES ($1, 'x') RETURNING id`, email)
	t.Cleanup(func() {
		ctx := context.Background()
		_ = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM auth_users WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// seedStaff inserts a staff row and returns its UUID.
func seedStaff(t *testing.T, pool *pgxpool.Pool, locID, username, role, passwordHash string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO staff (location_id, username, first_name, last_name, role, password_hash, is_active)
		 VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
		locID, username, "Test", "Staff", role, passwordHash)
	return id
}

// seedCategory inserts a menu category and returns its UUID.
// organization_id is resolved automatically from the location.
func seedCategory(t *testing.T, pool *pgxpool.Pool, locID, name string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO categories (location_id, organization_id, name)
		SELECT $1, organization_id, $2 FROM locations WHERE id = $1
		RETURNING id`,
		locID, name)
	return id
}

// seedItem inserts a menu item and returns its UUID.
func seedItem(t *testing.T, pool *pgxpool.Pool, locID, catID, name string, price float64) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO items (location_id, category_id, name, price) VALUES ($1, $2, $3, $4) RETURNING id`,
		locID, catID, name, price)
	return id
}

// seedKitchenStation inserts a kitchen_stations row and returns its UUID.
func seedKitchenStation(t *testing.T, pool *pgxpool.Pool, locID, name string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id,
		`INSERT INTO kitchen_stations (location_id, name, station_type) VALUES ($1, $2, 'prep') RETURNING id`,
		locID, name)
	return id
}

// seedItemStationRouting links item → station (for KDS fanout).
func seedItemStationRouting(t *testing.T, pool *pgxpool.Pool, itemID, stationID string) {
	t.Helper()
	svcExec(t, pool,
		`INSERT INTO item_station_routing (item_id, station_id, is_primary) VALUES ($1, $2, true)
		 ON CONFLICT (item_id, station_id) DO NOTHING`, itemID, stationID)
}

// rowCount returns how many rows match the given WHERE clause, using
// a service-role transaction to bypass RLS.
func rowCount(t *testing.T, pool *pgxpool.Pool, table, where string, args ...any) int {
	t.Helper()
	var n int
	q := fmt.Sprintf(`SELECT COUNT(*) FROM %s WHERE %s`, table, where)
	ctx := context.Background()
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, q, args...).Scan(&n)
	})
	if err != nil {
		t.Fatalf("rowCount(%s WHERE %s): %v", table, where, err)
	}
	return n
}

// svcInsert runs an INSERT ... RETURNING id as service role and returns the id.
func svcInsert(t *testing.T, pool *pgxpool.Pool, query string, args ...any) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, query, args...)
	return id
}
