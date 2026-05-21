// Package activityalerts provides a periodic background job that detects
// suspicious per-org activity and emits an email notification + audit_log row.
//
// Detects three alert conditions (thresholds are configurable constants):
//
//  1. Void surge   — ≥ VoidThreshold order_adjustments of type 'void' in a
//     single location within the past VoidWindowHours.
//  2. PIN failures — ≥ PINFailThreshold failed_login_attempts on one staff
//     row (proxy for a device) at any point (column is
//     cumulative and reset on successful login).
//  3. Wallet drop  — org_wallet balance_cents dropped by > WalletDropPct %
//     compared to 24 h ago (via wallet_transactions).
//
// Advisory lock key: 0xBEEF_0030 (does not collide with existing jobs).
//
// SCHEMA NOTE — no dedicated staff_pin_attempts table exists.
// The job uses staff.failed_login_attempts (integer, reset on login) as the
// best available signal for repeated PIN failures on a single device.  A
// per-device PIN-attempt table would provide more granular tracking but is not
// in the current schema.  REPORT: if a staff_pin_attempts table with (staff_id,
// device_id, attempted_at) is added in future, replace the staff query below.
package activityalerts

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

// ─── Configurable thresholds ─────────────────────────────────────────────────

const (
	// VoidThreshold is the minimum number of voids in VoidWindowHours that
	// triggers a void-surge alert for a location.
	VoidThreshold = 10

	// VoidWindowHours is the look-back window (in hours) for void counting.
	VoidWindowHours = 1

	// PINFailThreshold is the minimum value of staff.failed_login_attempts
	// that triggers a PIN-failure alert for a staff member / device.
	PINFailThreshold = 3

	// WalletDropPct is the minimum balance drop (as a percentage of the
	// 24-hour-ago balance) that triggers a wallet-drop alert.
	// E.g. 50 means a drop of more than 50% from the prior balance.
	WalletDropPct = 50

	// WalletDropWindowHours is the look-back window for wallet balance
	// comparison.
	WalletDropWindowHours = 24

	// advisoryLockKey identifies this job for pg_try_advisory_lock.
	// 0xBEEF_0030 does not collide with existing jobs:
	//
	//  0xBEEF_0001  llmsync pricing
	//  0xBEEF_0002  llmsync discovery
	//  0xBEEF_0004  walletrefill
	//  0xBEEF_0005  fxrates
	//  0xBEEF_0010  subscriptionbilling
	//  0xBEEF_0020  eodemail
	//  0xBEEF_0030  activityalerts  ← this job
	advisoryLockKey = int64(0xBEEF_0030)

	// tickInterval is how often the runner checks for suspicious activity.
	tickInterval = 15 * time.Minute
)

// ─── Runner ──────────────────────────────────────────────────────────────────

// Runner periodically scans all orgs for suspicious activity and emits
// email + audit_log notifications.
type Runner struct {
	db       *pgxpool.Pool
	registry email.Registry
}

// NewRunner constructs a Runner.
//
//   - pool is the pgxpool.Pool used for all DB access.
//   - registry resolves the email Provider per location (used to notify the
//     org owner).  Pass nil to disable email notifications (alerts are still
//     written to audit_log).
func NewRunner(pool *pgxpool.Pool, registry email.Registry) *Runner {
	return &Runner{db: pool, registry: registry}
}

// Start launches the periodic sweep in a new goroutine and returns immediately.
// The goroutine exits cleanly when ctx is cancelled.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		log.Printf("activityalerts: runner started (interval=%s)", tickInterval)

		// Run immediately on startup.
		if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("activityalerts: RunOnce (boot) error: %v", err)
		}

		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				log.Println("activityalerts: Runner shutting down")
				return
			case <-ticker.C:
				if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("activityalerts: RunOnce error: %v", err)
				}
			}
		}
	}()
}

// RunOnce immediately executes one sweep across all active orgs/locations.
// Exported so admin endpoints and integration tests can trigger an ad-hoc run.
func (r *Runner) RunOnce(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	// ── Advisory lock ─────────────────────────────────────────────────────────
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("activityalerts: acquire conn for advisory lock: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, advisoryLockKey,
	).Scan(&locked); err != nil {
		return fmt.Errorf("activityalerts: pg_try_advisory_lock: %w", err)
	}
	if !locked {
		log.Println("activityalerts: advisory lock held by another instance — skipping")
		return nil
	}

	// ── Check 1: void surges ─────────────────────────────────────────────────
	if err := r.checkVoidSurges(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("activityalerts: checkVoidSurges: %v", err)
	}

	// ── Check 2: PIN failures ─────────────────────────────────────────────────
	if err := r.checkPINFailures(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("activityalerts: checkPINFailures: %v", err)
	}

	// ── Check 3: wallet balance drops ────────────────────────────────────────
	if err := r.checkWalletDrops(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("activityalerts: checkWalletDrops: %v", err)
	}

	return nil
}

// ─── Check 1: void surges ────────────────────────────────────────────────────

func (r *Runner) checkVoidSurges(ctx context.Context) error {
	since := time.Now().UTC().Add(-VoidWindowHours * time.Hour)
	hits, err := queryVoidSurges(ctx, r.db, since, VoidThreshold)
	if err != nil {
		return fmt.Errorf("query void surges: %w", err)
	}
	for _, h := range hits {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		msg := fmt.Sprintf(
			"Void surge detected: %d voids at location %s (org %s) within the last %d hour(s) — threshold is %d.",
			h.VoidCount, h.LocationID, h.OrgID, VoidWindowHours, VoidThreshold,
		)
		log.Printf("activityalerts: ALERT void_surge org=%s location=%s count=%d", h.OrgID, h.LocationID, h.VoidCount)
		r.emitAlert(ctx, h.OrgID, h.LocationID, "void_surge", msg)
	}
	return nil
}

// ─── Check 2: PIN failures ───────────────────────────────────────────────────

func (r *Runner) checkPINFailures(ctx context.Context) error {
	hits, err := queryPINFailures(ctx, r.db, PINFailThreshold)
	if err != nil {
		return fmt.Errorf("query PIN failures: %w", err)
	}
	for _, h := range hits {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		msg := fmt.Sprintf(
			"Repeated PIN failures: staff %s (%s) at location %s has %d failed login attempt(s) — threshold is %d.",
			h.StaffID, h.DisplayName, h.LocationID, h.FailedAttempts, PINFailThreshold,
		)
		log.Printf("activityalerts: ALERT pin_failures org=%s location=%s staff=%s attempts=%d",
			h.OrgID, h.LocationID, h.StaffID, h.FailedAttempts)
		r.emitAlert(ctx, h.OrgID, h.LocationID, "pin_failures", msg)
	}
	return nil
}

// ─── Check 3: wallet drops ───────────────────────────────────────────────────

func (r *Runner) checkWalletDrops(ctx context.Context) error {
	since := time.Now().UTC().Add(-WalletDropWindowHours * time.Hour)
	hits, err := queryWalletDrops(ctx, r.db, since, WalletDropPct)
	if err != nil {
		return fmt.Errorf("query wallet drops: %w", err)
	}
	for _, h := range hits {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		msg := fmt.Sprintf(
			"Wallet balance drop: org %s balance dropped from %d to %d (%d%% drop) in the last %d hour(s) — threshold is %d%%.",
			h.OrgID, h.BalanceBefore, h.BalanceNow,
			h.DropPct, WalletDropWindowHours, WalletDropPct,
		)
		log.Printf("activityalerts: ALERT wallet_drop org=%s before=%d now=%d drop_pct=%d",
			h.OrgID, h.BalanceBefore, h.BalanceNow, h.DropPct)
		// No location for wallet alerts — pass empty string.
		r.emitAlert(ctx, h.OrgID, "", "wallet_drop", msg)
	}
	return nil
}

// ─── emitAlert: audit_log + email ────────────────────────────────────────────

// emitAlert writes an audit_log row for the alert and, when an email registry
// is available, sends a notification to the org owner.
func (r *Runner) emitAlert(ctx context.Context, orgID, locationID, action, message string) {
	// 1. Write to audit_log (service-role INSERT required by RLS policy).
	if err := r.writeAuditLog(ctx, orgID, locationID, action, message); err != nil {
		log.Printf("activityalerts: writeAuditLog org=%s action=%s: %v", orgID, action, err)
		// Non-fatal: continue to attempt email.
	}

	// 2. Email the org owner.
	if r.registry == nil {
		return
	}
	ownerEmail, locID, err := r.resolveOwnerEmailAndLocation(ctx, orgID, locationID)
	if err != nil || ownerEmail == "" {
		log.Printf("activityalerts: cannot resolve owner email for org=%s: %v", orgID, err)
		return
	}

	provider, _, provErr := r.registry.For(ctx, locID)
	if provErr != nil {
		if errors.Is(provErr, email.ErrProviderNotConfigured) {
			log.Printf("activityalerts: no email provider for location=%s (org=%s)", locID, orgID)
			return
		}
		log.Printf("activityalerts: resolve provider org=%s: %v", orgID, provErr)
		return
	}

	subject := fmt.Sprintf("[BeepBite Alert] %s — %s", humanAction(action), time.Now().UTC().Format("2006-01-02 15:04 UTC"))
	msg := email.Message{
		To:      ownerEmail,
		Subject: subject,
		HTML:    fmt.Sprintf("<h3>Security Alert: %s</h3><p>%s</p><p style=\"color:#888;font-size:12px\">Sent automatically by BeepBite.</p>", humanAction(action), message),
		Text:    fmt.Sprintf("Security Alert: %s\n\n%s\n\nSent automatically by BeepBite.", humanAction(action), message),
	}
	if sendErr := provider.Send(ctx, msg); sendErr != nil {
		log.Printf("activityalerts: send email to %s org=%s action=%s: %v", ownerEmail, orgID, action, sendErr)
	} else {
		log.Printf("activityalerts: alert email sent to %s org=%s action=%s", ownerEmail, orgID, action)
	}
}

// writeAuditLog inserts an audit_log row for the detected alert.
// INSERT requires service_role (audit_log_insert RLS policy).
func (r *Runner) writeAuditLog(ctx context.Context, orgID, locationID, action, reason string) error {
	return db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var locParam *string
		if locationID != "" {
			locParam = &locationID
		}
		_, err := tx.Exec(ctx, `
INSERT INTO audit_log (
    organization_id, location_id,
    actor_type, actor_label,
    action, entity_type,
    reason, metadata
) VALUES (
    $1::uuid, $2::uuid,
    'system', 'activityalerts-job',
    $3, 'alert',
    $4, '{}'::jsonb
)`,
			orgID, locParam, action, reason,
		)
		return err
	})
}

// resolveOwnerEmailAndLocation returns the owner email and a location ID to
// use for email provider resolution.  If locationID is already provided it is
// used directly; otherwise the first active location for the org is used.
func (r *Runner) resolveOwnerEmailAndLocation(ctx context.Context, orgID, locationID string) (ownerEmail, locID string, err error) {
	err = db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Owner email.
		scanErr := tx.QueryRow(ctx, `
SELECT COALESCE(p.email, '')
FROM organization_members om
JOIN profiles p ON p.id = om.profile_id
WHERE om.organization_id = $1
  AND om.role = 'owner'
LIMIT 1
`, orgID).Scan(&ownerEmail)
		if scanErr != nil && !errors.Is(scanErr, pgx.ErrNoRows) {
			return fmt.Errorf("owner email: %w", scanErr)
		}

		// Location ID for provider resolution.
		if locationID != "" {
			locID = locationID
			return nil
		}
		scanErr = tx.QueryRow(ctx, `
SELECT id FROM locations
WHERE organization_id = $1 AND is_active = true
ORDER BY created_at ASC LIMIT 1
`, orgID).Scan(&locID)
		if scanErr != nil && !errors.Is(scanErr, pgx.ErrNoRows) {
			return fmt.Errorf("location: %w", scanErr)
		}
		return nil
	})
	return ownerEmail, locID, err
}

// humanAction maps an action code to a readable title.
func humanAction(action string) string {
	switch action {
	case "void_surge":
		return "Excessive Voids Detected"
	case "pin_failures":
		return "Repeated PIN Failures"
	case "wallet_drop":
		return "Wallet Balance Drop"
	default:
		return action
	}
}
