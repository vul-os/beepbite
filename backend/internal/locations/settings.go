package locations

// settings.go resolves everything about a location that varies by country:
// which currency it charges in, how many minor units that currency has, which
// timezone its trading day follows, which locale its numbers are formatted for,
// what tax it applies and how, and which dial code its customers' phone numbers
// belong to.
//
// It exists so that no handler ever has to answer those questions itself. The
// pattern this replaces was a per-handler COALESCE chain ending in a hardcoded
// South African value — repeated in a dozen files, each one an independent
// opportunity to disagree with the others.
//
// Resolution is cached with the same 5-minute TTL as CurrencyFor and shares its
// invalidation, because these values change roughly never and are read on every
// order.

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/beepbite/backend/internal/bizday"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/money"
	"github.com/beepbite/backend/internal/tax"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Settings is a location's full locale posture.
//
// Every field has a neutral zero value. A location that has configured nothing
// gets: no currency (amounts render as bare numbers rather than in a guessed
// currency), UTC boundaries, root-locale formatting, and no tax. That is a
// visibly incomplete setup, which is the intended outcome — the alternative is
// a setup that looks finished and is wrong.
type Settings struct {
	// LocationID is the location these settings were resolved for.
	LocationID string

	// Currency is the ISO-4217 currency, including the minor-unit exponent that
	// money.Format and money.Parse need.
	Currency Currency

	// Timezone is the IANA name; Location is it resolved. Both are always set —
	// Location falls back to time.UTC rather than nil.
	Timezone string
	Location *time.Location

	// Locale is the BCP-47 tag for number and date presentation. Empty means
	// CLDR root, which belongs to no country.
	Locale string

	// Tax is the location's rate, inclusive/exclusive convention, and receipt
	// label.
	Tax tax.Config

	// Country is the ISO 3166-1 alpha-2 code, or empty.
	Country string

	// PhoneCountryCode is the E.164 dial code without the plus ("27", "1",
	// "351"), or empty when numbers must already arrive in E.164.
	PhoneCountryCode string
}

// Format renders a minor-unit amount in this location's currency and locale.
// It is the method almost every caller wants, and the reason Settings is passed
// around rather than its individual fields.
func (s Settings) Format(minor int64) string {
	return money.Format(minor, s.Currency.Code, s.Currency.Decimals, s.Locale)
}

// FormatCode is Format with the ISO code instead of the symbol, for reports
// that mix currencies.
func (s Settings) FormatCode(minor int64) string {
	return money.FormatCode(minor, s.Currency.Code, s.Currency.Decimals, s.Locale)
}

// Decimals is the minor-unit exponent for this location's currency — the value
// that must be used instead of a literal 100.
func (s Settings) Decimals() int { return s.Currency.Decimals }

// Zone returns the location's timezone, never nil.
func (s Settings) Zone() *time.Location {
	if s.Location == nil {
		return time.UTC
	}
	return s.Location
}

// DayBounds returns the half-open [start, end) instants of the local trading
// day containing t — the interval every "today" query should filter on.
func (s Settings) DayBounds(t time.Time) (start, end time.Time) {
	return bizday.Bounds(t, s.Zone())
}

// Today returns the current local trading date as "2006-01-02".
func (s Settings) Today() string { return bizday.Date(time.Now(), s.Zone()) }

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type settingsCacheEntry struct {
	settings  Settings
	expiresAt time.Time
}

var settingsCache sync.Map // locationID → settingsCacheEntry

// SettingsFor resolves and caches a location's locale settings.
//
// Unlike CurrencyFor, a missing location row is not papered over with a default
// country: the returned Settings are the neutral zero values and the caller can
// tell (Currency.Code == "") that nothing was configured.
func SettingsFor(ctx context.Context, pool *pgxpool.Pool, locationID string) (Settings, error) {
	if locationID == "" {
		return neutralSettings(""), nil
	}
	if v, ok := settingsCache.Load(locationID); ok {
		if entry, ok := v.(settingsCacheEntry); ok && time.Now().Before(entry.expiresAt) {
			return entry.settings, nil
		}
	}

	s, err := fetchSettings(ctx, pool, locationID)
	if err != nil {
		return Settings{}, err
	}

	settingsCache.Store(locationID, settingsCacheEntry{
		settings:  s,
		expiresAt: time.Now().Add(currencyCacheTTL),
	})
	return s, nil
}

// InvalidateSettings drops the cached settings for a location. Call it after
// writing location settings so an operator who changes their timezone or tax
// rate sees the effect on the next order rather than up to five minutes later.
func InvalidateSettings(locationID string) {
	settingsCache.Delete(locationID)
	currencyCache.Delete(locationID)
}

// fetchSettings is a package-level var so tests can substitute it, matching the
// fetchCurrency pattern above.
var fetchSettings = func(ctx context.Context, pool *pgxpool.Pool, locationID string) (Settings, error) {
	return fetchSettingsFromDB(ctx, pool, locationID)
}

// fetchSettingsFromDB reads the location row and its currency in one join.
//
// It uses ServiceRoleScope for the same reason fetchCurrencyFromDB does: FORCE
// RLS on locations would otherwise block the read on a fresh pooled connection
// that has no app.current_org_id set. The caller is already authorised for this
// location_id, so this does not widen the security boundary.
func fetchSettingsFromDB(ctx context.Context, pool *pgxpool.Pool, locationID string) (Settings, error) {
	var (
		code, symbol      *string
		decimals          *int
		timezone          string
		locale, country   *string
		phoneCC, taxLabel *string
		taxRate           float64
		taxInclusive      bool
	)

	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT c.code, c.symbol, c.decimal_digits,
			       COALESCE(l.timezone, 'UTC'),
			       l.locale, l.country, l.phone_country_code,
			       l.tax_rate, l.tax_inclusive, l.tax_label
			FROM locations l
			LEFT JOIN currencies c ON c.code = l.currency_code
			WHERE l.id = $1
		`, locationID).Scan(
			&code, &symbol, &decimals,
			&timezone,
			&locale, &country, &phoneCC,
			&taxRate, &taxInclusive, &taxLabel,
		)
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No such location. Return neutral settings rather than a country:
			// a caller formatting against these gets bare numbers and UTC days,
			// which is obviously unconfigured instead of subtly wrong.
			return neutralSettings(locationID), nil
		}
		return Settings{}, err
	}

	s := neutralSettings(locationID)
	if code != nil {
		s.Currency = Currency{Code: *code, Decimals: 2}
		if symbol != nil {
			s.Currency.Symbol = *symbol
		}
		if decimals != nil {
			s.Currency.Decimals = *decimals
		}
	}
	s.Timezone = timezone
	s.Location = bizday.Zone(timezone)
	s.Locale = deref(locale)
	s.Country = strings.ToUpper(deref(country))
	s.PhoneCountryCode = strings.TrimPrefix(deref(phoneCC), "+")
	s.Tax = tax.Config{
		Rate:      tax.RateFromPercent(taxRate),
		Inclusive: taxInclusive,
		Label:     deref(taxLabel),
	}
	return s, nil
}

// neutralSettings is the country-free baseline: no currency, UTC, root locale,
// no tax. It is what an unconfigured or unknown location resolves to.
func neutralSettings(locationID string) Settings {
	return Settings{
		LocationID: locationID,
		Timezone:   bizday.UTC,
		Location:   time.UTC,
	}
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return strings.TrimSpace(*p)
}
