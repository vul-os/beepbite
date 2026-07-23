package db

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	*pgxpool.Pool
}

// WarnIfRLSBypassed logs a loud warning when the connection's role bypasses
// row-level security — i.e. it is a SUPERUSER or has BYPASSRLS. Postgres
// silently skips ALL RLS for such roles, even under FORCE ROW LEVEL SECURITY,
// so every tenant-isolation policy in this schema becomes ineffective and one
// org can read another's data. The app is meant to connect as a non-superuser,
// non-BYPASSRLS role (mirroring cmd/tests/testenv's bb_app). This is a
// best-effort probe: it never blocks startup. Call it from the app server, NOT
// from cmd/migrate (which legitimately connects as a privileged role to build
// the schema and roles).
func WarnIfRLSBypassed(ctx context.Context, pool *pgxpool.Pool) {
	var role string
	var super, bypass bool
	const q = `SELECT current_user, rolsuper, rolbypassrls
	             FROM pg_roles WHERE rolname = current_user`
	if err := pool.QueryRow(ctx, q).Scan(&role, &super, &bypass); err != nil {
		return
	}
	if !super && !bypass {
		return
	}
	kind := "a SUPERUSER"
	if !super {
		kind = "a BYPASSRLS"
	}
	log.Printf("SECURITY WARNING: connected to Postgres as %q, which is %s role — "+
		"row-level security (tenant isolation) is SILENTLY BYPASSED for this connection, "+
		"even under FORCE ROW LEVEL SECURITY, so every org/user isolation policy is INEFFECTIVE "+
		"and tenants can read each other's data. Run the app as a NOSUPERUSER NOBYPASSRLS role "+
		"in any shared or production deployment.", role, kind)
}

func Open(ctx context.Context, url string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = time.Hour
	cfg.MaxConnIdleTime = 10 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("open pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &DB{Pool: pool}, nil
}
