// Command setupapprole provisions the non-superuser, non-BYPASSRLS Postgres
// login role the application server MUST connect as.
//
// Why this exists: Postgres silently skips ALL row-level security for a
// SUPERUSER or BYPASSRLS role, even under FORCE ROW LEVEL SECURITY. If the
// server connects as such a role (e.g. the same admin role used to run
// migrations), every tenant-isolation policy becomes a no-op and one org can
// read another's data. Migrations need a privileged role to build the schema;
// the running server must NOT use it. This command, run once after migrations
// with an admin connection, creates a dedicated NOSUPERUSER NOBYPASSRLS role
// and grants it exactly the DML/EXECUTE privileges the server needs — the same
// role the integration tests connect as (see cmd/tests/testenv appPoolFor).
//
// Usage:
//
//	DATABASE_URL=<admin conn> APP_DB_ROLE=bb_app APP_DB_PASSWORD=... \
//	  go run ./cmd/setupapprole
//
// APP_DB_ROLE defaults to "bb_app". APP_DB_PASSWORD is required. It is
// idempotent: re-running updates the password and re-applies grants.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	adminURL := os.Getenv("DATABASE_URL")
	if adminURL == "" {
		log.Fatal("DATABASE_URL (an admin/owner connection) is required")
	}
	role := os.Getenv("APP_DB_ROLE")
	if role == "" {
		role = "bb_app"
	}
	if !validIdent(role) {
		log.Fatalf("APP_DB_ROLE %q is not a valid identifier", role)
	}
	password := os.Getenv("APP_DB_PASSWORD")
	if password == "" {
		log.Fatal("APP_DB_PASSWORD is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, adminURL)
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	// Create-or-update the role, then (re)apply grants. The role name is a
	// validated identifier so it is safe to interpolate; the password goes
	// through a parameter-free quote_literal to avoid any escaping pitfalls.
	stmts := []string{
		fmt.Sprintf(`DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = %s) THEN
    EXECUTE format('CREATE ROLE %s LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %%L', %s);
  ELSE
    EXECUTE format('ALTER ROLE %s WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %%L', %s);
  END IF;
END $$;`, quoteLit(role), role, quoteLit(password), role, quoteLit(password)),
		fmt.Sprintf(`GRANT USAGE ON SCHEMA public TO %s`, role),
		fmt.Sprintf(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %s`, role),
		fmt.Sprintf(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %s`, role),
		fmt.Sprintf(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %s`, role),
		fmt.Sprintf(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %s`, role),
		fmt.Sprintf(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %s`, role),
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			log.Fatalf("apply role setup: %v", err)
		}
	}
	log.Printf("app role %q ready (NOSUPERUSER NOBYPASSRLS, DML+EXECUTE on public) — point the server's DATABASE_URL at it", role)
}

// validIdent allows the conservative set of characters a Postgres role name may
// safely take without quoting: lowercase letters, digits, and underscore.
func validIdent(s string) bool {
	if s == "" || len(s) > 63 {
		return false
	}
	for i, r := range s {
		ok := r == '_' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9' && i > 0)
		if !ok {
			return false
		}
	}
	return true
}

// quoteLit wraps a string as a SQL single-quoted literal (doubling embedded
// quotes), for the role name inside the DO block's IF EXISTS check.
func quoteLit(s string) string {
	out := make([]byte, 0, len(s)+2)
	out = append(out, '\'')
	for i := 0; i < len(s); i++ {
		if s[i] == '\'' {
			out = append(out, '\'')
		}
		out = append(out, s[i])
	}
	out = append(out, '\'')
	return string(out)
}
