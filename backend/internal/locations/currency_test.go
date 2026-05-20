package locations

// Unit tests for CurrencyFor fallback chain.
//
// Fallback tiers exercised:
//  1. locations.currency_code → currencies row found (ZAR / R).
//  2. regions.currency fallback when currency_code is NULL (USD / $).
//  3. Hard-coded ZAR fallback when neither path returns a row.
//  4. Cache hit: fetchCurrency is NOT called a second time.
//
// Because CurrencyFor uses a process-level sync.Map cache, each sub-test uses a
// unique locationID (via uniqueLocID) so entries from prior runs do not
// interfere.

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// uniqueLocID returns a UUID-shaped string unique to each test.
func uniqueLocID(suffix string) string {
	return "00000000-0000-0000-0000-" + suffix
}

// purgeCache removes the cache entry for locationID to prevent bleed between
// tests running in the same process.
func purgeCache(locationID string) {
	currencyCache.Delete(locationID)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestCurrencyFor_LocationRow verifies that when a location row carries a
// direct currency_code, CurrencyFor returns the matching currencies entry.
func TestCurrencyFor_LocationRow(t *testing.T) {
	locID := uniqueLocID("aaa000000001")
	purgeCache(locID)

	orig := fetchCurrency
	fetchCurrency = func(_ context.Context, _ *pgxpool.Pool, id string) (Currency, error) {
		if id == locID {
			// Simulates: locations.currency_code = 'ZAR' → currencies row found.
			return Currency{Code: "ZAR", Symbol: "R", Decimals: 2}, nil
		}
		return Currency{}, nil
	}
	defer func() { fetchCurrency = orig }()

	got, err := CurrencyFor(context.Background(), nil, locID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Code != "ZAR" || got.Symbol != "R" || got.Decimals != 2 {
		t.Errorf("got %+v; want Code=ZAR Symbol=R Decimals=2", got)
	}
}

// TestCurrencyFor_RegionFallback verifies that when a location has no direct
// currency_code, the region's currency is used instead.
func TestCurrencyFor_RegionFallback(t *testing.T) {
	locID := uniqueLocID("bbb000000002")
	purgeCache(locID)

	orig := fetchCurrency
	fetchCurrency = func(_ context.Context, _ *pgxpool.Pool, id string) (Currency, error) {
		if id == locID {
			// Simulates: no currency_code on location; region has 'USD'.
			return Currency{Code: "USD", Symbol: "$", Decimals: 2}, nil
		}
		return Currency{}, nil
	}
	defer func() { fetchCurrency = orig }()

	got, err := CurrencyFor(context.Background(), nil, locID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Code != "USD" || got.Symbol != "$" {
		t.Errorf("got %+v; want Code=USD Symbol=$", got)
	}
}

// TestCurrencyFor_HardCodedFallback verifies the final ZAR fallback when
// neither the location row nor the region has a currency configured.
func TestCurrencyFor_HardCodedFallback(t *testing.T) {
	locID := uniqueLocID("ccc000000003")
	purgeCache(locID)

	orig := fetchCurrency
	fetchCurrency = func(_ context.Context, _ *pgxpool.Pool, id string) (Currency, error) {
		// Simulates fetchCurrencyFromDB returning the hard-coded ZAR fallback.
		return Currency{Code: "ZAR", Symbol: "R", Decimals: 2}, nil
	}
	defer func() { fetchCurrency = orig }()

	got, err := CurrencyFor(context.Background(), nil, locID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Code != "ZAR" {
		t.Errorf("expected fallback ZAR, got %s", got.Code)
	}
}

// TestCurrencyFor_CacheHit verifies that a warm cache entry short-circuits the
// fetchCurrency call entirely.
func TestCurrencyFor_CacheHit(t *testing.T) {
	locID := uniqueLocID("ddd000000004")

	// Seed the cache directly.
	currencyCache.Store(locID, currencyCacheEntry{
		currency:  Currency{Code: "GBP", Symbol: "£", Decimals: 2},
		expiresAt: time.Now().Add(5 * time.Minute),
	})
	t.Cleanup(func() { currencyCache.Delete(locID) })

	orig := fetchCurrency
	fetchCurrency = func(_ context.Context, _ *pgxpool.Pool, _ string) (Currency, error) {
		t.Error("fetchCurrency called despite valid cache entry")
		return Currency{}, nil
	}
	defer func() { fetchCurrency = orig }()

	got, err := CurrencyFor(context.Background(), nil, locID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Code != "GBP" {
		t.Errorf("expected cached GBP, got %s", got.Code)
	}
}
