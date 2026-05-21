package llmsync

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

const (
	// pricingInterval is how often the nightly pricing sync runs.
	pricingInterval = 24 * time.Hour
	// pricingRunHour is the local hour (0-23) at which the first pricing sync
	// fires each day.  Subsequent runs are pricingInterval apart.
	pricingRunHour = 2 // 02:00 local time

	// discoveryInterval is how often the model-discovery sweep runs.
	discoveryInterval = 6 * time.Hour

	// advisoryLockPricing and advisoryLockDiscovery are Postgres advisory lock
	// IDs used to ensure only one instance of each job runs across replicas.
	advisoryLockPricing   = int64(0xBEEF_0001)
	advisoryLockDiscovery = int64(0xBEEF_0002)
)

// Runner owns both the pricing-sync and model-discovery background loops.
type Runner struct {
	db *pgxpool.Pool
}

// NewRunner constructs a Runner backed by the given connection pool.
// No network I/O happens during construction.
func NewRunner(pool *pgxpool.Pool) *Runner {
	return &Runner{db: pool}
}

// Start launches both background loops in separate goroutines and returns
// immediately.  Both loops exit cleanly when ctx is cancelled.
//
//   - Pricing sync: fires once at the next 02:00 local time, then every 24 h.
//   - Discovery:    fires once immediately on startup, then every 6 h.
func (r *Runner) Start(ctx context.Context) {
	// Pricing: first run at next 02:00, then nightly.
	go func() {
		first := nextDailyAt(pricingRunHour)
		log.Printf("llmsync: pricing sync scheduled at %s (then every 24h)", first.Format(time.RFC3339))

		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Until(first)):
		}

		if err := r.RunPricingOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("llmsync: pricing sync error: %v", err)
		}

		ticker := time.NewTicker(pricingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Println("llmsync: pricing sync loop shutting down")
				return
			case <-ticker.C:
				if err := r.RunPricingOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("llmsync: pricing sync error: %v", err)
				}
			}
		}
	}()

	// Discovery: immediate boot run, then every 6 h.
	go func() {
		if err := r.RunDiscoveryOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("llmsync: discovery error on startup: %v", err)
		}

		ticker := time.NewTicker(discoveryInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Println("llmsync: discovery loop shutting down")
				return
			case <-ticker.C:
				if err := r.RunDiscoveryOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("llmsync: discovery error: %v", err)
				}
			}
		}
	}()
}

// ---------------------------------------------------------------------------
// RunPricingOnce
// ---------------------------------------------------------------------------

// RunPricingOnce performs one complete pricing sync:
//  1. Acquires a Postgres advisory lock so only one replica runs at a time.
//  2. Fetches the litellm manifest (or falls back to the local snapshot).
//  3. UPSERTs all rows into llm_model_pricing inside a service-role tx.
func (r *Runner) RunPricingOnce(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	// Acquire advisory lock (non-blocking: skip if another replica holds it).
	locked, err := r.tryAdvisoryLock(ctx, advisoryLockPricing)
	if err != nil {
		return err
	}
	if !locked {
		log.Println("llmsync: pricing sync skipped — advisory lock held by another instance")
		return nil
	}
	defer func() { _ = r.releaseAdvisoryLock(ctx, advisoryLockPricing) }()

	rows := pricingRows(ctx)
	if len(rows) == 0 {
		log.Println("llmsync: pricing sync: no rows to upsert")
		return nil
	}

	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return upsertModels(ctx, tx, rows)
	}); err != nil {
		return err
	}

	log.Printf("llmsync: pricing sync: upserted %d model row(s)", len(rows))
	return nil
}

// ---------------------------------------------------------------------------
// RunDiscoveryOnce
// ---------------------------------------------------------------------------

// RunDiscoveryOnce performs one model-discovery sweep:
//  1. Acquires a Postgres advisory lock so only one replica runs at a time.
//  2. Calls each enabled provider's API (gated by env-key presence).
//  3. For every returned model, inserts a zero-cost row if not already priced.
func (r *Runner) RunDiscoveryOnce(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	locked, err := r.tryAdvisoryLock(ctx, advisoryLockDiscovery)
	if err != nil {
		return err
	}
	if !locked {
		log.Println("llmsync: discovery skipped — advisory lock held by another instance")
		return nil
	}
	defer func() { _ = r.releaseAdvisoryLock(ctx, advisoryLockDiscovery) }()

	results := runDiscovery(ctx)
	if len(results) == 0 {
		return nil
	}

	total := 0
	for _, res := range results {
		for _, modelID := range res.models {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
				return insertIfMissing(ctx, tx, res.provider, modelID)
			}); err != nil {
				log.Printf("llmsync: discovery insertIfMissing %s/%s: %v", res.provider, modelID, err)
				continue
			}
			total++
		}
	}

	log.Printf("llmsync: discovery: ensured %d model row(s) across %d provider(s)", total, len(results))
	return nil
}

// ---------------------------------------------------------------------------
// Advisory lock helpers
// ---------------------------------------------------------------------------

// tryAdvisoryLock attempts to acquire a session-level Postgres advisory lock
// without waiting (pg_try_advisory_lock).  Returns (true, nil) on success,
// (false, nil) when the lock is already held by another session.
func (r *Runner) tryAdvisoryLock(ctx context.Context, lockID int64) (bool, error) {
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return false, err
	}
	defer conn.Release()

	var ok bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, lockID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// releaseAdvisoryLock releases the session-level advisory lock identified by
// lockID.  Errors are logged but not propagated (called from defer).
func (r *Runner) releaseAdvisoryLock(ctx context.Context, lockID int64) error {
	// Use a background context in case the caller's ctx was already cancelled.
	releaseCtx := context.Background()
	conn, err := r.db.Acquire(releaseCtx)
	if err != nil {
		return err
	}
	defer conn.Release()

	_, err = conn.Exec(releaseCtx, `SELECT pg_advisory_unlock($1)`, lockID)
	return err
}

// ---------------------------------------------------------------------------
// Scheduling helper
// ---------------------------------------------------------------------------

// nextDailyAt returns the next wall-clock time that the given hour falls on.
// If the current local time is already at or past that hour today, the result
// is tomorrow at that hour.
func nextDailyAt(hour int) time.Time {
	now := time.Now()
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, now.Location())
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}
