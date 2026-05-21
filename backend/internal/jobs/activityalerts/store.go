// Package activityalerts — store.go holds the DB queries for the activity
// alerts runner.
package activityalerts

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ─── Void surge detection ────────────────────────────────────────────────────

// voidSurgeHit is returned when a location exceeds the void threshold.
type voidSurgeHit struct {
	OrgID      string
	LocationID string
	VoidCount  int64
}

// queryVoidSurges returns locations where the number of void order_adjustments
// in the window [since, now) meets or exceeds threshold.
//
// Tables: order_adjustments (adjustment_type='void', created_at)
//
//	JOIN orders (location_id, organization_id)
func queryVoidSurges(ctx context.Context, pool *pgxpool.Pool, since time.Time, threshold int) ([]voidSurgeHit, error) {
	const q = `
SELECT
    o.organization_id,
    o.location_id,
    COUNT(*)::bigint AS void_count
FROM order_adjustments oa
JOIN orders o ON o.id = oa.order_id
WHERE oa.adjustment_type = 'void'
  AND oa.created_at >= $1
GROUP BY o.organization_id, o.location_id
HAVING COUNT(*) >= $2
ORDER BY void_count DESC
`
	var hits []voidSurgeHit
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, since, threshold)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var h voidSurgeHit
			if err := rows.Scan(&h.OrgID, &h.LocationID, &h.VoidCount); err != nil {
				return err
			}
			hits = append(hits, h)
		}
		return rows.Err()
	})
	return hits, err
}

// ─── PIN failure detection ────────────────────────────────────────────────────

// pinFailureHit is returned when a staff member exceeds the PIN failure threshold.
type pinFailureHit struct {
	OrgID          string
	LocationID     string
	StaffID        string
	DisplayName    string
	FailedAttempts int64
}

// queryPINFailures returns staff rows whose failed_login_attempts >= threshold.
//
// SCHEMA NOTE: There is no per-device PIN-attempt table.  staff.failed_login_attempts
// is a cumulative counter reset on successful login.  It serves as the best
// available proxy for "failed PIN attempts on one device."
//
// Tables: staff (failed_login_attempts, location_id, id, display_name, first_name, last_name)
//
//	JOIN locations (organization_id)
func queryPINFailures(ctx context.Context, pool *pgxpool.Pool, threshold int) ([]pinFailureHit, error) {
	const q = `
SELECT
    l.organization_id,
    s.location_id,
    s.id                                                AS staff_id,
    COALESCE(s.display_name, s.first_name || ' ' || s.last_name, s.id::text) AS display_name,
    s.failed_login_attempts::bigint                    AS failed_attempts
FROM staff s
JOIN locations l ON l.id = s.location_id
WHERE s.failed_login_attempts >= $1
  AND s.is_active = true
ORDER BY s.failed_login_attempts DESC
`
	var hits []pinFailureHit
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, threshold)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var h pinFailureHit
			if err := rows.Scan(&h.OrgID, &h.LocationID, &h.StaffID, &h.DisplayName, &h.FailedAttempts); err != nil {
				return err
			}
			hits = append(hits, h)
		}
		return rows.Err()
	})
	return hits, err
}

// ─── Wallet drop detection ───────────────────────────────────────────────────

// walletDropHit is returned when an org's wallet balance has dropped more than
// the configured percentage compared to the balance at the start of the window.
type walletDropHit struct {
	OrgID         string
	BalanceBefore int64 // balance at start of window (estimated via transactions)
	BalanceNow    int64 // current balance_cents
	DropPct       int64 // integer percentage drop, e.g. 60 means 60%
}

// queryWalletDrops returns orgs whose wallet balance has dropped by more than
// dropPctThreshold % since [since].
//
// Balance-before is estimated as: balance_now + net_debits_since
// where net_debits_since = SUM of debit wallet_transactions in the window.
//
// Tables: org_wallets (org_id, balance_cents)
//
//	wallet_transactions (org_id, amount_cents, kind, created_at)
//	  kind IN ('debit') reduces balance; 'credit' increases it.
func queryWalletDrops(ctx context.Context, pool *pgxpool.Pool, since time.Time, dropPctThreshold int) ([]walletDropHit, error) {
	// net_change = SUM of signed amounts in the window.
	// wallet_transactions.amount_cents is always positive; kind determines sign.
	// balance_before = balance_now - net_change
	// drop = balance_before - balance_now  (only when positive, i.e. balance fell)
	// drop_pct = 100 * drop / balance_before
	const q = `
WITH wallet_net AS (
    SELECT
        wt.org_id,
        COALESCE(SUM(
            CASE wt.kind
                WHEN 'credit' THEN  wt.amount_cents
                WHEN 'debit'  THEN -wt.amount_cents
                ELSE 0
            END
        ), 0) AS net_change_cents
    FROM wallet_transactions wt
    WHERE wt.created_at >= $1
    GROUP BY wt.org_id
)
SELECT
    ow.org_id,
    -- balance_before = current balance minus the net change that occurred in the window
    (ow.balance_cents - COALESCE(wn.net_change_cents, 0))   AS balance_before,
    ow.balance_cents                                          AS balance_now,
    CASE
        WHEN (ow.balance_cents - COALESCE(wn.net_change_cents, 0)) > 0
        THEN (100 * ((ow.balance_cents - COALESCE(wn.net_change_cents, 0)) - ow.balance_cents)
              / (ow.balance_cents - COALESCE(wn.net_change_cents, 0)))
        ELSE 0
    END AS drop_pct
FROM org_wallets ow
LEFT JOIN wallet_net wn ON wn.org_id = ow.org_id
WHERE
    -- Only consider wallets that had a positive balance before the window.
    (ow.balance_cents - COALESCE(wn.net_change_cents, 0)) > 0
    -- The balance must have actually fallen (net_change is negative).
    AND COALESCE(wn.net_change_cents, 0) < 0
    -- The percentage drop must meet or exceed the threshold.
    AND (100 * ((ow.balance_cents - COALESCE(wn.net_change_cents, 0)) - ow.balance_cents)
         / (ow.balance_cents - COALESCE(wn.net_change_cents, 0))) >= $2
ORDER BY drop_pct DESC
`
	var hits []walletDropHit
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, since, dropPctThreshold)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var h walletDropHit
			if err := rows.Scan(&h.OrgID, &h.BalanceBefore, &h.BalanceNow, &h.DropPct); err != nil {
				return err
			}
			hits = append(hits, h)
		}
		return rows.Err()
	})
	return hits, err
}
