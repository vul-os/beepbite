// Package testenv provides an ephemeral Postgres helper for integration tests.
//
// Strategy (tried in order):
//  1. Testcontainers (Docker): spins up a postgres:16 container, runs all
//     consolidated migrations, and tears down on cleanup.
//  2. Scratch DB on local Postgres: when Docker is unavailable, parses the
//     DATABASE_URL env var (falling back to TEST_DATABASE_URL), connects to
//     the same server, creates a uniquely-named database (bb_test_<random>),
//     applies all migrations, and drops the database on teardown.
//  3. Skip signal: if neither path works StartPostgres returns ErrSkip; callers
//     should call t.Skip(err).
//
// Usage in a *_test.go:
//
//	func TestMain(m *testing.M) {
//	    pool, cleanup, err := testenv.StartPostgres(context.Background())
//	    if errors.Is(err, testenv.ErrSkip) {
//	        fmt.Println("skipping: no postgres available:", err)
//	        os.Exit(0)
//	    }
//	    if err != nil {
//	        log.Fatal(err)
//	    }
//	    defer cleanup()
//	    _ = pool // pass to suites via a package-level var
//	    os.Exit(m.Run())
//	}
package testenv

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrSkip is returned by StartPostgres when neither Docker nor a local Postgres
// is available. Callers should call t.Skip(err) when they see this.
var ErrSkip = errors.New("no postgres backend available — skip")

// migrationFile matches consolidated migration filenames: NNN_name.sql
var migrationFile = regexp.MustCompile(`^(\d{3,})_([a-z0-9_]+)\.sql$`)

type migration struct {
	version string
	name    string
	path    string
}

// StartPostgres boots an ephemeral Postgres, applies all consolidated
// migrations, and returns a fully-migrated *pgxpool.Pool plus a cleanup func.
//
// Callers MUST call cleanup() — typically via defer — to release resources.
func StartPostgres(ctx context.Context) (pool *pgxpool.Pool, cleanup func(), err error) {
	// Attempt 1: testcontainers / Docker
	pool, cleanup, err = startViaContainers(ctx)
	if err == nil {
		return pool, cleanup, nil
	}
	// If Docker is simply absent, fall through to scratch-DB path.
	if !isDockerMissing(err) {
		// Docker is present but something else went wrong — still fall through
		// so we don't block local development; just log the issue.
		log.Printf("testenv: testcontainers failed (%v), falling back to scratch DB", err)
	}

	// Attempt 2: scratch DB on local Postgres
	pool, cleanup, err = startViaScratchDB(ctx)
	if err == nil {
		return pool, cleanup, nil
	}

	return nil, func() {}, fmt.Errorf("%w: %v", ErrSkip, err)
}

// ---------------------------------------------------------------------------
// Path 1: testcontainers
// ---------------------------------------------------------------------------

func startViaContainers(ctx context.Context) (*pgxpool.Pool, func(), error) {
	connStr, ctrCleanup, err := startContainer(ctx)
	if err != nil {
		return nil, func() {}, err
	}

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		ctrCleanup()
		return nil, func() {}, fmt.Errorf("pgxpool connect (container): %w", err)
	}

	migDir, err := findMigrationsDir()
	if err != nil {
		pool.Close()
		ctrCleanup()
		return nil, func() {}, err
	}

	if err := applyMigrations(ctx, pool, migDir); err != nil {
		pool.Close()
		ctrCleanup()
		return nil, func() {}, fmt.Errorf("migrate (container): %w", err)
	}

	cleanup := func() {
		pool.Close()
		ctrCleanup()
	}
	return pool, cleanup, nil
}

// ---------------------------------------------------------------------------
// Path 2: scratch DB on local Postgres
// ---------------------------------------------------------------------------

func startViaScratchDB(ctx context.Context) (*pgxpool.Pool, func(), error) {
	baseURL := os.Getenv("TEST_DATABASE_URL")
	if baseURL == "" {
		baseURL = os.Getenv("DATABASE_URL")
	}
	if baseURL == "" {
		return nil, func() {}, errors.New("DATABASE_URL (and TEST_DATABASE_URL) are unset")
	}

	// Build a connection string that points to the postgres system database
	// so we can CREATE DATABASE.
	adminURL, dbName, err := scratchAdminURL(baseURL)
	if err != nil {
		return nil, func() {}, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	_ = dbName // we generate our own name

	// Unique test DB name
	testDB := fmt.Sprintf("bb_test_%s_%d", randSuffix(), time.Now().Unix())

	// Connect to admin DB to create/drop
	adminConn, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		return nil, func() {}, fmt.Errorf("connect admin DB: %w", err)
	}
	defer adminConn.Close(ctx)

	if _, err := adminConn.Exec(ctx, fmt.Sprintf(`CREATE DATABASE %q`, testDB)); err != nil {
		return nil, func() {}, fmt.Errorf("CREATE DATABASE %s: %w", testDB, err)
	}

	// Build the test pool URL
	testURL := replaceDBName(baseURL, testDB)
	pool, err := pgxpool.New(ctx, testURL)
	if err != nil {
		dropScratchDB(ctx, adminURL, testDB)
		return nil, func() {}, fmt.Errorf("pgxpool connect (scratch): %w", err)
	}

	migDir, err := findMigrationsDir()
	if err != nil {
		pool.Close()
		dropScratchDB(ctx, adminURL, testDB)
		return nil, func() {}, err
	}

	if err := applyMigrations(ctx, pool, migDir); err != nil {
		pool.Close()
		dropScratchDB(ctx, adminURL, testDB)
		return nil, func() {}, fmt.Errorf("migrate (scratch): %w", err)
	}

	cleanup := func() {
		pool.Close()
		dropScratchDB(context.Background(), adminURL, testDB)
	}
	return pool, cleanup, nil
}

func dropScratchDB(ctx context.Context, adminURL, dbName string) {
	conn, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		log.Printf("testenv: cannot connect to drop %s: %v", dbName, err)
		return
	}
	defer conn.Close(ctx)
	// Terminate any lingering connections first.
	_, _ = conn.Exec(ctx, `
		SELECT pg_terminate_backend(pid)
		FROM pg_stat_activity
		WHERE datname = $1 AND pid <> pg_backend_pid()`, dbName)
	if _, err := conn.Exec(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %q`, dbName)); err != nil {
		log.Printf("testenv: drop DB %s: %v", dbName, err)
	}
}

// scratchAdminURL returns a connection string that connects to the 'postgres'
// system database on the same server as baseURL, plus the original DB name.
func scratchAdminURL(baseURL string) (adminURL, origDB string, err error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return "", "", err
	}
	origDB = strings.TrimPrefix(u.Path, "/")
	u.Path = "/postgres"
	return u.String(), origDB, nil
}

// replaceDBName swaps the database component in a postgres URL.
func replaceDBName(baseURL, newDB string) string {
	u, err := url.Parse(baseURL)
	if err != nil {
		// Fallback: naive string replacement
		return baseURL
	}
	u.Path = "/" + newDB
	return u.String()
}

func randSuffix() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

// ---------------------------------------------------------------------------
// Shared migration logic (mirrors cmd/migrate/main.go)
// ---------------------------------------------------------------------------

func applyMigrations(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	// Ensure ledger table
	if _, err := pool.Exec(ctx, `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text PRIMARY KEY,
    name       text NOT NULL,
    applied_at timestamptz DEFAULT now() NOT NULL
);`); err != nil {
		return fmt.Errorf("ensure ledger: %w", err)
	}

	applied, err := appliedVersions(ctx, pool)
	if err != nil {
		return err
	}

	migs, err := loadMigrations(dir)
	if err != nil {
		return err
	}

	for _, m := range migs {
		if applied[m.version] {
			continue
		}
		log.Printf("testenv: applying migration %s_%s", m.version, m.name)
		body, err := os.ReadFile(m.path)
		if err != nil {
			return fmt.Errorf("read %s: %w", m.path, err)
		}
		sql := strings.TrimSpace(string(body))
		if sql == "" {
			continue
		}
		if err := applyOne(ctx, pool, m, sql); err != nil {
			return fmt.Errorf("apply migration %s: %w", m.version, err)
		}
	}
	return nil
}

func appliedVersions(ctx context.Context, pool *pgxpool.Pool) (map[string]bool, error) {
	rows, err := pool.Query(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out[v] = true
	}
	return out, rows.Err()
}

func loadMigrations(dir string) ([]migration, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir %s: %w", dir, err)
	}
	var out []migration
	for _, e := range entries {
		if e.IsDir() {
			continue // skip legacy/ and any other subdir
		}
		m := migrationFile.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		out = append(out, migration{
			version: m[1],
			name:    m[2],
			path:    filepath.Join(dir, e.Name()),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

func applyOne(ctx context.Context, pool *pgxpool.Pool, m migration, sql string) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, sql); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
		m.version, m.name); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// findMigrationsDir walks up the directory tree to locate backend/migrations.
func findMigrationsDir() (string, error) {
	// Use the caller's source file location as the starting point so this
	// works regardless of the working directory at test time.
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		// Fall back to os.Getwd
		cwd, _ := os.Getwd()
		thisFile = cwd
	}

	dir := filepath.Dir(thisFile)
	for i := 0; i < 12; i++ {
		candidate := filepath.Join(dir, "backend", "migrations")
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			return candidate, nil
		}
		// If we're already inside backend/
		candidate2 := filepath.Join(dir, "migrations")
		if st, err := os.Stat(candidate2); err == nil && st.IsDir() &&
			filepath.Base(dir) == "backend" {
			return candidate2, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// Final fallback: try relative to cwd
	cwd, _ := os.Getwd()
	for _, rel := range []string{
		"backend/migrations",
		"../migrations",
		"../../migrations",
		"../../../migrations",
		"../../../../migrations",
	} {
		candidate := filepath.Join(cwd, rel)
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("could not locate backend/migrations (walked up from %s)", thisFile)
}

// isDockerMissing returns true when the error indicates Docker is simply not
// present (not installed, socket missing, daemon not running, etc.).
func isDockerMissing(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	for _, hint := range []string{
		"cannot connect to the docker daemon",
		"docker daemon",
		"no such file",
		"connection refused",
		"docker: command not found",
		"docker not found",
		"is the docker daemon running",
		"cannot ping",
		"socket",
	} {
		if strings.Contains(s, hint) {
			return true
		}
	}
	return false
}
