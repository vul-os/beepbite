// Package giftcards exposes REST endpoints for issuing, redeeming, reloading,
// refunding, and looking up gift cards on top of migration-25 tables.
package giftcards

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// Sentinel errors mapped to HTTP status codes in the handler layer.
var (
	ErrCardNotFound      = errors.New("gift card not found")
	ErrCardExpired       = errors.New("gift card has expired")
	ErrCardNotActive     = errors.New("gift card is not active")
	ErrInsufficientFunds = errors.New("insufficient gift card balance")
	ErrInvalidPIN        = errors.New("invalid PIN")
	ErrCodeCollision     = errors.New("gift card code collision after retries")
)

// GiftCard mirrors the columns of gift_cards that the API surfaces.
type GiftCard struct {
	ID                  string     `json:"id"`
	OrganizationID      string     `json:"organization_id"`
	Code                string     `json:"code"`
	CardType            string     `json:"card_type"`
	InitialBalanceCents int64      `json:"initial_balance_cents"`
	CurrentBalanceCents int64      `json:"current_balance_cents"`
	Currency            string     `json:"currency"`
	Status              string     `json:"status"`
	IssuedToCustomerID  *string    `json:"issued_to_customer_id,omitempty"`
	IssuedToName        *string    `json:"issued_to_name,omitempty"`
	IssuedToEmail       *string    `json:"issued_to_email,omitempty"`
	IssuedToPhone       *string    `json:"issued_to_phone,omitempty"`
	IssuedByStaffID     *string    `json:"issued_by_staff_id,omitempty"`
	ExpiresAt           *time.Time `json:"expires_at,omitempty"`
	ActivatedAt         *time.Time `json:"activated_at,omitempty"`
	LastRedeemedAt      *time.Time `json:"last_redeemed_at,omitempty"`
	Notes               *string    `json:"notes,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

// GiftCardTransaction mirrors gift_card_transactions.
type GiftCardTransaction struct {
	ID               string    `json:"id"`
	GiftCardID       string    `json:"gift_card_id"`
	TxnType          string    `json:"txn_type"`
	AmountCents      int64     `json:"amount_cents"`
	BalanceAfterCents int64    `json:"balance_after_cents"`
	OrderID          *string   `json:"order_id,omitempty"`
	PaymentID        *string   `json:"payment_id,omitempty"`
	PerformedByStaffID *string `json:"performed_by_staff_id,omitempty"`
	Notes            *string   `json:"notes,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}

// IssueResult is what POST /gift-cards/issue returns to the caller.
type IssueResult struct {
	ID         string `json:"id"`
	MaskedCode string `json:"masked_code"`
}

// LookupResult is what GET /gift-cards/lookup returns.
type LookupResult struct {
	ID                  string     `json:"id"`
	MaskedCode          string     `json:"masked_code"`
	CurrentBalanceCents int64      `json:"current_balance_cents"`
	Currency            string     `json:"currency"`
	Status              string     `json:"status"`
	ExpiresAt           *time.Time `json:"expires_at,omitempty"`
}

// Store wraps pgxpool.Pool for all gift-card database operations.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// IssueParams carries everything needed to create a new gift card.
type IssueParams struct {
	OrganizationID     string
	Code               string // empty → auto-generate
	CardType           string // "physical" | "digital"
	PIN                string // plain-text; empty → no PIN
	InitialBalanceCents int64
	Currency           string // empty → "ZAR"
	IssuedToCustomerID string
	IssuedToName       string
	IssuedToEmail      string
	IssuedToPhone      string
	IssuedByStaffID    string
	ExpiresAt          *time.Time
	Notes              string
}

// Issue creates a gift_cards row and a matching 'issue' ledger row inside a
// single transaction. If no Code is supplied it is generated (up to 3
// attempts to avoid collisions).
func (s *Store) Issue(ctx context.Context, p IssueParams) (*IssueResult, error) {
	// Hash PIN if supplied.
	var pinHash *string
	if p.PIN != "" {
		h, err := bcrypt.GenerateFromPassword([]byte(p.PIN), bcrypt.DefaultCost)
		if err != nil {
			return nil, fmt.Errorf("bcrypt PIN: %w", err)
		}
		hs := string(h)
		pinHash = &hs
	}

	currency := p.Currency
	if currency == "" {
		currency = "ZAR"
	}
	cardType := p.CardType
	if cardType == "" {
		cardType = "digital"
	}

	const maxAttempts = 3
	for attempt := 0; attempt < maxAttempts; attempt++ {
		code := strings.ToUpper(p.Code)
		if code == "" {
			var err error
			code, err = generateCode()
			if err != nil {
				return nil, err
			}
		}

		result, err := s.issueOnce(ctx, p, code, pinHash, currency, cardType)
		if err != nil {
			// 23505 = unique_violation on gift_cards_code_lower; retry only when
			// the caller didn't supply an explicit code.
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == "23505" && p.Code == "" {
				continue
			}
			return nil, err
		}
		return result, nil
	}
	return nil, ErrCodeCollision
}

func (s *Store) issueOnce(
	ctx context.Context,
	p IssueParams,
	code string,
	pinHash *string,
	currency, cardType string,
) (*IssueResult, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var cardID string
	err = tx.QueryRow(ctx, `
INSERT INTO gift_cards (
    organization_id, code, card_type, pin_hash,
    initial_balance_cents, current_balance_cents, currency,
    issued_to_customer_id, issued_to_name, issued_to_email, issued_to_phone,
    issued_by_staff_id, expires_at, activated_at, notes
) VALUES (
    $1, $2, $3, $4,
    $5, $5, $6,
    $7, $8, $9, $10,
    $11, $12, now(), $13
)
RETURNING id`,
		p.OrganizationID, code, cardType, pinHash,
		p.InitialBalanceCents, currency,
		nullStr(p.IssuedToCustomerID), nullStr(p.IssuedToName),
		nullStr(p.IssuedToEmail), nullStr(p.IssuedToPhone),
		nullStr(p.IssuedByStaffID), p.ExpiresAt, nullStr(p.Notes),
	).Scan(&cardID)
	if err != nil {
		return nil, err
	}

	// Write the opening ledger row.
	if _, err := tx.Exec(ctx, `
INSERT INTO gift_card_transactions (gift_card_id, txn_type, amount_cents, balance_after_cents, performed_by_staff_id, notes)
VALUES ($1, 'issue', $2, $2, $3, $4)`,
		cardID, p.InitialBalanceCents,
		nullStr(p.IssuedByStaffID), nullStr(p.Notes),
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &IssueResult{ID: cardID, MaskedCode: maskCode(code)}, nil
}

// TxnParams carries the shared fields for redeem / reload / refund.
type TxnParams struct {
	Code            string
	AmountCents     int64
	OrderID         string
	PaymentID       string
	PerformedByStaffID string
	Notes           string
}

// redeemOrMutate is the shared lock→check→ledger→update transaction used by
// Redeem, Reload, and Refund. txnType must be "redeem", "reload", or "refund".
func (s *Store) redeemOrMutate(ctx context.Context, txnType string, p TxnParams) (*GiftCardTransaction, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Lock the row for the duration of the transaction.
	var (
		cardID  string
		balance int64
		status  string
		expires *time.Time
	)
	err = tx.QueryRow(ctx, `
SELECT id, current_balance_cents, status, expires_at
FROM gift_cards
WHERE lower(code) = lower($1)
FOR UPDATE`, p.Code).Scan(&cardID, &balance, &status, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCardNotFound
	}
	if err != nil {
		return nil, err
	}

	// Expiry check.
	if expires != nil && expires.Before(time.Now()) {
		return nil, ErrCardExpired
	}
	// Status check.
	if status != "active" {
		return nil, ErrCardNotActive
	}

	// Compute new balance.
	var newBalance int64
	var ledgerAmount int64
	switch txnType {
	case "redeem":
		if balance < p.AmountCents {
			return nil, ErrInsufficientFunds
		}
		newBalance = balance - p.AmountCents
		ledgerAmount = -p.AmountCents
	case "reload":
		newBalance = balance + p.AmountCents
		ledgerAmount = p.AmountCents
	case "refund":
		newBalance = balance + p.AmountCents
		ledgerAmount = p.AmountCents
	default:
		return nil, fmt.Errorf("unknown txn type: %s", txnType)
	}

	// Update card balance + timestamps.
	updateSQL := `
UPDATE gift_cards
SET current_balance_cents = $2,
    updated_at             = now()`
	if txnType == "redeem" {
		updateSQL += `,
    last_redeemed_at = now()`
	}
	updateSQL += `
WHERE id = $1`
	if _, err := tx.Exec(ctx, updateSQL, cardID, newBalance); err != nil {
		return nil, err
	}

	// Write the ledger row.
	var txn GiftCardTransaction
	err = tx.QueryRow(ctx, `
INSERT INTO gift_card_transactions (
    gift_card_id, txn_type, amount_cents, balance_after_cents,
    order_id, payment_id, performed_by_staff_id, notes
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, gift_card_id, txn_type, amount_cents, balance_after_cents,
          order_id, payment_id, performed_by_staff_id, notes, created_at`,
		cardID, txnType, ledgerAmount, newBalance,
		nullStr(p.OrderID), nullStr(p.PaymentID),
		nullStr(p.PerformedByStaffID), nullStr(p.Notes),
	).Scan(
		&txn.ID, &txn.GiftCardID, &txn.TxnType, &txn.AmountCents, &txn.BalanceAfterCents,
		&txn.OrderID, &txn.PaymentID, &txn.PerformedByStaffID, &txn.Notes, &txn.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &txn, nil
}

// Redeem deducts amount_cents from the card balance.
func (s *Store) Redeem(ctx context.Context, p TxnParams) (*GiftCardTransaction, error) {
	return s.redeemOrMutate(ctx, "redeem", p)
}

// Reload adds amount_cents to the card balance.
func (s *Store) Reload(ctx context.Context, p TxnParams) (*GiftCardTransaction, error) {
	return s.redeemOrMutate(ctx, "reload", p)
}

// Refund credits amount_cents back onto the card.
func (s *Store) Refund(ctx context.Context, p TxnParams) (*GiftCardTransaction, error) {
	return s.redeemOrMutate(ctx, "refund", p)
}

// LookupParams carries the code and optional PIN for card lookup.
type LookupParams struct {
	Code string
	PIN  string
}

// Lookup fetches a card by code, verifying the PIN when the card has one set.
func (s *Store) Lookup(ctx context.Context, p LookupParams) (*LookupResult, error) {
	var (
		id      string
		pinHash *string
		balance int64
		currency string
		status  string
		expires *time.Time
	)
	err := s.pool.QueryRow(ctx, `
SELECT id, pin_hash, current_balance_cents, currency, status, expires_at
FROM gift_cards
WHERE lower(code) = lower($1)`, p.Code).Scan(&id, &pinHash, &balance, &currency, &status, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCardNotFound
	}
	if err != nil {
		return nil, err
	}

	// PIN verification: required when pin_hash is set.
	if pinHash != nil {
		if p.PIN == "" {
			return nil, ErrInvalidPIN
		}
		if err := bcrypt.CompareHashAndPassword([]byte(*pinHash), []byte(p.PIN)); err != nil {
			return nil, ErrInvalidPIN
		}
	}

	return &LookupResult{
		ID:                  id,
		MaskedCode:          maskCode(p.Code),
		CurrentBalanceCents: balance,
		Currency:            currency,
		Status:              status,
		ExpiresAt:           expires,
	}, nil
}

// nullStr maps an empty string to a SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
