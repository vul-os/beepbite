// Package subscriptionbilling provides a monthly background job that generates
// subscription_invoices rows for every organisation on a paid tier.
//
// Design notes:
//   - Ticks once per month; first run fires on the 1st of the next calendar
//     month at 01:00 UTC so invoice generation happens at a predictable
//     off-peak time.
//   - A pg_try_advisory_lock (key=0xBEEF_0010) prevents multiple replicas from
//     running the same sweep concurrently.
//   - All DB reads use db.ServiceRoleScope() so cross-org RLS is satisfied.
//   - Invoice rows are inserted as status='issued'.  Actual provider charging
//     (debit org wallet / call payment gateway) is intentionally left as a
//     TODO — this job only generates the invoice record.
package subscriptionbilling

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

// advisoryLockKey is a stable int64 that uniquely identifies this job for
// pg_try_advisory_lock. 0xBEEF_0010 is arbitrary and does not collide with
// other jobs in this codebase (walletrefill=0xBEEF_0004, etc.).
const advisoryLockKey = int64(0xBEEF_0010)

// runHour is the UTC hour (0–23) at which the monthly sweep fires.
const runHour = 1 // 01:00 UTC

// Runner ticks once per month, acquires a Postgres advisory lock to prevent
// concurrent runs across replicas, and generates subscription_invoices rows
// for every org that does not yet have one for the current billing period.
type Runner struct {
	db *pgxpool.Pool
}

// NewRunner constructs a Runner. pool is the pgxpool used for all DB
// operations.
func NewRunner(pool *pgxpool.Pool) *Runner {
	return &Runner{db: pool}
}

// Start launches the monthly sweep in a new goroutine. It returns immediately.
// The goroutine exits cleanly when ctx is cancelled.
//
// Signature mirrors auditretention.Runner.Start and walletrefill.Runner.Start.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		for {
			next := nextMonthlyRunAt(runHour)
			log.Printf("subscriptionbilling: next sweep scheduled at %s", next.Format(time.RFC3339))

			select {
			case <-ctx.Done():
				log.Println("subscriptionbilling: Runner shutting down")
				return
			case <-time.After(time.Until(next)):
			}

			if ctx.Err() != nil {
				return
			}
			if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("subscriptionbilling: RunOnce error: %v", err)
			}
		}
	}()
}

// RunOnce executes one complete billing sweep. It is exported so callers
// (admin endpoints, integration tests) can trigger an ad-hoc run.
//
// Step 1 — Acquire a session-level pg_try_advisory_lock to prevent concurrent
// runs when multiple replicas are deployed. Skips (not an error) if already
// held by another instance.
//
// Step 2 — Determine the current billing period (1st → last day of this month).
//
// Step 3 — Load all orgs on a paid plan that have no invoice for this period.
//
// Step 4 — For each org: look up the USD→local FX rate, compute local_amount_cents,
// and INSERT a subscription_invoices row with status='issued'.
//
// TODO(Wave-11 charge hook): after inserting each invoice, debit the org wallet
// and/or call the payment provider to collect the subscription fee. At that
// point the status should transition from 'issued' → 'paid' on success or
// remain 'issued' for the dunning job to retry.
func (r *Runner) RunOnce(ctx context.Context) error {
	// ── Step 1: advisory lock ────────────────────────────────────────────────
	// Acquire on a dedicated connection (not inside a transaction) so the lock
	// stays alive for the duration of the sweep.
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("subscriptionbilling: acquire conn for advisory lock: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, advisoryLockKey,
	).Scan(&locked); err != nil {
		return fmt.Errorf("subscriptionbilling: pg_try_advisory_lock: %w", err)
	}
	if !locked {
		log.Println("subscriptionbilling: advisory lock held by another instance — skipping")
		return nil
	}
	// Lock is session-scoped; released when conn is returned to pool by defer.

	// ── Step 2: billing period ───────────────────────────────────────────────
	periodStart, periodEnd := currentPeriod()

	// ── Step 3: load eligible orgs ───────────────────────────────────────────
	var orgs []orgPlanRow
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		orgs, err = loadOrgsNeedingInvoice(ctx, tx, periodStart)
		return err
	}); err != nil {
		return fmt.Errorf("subscriptionbilling: load orgs: %w", err)
	}

	if len(orgs) == 0 {
		log.Printf("subscriptionbilling: no invoices to generate for period %s",
			periodStart.Format("2006-01"))
		return nil
	}

	log.Printf("subscriptionbilling: generating %d invoice(s) for period %s",
		len(orgs), periodStart.Format("2006-01"))

	// ── Step 4: generate each invoice ────────────────────────────────────────
	var lastErr error
	for _, org := range orgs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := r.generateInvoice(ctx, org, periodStart, periodEnd); err != nil {
			log.Printf("subscriptionbilling: org=%s error: %v", org.OrgID, err)
			lastErr = err
			// Continue with remaining orgs rather than aborting the sweep.
		}
	}
	return lastErr
}

// generateInvoice handles one org:
//  1. Fetch the latest USD → org-local FX rate.
//  2. Compute local_amount_cents = round(usd_cents * rate).
//  3. INSERT a subscription_invoices row with status='issued'.
func (r *Runner) generateInvoice(ctx context.Context, org orgPlanRow, periodStart, periodEnd time.Time) error {
	var fxRate float64
	var fxFetchedAt time.Time

	// FX lookup runs in a ServiceRoleScope transaction (exchange_rates has no
	// RLS but we use the same pattern for consistency).
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		fxRate, fxFetchedAt, err = fetchLatestRate(ctx, tx, org.LocalCurrency)
		return err
	}); err != nil {
		return fmt.Errorf("subscriptionbilling: fx rate for org=%s currency=%s: %w",
			org.OrgID, org.LocalCurrency, err)
	}

	localCents := roundLocalCents(org.MonthlyFeeCents, fxRate)

	log.Printf(
		"subscriptionbilling: org=%s plan=%s usd=%d %s=%d rate=%.6f rateAt=%s",
		org.OrgID, org.PlanID,
		org.MonthlyFeeCents,
		org.LocalCurrency, localCents,
		fxRate, fxFetchedAt.Format(time.RFC3339),
	)

	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return insertInvoice(
			ctx, tx,
			org.OrgID, org.PlanID,
			periodStart, periodEnd,
			org.MonthlyFeeCents,
			localCents,
			org.LocalCurrency,
			fxRate,
		)
	}); err != nil {
		return err
	}

	log.Printf("subscriptionbilling: invoice inserted for org=%s period=%s",
		org.OrgID, periodStart.Format("2006-01"))

	// TODO(Wave-11 charge hook): debit the org wallet or call the payment
	// gateway here to collect the subscription fee. Example:
	//
	//   provider, creds, err := r.registry.For(ctx, org.OrgID)
	//   if err != nil { return fmt.Errorf("resolve provider: %w", err) }
	//   _, err = provider.ChargeSaved(ctx, creds.Token,
	//       payments.Amount{Cents: localCents, CurrencyCode: org.LocalCurrency},
	//       "subinvoice:"+org.OrgID+":"+periodStart.Format("2006-01"),
	//   )
	//   // On success: update invoice status → 'paid'
	//   // On failure: leave 'issued'; dunning job retries.

	return nil
}

// nextMonthlyRunAt returns the next wall-clock UTC time at which the billing
// sweep should fire: the 1st day of the next calendar month at runHour UTC.
// This guarantees the sweep runs exactly once per billing period.
func nextMonthlyRunAt(hour int) time.Time {
	now := time.Now().UTC()
	// First day of next month.
	first := time.Date(now.Year(), now.Month()+1, 1, hour, 0, 0, 0, time.UTC)
	// If we are already in the first day of the month and before runHour,
	// fire today (first day of the current month).
	thisMonth := time.Date(now.Year(), now.Month(), 1, hour, 0, 0, 0, time.UTC)
	if thisMonth.After(now) {
		return thisMonth
	}
	return first
}
