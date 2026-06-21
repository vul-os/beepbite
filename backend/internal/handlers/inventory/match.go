package inventory

import "math"

// DefaultTolerancePct is the default ±2 % variance band used for 3-way match.
const DefaultTolerancePct = 0.02

// MatchResult is the full response body for POST .../match.
type MatchResult struct {
	InvoiceID    string      `json:"invoice_id"`
	MatchStatus  string      `json:"match_status"`
	TolerancePct float64     `json:"tolerance_pct"`
	Lines        []MatchLine `json:"lines"`
}

// RunMatch computes per-line variance and decides the overall match_status.
//
// Variance rules (compare invoice vs. PO as the reference document):
//   - qty_variance_pct  = (invoice_qty  - po_qty)  / po_qty  (0 when po_qty == 0)
//   - price_variance_pct = (invoice_price - po_price) / po_price (0 when po_price == 0)
//
// If ALL lines have |qty_variance_pct| <= tol AND |price_variance_pct| <= tol
// the result is "matched"; otherwise "variance".
//
// The match_status CHECK constraint on supplier_invoices allows:
//
//	'unmatched' | 'price_variance' | 'qty_variance' | 'matched'
//
// We map our binary matched/variance outcome to the most specific status:
//   - all within tolerance                       → "matched"
//   - any price out of band but qty ok           → "price_variance"
//   - any qty out of band (price may also differ)→ "qty_variance"
func RunMatch(data *InvoiceMatchData, tolerancePct float64) *MatchResult {
	if tolerancePct <= 0 {
		tolerancePct = DefaultTolerancePct
	}

	result := &MatchResult{
		InvoiceID:    data.InvoiceID,
		TolerancePct: tolerancePct,
		Lines:        make([]MatchLine, len(data.Lines)),
	}

	hasQtyVariance := false
	hasPriceVariance := false

	for i, l := range data.Lines {
		line := l

		// Qty variance vs PO.
		if l.POQty != 0 {
			line.QtyVariancePct = (l.InvoiceQty - l.POQty) / l.POQty
		}

		// Price variance vs PO.
		if l.POPriceCents != 0 {
			line.PriceVariancePct = float64(l.InvoicePriceCents-l.POPriceCents) / float64(l.POPriceCents)
		}

		qtyOutOfBand := math.Abs(line.QtyVariancePct) > tolerancePct
		priceOutOfBand := math.Abs(line.PriceVariancePct) > tolerancePct

		// A line with no PO reference is always flagged as variance.
		if l.PurchaseOrderItemID == nil || *l.PurchaseOrderItemID == "" {
			qtyOutOfBand = true
			priceOutOfBand = true
		}

		line.HasVariance = qtyOutOfBand || priceOutOfBand

		if qtyOutOfBand {
			hasQtyVariance = true
		}
		if priceOutOfBand {
			hasPriceVariance = true
		}

		result.Lines[i] = line
	}

	switch {
	case hasQtyVariance:
		result.MatchStatus = "qty_variance"
	case hasPriceVariance:
		result.MatchStatus = "price_variance"
	default:
		result.MatchStatus = "matched"
	}

	return result
}
