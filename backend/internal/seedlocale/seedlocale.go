// Package seedlocale supplies the country-dependent settings that seed and demo
// data need, read from the environment rather than baked into the seeders.
//
// # Why this exists
//
// The seeders used to describe one specific restaurant in Cape Town: prices in
// rand, +27 phone numbers, .co.za addresses, 15% inclusive VAT written as the
// literal expression `total * 15 / 115`. That made every seeded database a
// South African database, and — more quietly — it made the seed data useless as
// a test of the multi-currency code, because nothing in it ever exercised a
// currency with a different exponent or a tax computed the other way round.
//
// The fix is not to move the restaurant to Chicago. Swapping ZAR for USD and
// 15%-inclusive for 8.875%-exclusive produces exactly the same class of bug
// with a different flag on it, and it would still be a single hardcoded
// jurisdiction that the rest of the suite silently assumes.
//
// So the locale is configuration, and the defaults are deliberately fictional:
// a demo database should look obviously like a demo, and a developer who has
// not chosen a country should be able to see at a glance that no country was
// chosen for them.
//
// # The defaults are placeholders, on purpose
//
//	SEED_COUNTRY       ZZ      ISO 3166-1 user-assigned code meaning "unknown"
//	SEED_CURRENCY      XTS     ISO 4217 code reserved for testing; never real money
//	SEED_TIMEZONE      UTC     neutral, and what migration 056 defaults locations to
//	SEED_LOCALE        (empty) CLDR root formatting, which belongs to no country
//	SEED_TAX_RATE      10.00   a round, invented rate; not any jurisdiction's
//	SEED_TAX_INCLUSIVE true    matches the schema default
//	SEED_TAX_LABEL     Tax     a generic word, not "VAT" or "Sales Tax"
//	SEED_PHONE_CC      999     E.164 code reserved by the ITU; unroutable by design
//
// XTS and 999 are the load-bearing ones. Both are reserved by their respective
// standards precisely so that test data can be recognised as test data: an XTS
// amount can never be confused with real takings, and a +999 number can never
// be dialled, so demo data cannot text a stranger. A default of USD and +1
// would be indistinguishable from production data in a screenshot, a support
// ticket, or a database someone forgot was seeded.
//
// The tax rate is the one non-reserved default. Zero would be more neutral, but
// it would also mean the seed data never exercises the tax path at all, which
// is one of the things seed data is for. 10% is round enough to read as
// invented, and both the rate and the inclusive/exclusive convention are knobs.
//
// # Prices
//
// Seed prices are authored as integers in a 2-decimal reference scale — 4500
// means "forty-five and a half units" — and converted with Price, which
// rescales to the configured currency's actual exponent. Seeding JPY therefore
// produces ¥45, not ¥4,500, and KWD produces KD 4.500. Authors write one number
// and the exponent stays the currency's property, never a literal 100.
package seedlocale

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/beepbite/backend/internal/money"
	"github.com/beepbite/backend/internal/tax"
)

// Placeholder defaults. See the package doc for why each one is what it is.
const (
	DefaultCountry      = "ZZ"
	DefaultCurrency     = "XTS"
	DefaultTimezone     = "UTC"
	DefaultLocale       = ""
	DefaultTaxRate      = 10.00
	DefaultTaxInclusive = true
	DefaultTaxLabel     = "Tax"
	DefaultPhoneCC      = "999"
)

// authoringDecimals is the scale seed prices are written in. It is a property
// of how the seeders are *authored*, not of any currency, which is why it is a
// constant here and never leaks into application code.
const authoringDecimals = 2

// zeroDecimalCurrencies and threeDecimalCurrencies mirror the exponents loaded
// by migration 056. They exist so a seeder can compute a correct price before it
// has a database connection to ask; SEED_CURRENCY_DECIMALS overrides them, and
// anything unlisted is assumed to have the ISO-typical 2.
var (
	zeroDecimalCurrencies = map[string]bool{
		"JPY": true, "KRW": true, "ISK": true, "CLP": true, "VND": true,
		"UGX": true, "RWF": true, "XOF": true, "XAF": true,
	}
	threeDecimalCurrencies = map[string]bool{
		"KWD": true, "BHD": true, "OMR": true, "JOD": true, "TND": true,
	}
)

// Config is the resolved locale posture for a seeding run.
type Config struct {
	// Country is the ISO 3166-1 alpha-2 code. Migration 056 constrains the
	// locations.country column to ^[A-Z]{2}$, so this is always upper-cased.
	Country string

	// Currency is the ISO 4217 code and Decimals its minor-unit exponent.
	// Decimals is what must be used in place of any literal 100.
	Currency string
	Decimals int

	// Timezone is an IANA name; it defines the seeded location's trading day.
	Timezone string

	// Locale is a BCP-47 tag for presentation only. Empty means CLDR root.
	Locale string

	// Tax is the rate, convention and receipt label to apply to seeded orders.
	Tax tax.Config

	// PhoneCC is the E.164 dial code, without the "+", that seeded phone
	// numbers are built from.
	PhoneCC string
}

// Load reads the SEED_* environment variables, falling back to the placeholder
// defaults. It returns an error only for input it cannot interpret — an
// unparseable tax rate is a typo worth stopping for, since silently seeding 0%
// would look like it worked.
func Load() (Config, error) {
	c := Config{
		Country:  strings.ToUpper(envOr("SEED_COUNTRY", DefaultCountry)),
		Currency: strings.ToUpper(envOr("SEED_CURRENCY", DefaultCurrency)),
		Timezone: envOr("SEED_TIMEZONE", DefaultTimezone),
		// Locale is the one setting where an explicitly empty value is a real
		// choice — "format with CLDR root, belonging to no country" — so it
		// uses envOrEmpty rather than falling back.
		Locale:  envOrEmpty("SEED_LOCALE", DefaultLocale),
		PhoneCC: strings.TrimPrefix(envOr("SEED_PHONE_CC", DefaultPhoneCC), "+"),
	}

	if len(c.Country) != 2 {
		return Config{}, fmt.Errorf("seedlocale: SEED_COUNTRY %q must be a 2-letter ISO 3166-1 code", c.Country)
	}

	dec, err := envInt("SEED_CURRENCY_DECIMALS", defaultDecimalsFor(c.Currency))
	if err != nil {
		return Config{}, err
	}
	if dec < 0 || dec > money.MaxDecimals {
		return Config{}, fmt.Errorf("seedlocale: SEED_CURRENCY_DECIMALS %d out of range 0..%d", dec, money.MaxDecimals)
	}
	c.Decimals = dec

	rate, err := envFloat("SEED_TAX_RATE", DefaultTaxRate)
	if err != nil {
		return Config{}, err
	}
	inclusive, err := envBool("SEED_TAX_INCLUSIVE", DefaultTaxInclusive)
	if err != nil {
		return Config{}, err
	}
	c.Tax = tax.Config{
		Rate:      tax.RateFromPercent(rate),
		Inclusive: inclusive,
		Label:     envOr("SEED_TAX_LABEL", DefaultTaxLabel),
	}

	return c, nil
}

// MustLoad is Load for seeder main functions, which have no useful way to
// continue with a broken locale.
func MustLoad() Config {
	c, err := Load()
	if err != nil {
		panic(err)
	}
	return c
}

// TaxRatePercent is the rate as the decimal(5,2) percentage the orders and
// locations tables store, e.g. 10.00.
func (c Config) TaxRatePercent() float64 { return c.Tax.Rate.Percent() }

// TaxInclusive reports the convention seeded orders were priced under.
func (c Config) TaxInclusive() bool { return c.Tax.Inclusive }

// Price converts a seed price authored in the 2-decimal reference scale into
// the configured currency's minor units.
//
// Use it for every monetary literal in a seeder. Writing the literal directly
// would make the seeded amounts silently wrong for any currency whose exponent
// is not 2 — the exact bug that makes ¥4,500 out of a ¥45 lunch.
func (c Config) Price(referenceMinor int64) int64 {
	return money.Rescale(referenceMinor, authoringDecimals, c.Decimals)
}

// Tax computes the tax on an amount under the configured rate and convention,
// returning net, tax and gross as exact integers.
//
// This replaces the hand-written `total * 15 / 115` that appeared throughout the
// seeders. That expression hardcoded both the rate and the inclusive
// convention, and being float arithmetic it disagreed with the integer tax
// engine by a cent often enough to make seeded orders fail their own totals
// check.
func (c Config) TaxOn(amount int64) tax.Result { return c.Tax.Compute(amount) }

// Format renders a minor-unit amount in the configured currency and locale.
// Seeders use it for log output, so an operator can see at a glance which
// currency their demo database ended up in.
func (c Config) Format(minor int64) string {
	return money.Format(minor, c.Currency, c.Decimals, c.Locale)
}

// EnsureCurrencySQL returns a statement and arguments that make the configured
// currency exist in the currencies table.
//
// Every currency column is a foreign key to that table, and the default XTS is
// deliberately not one of the real currencies migration 056 loads — so a seeder
// must register it before inserting anything priced in it. Running this first is
// also what lets an operator seed in a currency the migrations do not ship,
// without editing a migration to do it.
//
// It is an upsert, so it is safe to run on every seed and never overwrites a
// real currency's name or symbol with a placeholder.
func (c Config) EnsureCurrencySQL() (string, []any) {
	const q = `
		INSERT INTO currencies (code, name, symbol, decimal_digits, is_active)
		VALUES ($1, $2, $3, $4, true)
		ON CONFLICT (code) DO UPDATE
			SET decimal_digits = EXCLUDED.decimal_digits,
			    is_active      = true`
	name, symbol := c.Currency, c.Currency
	if c.Currency == DefaultCurrency {
		name, symbol = "Test Currency (placeholder)", "¤"
	}
	return q, []any{c.Currency, name, symbol, c.Decimals}
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

// reservedSubscriberPrefix is the leading digit group every seeded subscriber
// number carries.
//
// Combined with the default dial code 999 — reserved by ITU-T E.164 and
// assigned to no country — this makes seeded numbers unroutable by
// construction. That matters more than it sounds: demo data gets loaded into
// staging environments wired to real WhatsApp credentials, and a seeded number
// that happens to belong to a real person receives real messages about an order
// that does not exist. A number that cannot be dialled cannot do that.
//
// When an operator overrides SEED_PHONE_CC to a live country code, this prefix
// keeps the numbers inside a range that looks obviously synthetic, but it can no
// longer guarantee they are unassigned — which is a reason to leave the default
// alone unless the seeded numbers genuinely need to be dialled.
const reservedSubscriberPrefix = "5550"

// Phone builds a deterministic, obviously-synthetic E.164 number for seed data.
//
// seq distinguishes one seeded contact from another; the same seq always yields
// the same number, so re-running a seeder is idempotent against ON CONFLICT
// clauses keyed on the phone.
func (c Config) Phone(seq int) string {
	if seq < 0 {
		seq = -seq
	}
	return fmt.Sprintf("+%s%s%06d", c.PhoneCC, reservedSubscriberPrefix, seq%1_000_000)
}

// PhoneLike is the SQL LIKE pattern matching every number Phone produces.
//
// The seed scripts count their own rows with it. Hardcoding '+27%1234%' there
// meant the self-check silently returned zero the moment the dial code changed
// — a verification step that reports success by finding nothing is worse than
// no verification at all, so the predicate has to follow the configuration.
func (c Config) PhoneLike() string {
	return "+" + c.PhoneCC + reservedSubscriberPrefix + "%"
}

// ---------------------------------------------------------------------------
// Placeholder identity
// ---------------------------------------------------------------------------

// EmailDomain is the domain for seeded email addresses. RFC 2606 reserves
// example.com for exactly this: it can never be registered, so seeded mail can
// never leave the building.
const EmailDomain = "example.com"

// Email builds a seeded address in the reserved domain.
func (c Config) Email(local string) string {
	return strings.ToLower(local) + "@" + EmailDomain
}

// ---------------------------------------------------------------------------
// env helpers
// ---------------------------------------------------------------------------

// envOr returns the trimmed variable, falling back when it is unset OR set but
// empty. Empty is treated as absent because `SEED_COUNTRY=` in a .env file or a
// CI matrix that leaves a cell blank means "I did not choose one", not "seed a
// location with no country" — and the latter would fail a CHECK constraint far
// from the place the blank was written.
func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// envOrEmpty distinguishes unset from set-and-empty, for the one setting where
// empty is a meaningful value rather than a missing one.
func envOrEmpty(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return strings.TrimSpace(v)
	}
	return fallback
}

func envInt(key string, fallback int) (int, error) {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil {
		return 0, fmt.Errorf("seedlocale: %s=%q is not an integer", key, v)
	}
	return n, nil
}

func envFloat(key string, fallback float64) (float64, error) {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback, nil
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil {
		return 0, fmt.Errorf("seedlocale: %s=%q is not a number", key, v)
	}
	return f, nil
}

func envBool(key string, fallback bool) (bool, error) {
	v, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(v) == "" {
		return fallback, nil
	}
	b, err := strconv.ParseBool(strings.TrimSpace(v))
	if err != nil {
		return false, fmt.Errorf("seedlocale: %s=%q is not a boolean", key, v)
	}
	return b, nil
}

func defaultDecimalsFor(code string) int {
	switch {
	case zeroDecimalCurrencies[code]:
		return 0
	case threeDecimalCurrencies[code]:
		return 3
	default:
		// Covers XTS and every ISO-typical currency. A currency whose real
		// exponent differs is handled by SEED_CURRENCY_DECIMALS rather than by
		// growing this table indefinitely.
		return authoringDecimals
	}
}
