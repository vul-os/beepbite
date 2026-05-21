package invoicing

import (
	"bytes"
	"fmt"
	"time"

	"github.com/go-pdf/fpdf"
)

// ---------------------------------------------------------------------------
// Platform config (populated from env in handler.go at startup)
// ---------------------------------------------------------------------------

// PlatformConfig holds the platform's own legal identity read from env vars:
//
//	BEEPBITE_LEGAL_NAME
//	BEEPBITE_REGISTERED_ADDRESS
//	BEEPBITE_VAT_NUMBER
//	BEEPBITE_REGISTERED_COUNTRY
//	BEEPBITE_COMPANY_NUMBER
type PlatformConfig struct {
	LegalName         string
	RegisteredAddress string
	VATNumber         string
	Country           string
	CompanyNumber     string
}

// InvoicePDFInput is the full data needed to render a PDF.
type InvoicePDFInput struct {
	Invoice  *Invoice
	Lines    []InvoiceLine // already fetched
	Issuer   IssuerInfo
	Platform PlatformConfig // only relevant when Invoice.Issuer == "platform"
}

// IssuerInfo is the resolved issuer details (either platform or tenant).
type IssuerInfo struct {
	LegalName         string
	RegisteredAddress string
	Country           string
	VATNumber         string // empty → no VAT block
	CompanyNumber     string
	ContactEmail      string
	ContactPhone      string
}

// ---------------------------------------------------------------------------
// PDF renderer
// ---------------------------------------------------------------------------

// renderPDF generates an invoice PDF and returns the raw bytes.
// Typography intentionally mirrors the receipt look: Helvetica, light rule
// lines, two-column layout for labels + values.
func renderPDF(input InvoicePDFInput) ([]byte, error) {
	inv := input.Invoice
	issuer := input.Issuer

	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(20, 20, 20)
	pdf.SetAutoPageBreak(true, 20)
	pdf.AddPage()

	pageW, _ := pdf.GetPageSize()
	contentW := pageW - 40 // 20mm margins each side

	// ── Helper closures ───────────────────────────────────────────────────

	setFont := func(style string, size float64) {
		pdf.SetFont("Helvetica", style, size)
	}

	labelColor := func() { pdf.SetTextColor(100, 100, 100) }
	normalColor := func() { pdf.SetTextColor(30, 30, 30) }
	accentColor := func() { pdf.SetTextColor(10, 10, 80) }

	hrule := func() {
		y := pdf.GetY()
		pdf.SetDrawColor(200, 200, 200)
		pdf.SetLineWidth(0.3)
		pdf.Line(20, y, 20+contentW, y)
		pdf.Ln(3)
	}

	twoCol := func(label, value string, labelW float64) {
		labelColor()
		setFont("", 9)
		pdf.CellFormat(labelW, 5, label, "", 0, "L", false, 0, "")
		normalColor()
		setFont("", 9)
		pdf.CellFormat(contentW-labelW, 5, value, "", 1, "L", false, 0, "")
	}

	// ── Header: INVOICE title + invoice number + date ─────────────────────

	accentColor()
	setFont("B", 22)
	pdf.CellFormat(contentW/2, 12, "INVOICE", "", 0, "L", false, 0, "")

	// Top-right: invoice number + status
	setFont("", 9)
	normalColor()
	pdf.CellFormat(contentW/2, 6, "Invoice #: "+inv.InvoiceNumber, "", 1, "R", false, 0, "")

	statusLabel := inv.Status
	setFont("I", 8)
	labelColor()
	issuedStr := ""
	if inv.IssuedAt != nil {
		issuedStr = inv.IssuedAt.Format("02 Jan 2006")
	} else {
		issuedStr = inv.CreatedAt.Format("02 Jan 2006")
	}
	pdf.CellFormat(contentW/2, 5, "", "", 0, "L", false, 0, "")
	pdf.CellFormat(contentW/2, 5, "Status: "+statusLabel+"  |  Date: "+issuedStr, "", 1, "R", false, 0, "")

	pdf.Ln(4)
	hrule()

	// ── Issuer block ──────────────────────────────────────────────────────

	setFont("B", 10)
	accentColor()
	pdf.CellFormat(contentW, 6, "From", "", 1, "L", false, 0, "")
	pdf.Ln(1)

	lw := 45.0
	twoCol("Legal name:", issuer.LegalName, lw)
	if issuer.RegisteredAddress != "" {
		twoCol("Address:", issuer.RegisteredAddress, lw)
	}
	if issuer.Country != "" {
		twoCol("Country:", issuer.Country, lw)
	}
	if issuer.CompanyNumber != "" {
		twoCol("Reg. number:", issuer.CompanyNumber, lw)
	}
	if issuer.VATNumber != "" {
		twoCol("VAT number:", issuer.VATNumber, lw)
	}
	if issuer.ContactEmail != "" {
		twoCol("Email:", issuer.ContactEmail, lw)
	}
	if issuer.ContactPhone != "" {
		twoCol("Phone:", issuer.ContactPhone, lw)
	}

	pdf.Ln(4)
	hrule()

	// ── Recipient block ───────────────────────────────────────────────────

	setFont("B", 10)
	accentColor()
	pdf.CellFormat(contentW, 6, "Bill To", "", 1, "L", false, 0, "")
	pdf.Ln(1)

	normalColor()
	setFont("B", 9)
	pdf.MultiCell(contentW, 5, inv.RecipientName, "", "L", false)
	if inv.RecipientAddress != "" {
		setFont("", 9)
		pdf.MultiCell(contentW, 5, inv.RecipientAddress, "", "L", false)
	}

	pdf.Ln(4)
	hrule()

	// ── Line items table ──────────────────────────────────────────────────

	colDesc := contentW * 0.50
	colQty := contentW * 0.12
	colUnit := contentW * 0.19
	colTotal := contentW * 0.19

	// Table header row
	pdf.SetFillColor(240, 240, 245)
	setFont("B", 9)
	accentColor()
	pdf.CellFormat(colDesc, 6, "Description", "B", 0, "L", true, 0, "")
	pdf.CellFormat(colQty, 6, "Qty", "B", 0, "C", true, 0, "")
	pdf.CellFormat(colUnit, 6, "Unit price", "B", 0, "R", true, 0, "")
	pdf.CellFormat(colTotal, 6, "Total", "B", 1, "R", true, 0, "")

	normalColor()
	for i, l := range input.Lines {
		fill := i%2 == 0
		if fill {
			pdf.SetFillColor(252, 252, 254)
		} else {
			pdf.SetFillColor(255, 255, 255)
		}
		setFont("", 9)
		pdf.CellFormat(colDesc, 6, l.Description, "", 0, "L", fill, 0, "")
		pdf.CellFormat(colQty, 6, fmt.Sprintf("%d", l.Qty), "", 0, "C", fill, 0, "")
		pdf.CellFormat(colUnit, 6, formatCents(l.UnitCents, inv.Currency), "", 0, "R", fill, 0, "")
		pdf.CellFormat(colTotal, 6, formatCents(l.LineTotalCents, inv.Currency), "", 1, "R", fill, 0, "")
	}

	pdf.Ln(3)

	// ── Totals block ──────────────────────────────────────────────────────

	totLabelW := contentW * 0.75
	totValW := contentW * 0.25

	hrule()

	labelColor()
	setFont("", 9)
	pdf.CellFormat(totLabelW, 5, "Subtotal", "", 0, "R", false, 0, "")
	normalColor()
	pdf.CellFormat(totValW, 5, formatCents(inv.SubtotalCents, inv.Currency), "", 1, "R", false, 0, "")

	if inv.VATApplied && inv.VATCents > 0 {
		labelColor()
		setFont("", 9)
		vatLabel := "VAT"
		if issuer.VATNumber != "" {
			vatLabel = "VAT (" + issuer.VATNumber + ")"
		}
		pdf.CellFormat(totLabelW, 5, vatLabel, "", 0, "R", false, 0, "")
		normalColor()
		pdf.CellFormat(totValW, 5, formatCents(inv.VATCents, inv.Currency), "", 1, "R", false, 0, "")
	}

	// Total row — bold + slightly larger
	hrule()
	setFont("B", 10)
	accentColor()
	pdf.CellFormat(totLabelW, 6, "TOTAL", "", 0, "R", false, 0, "")
	pdf.CellFormat(totValW, 6, formatCents(inv.TotalCents, inv.Currency)+" "+inv.Currency, "", 1, "R", false, 0, "")

	pdf.Ln(6)
	hrule()

	// ── Footer: generated timestamp ───────────────────────────────────────

	labelColor()
	setFont("I", 7)
	pdf.CellFormat(contentW, 5,
		"Generated by BeepBite  •  "+time.Now().UTC().Format("2006-01-02 15:04 UTC"),
		"", 1, "C", false, 0, "")

	if pdf.Err() {
		return nil, pdf.Error()
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// formatCents formats a bigint cents value as a decimal string with 2 dp.
// e.g. 12345 → "123.45".
func formatCents(cents int64, _ string) string {
	neg := cents < 0
	if neg {
		cents = -cents
	}
	s := fmt.Sprintf("%d.%02d", cents/100, cents%100)
	if neg {
		s = "-" + s
	}
	return s
}
