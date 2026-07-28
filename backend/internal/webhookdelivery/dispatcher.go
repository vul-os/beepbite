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
	// codec opens the stored signing secret. Never nil after NewRunner; a
	// keyless codec is still able to read legacy plaintext rows.
	codec *SecretCodec
}

// NewRunner constructs a Runner backed by pool. A custom http.Client is not
// required — the runner creates one with a 10-second timeout. Callers that need
// custom TLS or proxy settings may set r.client after construction.
//
// The signing-secret key is read from the environment. A missing or malformed
// key is NOT fatal here: it disables delivery for endpoints whose secret is
// encrypted, and each such endpoint says so on its first attempt. Refusing to
// construct the runner would take down every webhook in the deployment,
// including the plaintext ones that would otherwise still work.
func NewRunner(pool *pgxpool.Pool) *Runner {
	codec, err := SecretCodecFromEnv()
	if err != nil {
		log.Printf("webhookdelivery: signing-secret key unusable (%v); deliveries for "+
			"endpoints with encrypted secrets will fail until it is fixed", err)
		codec = &SecretCodec{}
	}
	return &Runner{
		db:     pool,
		client: &http.Client{Timeout: httpTimeout},
		codec:  codec,
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

	secret, legacy, err := r.codec.Open(row.SigningSecretCiphertext)
	if err != nil {
		// Do not put the failure reason in the row verbatim — it is stored and
		// surfaced in the UI, and a decryption error should not become a place
		// to learn about key state. The log carries the detail.
		log.Printf("webhookdelivery: endpoint=%s signing secret unusable: %v", row.EndpointID, err)
		r.recordFailure(ctx, row, 0, "signing secret unavailable")
		return
	}
	if legacy && shouldWarnLegacy(row.EndpointID) {
		log.Printf("webhookdelivery: endpoint=%s signing secret is still stored as PLAINTEXT in "+
			"signing_secret_ciphertext; run cmd/encryptwebhooksecrets to convert it", row.EndpointID)
	}

	// The delivery id is the nonce. It is stable across retries of this row on
	// purpose: a receiver that already accepted it should be able to recognise
	// the retry as a duplicate rather than process the order twice.
	ts := time.Now()
	sigHeader := Sign(secret, row.ID, row.Payload, ts)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, row.EndpointURL,
		bytes.NewReader(row.Payload))
	if err != nil {
		r.recordFailure(ctx, row, 0, fmt.Sprintf("build request: %v", err))
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(SignatureHeader, sigHeader)
	req.Header.Set(DeliveryHeader, row.ID)
	req.Header.Set(EventHeader, row.EventType)

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
