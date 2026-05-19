package bankaccounts

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("bank account not found")

// BankAccount is the safe, wire-serialisable view of a bank_accounts row.
// The encrypted account number is NEVER included; only the last-4 for display.
type BankAccount struct {
	ID                  string     `json:"id"`
	OrganizationID      string     `json:"organization_id"`
	LocationID          *string    `json:"location_id"`
	RegionID            string     `json:"region_id"`
	AccountHolderName   string     `json:"account_holder_name"`
	BankName            string     `json:"bank_name"`
	BankCode            *string    `json:"bank_code"`
	AccountNumberLast4  string     `json:"account_number_last4"`
	AccountType         *string    `json:"account_type"`
	Currency            string     `json:"currency"`
	Provider            *string    `json:"provider"`
	ProviderRecipientID *string    `json:"provider_recipient_id"`
	VerifiedAt          *time.Time `json:"verified_at"`
	IsDefault           bool       `json:"is_default"`
	IsActive            bool       `json:"is_active"`
	Notes               *string    `json:"notes"`
	CreatedBy           *string    `json:"created_by"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

const bankAccountCols = `id, organization_id, location_id, region_id,
	account_holder_name, bank_name, bank_code, account_number_last4,
	account_type, currency, provider, provider_recipient_id,
	verified_at, is_default, is_active, notes, created_by, created_at, updated_at`

func scanBankAccount(row pgx.Row, a *BankAccount) error {
	return row.Scan(
		&a.ID, &a.OrganizationID, &a.LocationID, &a.RegionID,
		&a.AccountHolderName, &a.BankName, &a.BankCode, &a.AccountNumberLast4,
		&a.AccountType, &a.Currency, &a.Provider, &a.ProviderRecipientID,
		&a.VerifiedAt, &a.IsDefault, &a.IsActive, &a.Notes, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt,
	)
}

// insertParams carries all data needed to persist a new bank account.
type insertParams struct {
	OrgID                    string
	LocationID               *string
	RegionID                 string
	AccountHolderName        string
	BankName                 string
	BankCode                 *string
	EncryptedAccountNumber   string
	AccountNumberLast4       string
	Currency                 string
	Provider                 string
	ProviderRecipientID      string
	CreatedBy                *string
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// resolveRegionID looks up the region_id for a given location. When
// location_id is nil it falls back to the org's first active location.
func (s *Store) resolveRegionID(ctx context.Context, orgID string, locationID *string) (string, error) {
	if locationID != nil && *locationID != "" {
		var regionID string
		err := s.pool.QueryRow(ctx,
			`SELECT region_id FROM locations WHERE id = $1`, *locationID,
		).Scan(&regionID)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errors.New("location not found")
		}
		return regionID, err
	}
	// Org-level: use the first active location's region.
	var regionID string
	err := s.pool.QueryRow(ctx, `
SELECT l.region_id
FROM locations l
WHERE l.organization_id = $1 AND l.is_active = true
ORDER BY l.created_at
LIMIT 1
`, orgID).Scan(&regionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errors.New("no active location found for org to resolve region")
	}
	return regionID, err
}

// resolveClientRegionForOrg returns the Paystack region code (e.g. "ZA") for
// a given location or org by joining through the locations/regions tables.
func (s *Store) resolveRegionCode(ctx context.Context, orgID string, locationID *string) (string, error) {
	if locationID != nil && *locationID != "" {
		var code string
		err := s.pool.QueryRow(ctx, `
SELECT r.code FROM locations l JOIN regions r ON r.id = l.region_id WHERE l.id = $1
`, *locationID).Scan(&code)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errors.New("location not found")
		}
		return code, err
	}
	var code string
	err := s.pool.QueryRow(ctx, `
SELECT r.code
FROM locations l
JOIN regions r ON r.id = l.region_id
WHERE l.organization_id = $1 AND l.is_active = true
ORDER BY l.created_at
LIMIT 1
`, orgID).Scan(&code)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errors.New("no active location found for org to resolve region code")
	}
	return code, err
}

// Insert persists a new bank account and writes an audit log row in the same
// transaction.
func (s *Store) Insert(ctx context.Context, p insertParams, actorID *string) (*BankAccount, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var out BankAccount
	err = scanBankAccount(tx.QueryRow(ctx, `
INSERT INTO bank_accounts (
	organization_id, location_id, region_id,
	account_holder_name, bank_name, bank_code,
	account_number_ciphertext, account_number_last4,
	currency, provider, provider_recipient_id, created_by
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING `+bankAccountCols,
		p.OrgID, nullStr(p.LocationID), p.RegionID,
		p.AccountHolderName, p.BankName, p.BankCode,
		p.EncryptedAccountNumber, p.AccountNumberLast4,
		p.Currency, p.Provider, p.ProviderRecipientID, actorID,
	), &out)
	if err != nil {
		return nil, err
	}

	// Audit log.
	_, err = tx.Exec(ctx, `
INSERT INTO audit_log (organization_id, location_id, actor_type, actor_id,
	action, entity_type, entity_id)
VALUES ($1,$2,'member',$3,'bank_account.create','bank_accounts',$4)
`, p.OrgID, nullStr(p.LocationID), actorID, out.ID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

// List returns active bank accounts for an org, optionally filtered by location.
// When locationID is empty the filter is omitted (returns all for the org).
func (s *Store) List(ctx context.Context, orgID, locationID string) ([]BankAccount, error) {
	var (
		rows pgx.Rows
		err  error
	)
	if locationID != "" {
		rows, err = s.pool.Query(ctx, `
SELECT `+bankAccountCols+`
FROM bank_accounts
WHERE organization_id = $1 AND location_id = $2 AND is_active = true
ORDER BY created_at DESC
`, orgID, locationID)
	} else {
		rows, err = s.pool.Query(ctx, `
SELECT `+bankAccountCols+`
FROM bank_accounts
WHERE organization_id = $1 AND is_active = true
ORDER BY created_at DESC
`, orgID)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []BankAccount{}
	for rows.Next() {
		var a BankAccount
		if err := scanBankAccount(rows, &a); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// GetByID returns a single bank account by UUID.
func (s *Store) GetByID(ctx context.Context, id string) (*BankAccount, error) {
	var out BankAccount
	err := scanBankAccount(s.pool.QueryRow(ctx, `
SELECT `+bankAccountCols+`
FROM bank_accounts
WHERE id = $1
`, id), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// SoftDelete sets is_active=false and writes an audit row.
// It also returns the provider_recipient_id so the caller can optionally
// call Paystack to deactivate the recipient.
func (s *Store) SoftDelete(ctx context.Context, id string, actorID *string) (providerRecipientID string, err error) {
	tx, txErr := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if txErr != nil {
		return "", txErr
	}
	defer tx.Rollback(ctx)

	var orgID string
	var locationID *string
	var recipientID *string
	txErr = tx.QueryRow(ctx, `
UPDATE bank_accounts
SET is_active = false, updated_at = now()
WHERE id = $1 AND is_active = true
RETURNING organization_id, location_id, provider_recipient_id
`, id).Scan(&orgID, &locationID, &recipientID)
	if errors.Is(txErr, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if txErr != nil {
		return "", txErr
	}

	_, txErr = tx.Exec(ctx, `
INSERT INTO audit_log (organization_id, location_id, actor_type, actor_id,
	action, entity_type, entity_id)
VALUES ($1,$2,'member',$3,'bank_account.delete','bank_accounts',$4)
`, orgID, locationID, actorID, id)
	if txErr != nil {
		return "", txErr
	}

	if txErr = tx.Commit(ctx); txErr != nil {
		return "", txErr
	}

	if recipientID != nil {
		return *recipientID, nil
	}
	return "", nil
}

// UpdateNotes sets the notes field on a bank account and writes an audit row
// in the same transaction. Only the notes field is exposed for update in the
// dedicated handler; other field mutations flow through the generic data layer
// which has its own audit hook (see data/audit.go).
func (s *Store) UpdateNotes(ctx context.Context, id string, notes string, actorID *string) (*BankAccount, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var out BankAccount
	err = scanBankAccount(tx.QueryRow(ctx, `
UPDATE bank_accounts
SET notes = $2, updated_at = now()
WHERE id = $1 AND is_active = true
RETURNING `+bankAccountCols, id, notes), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec(ctx, `
INSERT INTO audit_log (organization_id, location_id, actor_type, actor_id,
    action, entity_type, entity_id, after_state)
VALUES ($1, $2, 'member', $3, 'bank_account.updated', 'bank_account', $4,
    jsonb_build_object('notes', $5::text))
`, out.OrganizationID, nullStr(out.LocationID), actorID, id, notes)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

// nullStr converts a *string (or nil LocationID) to a value that pgx will
// insert as SQL NULL when the pointer is nil or the string is empty.
func nullStr(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}
