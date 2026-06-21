package wallet

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Domain types (mirror DB rows; nullable columns are pointers)
// ---------------------------------------------------------------------------

// OrgWallet mirrors the org_wallets row.
type OrgWallet struct {
	OrgID                    string    `json:"org_id"`
	BalanceCents             int64     `json:"balance_cents"`
	HoldCents                int64     `json:"hold_cents"`
	CurrencyCode             string    `json:"currency_code"`
	AutoRefillEnabled        bool      `json:"auto_refill_enabled"`
	AutoRefillThresholdCents *int64    `json:"auto_refill_threshold_cents"`
	AutoRefillTargetCents    *int64    `json:"auto_refill_target_cents"`
	SavedPaymentMethodID     *string   `json:"saved_payment_method_id"`
	UpdatedAt                time.Time `json:"updated_at"`
}

// WalletTopup mirrors a wallet_topups row.
type WalletTopup struct {
	ID               string     `json:"id"`
	OrgID            string     `json:"org_id"`
	AmountCents      int64      `json:"amount_cents"`
	CurrencyCode     string     `json:"currency_code"`
	PaymentAttemptID *string    `json:"payment_attempt_id"`
	Status           string     `json:"status"`
	CreatedAt        time.Time  `json:"created_at"`
	CompletedAt      *time.Time `json:"completed_at"`
}

// WalletTransaction mirrors a wallet_transactions row.
type WalletTransaction struct {
	ID                string    `json:"id"`
	OrgID             string    `json:"org_id"`
	Kind              string    `json:"kind"`
	AmountCents       int64     `json:"amount_cents"`
	BalanceAfterCents *int64    `json:"balance_after_cents"`
	Description       *string   `json:"description"`
	ReferenceType     *string   `json:"reference_type"`
	ReferenceID       *string   `json:"reference_id"`
	IdempotencyKey    *string   `json:"idempotency_key"`
	CreatedAt         time.Time `json:"created_at"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store wraps a pgxpool and delegates every query to db.Scoped so RLS session
// variables are set correctly for each request.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// GetOrCreateWallet
// ---------------------------------------------------------------------------

// GetOrCreateWallet returns the caller's org wallet, creating it lazily if the
// row is missing.  The INSERT uses the org's default_currency_code; if that is
// not set the wallet defaults to 'ZAR'.  On conflict (concurrent creation) the
// INSERT is silently ignored and the SELECT wins.
func (s *Store) GetOrCreateWallet(ctx context.Context) (*OrgWallet, error) {
	var w OrgWallet
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Lazy insert — harmless if the row already exists.
		_, err := tx.Exec(ctx, `
INSERT INTO org_wallets (org_id, currency_code)
SELECT id, COALESCE(default_currency_code, 'ZAR')
FROM   organizations
WHERE  id = current_org_id()
ON CONFLICT (org_id) DO NOTHING
`)
		if err != nil {
			return err
		}

		return tx.QueryRow(ctx, `
SELECT org_id,
       balance_cents,
       hold_cents,
       currency_code,
       auto_refill_enabled,
       auto_refill_threshold_cents,
       auto_refill_target_cents,
       saved_payment_method_id,
       updated_at
FROM   org_wallets
WHERE  org_id = current_org_id()
`).Scan(
			&w.OrgID,
			&w.BalanceCents,
			&w.HoldCents,
			&w.CurrencyCode,
			&w.AutoRefillEnabled,
			&w.AutoRefillThresholdCents,
			&w.AutoRefillTargetCents,
			&w.SavedPaymentMethodID,
			&w.UpdatedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// ---------------------------------------------------------------------------
// ListTransactions
// ---------------------------------------------------------------------------

// ListTransactions returns up to limit wallet_transactions for the caller's
// org, ordered newest-first.  When before is non-empty it is used as an
// exclusive cursor (UUID of the last-seen row's id).
func (s *Store) ListTransactions(ctx context.Context, limit int, before string) ([]WalletTransaction, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	out := []WalletTransaction{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var (
			q    string
			args []any
		)
		if before == "" {
			q = `
SELECT id, org_id, kind, amount_cents, balance_after_cents,
       description, reference_type, reference_id::text, idempotency_key, created_at
FROM   wallet_transactions
WHERE  org_id = current_org_id()
ORDER  BY created_at DESC, id DESC
LIMIT  $1`
			args = []any{limit}
		} else {
			// Keyset pagination: rows older than the cursor row.
			q = `
SELECT id, org_id, kind, amount_cents, balance_after_cents,
       description, reference_type, reference_id::text, idempotency_key, created_at
FROM   wallet_transactions
WHERE  org_id = current_org_id()
  AND  (created_at, id) < (
      SELECT created_at, id FROM wallet_transactions WHERE id = $2::uuid
  )
ORDER  BY created_at DESC, id DESC
LIMIT  $1`
			args = []any{limit, before}
		}

		rows, err := tx.Query(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var t WalletTransaction
			if err := rows.Scan(
				&t.ID, &t.OrgID, &t.Kind, &t.AmountCents, &t.BalanceAfterCents,
				&t.Description, &t.ReferenceType, &t.ReferenceID, &t.IdempotencyKey, &t.CreatedAt,
			); err != nil {
				return err
			}
			out = append(out, t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// InitiateTopup
// ---------------------------------------------------------------------------

// InitiateTopup inserts a wallet_topups row with status='initiated' and
// returns it.  The currency_code is copied from the org_wallet; if no wallet
// row exists yet it defaults to 'ZAR' (the lazy-create in GetOrCreateWallet
// should normally be called first, but this is resilient either way).
//
// Actual payment-provider charge wiring happens outside this package — the
// caller (e.g. a payment webhook handler) transitions the topup to 'succeeded'
// and then inserts a wallet_transactions credit row which triggers the balance
// update.
func (s *Store) InitiateTopup(ctx context.Context, amountCents int64) (*WalletTopup, error) {
	var t WalletTopup
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO wallet_topups (org_id, amount_cents, currency_code)
SELECT current_org_id(),
       $1,
       COALESCE((SELECT currency_code FROM org_wallets WHERE org_id = current_org_id()), 'ZAR')
RETURNING id, org_id, amount_cents, currency_code,
          payment_attempt_id::text, status, created_at, completed_at
`, amountCents).Scan(
			&t.ID, &t.OrgID, &t.AmountCents, &t.CurrencyCode,
			&t.PaymentAttemptID, &t.Status, &t.CreatedAt, &t.CompletedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// ---------------------------------------------------------------------------
// UpdateAutoRefill
// ---------------------------------------------------------------------------

// UpdateAutoRefill sets the three auto-refill columns on org_wallets for the
// caller's org.  It returns the full updated row so the caller can echo it.
func (s *Store) UpdateAutoRefill(
	ctx context.Context,
	enabled *bool,
	thresholdCents, targetCents *int64,
) (*OrgWallet, error) {
	var w OrgWallet
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
UPDATE org_wallets
SET    auto_refill_enabled         = COALESCE($1, auto_refill_enabled),
       auto_refill_threshold_cents = $2,
       auto_refill_target_cents    = $3,
       updated_at                  = now()
WHERE  org_id = current_org_id()
RETURNING org_id,
          balance_cents,
          hold_cents,
          currency_code,
          auto_refill_enabled,
          auto_refill_threshold_cents,
          auto_refill_target_cents,
          saved_payment_method_id,
          updated_at
`, enabled, thresholdCents, targetCents).Scan(
			&w.OrgID,
			&w.BalanceCents,
			&w.HoldCents,
			&w.CurrencyCode,
			&w.AutoRefillEnabled,
			&w.AutoRefillThresholdCents,
			&w.AutoRefillTargetCents,
			&w.SavedPaymentMethodID,
			&w.UpdatedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	return &w, nil
}
