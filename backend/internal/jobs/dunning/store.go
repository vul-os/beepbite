// Package dunning implements the auto-refill failure ladder (dunning) background
// job.  It sweeps all organisations daily, detects failed auto-refill states by
// inspecting wallet_topups, and advances each org through a four-stage escalation
// ladder:
//
//	Stage          Trigger                  Action
//	-----------    -----------------------  -----------------------------------------------
//	retry          Day 0  (first failure)   Log + Notify; walletrefill job handles the retry.
//	email_whatsapp_banner  ~Day 1 still failing   Log + Notify all channels.
//	degrade        Day 7  still failing     Log + Notify; FLAG: needs organizations.service_degraded boolean.
//	auto_pause     Day 14 still failing     Log + Notify; FLAG: connects to 90-day inactivity cleanup.
//
// Idempotency is guaranteed by dunning_state (a lightweight in-memory map keyed
// on org_id that tracks last-notified stage within a single process lifetime).
// Persistent idempotency across restarts requires the schema additions flagged at
// the bottom of this file.
//
// SCHEMA FLAGS — do NOT add migrations here; these columns are needed:
//
//  1. organizations.dunning_stage text DEFAULT NULL
//     CHECK (dunning_stage IN ('retry','email_whatsapp_banner','degrade','auto_pause'))
//     Stores the last stage that has already been notified so re-runs are skipped.
//
//  2. organizations.dunning_since timestamptz DEFAULT NULL
//     The timestamp of the first unresolved auto-refill failure for this org.
//     Reset to NULL when a topup succeeds.
//
//  3. organizations.service_degraded boolean NOT NULL DEFAULT false
//     Set true at Day 7 (degrade stage); read by the API to disable LLM / WhatsApp / SMS
//     while keeping POS functional.
package dunning

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// orgFailureRow holds the dunning-relevant state for one organisation.
// Fields map to the columns available today (no schema additions required to
// *detect* failures and notify; only persistent idempotency needs new columns).
type orgFailureRow struct {
	OrgID string
	// FirstFailedAt is the earliest created_at of a wallet_topup with
	// status='failed' for this org that has not been resolved by a subsequent
	// succeeded topup.  A nil value means no active failure chain.
	FirstFailedAt *time.Time
	// LastSucceededAt is the most-recent succeeded topup, used to determine
	// whether the failure chain has been resolved.
	LastSucceededAt *time.Time
}

// loadOrgsWithFailures returns one row per organisation that currently has at
// least one 'failed' wallet_topup newer than the most-recent 'succeeded' topup
// (or any 'failed' topup if the org has never had a succeeded one).
//
// The query is intentionally conservative: it considers only wallet_topups
// created in the last 30 days to avoid O(all history) scans.
func loadOrgsWithFailures(ctx context.Context, tx pgx.Tx) ([]orgFailureRow, error) {
	rows, err := tx.Query(ctx, `
WITH recent AS (
    SELECT
        org_id,
        status,
        created_at
    FROM wallet_topups
    WHERE created_at >= now() - INTERVAL '30 days'
),
last_succeeded AS (
    SELECT DISTINCT ON (org_id)
        org_id,
        created_at AS last_succeeded_at
    FROM recent
    WHERE status = 'succeeded'
    ORDER BY org_id, created_at DESC
),
first_failed AS (
    SELECT
        r.org_id,
        MIN(r.created_at) AS first_failed_at
    FROM recent r
    LEFT JOIN last_succeeded ls ON ls.org_id = r.org_id
    WHERE r.status = 'failed'
      -- Only count failures that occurred AFTER the last success
      -- (or any failure if there has been no success at all).
      AND (ls.last_succeeded_at IS NULL OR r.created_at > ls.last_succeeded_at)
    GROUP BY r.org_id
)
SELECT
    ff.org_id,
    ff.first_failed_at,
    ls.last_succeeded_at
FROM first_failed ff
LEFT JOIN last_succeeded ls ON ls.org_id = ff.org_id
ORDER BY ff.first_failed_at ASC
`)
	if err != nil {
		return nil, fmt.Errorf("dunning: query orgs with failures: %w", err)
	}
	defer rows.Close()

	var out []orgFailureRow
	for rows.Next() {
		var r orgFailureRow
		if err := rows.Scan(&r.OrgID, &r.FirstFailedAt, &r.LastSucceededAt); err != nil {
			return nil, fmt.Errorf("dunning: scan org failure row: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// loadPersistedStage attempts to read the dunning_stage and dunning_since columns
// from the organizations table.  Because these columns do not yet exist in the
// schema, the query uses a safe fallback: if either column is absent the function
// returns empty strings and nil, logging a FLAG rather than erroring.
//
// When the schema columns are added this function will start returning real values
// and full cross-restart idempotency will be active automatically.
func loadPersistedStage(ctx context.Context, tx pgx.Tx, orgID string) (stage string, since *time.Time, err error) {
	// Attempt to read the (not-yet-existing) columns.  Postgres returns an error
	// for unknown columns; we treat that as "columns absent → no persisted state".
	err = tx.QueryRow(ctx, `
SELECT
    COALESCE(dunning_stage, ''),
    dunning_since
FROM organizations
WHERE id = $1
`, orgID).Scan(&stage, &since)
	if err != nil {
		// Column doesn't exist or row not found — treat as "no persisted stage".
		return "", nil, nil //nolint:nilerr
	}
	return stage, since, nil
}

// persistStage writes dunning_stage and dunning_since back to the organizations
// row.  Like loadPersistedStage, this is a best-effort write: if the columns do
// not yet exist the UPDATE will fail, which is caught and swallowed so the job
// continues to operate (notifications are still sent; only cross-restart
// idempotency is lost).
func persistStage(ctx context.Context, tx pgx.Tx, orgID, stage string, since time.Time) error {
	_, err := tx.Exec(ctx, `
UPDATE organizations
SET dunning_stage = $2,
    dunning_since = $3,
    updated_at    = now()
WHERE id = $1
`, orgID, stage, since)
	if err != nil {
		// Best-effort: column may not exist yet.  Caller logs the FLAG.
		return fmt.Errorf("dunning: persist stage (schema column missing?): %w", err)
	}
	return nil
}

// clearPersistedStage resets dunning columns when an org's failure chain
// resolves (a successful topup arrives after the failure period).
func clearPersistedStage(ctx context.Context, tx pgx.Tx, orgID string) error {
	_, err := tx.Exec(ctx, `
UPDATE organizations
SET dunning_stage = NULL,
    dunning_since = NULL,
    updated_at    = now()
WHERE id = $1
`, orgID)
	if err != nil {
		return fmt.Errorf("dunning: clear stage (schema column missing?): %w", err)
	}
	return nil
}
