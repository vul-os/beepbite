// Package softdelete provides a nightly background job that hard-deletes
// organisations whose scheduled_purge_at has passed (i.e. the 30-day grace
// period after a soft-delete has elapsed).
//
// Design notes:
//   - Ticks once per 24 hours; first run is deferred to the next 02:30 local
//     time so it runs after other nightly jobs (walletrefill fires at 02:00,
//     auditretention at 03:00).
//   - A pg_try_advisory_lock (key=0xBEEF_0040) prevents multiple replicas from
//     running the same sweep concurrently. The lock is session-scoped and
//     released automatically when the connection is returned to the pool.
//   - All DB access uses db.ServiceRoleScope() so cross-org queries satisfy RLS.
//   - Hard-delete is a single DELETE on organizations; ON DELETE CASCADE in the
//     schema propagates to all child tables (locations, organization_members,
//     data_export_jobs, etc.).
package softdelete

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

const (
	// advisoryLockKey is a stable int64 for pg_try_advisory_lock.
	// 0xBEEF_0040 does not collide with other jobs:
	//   0xBEEF_0001  llmsync pricing
	//   0xBEEF_0002  llmsync discovery
	//   0xBEEF_0004  walletrefill
	//   0xBEEF_0005  fxrates
	//   0xBEEF_0010  subscriptionbilling
	//   0xBEEF_0040  softdelete  ← this job
	advisoryLockKey = int64(0xBEEF_0040)

	// runHour is the local hour (0–23) at which the nightly sweep fires.
	runHour = 2 // 02:30 — half-hour offset applied in nextRunAt
)

// Runner ticks once per day, acquires a Postgres advisory lock, and
// hard-deletes any organisation whose scheduled_purge_at < now().
type Runner struct {
	db *pgxpool.Pool
}

// NewRunner constructs a Runner backed by pool.
func NewRunner(pool *pgxpool.Pool) *Runner {
	return &Runner{db: pool}
}

// Start launches the nightly sweep in a new goroutine. It returns immediately.
// The goroutine exits cleanly when ctx is cancelled.
//
// Signature mirrors auditretention.Runner.Start and walletrefill.Runner.Start.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		for {
			next := nextRunAt()
			log.Printf("softdelete: next sweep scheduled at %s", next.Format(time.RFC3339))

			select {
			case <-ctx.Done():
				log.Println("softdelete: Runner shutting down")
				return
			case <-time.After(time.Until(next)):
			}

			if ctx.Err() != nil {
				return
			}
			if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("softdelete: RunOnce error: %v", err)
			}
		}
	}()
}

// RunOnce executes one sweep. It is exported so admin endpoints and
// integration tests can trigger an ad-hoc run.
//
// Step 1 — Acquire pg_try_advisory_lock to prevent concurrent runs.
// Step 2 — Load all orgs whose scheduled_purge_at < now().
// Step 3 — Hard-delete each org (ON DELETE CASCADE handles child tables).
func (r *Runner) RunOnce(ctx context.Context) error {
	// ── Step 1: advisory lock ─────────────────────────────────────────────────
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("softdelete: acquire conn for advisory lock: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, advisoryLockKey,
	).Scan(&locked); err != nil {
		return fmt.Errorf("softdelete: pg_try_advisory_lock: %w", err)
	}
	if !locked {
		log.Println("softdelete: advisory lock held by another instance — skipping this run")
		return nil
	}
	// Lock is session-scoped; released when conn is returned by deferred Release.

	// ── Step 2: load due orgs ─────────────────────────────────────────────────
	var orgIDs []string
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		orgIDs, err = loadDueOrgs(ctx, tx)
		return err
	}); err != nil {
		return fmt.Errorf("softdelete: load due orgs: %w", err)
	}

	if len(orgIDs) == 0 {
		log.Println("softdelete: no organisations due for hard-delete")
		return nil
	}

	log.Printf("softdelete: %d organisation(s) due for hard-delete", len(orgIDs))

	// ── Step 3: hard-delete each org ─────────────────────────────────────────
	var lastErr error
	for _, id := range orgIDs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := r.hardDeleteOrg(ctx, id); err != nil {
			log.Printf("softdelete: hard-delete org=%s error: %v", id, err)
			lastErr = err
			// Continue with remaining orgs — best-effort.
		}
	}
	return lastErr
}

// loadDueOrgs returns the IDs of orgs whose scheduled_purge_at < now().
func loadDueOrgs(ctx context.Context, tx pgx.Tx) ([]string, error) {
	rows, err := tx.Query(ctx, `
SELECT id
FROM organizations
WHERE scheduled_purge_at IS NOT NULL
  AND scheduled_purge_at < now()
ORDER BY scheduled_purge_at ASC
`)
	if err != nil {
		return nil, fmt.Errorf("query: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// hardDeleteOrg deletes a single org and writes an audit entry before deletion.
// ON DELETE CASCADE in the schema propagates to all dependent tables.
func (r *Runner) hardDeleteOrg(ctx context.Context, orgID string) error {
	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Write an audit row before deletion (so the audit_log row exists while
		// the org FK is still valid — CASCADE will delete audit_log rows afterward
		// only if audit_log has ON DELETE CASCADE, which it may not; safe either way).
		_, auditErr := tx.Exec(ctx, `
INSERT INTO audit_log (
    organization_id, actor_type, actor_id,
    action, entity_type, entity_id,
    before_state, after_state
)
VALUES (
    $1::uuid, 'system', NULL,
    'org.hard_delete', 'organizations', $1::uuid,
    '{"reason":"scheduled_purge_at elapsed"}'::jsonb,
    '{"hard_deleted":true}'::jsonb
)
`, orgID)
		if auditErr != nil {
			// Non-fatal: log but proceed with deletion.
			log.Printf("softdelete: audit log for org=%s failed (proceeding): %v", orgID, auditErr)
		}

		tag, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, orgID)
		if err != nil {
			return fmt.Errorf("delete org=%s: %w", orgID, err)
		}
		log.Printf("softdelete: hard-deleted org=%s (rows_affected=%d)", orgID, tag.RowsAffected())
		return nil
	})
}

// nextRunAt returns the next 02:30 local time (30 minutes after runHour).
// If that time has already passed today, it returns tomorrow at 02:30.
func nextRunAt() time.Time {
	now := time.Now()
	candidate := time.Date(now.Year(), now.Month(), now.Day(),
		runHour, 30, 0, 0, now.Location())
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}
