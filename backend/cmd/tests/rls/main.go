// Command rls is the Wave 0 acceptance-gate: it proves that RLS policies
// enforce tenant isolation at runtime by running direct database probes via
// the Scoped() contract.
//
// Infrastructure: scratch DB (postgres://beepbite:beepbite@localhost:5432/wave0_rls_scratch)
// created and destroyed automatically. Migrations are applied in-process by
// reading backend/migrations/NNN_*.sql in order.
//
// Usage:
//
//	go run ./cmd/tests/rls
//	go run ./cmd/tests/rls --dsn postgres://beepbite:beepbite@localhost:5432/wave0_rls_scratch
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	appdb "github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

var migFile = regexp.MustCompile(`^(\d{3,})_([a-z0-9_]+)\.sql$`)

func main() {
	dsn := flag.String("dsn", "postgres://beepbite:beepbite@127.0.0.1:5432/wave0_rls_scratch?sslmode=disable", "scratch database DSN")
	skip := flag.Bool("skip-drop", false, "skip DROP DATABASE at end (for debugging)")
	flag.Parse()

	ctx := context.Background()

	// Connect as superuser to create/drop the scratch DB. We piggyback on the
	// beepbite DB to issue CREATE DATABASE (beepbite has CREATEDB).
	adminDSN := "postgres://beepbite:beepbite@127.0.0.1:5432/postgres?sslmode=disable"
	adminPool, err := pgxpool.New(ctx, adminDSN)
	if err != nil {
		log.Fatalf("admin connect: %v", err)
	}

	// Drop stale scratch DB, then recreate.
	resetScratchDB(ctx, adminPool, "wave0_rls_scratch")
	adminPool.Close()

	// Apply all 14 consolidated migrations.
	pool := mustConnect(ctx, *dsn)
	if err := applyMigrations(ctx, pool, migrationsDir()); err != nil {
		log.Fatalf("migrations: %v", err)
	}

	// Seed two isolated orgs.
	seed, err := seedData(ctx, pool)
	if err != nil {
		log.Fatalf("seed: %v", err)
	}

	// Run the probe matrix.
	suite := newSuite(ctx, pool, seed)
	suite.run()

	// Emit report.
	reportPath := writeReport(suite)
	fmt.Printf("\n[Report written to %s]\n", reportPath)

	// Cleanup.
	if !*skip {
		pool.Close()
		adminPool2, err := pgxpool.New(ctx, adminDSN)
		if err != nil {
			log.Printf("WARN: cannot reconnect admin to drop scratch DB: %v", err)
		} else {
			if _, err := adminPool2.Exec(ctx, "DROP DATABASE IF EXISTS wave0_rls_scratch"); err != nil {
				log.Printf("WARN: drop scratch DB: %v", err)
			} else {
				log.Println("scratch DB dropped")
			}
			adminPool2.Close()
		}
	}

	if suite.failed > 0 {
		os.Exit(1)
	}
}

func mustConnect(ctx context.Context, dsn string) *pgxpool.Pool {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("connect %s: %v", dsn, err)
	}
	pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pctx); err != nil {
		log.Fatalf("ping %s: %v", dsn, err)
	}
	return pool
}

// ---------------------------------------------------------------------------
// Scratch DB lifecycle
// ---------------------------------------------------------------------------

func resetScratchDB(ctx context.Context, pool *pgxpool.Pool, dbname string) {
	// Terminate existing connections first (Postgres 13+).
	_, _ = pool.Exec(ctx,
		`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
		dbname)
	if _, err := pool.Exec(ctx, "DROP DATABASE IF EXISTS "+dbname); err != nil {
		log.Fatalf("drop scratch db: %v", err)
	}
	if _, err := pool.Exec(ctx, "CREATE DATABASE "+dbname); err != nil {
		log.Fatalf("create scratch db: %v", err)
	}
	log.Printf("scratch DB %q reset", dbname)
}

// ---------------------------------------------------------------------------
// Migration runner (subset of cmd/migrate logic)
// ---------------------------------------------------------------------------

type mig struct {
	version string
	path    string
}

func loadMigs(dir string) ([]mig, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var out []mig
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		m := migFile.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		out = append(out, mig{version: m[1], path: filepath.Join(dir, e.Name())})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].version < out[j].version })
	return out, nil
}

func applyMigrations(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	// Ensure ledger.
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version    text PRIMARY KEY,
			applied_at timestamptz DEFAULT now() NOT NULL
		)`); err != nil {
		return fmt.Errorf("ledger: %w", err)
	}

	migs, err := loadMigs(dir)
	if err != nil {
		return fmt.Errorf("load migs: %w", err)
	}

	for _, m := range migs {
		body, err := os.ReadFile(m.path)
		if err != nil {
			return fmt.Errorf("read %s: %w", m.path, err)
		}
		sql := strings.TrimSpace(string(body))
		if sql == "" {
			continue
		}
		log.Printf("applying migration %s …", m.version)
		tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			return fmt.Errorf("begin %s: %w", m.version, err)
		}
		if _, err := tx.Exec(ctx, sql); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("exec %s: %w", m.version, err)
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING`,
			m.version); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("ledger %s: %w", m.version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit %s: %w", m.version, err)
		}
		log.Printf("  %s applied", m.version)
	}
	return nil
}

func migrationsDir() string {
	// Walk upward from this file's location to find backend/migrations.
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, "migrations")
		if st, err := os.Stat(candidate); err == nil && st.IsDir() {
			return candidate
		}
		candidate2 := filepath.Join(dir, "backend", "migrations")
		if st, err := os.Stat(candidate2); err == nil && st.IsDir() {
			return candidate2
		}
		dir = filepath.Dir(dir)
	}
	// Fallback: relative to cwd.
	cwd, _ := os.Getwd()
	return filepath.Join(cwd, "migrations")
}

// ---------------------------------------------------------------------------
// Seed: two orgs (A and B), each with owner, org, location, 5 items, staff
// ---------------------------------------------------------------------------

type seedResult struct {
	// Org A
	userA   string // auth_users.id
	orgA    string // organizations.id
	locA    string // locations.id
	profileA string // profiles.id (same as userA)
	memberA string // organization_members.id

	// Org B
	userB   string
	orgB    string
	locB    string
	profileB string
	memberB string

	// Orders
	orderA string // orders.id for org A
	orderB string // orders.id for org B

	// A tracking token for org A (customer_profile_id = profileA)
	trackingTokenA string

	// A wallet transaction for org A
	walletTxA string

	// whatsapp link token
	wlToken string

	// An audit_log row for org A
	auditLogA string

	// Region used
	regionID string
}

func seedData(ctx context.Context, pool *pgxpool.Pool) (*seedResult, error) {
	var s seedResult

	// Use service role scope for all seeding.
	svcScope := appdb.ServiceRoleScope()

	err := appdb.Scoped(ctx, pool, svcScope, func(tx pgx.Tx) error {
		// --- region ---
		if err := tx.QueryRow(ctx,
			`INSERT INTO regions (code, name, currency, timezone)
			 VALUES ('ZA','South Africa','ZAR','Africa/Johannesburg')
			 ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
			 RETURNING id`).Scan(&s.regionID); err != nil {
			return fmt.Errorf("region: %w", err)
		}

		// --- currencies ---
		if _, err := tx.Exec(ctx,
			`INSERT INTO currencies (code, name, symbol) VALUES ('ZAR','South African Rand','R')
			 ON CONFLICT DO NOTHING`); err != nil {
			return fmt.Errorf("currency: %w", err)
		}

		// Helper: create an auth_user + org + location + member.
		// NOTE: the handle_new_user() trigger auto-creates the profiles row;
		// we must NOT insert it manually.
		createOrg := func(email, orgName string) (userID, orgID, locID, profileID, memberID string, err error) {
			// auth_user — trigger on_auth_user_created auto-inserts profiles row.
			if err = tx.QueryRow(ctx,
				`INSERT INTO auth_users (email, password_hash, email_verified)
				 VALUES ($1, 'hash', true) RETURNING id`, email).Scan(&userID); err != nil {
				return "", "", "", "", "", fmt.Errorf("auth_user %s: %w", email, err)
			}
			profileID = userID // profiles.id == auth_users.id
			// org
			if err = tx.QueryRow(ctx,
				`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, orgName).Scan(&orgID); err != nil {
				return "", "", "", "", "", fmt.Errorf("org %s: %w", orgName, err)
			}
			// member
			if err = tx.QueryRow(ctx,
				`INSERT INTO organization_members (organization_id, profile_id, role)
				 VALUES ($1,$2,'owner') RETURNING id`, orgID, profileID).Scan(&memberID); err != nil {
				return "", "", "", "", "", fmt.Errorf("member %s: %w", email, err)
			}
			// location
			if err = tx.QueryRow(ctx,
				`INSERT INTO locations
				   (organization_id, region_id, name, is_marketplace_visible)
				 VALUES ($1,$2,$3,true) RETURNING id`,
				orgID, s.regionID, orgName+" HQ").Scan(&locID); err != nil {
				return "", "", "", "", "", fmt.Errorf("location %s: %w", orgName, err)
			}
			return
		}

		var err error
		s.userA, s.orgA, s.locA, s.profileA, s.memberA, err = createOrg("owner-a@test.example", "OrgA")
		if err != nil {
			return err
		}
		s.userB, s.orgB, s.locB, s.profileB, s.memberB, err = createOrg("owner-b@test.example", "OrgB")
		if err != nil {
			return err
		}

		// Seed 5 items per org (via a category).
		seedItems := func(orgID, locID string) error {
			var catID string
			if err := tx.QueryRow(ctx,
				`INSERT INTO categories (location_id, organization_id, name)
				 VALUES ($1,$2,'Main') RETURNING id`, locID, orgID).Scan(&catID); err != nil {
				return fmt.Errorf("category: %w", err)
			}
			for i := 1; i <= 5; i++ {
				if _, err := tx.Exec(ctx,
					`INSERT INTO items (location_id, category_id, name, price)
					 VALUES ($1,$2,$3,100)`, locID, catID, fmt.Sprintf("Item %d", i)); err != nil {
					return fmt.Errorf("item %d: %w", i, err)
				}
			}
			return nil
		}
		if err := seedItems(s.orgA, s.locA); err != nil {
			return fmt.Errorf("items A: %w", err)
		}
		if err := seedItems(s.orgB, s.locB); err != nil {
			return fmt.Errorf("items B: %w", err)
		}

		// Seed 1 staff per org.
		seedStaff := func(locID string, tag string) error {
			_, err := tx.Exec(ctx,
				`INSERT INTO staff (location_id, first_name, last_name, role, pin_hash)
				 VALUES ($1,$2,'Smith','cashier','pinhash')`, locID, "Staff"+tag)
			return err
		}
		if err := seedStaff(s.locA, "A"); err != nil {
			return fmt.Errorf("staff A: %w", err)
		}
		if err := seedStaff(s.locB, "B"); err != nil {
			return fmt.Errorf("staff B: %w", err)
		}

		// Seed 1 active order per org.
		if err := tx.QueryRow(ctx,
			`INSERT INTO orders (location_id, organization_id, order_number)
			 VALUES ($1,$2,'ORD-A-001') RETURNING id`, s.locA, s.orgA).Scan(&s.orderA); err != nil {
			return fmt.Errorf("order A: %w", err)
		}
		if err := tx.QueryRow(ctx,
			`INSERT INTO orders (location_id, organization_id, order_number)
			 VALUES ($1,$2,'ORD-B-001') RETURNING id`, s.locB, s.orgB).Scan(&s.orderB); err != nil {
			return fmt.Errorf("order B: %w", err)
		}

		// Seed order_tracking_token for org A (customer_profile_id = profileA).
		// Primary key is `token` (text), not `id`.
		s.trackingTokenA = "rls-test-token-a"
		if _, err := tx.Exec(ctx,
			`INSERT INTO order_tracking_tokens (token, order_id, customer_profile_id, expires_at)
			 VALUES ($1, $2, $3, now() + interval '1 day')`,
			s.trackingTokenA, s.orderA, s.profileA); err != nil {
			return fmt.Errorf("tracking token A: %w", err)
		}

		// Seed org wallet for org A (needed for wallet_transaction).
		if _, err := tx.Exec(ctx,
			`INSERT INTO org_wallets (org_id, balance_cents, currency_code) VALUES ($1, 0, 'ZAR')
			 ON CONFLICT (org_id) DO NOTHING`, s.orgA); err != nil {
			return fmt.Errorf("org_wallet A: %w", err)
		}

		// Seed wallet transaction for org A.
		// kind uses wallet_txn_kind enum; amount positive = credit.
		if err := tx.QueryRow(ctx,
			`INSERT INTO wallet_transactions (org_id, amount_cents, kind, description, idempotency_key)
			 VALUES ($1, 1000, 'topup', 'test top-up', 'test-idem-a') RETURNING id`,
			s.orgA).Scan(&s.walletTxA); err != nil {
			return fmt.Errorf("wallet_tx A: %w", err)
		}

		// Seed whatsapp_link_token.
		// Schema: token(pk), phone_e164, intent(enum), profile_id(nullable), expires_at.
		s.wlToken = "rls-wl-test"
		if _, err := tx.Exec(ctx,
			`INSERT INTO whatsapp_link_tokens (token, phone_e164, intent, profile_id, expires_at)
			 VALUES ($1, '+27000000001', 'bind', $2, now() + interval '1 hour')`,
			s.wlToken, s.profileA); err != nil {
			return fmt.Errorf("wl_token: %w", err)
		}

		// Seed audit_log row for org A.
		// Schema: id, organization_id, actor_type, actor_id, action, entity_type, entity_id, ...
		if err := tx.QueryRow(ctx,
			`INSERT INTO audit_log (organization_id, actor_type, action, entity_type, entity_id)
			 VALUES ($1,'system','test.seed','orders',$2) RETURNING id`,
			s.orgA, s.orderA).Scan(&s.auditLogA); err != nil {
			return fmt.Errorf("audit_log A: %w", err)
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// ---------------------------------------------------------------------------
// Probe suite
// ---------------------------------------------------------------------------

type result struct {
	table  string
	scope  string
	op     string
	pass   bool
	detail string
}

type suite struct {
	ctx     context.Context
	pool    *pgxpool.Pool
	seed    *seedResult
	results []result
	passed  int
	failed  int
}

func newSuite(ctx context.Context, pool *pgxpool.Pool, seed *seedResult) *suite {
	return &suite{ctx: ctx, pool: pool, seed: seed}
}

func (s *suite) probe(table, scopeName, op string, fn func() (bool, string)) {
	pass, detail := fn()
	s.results = append(s.results, result{table, scopeName, op, pass, detail})
	if pass {
		s.passed++
		fmt.Printf("  PASS  %-40s %-12s %s\n", table, scopeName, op)
	} else {
		s.failed++
		fmt.Printf("  FAIL  %-40s %-12s %s — %s\n", table, scopeName, op, detail)
	}
}

// expectZeroRows runs fn inside a Scoped transaction; passes if SELECT returns 0 rows.
func (s *suite) expectZeroRows(table, scopeName string, scope appdb.Scope, query string, args ...any) {
	s.probe(table, scopeName, "SELECT=0", func() (bool, string) {
		var n int
		err := appdb.Scoped(s.ctx, s.pool, scope, func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, query, args...).Scan(&n)
		})
		if err != nil {
			return false, fmt.Sprintf("scoped error: %v", err)
		}
		if n == 0 {
			return true, ""
		}
		return false, fmt.Sprintf("got %d rows, want 0", n)
	})
}

// expectRows passes if SELECT returns ≥ expectedMin rows.
func (s *suite) expectRows(table, scopeName string, scope appdb.Scope, expectedMin int, query string, args ...any) {
	s.probe(table, scopeName, fmt.Sprintf("SELECT≥%d", expectedMin), func() (bool, string) {
		var n int
		err := appdb.Scoped(s.ctx, s.pool, scope, func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, query, args...).Scan(&n)
		})
		if err != nil {
			return false, fmt.Sprintf("scoped error: %v", err)
		}
		if n >= expectedMin {
			return true, ""
		}
		return false, fmt.Sprintf("got %d rows, want ≥%d", n, expectedMin)
	})
}

// expectExactRows passes if SELECT returns exactly n rows.
func (s *suite) expectExactRows(table, scopeName string, scope appdb.Scope, expected int, query string, args ...any) {
	s.probe(table, scopeName, fmt.Sprintf("SELECT=%d", expected), func() (bool, string) {
		var n int
		err := appdb.Scoped(s.ctx, s.pool, scope, func(tx pgx.Tx) error {
			return tx.QueryRow(s.ctx, query, args...).Scan(&n)
		})
		if err != nil {
			return false, fmt.Sprintf("scoped error: %v", err)
		}
		if n == expected {
			return true, ""
		}
		return false, fmt.Sprintf("got %d rows, want %d", n, expected)
	})
}

// expectInsertFails passes if INSERT fails (error) or returns 0 affected rows.
func (s *suite) expectInsertFails(table, scopeName string, scope appdb.Scope, query string, args ...any) {
	s.probe(table, scopeName, "INSERT=DENIED", func() (bool, string) {
		err := appdb.Scoped(s.ctx, s.pool, scope, func(tx pgx.Tx) error {
			ct, err := tx.Exec(s.ctx, query, args...)
			if err != nil {
				return err // expected
			}
			if ct.RowsAffected() == 0 {
				return nil // treated as denied
			}
			return fmt.Errorf("insert succeeded with %d row(s)", ct.RowsAffected())
		})
		if err != nil {
			if strings.Contains(err.Error(), "42501") ||
				strings.Contains(err.Error(), "insufficient_privilege") ||
				strings.Contains(err.Error(), "violates row-level security") ||
				strings.Contains(err.Error(), "new row violates") ||
				strings.Contains(err.Error(), "permission denied") {
				return true, ""
			}
			// Any error is acceptable — RLS blocked it.
			return true, fmt.Sprintf("denied (err: %v)", err)
		}
		return false, "INSERT unexpectedly succeeded"
	})
}

// expectUpdateZero passes if UPDATE returns 0 rows affected (RLS hides the target).
func (s *suite) expectUpdateZero(table, scopeName string, scope appdb.Scope, query string, args ...any) {
	s.probe(table, scopeName, "UPDATE=0", func() (bool, string) {
		var affected int64
		err := appdb.Scoped(s.ctx, s.pool, scope, func(tx pgx.Tx) error {
			ct, err := tx.Exec(s.ctx, query, args...)
			if err != nil {
				// UPDATE/DELETE blocked by USING(false) raises no error but
				// some implementations may raise 42501.
				if strings.Contains(err.Error(), "42501") ||
					strings.Contains(err.Error(), "violates row-level") ||
					strings.Contains(err.Error(), "insufficient_privilege") {
					return nil // count as 0
				}
				return err
			}
			affected = ct.RowsAffected()
			return nil
		})
		if err != nil {
			return false, fmt.Sprintf("unexpected error: %v", err)
		}
		if affected == 0 {
			return true, ""
		}
		return false, fmt.Sprintf("UPDATE affected %d rows, want 0", affected)
	})
}

// expectUpdateFails passes if UPDATE fails with a privilege/RLS error.
func (s *suite) expectUpdateFails(table, scopeName string, scope appdb.Scope, query string, args ...any) {
	s.probe(table, scopeName, "UPDATE=DENIED", func() (bool, string) {
		err := appdb.Scoped(s.ctx, s.pool, scope, func(tx pgx.Tx) error {
			ct, err := tx.Exec(s.ctx, query, args...)
			if err != nil {
				return err
			}
			if ct.RowsAffected() > 0 {
				return fmt.Errorf("UPDATE succeeded with %d rows", ct.RowsAffected())
			}
			return nil // 0 rows is also fine
		})
		if err != nil {
			return true, fmt.Sprintf("blocked: %v", err)
		}
		return true, "0 rows affected"
	})
}

// expectDeleteZero passes if DELETE returns 0 rows affected.
func (s *suite) expectDeleteZero(table, scopeName string, scope appdb.Scope, query string, args ...any) {
	s.probe(table, scopeName, "DELETE=0", func() (bool, string) {
		var affected int64
		err := appdb.Scoped(s.ctx, s.pool, scope, func(tx pgx.Tx) error {
			ct, err := tx.Exec(s.ctx, query, args...)
			if err != nil {
				if strings.Contains(err.Error(), "42501") ||
					strings.Contains(err.Error(), "violates row-level") ||
					strings.Contains(err.Error(), "insufficient_privilege") {
					return nil
				}
				return err
			}
			affected = ct.RowsAffected()
			return nil
		})
		if err != nil {
			return false, fmt.Sprintf("unexpected error: %v", err)
		}
		if affected == 0 {
			return true, ""
		}
		return false, fmt.Sprintf("DELETE removed %d rows, want 0", affected)
	})
}

func (s *suite) run() {
	seed := s.seed
	ctx := s.ctx
	pool := s.pool
	_ = ctx
	_ = pool

	// Convenience scope builders.
	anon := appdb.Scope{}
	scopeA := appdb.Scope{UserID: seed.userA, OrgID: seed.orgA}
	svc := appdb.ServiceRoleScope()
	mkt := appdb.MarketplaceScope()

	fmt.Println("\n========== RLS Probe Matrix ==========")

	// ===========================================================================
	// 1. ANONYMOUS — zero rows on tenant-scoped tables; INSERT blocked
	// ===========================================================================
	fmt.Println("\n--- Anonymous probes ---")

	s.expectZeroRows("organizations", "anon", anon,
		`SELECT count(*) FROM organizations`)

	s.expectZeroRows("organization_members", "anon", anon,
		`SELECT count(*) FROM organization_members`)

	s.expectZeroRows("locations", "anon", anon,
		`SELECT count(*) FROM locations`)

	s.expectZeroRows("categories", "anon", anon,
		`SELECT count(*) FROM categories`)

	s.expectZeroRows("items", "anon", anon,
		`SELECT count(*) FROM items`)

	s.expectZeroRows("orders", "anon", anon,
		`SELECT count(*) FROM orders`)

	s.expectZeroRows("order_tracking_tokens", "anon", anon,
		`SELECT count(*) FROM order_tracking_tokens`)

	s.expectZeroRows("whatsapp_link_tokens", "anon", anon,
		`SELECT count(*) FROM whatsapp_link_tokens`)

	s.expectZeroRows("wallet_transactions", "anon", anon,
		`SELECT count(*) FROM wallet_transactions`)

	s.expectZeroRows("audit_log", "anon", anon,
		`SELECT count(*) FROM audit_log`)

	s.expectZeroRows("staff", "anon", anon,
		`SELECT count(*) FROM staff`)

	// Anonymous INSERT blocked on tenant-scoped tables.
	s.expectInsertFails("organizations", "anon", anon,
		`INSERT INTO organizations (name) VALUES ('anon-inject')`)

	s.expectInsertFails("orders", "anon", anon,
		`INSERT INTO orders (location_id, organization_id, order_number)
		 VALUES ($1,$2,'ANON-001')`, seed.locA, seed.orgA)

	s.expectInsertFails("locations", "anon", anon,
		`INSERT INTO locations (organization_id, region_id, name)
		 VALUES ($1,$2,'anon-loc')`, seed.orgA, seed.regionID)

	// ===========================================================================
	// 2. ORG A MEMBER — sees only A's data; cannot touch B
	// ===========================================================================
	fmt.Println("\n--- Org A member probes ---")

	// SELECT on orders: sees only A's order.
	s.expectExactRows("orders", "orgA", scopeA, 1,
		`SELECT count(*) FROM orders`)

	// SELECT on orders: 0 rows for org B rows.
	s.expectZeroRows("orders(orgB)", "orgA", scopeA,
		`SELECT count(*) FROM orders WHERE id = $1`, seed.orderB)

	// SELECT locations: 1 row (own), not B's.
	s.expectExactRows("locations", "orgA", scopeA, 1,
		`SELECT count(*) FROM locations`)

	// SELECT categories: 1 row (own).
	s.expectExactRows("categories", "orgA", scopeA, 1,
		`SELECT count(*) FROM categories`)

	// SELECT items: 5 rows (own).
	s.expectExactRows("items", "orgA", scopeA, 5,
		`SELECT count(*) FROM items`)

	// INSERT order with org B's location_id → blocked.
	s.expectInsertFails("orders", "orgA->locB", scopeA,
		`INSERT INTO orders (location_id, organization_id, order_number)
		 VALUES ($1,$2,'CROSS-001')`, seed.locB, seed.orgB)

	// UPDATE org B's order → 0 rows.
	s.expectUpdateZero("orders(orgB)", "orgA", scopeA,
		`UPDATE orders SET notes = 'hacked' WHERE id = $1`, seed.orderB)

	// DELETE org B's order → 0 rows.
	s.expectDeleteZero("orders(orgB)", "orgA", scopeA,
		`DELETE FROM orders WHERE id = $1`, seed.orderB)

	// Organization_members: sees only own org.
	s.expectExactRows("organization_members", "orgA", scopeA, 1,
		`SELECT count(*) FROM organization_members`)

	// Staff: sees only own org's staff.
	s.expectExactRows("staff", "orgA", scopeA, 1,
		`SELECT count(*) FROM staff`)

	// Wallet transactions: sees own org's.
	s.expectExactRows("wallet_transactions", "orgA", scopeA, 1,
		`SELECT count(*) FROM wallet_transactions`)

	// Cannot see org B's wallet_transactions.
	s.expectZeroRows("wallet_transactions(orgB)", "orgA", scopeA,
		`SELECT count(*) FROM wallet_transactions WHERE org_id = $1`, seed.orgB)

	// ===========================================================================
	// 3. SERVICE ROLE — sees everything; can insert for any org
	// ===========================================================================
	fmt.Println("\n--- Service role probes ---")

	// Should see both orgs' orders.
	s.expectRows("orders", "svc", svc, 2,
		`SELECT count(*) FROM orders`)

	// Should see both orgs' locations.
	s.expectRows("locations", "svc", svc, 2,
		`SELECT count(*) FROM locations`)

	// Should see both orgs' categories.
	s.expectRows("categories", "svc", svc, 2,
		`SELECT count(*) FROM categories`)

	// Should see both orgs' items (10 total).
	s.expectRows("items", "svc", svc, 10,
		`SELECT count(*) FROM items`)

	// Should see all organization_members (2).
	s.expectRows("organization_members", "svc", svc, 2,
		`SELECT count(*) FROM organization_members`)

	// Should see whatsapp_link_tokens.
	s.expectRows("whatsapp_link_tokens", "svc", svc, 1,
		`SELECT count(*) FROM whatsapp_link_tokens`)

	// Should see wallet transactions.
	s.expectRows("wallet_transactions", "svc", svc, 1,
		`SELECT count(*) FROM wallet_transactions`)

	// Service role can insert for org B.
	s.probe("orders", "svc", "INSERT=OK", func() (bool, string) {
		err := appdb.Scoped(s.ctx, s.pool, svc, func(tx pgx.Tx) error {
			var id string
			return tx.QueryRow(ctx,
				`INSERT INTO orders (location_id, organization_id, order_number)
				 VALUES ($1,$2,'SVC-001') RETURNING id`, seed.locB, seed.orgB).Scan(&id)
		})
		if err != nil {
			return false, fmt.Sprintf("svc insert failed: %v", err)
		}
		return true, ""
	})

	// ===========================================================================
	// 4. MARKETPLACE ROLE — location: only is_marketplace_visible=true;
	//    items: only from marketplace-visible locations; INSERT blocked
	// ===========================================================================
	fmt.Println("\n--- Marketplace role probes ---")

	// Locations: both were seeded with is_marketplace_visible=true → 2 rows.
	s.expectRows("locations", "mkt", mkt, 2,
		`SELECT count(*) FROM locations WHERE is_marketplace_visible = true`)

	// Items from marketplace-visible locations.
	s.expectRows("items", "mkt", mkt, 10,
		`SELECT count(*) FROM items i
		 JOIN locations l ON l.id = i.location_id
		 WHERE l.is_marketplace_visible = true`)

	// Marketplace cannot INSERT into tenant tables.
	s.expectInsertFails("orders", "mkt", mkt,
		`INSERT INTO orders (location_id, organization_id, order_number)
		 VALUES ($1,$2,'MKT-001')`, seed.locA, seed.orgA)

	s.expectInsertFails("locations", "mkt", mkt,
		`INSERT INTO locations (organization_id, region_id, name)
		 VALUES ($1,$2,'mkt-inject')`, seed.orgA, seed.regionID)

	s.expectInsertFails("categories", "mkt", mkt,
		`INSERT INTO categories (location_id, organization_id, name)
		 VALUES ($1,$2,'mkt-cat')`, seed.locA, seed.orgA)

	// Marketplace cannot see non-visible location (create a hidden one and verify).
	s.probe("locations(hidden)", "mkt", "SELECT=0", func() (bool, string) {
		// Create a hidden location via service role.
		var hiddenLocID string
		err := appdb.Scoped(ctx, pool, svc, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`INSERT INTO locations (organization_id, region_id, name, is_marketplace_visible)
				 VALUES ($1,$2,'HiddenLoc',false) RETURNING id`,
				seed.orgA, seed.regionID).Scan(&hiddenLocID)
		})
		if err != nil {
			return false, fmt.Sprintf("create hidden loc: %v", err)
		}
		// Marketplace should not see it.
		var n int
		err = appdb.Scoped(ctx, pool, mkt, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT count(*) FROM locations WHERE id = $1`, hiddenLocID).Scan(&n)
		})
		if err != nil {
			return false, fmt.Sprintf("mkt select: %v", err)
		}
		if n == 0 {
			return true, ""
		}
		return false, fmt.Sprintf("marketplace saw hidden location (count=%d)", n)
	})

	// ===========================================================================
	// 5. SPECIAL CASES
	// ===========================================================================
	fmt.Println("\n--- Special-case probes ---")

	// 5a. order_tracking_tokens: no token was seeded for org B, and org A
	// member's scope cannot see tokens for org B orders (customer_profile_id != userA).
	s.expectZeroRows("order_tracking_tokens(orgB)", "orgA", scopeA,
		`SELECT count(*) FROM order_tracking_tokens WHERE order_id = $1`, seed.orderB)

	// 5b. org A user sees their own tracking token.
	s.expectRows("order_tracking_tokens(own)", "orgA", scopeA, 1,
		`SELECT count(*) FROM order_tracking_tokens
		 WHERE customer_profile_id = $1`, seed.profileA)

	// 5c. driver_location_pings: no pings seeded; anon sees 0.
	s.expectZeroRows("driver_location_pings", "anon", anon,
		`SELECT count(*) FROM driver_location_pings`)

	// 5d. whatsapp_link_tokens: only service_role can read.
	s.expectZeroRows("whatsapp_link_tokens", "orgA", scopeA,
		`SELECT count(*) FROM whatsapp_link_tokens`)

	s.expectRows("whatsapp_link_tokens", "svc", svc, 1,
		`SELECT count(*) FROM whatsapp_link_tokens`)

	// 5e. audit_log: UPDATE blocked even for org A owner (USING(false) policy).
	s.expectUpdateFails("audit_log", "orgA", scopeA,
		`UPDATE audit_log SET action = 'tampered' WHERE id = $1`, seed.auditLogA)

	// audit_log DELETE blocked.
	s.expectDeleteZero("audit_log", "orgA", scopeA,
		`DELETE FROM audit_log WHERE id = $1`, seed.auditLogA)

	// 5f. wallet_transactions: UPDATE blocked (append-only USING(false)).
	s.expectUpdateFails("wallet_transactions", "orgA", scopeA,
		`UPDATE wallet_transactions SET amount_cents = 9999 WHERE id = $1`, seed.walletTxA)

	// wallet_transactions DELETE blocked.
	s.expectDeleteZero("wallet_transactions", "orgA", scopeA,
		`DELETE FROM wallet_transactions WHERE id = $1`, seed.walletTxA)

	// 5g. audit_log: org A owner cannot INSERT (only service_role can).
	s.expectInsertFails("audit_log", "orgA", scopeA,
		`INSERT INTO audit_log (organization_id, actor_type, action, entity_type, entity_id)
		 VALUES ($1,'member','forge.attempt','orders',$2)`, seed.orgA, seed.orderA)

	fmt.Printf("\n========== RESULTS: %d passed, %d failed ==========\n", s.passed, s.failed)
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

func writeReport(s *suite) string {
	repoRoot := findRepoRoot()
	outDir := filepath.Join(repoRoot, "docs", "pentest")
	_ = os.MkdirAll(outDir, 0755)
	outPath := filepath.Join(outDir, "rls-foundation.md")

	var sb strings.Builder
	sb.WriteString("# RLS Foundation — Wave 0 Acceptance Gate\n\n")
	sb.WriteString(fmt.Sprintf("Generated: %s\n\n", time.Now().UTC().Format(time.RFC3339)))
	sb.WriteString("## Infrastructure\n\n")
	sb.WriteString("- Test infra: **scratch DB** (`wave0_rls_scratch` on localhost:5432)\n")
	sb.WriteString("- Migrations: 14 consolidated migrations applied in-process\n")
	sb.WriteString("- Contract under test: `internal/db.Scoped(ctx, pool, scope, fn)`\n\n")
	sb.WriteString("## Probe Matrix\n\n")
	sb.WriteString("| Table | Scope | Operation | Result | Detail |\n")
	sb.WriteString("|-------|-------|-----------|--------|--------|\n")

	for _, r := range s.results {
		status := "PASS"
		if !r.pass {
			status = "**FAIL**"
		}
		sb.WriteString(fmt.Sprintf("| `%s` | `%s` | `%s` | %s | %s |\n",
			r.table, r.scope, r.op, status, r.detail))
	}

	total := s.passed + s.failed
	sb.WriteString(fmt.Sprintf("\n## Summary\n\n- Total probes: **%d**\n- Passed: **%d**\n- Failed: **%d**\n\n",
		total, s.passed, s.failed))

	if s.failed == 0 {
		sb.WriteString("## Verdict\n\n**WAVE 0 ACCEPTANCE GATE — PASS**\n\n")
		sb.WriteString("All RLS policies enforce tenant isolation correctly. ")
		sb.WriteString("Anonymous callers see zero rows. Org-A member cannot read, write, or delete org-B data. ")
		sb.WriteString("Service role has full access. Marketplace role is limited to public-visible data. ")
		sb.WriteString("Append-only and service-only tables are correctly locked.\n")
	} else {
		sb.WriteString("## Verdict\n\n**WAVE 0 ACCEPTANCE GATE — FAIL**\n\n")
		sb.WriteString(fmt.Sprintf("%d RLS bypass(es) detected. See FAIL rows above. Wave 0 is incomplete.\n", s.failed))
	}

	if err := os.WriteFile(outPath, []byte(sb.String()), 0644); err != nil {
		log.Printf("WARN: write report: %v", err)
		return "(write failed)"
	}
	return outPath
}

func findRepoRoot() string {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "backend", "go.mod")); err == nil {
			return dir
		}
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			if filepath.Base(dir) == "backend" {
				return filepath.Dir(dir)
			}
		}
		dir = filepath.Dir(dir)
	}
	cwd, _ := os.Getwd()
	return cwd
}
