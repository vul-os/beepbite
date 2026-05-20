// Package kdsfanout contains the background runner that drains the
// kds_fanout_queue table and calls kds.Store.FanoutOrder for each pending row.
package kdsfanout

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/beepbite/backend/internal/handlers/kds"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// tickInterval controls how often the runner polls kds_fanout_queue.
	tickInterval = 5 * time.Second

	// batchSize is the maximum number of queue rows processed per tick.
	batchSize = 100
)

// Runner polls kds_fanout_queue every 5 seconds and fans out pending orders
// to the KDS using kds.Store.FanoutOrder.
type Runner struct {
	db       *pgxpool.Pool
	kdsStore *kds.Store
}

// NewRunner constructs a Runner. Both db and kdsStore are required.
func NewRunner(db *pgxpool.Pool, kdsStore *kds.Store) *Runner {
	return &Runner{db: db, kdsStore: kdsStore}
}

// Start launches the background polling loop in a goroutine.  The loop ticks
// every 5 seconds and calls RunOnce.  It exits cleanly when ctx is cancelled.
func (r *Runner) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()

		// Run immediately on start so we don't wait one full interval.
		if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("kdsfanout: RunOnce error: %v", err)
		}

		for {
			select {
			case <-ctx.Done():
				log.Println("kdsfanout: Runner shutting down")
				return
			case <-ticker.C:
				if err := r.RunOnce(ctx); err != nil && !errors.Is(err, context.Canceled) {
					log.Printf("kdsfanout: RunOnce error: %v", err)
				}
			}
		}
	}()
}

// RunOnce processes up to batchSize pending rows from kds_fanout_queue
// (state='pending' AND retry_count < maxRetries).
//
// On fanout success  → DELETE the row (order is fully routed).
// On fanout failure  → increment retry_count; if retry_count reaches maxRetries
//                      set state='dead' and emit a single error log.
// Dead rows are never selected again, so log spam is bounded to one line.
func (r *Runner) RunOnce(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}

	pending, err := loadPending(ctx, r.db, batchSize)
	if err != nil {
		return err
	}

	for _, row := range pending {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		_, fanErr := r.kdsStore.FanoutOrder(ctx, row.OrderID)
		if fanErr != nil {
			dead, mErr := markRetry(ctx, r.db, row.ID, fanErr.Error(), row.RetryCount)
			if mErr != nil {
				log.Printf("kdsfanout: markRetry queue=%s: %v", row.ID, mErr)
			}
			// Log only when the row transitions to dead — avoids per-retry spam.
			if dead {
				log.Printf("kdsfanout: order=%s queue=%s dead after %d retries; last error: %v",
					row.OrderID, row.ID, maxRetries, fanErr)
			}
			continue
		}

		if mErr := markProcessed(ctx, r.db, row.ID); mErr != nil {
			log.Printf("kdsfanout: markProcessed queue=%s: %v", row.ID, mErr)
		}
	}

	return nil
}
