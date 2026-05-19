// Package kdsfanout contains the background runner that drains the
// kds_fanout_queue table and calls kds.Store.FanoutOrder for each pending row.
package kdsfanout

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// queueRow is a single row from kds_fanout_queue.
type queueRow struct {
	ID       string
	OrderID  string
	QueuedAt time.Time
}

// loadPending returns up to limit unprocessed rows ordered by queued_at ASC.
func loadPending(ctx context.Context, db *pgxpool.Pool, limit int) ([]queueRow, error) {
	rows, err := db.Query(ctx, `
		SELECT id, order_id, queued_at
		FROM kds_fanout_queue
		WHERE processed_at IS NULL
		ORDER BY queued_at ASC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("kdsfanout: query pending: %w", err)
	}
	defer rows.Close()

	var out []queueRow
	for rows.Next() {
		var r queueRow
		if err := rows.Scan(&r.ID, &r.OrderID, &r.QueuedAt); err != nil {
			return nil, fmt.Errorf("kdsfanout: scan: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// markProcessed sets processed_at = now() for the given queue row ID.
func markProcessed(ctx context.Context, db *pgxpool.Pool, id string) error {
	_, err := db.Exec(ctx, `
		UPDATE kds_fanout_queue
		SET processed_at = now()
		WHERE id = $1
	`, id)
	if err != nil {
		return fmt.Errorf("kdsfanout: mark processed %s: %w", id, err)
	}
	return nil
}

// markError records an error message on the queue row without setting
// processed_at, so the runner will retry it on the next tick.
func markError(ctx context.Context, db *pgxpool.Pool, id, errMsg string) error {
	_, err := db.Exec(ctx, `
		UPDATE kds_fanout_queue
		SET error_message = $2
		WHERE id = $1
	`, id, errMsg)
	if err != nil {
		return fmt.Errorf("kdsfanout: mark error %s: %w", id, err)
	}
	return nil
}
