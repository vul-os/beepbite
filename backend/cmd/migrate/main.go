// Command migrate applies numbered SQL migrations from backend/migrations/.
//
// Usage:
//
//	go run ./cmd/migrate --env=local --up
//	go run ./cmd/migrate --env=dev   --up
//	go run ./cmd/migrate --env=main  --up
//	go run ./cmd/migrate --env=local --reset    # drops schema + re-applies everything
//	go run ./cmd/migrate --env=local --down     # drops schema (no --up after)
//
// Migrations are named NNN_<name>.sql (e.g. 001_extensions_and_helpers.sql).
// Files in the legacy/ subdirectory are intentionally skipped — they are the
// pre-consolidation 46-migration history archived by T0.C.3 and must not be
// re-applied. Applied versions are tracked in the schema_migrations table.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/config"
)

// migrationFile matches consolidated migration filenames: NNN_name.sql
// where NNN is one or more digits. The legacy/ subdirectory uses a
// YYYYMMDDHHMMSS prefix and is excluded at the directory-entry level below.
var migrationFile = regexp.MustCompile(`^(\d{3,})_([a-z0-9_]+)\.sql$`)

type migration struct {
	version string
	name    string
	path    string
}

func main() {
	env := flag.String("env", "", "environment: local, dev, main")
	up := flag.Bool("up", false, "apply all pending migrations")
	down := flag.Bool("down", false, "drop the public schema (destructive)")
	reset := flag.Bool("reset", false, "drop the public schema and re-apply everything")
	dir := flag.String("dir", "", "migrations directory (defaults to <repo>/backend/migrations)")
	flag.Parse()

	if !*up && !*down && !*reset {
		fmt.Fprintln(os.Stderr, "nothing to do: pass one of --up, --down, --reset")
		flag.Usage()
		os.Exit(2)
	}
	if moreThanOne(*up, *down, *reset) {
		log.Fatalf("--up, --down, --reset are mutually exclusive")
	}

	cfg, err := config.Load(*env)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("connect db: %v", err)
	}
	defer pool.Close()

	migDir := *dir
	if migDir == "" {
		migDir = resolveMigDir()
	}

	switch {
	case *reset:
		if err := dropSchema(ctx, pool); err != nil {
			log.Fatalf("drop schema: %v", err)
		}
		if err := applyUp(ctx, pool, migDir); err != nil {
			log.Fatalf("up: %v", err)
		}
	case *down:
		if err := dropSchema(ctx, pool); err != nil {
			log.Fatalf("drop schema: %v", err)
		}
	case *up:
		if err := applyUp(ctx, pool, migDir); err != nil {
			log.Fatalf("up: %v", err)
		}
	}
}

func moreThanOne(bs ...bool) bool {
	n := 0
	for _, b := range bs {
		if b {
			n++
		}
	}
	return n > 1
}

func resolveMigDir() string {
	// Look upwards for backend/migrations.
	cwd, err := os.Getwd()
	if err != nil {
		log.Fatalf("cwd: %v", err)
	}
	dir := cwd
	for i := 0; i < 10; i++ {
		candidate := filepath.Join(dir, "backend", "migrations")
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			return candidate
		}
		candidate2 := filepath.Join(dir, "migrations")
		if st, err := os.Stat(candidate2); err == nil && st.IsDir() && filepath.Base(dir) == "backend" {
			return candidate2
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	log.Fatalf("could not locate migrations directory (tried walking up from %s)", cwd)
	return ""
}

func dropSchema(ctx context.Context, pool *pgxpool.Pool) error {
	// Nuke everything in public. Also resets the migrations ledger so a
	// subsequent --up reapplies from scratch.
	log.Println("dropping schema public …")
	_, err := pool.Exec(ctx, `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`)
	return err
}

func ensureLedger(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    name    text NOT NULL,
    applied_at timestamptz DEFAULT now() NOT NULL
);`)
	return err
}

func loadMigrations(dir string) ([]migration, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read dir: %w", err)
	}
	var out []migration
	for _, e := range entries {
		// Skip ALL subdirectories, including legacy/ which holds the
		// pre-consolidation 2024*.sql files archived by T0.C.3.
		if e.IsDir() {
			continue
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

func applyUp(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	if err := ensureLedger(ctx, pool); err != nil {
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

	pending := 0
	for _, m := range migs {
		if applied[m.version] {
			continue
		}
		pending++
		log.Printf("applying %s_%s", m.version, m.name)
		body, err := os.ReadFile(m.path)
		if err != nil {
			return fmt.Errorf("read %s: %w", m.path, err)
		}
		sql := strings.TrimSpace(string(body))
		if sql == "" {
			log.Printf("  (empty, skipping)")
			continue
		}
		if err := applyOne(ctx, pool, m, sql); err != nil {
			return fmt.Errorf("apply %s: %w", m.version, err)
		}
	}
	if pending == 0 {
		log.Println("nothing to apply (everything up to date)")
	} else {
		log.Printf("applied %d migration(s)", pending)
	}
	return nil
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
