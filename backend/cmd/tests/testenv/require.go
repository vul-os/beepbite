package testenv

// require.go — the fail-closed entry point for DB-backed suites.
//
// Every integration suite in this repo used to open with the same TestMain:
//
//	pool, cleanup, err := testenv.StartPostgres(ctx)
//	if errors.Is(err, testenv.ErrSkip) {
//	    fmt.Println("skipping integration tests:", err)
//	    os.Exit(0)
//	}
//
// That is a fail-OPEN guard, and it cost this repo its entire integration tier
// without anyone noticing. startContainer bootstrapped its Postgres as the role
// "bb_test", migration 001 contains `ALTER DEFAULT PRIVILEGES FOR ROLE
// postgres`, so migration 001 failed, StartPostgres fell through to the
// scratch-DB path, DATABASE_URL was unset, and every one of eighteen suites
// printed one line to stdout and exited 0. `go test ./...` reported `ok` for all
// of them. `go test` prints a package's stdout only on failure or under -v, so
// the "loud" skip was invisible in exactly the run that mattered — a green CI
// run over zero assertions.
//
// MustStartPostgres inverts that default. No Postgres means the suite FAILS,
// with text that says what to do about it. Skipping is still possible, but only
// as a deliberate, named choice (BEEPBITE_SKIP_DB_TESTS=1) that announces
// itself — never as the silent consequence of a broken harness.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SkipDBTestsEnv is the one and only way to turn the DB suites off. It has to be
// set on purpose, which is the point: a machine that cannot run these tests is a
// fact someone chose to accept, not something the harness decides quietly.
const SkipDBTestsEnv = "BEEPBITE_SKIP_DB_TESTS"

// MustStartPostgres boots an ephemeral, fully-migrated Postgres for a suite's
// TestMain, or terminates the process with a non-zero status.
//
// Usage:
//
//	func TestMain(m *testing.M) {
//	    pool, cleanup := testenv.MustStartPostgres(context.Background())
//	    defer cleanup()
//	    testPool = pool
//	    os.Exit(m.Run())
//	}
//
// It never returns a nil pool: either the caller has a working database or the
// process is gone. That removes the third outcome — "the suite ran and asserted
// nothing" — which is the only one that can be mistaken for success.
func MustStartPostgres(ctx context.Context) (*pgxpool.Pool, func()) {
	pool, cleanup, err := StartPostgres(ctx)
	if err == nil {
		return pool, cleanup
	}

	if !errors.Is(err, ErrSkip) {
		// Docker answered, or a DATABASE_URL was given, and then something went
		// wrong: a migration that no longer applies, a port conflict, a bad
		// credential. This is a real failure and was always fatal.
		fmt.Fprintf(os.Stderr, "testenv: could not start Postgres: %v\n", err)
		os.Exit(1)
	}

	// No backend at all. Honour the explicit opt-out, loudly, on stderr — and
	// still say what was missed, so a developer who set the variable months ago
	// is reminded that a whole tier is dark.
	if os.Getenv(SkipDBTestsEnv) != "" {
		fmt.Fprintf(os.Stderr,
			"testenv: %s is set — SKIPPING this DB suite. No database assertions ran.\n"+
				"testenv: reason no backend was available: %v\n",
			SkipDBTestsEnv, err)
		os.Exit(0)
	}

	fmt.Fprintf(os.Stderr, `
testenv: FAILING because no Postgres backend is available.

  reason: %v

This suite asserts against a real, migrated Postgres; there is nothing it can
usefully prove without one. It fails rather than skips on purpose — a skip here
was previously invisible under plain "go test", so an entire broken integration
tier reported ok.

Provide a database in one of two ways:

  1. Docker. The suite starts its own postgres:16-alpine via testcontainers.
     Check the daemon is up:  docker info

  2. An existing Postgres. Point TEST_DATABASE_URL (or DATABASE_URL) at a server
     you can CREATE DATABASE on; each suite makes and drops its own scratch DB:
       export TEST_DATABASE_URL='postgres://postgres:pw@localhost:5432/postgres'

Note the bootstrap superuser must be named "postgres": migrations/001_baseline.sql
carries ALTER DEFAULT PRIVILEGES FOR ROLE postgres and will not apply otherwise.

If you genuinely intend to run without a database, say so explicitly:
  %s=1 go test ./...
`, err, SkipDBTestsEnv)
	os.Exit(1)
	return nil, nil // unreachable; keeps the compiler happy
}

// RequirePostgres is MustStartPostgres for the per-test pattern: it returns a
// migrated pool and registers its teardown with t, or FAILS t.
//
// It exists because t.Skipf is not a safe way to report a missing database, even
// with a carefully worded message. `go test` does not print skip reasons without
// -v, and CI dashboards routinely fold skips in with passes, so the run where the
// database was missing looks exactly like the run where the property held. A
// skipped atomicity check and a passing atomicity check are not the same claim.
//
// As with MustStartPostgres, BEEPBITE_SKIP_DB_TESTS=1 still allows a deliberate
// skip — and then it really does skip, because at that point someone has said in
// writing that they accept the gap.
func RequirePostgres(t testing.TB, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	pool, cleanup, err := StartPostgres(ctx)
	if err == nil {
		t.Cleanup(cleanup)
		return pool
	}
	if errors.Is(err, ErrSkip) && os.Getenv(SkipDBTestsEnv) != "" {
		t.Skipf("%s is set; this test did NOT verify its property: %v", SkipDBTestsEnv, err)
		return nil
	}
	t.Fatalf("no Postgres backend available, so this test could not verify anything: %v\n"+
		"Start Docker, or point TEST_DATABASE_URL at a server whose superuser is named "+
		"\"postgres\" (migration 001 requires that role). To accept the gap deliberately, "+
		"set %s=1.", err, SkipDBTestsEnv)
	return nil
}
