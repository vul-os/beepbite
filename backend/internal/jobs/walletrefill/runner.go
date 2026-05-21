// Package walletrefill provides a nightly background job that automatically
// tops up org wallets whose balance has dropped below the configured threshold.
//
// Design notes:
//   - Ticks once per 24 hours; first run is deferred to the next 02:00 local
//     time so refills happen during a predictable off-peak window.
//   - A pg_try_advisory_lock (key=0xBEEF_AUTOREFILL) prevents multiple replicas
//     from running the same sweep concurrently.  The lock is session-scoped and
//     released automatically when the connection is returned to the pool.
//   - All DB access uses db.ServiceRoleScope() so cross-org reads satisfy RLS.
//   - The Provider.ChargeSaved hook point is clearly marked with TODO; see below.
package walletrefill

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/payments"
)

// advisoryLockKey is a stable int64 that uniquely identifies this job for
// pg_try_advisory_lock.  0xBEEF_00_04 is arbitrary; choose any constant that
// does not collide with other jobs in this codebase.
const advisoryLockKey = int64(0xBEEF_0004)

// runHour is the local hour (0–23) at which the nightly sweep fires.
const runHour = 2 // 02:00 local time

// Runner ticks once per day, acquires a Postgres advisory lock to prevent
// concurrent runs across replicas, and tops up any wallet below its threshold.
type Runner struct {
	db       *pgxpool.Pool
	registry payments.Registry
}

// NewRunner constructs a Runner.
//   - pool is the pgxpool used for all DB operations.
//   - registry is the payments.Registry used to resolve a Provider per wallet.
//     Pass nil if the charge step is not yet wired (the job will log a TODO and
//     leave each topup in 'initiated' status rather than panicking).
func NewRunner(pool *pgxpool.Pool, registry payments.Registry) *Runner {
	return &Runner{db: pool, registry: registry}
}

// Start launches the nightly sweep in a new goroutine.  It returns immediately.
// The goroutine exits cleanly when ctx is cancelled.
//
// Signature mirrors auditretention.Runner.Start and recipecost.Runner.Start.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		for {
			next := nextRunAt(runHour)
			log.Printf("walletrefill: next sweep scheduled at %s", next.Format(time.RFC3339))

			select {
			case <-ctx.Done():
				log.Println("walletrefill: Runner shutting down")
				return
			case <-time.After(time.Until(next)):
			}

			if ctx.Err() != nil {
				return
			}
			if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("walletrefill: RunOnce error: %v", err)
			}
		}
	}()
}

// RunOnce executes one complete sweep of eligible wallets.  It is exported so
// callers (admin endpoints, integration tests) can trigger an ad-hoc run.
//
// Step 1 — Acquire a session-level pg_try_advisory_lock to prevent concurrent
//
//	runs when multiple replicas are deployed.  If the lock is already held by
//	another session, this run is skipped (not an error).
//
// Step 2 — Load all wallets eligible for auto-refill.
// Step 3 — For each wallet: insert a topup row, charge the saved payment
//
//	method, and on success append a wallet_transactions credit.
func (r *Runner) RunOnce(ctx context.Context) error {
	// ── Step 1: advisory lock ────────────────────────────────────────────────
	// Acquire the lock on a dedicated connection (not inside a transaction) so
	// it stays alive for the duration of this sweep.
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("walletrefill: acquire conn for advisory lock: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, advisoryLockKey,
	).Scan(&locked); err != nil {
		return fmt.Errorf("walletrefill: pg_try_advisory_lock: %w", err)
	}
	if !locked {
		log.Println("walletrefill: advisory lock held by another instance — skipping this run")
		return nil
	}
	// Lock is session-scoped; it is released when conn is returned to the pool
	// by the deferred conn.Release() above.

	// ── Step 2: load eligible wallets ────────────────────────────────────────
	var wallets []walletRow
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		wallets, err = loadEligibleWallets(ctx, tx)
		return err
	}); err != nil {
		return fmt.Errorf("walletrefill: load eligible wallets: %w", err)
	}

	if len(wallets) == 0 {
		log.Println("walletrefill: no wallets require refill")
		return nil
	}

	log.Printf("walletrefill: %d wallet(s) eligible for auto-refill", len(wallets))

	// ── Step 3: process each wallet ──────────────────────────────────────────
	var lastErr error
	for _, w := range wallets {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := r.processWallet(ctx, w); err != nil {
			log.Printf("walletrefill: org=%s error: %v", w.OrgID, err)
			lastErr = err
			// Continue processing remaining wallets rather than aborting.
		}
	}
	return lastErr
}

// processWallet handles one wallet:
//  1. Compute top-up amount (target − current balance).
//  2. Insert a wallet_topups row (status='initiated').
//  3. Charge the saved payment method via payments.Provider.ChargeSaved.
//  4. On success: append a wallet_transactions credit row (idempotent via
//     the unique idempotency_key) and mark the topup 'succeeded'.
//  5. On failure: mark the topup 'failed' (dunning job handles retry ladder).
func (r *Runner) processWallet(ctx context.Context, w walletRow) error {
	topupCents := w.TargetCents - w.BalanceCents
	if topupCents <= 0 {
		// Nothing to charge (shouldn't happen given the query filter, but guard anyway).
		return nil
	}

	// ── 2. Insert topup row (status='initiated') ──────────────────────────
	var topupID string
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		topupID, err = insertTopup(ctx, tx, w.OrgID, topupCents, w.CurrencyCode)
		return err
	}); err != nil {
		return fmt.Errorf("insert topup: %w", err)
	}

	log.Printf("walletrefill: org=%s topup=%s amount=%d %s — charging saved method",
		w.OrgID, topupID, topupCents, w.CurrencyCode)

	// ── 3. Charge the saved payment method ───────────────────────────────
	// The idempotency key is the topup UUID so the provider can safely
	// de-duplicate retries without double-charging.
	idempotencyKey := "walletrefill:" + topupID

	// TODO(Wave-19 charge hook): call provider.ChargeSaved here once the
	// payments.Registry can resolve a Provider for an org wallet (currently
	// the registry resolves by locationID, not orgID).  When ready, replace
	// the block below with:
	//
	//   locationID, err := resolveOrgPrimaryLocation(ctx, r.db, w.OrgID)
	//   provider, creds, err := r.registry.For(ctx, locationID)
	//   providerTxnID, err := provider.ChargeSaved(
	//       ctx,
	//       w.AuthorizationCode,           // payment method token
	//       payments.Amount{Cents: topupCents, CurrencyCode: w.CurrencyCode},
	//       idempotencyKey,
	//   )
	//
	// The Provider interface (internal/payments/provider.go line 158) already
	// defines ChargeSaved(ctx, paymentMethodToken, amount, idempotencyKey)
	// (providerTxnID string, err error) — the hook is fully ready; only the
	// locationID resolution for the org wallet is missing.
	//
	// Until the charge is wired, we leave the topup as 'initiated' and log.
	if r.registry == nil {
		log.Printf("walletrefill: org=%s topup=%s — payments.Registry is nil; "+
			"would charge authorization_code=%q for %d %s (idempotency_key=%s)",
			w.OrgID, topupID, w.AuthorizationCode, topupCents, w.CurrencyCode, idempotencyKey)
		// Leave topup in 'initiated' status for the dunning job.
		return nil
	}

	// Registry is configured: attempt the charge.
	//
	// TODO(Wave-19 charge hook — registry.For by orgID): replace the stub
	// below with real provider resolution once a For(orgID) variant exists or
	// the primary locationID is stored on org_wallets.
	log.Printf("walletrefill: org=%s topup=%s — auto-refill: would charge %d %s "+
		"via gateway=%s token=%q (idempotency_key=%s); "+
		"TODO: resolve locationID for org and call registry.For(ctx, locationID)",
		w.OrgID, topupID, topupCents, w.CurrencyCode,
		w.GatewayProvider, w.AuthorizationCode, idempotencyKey)
	// Leave topup in 'initiated' status until the resolution is implemented.
	return nil

	// ── 4 & 5 (reached only once the charge stub above is replaced) ───────
	// On success path (providerTxnID returned without error):
	//
	//   description := fmt.Sprintf("Auto-refill via %s", w.GatewayProvider)
	//   if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
	//       if err := insertWalletTransaction(ctx, tx, w.OrgID, topupCents, topupID, description); err != nil {
	//           return err
	//       }
	//       return markTopupSucceeded(ctx, tx, topupID)
	//   }); err != nil {
	//       return fmt.Errorf("finalise topup: %w", err)
	//   }
	//   log.Printf("walletrefill: org=%s topup=%s succeeded (providerTxnID=%s)", w.OrgID, topupID, providerTxnID)
	//   return nil
	//
	// On failure path (chargeErr != nil):
	//
	//   log.Printf("walletrefill: org=%s topup=%s charge failed: %v", w.OrgID, topupID, chargeErr)
	//   _ = db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
	//       return markTopupFailed(ctx, tx, topupID, chargeErr.Error())
	//   })
	//   return fmt.Errorf("charge saved method: %w", chargeErr)
}

// nextRunAt returns the next wall-clock time that the given hour (0–23) falls
// on.  If the current local time is already past that hour today, the result is
// tomorrow at that hour.  Mirrors the same helper in auditretention.
func nextRunAt(hour int) time.Time {
	now := time.Now()
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, now.Location())
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}
