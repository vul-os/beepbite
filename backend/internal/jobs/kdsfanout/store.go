// Package kdsfanout contains the background runner that drains the
// kds_fanout_queue table and calls kds.Store.FanoutOrder for each pending row.
package kdsfanout

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

const maxRetries = 10

// queueRow is a single row from kds_fanout_queue.
type queueRow struct {
	ID         string
	OrderID    string
	QueuedAt   time.Time
	RetryCount int
}

// loadPending returns up to limit rows where state = 'pending' AND
// retry_count < maxRetries, ordered by queued_at ASC.
func loadPending(ctx context.Context, tx pgx.Tx, limit int) ([]queueRow, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, order_id, queued_at, retry_count
		FROM kds_fanout_queue
		WHERE state = 'pending'
		  AND retry_count < $2
		ORDER BY queued_at ASC
		LIMIT $1
	`, limit, maxRetries)
	if err != nil {
		return nil, fmt.Errorf("kdsfanout: query pending: %w", err)
	}
	defer rows.Close()

	var out []queueRow
	for rows.Next() {
		var r queueRow
		if err := rows.Scan(&r.ID, &r.OrderID, &r.QueuedAt, &r.RetryCount); err != nil {
			return nil, fmt.Errorf("kdsfanout: scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// markProcessed removes the queue row — fanout succeeded, no longer needed.
func markProcessed(ctx context.Context, tx pgx.Tx, id string) error {
	_, err := tx.Exec(ctx, `
		DELETE FROM kds_fanout_queue WHERE id = $1
	`, id)
	if err != nil {
		return fmt.Errorf("kdsfanout: mark processed %s: %w", id, err)
	}
	return nil
}

// markRetry increments retry_count and records the latest error.
// If retry_count reaches maxRetries the row is set to state='dead'.
// Returns true when the row just transitioned to dead so the caller can log.
func markRetry(ctx context.Context, tx pgx.Tx, id, errMsg string, currentRetry int) (dead bool, err error) {
	nextRetry := currentRetry + 1
	newState := "pending"
	if nextRetry >= maxRetries {
		newState = "dead"
		dead = true
	}

	_, err = tx.Exec(ctx, `
		UPDATE kds_fanout_queue
		SET retry_count   = $2,
		    error_message = $3,
		    state         = $4
		WHERE id = $1
	`, id, nextRetry, errMsg, newState)
	if err != nil {
		return false, fmt.Errorf("kdsfanout: markRetry %s: %w", id, err)
	}
	return dead, nil
}
