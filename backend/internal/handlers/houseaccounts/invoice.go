package houseaccounts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GenerateInvoice aggregates all open (uninvoiced) house_account_charges for
// the given account into a new house_account_invoices row, then marks those
// charges as invoiced by setting house_account_invoice_id. Everything runs in
// a single serialisable transaction.
//
// invoice_number is derived from the account ID prefix + UTC timestamp so it
// is unique without requiring a separate sequence. Callers that need a custom
// numbering scheme can replace this function's output in a follow-up UPDATE.
//
// Tax is currently zero; extend this function when tax logic is introduced.
func GenerateInvoice(ctx context.Context, pool *pgxpool.Pool, accountID string) (*Invoice, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Verify account exists and is active.
	var isActive bool
	var netTermsDays *int
	err = tx.QueryRow(ctx, `
SELECT is_active, net_terms_days
FROM house_accounts
WHERE id = $1
FOR UPDATE
`, accountID).Scan(&isActive, &netTermsDays)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAccountNotFound
	}
	if err != nil {
		return nil, err
	}
	if !isActive {
		return nil, ErrAccountClosed
	}

	// Collect all open (uninvoiced) charge IDs + amounts.
	rows, err := tx.Query(ctx, `
SELECT id, amount_cents, created_at
FROM house_account_charges
WHERE house_account_id         = $1
  AND house_account_invoice_id IS NULL
ORDER BY created_at
FOR UPDATE
`, accountID)
	if err != nil {
		return nil, err
	}

	type chargeRow struct {
		id          string
		amountCents int64
		createdAt   time.Time
	}
	var charges []chargeRow
	for rows.Next() {
		var cr chargeRow
		if err := rows.Scan(&cr.id, &cr.amountCents, &cr.createdAt); err != nil {
			rows.Close()
			return nil, err
		}
		charges = append(charges, cr)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(charges) == 0 {
		return nil, ErrNoOpenCharges
	}

	// Determine period bounds from the charge timestamps.
	periodStart := charges[0].createdAt
	periodEnd := charges[len(charges)-1].createdAt

	var total int64
	for _, c := range charges {
		total += c.amountCents
	}
	// Tax = 0 for now; subtotal == total.
	subtotal := total
	taxCents := int64(0)

	// Compute due date based on net_terms_days.
	now := time.Now().UTC()
	var dueDate *time.Time
	if netTermsDays != nil {
		d := now.AddDate(0, 0, *netTermsDays)
		dueDate = &d
	}

	// Build a deterministic invoice number: short account ID + timestamp.
	invoiceNumber := fmt.Sprintf("HA-%s-%s", accountID[:8], now.Format("20060102-150405"))

	// Insert the invoice row.
	var inv Invoice
	err = tx.QueryRow(ctx, `
INSERT INTO house_account_invoices (
    house_account_id, invoice_number,
    period_start, period_end,
    subtotal_cents, tax_cents, total_cents,
    status, due_date
) VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', $8)
RETURNING
    id, house_account_id, invoice_number,
    period_start, period_end,
    subtotal_cents, tax_cents, total_cents,
    status, due_date, sent_at, paid_at, paid_amount_cents,
    pdf_url, notes, created_at, updated_at
`,
		accountID, invoiceNumber,
		periodStart.Format("2006-01-02"), periodEnd.Format("2006-01-02"),
		subtotal, taxCents, total,
		dueDate,
	).Scan(
		&inv.ID, &inv.HouseAccountID, &inv.InvoiceNumber,
		&inv.PeriodStart, &inv.PeriodEnd,
		&inv.SubtotalCents, &inv.TaxCents, &inv.TotalCents,
		&inv.Status, &inv.DueDate, &inv.SentAt, &inv.PaidAt, &inv.PaidAmountCents,
		&inv.PDFUrl, &inv.Notes, &inv.CreatedAt, &inv.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	// Mark all included charges as invoiced.
	chargeIDs := make([]string, len(charges))
	for i, c := range charges {
		chargeIDs[i] = c.id
	}

	if _, err := tx.Exec(ctx, `
UPDATE house_account_charges
SET house_account_invoice_id = $1
WHERE id = ANY($2::uuid[])
`, inv.ID, chargeIDs); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &inv, nil
}
