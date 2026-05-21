// Package eodemail provides a daily end-of-day email summary job.
//
// Design notes:
//   - Runs once per day at 21:00 local time (after the typical close-of-business
//     window) by waiting for the next occurrence of that hour, matching the
//     nextRunAt pattern used by auditretention and dunning.
//   - A pg_try_advisory_lock (key=0xBEEF_0020) prevents concurrent runs when
//     multiple replicas are deployed. The lock is session-scoped and released
//     automatically when the dedicated connection is returned to the pool.
//   - All DB reads use db.ServiceRoleScope() (required for cross-org reads and
//     audit_log INSERTs per RLS policies).
//   - The email is sent via the existing internal/email Registry, resolved
//     per-location.  Errors on individual locations are logged and do not
//     abort the sweep.
//
// SCHEMA FLAG — locations.eod_email_enabled MISSING:
//
//	The column locations.eod_email_enabled (boolean NOT NULL DEFAULT true) does
//	not exist in the current schema.  Until it is added via migration, this job
//	defaults to sending the summary for ALL active locations (as if the
//	preference were ON).  Once the column is added, remove the flag comment and
//	use the column in the loadActiveLocations query.
//
//	Required migration (do NOT add here):
//	  ALTER TABLE locations
//	    ADD COLUMN IF NOT EXISTS eod_email_enabled boolean NOT NULL DEFAULT true;
package eodemail

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/email"
)

const (
	// advisoryLockKey is a stable int64 that uniquely identifies this job for
	// pg_try_advisory_lock.  0xBEEF_0020 does not collide with existing jobs:
	//
	//  0xBEEF_0001  llmsync pricing
	//  0xBEEF_0002  llmsync discovery
	//  0xBEEF_0004  walletrefill
	//  0xBEEF_0005  fxrates
	//  0xBEEF_0010  subscriptionbilling
	//  0xBEEF_0020  eodemail  ← this job
	advisoryLockKey = int64(0xBEEF_0020)

	// runHour is the local hour (0–23) at which the daily summary fires.
	// 21:00 captures a full trading day while still arriving in the owner's
	// inbox the same evening.
	runHour = 21
)

// Runner sends a daily end-of-day sales summary email to the owner of each
// active location.
type Runner struct {
	db       *pgxpool.Pool
	registry email.Registry
}

// NewRunner constructs a Runner.
//
//   - pool is the pgxpool.Pool used for all DB access.
//   - registry resolves the email Provider per location.
func NewRunner(pool *pgxpool.Pool, registry email.Registry) *Runner {
	return &Runner{db: pool, registry: registry}
}

// Start launches the daily sweep in a new goroutine and returns immediately.
// The goroutine exits cleanly when ctx is cancelled.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		for {
			next := nextRunAt(runHour)
			log.Printf("eodemail: next sweep scheduled at %s", next.Format(time.RFC3339))

			select {
			case <-ctx.Done():
				log.Println("eodemail: Runner shutting down")
				return
			case <-time.After(time.Until(next)):
			}

			if ctx.Err() != nil {
				return
			}
			if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("eodemail: RunOnce error: %v", err)
			}
		}
	}()
}

// RunOnce immediately executes one sweep.  It is exported so admin endpoints
// and integration tests can trigger an ad-hoc run.
//
// Steps:
//  1. Acquire pg_try_advisory_lock — skip gracefully if another instance holds it.
//  2. Load all active locations (with their org's owner email address).
//  3. For each location compute today's day KPIs (gross, net, tax, tips, orders,
//     new customers) and email the owner.
func (r *Runner) RunOnce(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	// ── Step 1: advisory lock ─────────────────────────────────────────────────
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("eodemail: acquire conn for advisory lock: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, advisoryLockKey,
	).Scan(&locked); err != nil {
		return fmt.Errorf("eodemail: pg_try_advisory_lock: %w", err)
	}
	if !locked {
		log.Println("eodemail: advisory lock held by another instance — skipping this run")
		return nil
	}

	// ── Step 2: load active locations ────────────────────────────────────────
	locs, err := loadActiveLocations(ctx, r.db)
	if err != nil {
		return fmt.Errorf("eodemail: load locations: %w", err)
	}
	if len(locs) == 0 {
		log.Println("eodemail: no active locations — nothing to send")
		return nil
	}
	log.Printf("eodemail: sending summaries for %d location(s)", len(locs))

	// ── Step 3: per-location summary + email ─────────────────────────────────
	now := time.Now().UTC()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	dayEnd := dayStart.Add(24 * time.Hour)

	var lastErr error
	for _, loc := range locs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := r.processLocation(ctx, loc, dayStart, dayEnd); err != nil {
			log.Printf("eodemail: location=%s (%s): %v", loc.LocationID, loc.LocationName, err)
			lastErr = err
		}
	}
	return lastErr
}

// processLocation computes the day KPIs for one location and emails the owner.
func (r *Runner) processLocation(ctx context.Context, loc locationRow, dayStart, dayEnd time.Time) error {
	// Compute day KPIs.
	var kpi dayKPI
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		kpi, err = queryDayKPI(ctx, tx, loc.LocationID, dayStart, dayEnd)
		return err
	}); err != nil {
		return fmt.Errorf("query KPI: %w", err)
	}

	// Resolve email provider for this location.
	provider, _, err := r.registry.For(ctx, loc.LocationID)
	if err != nil {
		if errors.Is(err, email.ErrProviderNotConfigured) {
			log.Printf("eodemail: location=%s — no email provider configured, skipping", loc.LocationID)
			return nil
		}
		return fmt.Errorf("resolve email provider: %w", err)
	}

	if loc.OwnerEmail == "" {
		log.Printf("eodemail: location=%s — no owner email found, skipping", loc.LocationID)
		return nil
	}

	msg := buildEmailMessage(loc, kpi, dayStart)
	if sendErr := provider.Send(ctx, msg); sendErr != nil {
		return fmt.Errorf("send email to %s: %w", loc.OwnerEmail, sendErr)
	}

	log.Printf("eodemail: location=%s sent summary to %s (orders=%d gross=%d net=%d)",
		loc.LocationID, loc.OwnerEmail, kpi.OrderCount, kpi.GrossCents, kpi.NetCents)
	return nil
}

// buildEmailMessage constructs the email.Message for one location summary.
func buildEmailMessage(loc locationRow, kpi dayKPI, day time.Time) email.Message {
	dateStr := day.Format("2006-01-02")
	subject := fmt.Sprintf("End-of-Day Summary — %s — %s", loc.LocationName, dateStr)

	html := fmt.Sprintf(`<h2>End-of-Day Summary</h2>
<p><strong>Location:</strong> %s<br>
<strong>Date:</strong> %s</p>
<table>
  <tr><td>Orders</td><td>%d</td></tr>
  <tr><td>Gross sales</td><td>%s %s</td></tr>
  <tr><td>Net sales (excl. tax)</td><td>%s %s</td></tr>
  <tr><td>Tax collected</td><td>%s %s</td></tr>
  <tr><td>Tips</td><td>%s %s</td></tr>
  <tr><td>New customers</td><td>%d</td></tr>
</table>
<p style="color:#888;font-size:12px">Sent automatically by BeepBite.</p>`,
		loc.LocationName, dateStr,
		kpi.OrderCount,
		loc.CurrencyCode, centsToStr(kpi.GrossCents),
		loc.CurrencyCode, centsToStr(kpi.NetCents),
		loc.CurrencyCode, centsToStr(kpi.TaxCents),
		loc.CurrencyCode, centsToStr(kpi.TipsCents),
		kpi.NewCustomers,
	)

	text := fmt.Sprintf("End-of-Day Summary — %s — %s\n\nOrders: %d\nGross: %s %s\nNet: %s %s\nTax: %s %s\nTips: %s %s\nNew customers: %d\n\nSent automatically by BeepBite.",
		loc.LocationName, dateStr,
		kpi.OrderCount,
		loc.CurrencyCode, centsToStr(kpi.GrossCents),
		loc.CurrencyCode, centsToStr(kpi.NetCents),
		loc.CurrencyCode, centsToStr(kpi.TaxCents),
		loc.CurrencyCode, centsToStr(kpi.TipsCents),
		kpi.NewCustomers,
	)

	return email.Message{
		To:      loc.OwnerEmail,
		Subject: subject,
		HTML:    html,
		Text:    text,
	}
}

// nextRunAt returns the next wall-clock time at which the given hour (0–23)
// falls.  Mirrors the helper used by auditretention, dunning, and walletrefill.
func nextRunAt(hour int) time.Time {
	now := time.Now()
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, now.Location())
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}

// centsToStr formats an int64 cent value as a decimal string with two decimal
// places (e.g. 12345 → "123.45").  Avoids importing fmt for simple formatting.
func centsToStr(cents int64) string {
	neg := cents < 0
	if neg {
		cents = -cents
	}
	major := cents / 100
	minor := cents % 100
	s := fmt.Sprintf("%d.%02d", major, minor)
	if neg {
		s = "-" + s
	}
	return s
}
