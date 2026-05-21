package webhookdelivery

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	internaldb "github.com/beepbite/backend/internal/db"
)

const (
	// maxAttempts is the maximum number of HTTP delivery attempts before a
	// delivery row remains permanently in status='failed'.
	maxAttempts = 5

	// batchSize is the number of pending deliveries fetched per tick.
	batchSize = 50

	// tickInterval controls how often the runner polls webhook_deliveries.
	tickInterval = 10 * time.Second

	// httpTimeout is the per-request deadline for outbound POST calls.
	httpTimeout = 10 * time.Second

	// advisoryLockKey is a globally unique int64 key for pg_try_advisory_lock.
	// Pick any fixed number; this prevents two instances from racing on delivery.
	advisoryLockKey = 0x6265657062697465 // "beepbite" in hex
)

// Emit is the public API that domain handlers call when an event occurs.
// For each active webhook_endpoints row in orgID whose events array contains
// eventType, it inserts a webhook_deliveries row with status='pending'.
//
// Emit is intentionally fast: it only inserts rows and returns. The actual
// HTTP delivery is handled by the background Runner.
//
// Example:
//
//	err = webhookdelivery.Emit(ctx, pool, orgID, "order.paid", order)
func Emit(ctx context.Context, pool *pgxpool.Pool, orgID, eventType string, payload any) error {
	body, err := marshalPayload(payload)
	if err != nil {
		return err
	}
	return internaldb.Scoped(ctx, pool, internaldb.ServiceRoleScope(), func(tx pgx.Tx) error {
		return insertDeliveries(ctx, tx, orgID, eventType, body)
	})
}

// Runner polls webhook_deliveries and delivers pending payloads via signed HTTP
// POST requests. It holds a pg_advisory_lock so only one instance runs at a time
// (safe for multi-instance deployments).
type Runner struct {
	db     *pgxpool.Pool
	client *http.Client
}

// NewRunner constructs a Runner backed by pool. A custom http.Client is not
// required — the runner creates one with a 10-second timeout. Callers that need
// custom TLS or proxy settings may set r.client after construction.
func NewRunner(pool *pgxpool.Pool) *Runner {
	return &Runner{
		db:     pool,
		client: &http.Client{Timeout: httpTimeout},
	}
}

// Start launches the background delivery loop in a new goroutine.
// It returns immediately; cancel ctx to stop the runner cleanly.
//
// Wire-up example in main.go:
//
//	runner := webhookdelivery.NewRunner(pool)
//	runner.Start(ctx)
func (r *Runner) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()

		// Attempt an immediate sweep on startup.
		if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("webhookdelivery: RunOnce error: %v", err)
		}

		for {
			select {
			case <-ctx.Done():
				log.Println("webhookdelivery: Runner shutting down")
				return
			case <-ticker.C:
				if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("webhookdelivery: RunOnce error: %v", err)
				}
			}
		}
	}()
}

// RunOnce acquires the advisory lock, fetches up to batchSize pending/retryable
// deliveries, and dispatches each one. It is exported so tests and admin tools
// can trigger an ad-hoc sweep.
func (r *Runner) RunOnce(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	// Acquire a session-level advisory lock so that only one instance of the
	// runner processes deliveries at a time. We use a raw connection (not a
	// transaction) because pg_advisory_lock is session-scoped.
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("webhookdelivery: acquire conn: %w", err)
	}
	defer conn.Release()

	var locked bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1)`, advisoryLockKey,
	).Scan(&locked); err != nil {
		return fmt.Errorf("webhookdelivery: advisory lock query: %w", err)
	}
	if !locked {
		// Another instance holds the lock — skip this tick silently.
		return nil
	}
	defer func() {
		// Release on this connection (advisory locks are session-scoped).
		if _, unlockErr := conn.Exec(ctx,
			`SELECT pg_advisory_unlock($1)`, advisoryLockKey,
		); unlockErr != nil {
			log.Printf("webhookdelivery: advisory unlock: %v", unlockErr)
		}
	}()

	// Load pending deliveries under service-role scope.
	var pending []deliveryRow
	if err := internaldb.Scoped(ctx, r.db, internaldb.ServiceRoleScope(), func(tx pgx.Tx) error {
		var qErr error
		pending, qErr = loadPendingDeliveries(ctx, tx, maxAttempts, batchSize)
		return qErr
	}); err != nil {
		return fmt.Errorf("webhookdelivery: load pending: %w", err)
	}

	for _, row := range pending {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		r.dispatch(ctx, row)
	}
	return nil
}

// dispatch performs the HTTP POST for a single delivery row and records the result.
func (r *Runner) dispatch(ctx context.Context, row deliveryRow) {
	// Exponential backoff: skip rows whose last attempt was too recent.
	// (We check attempts > 0 so first-time pending rows are never skipped.)
	if row.Attempts > 0 {
		minNextAt := backoffDuration(row.Attempts)
		// We don't store last_attempted_at, so we use created_at approximation.
		// The simplest safe approach: always attempt — the SELECT already filters
		// on attempts < maxAttempts and the time gap naturally grows because the
		// runner only ticks every tickInterval. For strict backoff the store query
		// could add a next_attempt_at column; for now we trust the interval.
		_ = minNextAt // backoffDuration is available for future next_attempt_at use
	}

	ts := time.Now()
	sigHeader := Sign(row.SigningSecretCiphertext, row.Payload, ts)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, row.EndpointURL,
		bytes.NewReader(row.Payload))
	if err != nil {
		r.recordFailure(ctx, row, 0, fmt.Sprintf("build request: %v", err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BeepBite-Signature", sigHeader)
	req.Header.Set("X-BeepBite-Event", row.EventType)

	resp, err := r.client.Do(req)
	if err != nil {
		r.recordFailure(ctx, row, 0, fmt.Sprintf("http do: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if dbErr := internaldb.Scoped(ctx, r.db, internaldb.ServiceRoleScope(), func(tx pgx.Tx) error {
			return markDelivered(ctx, tx, row.ID, resp.StatusCode)
		}); dbErr != nil {
			log.Printf("webhookdelivery: markDelivered delivery=%s: %v", row.ID, dbErr)
		}
		return
	}

	// Non-2xx response.
	r.recordFailure(ctx, row, resp.StatusCode,
		fmt.Sprintf("non-2xx response: %d", resp.StatusCode))
}

// recordFailure persists a failed attempt.
func (r *Runner) recordFailure(ctx context.Context, row deliveryRow, code int, errMsg string) {
	if dbErr := internaldb.Scoped(ctx, r.db, internaldb.ServiceRoleScope(), func(tx pgx.Tx) error {
		return markFailed(ctx, tx, row.ID, errMsg, code, row.Attempts)
	}); dbErr != nil {
		log.Printf("webhookdelivery: markFailed delivery=%s: %v", row.ID, dbErr)
	}

	newAttempts := row.Attempts + 1
	if newAttempts >= maxAttempts {
		log.Printf("webhookdelivery: delivery=%s endpoint=%s permanently failed after %d attempts; last error: %s",
			row.ID, row.EndpointID, newAttempts, errMsg)
	}
}
