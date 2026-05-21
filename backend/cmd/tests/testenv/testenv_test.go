// Package testenv_test demonstrates how integration tests should use StartPostgres.
//
// Pattern A — TestMain (recommended for a whole package):
//
//	var testPool *pgxpool.Pool
//
//	func TestMain(m *testing.M) {
//	    ctx := context.Background()
//	    pool, cleanup, err := testenv.StartPostgres(ctx)
//	    if errors.Is(err, testenv.ErrSkip) {
//	        fmt.Println("skipping integration tests:", err)
//	        os.Exit(0)
//	    }
//	    if err != nil {
//	        log.Fatal(err)
//	    }
//	    defer cleanup()
//	    testPool = pool
//	    os.Exit(m.Run())
//	}
//
// Pattern B — per-test (simpler, slower):
//
//	func TestSomething(t *testing.T) {
//	    pool, cleanup, err := testenv.StartPostgres(context.Background())
//	    if errors.Is(err, testenv.ErrSkip) { t.Skip(err) }
//	    require.NoError(t, err)
//	    t.Cleanup(cleanup)
//	    // … use pool …
//	}
package testenv_test

import (
	"context"
	"errors"
	"testing"

	"github.com/beepbite/backend/cmd/tests/testenv"
)

// TestStartPostgres_smoke verifies that StartPostgres either succeeds and
// returns a working pool, or returns ErrSkip (which causes the test to be
// skipped rather than failed). This is safe to run in CI where Docker may
// not be present as long as a local Postgres is reachable via DATABASE_URL.
func TestStartPostgres_smoke(t *testing.T) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		t.Skip("no postgres backend available:", err)
	}
	if err != nil {
		t.Fatalf("StartPostgres: %v", err)
	}
	t.Cleanup(cleanup)

	// Quick sanity: can we execute a trivial query?
	var result int
	if err := pool.QueryRow(ctx, `SELECT 1`).Scan(&result); err != nil {
		t.Fatalf("SELECT 1: %v", err)
	}
	if result != 1 {
		t.Fatalf("expected 1, got %d", result)
	}

	// Verify migrations were applied: schema_migrations table must exist and
	// have at least one row.
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatalf("query schema_migrations: %v", err)
	}
	if count == 0 {
		t.Fatal("schema_migrations is empty — no migrations were applied")
	}
	t.Logf("testenv OK: %d migration(s) applied", count)
}
