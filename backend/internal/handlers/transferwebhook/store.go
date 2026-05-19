package transferwebhook

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrDuplicate is returned when the webhook_event_log already contains an
// entry for this provider+external_event_id (idempotency guard).
var ErrDuplicate = errors.New("transferwebhook: duplicate event")

// Store wraps the pgxpool for all DB operations in this package.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// LogWebhookEvent inserts a row into webhook_event_log.  If the
// (provider, external_event_id) pair already exists it returns ErrDuplicate
// so the handler can respond 200 without reprocessing.
//
// Returns the new row's id on success.
func (s *Store) LogWebhookEvent(ctx context.Context, externalEventID, eventType string, payload []byte, sigValid bool) (string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `
INSERT INTO webhook_event_log
    (provider, event_type, external_event_id, signature_valid, payload, processing_status)
VALUES
    ('paystack', $1, $2, $3, $4, 'pending')
RETURNING id
`, eventType, externalEventID, sigValid, json.RawMessage(payload)).Scan(&id)
	if err != nil {
		// Unique-constraint violation → duplicate.
		if isUniqueViolation(err) {
			return "", ErrDuplicate
		}
		return "", err
	}
	return id, nil
}

// MarkWebhookProcessed sets processing_status = 'processed' on the log row.
func (s *Store) MarkWebhookProcessed(ctx context.Context, logID string) error {
	_, err := s.pool.Exec(ctx, `
UPDATE webhook_event_log
SET processing_status = 'processed',
    processed_at      = now()
WHERE id = $1
`, logID)
	return err
}

// MarkWebhookFailed sets processing_status = 'failed' and stores the error.
func (s *Store) MarkWebhookFailed(ctx context.Context, logID, errMsg string) error {
	_, err := s.pool.Exec(ctx, `
UPDATE webhook_event_log
SET processing_status = 'failed',
    error_message     = $2,
    processed_at      = now()
WHERE id = $1
`, logID, errMsg)
	return err
}

// PayoutRow is a minimal projection of merchant_payouts used in reconcile paths.
type PayoutRow struct {
	ID                    string
	ProviderTransferID    string // transfer_code or numeric id as stored
	OrganizationID        string
	LocationID            *string
}

// UpdatePayoutSuccess sets provider_transfer_status='success' and completed_at
// inside a serialisable transaction with SELECT … FOR UPDATE.
func (s *Store) UpdatePayoutSuccess(ctx context.Context, transferCode string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		row, err := lockPayoutByTransferCode(ctx, tx, transferCode)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
UPDATE merchant_payouts
SET provider_transfer_status = 'success',
    completed_at             = now()
WHERE id = $1
`, row.ID)
		if err != nil {
			return err
		}
		return auditLog(ctx, tx, row, "payout.transfer_success", map[string]any{
			"provider_transfer_id": transferCode,
		})
	})
}

// UpdatePayoutFailed sets provider_transfer_status='failed', failed_at, and
// stores the failure reason.
func (s *Store) UpdatePayoutFailed(ctx context.Context, transferCode, failureReason string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		row, err := lockPayoutByTransferCode(ctx, tx, transferCode)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
UPDATE merchant_payouts
SET provider_transfer_status = 'failed',
    provider_transfer_error  = $2,
    failed_at                = now()
WHERE id = $1
`, row.ID, failureReason)
		if err != nil {
			return err
		}
		return auditLog(ctx, tx, row, "payout.transfer_failed", map[string]any{
			"provider_transfer_id": transferCode,
			"failure_reason":       failureReason,
		})
	})
}

// UpdatePayoutReversed sets provider_transfer_status='reversed' and reversed_at.
func (s *Store) UpdatePayoutReversed(ctx context.Context, transferCode string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		row, err := lockPayoutByTransferCode(ctx, tx, transferCode)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
UPDATE merchant_payouts
SET provider_transfer_status = 'reversed',
    reversed_at              = now()
WHERE id = $1
`, row.ID)
		if err != nil {
			return err
		}
		return auditLog(ctx, tx, row, "payout.transfer_reversed", map[string]any{
			"provider_transfer_id": transferCode,
		})
	})
}

// UpdatePayoutStatus is used by the reconciler: apply whatever status Paystack
// returned from GET /transfer/:id.
func (s *Store) UpdatePayoutStatus(ctx context.Context, payoutID, newStatus, failureReason string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		var row PayoutRow
		err := tx.QueryRow(ctx, `
SELECT id, COALESCE(provider_transfer_id,''), organization_id, location_id
FROM merchant_payouts
WHERE id = $1
FOR UPDATE
`, payoutID).Scan(&row.ID, &row.ProviderTransferID, &row.OrganizationID, &row.LocationID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil // gone — skip
			}
			return err
		}

		now := time.Now().UTC()
		var completedAt, failedAt, reversedAt *time.Time
		switch newStatus {
		case "success":
			completedAt = &now
		case "failed":
			failedAt = &now
		case "reversed":
			reversedAt = &now
		}

		_, err = tx.Exec(ctx, `
UPDATE merchant_payouts
SET provider_transfer_status = $2,
    provider_transfer_error  = NULLIF($3, ''),
    completed_at             = COALESCE($4, completed_at),
    failed_at                = COALESCE($5, failed_at),
    reversed_at              = COALESCE($6, reversed_at)
WHERE id = $1
`, row.ID, newStatus, failureReason, completedAt, failedAt, reversedAt)
		if err != nil {
			return err
		}
		return auditLog(ctx, tx, row, "payout.recon_status_synced", map[string]any{
			"new_status":      newStatus,
			"failure_reason":  failureReason,
		})
	})
}

// StickyInitiatedPayouts returns payouts stuck in 'initiated' for > 1 hour.
func (s *Store) StickyInitiatedPayouts(ctx context.Context) ([]PayoutRow, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, COALESCE(provider_transfer_id,''), organization_id, location_id
FROM merchant_payouts
WHERE provider_transfer_status = 'initiated'
  AND created_at < now() - interval '1 hour'
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PayoutRow
	for rows.Next() {
		var r PayoutRow
		if err := rows.Scan(&r.ID, &r.ProviderTransferID, &r.OrganizationID, &r.LocationID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

func (s *Store) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// lockPayoutByTransferCode selects the merchant_payouts row whose
// provider_transfer_id matches, locking it for update.
func lockPayoutByTransferCode(ctx context.Context, tx pgx.Tx, transferCode string) (PayoutRow, error) {
	var row PayoutRow
	err := tx.QueryRow(ctx, `
SELECT id, COALESCE(provider_transfer_id,''), organization_id, location_id
FROM merchant_payouts
WHERE provider_transfer_id = $1
FOR UPDATE
`, transferCode).Scan(&row.ID, &row.ProviderTransferID, &row.OrganizationID, &row.LocationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return row, nil // nothing to update — not an error
		}
		return row, err
	}
	return row, nil
}

func auditLog(ctx context.Context, tx pgx.Tx, row PayoutRow, action string, after map[string]any) error {
	afterJSON, _ := json.Marshal(after)
	var locID *string
	if row.LocationID != nil && *row.LocationID != "" {
		locID = row.LocationID
	}
	_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (organization_id, location_id, actor_type, actor_label,
     action, entity_type, entity_id, after_state)
VALUES
    ($1, $2, 'webhook', 'paystack:transfer',
     $3, 'merchant_payout', $4::uuid, $5)
`, row.OrganizationID, locID, action, row.ID, json.RawMessage(afterJSON))
	return err
}

// isUniqueViolation detects Postgres error code 23505.
func isUniqueViolation(err error) bool {
	type pgErr interface{ SQLState() string }
	var pe pgErr
	if errors.As(err, &pe) {
		return pe.SQLState() == "23505"
	}
	return false
}
