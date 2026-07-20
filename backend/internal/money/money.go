// Package money holds every rule for turning an integer minor-unit amount into
// a number a human reads, and back again.
//
// Two invariants hold everywhere in BeepBite:
//
//  1. Money is an int64 count of *minor units* (cents, sen, fils, …). It is
//     never a float64 — not in the database, not on the wire, not in a
//     calculation. Floats lose cents.
//
//  2. How many minor units make one major unit is a property of the *currency*,
//     not a constant. JPY and ISK have 0 decimals, KWD/BHD/JOD have 3, most
//     have 2. A literal `/100` in application code is therefore a bug: it
//     silently divides ¥1000 down to ¥10 and KD 1.000 up to KD 10.00.
//
// The exponent comes from currencies.decimal_digits (see the currencies table,
// migration 002), which is resolved per location by internal/locations. Pass it
// in; do not guess it.
package money

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/text/currency"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
	"golang.org/x/text/number"
)

// MaxDecimals is the largest minor-unit exponent ISO 4217 defines (3, for the
// Gulf dinars). Values are clamped to it so a bad database row cannot overflow
// the scale table.
const MaxDecimals = 4

// scales[i] == 10^i. A table beats math.Pow: it is exact and integer-only.
var scales = [MaxDecimals + 1]int64{1, 10, 100, 1000, 10000}

// ErrInvalidAmount is returned by Parse for input it cannot read as a decimal
// number in the given currency's scale.
var ErrInvalidAmount = errors.New("money: invalid amount")

// Scale returns the number of minor units in one major unit of a currency with
// the given exponent — 100 for USD/EUR/ZAR, 1 for JPY, 1000 for KWD.
//
// A negative exponent is treated as 0 and anything past MaxDecimals is clamped,
// so a corrupt decimal_digits value degrades to a sane scale instead of
// panicking mid-checkout.
func Scale(decimals int) int64 {
	if decimals < 0 {
		return 1
	}
	if decimals > MaxDecimals {
		decimals = MaxDecimals
	}
	return scales[decimals]
}

// Split separates a minor-unit amount into its major and minor parts, keeping
// the sign on the major part only. Split(-1234, 2) is (-12, 34), i.e. "-12.34".
func Split(minor int64, decimals int) (major, frac int64) {
	s := Scale(decimals)
	major = minor / s
	frac = minor % s
	if frac < 0 {
		frac = -frac
	}
	return major, frac
}

// Decimal renders a minor-unit amount as a plain decimal string with exactly
// `decimals` fractional digits and no grouping, symbol, or locale influence —
// "1234.50", "1000" (JPY), "1.234" (KWD).
//
// This is the format for machine-readable places: API payloads, CSV exports,
// ESC/POS lines that must line up in a monospace column, and anywhere a test
// asserts on an exact string. For anything a customer reads, use Format.
func Decimal(minor int64, decimals int) string {
	major, frac := Split(minor, decimals)
	sign := ""
	if minor < 0 && major == 0 {
		// -0.50 loses its sign in integer division; restore it.
		sign = "-"
	}
	if decimals <= 0 {
		return fmt.Sprintf("%s%d", sign, major)
	}
	return fmt.Sprintf("%s%d.%0*d", sign, major, decimals, frac)
}

// Format renders a minor-unit amount the way a reader of `locale` expects to
// see `currencyCode`: correct symbol, correct symbol position, correct grouping
// and decimal separators, correct number of fractional digits.
//
// The locale drives presentation only. It never changes the amount, and it
// never changes which currency the amount is in — a German-locale receipt for a
// Japanese store still reads "1.000 ¥", not euros.
//
// An empty or unparseable locale falls back to language.Und, whose CLDR root
// formatting is neutral rather than any one country's convention. An unknown
// currency code falls back to "<CODE> <decimal>" so the amount stays legible
// and unambiguous instead of being dropped.
func Format(minor int64, currencyCode string, decimals int, locale string) string {
	code := strings.ToUpper(strings.TrimSpace(currencyCode))

	unit, err := currency.ParseISO(code)
	if err != nil {
		// Unknown/blank code: never guess a symbol. Show the code verbatim.
		if code == "" {
			return Decimal(minor, decimals)
		}
		return code + " " + Decimal(minor, decimals)
	}

	tag := parseLocale(locale)
	major, frac := Split(minor, decimals)

	// Rebuild the value as a decimal for x/text. number.Decimal formats from a
	// float64, so feed it the smallest float that can round-trip this amount
	// and pin the fraction digits — the integer parts above are the source of
	// truth for what those digits are.
	v := float64(major) + float64(frac)/float64(Scale(decimals))
	if minor < 0 && major == 0 {
		v = -v
	}

	p := message.NewPrinter(tag)
	return p.Sprint(currency.Symbol(unit.Amount(number.Decimal(v,
		number.MinFractionDigits(decimals),
		number.MaxFractionDigits(decimals),
	)))) //nolint:staticcheck // x/text's currency formatting entry point
}

// FormatCode is Format but with the ISO code instead of the symbol — "ZAR 12.50"
// rather than "R 12.50".
//
// Use it in consolidated multi-currency reports, where two locations' symbols
// can collide ($ is USD, CAD, AUD, and a dozen more) and the reader needs to
// know which currency a column is actually in.
func FormatCode(minor int64, currencyCode string, decimals int, locale string) string {
	code := strings.ToUpper(strings.TrimSpace(currencyCode))
	if code == "" {
		return Decimal(minor, decimals)
	}
	unit, err := currency.ParseISO(code)
	if err != nil {
		return code + " " + Decimal(minor, decimals)
	}
	tag := parseLocale(locale)
	major, frac := Split(minor, decimals)
	v := float64(major) + float64(frac)/float64(Scale(decimals))
	if minor < 0 && major == 0 {
		v = -v
	}
	p := message.NewPrinter(tag)
	return p.Sprint(currency.ISO(unit.Amount(number.Decimal(v,
		number.MinFractionDigits(decimals),
		number.MaxFractionDigits(decimals),
	)))) //nolint:staticcheck // x/text's currency formatting entry point
}

// Parse reads a major-unit decimal string ("12.50", "1 000,50", "¥1000") into
// minor units, using integer arithmetic throughout — the string is never routed
// through a float, so 0.29 cannot arrive as 28 cents.
//
// It accepts either '.' or ',' as the decimal separator and ignores spaces,
// underscores, and apostrophes used as grouping marks, because operators type
// prices the way their locale taught them. More fractional digits than the
// currency allows is an error rather than a silent truncation: "12.345" in USD
// is a typo worth surfacing, not 1234 cents.
func Parse(s string, decimals int) (int64, error) {
	raw := strings.TrimSpace(s)
	if raw == "" {
		return 0, fmt.Errorf("%w: empty", ErrInvalidAmount)
	}

	neg := false
	switch raw[0] {
	case '-':
		neg, raw = true, raw[1:]
	case '+':
		raw = raw[1:]
	}

	// Strip grouping marks and any stray currency symbol/letters.
	var b strings.Builder
	sepIdx := -1
	for _, r := range raw {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == ',':
			if sepIdx >= 0 {
				// A second separator means the first was grouping: "1,234.50".
				// Fold the earlier one away and keep the latest as decimal.
				sepIdx = b.Len()
				continue
			}
			sepIdx = b.Len()
		case r == ' ' || r == ' ' || r == '\'' || r == '_':
			// grouping marks — drop
		default:
			// Currency symbols and codes are tolerated but carry no value.
		}
	}
	digits := b.String()
	if digits == "" {
		return 0, fmt.Errorf("%w: %q has no digits", ErrInvalidAmount, s)
	}

	intPart, fracPart := digits, ""
	if sepIdx >= 0 {
		intPart, fracPart = digits[:sepIdx], digits[sepIdx:]
	}
	// A trailing group of exactly 3 after a separator, in a 2-decimal currency,
	// is grouping ("1,234") not a fraction. Only treat it as a fraction when it
	// fits the currency's scale.
	if len(fracPart) > decimals {
		if sepIdx >= 0 && len(fracPart) == 3 && decimals != 3 {
			intPart, fracPart = digits, ""
		} else {
			return 0, fmt.Errorf("%w: %q has more than %d decimal places", ErrInvalidAmount, s, decimals)
		}
	}

	var minor int64
	for _, r := range intPart {
		minor = minor*10 + int64(r-'0')
	}
	minor *= Scale(decimals)

	pad := decimals - len(fracPart)
	var f int64
	for _, r := range fracPart {
		f = f*10 + int64(r-'0')
	}
	for ; pad > 0; pad-- {
		f *= 10
	}
	minor += f

	if neg {
		minor = -minor
	}
	return minor, nil
}

// Rescale converts an amount from one minor-unit exponent to another, rounding
// half away from zero when the target scale is coarser.
//
// It exists for the boundary where a legacy `decimal(10,2)` column meets a
// 0-decimal or 3-decimal currency: 150.00 stored for a JPY location is ¥150,
// not ¥15000.
func Rescale(minor int64, from, to int) int64 {
	if from == to {
		return minor
	}
	if to > from {
		return minor * Scale(to-from)
	}
	div := Scale(from - to)
	return divRoundHalfAway(minor, div)
}

// divRoundHalfAway divides two integers, rounding halves away from zero, with
// no float64 anywhere in the path.
//
// Half-away-from-zero is the rule tax authorities and cash drawers assume: 0.5
// cents rounds up to 1, and -0.5 rounds down to -1, so a refund is the exact
// mirror of the sale it reverses. Go's integer division truncates toward zero
// instead, which would quietly bias every rounded total downward.
func divRoundHalfAway(n, d int64) int64 {
	if d == 0 {
		return 0
	}
	if d < 0 {
		n, d = -n, -d
	}
	if n >= 0 {
		return (n + d/2) / d
	}
	return -((-n + d/2) / d)
}

// DivRound exposes divRoundHalfAway for callers apportioning an amount (tip
// splits, discount allocation) that must round the same way the tax engine does.
func DivRound(n, d int64) int64 { return divRoundHalfAway(n, d) }

// parseLocale turns a BCP-47 tag into a language.Tag, collapsing anything
// unusable into language.Und.
//
// Und is deliberate: it selects CLDR's root formatting, which belongs to no
// country. Falling back to a real locale here would reintroduce exactly the bug
// this package exists to remove — it would just be someone else's country.
func parseLocale(locale string) language.Tag {
	l := strings.TrimSpace(locale)
	if l == "" {
		return language.Und
	}
	tag, err := language.Parse(l)
	if err != nil {
		return language.Und
	}
	return tag
}
