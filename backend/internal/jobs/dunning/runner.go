// Package dunning provides the auto-refill failure ladder (dunning) background
// job.  See store.go for the full package-level documentation including the
// escalation ladder and required schema flags.
package dunning

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Dunning stage constants
// ---------------------------------------------------------------------------

const (
	// StageRetry is set on Day 0 (first failure detected).  The walletrefill
	// job handles the actual retry; dunning just records and notifies.
	StageRetry = "retry"

	// StageEmailWhatsAppBanner is reached when an org is still failing ~1 day
	// after the first failure.  All notification channels are triggered.
	StageEmailWhatsAppBanner = "email_whatsapp_banner"

	// StageDegrade is reached at Day 7.  LLM / WhatsApp / SMS are disabled;
	// POS continues to operate.
	//
	// FLAG: requires organizations.service_degraded boolean NOT NULL DEFAULT false.
	// When that column exists, set it to true here.
	StageDegrade = "degrade"

	// StageAutoPause is reached at Day 14.  The org is effectively suspended.
	//
	// FLAG: connects to the existing 90-day inactivity cleanup job.  When
	// organizations.is_active is set to false here the cleanup job should treat
	// it as an explicit pause (not just organic inactivity).
	StageAutoPause = "auto_pause"
)

// ladder defines the escalation thresholds as (minDays, stage) pairs ordered
// from highest severity to lowest so the correct stage is identified in one pass.
var ladder = []struct {
	minDays int
	stage   string
}{
	{14, StageAutoPause},
	{7, StageDegrade},
	{1, StageEmailWhatsAppBanner},
	{0, StageRetry},
}

// ---------------------------------------------------------------------------
// Notifier interface
// ---------------------------------------------------------------------------

// Notifier is the outbound notification contract.  A concrete implementation
// (e.g. sending an email, a WhatsApp message, and showing an in-app banner) is
// injected by the orchestrator (cmd/server/main.go or equivalent).  A no-op
// default is provided so the package builds and runs standalone without any
// external dependencies.
type Notifier interface {
	// Notify sends a dunning notification for the given org at the given stage.
	//
	//   orgID   — UUID string of the affected organisation.
	//   stage   — one of the Stage* constants (retry, email_whatsapp_banner,
	//             degrade, auto_pause).
	//   message — human-readable description of the action taken, suitable for
	//             an internal audit log or a notification body.
	Notify(ctx context.Context, orgID, stage, message string) error
}

// noopNotifier is the default Notifier used when none is injected.
// All calls are logged at INFO level and return nil.
type noopNotifier struct{}

func (noopNotifier) Notify(_ context.Context, orgID, stage, message string) error {
	log.Printf("dunning [noop-notify]: org=%s stage=%s message=%q", orgID, stage, message)
	return nil
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const (
	// runHour is the local wall-clock hour at which the daily sweep runs.
	// 04:00 is intentionally offset from the auditretention job (03:00) to
	// spread DB load.
	runHour = 4
)

// Runner performs the daily dunning sweep over all organisations that have
// unresolved auto-refill failures.
type Runner struct {
	db       *pgxpool.Pool
	notifier Notifier

	// inMemoryStage tracks the last-notified stage per org within this process
	// lifetime.  It provides idempotency within a single run (and across
	// restarts once the schema columns are added and loadPersistedStage works).
	inMemoryStage map[string]string // orgID → last stage notified
}

// NewRunner constructs a Runner.
//
//   - pool is the pgxpool.Pool used for all DB access.
//   - notifier is called for each stage transition; pass nil to use the
//     built-in no-op notifier (logs only, suitable for standalone builds and
//     tests).
func NewRunner(pool *pgxpool.Pool, notifier Notifier) *Runner {
	if notifier == nil {
		notifier = noopNotifier{}
	}
	return &Runner{
		db:            pool,
		notifier:      notifier,
		inMemoryStage: make(map[string]string),
	}
}

// Start launches the background daily sweep in a goroutine.  The first sweep
// runs at the next 04:00 local time.  The goroutine exits cleanly when ctx is
// cancelled.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		for {
			next := nextRunAt(runHour)
			log.Printf("dunning: next sweep scheduled at %s", next.Format(time.RFC3339))

			select {
			case <-ctx.Done():
				log.Println("dunning: Runner shutting down")
				return
			case <-time.After(time.Until(next)):
			}

			if ctx.Err() != nil {
				return
			}
			if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("dunning: RunOnce error: %v", err)
			}
		}
	}()
}

// RunOnce immediately executes the dunning sweep.  It is exported so callers
// can trigger an ad-hoc run (e.g. from an admin endpoint or integration test).
//
// The sweep:
//  1. Loads all orgs with unresolved auto-refill failures (service-role scope).
//  2. For each org, computes the elapsed days since first failure.
//  3. Looks up the highest ladder stage that applies.
//  4. Skips the org if that stage has already been notified (idempotent).
//  5. Calls r.notifier.Notify and persists the new stage.
func (r *Runner) RunOnce(ctx context.Context) error {
	var orgs []orgFailureRow
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		orgs, err = loadOrgsWithFailures(ctx, tx)
		return err
	}); err != nil {
		return err
	}

	log.Printf("dunning: sweep found %d org(s) with active refill failures", len(orgs))

	for _, org := range orgs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err := r.processOrg(ctx, org); err != nil {
			// Per-org errors are logged but do not abort the sweep.
			log.Printf("dunning: org=%s processOrg error: %v", org.OrgID, err)
		}
	}
	return nil
}

// processOrg applies the dunning ladder to a single org.
func (r *Runner) processOrg(ctx context.Context, org orgFailureRow) error {
	if org.FirstFailedAt == nil {
		// Should not happen given the query, but guard defensively.
		return nil
	}

	// Load the persisted stage from the DB (best-effort; falls back to "" if
	// the schema columns are not yet present).
	var persistedStage string
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		persistedStage, _, err = loadPersistedStage(ctx, tx, org.OrgID)
		return err
	}); err != nil {
		// Non-fatal: fall through with empty persisted stage.
		log.Printf("dunning: org=%s loadPersistedStage error (schema columns missing?): %v", org.OrgID, err)
	}

	// Resolve the effective last-notified stage: prefer the persisted DB value
	// (survives restarts once schema columns exist) over the in-memory value.
	lastNotified := persistedStage
	if lastNotified == "" {
		lastNotified = r.inMemoryStage[org.OrgID]
	}

	// Compute days elapsed since first failure (whole days, floor).
	daysSince := int(time.Since(*org.FirstFailedAt).Hours() / 24)

	// Find the highest stage the org has reached.
	targetStage := ""
	for _, rung := range ladder {
		if daysSince >= rung.minDays {
			targetStage = rung.stage
			break
		}
	}
	if targetStage == "" {
		// daysSince is negative (clock skew?) — skip.
		return nil
	}

	// Idempotency: skip if we've already notified this stage.
	if lastNotified == targetStage {
		log.Printf("dunning: org=%s stage=%s already notified (days=%d) — skipping",
			org.OrgID, targetStage, daysSince)
		return nil
	}

	// Build a human-readable message for audit/notification bodies.
	msg := r.buildMessage(targetStage, daysSince, *org.FirstFailedAt)

	log.Printf("dunning: org=%s advancing to stage=%s (days=%d since first failure)",
		org.OrgID, targetStage, daysSince)

	// Emit the notification.
	if err := r.notifier.Notify(ctx, org.OrgID, targetStage, msg); err != nil {
		// Notification failure is logged but does not block stage persistence —
		// we record the stage so we don't spam on the next tick even if one
		// channel fails.
		log.Printf("dunning: org=%s stage=%s Notify error: %v", org.OrgID, targetStage, err)
	}

	// Persist the new stage (best-effort).
	persistErr := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return persistStage(ctx, tx, org.OrgID, targetStage, *org.FirstFailedAt)
	})
	if persistErr != nil {
		// Schema columns not yet present — log the FLAG and fall back to
		// in-memory tracking so this process run remains idempotent.
		log.Printf("dunning: FLAG — org=%s persistStage failed; schema columns "+
			"organizations.dunning_stage and organizations.dunning_since are needed "+
			"for cross-restart idempotency: %v", org.OrgID, persistErr)
	}

	// Always update in-memory state so subsequent ticks within this process
	// are idempotent regardless of whether the DB persist succeeded.
	r.inMemoryStage[org.OrgID] = targetStage

	// Emit stage-specific side-effects (flagged actions).
	r.applySideEffects(ctx, org.OrgID, targetStage)

	return nil
}

// buildMessage constructs a human-readable notification body.
func (r *Runner) buildMessage(stage string, daysSince int, firstFailed time.Time) string {
	firstStr := firstFailed.UTC().Format("2006-01-02 15:04 UTC")
	switch stage {
	case StageRetry:
		return "Auto-refill failed. The system will retry automatically. " +
			"Please ensure your payment method is valid."
	case StageEmailWhatsAppBanner:
		return "Auto-refill has been failing since " + firstStr + " (" +
			itoa(daysSince) + " day(s)). " +
			"Action required: update your payment method to avoid service interruption."
	case StageDegrade:
		return "Auto-refill has been failing for " + itoa(daysSince) + " day(s) (since " +
			firstStr + "). " +
			"LLM, WhatsApp, and SMS features have been disabled. " +
			"POS continues to operate. Update your payment method to restore full service."
	case StageAutoPause:
		return "Auto-refill has been failing for " + itoa(daysSince) + " day(s) (since " +
			firstStr + "). " +
			"Your account has been automatically paused. " +
			"Contact support or update your payment method to reactivate."
	default:
		return "Dunning stage: " + stage + " after " + itoa(daysSince) + " day(s)."
	}
}

// applySideEffects performs stage-specific actions beyond notification.
// These are currently logged with FLAGs because the required schema columns
// do not yet exist.
func (r *Runner) applySideEffects(ctx context.Context, orgID, stage string) {
	switch stage {
	case StageDegrade:
		// FLAG: set organizations.service_degraded = true for org_id = orgID.
		// The API reads this column to disable LLM / WhatsApp / SMS endpoints
		// while keeping POS routes active.
		//
		// Required migration (do NOT add here):
		//   ALTER TABLE organizations
		//     ADD COLUMN IF NOT EXISTS service_degraded boolean NOT NULL DEFAULT false;
		//
		// Once added, replace this log with:
		//   db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		//       _, err := tx.Exec(ctx,
		//           `UPDATE organizations SET service_degraded = true WHERE id = $1`, orgID)
		//       return err
		//   })
		log.Printf("dunning: FLAG org=%s stage=degrade — "+
			"organizations.service_degraded = true should be set here; "+
			"column does not yet exist (add via migration)", orgID)

	case StageAutoPause:
		// FLAG: this stage should connect to the existing 90-day inactivity
		// cleanup.  Recommended: set organizations.is_active = false OR write
		// a dedicated dunning_paused_at timestamptz column so the inactivity
		// job can distinguish organic inactivity from dunning pauses.
		//
		// Required migration (do NOT add here):
		//   ALTER TABLE organizations
		//     ADD COLUMN IF NOT EXISTS dunning_paused_at timestamptz;
		//
		// Once added, replace this log with the appropriate UPDATE.
		log.Printf("dunning: FLAG org=%s stage=auto_pause — "+
			"org should be paused (organizations.is_active=false or dunning_paused_at set); "+
			"connect to the 90-day inactivity cleanup; schema column needed", orgID)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// nextRunAt returns the next wall-clock time at which the given hour falls.
// Mirrors the pattern used by auditretention.
func nextRunAt(hour int) time.Time {
	now := time.Now()
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, now.Location())
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}

// itoa converts an int to a string without importing strconv.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	buf := make([]byte, 0, 10)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}
