// Package storecredit exposes store-credit and loyalty REST endpoints on top
// of migration-25 tables. Mount under an already-authenticated chi.Router.
package storecredit

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors for HTTP status-code mapping.
var (
	ErrInsufficientCredit    = errors.New("insufficient store credit balance")
	ErrStoreCreditNotFound   = errors.New("store credit record not found")
	ErrCustomerNotFound      = errors.New("customer not found")
	ErrOrderNotFound         = errors.New("order not found")
	ErrRedeemExceedsBalance  = errors.New("redeem amount exceeds current balance")
	ErrInsufficientPoints    = errors.New("insufficient loyalty points")
	ErrLoyaltyConfigNotFound = errors.New("loyalty config not found for organization")
	ErrBelowMinRedemption    = errors.New("points below minimum redemption threshold")
	ErrExceedsMaxRedemption  = errors.New("redemption exceeds max percentage of order")

	// ErrCurrencyNotConfigured is returned when store credit must be written for
	// an organization that has no default_currency_code. store_credits.currency
	// is NOT NULL and migration 056 removed its 'ZAR' default, so there is
	// nothing honest to put in the column until the operator configures one.
	ErrCurrencyNotConfigured = errors.New("organization has no default_currency_code — set it before issuing store credit")
)

// orgCurrency resolves an organization's configured currency code and its
// minor-unit exponent.
//
// Store credit is organization-scoped rather than location-scoped — the
// store_credits row has no location_id — so the organization's
// default_currency_code is the correct authority here, not a location's.
//
// `code` is empty when the organization has not configured one. `decimals`
// falls back to 2 in that case: it is the ISO 4217 majority and only governs
// how an already-currency-less amount is split for display, so it cannot claim
// a currency the way an invented code would.
func orgCurrency(ctx context.Context, tx pgx.Tx, organizationID string) (code string, decimals int, err error) {
	decimals = 2
	var (
		c *string
		d *int
	)
	err = tx.QueryRow(ctx, `
SELECT o.default_currency_code, c.decimal_digits
FROM organizations o
LEFT JOIN currencies c ON c.code = o.default_currency_code
WHERE o.id = $1
`, organizationID).Scan(&c, &d)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", decimals, nil
	}
	if err != nil {
		return "", decimals, err
	}
	if c != nil {
		code = *c
	}
	if d != nil {
		decimals = *d
	}
	return code, decimals, nil
}

// Store wraps a pgxpool.Pool for all store-credit DB operations.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---- Domain types ----

// StoreCredit mirrors the store_credits row.
type StoreCredit struct {
	ID             string    `json:"id"`
	OrganizationID string    `json:"organization_id"`
	CustomerID     string    `json:"customer_id"`
	BalanceCents   int64     `json:"balance_cents"`
	Currency       string    `json:"currency"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// StoreCreditTransaction mirrors a store_credit_transactions row.
type StoreCreditTransaction struct {
	ID               string     `json:"id"`
	StoreCreditID    string     `json:"store_credit_id"`
	TxnType          string     `json:"txn_type"`
	AmountCents      int64      `json:"amount_cents"`
	BalanceAfter     int64      `json:"balance_after_cents"`
	OrderID          *string    `json:"order_id,omitempty"`
	PaymentID        *string    `json:"payment_id,omitempty"`
	RefundID         *string    `json:"refund_id,omitempty"`
	PerformedByStaff *string    `json:"performed_by_staff_id,omitempty"`
	GrantedByProfile *string    `json:"granted_by_profile_id,omitempty"`
	Reason           *string    `json:"reason,omitempty"`
	ExpiresAt        *time.Time `json:"expires_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

// CustomerCreditSummary is the response for GET /store-credit/customers/{id}.
type CustomerCreditSummary struct {
	CustomerID   string                   `json:"customer_id"`
	TotalBalance int64                    `json:"total_balance_cents"`
	Credits      []StoreCredit            `json:"credits"`
	Transactions []StoreCreditTransaction `json:"transactions"`
}

// ---- Store methods ----

// GrantCredit upserts a store_credits row and writes a grant ledger entry.
// If no row exists yet for (organization_id, customer_id) one is created.
func (s *Store) GrantCredit(
	ctx context.Context,
	organizationID, customerID string,
	amountCents int64,
	reason, grantedByStaffID string,
) (*StoreCreditTransaction, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Currency was a SQL literal here, which made it not merely a bad default but
	// impossible to override: every organization on the platform, in every
	// country, had its customers' credit balances denominated in rand no matter
	// what its settings said. It is now a parameter resolved from the org.
	currency, _, err := orgCurrency(ctx, tx, organizationID)
	if err != nil {
		return nil, err
	}
	if currency == "" {
		return nil, ErrCurrencyNotConfigured
	}

	// Upsert the store_credits row and return the new balance.
	var creditID string
	var newBalance int64
	err = tx.QueryRow(ctx, `
INSERT INTO store_credits (organization_id, customer_id, balance_cents, currency)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, customer_id)
DO UPDATE SET balance_cents = store_credits.balance_cents + EXCLUDED.balance_cents,
              updated_at    = now()
RETURNING id, balance_cents
`, organizationID, customerID, amountCents, currency).Scan(&creditID, &newBalance)
	if err != nil {
		return nil, err
	}

	var txnOut StoreCreditTransaction
	err = tx.QueryRow(ctx, `
INSERT INTO store_credit_transactions
    (store_credit_id, txn_type, amount_cents, balance_after_cents,
     performed_by_staff_id, reason)
VALUES ($1, 'grant', $2, $3, $4, $5)
RETURNING id, store_credit_id, txn_type, amount_cents, balance_after_cents,
          order_id, payment_id, refund_id, performed_by_staff_id,
          granted_by_profile_id, reason, expires_at, created_at
`, creditID, amountCents, newBalance, nullStr(grantedByStaffID), nullStr(reason),
	).Scan(
		&txnOut.ID, &txnOut.StoreCreditID, &txnOut.TxnType, &txnOut.AmountCents,
		&txnOut.BalanceAfter, &txnOut.OrderID, &txnOut.PaymentID, &txnOut.RefundID,
		&txnOut.PerformedByStaff, &txnOut.GrantedByProfile, &txnOut.Reason,
		&txnOut.ExpiresAt, &txnOut.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	return &txnOut, tx.Commit(ctx)
}

// RedeemCredit deducts amountCents from the customer's store_credit balance
// inside a FOR UPDATE transaction and rejects if balance < amount.
func (s *Store) RedeemCredit(
	ctx context.Context,
	organizationID, customerID, orderID string,
	amountCents int64,
	performedByStaffID string,
) (*StoreCreditTransaction, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var creditID string
	var currentBalance int64
	err = tx.QueryRow(ctx, `
SELECT id, balance_cents FROM store_credits
WHERE organization_id = $1 AND customer_id = $2
FOR UPDATE
`, organizationID, customerID).Scan(&creditID, &currentBalance)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrStoreCreditNotFound
	}
	if err != nil {
		return nil, err
	}
	if currentBalance < amountCents {
		return nil, ErrRedeemExceedsBalance
	}

	newBalance := currentBalance - amountCents
	if _, err := tx.Exec(ctx, `
UPDATE store_credits SET balance_cents = $1, updated_at = now()
WHERE id = $2
`, newBalance, creditID); err != nil {
		return nil, err
	}

	var txnOut StoreCreditTransaction
	err = tx.QueryRow(ctx, `
INSERT INTO store_credit_transactions
    (store_credit_id, txn_type, amount_cents, balance_after_cents,
     order_id, performed_by_staff_id)
VALUES ($1, 'redeem', $2, $3, $4, $5)
RETURNING id, store_credit_id, txn_type, amount_cents, balance_after_cents,
          order_id, payment_id, refund_id, performed_by_staff_id,
          granted_by_profile_id, reason, expires_at, created_at
`, creditID, amountCents, newBalance, nullStr(orderID), nullStr(performedByStaffID),
	).Scan(
		&txnOut.ID, &txnOut.StoreCreditID, &txnOut.TxnType, &txnOut.AmountCents,
		&txnOut.BalanceAfter, &txnOut.OrderID, &txnOut.PaymentID, &txnOut.RefundID,
		&txnOut.PerformedByStaff, &txnOut.GrantedByProfile, &txnOut.Reason,
		&txnOut.ExpiresAt, &txnOut.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	return &txnOut, tx.Commit(ctx)
}

// RefundToCredit adds a refund amount to a customer's store credit and records
// a refund_to_credit ledger entry, optionally linked to a refunds row.
func (s *Store) RefundToCredit(
	ctx context.Context,
	organizationID, customerID string,
	amountCents int64,
	orderID, refundID, performedByStaffID, reason string,
) (*StoreCreditTransaction, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Same as GrantCredit: the currency is the organization's, not a literal.
	// A refund credited back to a customer must be denominated in the currency
	// they actually paid in.
	currency, _, err := orgCurrency(ctx, tx, organizationID)
	if err != nil {
		return nil, err
	}
	if currency == "" {
		return nil, ErrCurrencyNotConfigured
	}

	var creditID string
	var newBalance int64
	err = tx.QueryRow(ctx, `
INSERT INTO store_credits (organization_id, customer_id, balance_cents, currency)
VALUES ($1, $2, $3, $4)
ON CONFLICT (organization_id, customer_id)
DO UPDATE SET balance_cents = store_credits.balance_cents + EXCLUDED.balance_cents,
              updated_at    = now()
RETURNING id, balance_cents
`, organizationID, customerID, amountCents, currency).Scan(&creditID, &newBalance)
	if err != nil {
		return nil, err
	}

	var txnOut StoreCreditTransaction
	err = tx.QueryRow(ctx, `
INSERT INTO store_credit_transactions
    (store_credit_id, txn_type, amount_cents, balance_after_cents,
     order_id, refund_id, performed_by_staff_id, reason)
VALUES ($1, 'refund_to_credit', $2, $3, $4, $5, $6, $7)
RETURNING id, store_credit_id, txn_type, amount_cents, balance_after_cents,
          order_id, payment_id, refund_id, performed_by_staff_id,
          granted_by_profile_id, reason, expires_at, created_at
`, creditID, amountCents, newBalance,
		nullStr(orderID), nullStr(refundID), nullStr(performedByStaffID), nullStr(reason),
	).Scan(
		&txnOut.ID, &txnOut.StoreCreditID, &txnOut.TxnType, &txnOut.AmountCents,
		&txnOut.BalanceAfter, &txnOut.OrderID, &txnOut.PaymentID, &txnOut.RefundID,
		&txnOut.PerformedByStaff, &txnOut.GrantedByProfile, &txnOut.Reason,
		&txnOut.ExpiresAt, &txnOut.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	return &txnOut, tx.Commit(ctx)
}

// GetCustomerCredits returns the StoreCredit row(s) and recent transactions
// for a customer. store_credits has a unique(org, customer) constraint so
// there will normally be exactly one row, but the query is intentionally broad
// to survive any future multi-currency extension.
func (s *Store) GetCustomerCredits(
	ctx context.Context,
	customerID string,
) (*CustomerCreditSummary, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, organization_id, customer_id, balance_cents, currency, created_at, updated_at
FROM store_credits
WHERE customer_id = $1
ORDER BY created_at DESC
`, customerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var credits []StoreCredit
	var total int64
	for rows.Next() {
		var sc StoreCredit
		if err := rows.Scan(&sc.ID, &sc.OrganizationID, &sc.CustomerID,
			&sc.BalanceCents, &sc.Currency, &sc.CreatedAt, &sc.UpdatedAt); err != nil {
			return nil, err
		}
		credits = append(credits, sc)
		total += sc.BalanceCents
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if credits == nil {
		credits = []StoreCredit{}
	}

	// Collect credit IDs for transaction lookup.
	creditIDs := make([]string, len(credits))
	for i, c := range credits {
		creditIDs[i] = c.ID
	}

	txns, err := s.getTransactionsForCredits(ctx, creditIDs)
	if err != nil {
		return nil, err
	}

	return &CustomerCreditSummary{
		CustomerID:   customerID,
		TotalBalance: total,
		Credits:      credits,
		Transactions: txns,
	}, nil
}

func (s *Store) getTransactionsForCredits(
	ctx context.Context,
	creditIDs []string,
) ([]StoreCreditTransaction, error) {
	if len(creditIDs) == 0 {
		return []StoreCreditTransaction{}, nil
	}

	rows, err := s.pool.Query(ctx, `
SELECT id, store_credit_id, txn_type, amount_cents, balance_after_cents,
       order_id, payment_id, refund_id, performed_by_staff_id,
       granted_by_profile_id, reason, expires_at, created_at
FROM store_credit_transactions
WHERE store_credit_id = ANY($1)
ORDER BY created_at DESC
LIMIT 200
`, creditIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []StoreCreditTransaction
	for rows.Next() {
		var t StoreCreditTransaction
		if err := rows.Scan(
			&t.ID, &t.StoreCreditID, &t.TxnType, &t.AmountCents, &t.BalanceAfter,
			&t.OrderID, &t.PaymentID, &t.RefundID, &t.PerformedByStaff,
			&t.GrantedByProfile, &t.Reason, &t.ExpiresAt, &t.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if out == nil {
		out = []StoreCreditTransaction{}
	}
	return out, rows.Err()
}

// nullStr converts an empty string to nil so optional columns arrive as SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
