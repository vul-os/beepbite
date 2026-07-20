package locations_test

// Integration tests for locations.SettingsFor against a real, migrated Postgres.
//
// The unit tests elsewhere stub the DB layer, which proves the resolution logic
// but not that the SQL matches the schema. These tests seed three genuinely
// different locations — Tokyo (JPY, 0 decimals, tax-inclusive, UTC+9), Kuwait
// (KWD, 3 decimals, no tax, UTC+3) and New York (USD, 2 decimals,
// tax-EXCLUSIVE, UTC-5/-4 with DST) — and assert that everything a handler
// needs comes back correctly for each.
//
// Three currencies with three different minor-unit exponents is the point: a
// single-currency fixture cannot catch a hardcoded /100, which is why the bug
// survived so long.
//
// Prerequisites: Docker (testcontainers) or TEST_DATABASE_URL / DATABASE_URL.
//
// Run:
//
//	cd backend && go test ./internal/locations/ -run Integration -v

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/locations"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping locations integration tests:", err)
		os.Exit(0)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "testenv.StartPostgres: %v\n", err)
		os.Exit(1)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type locFixture struct {
	name         string
	country      string
	currency     string
	timezone     string
	locale       string
	taxRate      float64
	taxInclusive bool
	taxLabel     string
	phoneCC      string
}

func seedOrg(t *testing.T, ctx context.Context) string {
	t.Helper()
	var orgID string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			fmt.Sprintf("locale-test-%d", time.Now().UnixNano()),
		).Scan(&orgID)
	})
	if err != nil {
		t.Fatalf("seedOrg: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Scoped(context.Background(), testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, e := tx.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
			return e
		})
	})
	return orgID
}

func seedLocation(t *testing.T, ctx context.Context, orgID string, f locFixture) string {
	t.Helper()
	var locID string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO locations (
				organization_id, name, country, currency_code, timezone, locale,
				tax_rate, tax_inclusive, tax_label, phone_country_code,
				on_delivery_payment_methods
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, ARRAY['cash']::text[])
			RETURNING id`,
			orgID, f.name, f.country, f.currency, f.timezone, f.locale,
			f.taxRate, f.taxInclusive, f.taxLabel, f.phoneCC,
		).Scan(&locID)
	})
	if err != nil {
		t.Fatalf("seedLocation(%s): %v", f.name, err)
	}
	t.Cleanup(func() { locations.InvalidateSettings(locID) })
	return locID
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestIntegrationSettingsFor_ThreeCountries(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx)

	fixtures := []struct {
		fixture      locFixture
		wantDecimals int
		// A representative amount in minor units, and what it should read as.
		minor         int64
		wantFormatted string
	}{
		{
			// Zero-decimal currency. 1000 minor units IS ¥1,000 — a /100 here
			// renders it as ¥10.
			fixture: locFixture{
				name: "Tokyo", country: "JP", currency: "JPY",
				timezone: "Asia/Tokyo", locale: "ja-JP",
				taxRate: 10.00, taxInclusive: true, taxLabel: "消費税", phoneCC: "81",
			},
			wantDecimals: 0, minor: 1000, wantFormatted: "1,000",
		},
		{
			// Three-decimal currency. 1000 minor units is KD 1.000, not KD 10.00.
			fixture: locFixture{
				name: "Kuwait City", country: "KW", currency: "KWD",
				timezone: "Asia/Kuwait", locale: "ar-KW",
				taxRate: 0.00, taxInclusive: false, taxLabel: "", phoneCC: "965",
			},
			wantDecimals: 3, minor: 1000, wantFormatted: "1.000",
		},
		{
			// Two-decimal, tax-EXCLUSIVE — the convention opposite to the one
			// the codebase used to hardcode.
			fixture: locFixture{
				name: "New York", country: "US", currency: "USD",
				timezone: "America/New_York", locale: "en-US",
				taxRate: 8.88, taxInclusive: false, taxLabel: "Sales Tax", phoneCC: "1",
			},
			wantDecimals: 2, minor: 1000, wantFormatted: "10.00",
		},
	}

	for _, tc := range fixtures {
		t.Run(tc.fixture.name, func(t *testing.T) {
			locID := seedLocation(t, ctx, orgID, tc.fixture)

			s, err := locations.SettingsFor(ctx, testPool, locID)
			if err != nil {
				t.Fatalf("SettingsFor: %v", err)
			}

			if s.Currency.Code != tc.fixture.currency {
				t.Errorf("currency = %q, want %q", s.Currency.Code, tc.fixture.currency)
			}
			if s.Currency.Decimals != tc.wantDecimals {
				t.Errorf("decimals = %d, want %d — the exponent must come from the currencies table",
					s.Currency.Decimals, tc.wantDecimals)
			}
			if got := s.Format(tc.minor); !containsStr(got, tc.wantFormatted) {
				t.Errorf("Format(%d) = %q, want it to contain %q",
					tc.minor, got, tc.wantFormatted)
			}
			if s.Timezone != tc.fixture.timezone {
				t.Errorf("timezone = %q, want %q", s.Timezone, tc.fixture.timezone)
			}
			if s.Zone().String() != tc.fixture.timezone {
				t.Errorf("resolved zone = %q, want %q", s.Zone(), tc.fixture.timezone)
			}
			if s.Locale != tc.fixture.locale {
				t.Errorf("locale = %q, want %q", s.Locale, tc.fixture.locale)
			}
			if s.Country != tc.fixture.country {
				t.Errorf("country = %q, want %q", s.Country, tc.fixture.country)
			}
			if s.PhoneCountryCode != tc.fixture.phoneCC {
				t.Errorf("phone country code = %q, want %q", s.PhoneCountryCode, tc.fixture.phoneCC)
			}
			if got := s.Tax.Rate.Percent(); got != tc.fixture.taxRate {
				t.Errorf("tax rate = %v, want %v", got, tc.fixture.taxRate)
			}
			if s.Tax.Inclusive != tc.fixture.taxInclusive {
				t.Errorf("tax inclusive = %v, want %v", s.Tax.Inclusive, tc.fixture.taxInclusive)
			}
		})
	}
}

// TestIntegrationSettingsFor_TaxConventionsDiffer checks end to end, through
// real rows, that the two conventions produce different money.
func TestIntegrationSettingsFor_TaxConventionsDiffer(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx)

	incID := seedLocation(t, ctx, orgID, locFixture{
		name: "Lisbon", country: "PT", currency: "EUR",
		timezone: "Europe/Lisbon", locale: "pt-PT",
		taxRate: 23.00, taxInclusive: true, taxLabel: "IVA", phoneCC: "351",
	})
	excID := seedLocation(t, ctx, orgID, locFixture{
		name: "Seattle", country: "US", currency: "USD",
		timezone: "America/Los_Angeles", locale: "en-US",
		taxRate: 23.00, taxInclusive: false, taxLabel: "Sales Tax", phoneCC: "1",
	})

	incS, err := locations.SettingsFor(ctx, testPool, incID)
	if err != nil {
		t.Fatalf("SettingsFor(inclusive): %v", err)
	}
	excS, err := locations.SettingsFor(ctx, testPool, excID)
	if err != nil {
		t.Fatalf("SettingsFor(exclusive): %v", err)
	}

	const subtotal int64 = 12300

	inc := incS.Tax.Compute(subtotal)
	exc := excS.Tax.Compute(subtotal)

	if inc.Gross != subtotal {
		t.Errorf("inclusive gross = %d, want %d — the shelf price IS the price", inc.Gross, subtotal)
	}
	if exc.Gross <= subtotal {
		t.Errorf("exclusive gross = %d, want more than %d — tax is added at the register", exc.Gross, subtotal)
	}
	if inc.Gross == exc.Gross {
		t.Fatal("the same rate produced the same total under both conventions — " +
			"tax_inclusive is not reaching the computation")
	}
	if incS.Tax.EffectiveLabel() != "IVA" || excS.Tax.EffectiveLabel() != "Sales Tax" {
		t.Errorf("labels = %q / %q; each receipt must name its own tax",
			incS.Tax.EffectiveLabel(), excS.Tax.EffectiveLabel())
	}
}

// TestIntegrationSettingsFor_TradingDaysDiffer checks that two locations
// resolve to genuinely different calendar days at the same instant.
func TestIntegrationSettingsFor_TradingDaysDiffer(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx)

	tokyoID := seedLocation(t, ctx, orgID, locFixture{
		name: "Tokyo Branch", country: "JP", currency: "JPY",
		timezone: "Asia/Tokyo", locale: "ja-JP", phoneCC: "81",
	})
	laID := seedLocation(t, ctx, orgID, locFixture{
		name: "LA Branch", country: "US", currency: "USD",
		timezone: "America/Los_Angeles", locale: "en-US", phoneCC: "1",
	})

	tokyo, err := locations.SettingsFor(ctx, testPool, tokyoID)
	if err != nil {
		t.Fatalf("SettingsFor(tokyo): %v", err)
	}
	la, err := locations.SettingsFor(ctx, testPool, laID)
	if err != nil {
		t.Fatalf("SettingsFor(la): %v", err)
	}

	// 02:00 UTC on the 21st: 11:00 on the 21st in Tokyo, 19:00 on the 20th in
	// Los Angeles. One instant, two trading days — which is exactly what a
	// single UTC day boundary cannot express.
	instant := time.Date(2026, 7, 21, 2, 0, 0, 0, time.UTC)

	tStart, _ := tokyo.DayBounds(instant)
	lStart, _ := la.DayBounds(instant)

	tDay := tStart.In(tokyo.Zone()).Format("2006-01-02")
	lDay := lStart.In(la.Zone()).Format("2006-01-02")

	if tDay != "2026-07-21" {
		t.Errorf("Tokyo trading day = %s, want 2026-07-21", tDay)
	}
	if lDay != "2026-07-20" {
		t.Errorf("LA trading day = %s, want 2026-07-20 — 19:00 is mid-service, not tomorrow", lDay)
	}
	if tDay == lDay {
		t.Fatal("both locations resolved to the same trading day; the timezone is not being applied")
	}
}

// TestIntegrationSettingsFor_UnconfiguredIsNeutral is the regression guard for
// the whole exercise: a location with nothing set must resolve to no country.
func TestIntegrationSettingsFor_UnconfiguredIsNeutral(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, ctx)

	var locID string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Only the NOT NULL columns — everything locale-related left to default.
		return tx.QueryRow(ctx, `
			INSERT INTO locations (organization_id, name, on_delivery_payment_methods)
			VALUES ($1, 'Unconfigured', ARRAY['cash']::text[])
			RETURNING id`, orgID).Scan(&locID)
	})
	if err != nil {
		t.Fatalf("seed bare location: %v", err)
	}
	t.Cleanup(func() { locations.InvalidateSettings(locID) })

	s, err := locations.SettingsFor(ctx, testPool, locID)
	if err != nil {
		t.Fatalf("SettingsFor: %v", err)
	}

	if s.Currency.Code != "" {
		t.Errorf("currency = %q; an unconfigured location must resolve to NO currency, "+
			"not to a default country's", s.Currency.Code)
	}
	if s.Timezone != "UTC" {
		t.Errorf("timezone = %q, want UTC (neutral, and the behaviour that predated the column)", s.Timezone)
	}
	if s.Locale != "" {
		t.Errorf("locale = %q, want empty (CLDR root belongs to no country)", s.Locale)
	}
	if s.Tax.Rate != 0 {
		t.Errorf("tax rate = %v, want 0; inventing a rate for an operator is an overcharge", s.Tax.Rate)
	}
	if s.PhoneCountryCode != "" {
		t.Errorf("phone country code = %q, want empty; guessing a country creates duplicate customers", s.PhoneCountryCode)
	}
	// And specifically: none of the old South African defaults.
	if s.Currency.Code == "ZAR" || s.Timezone == "Africa/Johannesburg" ||
		s.Locale == "en-ZA" || s.PhoneCountryCode == "27" {
		t.Error("an unconfigured location resolved to a South African default")
	}
	// Formatting an amount must produce a bare number, not a guessed symbol.
	if got := s.Format(1250); containsStr(got, "R") || containsStr(got, "$") {
		t.Errorf("Format(1250) = %q; with no currency it must render a bare number", got)
	}
}

func TestIntegrationSettingsFor_UnknownLocationIsNeutral(t *testing.T) {
	ctx := context.Background()
	s, err := locations.SettingsFor(ctx, testPool, "00000000-0000-0000-0000-000000000000")
	if err != nil {
		t.Fatalf("SettingsFor on an unknown id should not error: %v", err)
	}
	if s.Currency.Code != "" || s.Timezone != "UTC" {
		t.Errorf("unknown location resolved to %+v; want neutral settings", s)
	}
}

func containsStr(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0)
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
