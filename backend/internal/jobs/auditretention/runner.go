package auditretention

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
	defaultRetainDays = 90
	runHour           = 3 // 03:00 local time
)

// Runner archives audit_log rows older than retainDays once per day at 03:00
// local time by calling the archive_old_audit_log database function.
type Runner struct {
	db         *pgxpool.Pool
	retainDays int
}

// NewRunner constructs a Runner. retainDays controls how far back rows are kept;
// pass 0 to use the default of 90 days.
func NewRunner(pool *pgxpool.Pool, retainDays int) *Runner {
	if retainDays <= 0 {
		retainDays = defaultRetainDays
	}
	return &Runner{db: pool, retainDays: retainDays}
}

// Start launches the background daily sweep. It exits cleanly when ctx is
// cancelled. The first run happens at the next 03:00 local; an immediate
// RunOnce is not performed on start because audit archival is non-urgent and
// should run at a predictable off-peak time.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		for {
			next := nextRunAt(runHour)
			log.Printf("auditretention: next sweep scheduled at %s (retain=%d days)", next.Format(time.RFC3339), r.retainDays)

			select {
			case <-ctx.Done():
				log.Println("auditretention: Runner shutting down")
				return
			case <-time.After(time.Until(next)):
			}

			if ctx.Err() != nil {
				return
			}
			if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("auditretention: RunOnce error: %v", err)
			}
		}
	}()
}

// RunOnce immediately executes the archive sweep and logs the result. It is
// exported so callers can trigger an ad-hoc run (e.g. from an admin endpoint
// or integration test).
//
// The sweep runs inside a service-role transaction so that the audit_log RLS
// policy (INSERT WITH CHECK (is_service_role())) is satisfied for the archival
// function.
func (r *Runner) RunOnce(ctx context.Context) error {
	var moved int64
	if err := db.Scoped(ctx, r.db, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var err error
		moved, err = archiveOldAuditLog(ctx, tx, r.retainDays)
		return err
	}); err != nil {
		return err
	}
	log.Printf("auditretention: archived %d audit_log row(s) older than %d days", moved, r.retainDays)
	return nil
}

// nextRunAt returns the next wall-clock time that the given hour falls on. If
// the current local time is already past that hour today, the result is
// tomorrow at that hour.
func nextRunAt(hour int) time.Time {
	now := time.Now()
	candidate := time.Date(now.Year(), now.Month(), now.Day(), hour, 0, 0, 0, now.Location())
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}
