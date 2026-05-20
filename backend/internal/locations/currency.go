// Package locations provides helpers shared across handlers that need to
// resolve per-store metadata (tax, currency, …) without a full database round-
// trip on every request.
package locations

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Currency result type
// ---------------------------------------------------------------------------

// Currency holds the resolved ISO-4217 currency information for a location.
type Currency struct {
	Code     string // e.g. "ZAR"
	Symbol   string // e.g. "R"
	Decimals int    // e.g. 2
}

// ---------------------------------------------------------------------------
// In-process cache (5-min TTL, sync.Map)
// ---------------------------------------------------------------------------

type currencyCacheEntry struct {
	currency  Currency
	expiresAt time.Time
}

var (
	currencyCache    sync.Map // key: locationID (string) → currencyCacheEntry
	currencyCacheTTL = 5 * time.Minute
)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// CurrencyFor returns the effective ISO-4217 currency for the given location.
//
// Fallback chain:
//  1. locations.currency_code (direct column on the location row).
//  2. regions.currency (via locations.region_id) — for legacy rows that have
//     no currency_code set.
//  3. Hard-coded "ZAR" / "R" / 2 — logged once so ops can investigate.
func CurrencyFor(ctx context.Context, pool *pgxpool.Pool, locationID string) (Currency, error) {
	// --- Cache lookup ---
	if v, ok := currencyCache.Load(locationID); ok {
		if entry, ok := v.(currencyCacheEntry); ok && time.Now().Before(entry.expiresAt) {
			return entry.currency, nil
		}
	}

	cur, err := fetchCurrency(ctx, pool, locationID)
	if err != nil {
		return Currency{}, err
	}

	// --- Cache store ---
	currencyCache.Store(locationID, currencyCacheEntry{
		currency:  cur,
		expiresAt: time.Now().Add(currencyCacheTTL),
	})

	return cur, nil
}

// ---------------------------------------------------------------------------
// Internal fetch (no cache)
// ---------------------------------------------------------------------------

// fetchCurrency queries the DB for currency info without touching the cache.
// Exported as a package-level variable so tests can swap it out.
var fetchCurrency = func(ctx context.Context, pool *pgxpool.Pool, locationID string) (Currency, error) {
	return fetchCurrencyFromDB(ctx, pool, locationID)
}

func fetchCurrencyFromDB(ctx context.Context, pool *pgxpool.Pool, locationID string) (Currency, error) {
	// --- Step 1: locations.currency_code → JOIN currencies ---
	var code, symbol string
	var decimals int

	err := pool.QueryRow(ctx, `
		SELECT c.code, c.symbol, c.decimal_digits
		FROM locations l
		JOIN currencies c ON c.code = l.currency_code
		WHERE l.id = $1
	`, locationID).Scan(&code, &symbol, &decimals)
	if err == nil {
		return Currency{Code: code, Symbol: symbol, Decimals: decimals}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Currency{}, err
	}

	// --- Step 2: regions.currency → JOIN currencies ---
	err = pool.QueryRow(ctx, `
		SELECT c.code, c.symbol, c.decimal_digits
		FROM locations l
		JOIN regions r ON r.id = l.region_id
		JOIN currencies c ON c.code = r.currency
		WHERE l.id = $1
	`, locationID).Scan(&code, &symbol, &decimals)
	if err == nil {
		return Currency{Code: code, Symbol: symbol, Decimals: decimals}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Currency{}, err
	}

	// --- Step 3: hard-coded fallback ---
	log.Printf("locations.CurrencyFor: no currency found for location %s — defaulting to ZAR", locationID)
	return Currency{Code: "ZAR", Symbol: "R", Decimals: 2}, nil
}
