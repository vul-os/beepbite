package webhookdelivery

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// deliveryRow is the data for a single webhook_deliveries row returned by the
// worker's pending-query.
type deliveryRow struct {
	ID                     string
	EndpointID             string
	OrgID                  string
	EventType              string
	Payload                []byte // raw JSON
	Status                 string
	Attempts               int
	EndpointURL            string
	SigningSecretCiphertext string
}

// insertDeliveries inserts one webhook_deliveries row (status='pending') for each
// active endpoint in the org whose events array contains eventType.
// payload is already marshalled JSON.
func insertDeliveries(ctx context.Context, tx pgx.Tx, orgID, eventType string, payload []byte) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO webhook_deliveries (
			id,
			endpoint_id,
			org_id,
			event_type,
			payload,
			status,
			attempts,
			created_at
		)
		SELECT
			gen_random_uuid(),
			we.id,
			we.org_id,
			$2,
			$3::jsonb,
			'pending',
			0,
			now()
		FROM webhook_endpoints we
		WHERE we.org_id = $1
		  AND we.is_active = true
		  AND $2 = ANY(we.events)
	`, orgID, eventType, string(payload))
	if err != nil {
		return fmt.Errorf("webhookdelivery: insertDeliveries (org=%s event=%s): %w", orgID, eventType, err)
	}
	return nil
}

// loadPendingDeliveries returns up to limit webhook_deliveries rows that are
// either pending or failed with attempts < maxAttempts, ordered by created_at ASC.
// It joins webhook_endpoints to get the URL and signing secret.
func loadPendingDeliveries(ctx context.Context, tx pgx.Tx, maxAttempts, limit int) ([]deliveryRow, error) {
	rows, err := tx.Query(ctx, `
		SELECT
			wd.id,
			wd.endpoint_id,
			wd.org_id,
			wd.event_type,
			wd.payload,
			wd.status,
			wd.attempts,
			we.url,
			we.signing_secret_ciphertext
		FROM webhook_deliveries wd
		JOIN webhook_endpoints we ON we.id = wd.endpoint_id
		WHERE (wd.status = 'pending'
		    OR (wd.status = 'failed' AND wd.attempts < $1))
		  AND we.is_active = true
		ORDER BY wd.created_at ASC
		LIMIT $2
	`, maxAttempts, limit)
	if err != nil {
		return nil, fmt.Errorf("webhookdelivery: loadPending: %w", err)
	}
	defer rows.Close()

	var out []deliveryRow
	for rows.Next() {
		var r deliveryRow
		if err := rows.Scan(
			&r.ID,
			&r.EndpointID,
			&r.OrgID,
			&r.EventType,
			&r.Payload,
			&r.Status,
			&r.Attempts,
			&r.EndpointURL,
			&r.SigningSecretCiphertext,
		); err != nil {
			return nil, fmt.Errorf("webhookdelivery: scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// markDelivered sets status='delivered', response_code, and delivered_at.
func markDelivered(ctx context.Context, tx pgx.Tx, id string, responseCode int) error {
	_, err := tx.Exec(ctx, `
		UPDATE webhook_deliveries
		SET status       = 'delivered',
		    response_code = $2,
		    delivered_at  = now()
		WHERE id = $1
	`, id, responseCode)
	if err != nil {
		return fmt.Errorf("webhookdelivery: markDelivered %s: %w", id, err)
	}
	return nil
}

// markFailed increments attempts, records last_error and response_code,
// and sets status='failed'.
func markFailed(ctx context.Context, tx pgx.Tx, id, lastError string, responseCode, currentAttempts int) error {
	_, err := tx.Exec(ctx, `
		UPDATE webhook_deliveries
		SET status        = 'failed',
		    attempts      = $2,
		    last_error    = $3,
		    response_code = $4
		WHERE id = $1
	`, id, currentAttempts+1, lastError, responseCode)
	if err != nil {
		return fmt.Errorf("webhookdelivery: markFailed %s: %w", id, err)
	}
	return nil
}

// marshalPayload JSON-encodes v and returns the raw bytes.
func marshalPayload(v any) ([]byte, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("webhookdelivery: marshal payload: %w", err)
	}
	return b, nil
}

// backoffDuration returns the delay to apply before the next attempt.
// Strategy: min(2^attempts * baseDelay, maxDelay).
func backoffDuration(attempts int) time.Duration {
	const (
		baseDelay = 5 * time.Second
		maxDelay  = 5 * time.Minute
	)
	d := baseDelay
	for i := 0; i < attempts; i++ {
		d *= 2
		if d > maxDelay {
			return maxDelay
		}
	}
	return d
}
