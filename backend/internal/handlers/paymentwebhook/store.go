package paymentwebhook

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrDuplicate is returned when a webhook_event_log row with the same
// (provider, external_event_id) already exists — idempotency guard.
var ErrDuplicate = errors.New("paymentwebhook: duplicate event")

// Store wraps pgxpool for all DB operations in this package.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Credential helpers
// ---------------------------------------------------------------------------

// GetWebhookSecretCiphertext returns the encrypted webhook secret for
// (provider_code, location_id) from location_payment_credentials.
// Returns ("", nil) when no row exists so callers can fall through to
// region-level credentials.
func (s *Store) GetWebhookSecretCiphertext(ctx context.Context, providerCode, locationID string) (string, error) {
	if s.pool == nil {
		return "", nil
	}
	var ct string
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT COALESCE(webhook_secret_ciphertext, '')
FROM location_payment_credentials
WHERE location_id = $1
  AND provider_code = $2
  AND is_active = true
LIMIT 1
`, locationID, providerCode).Scan(&ct)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return ct, err
}

// ---------------------------------------------------------------------------
// webhook_event_log helpers
// ---------------------------------------------------------------------------

// ErrNoPool is returned when the store has no database pool configured.
var ErrNoPool = errors.New("paymentwebhook: no database pool configured")

// LogWebhookEvent inserts a row into webhook_event_log. If the
// (provider, external_event_id) pair already exists it returns ErrDuplicate.
// Returns the new row's id on success.
func (s *Store) LogWebhookEvent(ctx context.Context, provider, eventType, externalEventID string, payload []byte) (string, error) {
	if s.pool == nil {
		return "", ErrNoPool
	}
	var id string
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO webhook_event_log
    (provider, event_type, external_event_id, signature_valid, payload, processing_status)
VALUES
    ($1, $2, $3, true, $4, 'pending')
RETURNING id
`, provider, eventType, externalEventID, json.RawMessage(payload)).Scan(&id)
	})
	if err != nil {
		if isUniqueViolation(err) {
			return "", ErrDuplicate
		}
		return "", err
	}
	return id, nil
}

// MarkWebhookProcessed sets processing_status = 'processed'.
func (s *Store) MarkWebhookProcessed(ctx context.Context, logID string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE webhook_event_log
SET processing_status = 'processed',
    processed_at      = now()
WHERE id = $1
`, logID)
		return err
	})
}

// MarkWebhookFailed sets processing_status = 'failed' and stores the error.
func (s *Store) MarkWebhookFailed(ctx context.Context, logID, errMsg string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE webhook_event_log
SET processing_status = 'failed',
    error_message     = $2,
    processed_at      = now()
WHERE id = $1
`, logID, errMsg)
		return err
	})
}

// MarkWebhookIgnored sets processing_status = 'ignored'.
func (s *Store) MarkWebhookIgnored(ctx context.Context, logID, reason string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE webhook_event_log
SET processing_status = 'ignored',
    error_message     = $2,
    processed_at      = now()
WHERE id = $1
`, logID, reason)
		return err
	})
}

// ---------------------------------------------------------------------------
// checkout.completed / charge.success
// ---------------------------------------------------------------------------

// paystackCheckoutData is the minimum shape of Paystack charge event data.
type paystackCheckoutData struct {
	Reference string `json:"reference"`
	Status    string `json:"status"`
	Amount    int64  `json:"amount"`
	Currency  string `json:"currency"`
}

// HandleCheckoutCompleted marks the order paid, inserts a payment_attempts
// row with status='completed', updates order_payments, and writes audit_log.
func (s *Store) HandleCheckoutCompleted(ctx context.Context, provider, locationID string, data json.RawMessage) error {
	var d paystackCheckoutData
	if err := json.Unmarshal(data, &d); err != nil {
		return err
	}
	if d.Reference == "" {
		return errors.New("checkout.completed: missing reference")
	}

	return s.inTx(ctx, func(tx pgx.Tx) error {
		// Upsert a payment_attempts row.
		var attemptID string
		err := tx.QueryRow(ctx, `
INSERT INTO payment_attempts
    (provider_code, provider_txn_id, status, amount_cents, currency_code, metadata)
VALUES
    ($1, $2, 'completed', $3, UPPER($4), '{}')
ON CONFLICT (provider_code, provider_txn_id) DO UPDATE
    SET status = 'completed', updated_at = now()
RETURNING id
`, provider, d.Reference, d.Amount, currencyOrDefault(d.Currency)).Scan(&attemptID)
		if err != nil {
			return err
		}

		// Mark the matching order_payment as completed.
		_, err = tx.Exec(ctx, `
UPDATE order_payments
SET payment_status     = 'completed',
    confirmed_at       = now(),
    payment_attempt_id = $2
WHERE payment_reference = $1
   OR external_transaction_id = $1
`, d.Reference, attemptID)
		if err != nil {
			return err
		}

		// Mark the order itself as completed where it was pending payment.
		_, err = tx.Exec(ctx, `
UPDATE orders o
SET status = 'completed'
FROM order_payments op
WHERE op.order_id = o.id
  AND (op.payment_reference = $1 OR op.external_transaction_id = $1)
  AND o.status IN ('pending','pending_on_delivery')
`, d.Reference)
		if err != nil {
			return err
		}

		return s.writeAuditLog(ctx, tx, provider, "checkout.completed", "order_payment", d.Reference, map[string]any{
			"provider_txn_id": d.Reference,
			"amount_cents":    d.Amount,
			"status":          d.Status,
		})
	})
}

// ---------------------------------------------------------------------------
// checkout.failed / charge.failed
// ---------------------------------------------------------------------------

// HandleCheckoutFailed marks the order_payment failed and inserts a
// payment_attempts row with status='failed'.
func (s *Store) HandleCheckoutFailed(ctx context.Context, provider, locationID string, data json.RawMessage) error {
	var d paystackCheckoutData
	if err := json.Unmarshal(data, &d); err != nil {
		return err
	}
	if d.Reference == "" {
		return errors.New("checkout.failed: missing reference")
	}

	return s.inTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
INSERT INTO payment_attempts
    (provider_code, provider_txn_id, status, amount_cents, currency_code, metadata)
VALUES
    ($1, $2, 'failed', $3, UPPER($4), '{}')
ON CONFLICT (provider_code, provider_txn_id) DO UPDATE
    SET status = 'failed', updated_at = now()
`, provider, d.Reference, d.Amount, currencyOrDefault(d.Currency))
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx, `
UPDATE order_payments
SET payment_status = 'failed'
WHERE payment_reference = $1
   OR external_transaction_id = $1
`, d.Reference)
		return err
	})
}

// ---------------------------------------------------------------------------
// refund.succeeded / refund.processed
// ---------------------------------------------------------------------------

type paystackRefundData struct {
	TransactionReference string `json:"transaction_reference"`
	Amount               int64  `json:"amount"`
	Currency             string `json:"currency"`
	// Paystack also sends an id field for the refund itself.
	ID json.RawMessage `json:"id"`
}

// HandleRefundSucceeded inserts into refunds and updates order_payments status.
func (s *Store) HandleRefundSucceeded(ctx context.Context, provider, locationID string, data json.RawMessage) error {
	var d paystackRefundData
	if err := json.Unmarshal(data, &d); err != nil {
		return err
	}

	return s.inTx(ctx, func(tx pgx.Tx) error {
		// Find the order_payment to link the refund.
		var paymentID, orderID string
		var totalPaidCents int64
		err := tx.QueryRow(ctx, `
SELECT op.id, op.order_id, op.amount_paid_cents
FROM order_payments op
WHERE op.payment_reference = $1
   OR op.external_transaction_id = $1
LIMIT 1
`, d.TransactionReference).Scan(&paymentID, &orderID, &totalPaidCents)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// No matching payment — skip gracefully.
				return nil
			}
			return err
		}

		refundType := "full"
		if d.Amount < totalPaidCents {
			refundType = "partial"
		}
		newStatus := "refunded"
		if refundType == "partial" {
			newStatus = "partially_refunded"
		}

		// Insert refund record.
		_, err = tx.Exec(ctx, `
INSERT INTO refunds
    (payment_id, order_id, refund_amount_cents, refund_type,
     external_refund_id, refund_status, refunded_at)
VALUES
    ($1, $2, $3, $4, $5, 'completed', now())
ON CONFLICT DO NOTHING
`, paymentID, orderID, d.Amount, refundType, rawIDString(d.ID))
		if err != nil {
			return err
		}

		// Update order_payment status.
		_, err = tx.Exec(ctx, `
UPDATE order_payments
SET payment_status = $2
WHERE id = $1
`, paymentID, newStatus)
		return err
	})
}

// ---------------------------------------------------------------------------
// Stripe helpers
// ---------------------------------------------------------------------------

type stripePaymentIntentData struct {
	Object struct {
		ID       string            `json:"id"`
		Status   string            `json:"status"`
		Amount   int64             `json:"amount"`
		Currency string            `json:"currency"`
		Metadata map[string]string `json:"metadata"`
	} `json:"object"`
}

// HandleStripePaymentIntentSucceeded marks the order paid.
func (s *Store) HandleStripePaymentIntentSucceeded(ctx context.Context, data json.RawMessage) error {
	var env stripePaymentIntentData
	if err := json.Unmarshal(data, &env); err != nil {
		return err
	}
	pi := env.Object
	orderID := pi.Metadata["order_id"]

	return s.inTx(ctx, func(tx pgx.Tx) error {
		var attemptID string
		err := tx.QueryRow(ctx, `
INSERT INTO payment_attempts
    (provider_code, provider_txn_id, status, amount_cents, currency_code, metadata)
VALUES
    ('stripe', $1, 'completed', $2, UPPER($3), '{}')
ON CONFLICT (provider_code, provider_txn_id) DO UPDATE
    SET status = 'completed', updated_at = now()
RETURNING id
`, pi.ID, pi.Amount, currencyOrDefault(pi.Currency)).Scan(&attemptID)
		if err != nil {
			return err
		}

		if orderID == "" {
			return nil
		}
		_, err = tx.Exec(ctx, `
UPDATE order_payments
SET payment_status     = 'completed',
    confirmed_at       = now(),
    payment_attempt_id = $2,
    external_transaction_id = $3
WHERE order_id = $1
`, orderID, attemptID, pi.ID)
		return err
	})
}

// HandleStripePaymentIntentFailed marks the order_payment failed.
func (s *Store) HandleStripePaymentIntentFailed(ctx context.Context, data json.RawMessage) error {
	var env stripePaymentIntentData
	if err := json.Unmarshal(data, &env); err != nil {
		return err
	}
	pi := env.Object
	orderID := pi.Metadata["order_id"]
	if orderID == "" {
		return nil
	}

	return s.inTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
INSERT INTO payment_attempts
    (provider_code, provider_txn_id, status, amount_cents, currency_code, metadata)
VALUES
    ('stripe', $1, 'failed', $2, UPPER($3), '{}')
ON CONFLICT (provider_code, provider_txn_id) DO UPDATE
    SET status = 'failed', updated_at = now()
`, pi.ID, pi.Amount, currencyOrDefault(pi.Currency))
		if err != nil {
			return err
		}

		_, err = tx.Exec(ctx, `
UPDATE order_payments
SET payment_status = 'failed',
    external_transaction_id = $2
WHERE order_id = $1
`, orderID, pi.ID)
		return err
	})
}

// HandleStripeChargeRefunded handles Stripe charge.refunded events.
func (s *Store) HandleStripeChargeRefunded(ctx context.Context, data json.RawMessage) error {
	var env struct {
		Object struct {
			PaymentIntent string `json:"payment_intent"`
			Metadata      map[string]string `json:"metadata"`
		} `json:"object"`
	}
	if err := json.Unmarshal(data, &env); err != nil {
		return err
	}
	orderID := env.Object.Metadata["order_id"]
	if orderID == "" {
		return nil
	}

	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
UPDATE order_payments
SET payment_status = 'refunded'
WHERE order_id = $1
`, orderID)
		return err
	})
}

// ---------------------------------------------------------------------------
// Transfer / payout helpers (re-implemented here so the unified handler
// does not need to import the separate transferwebhook package)
// ---------------------------------------------------------------------------

// PayoutRow is a minimal projection for transfer reconciliation.
type PayoutRow struct {
	ID             string
	TransferCode   string
	OrganizationID string
	LocationID     *string
}

// UpdatePayoutSuccess sets provider_transfer_status='success'.
func (s *Store) UpdatePayoutSuccess(ctx context.Context, transferCode string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		row, err := lockPayoutByCode(ctx, tx, transferCode)
		if err != nil || row.ID == "" {
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
		return payoutAuditLog(ctx, tx, row, "payout.transfer_success", map[string]any{
			"provider_transfer_id": transferCode,
		})
	})
}

// UpdatePayoutFailed sets provider_transfer_status='failed'.
func (s *Store) UpdatePayoutFailed(ctx context.Context, transferCode, reason string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		row, err := lockPayoutByCode(ctx, tx, transferCode)
		if err != nil || row.ID == "" {
			return err
		}
		_, err = tx.Exec(ctx, `
UPDATE merchant_payouts
SET provider_transfer_status = 'failed',
    provider_transfer_error  = $2,
    failed_at                = now()
WHERE id = $1
`, row.ID, reason)
		if err != nil {
			return err
		}
		return payoutAuditLog(ctx, tx, row, "payout.transfer_failed", map[string]any{
			"provider_transfer_id": transferCode,
			"failure_reason":       reason,
		})
	})
}

// UpdatePayoutReversed sets provider_transfer_status='reversed'.
func (s *Store) UpdatePayoutReversed(ctx context.Context, transferCode string) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		row, err := lockPayoutByCode(ctx, tx, transferCode)
		if err != nil || row.ID == "" {
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
		return payoutAuditLog(ctx, tx, row, "payout.transfer_reversed", map[string]any{
			"provider_transfer_id": transferCode,
		})
	})
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func (s *Store) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), fn)
}

func lockPayoutByCode(ctx context.Context, tx pgx.Tx, code string) (PayoutRow, error) {
	var row PayoutRow
	err := tx.QueryRow(ctx, `
SELECT id, COALESCE(provider_transfer_id,''), organization_id, location_id
FROM merchant_payouts
WHERE provider_transfer_id = $1
FOR UPDATE
`, code).Scan(&row.ID, &row.TransferCode, &row.OrganizationID, &row.LocationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return row, nil
	}
	return row, err
}

func payoutAuditLog(ctx context.Context, tx pgx.Tx, row PayoutRow, action string, after map[string]any) error {
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

// writeAuditLog appends a generic webhook audit entry.
func (s *Store) writeAuditLog(ctx context.Context, tx pgx.Tx, provider, action, entityType, entityRef string, after map[string]any) error {
	afterJSON, _ := json.Marshal(after)
	_, err := tx.Exec(ctx, `
INSERT INTO audit_log
    (actor_type, actor_label, action, entity_type, entity_id, after_state)
VALUES
    ('webhook', $1, $2, $3, $4::text, $5)
`, provider+":webhook", action, entityType, entityRef, json.RawMessage(afterJSON))
	return err
}

func currencyOrDefault(c string) string {
	if c == "" {
		return "ZAR"
	}
	return c
}

func rawIDString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	s := strings.Trim(string(raw), `"`)
	if s == "null" {
		return ""
	}
	return s
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

