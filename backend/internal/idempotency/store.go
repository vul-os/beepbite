package idempotency

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// keyRow is a partial projection of idempotency_keys used by the middleware.
type keyRow struct {
	RequestHash    *string
	Status         string
	ResponseStatus *int
	ResponseBody   []byte // jsonb scanned as []byte
	LockedAt       *time.Time
	ExpiresAt      time.Time
}

// store wraps the pgxpool for idempotency queries.
type store struct {
	pool *pgxpool.Pool
}

// acquireOrFetch attempts to INSERT a new idempotency_keys row.
// On conflict (scope, key) it reads back the existing row so the middleware
// can decide what to do.
//
// Returns:
//
//	inserted=true  → fresh row, caller should proceed normally.
//	inserted=false → row existed; row contains the existing record.
func (s *store) acquireOrFetch(
	ctx context.Context,
	scope, key, requestHash string,
) (inserted bool, row keyRow, err error) {
	expiresAt := time.Now().UTC().Add(48 * time.Hour)

	// Try insert first.
	_, err = s.pool.Exec(ctx, `
INSERT INTO idempotency_keys (scope, key, request_hash, status, locked_at, expires_at)
VALUES ($1, $2, $3, 'in_progress', now(), $4)
ON CONFLICT (scope, key) DO NOTHING
`, scope, key, requestHash, expiresAt)
	if err != nil {
		return false, keyRow{}, err
	}

	// Check if we actually inserted by reading the current row.
	r := s.pool.QueryRow(ctx, `
SELECT request_hash, status, response_status, response_body, locked_at, expires_at
FROM idempotency_keys
WHERE scope = $1 AND key = $2
`, scope, key)

	var rh *string
	var rs *int
	var rb []byte
	var la *time.Time
	var ea time.Time
	var status string

	if scanErr := r.Scan(&rh, &status, &rs, &rb, &la, &ea); scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			// Shouldn't happen — we just inserted or it existed — treat as error.
			return false, keyRow{}, errors.New("idempotency: row vanished after insert")
		}
		return false, keyRow{}, scanErr
	}

	row = keyRow{
		RequestHash:    rh,
		Status:         status,
		ResponseStatus: rs,
		ResponseBody:   rb,
		LockedAt:       la,
		ExpiresAt:      ea,
	}

	// We inserted if the row's locked_at is very recent (within 1 second) and
	// status is in_progress and the request_hash matches what we just wrote.
	// The reliable signal: if status == 'in_progress' AND response_status IS NULL
	// AND the hash matches ours AND locked_at is within the last second.
	if row.Status == "in_progress" &&
		row.ResponseStatus == nil &&
		row.RequestHash != nil && *row.RequestHash == requestHash &&
		row.LockedAt != nil && time.Since(*row.LockedAt) < time.Second {
		inserted = true
	}

	return inserted, row, nil
}

// takeover updates locked_at on a stale in_progress row so this attempt
// becomes the owner.
func (s *store) takeover(ctx context.Context, scope, key, requestHash string) error {
	_, err := s.pool.Exec(ctx, `
UPDATE idempotency_keys
SET locked_at = now(), request_hash = $3
WHERE scope = $1 AND key = $2
`, scope, key, requestHash)
	return err
}

// complete writes the final response into the row and marks it completed.
func (s *store) complete(
	ctx context.Context,
	scope, key string,
	responseStatus int,
	responseBody []byte,
) error {
	_, err := s.pool.Exec(ctx, `
UPDATE idempotency_keys
SET status          = 'completed',
    response_status = $3,
    response_body   = $4,
    completed_at    = now()
WHERE scope = $1 AND key = $2
`, scope, key, responseStatus, responseBody)
	return err
}

// markFailed marks the row as failed so it is not replayed as a success.
func (s *store) markFailed(ctx context.Context, scope, key string) error {
	_, err := s.pool.Exec(ctx, `
UPDATE idempotency_keys
SET status = 'failed'
WHERE scope = $1 AND key = $2
`, scope, key)
	return err
}
