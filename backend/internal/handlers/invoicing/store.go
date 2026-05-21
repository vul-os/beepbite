// Package invoicing implements tax_profiles + invoices CRUD and PDF generation.
//
// Tables used (all pre-existing; no migration needed):
//
//	tax_profiles  — migration 010: org_id (PK), legal_name, registered_address,
//	                country, vat_number, vat_rate_percent, company_number,
//	                contact_email, contact_phone.
//	invoices      — migration 010: id, issuer, issuer_org_id, recipient_org_id,
//	                recipient_customer_id, recipient_snapshot (jsonb),
//	                invoice_number, currency, subtotal_cents, vat_cents,
//	                vat_rate_percent, vat_applied, total_cents, due_date,
//	                status, issued_at, paid_at, pdf_object_key,
//	                idempotency_key, metadata (jsonb), created_at, updated_at.
//
// There is no invoice_lines table.  Line items are stored inside
// metadata jsonb as metadata.lines ([]LineRecord).
//
// Column mapping from old invented schema → canonical:
//
//	org_id            → issuer_org_id  (set to current_org_id() on write)
//	recipient_name    → recipient_snapshot->>'name'
//	recipient_address → recipient_snapshot->>'address'
//	currency_code     → currency
//	vat_number_shown  → vat_applied (bool) + vat_rate_percent (numeric)
//	lines (table)     → metadata->'lines' (jsonb array)
//
// VAT rule: if the issuer (platform from env BEEPBITE_VAT_NUMBER, or tenant
// from tax_profiles.vat_number) has a non-empty vat_number → vat_applied=true,
// vat_rate_percent stored on the row. Otherwise vat_applied=false, vat_cents=0.
//
// RLS: tenant access is via issuer_org_id = current_org_id() (SELECT also
// allows recipient_org_id = current_org_id()).  All mutations use
// db.ScopeFromContext so RLS applies automatically.
//
// Status values (canonical): draft → sent → paid | void.
// The "issue" action transitions draft → sent (not "issued").
//
// Platform header env vars read at runtime (never stored in DB):
//
//	BEEPBITE_LEGAL_NAME
//	BEEPBITE_REGISTERED_ADDRESS
//	BEEPBITE_VAT_NUMBER
//	BEEPBITE_REGISTERED_COUNTRY
//	BEEPBITE_COMPANY_NUMBER
package invoicing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

var (
	// ErrNotFound is returned when the requested resource does not exist
	// (or is not visible under the current org scope).
	ErrNotFound = errors.New("not found")

	// ErrInvoiceNotDraft is returned when a mutation requires draft status.
	ErrInvoiceNotDraft = errors.New("invoice is not in draft status")

	// ErrInvoiceNotIssued is returned when marking paid requires sent status.
	ErrInvoiceNotIssued = errors.New("invoice is not in sent status")
)

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

// TaxProfile mirrors a tax_profiles row.
// VATRatePercent is the tenant's configured VAT rate (e.g. 15.0000 for 15%).
type TaxProfile struct {
	OrgID             string    `json:"org_id"`
	LegalName         string    `json:"legal_name"`
	RegisteredAddress string    `json:"registered_address"`
	Country           string    `json:"country"`
	VATNumber         *string   `json:"vat_number"`
	VATRatePercent    *float64  `json:"vat_rate_percent"`
	CompanyNumber     *string   `json:"company_number"`
	ContactEmail      *string   `json:"contact_email"`
	ContactPhone      *string   `json:"contact_phone"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// InvoiceLine is one line item stored in metadata->lines.
type InvoiceLine struct {
	Description    string `json:"description"`
	Qty            int    `json:"qty"`
	UnitCents      int64  `json:"unit_cents"`
	LineTotalCents int64  `json:"line_total_cents"`
}

// recipientSnapshot is the jsonb payload stored in invoices.recipient_snapshot.
type recipientSnapshot struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

// invoiceMetadata is the jsonb payload stored in invoices.metadata.
type invoiceMetadata struct {
	Lines []InvoiceLine `json:"lines,omitempty"`
}

// Invoice is the API-facing representation of an invoices row.
// Fields that the old schema exposed under different names are noted:
//
//	OrgID (was org_id)           → now IssuerOrgID
//	RecipientName                → decoded from RecipientSnapshot
//	RecipientAddress             → decoded from RecipientSnapshot
//	CurrencyCode (was currency_code) → now Currency
//	VATNumberShown removed       → replaced by VATApplied + VATRatePercent
//	Lines                        → decoded from Metadata.Lines
type Invoice struct {
	ID               string        `json:"id"`
	Issuer           string        `json:"issuer"`
	IssuerOrgID      *string       `json:"issuer_org_id"`
	RecipientName    string        `json:"recipient_name"`
	RecipientAddress string        `json:"recipient_address"`
	Currency         string        `json:"currency"`
	SubtotalCents    int64         `json:"subtotal_cents"`
	VATCents         int64         `json:"vat_cents"`
	VATRatePercent   *float64      `json:"vat_rate_percent"`
	VATApplied       bool          `json:"vat_applied"`
	TotalCents       int64         `json:"total_cents"`
	InvoiceNumber    string        `json:"invoice_number"`
	Status           string        `json:"status"`
	IssuedAt         *time.Time    `json:"issued_at"`
	CreatedAt        time.Time     `json:"created_at"`
	UpdatedAt        time.Time     `json:"updated_at"`
	Lines            []InvoiceLine `json:"lines,omitempty"`
}

// CreateInvoiceReq is the body for POST /invoicing/invoices.
type CreateInvoiceReq struct {
	Issuer           string    `json:"issuer"` // "platform" | "tenant"
	RecipientName    string    `json:"recipient_name"`
	RecipientAddress string    `json:"recipient_address"`
	Currency         string    `json:"currency"` // ISO-4217, e.g. "ZAR"
	Lines            []LineReq `json:"lines"`
	// VATRatePct is the VAT percentage to apply (e.g. 15 for 15%).
	// Applied only when the issuer has a vat_number set.
	VATRatePct float64 `json:"vat_rate_pct"`
}

// LineReq is one line item in a CreateInvoiceReq.
type LineReq struct {
	Description string `json:"description"`
	Qty         int    `json:"qty"`
	UnitCents   int64  `json:"unit_cents"`
}

// UpdateInvoiceReq is the body for PATCH /invoicing/invoices/{id}.
// Only draft invoices may be updated.
type UpdateInvoiceReq struct {
	RecipientName    *string   `json:"recipient_name"`
	RecipientAddress *string   `json:"recipient_address"`
	Currency         *string   `json:"currency"`
	Lines            []LineReq `json:"lines"` // replaces all existing lines when non-nil
	VATRatePct       *float64  `json:"vat_rate_pct"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store wraps a pgxpool and provides all DB access for the invoicing handler.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// tax_profiles
// ---------------------------------------------------------------------------

// GetTaxProfile returns the tax_profile for the current org, or ErrNotFound
// when no row exists yet.
func (s *Store) GetTaxProfile(ctx context.Context) (*TaxProfile, error) {
	var tp TaxProfile
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT org_id,
       legal_name,
       registered_address,
       country,
       vat_number,
       vat_rate_percent,
       company_number,
       contact_email,
       contact_phone,
       updated_at
  FROM tax_profiles
 WHERE org_id = current_org_id()
`).Scan(
			&tp.OrgID,
			&tp.LegalName,
			&tp.RegisteredAddress,
			&tp.Country,
			&tp.VATNumber,
			&tp.VATRatePercent,
			&tp.CompanyNumber,
			&tp.ContactEmail,
			&tp.ContactPhone,
			&tp.UpdatedAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &tp, nil
}

// UpsertTaxProfile inserts or updates the tax_profile for the current org.
// Returns the saved profile.
func (s *Store) UpsertTaxProfile(ctx context.Context, p TaxProfile) (*TaxProfile, error) {
	scope := db.ScopeFromContext(ctx)
	var out TaxProfile
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO tax_profiles
    (org_id, legal_name, registered_address, country,
     vat_number, vat_rate_percent, company_number,
     contact_email, contact_phone, updated_at)
VALUES
    (current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8, timezone('utc', now()))
ON CONFLICT (org_id) DO UPDATE SET
    legal_name         = EXCLUDED.legal_name,
    registered_address = EXCLUDED.registered_address,
    country            = EXCLUDED.country,
    vat_number         = EXCLUDED.vat_number,
    vat_rate_percent   = EXCLUDED.vat_rate_percent,
    company_number     = EXCLUDED.company_number,
    contact_email      = EXCLUDED.contact_email,
    contact_phone      = EXCLUDED.contact_phone,
    updated_at         = timezone('utc', now())
RETURNING org_id, legal_name, registered_address, country,
          vat_number, vat_rate_percent, company_number,
          contact_email, contact_phone, updated_at
`,
			p.LegalName,
			p.RegisteredAddress,
			p.Country,
			p.VATNumber,
			p.VATRatePercent,
			p.CompanyNumber,
			p.ContactEmail,
			p.ContactPhone,
		).Scan(
			&out.OrgID,
			&out.LegalName,
			&out.RegisteredAddress,
			&out.Country,
			&out.VATNumber,
			&out.VATRatePercent,
			&out.CompanyNumber,
			&out.ContactEmail,
			&out.ContactPhone,
			&out.UpdatedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// invoices — list / get / create / update / status transitions
// ---------------------------------------------------------------------------

// scanInvoice is a helper that decodes an invoices row into an Invoice DTO.
// Caller must have selected exactly these columns in this order:
//
//	id, issuer, issuer_org_id,
//	recipient_snapshot, currency,
//	subtotal_cents, vat_cents, vat_rate_percent, vat_applied, total_cents,
//	invoice_number, status, issued_at, created_at, updated_at,
//	metadata
func scanInvoice(row pgx.Row, inv *Invoice) error {
	var issuerOrgID *string
	var snapshotJSON []byte
	var metaJSON []byte
	var vatRatePercent *float64

	if err := row.Scan(
		&inv.ID,
		&inv.Issuer,
		&issuerOrgID,
		&snapshotJSON,
		&inv.Currency,
		&inv.SubtotalCents,
		&inv.VATCents,
		&vatRatePercent,
		&inv.VATApplied,
		&inv.TotalCents,
		&inv.InvoiceNumber,
		&inv.Status,
		&inv.IssuedAt,
		&inv.CreatedAt,
		&inv.UpdatedAt,
		&metaJSON,
	); err != nil {
		return err
	}

	inv.IssuerOrgID = issuerOrgID
	inv.VATRatePercent = vatRatePercent

	// Decode recipient_snapshot
	if len(snapshotJSON) > 0 {
		var snap recipientSnapshot
		if err := json.Unmarshal(snapshotJSON, &snap); err == nil {
			inv.RecipientName = snap.Name
			inv.RecipientAddress = snap.Address
		}
	}

	// Decode metadata.lines
	if len(metaJSON) > 0 {
		var meta invoiceMetadata
		if err := json.Unmarshal(metaJSON, &meta); err == nil {
			inv.Lines = meta.Lines
		}
	}
	if inv.Lines == nil {
		inv.Lines = []InvoiceLine{}
	}

	return nil
}

const invoiceSelectCols = `
	id, issuer, issuer_org_id,
	recipient_snapshot, currency,
	subtotal_cents, vat_cents, vat_rate_percent, vat_applied, total_cents,
	invoice_number, status, issued_at, created_at, updated_at,
	metadata`

// ListInvoices returns all invoices where the current org is issuer or
// recipient, newest first.  RLS on the table already enforces visibility;
// the WHERE clause is a belt-and-suspenders filter.
func (s *Store) ListInvoices(ctx context.Context) ([]Invoice, error) {
	var out []Invoice
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT`+invoiceSelectCols+`
  FROM invoices
 ORDER BY created_at DESC
`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var inv Invoice
			if err := scanInvoice(rows, &inv); err != nil {
				return err
			}
			out = append(out, inv)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []Invoice{}
	}
	return out, nil
}

// GetInvoice returns a single invoice with its lines.
// Returns ErrNotFound when the invoice does not exist or is not visible to
// the current org.
func (s *Store) GetInvoice(ctx context.Context, invoiceID string) (*Invoice, error) {
	var inv Invoice
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
SELECT`+invoiceSelectCols+`
  FROM invoices
 WHERE id = $1
`, invoiceID)
		return scanInvoice(row, &inv)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// CreateInvoice creates a new draft invoice with its lines stored in metadata.
// vatNumber is the issuer's VAT number (empty string means no VAT).
// vatRatePct is the rate to apply (e.g. 15.0 for 15%); ignored when vatNumber is empty.
func (s *Store) CreateInvoice(ctx context.Context, req CreateInvoiceReq, vatNumber string, vatRatePct float64) (*Invoice, error) {
	// Compute subtotal, vat, total
	var subtotal int64
	lines := make([]InvoiceLine, 0, len(req.Lines))
	for _, l := range req.Lines {
		lt := int64(l.Qty) * l.UnitCents
		subtotal += lt
		lines = append(lines, InvoiceLine{
			Description:    l.Description,
			Qty:            l.Qty,
			UnitCents:      l.UnitCents,
			LineTotalCents: lt,
		})
	}

	vatApplied := vatNumber != ""
	var vatCents int64
	var vatRate *float64
	if vatApplied {
		vatCents = int64(float64(subtotal) * vatRatePct / 100.0)
		r := vatRatePct
		vatRate = &r
	}
	total := subtotal + vatCents

	if req.Currency == "" {
		req.Currency = "ZAR"
	}

	snapJSON, err := json.Marshal(recipientSnapshot{
		Name:    req.RecipientName,
		Address: req.RecipientAddress,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal recipient_snapshot: %w", err)
	}

	metaJSON, err := json.Marshal(invoiceMetadata{Lines: lines})
	if err != nil {
		return nil, fmt.Errorf("marshal metadata: %w", err)
	}

	invoiceNum := generateInvoiceNumber()

	var inv Invoice
	err = db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
INSERT INTO invoices
    (issuer, issuer_org_id,
     recipient_snapshot, currency,
     subtotal_cents, vat_cents, vat_rate_percent, vat_applied, total_cents,
     invoice_number, status, metadata)
VALUES
    ($1, current_org_id(),
     $2, $3,
     $4, $5, $6, $7, $8,
     $9, 'draft', $10)
RETURNING`+invoiceSelectCols,
			req.Issuer,
			snapJSON, req.Currency,
			subtotal, vatCents, vatRate, vatApplied, total,
			invoiceNum,
			metaJSON,
		)
		return scanInvoice(row, &inv)
	})
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// UpdateInvoice updates a draft invoice. Returns ErrNotFound or ErrInvoiceNotDraft.
// vatNumber is the current issuer's VAT number (used to recompute VAT if lines change).
func (s *Store) UpdateInvoice(ctx context.Context, invoiceID string, req UpdateInvoiceReq, vatNumber string) (*Invoice, error) {
	var inv Invoice
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Fetch current status and snapshot so we can merge partial updates.
		var status string
		var snapshotJSON []byte
		var metaJSON []byte
		if err := tx.QueryRow(ctx, `
SELECT status, recipient_snapshot, metadata
  FROM invoices
 WHERE id = $1
`, invoiceID).Scan(&status, &snapshotJSON, &metaJSON); err != nil {
			return err
		}
		if status != "draft" {
			return ErrInvoiceNotDraft
		}

		// Decode current snapshot so we can apply partial recipient fields.
		var snap recipientSnapshot
		if len(snapshotJSON) > 0 {
			_ = json.Unmarshal(snapshotJSON, &snap)
		}
		if req.RecipientName != nil {
			snap.Name = *req.RecipientName
		}
		if req.RecipientAddress != nil {
			snap.Address = *req.RecipientAddress
		}
		newSnapJSON, err := json.Marshal(snap)
		if err != nil {
			return fmt.Errorf("marshal recipient_snapshot: %w", err)
		}

		// Decode current lines so we can replace them when req.Lines is set.
		var currentMeta invoiceMetadata
		if len(metaJSON) > 0 {
			_ = json.Unmarshal(metaJSON, &currentMeta)
		}

		var subtotal int64
		var vatCents int64
		var vatRate *float64
		vatApplied := vatNumber != ""

		if req.Lines != nil {
			// Replace lines and recompute totals.
			newLines := make([]InvoiceLine, 0, len(req.Lines))
			for _, l := range req.Lines {
				lt := int64(l.Qty) * l.UnitCents
				subtotal += lt
				newLines = append(newLines, InvoiceLine{
					Description:    l.Description,
					Qty:            l.Qty,
					UnitCents:      l.UnitCents,
					LineTotalCents: lt,
				})
			}
			currentMeta.Lines = newLines

			if vatApplied {
				ratePct := 0.0
				if req.VATRatePct != nil {
					ratePct = *req.VATRatePct
				}
				vatCents = int64(float64(subtotal) * ratePct / 100.0)
				r := ratePct
				vatRate = &r
			}
		} else {
			// Recompute totals from existing lines.
			for _, l := range currentMeta.Lines {
				subtotal += l.LineTotalCents
			}
			if vatApplied && req.VATRatePct != nil {
				vatCents = int64(float64(subtotal) * *req.VATRatePct / 100.0)
				r := *req.VATRatePct
				vatRate = &r
			}
		}
		total := subtotal + vatCents

		newMetaJSON, err := json.Marshal(currentMeta)
		if err != nil {
			return fmt.Errorf("marshal metadata: %w", err)
		}

		// Currency: use provided or keep current.
		// $1..$8 are already bound (id, snapshot, subtotal, vatCents, vatRate,
		// vatApplied, total, metadata), so currency is $9 when present.
		currencyExpr := "currency"
		var currencyArg any
		if req.Currency != nil {
			currencyExpr = "$9"
			currencyArg = *req.Currency
		}

		// Build the UPDATE. We always update snapshot, metadata, totals.
		query := `
UPDATE invoices SET
    recipient_snapshot = $2,
    subtotal_cents     = $3,
    vat_cents          = $4,
    vat_rate_percent   = $5,
    vat_applied        = $6,
    total_cents        = $7,
    metadata           = $8,
    currency           = ` + currencyExpr + `
 WHERE id = $1
`
		args := []any{
			invoiceID,
			newSnapJSON,
			subtotal,
			vatCents,
			vatRate,
			vatApplied,
			total,
			newMetaJSON,
		}
		if req.Currency != nil {
			args = append(args, currencyArg)
		}
		if _, err := tx.Exec(ctx, query, args...); err != nil {
			return err
		}

		// Return updated record.
		row := tx.QueryRow(ctx, `
SELECT`+invoiceSelectCols+`
  FROM invoices
 WHERE id = $1
`, invoiceID)
		return scanInvoice(row, &inv)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// IssueInvoice transitions a draft invoice to sent (canonical status for "issued").
func (s *Store) IssueInvoice(ctx context.Context, invoiceID string) (*Invoice, error) {
	return s.transitionStatus(ctx, invoiceID, "draft", "sent")
}

// MarkPaid transitions a sent invoice to paid.
func (s *Store) MarkPaid(ctx context.Context, invoiceID string) (*Invoice, error) {
	return s.transitionStatus(ctx, invoiceID, "sent", "paid")
}

// VoidInvoice transitions a draft or sent invoice to void.
func (s *Store) VoidInvoice(ctx context.Context, invoiceID string) (*Invoice, error) {
	var inv Invoice
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(ctx,
			`SELECT status FROM invoices WHERE id = $1`,
			invoiceID,
		).Scan(&status); err != nil {
			return err
		}
		if status == "void" || status == "paid" {
			return ErrInvoiceNotDraft
		}
		row := tx.QueryRow(ctx, `
UPDATE invoices SET status = 'void'
 WHERE id = $1
RETURNING`+invoiceSelectCols,
			invoiceID)
		return scanInvoice(row, &inv)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// DeleteInvoice deletes a draft invoice (returns ErrInvoiceNotDraft for others).
func (s *Store) DeleteInvoice(ctx context.Context, invoiceID string) error {
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(ctx,
			`SELECT status FROM invoices WHERE id = $1`,
			invoiceID,
		).Scan(&status); err != nil {
			return err
		}
		if status != "draft" {
			return ErrInvoiceNotDraft
		}
		_, err := tx.Exec(ctx,
			`DELETE FROM invoices WHERE id = $1`,
			invoiceID,
		)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// transitionStatus is a helper for simple one-from → one-to status transitions.
func (s *Store) transitionStatus(ctx context.Context, invoiceID, fromStatus, toStatus string) (*Invoice, error) {
	var inv Invoice
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var status string
		if err := tx.QueryRow(ctx,
			`SELECT status FROM invoices WHERE id = $1`,
			invoiceID,
		).Scan(&status); err != nil {
			return err
		}
		if status != fromStatus {
			if fromStatus == "draft" {
				return ErrInvoiceNotDraft
			}
			return ErrInvoiceNotIssued
		}

		extra := ""
		if toStatus == "sent" {
			extra = ", issued_at = timezone('utc', now())"
		} else if toStatus == "paid" {
			extra = ", paid_at = timezone('utc', now())"
		}
		row := tx.QueryRow(ctx, `
UPDATE invoices SET status = $1`+extra+`
 WHERE id = $2
RETURNING`+invoiceSelectCols,
			toStatus, invoiceID)
		return scanInvoice(row, &inv)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// generateInvoiceNumber produces a unique-enough invoice number for draft
// creation.  Format: INV-YYYYMMDD-XXXXXXXX (8 random hex chars).
// The invoices table has a UNIQUE constraint on invoice_number, so if there
// is a collision the INSERT will fail and the caller can retry.
func generateInvoiceNumber() string {
	const hex = "0123456789abcdef"
	b := make([]byte, 8)
	for i := range b {
		b[i] = hex[rand.Intn(16)] //nolint:gosec // non-cryptographic unique label
	}
	return fmt.Sprintf("INV-%s-%s", time.Now().UTC().Format("20060102"), string(b))
}
