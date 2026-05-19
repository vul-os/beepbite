package tables_test

// Integration tests for TableSession open/close lifecycle.
//
// Prerequisites:
//   - TEST_DATABASE_URL must point at a fully-migrated PostgreSQL instance.
//   - The test SKIPS automatically when the env var is absent.
//
// Run:
//
//	cd backend && TEST_DATABASE_URL="postgres://..." \
//	  go test ./internal/handlers/tables/... -run Session -v -count=1

import (
	"context"
	"os"
	"testing"

	"github.com/beepbite/backend/internal/handlers/tables"
	"github.com/jackc/pgx/v5/pgxpool"
)

func openTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping integration test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedLocation inserts an organization + location and returns the location ID.
// The caller is responsible for cleanup (deleting the org cascades everything).
func seedLocation(t *testing.T, ctx context.Context, pool *pgxpool.Pool, label string) (orgID, locID string) {
	t.Helper()
	if err := pool.QueryRow(ctx,
		`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, label+" Org",
	).Scan(&orgID); err != nil {
		t.Fatalf("insert org: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO locations (organization_id, name, region_id)
		VALUES ($1, $2, (SELECT id FROM regions WHERE code = 'ZA' LIMIT 1))
		RETURNING id`,
		orgID, label+" Loc",
	).Scan(&locID); err != nil {
		t.Fatalf("insert location: %v", err)
	}
	return orgID, locID
}

// seedTable inserts a table row and returns its ID.
func seedTable(t *testing.T, ctx context.Context, pool *pgxpool.Pool, locID, label string) string {
	t.Helper()
	var tableID string
	if err := pool.QueryRow(ctx,
		`INSERT INTO tables (location_id, label, capacity) VALUES ($1, $2, 4) RETURNING id`,
		locID, label,
	).Scan(&tableID); err != nil {
		t.Fatalf("insert table: %v", err)
	}
	return tableID
}

// seedStaff inserts a minimal staff row and returns its ID.
func seedStaff(t *testing.T, ctx context.Context, pool *pgxpool.Pool, locID, email string) string {
	t.Helper()
	var staffID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO staff (location_id, first_name, last_name, email, password_hash, role)
		VALUES ($1, 'Test', 'Staff', $2, 'x', 'cashier')
		RETURNING id`,
		locID, email,
	).Scan(&staffID); err != nil {
		t.Fatalf("insert staff: %v", err)
	}
	return staffID
}

// TestTableSession covers the four regression cases for the opened_by FK fix.
func TestTableSession(t *testing.T) {
	pool := openTestPool(t)
	ctx := context.Background()
	store := tables.NewStore(pool)

	t.Run("OpenedBy_empty_string_stores_NULL", func(t *testing.T) {
		orgID, locID := seedLocation(t, ctx, pool, "NullOpenedBy")
		t.Cleanup(func() {
			conn, _ := pool.Acquire(context.Background())
			if conn == nil {
				return
			}
			defer conn.Release()
			_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
		})
		tableID := seedTable(t, ctx, pool, locID, "T-NullBy")

		sess, err := store.OpenSession(ctx, tableID, locID, "" /*openedBy=empty*/, 2, "")
		if err != nil {
			t.Fatalf("OpenSession: %v", err)
		}
		if sess.OpenedBy != nil {
			t.Errorf("FAIL: expected OpenedBy=nil, got %q", *sess.OpenedBy)
		} else {
			t.Logf("PASS: opened_by is NULL (session id=%s)", sess.ID)
		}
	})

	t.Run("OpenedBy_valid_staff_id_stored", func(t *testing.T) {
		orgID, locID := seedLocation(t, ctx, pool, "ValidStaff")
		t.Cleanup(func() {
			conn, _ := pool.Acquire(context.Background())
			if conn == nil {
				return
			}
			defer conn.Release()
			_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
		})
		tableID := seedTable(t, ctx, pool, locID, "T-ValidStaff")
		staffID := seedStaff(t, ctx, pool, locID, "valid-staff@test.com")

		sess, err := store.OpenSession(ctx, tableID, locID, staffID, 3, "")
		if err != nil {
			t.Fatalf("OpenSession: %v", err)
		}
		if sess.OpenedBy == nil {
			t.Fatal("FAIL: expected OpenedBy to be set, got nil")
		}
		if *sess.OpenedBy != staffID {
			t.Errorf("FAIL: expected OpenedBy=%q, got %q", staffID, *sess.OpenedBy)
		} else {
			t.Logf("PASS: opened_by=%s stored correctly", *sess.OpenedBy)
		}
	})

	t.Run("OpenedBy_junk_UUID_returns_FK_error", func(t *testing.T) {
		orgID, locID := seedLocation(t, ctx, pool, "JunkUUID")
		t.Cleanup(func() {
			conn, _ := pool.Acquire(context.Background())
			if conn == nil {
				return
			}
			defer conn.Release()
			_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
		})
		tableID := seedTable(t, ctx, pool, locID, "T-JunkUUID")

		// A well-formed UUID that is NOT in the staff table — the FK must reject it.
		junkID := "00000000-dead-beef-cafe-000000000001"
		_, err := store.OpenSession(ctx, tableID, locID, junkID, 1, "")
		if err == nil {
			t.Fatal("FAIL: expected FK error for unknown opened_by UUID, got nil")
		}
		t.Logf("PASS: correctly rejected junk UUID — error: %v", err)
	})

	t.Run("CloseSession_sets_status_and_closed_at", func(t *testing.T) {
		orgID, locID := seedLocation(t, ctx, pool, "CloseSession")
		t.Cleanup(func() {
			conn, _ := pool.Acquire(context.Background())
			if conn == nil {
				return
			}
			defer conn.Release()
			_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
		})
		tableID := seedTable(t, ctx, pool, locID, "T-Close")

		sess, err := store.OpenSession(ctx, tableID, locID, "", 2, "")
		if err != nil {
			t.Fatalf("OpenSession: %v", err)
		}

		closed, err := store.CloseSession(ctx, sess.ID, 0, "")
		if err != nil {
			t.Fatalf("CloseSession: %v", err)
		}
		if closed.Status != "closed" {
			t.Errorf("FAIL: expected status='closed', got %q", closed.Status)
		}
		if closed.ClosedAt == nil {
			t.Error("FAIL: expected closed_at to be non-NULL, got nil")
		} else {
			t.Logf("PASS: status=%q closed_at=%v", closed.Status, *closed.ClosedAt)
		}
	})
}
