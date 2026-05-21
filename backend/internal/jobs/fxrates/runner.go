package fxrates

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// advisoryLockKey is a stable int64 that uniquely identifies this job for
// pg_try_advisory_lock.  0xBEEF_0005 does not collide with other jobs:
//
//	0xBEEF_0001  llmsync pricing
//	0xBEEF_0002  llmsync discovery
//	0xBEEF_0004  walletrefill
//	0xBEEF_0005  fxrates  ← this job
const advisoryLockKey = int64(0xBEEF_0005)

// defaultInterval is the fetch cadence when FX_FETCH_INTERVAL is not set.
const defaultInterval = time.Hour

// Runner fetches USD-based exchange rates on startup and every
// FX_FETCH_INTERVAL, then upserts them into the exchange_rates table.
// A pg_try_advisory_lock prevents concurrent runs when multiple replicas
// are deployed.
type Runner struct {
	db       *pgxpool.Pool
	interval time.Duration
}

// NewRunner constructs a Runner backed by pool.  The fetch interval is read
// from the FX_FETCH_INTERVAL environment variable (e.g. "30m", "2h"); it
// defaults to 1h when the variable is absent or invalid.
//
// Wiring in main.go:
//
//	fxRunner := fxrates.NewRunner(pool)
//	fxRunner.Start(ctx)
func NewRunner(pool *pgxpool.Pool) *Runner {
	interval := defaultInterval
	if raw := os.Getenv("FX_FETCH_INTERVAL"); raw != "" {
		if secs, err := strconv.ParseFloat(raw, 64); err == nil {
			// Accept bare seconds for simple Docker-compose overrides.
			interval = time.Duration(secs * float64(time.Second))
		} else if d, err := time.ParseDuration(raw); err == nil {
			interval = d
		} else {
			log.Printf("fxrates: invalid FX_FETCH_INTERVAL=%q; using default %s", raw, defaultInterval)
		}
	}
	if interval <= 0 {
		interval = defaultInterval
	}
	return &Runner{db: pool, interval: interval}
}

// Start launches the background fetch loop in a new goroutine and returns
// immediately.  The loop:
//
//  1. Runs once immediately on boot so the table is populated before any
//     request tries to read it.
//  2. Then ticks every interval (FX_FETCH_INTERVAL, default 1 h).
//  3. Exits cleanly when ctx is cancelled.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		log.Printf("fxrates: runner started (interval=%s)", r.interval)

		// Immediate boot run so the table is populated from the start.
		if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("fxrates: RunOnce (boot) error: %v", err)
		}

		ticker := time.NewTicker(r.interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("fxrates: Runner shutting down")
				return
			case <-ticker.C:
				if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("fxrates: RunOnce error: %v", err)
				}
			}
		}
	}()
}

// RunOnce performs a single fetch+upsert cycle.  It is exported so admin
// endpoints or integration tests can trigger an immediate refresh.
//
// Steps:
//  1. Acquire pg_try_advisory_lock — skip gracefully if another instance holds it.
//  2. Fetch rates from frankfurter.app (or use the hardcoded fallback on error).
//  3. UPSERT one exchange_rates row per quote currency inside a service-role tx.
//     expires_at is set to now() + 1.5 × interval so rows remain valid through
//     at least one missed fetch.
func (r *Runner) RunOnce(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	// ── Step 1: advisory lock ─────────────────────────────────────────────────
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("fxrates: acquire conn for advisory lock: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, advisoryLockKey,
	).Scan(&locked); err != nil {
		return fmt.Errorf("fxrates: pg_try_advisory_lock: %w", err)
	}
	if !locked {
		log.Println("fxrates: advisory lock held by another instance — skipping this run")
		return nil
	}
	// Lock is session-scoped; released when conn returns to the pool (deferred above).

	// ── Step 2: fetch rates ───────────────────────────────────────────────────
	rates, err := fetchRates(ctx)
	if err != nil {
		// fetchRates only returns an error for context cancellation; network
		// failures are already handled internally and return fallback data.
		return fmt.Errorf("fxrates: fetchRates: %w", err)
	}

	source := "frankfurter"
	if len(rates) > 0 && rates[0].Source == "fallback" {
		source = "fallback"
		log.Printf("fxrates: using hardcoded fallback rates (fetch failed)")
	} else {
		log.Printf("fxrates: fetched %d rate(s) from frankfurter.app", len(rates))
	}
	_ = source // informational only; each rateResult carries its own Source field

	// ── Step 3: upsert ───────────────────────────────────────────────────────
	expiresAt := time.Now().UTC().Add(time.Duration(float64(r.interval) * 1.5))

	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		for _, rr := range rates {
			if err := upsertRate(ctx, tx, rr.QuoteCode, rr.Rate, rr.Source, expiresAt); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("fxrates: upsert: %w", err)
	}

	log.Printf("fxrates: upserted %d exchange_rate row(s) (expires_at=%s)",
		len(rates), expiresAt.Format(time.RFC3339))
	return nil
}
