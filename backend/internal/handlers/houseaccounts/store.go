package houseaccounts

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors mapped to HTTP status codes in the handler layer.
var (
	ErrAccountNotFound     = errors.New("house account not found")
	ErrAccountClosed       = errors.New("house account is closed")
	ErrCreditLimitExceeded = errors.New("charge would exceed credit limit")
	ErrMemberAlreadyExists = errors.New("customer is already a member of this account")
	ErrMemberNotFound      = errors.New("member not found")
	ErrChargeNotFound      = errors.New("charge not found")
	ErrInvoiceNotFound     = errors.New("invoice not found")
	ErrNoOpenCharges       = errors.New("no open charges to invoice")
)

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

// HouseAccount mirrors the house_accounts row.
type HouseAccount struct {
	ID                  string    `json:"id"`
	OrganizationID      string    `json:"organization_id"`
	AccountName         string    `json:"account_name"`
	ContactName         *string   `json:"contact_name"`
	ContactEmail        *string   `json:"contact_email"`
	ContactPhone        *string   `json:"contact_phone"`
	BillingAddress      *string   `json:"billing_address"`
	CreditLimitCents    *int64    `json:"credit_limit_cents"`
	CurrentBalanceCents int64     `json:"current_balance_cents"`
	Currency            string    `json:"currency"`
	BillingCycle        string    `json:"billing_cycle"`
	NetTermsDays        *int      `json:"net_terms_days"`
	IsActive            bool      `json:"is_active"`
	Notes               *string   `json:"notes"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// HouseAccountDetail is returned by GET /house-accounts/{id}: account +
// members + live outstanding balance.
type HouseAccountDetail struct {
	HouseAccount
	Members            []Member `json:"members"`
	OutstandingBalance int64    `json:"outstanding_balance_cents"`
}

// Member mirrors a house_account_members row.
type Member struct {
	ID                 string    `json:"id"`
	HouseAccountID     string    `json:"house_account_id"`
	CustomerID         string    `json:"customer_id"`
	SpendingLimitCents *int64    `json:"spending_limit_cents"`
	IsActive           bool      `json:"is_active"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// Charge mirrors a house_account_charges row.
type Charge struct {
	ID                    string    `json:"id"`
	HouseAccountID        string    `json:"house_account_id"`
	OrderID               string    `json:"order_id"`
	CustomerID            *string   `json:"customer_id"`
	AmountCents           int64     `json:"amount_cents"`
	HouseAccountInvoiceID *string   `json:"house_account_invoice_id"`
	CreatedAt             time.Time `json:"created_at"`
}

// Invoice mirrors a house_account_invoices row.
type Invoice struct {
	ID              string     `json:"id"`
	HouseAccountID  string     `json:"house_account_id"`
	InvoiceNumber   string     `json:"invoice_number"`
	PeriodStart     time.Time  `json:"period_start"`
	PeriodEnd       time.Time  `json:"period_end"`
	SubtotalCents   int64      `json:"subtotal_cents"`
	TaxCents        int64      `json:"tax_cents"`
	TotalCents      int64      `json:"total_cents"`
	Status          string     `json:"status"`
	DueDate         *time.Time `json:"due_date"`
	SentAt          *time.Time `json:"sent_at"`
	PaidAt          *time.Time `json:"paid_at"`
	PaidAmountCents int64      `json:"paid_amount_cents"`
	PDFUrl          *string    `json:"pdf_url"`
	Notes           *string    `json:"notes"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// CreateAccount
// ---------------------------------------------------------------------------

func (s *Store) CreateAccount(
	ctx context.Context,
	orgID, name string,
	contactName, contactEmail, contactPhone, billingAddress *string,
	creditLimitCents *int64,
	netTermsDays *int,
	notes *string,
) (*HouseAccount, error) {
	var a HouseAccount
	err := s.pool.QueryRow(ctx, `
INSERT INTO house_accounts (
    organization_id, account_name,
    contact_name, contact_email, contact_phone, billing_address,
    credit_limit_cents, net_terms_days, notes,
    currency
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
    -- The organization's own currency. This column used to inherit a
    -- DEFAULT 'ZAR' from the schema (dropped in migration 056), so a house
    -- account opened by a Tokyo operator was denominated in rand while its
    -- balance accumulated yen. Resolving it from the org is the only reading
    -- that is right for every operator.
    (SELECT default_currency_code FROM organizations WHERE id = $1)
)
RETURNING
    id, organization_id, account_name,
    contact_name, contact_email, contact_phone, billing_address,
    credit_limit_cents, current_balance_cents, currency,
    billing_cycle, net_terms_days, is_active, notes, created_at, updated_at
`,
		orgID, name,
		contactName, contactEmail, contactPhone, billingAddress,
		creditLimitCents, netTermsDays, notes,
	).Scan(
		&a.ID, &a.OrganizationID, &a.AccountName,
		&a.ContactName, &a.ContactEmail, &a.ContactPhone, &a.BillingAddress,
		&a.CreditLimitCents, &a.CurrentBalanceCents, &a.Currency,
		&a.BillingCycle, &a.NetTermsDays, &a.IsActive, &a.Notes, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// ---------------------------------------------------------------------------
// GetAccountDetail
// ---------------------------------------------------------------------------

func (s *Store) GetAccountDetail(ctx context.Context, id string) (*HouseAccountDetail, error) {
	var a HouseAccount
	err := s.pool.QueryRow(ctx, `
SELECT
    id, organization_id, account_name,
    contact_name, contact_email, contact_phone, billing_address,
    credit_limit_cents, current_balance_cents, currency,
    billing_cycle, net_terms_days, is_active, notes, created_at, updated_at
FROM house_accounts
WHERE id = $1
`, id).Scan(
		&a.ID, &a.OrganizationID, &a.AccountName,
		&a.ContactName, &a.ContactEmail, &a.ContactPhone, &a.BillingAddress,
		&a.CreditLimitCents, &a.CurrentBalanceCents, &a.Currency,
		&a.BillingCycle, &a.NetTermsDays, &a.IsActive, &a.Notes, &a.CreatedAt, &a.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAccountNotFound
	}
	if err != nil {
		return nil, err
	}

	members, err := s.listMembers(ctx, id)
	if err != nil {
		return nil, err
	}

	var outstanding int64
	if err := s.pool.QueryRow(ctx, `
SELECT COALESCE(SUM(amount_cents), 0)
FROM house_account_charges
WHERE house_account_id = $1
  AND house_account_invoice_id IS NULL
`, id).Scan(&outstanding); err != nil {
		return nil, err
	}

	return &HouseAccountDetail{
		HouseAccount:       a,
		Members:            members,
		OutstandingBalance: outstanding,
	}, nil
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

func (s *Store) listMembers(ctx context.Context, accountID string) ([]Member, error) {
	rows, err := s.pool.Query(ctx, `
SELECT id, house_account_id, customer_id, spending_limit_cents, is_active, created_at, updated_at
FROM house_account_members
WHERE house_account_id = $1
ORDER BY created_at
`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Member{}
	for rows.Next() {
		var m Member
		if err := rows.Scan(&m.ID, &m.HouseAccountID, &m.CustomerID, &m.SpendingLimitCents, &m.IsActive, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) AddMember(ctx context.Context, accountID, customerID string, spendingLimitCents *int64) (*Member, error) {
	// Verify account exists and is active.
	if err := s.checkAccountActive(ctx, accountID); err != nil {
		return nil, err
	}

	var m Member
	err := s.pool.QueryRow(ctx, `
INSERT INTO house_account_members (house_account_id, customer_id, spending_limit_cents)
VALUES ($1, $2, $3)
RETURNING id, house_account_id, customer_id, spending_limit_cents, is_active, created_at, updated_at
`, accountID, customerID, spendingLimitCents).Scan(
		&m.ID, &m.HouseAccountID, &m.CustomerID, &m.SpendingLimitCents, &m.IsActive, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			return nil, ErrMemberAlreadyExists
		}
		return nil, err
	}
	return &m, nil
}

func (s *Store) RemoveMember(ctx context.Context, accountID, customerID string) error {
	tag, err := s.pool.Exec(ctx, `
DELETE FROM house_account_members
WHERE house_account_id = $1 AND customer_id = $2
`, accountID, customerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrMemberNotFound
	}
	return nil
}

// ---------------------------------------------------------------------------
// Charge
// ---------------------------------------------------------------------------

// CreateCharge records a charge against the account inside a transaction.
// It re-fetches the live outstanding balance and enforces the credit limit
// before inserting.
func (s *Store) CreateCharge(
	ctx context.Context,
	accountID, orderID string,
	customerID *string,
	amountCents int64,
) (*Charge, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Lock the account row so no concurrent charge slips through the limit check.
	var isActive bool
	var creditLimit *int64
	err = tx.QueryRow(ctx, `
SELECT is_active, credit_limit_cents
FROM house_accounts
WHERE id = $1
FOR UPDATE
`, accountID).Scan(&isActive, &creditLimit)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAccountNotFound
	}
	if err != nil {
		return nil, err
	}
	if !isActive {
		return nil, ErrAccountClosed
	}

	// Re-compute live outstanding balance inside the tx.
	var outstanding int64
	if err := tx.QueryRow(ctx, `
SELECT COALESCE(SUM(amount_cents), 0)
FROM house_account_charges
WHERE house_account_id = $1
  AND house_account_invoice_id IS NULL
`, accountID).Scan(&outstanding); err != nil {
		return nil, err
	}

	if creditLimit != nil && outstanding+amountCents > *creditLimit {
		return nil, ErrCreditLimitExceeded
	}

	var c Charge
	err = tx.QueryRow(ctx, `
INSERT INTO house_account_charges (house_account_id, order_id, customer_id, amount_cents)
VALUES ($1, $2, $3, $4)
RETURNING id, house_account_id, order_id, customer_id, amount_cents, house_account_invoice_id, created_at
`, accountID, orderID, customerID, amountCents).Scan(
		&c.ID, &c.HouseAccountID, &c.OrderID, &c.CustomerID,
		&c.AmountCents, &c.HouseAccountInvoiceID, &c.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Keep current_balance_cents in sync on the account row.
	if _, err := tx.Exec(ctx, `
UPDATE house_accounts
SET current_balance_cents = current_balance_cents + $2,
    updated_at            = now()
WHERE id = $1
`, accountID, amountCents); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &c, nil
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

func (s *Store) ListInvoices(ctx context.Context, accountID string) ([]Invoice, error) {
	rows, err := s.pool.Query(ctx, `
SELECT
    id, house_account_id, invoice_number,
    period_start, period_end,
    subtotal_cents, tax_cents, total_cents,
    status, due_date, sent_at, paid_at, paid_amount_cents,
    pdf_url, notes, created_at, updated_at
FROM house_account_invoices
WHERE house_account_id = $1
ORDER BY created_at DESC
`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Invoice{}
	for rows.Next() {
		var inv Invoice
		if err := scanInvoice(rows, &inv); err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, rows.Err()
}

// GetInvoice fetches a single invoice by its ID.
func (s *Store) GetInvoice(ctx context.Context, invoiceID string) (*Invoice, error) {
	var inv Invoice
	err := s.pool.QueryRow(ctx, `
SELECT
    id, house_account_id, invoice_number,
    period_start, period_end,
    subtotal_cents, tax_cents, total_cents,
    status, due_date, sent_at, paid_at, paid_amount_cents,
    pdf_url, notes, created_at, updated_at
FROM house_account_invoices
WHERE id = $1
`, invoiceID).Scan(
		&inv.ID, &inv.HouseAccountID, &inv.InvoiceNumber,
		&inv.PeriodStart, &inv.PeriodEnd,
		&inv.SubtotalCents, &inv.TaxCents, &inv.TotalCents,
		&inv.Status, &inv.DueDate, &inv.SentAt, &inv.PaidAt, &inv.PaidAmountCents,
		&inv.PDFUrl, &inv.Notes, &inv.CreatedAt, &inv.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvoiceNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// PayInvoice records a payment against an invoice and adjusts
// current_balance_cents on the account row. All mutations run in one tx.
func (s *Store) PayInvoice(ctx context.Context, invoiceID string, paymentCents int64) (*Invoice, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var inv Invoice
	err = tx.QueryRow(ctx, `
SELECT
    id, house_account_id, invoice_number,
    period_start, period_end,
    subtotal_cents, tax_cents, total_cents,
    status, due_date, sent_at, paid_at, paid_amount_cents,
    pdf_url, notes, created_at, updated_at
FROM house_account_invoices
WHERE id = $1
FOR UPDATE
`, invoiceID).Scan(
		&inv.ID, &inv.HouseAccountID, &inv.InvoiceNumber,
		&inv.PeriodStart, &inv.PeriodEnd,
		&inv.SubtotalCents, &inv.TaxCents, &inv.TotalCents,
		&inv.Status, &inv.DueDate, &inv.SentAt, &inv.PaidAt, &inv.PaidAmountCents,
		&inv.PDFUrl, &inv.Notes, &inv.CreatedAt, &inv.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvoiceNotFound
	}
	if err != nil {
		return nil, err
	}

	newPaid := inv.PaidAmountCents + paymentCents

	// Determine new status.
	newStatus := "partial"
	var paidAt *time.Time
	if newPaid >= inv.TotalCents {
		newStatus = "paid"
		now := time.Now().UTC()
		paidAt = &now
	}

	var updated Invoice
	err = tx.QueryRow(ctx, `
UPDATE house_account_invoices
SET paid_amount_cents = $2,
    status            = $3,
    paid_at           = COALESCE($4, paid_at),
    updated_at        = now()
WHERE id = $1
RETURNING
    id, house_account_id, invoice_number,
    period_start, period_end,
    subtotal_cents, tax_cents, total_cents,
    status, due_date, sent_at, paid_at, paid_amount_cents,
    pdf_url, notes, created_at, updated_at
`, invoiceID, newPaid, newStatus, paidAt).Scan(
		&updated.ID, &updated.HouseAccountID, &updated.InvoiceNumber,
		&updated.PeriodStart, &updated.PeriodEnd,
		&updated.SubtotalCents, &updated.TaxCents, &updated.TotalCents,
		&updated.Status, &updated.DueDate, &updated.SentAt, &updated.PaidAt, &updated.PaidAmountCents,
		&updated.PDFUrl, &updated.Notes, &updated.CreatedAt, &updated.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Reduce the account's current balance by the payment amount.
	if _, err := tx.Exec(ctx, `
UPDATE house_accounts
SET current_balance_cents = GREATEST(0, current_balance_cents - $2),
    updated_at            = now()
WHERE id = $1
`, inv.HouseAccountID, paymentCents); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &updated, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// checkAccountActive returns ErrAccountNotFound or ErrAccountClosed as needed.
func (s *Store) checkAccountActive(ctx context.Context, accountID string) error {
	var isActive bool
	err := s.pool.QueryRow(ctx,
		`SELECT is_active FROM house_accounts WHERE id = $1`, accountID,
	).Scan(&isActive)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrAccountNotFound
	}
	if err != nil {
		return err
	}
	if !isActive {
		return ErrAccountClosed
	}
	return nil
}

// scanInvoice scans a pgx.Row or pgx.Rows into an Invoice struct.
func scanInvoice(row pgx.Row, inv *Invoice) error {
	return row.Scan(
		&inv.ID, &inv.HouseAccountID, &inv.InvoiceNumber,
		&inv.PeriodStart, &inv.PeriodEnd,
		&inv.SubtotalCents, &inv.TaxCents, &inv.TotalCents,
		&inv.Status, &inv.DueDate, &inv.SentAt, &inv.PaidAt, &inv.PaidAmountCents,
		&inv.PDFUrl, &inv.Notes, &inv.CreatedAt, &inv.UpdatedAt,
	)
}
