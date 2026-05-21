// Package receiptpdf renders a BeepBite order receipt to a PDF byte slice
// using github.com/go-pdf/fpdf.
//
// The package is self-contained: callers pass a Receipt (shared DTO also used
// by handlers/receipts) and receive []byte which can be served over HTTP,
// attached to an email, or sent via WhatsApp.
//
// Font usage: fpdf ships Helvetica as a built-in core font (no external font
// files required). All text is encoded as Latin-1 so the output is portable
// without embedding a full Unicode font.
//
// Layout (A4, portrait, 10 mm margins):
//
//	┌──────────────────────────────────────┐
//	│  [LOGO PLACEHOLDER]   StoreName      │  header
//	│                       StoreAddress   │
//	│  Fiscal #   Order #   Date           │
//	├──────────────────────────────────────┤
//	│  Item          Qty  Unit  Total      │  line items
//	│  …modifier…                          │
//	├──────────────────────────────────────┤
//	│  Subtotal                      R x   │  totals
//	│  Tax                           R x   │
//	│  Tip                           R x   │
//	│  TOTAL                         R x   │
//	├──────────────────────────────────────┤
//	│  Method        Paid    Tip  Change   │  payments
//	├──────────────────────────────────────┤
//	│  Thank you for your business!        │  footer
//	└──────────────────────────────────────┘
package receiptpdf

import (
	"bytes"
	"fmt"
	"time"

	"github.com/go-pdf/fpdf"

	"github.com/beepbite/backend/internal/handlers/receipts"
)

// Render converts receipt into a PDF document and returns the raw bytes.
// Returns a non-nil error only when fpdf itself reports an internal error
// (which is very rare for well-formed inputs).
func Render(r *receipts.Receipt) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(10, 10, 10)
	pdf.SetAutoPageBreak(true, 15)
	pdf.AddPage()

	pageW, _ := pdf.GetPageSize()
	contentW := pageW - 20 // left+right margins = 20 mm

	// ── Header ────────────────────────────────────────────────────────────────

	// Logo placeholder box (left side, 30×15 mm).
	pdf.SetDrawColor(180, 180, 180)
	pdf.SetFillColor(240, 240, 240)
	pdf.Rect(10, 10, 30, 15, "FD")
	pdf.SetFont("Helvetica", "", 7)
	pdf.SetTextColor(150, 150, 150)
	pdf.SetXY(10, 15)
	pdf.CellFormat(30, 5, "LOGO", "", 0, "C", false, 0, "")

	// Store name + address (right of logo).
	pdf.SetTextColor(0, 0, 0)
	pdf.SetFont("Helvetica", "B", 13)
	pdf.SetXY(44, 10)
	pdf.CellFormat(contentW-34, 7, r.StoreName, "", 1, "L", false, 0, "")

	if r.StoreAddress != nil && *r.StoreAddress != "" {
		pdf.SetFont("Helvetica", "", 9)
		pdf.SetX(44)
		pdf.CellFormat(contentW-34, 5, *r.StoreAddress, "", 1, "L", false, 0, "")
	}

	// Meta row: fiscal number, order number, date.
	pdf.SetY(28)
	pdf.SetFont("Helvetica", "", 8)
	fiscal := ""
	if r.FiscalReceiptNumber != nil {
		fiscal = "Fiscal #: " + *r.FiscalReceiptNumber
	}
	pdf.SetX(10)
	pdf.CellFormat(contentW/3, 5, fiscal, "", 0, "L", false, 0, "")
	pdf.CellFormat(contentW/3, 5, "Order #: "+r.OrderNumber, "", 0, "C", false, 0, "")
	pdf.CellFormat(contentW/3, 5, r.CreatedAt.UTC().Format("2006-01-02 15:04"), "", 1, "R", false, 0, "")

	drawHRule(pdf, contentW)

	// ── Line items ────────────────────────────────────────────────────────────

	// Column header.
	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetFillColor(245, 245, 245)
	pdf.SetX(10)
	pdf.CellFormat(contentW*0.50, 6, "Item", "B", 0, "L", true, 0, "")
	pdf.CellFormat(contentW*0.10, 6, "Qty", "B", 0, "C", true, 0, "")
	pdf.CellFormat(contentW*0.20, 6, "Unit", "B", 0, "R", true, 0, "")
	pdf.CellFormat(contentW*0.20, 6, "Total", "B", 1, "R", true, 0, "")

	pdf.SetFont("Helvetica", "", 9)
	for _, li := range r.LineItems {
		pdf.SetX(10)
		pdf.CellFormat(contentW*0.50, 5, truncate(li.ItemName, 36), "", 0, "L", false, 0, "")
		pdf.CellFormat(contentW*0.10, 5, fmt.Sprintf("%d", li.Quantity), "", 0, "C", false, 0, "")
		pdf.CellFormat(contentW*0.20, 5, formatCents(li.UnitPriceCents, r.CurrencyCode), "", 0, "R", false, 0, "")
		pdf.CellFormat(contentW*0.20, 5, formatCents(li.TotalPriceCents, r.CurrencyCode), "", 1, "R", false, 0, "")

		// Modifiers — indented, smaller font.
		if len(li.Modifiers) > 0 {
			pdf.SetFont("Helvetica", "I", 8)
			for _, m := range li.Modifiers {
				pdf.SetX(14)
				label := "+ " + truncate(m.Name, 34)
				pdf.CellFormat(contentW*0.60, 4, label, "", 0, "L", false, 0, "")
				pdf.CellFormat(contentW*0.20, 4, "", "", 0, "R", false, 0, "")
				pdf.CellFormat(contentW*0.20-4, 4, formatCents(m.PriceCentsSnapshot, r.CurrencyCode), "", 1, "R", false, 0, "")
			}
			pdf.SetFont("Helvetica", "", 9)
		}
	}

	drawHRule(pdf, contentW)

	// ── Totals ────────────────────────────────────────────────────────────────

	totalRows := []struct {
		label string
		cents int64
		bold  bool
	}{
		{"Subtotal", r.SubtotalCents, false},
		{"Tax", r.TaxCents, false},
		{"Tip", r.TipCents, false},
		{"TOTAL", r.TotalCents, true},
	}

	labelW := contentW * 0.75
	amtW := contentW * 0.25

	for _, row := range totalRows {
		if row.bold {
			pdf.SetFont("Helvetica", "B", 10)
		} else {
			pdf.SetFont("Helvetica", "", 9)
		}
		pdf.SetX(10)
		pdf.CellFormat(labelW, 5, row.label, "", 0, "R", false, 0, "")
		pdf.CellFormat(amtW, 5, formatCents(row.cents, r.CurrencyCode), "", 1, "R", false, 0, "")
	}

	// ── Payments ─────────────────────────────────────────────────────────────

	if len(r.Payments) > 0 {
		drawHRule(pdf, contentW)

		pdf.SetFont("Helvetica", "B", 9)
		pdf.SetX(10)
		pdf.CellFormat(contentW*0.30, 6, "Method", "B", 0, "L", false, 0, "")
		pdf.CellFormat(contentW*0.25, 6, "Paid", "B", 0, "R", false, 0, "")
		pdf.CellFormat(contentW*0.20, 6, "Tip", "B", 0, "R", false, 0, "")
		pdf.CellFormat(contentW*0.25, 6, "Change", "B", 1, "R", false, 0, "")

		pdf.SetFont("Helvetica", "", 9)
		for _, p := range r.Payments {
			pdf.SetX(10)
			pdf.CellFormat(contentW*0.30, 5, p.Method, "", 0, "L", false, 0, "")
			pdf.CellFormat(contentW*0.25, 5, formatCents(p.AmountPaidCents, r.CurrencyCode), "", 0, "R", false, 0, "")
			pdf.CellFormat(contentW*0.20, 5, formatCents(p.TipAmountCents, r.CurrencyCode), "", 0, "R", false, 0, "")
			pdf.CellFormat(contentW*0.25, 5, formatCents(p.ChangeGivenCents, r.CurrencyCode), "", 1, "R", false, 0, "")
		}
	}

	// ── Footer ────────────────────────────────────────────────────────────────

	drawHRule(pdf, contentW)
	pdf.SetFont("Helvetica", "I", 9)
	pdf.SetTextColor(80, 80, 80)
	pdf.SetX(10)
	pdf.CellFormat(contentW, 6, "Thank you for your business!", "", 1, "C", false, 0, "")
	pdf.SetFont("Helvetica", "", 7)
	pdf.SetX(10)
	pdf.CellFormat(contentW, 4, "Generated "+time.Now().UTC().Format("2006-01-02T15:04:05Z"), "", 1, "C", false, 0, "")

	if err := pdf.Error(); err != nil {
		return nil, fmt.Errorf("receiptpdf: render: %w", err)
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("receiptpdf: output: %w", err)
	}
	return buf.Bytes(), nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

// drawHRule draws a light grey horizontal rule at the current Y position.
func drawHRule(pdf *fpdf.Fpdf, contentW float64) {
	pdf.SetDrawColor(200, 200, 200)
	y := pdf.GetY() + 1
	pdf.Line(10, y, 10+contentW, y)
	pdf.SetY(y + 2)
}

// formatCents formats cents as a currency string, e.g. "R 12.50" for ZAR.
// The currency symbol is a simple prefix mapping; unknown codes fall back to
// the ISO code followed by a space.
func formatCents(cents int64, currencyCode string) string {
	symbol := currencySymbol(currencyCode)
	neg := ""
	if cents < 0 {
		neg = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%s%d.%02d", neg, symbol, cents/100, cents%100)
}

func currencySymbol(code string) string {
	switch code {
	case "ZAR":
		return "R "
	case "USD":
		return "$ "
	case "EUR":
		return "€ "
	case "GBP":
		return "£ "
	case "KES":
		return "KSh "
	case "NGN":
		return "₦ "
	case "GHS":
		return "GH₵ "
	default:
		return code + " "
	}
}

// truncate shortens s to at most maxLen runes, appending "…" when trimmed.
func truncate(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen-1]) + "…"
}
