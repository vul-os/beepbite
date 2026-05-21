// Package walletrefill provides a nightly background job that automatically
// tops up org wallets whose balance has dropped below the configured threshold.
//
// Schema relationships:
//
//	org_wallets                   — one row per org; balance_cents maintained by trigger
//	  saved_payment_method_id     — FK → customer_payment_authorizations(id)
//	  auto_refill_threshold_cents — top-up when balance < this value (NULL = disabled)
//	  auto_refill_target_cents    — top up to this target amount (NULL = disabled)
//
//	wallet_topups                 — one row per top-up attempt
//	  status                      — topup_status enum: initiated | succeeded | failed | refunded
//
//	wallet_transactions           — append-only ledger; BEFORE INSERT trigger updates balance_cents
//	  idempotency_key             — unique text; derived from wallet_topups.id to prevent double-credit
//	  kind                        — wallet_txn_kind enum; use 'topup'
//	  amount_cents                — positive integer (credit)
//	  reference_type              — 'wallet_topup'
//	  reference_id                — wallet_topups.id
package walletrefill

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// walletRow holds the columns we need from the joined org_wallets +
// customer_payment_authorizations query.
type walletRow struct {
	OrgID              string
	BalanceCents       int64
	ThresholdCents     int64
	TargetCents        int64
	CurrencyCode       string
	GatewayProvider    string
	AuthorizationCode  string // token stored in customer_payment_authorizations
}

// loadEligibleWallets returns every org_wallet that:
//   - has both auto_refill_threshold_cents and auto_refill_target_cents set, AND
//   - balance_cents < auto_refill_threshold_cents, AND
//   - has a linked saved_payment_method_id (i.e. a stored payment method).
//
// The query joins customer_payment_authorizations to obtain the
// authorization_code (payment token) and gateway_provider so that callers can
// pass them to the payments.Provider.ChargeSaved method.
func loadEligibleWallets(ctx context.Context, tx pgx.Tx) ([]walletRow, error) {
	rows, err := tx.Query(ctx, `
SELECT
    ow.org_id,
    ow.balance_cents,
    ow.auto_refill_threshold_cents,
    ow.auto_refill_target_cents,
    ow.currency_code,
    cpa.gateway_provider,
    cpa.authorization_code
FROM org_wallets ow
JOIN customer_payment_authorizations cpa
    ON cpa.id = ow.saved_payment_method_id
   AND cpa.is_active = true
WHERE ow.auto_refill_enabled          = true
  AND ow.auto_refill_threshold_cents IS NOT NULL
  AND ow.auto_refill_target_cents    IS NOT NULL
  AND ow.balance_cents < ow.auto_refill_threshold_cents
ORDER BY ow.org_id
`)
	if err != nil {
		return nil, fmt.Errorf("walletrefill: query eligible wallets: %w", err)
	}
	defer rows.Close()

	var out []walletRow
	for rows.Next() {
		var w walletRow
		if err := rows.Scan(
			&w.OrgID,
			&w.BalanceCents,
			&w.ThresholdCents,
			&w.TargetCents,
			&w.CurrencyCode,
			&w.GatewayProvider,
			&w.AuthorizationCode,
		); err != nil {
			return nil, fmt.Errorf("walletrefill: scan wallet row: %w", err)
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// insertTopup inserts a wallet_topups row with status 'initiated' and returns
// the generated UUID.  The INSERT is idempotent across retry runs only if no
// prior 'initiated' row already exists for the same org; callers handle
// idempotency via the wallet_transactions.idempotency_key unique constraint.
func insertTopup(ctx context.Context, tx pgx.Tx, orgID string, amountCents int64, currencyCode string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
INSERT INTO wallet_topups (org_id, amount_cents, currency_code, status)
VALUES ($1, $2, $3, 'initiated')
RETURNING id
`, orgID, amountCents, currencyCode).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("walletrefill: insert wallet_topup (org=%s): %w", orgID, err)
	}
	return id, nil
}

// markTopupFailed updates the topup row to status='failed'.
func markTopupFailed(ctx context.Context, tx pgx.Tx, topupID string, reason string) error {
	_, err := tx.Exec(ctx, `
UPDATE wallet_topups
SET status = 'failed', updated_at = now()
WHERE id = $1
`, topupID)
	if err != nil {
		return fmt.Errorf("walletrefill: mark topup %s failed: %w", topupID, err)
	}
	return nil
}

// markTopupSucceeded updates the topup row to status='succeeded'.
func markTopupSucceeded(ctx context.Context, tx pgx.Tx, topupID string) error {
	_, err := tx.Exec(ctx, `
UPDATE wallet_topups
SET status = 'succeeded', completed_at = now(), updated_at = now()
WHERE id = $1
`, topupID)
	if err != nil {
		return fmt.Errorf("walletrefill: mark topup %s succeeded: %w", topupID, err)
	}
	return nil
}

// insertWalletTransaction appends a credit entry to wallet_transactions.
// The BEFORE INSERT trigger trg_fn_wallet_transaction_balance atomically
// increments org_wallets.balance_cents and writes balance_after_cents on the
// new row.
//
// idempotencyKey must be unique; we derive it from the topup ID so that a
// re-run of the job after a partial failure cannot double-credit the wallet.
func insertWalletTransaction(
	ctx context.Context,
	tx pgx.Tx,
	orgID string,
	amountCents int64,
	topupID string,
	description string,
) error {
	idempotencyKey := "walletrefill:" + topupID
	_, err := tx.Exec(ctx, `
INSERT INTO wallet_transactions (
    org_id, kind, amount_cents, description,
    reference_type, reference_id, idempotency_key
) VALUES (
    $1, 'topup', $2, $3,
    'wallet_topup', $4::uuid, $5
)
ON CONFLICT (idempotency_key) DO NOTHING
`, orgID, amountCents, description, topupID, idempotencyKey)
	if err != nil {
		return fmt.Errorf("walletrefill: insert wallet_transaction (org=%s topup=%s): %w", orgID, topupID, err)
	}
	return nil
}
