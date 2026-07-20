// Package tax computes sales tax on integer minor-unit amounts.
//
// The one thing this package refuses to assume is the thing most POS codebases
// hardcode: whether a menu price already contains tax.
//
// In South Africa, the EU, the UK, Australia and Japan, the shelf price is the
// price — VAT/GST is already inside it, and the receipt shows how much of the
// total was tax. In the US and Canada, the shelf price excludes sales tax and
// the register adds it at the end. Neither is a rounding detail: the same menu
// price and the same rate produce different totals, and picking wrong means
// either overcharging customers or under-remitting to the revenue service.
//
// So `inclusive` is a per-location setting (locations.tax_inclusive), carried
// onto every order at the moment it is placed (orders.tax_inclusive) so that a
// later settings change never silently rewrites historical takings.
//
// All arithmetic is integer. Rounding is half-away-from-zero via money.DivRound,
// which makes a refund the exact mirror of the sale it reverses.
package tax

import "github.com/beepbite/backend/internal/money"

// BasisPoints is a tax rate in hundredths of a percent: 15% is 1500, 8.875%
// (New York City) is 887.5 → 888… which is why it is not quite enough on its
// own. See RateFromPercent for how decimal(5,2) percentages map in exactly.
//
// Basis points keep the rate an integer, so a rate can never accumulate the
// float drift that would make two identically-priced orders disagree by a cent.
type BasisPoints int64

// bpPerUnit is the number of basis points in 1.0 (i.e. 100%×100).
const bpPerUnit = 10000

// RateFromPercent converts a percentage as stored in the database —
// decimal(5,2), e.g. 15.00, 8.88, 0.00 — into BasisPoints.
//
// The input is a float64 only because that is what the column scans into; it is
// immediately rounded to an integer basis-point count and never used in
// arithmetic again. decimal(5,2) has exactly two decimal places, so this
// conversion is lossless for every value the column can hold.
func RateFromPercent(pct float64) BasisPoints {
	// ×100 to reach basis points, rounding away from zero at the half.
	if pct < 0 {
		return BasisPoints(-int64(-pct*100 + 0.5))
	}
	return BasisPoints(int64(pct*100 + 0.5))
}

// Percent renders the rate back as a percentage for display and for writing to
// a decimal(5,2) column.
func (b BasisPoints) Percent() float64 { return float64(b) / 100 }

// Result is a fully decomposed taxed amount. Net + Tax always equals Gross
// exactly — the rounding is applied once, to Tax, and the other component is
// derived by subtraction so the three numbers can never disagree by a cent.
type Result struct {
	// Net is the amount excluding tax (the taxable base).
	Net int64
	// Tax is the tax portion.
	Tax int64
	// Gross is what the customer pays.
	Gross int64
}

// Compute decomposes a line or order amount into net, tax and gross.
//
// `amount` is interpreted according to `inclusive`:
//
//   - inclusive == true  → amount is the GROSS (tax already inside it).
//     Tax is extracted:  tax = gross × rate / (1 + rate)
//   - inclusive == false → amount is the NET (tax not yet applied).
//     Tax is added on:   tax = net × rate
//
// A zero or negative rate yields zero tax with net == gross == amount, which is
// the correct behaviour for tax-exempt locations and for jurisdictions the
// operator has not configured yet — no tax is quietly invented.
//
// Negative amounts (refunds, voids) are supported and produce negative tax of
// the same magnitude the original sale produced, so a full refund nets to zero.
func Compute(amount int64, rate BasisPoints, inclusive bool) Result {
	if rate <= 0 {
		return Result{Net: amount, Tax: 0, Gross: amount}
	}

	if inclusive {
		// gross × rate / (bpPerUnit + rate). Dividing by (1+rate) rather than
		// by rate is the whole difference between the two conventions: at 15%,
		// R115 inclusive holds R15 of tax (115×1500/11500), not R17.25.
		taxAmt := money.DivRound(amount*int64(rate), bpPerUnit+int64(rate))
		return Result{Net: amount - taxAmt, Tax: taxAmt, Gross: amount}
	}

	taxAmt := money.DivRound(amount*int64(rate), bpPerUnit)
	return Result{Net: amount, Tax: taxAmt, Gross: amount + taxAmt}
}

// Extract is Compute for a known tax-inclusive amount. Provided for call sites
// where the convention is fixed by context and the boolean would read as noise.
func Extract(gross int64, rate BasisPoints) Result { return Compute(gross, rate, true) }

// Add is Compute for a known tax-exclusive amount.
func Add(net int64, rate BasisPoints) Result { return Compute(net, rate, false) }

// Config is a location's complete tax posture, resolved once and passed down
// rather than re-derived at each call site.
type Config struct {
	// Rate is the effective rate for the location.
	Rate BasisPoints
	// Inclusive reports whether displayed prices already contain the tax.
	Inclusive bool
	// Label is what the receipt calls it — "VAT", "GST", "Sales Tax",
	// "Consumption Tax". Purely presentational, but getting it wrong makes a
	// receipt legally wrong in several jurisdictions.
	Label string
}

// DefaultLabel is used when a location has not chosen a name for its tax.
//
// "Tax" is deliberately the generic word rather than "VAT": VAT is a specific
// instrument that does not exist in the US, and printing it on a US receipt is
// a factual error. Operators in VAT jurisdictions set the label explicitly.
const DefaultLabel = "Tax"

// Compute applies the location's configuration to an amount.
func (c Config) Compute(amount int64) Result { return Compute(amount, c.Rate, c.Inclusive) }

// EffectiveLabel returns the configured label, or DefaultLabel if unset.
func (c Config) EffectiveLabel() string {
	if c.Label == "" {
		return DefaultLabel
	}
	return c.Label
}
