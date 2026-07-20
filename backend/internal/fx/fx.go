// Package fx is the seam for optional currency conversion in consolidated
// reporting.
//
// # What this is for
//
// An operator with locations in Lisbon, Tokyo and Cape Town has three sets of
// books in three currencies. Each location's money stays in its own currency
// everywhere — that is not negotiable and this package does not change it.
// What this package adds is one screen: a group-level report that puts those
// three numbers in a single column so the operator can see a total.
//
// # What this is not for
//
//   - It NEVER mutates a stored amount. Nothing here writes. Orders, payments,
//     drawer counts and takings stay denominated exactly as they were taken, in
//     integer minor units of the location's own currency, forever. A converted
//     figure is a view, computed at read time, discarded after rendering.
//   - It is NOT a pricing engine. Menu prices are not converted. A customer is
//     never quoted a rate.
//   - It is NOT a settlement or accounting record. Statutory reporting must use
//     the location's own currency and the rate its tax authority prescribes.
//
// # Off by default
//
// The zero value of this package is Disabled: Convert returns ErrDisabled and
// nothing reaches the network. BeepBite is fully functional with FX off — the
// consolidated report simply groups by currency instead of totalling, which is
// the honest presentation anyway.
//
// This matters beyond configuration hygiene. A POS makes no outbound calls the
// operator did not ask for; a till that phones an exchange-rate API on every
// dashboard load is both a privacy surprise and a new way for the reports page
// to break when someone else's service is down.
//
// # Provenance is mandatory
//
// Every Conversion carries the Rate used, the AsOf timestamp of the underlying
// quote, and the Provider that supplied it. Callers must surface these next to
// the number. A consolidated total with no rate and no timestamp is not a
// figure anyone can act on — it is a number that was true at an unknown moment.
//
// # Provider
//
// The only implementation is OpenRate (openrate.go), our own open-source
// exchange-rate engine. It is reached over its HTTP API at an address the
// operator supplies — typically their own instance. No third-party FX API is
// hardcoded, embedded, proxied or resold.
package fx

import (
	"context"
	"errors"
	"time"

	"github.com/beepbite/backend/internal/money"
)

// ErrDisabled is returned by every method of the Disabled converter. It is the
// expected, non-exceptional result when an operator has not turned FX on, and
// callers should treat it as "show per-currency subtotals", not as a failure.
var ErrDisabled = errors.New("fx: currency conversion is disabled")

// ErrUnsupportedPair is returned when the provider has no path between two
// currencies in its current snapshot.
var ErrUnsupportedPair = errors.New("fx: no rate available for this currency pair")

// Rate is a single exchange rate with the provenance needed to display it
// honestly.
type Rate struct {
	// From and To are ISO-4217 codes.
	From string `json:"from"`
	To   string `json:"to"`

	// Value is the number of To units per one From unit.
	//
	// This is the one float64 in the money path, and it is deliberate: an
	// exchange rate is a real-valued ratio, not a fixed-point quantity, and
	// pretending otherwise would round it before it is used. It is applied to
	// integer minor units exactly once, in Conversion, and the result is
	// immediately rounded back to an integer.
	Value float64 `json:"rate"`

	// AsOf is when the underlying quote was observed — NOT when this request
	// was made. A rate fetched now from a source that last updated on Friday is
	// a Friday rate, and a weekend report must say so.
	AsOf time.Time `json:"as_of"`

	// Provider names the engine that supplied the rate, for display and audit.
	Provider string `json:"provider"`
}

// Stale reports whether the underlying quote is older than maxAge. Callers
// should mark stale figures in the UI rather than hide them: an operator would
// rather see a total labelled "rate from 3 days ago" than no total at all.
func (r Rate) Stale(maxAge time.Duration) bool {
	return !r.AsOf.IsZero() && time.Since(r.AsOf) > maxAge
}

// Conversion is a converted amount together with everything needed to explain
// it. The original is retained so a caller can always show both.
type Conversion struct {
	// FromMinor is the original amount in minor units of Rate.From.
	FromMinor int64 `json:"from_minor"`
	// FromDecimals is the minor-unit exponent of the source currency.
	FromDecimals int `json:"from_decimals"`
	// ToMinor is the converted amount in minor units of Rate.To.
	ToMinor int64 `json:"to_minor"`
	// ToDecimals is the minor-unit exponent of the target currency.
	ToDecimals int `json:"to_decimals"`
	// Rate is the rate applied, with its provenance.
	Rate Rate `json:"rate"`
}

// Converter is the seam. Production wiring picks an implementation once at
// startup; every caller downstream depends only on this interface, so turning
// FX off is a configuration change and not a code path.
type Converter interface {
	// Enabled reports whether conversion is available. Callers should branch on
	// this to choose between a consolidated total and per-currency subtotals,
	// rather than calling Convert and interpreting the error.
	Enabled() bool

	// Convert converts an amount between currencies. fromDecimals and
	// toDecimals are the ISO minor-unit exponents of the two currencies, which
	// callers already hold from locations.Settings.
	Convert(ctx context.Context, minor int64, from string, fromDecimals int, to string, toDecimals int) (Conversion, error)

	// Rate returns the current rate for a pair without converting anything —
	// for a report header that states the rate once rather than per row.
	Rate(ctx context.Context, from, to string) (Rate, error)

	// Name identifies the provider for display.
	Name() string
}

// ---------------------------------------------------------------------------
// Disabled — the default
// ---------------------------------------------------------------------------

// Disabled is the no-op Converter used whenever FX is not configured. It makes
// no network calls and holds no state.
type Disabled struct{}

// Enabled always reports false.
func (Disabled) Enabled() bool { return false }

// Name identifies the disabled converter in diagnostics.
func (Disabled) Name() string { return "disabled" }

// Convert always returns ErrDisabled without touching the network.
func (Disabled) Convert(context.Context, int64, string, int, string, int) (Conversion, error) {
	return Conversion{}, ErrDisabled
}

// Rate always returns ErrDisabled without touching the network.
func (Disabled) Rate(context.Context, string, string) (Rate, error) {
	return Rate{}, ErrDisabled
}

// compile-time check
var _ Converter = Disabled{}

// ---------------------------------------------------------------------------
// Shared application step
// ---------------------------------------------------------------------------

// Apply converts an integer minor-unit amount using a rate, rescaling between
// the two currencies' minor-unit exponents.
//
// The sequence is: minor units → major units → apply rate → target major units
// → target minor units, rounded half away from zero exactly once at the end.
// Rescaling matters as much as the rate: converting ¥10,000 (1,000,000 with a
// naive 2-decimal assumption) to USD is off by a hundredfold if the exponents
// are ignored, which no plausible rate would make obvious.
func Apply(minor int64, rate float64, fromDecimals, toDecimals int) int64 {
	fromScale := float64(money.Scale(fromDecimals))
	toScale := float64(money.Scale(toDecimals))

	major := float64(minor) / fromScale
	converted := major * rate * toScale

	// Round half away from zero, matching money.DivRound, so a converted
	// refund mirrors a converted sale.
	if converted >= 0 {
		return int64(converted + 0.5)
	}
	return -int64(-converted + 0.5)
}
