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

	"github.com/beepbite/backend/internal/db"
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
//  2. The zero Currency — empty code, empty symbol, 2 decimals — logged so ops
//     can investigate.
//
// Tier 2 used to be a hard-coded ZAR/R/2. That default was invisible in South
// Africa and catastrophic anywhere else: a location whose currency had not been
// configured would price, charge, print and report in rand without anything on
// screen saying so. An empty code instead renders as a bare number
// (money.Format declines to invent a symbol), which is unmistakably an
// unfinished setup rather than a confident lie.
//
// Prefer SettingsFor, which resolves currency alongside timezone, locale and
// tax in a single query. CurrencyFor remains for callers that need only the
// currency.
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

// fetchCurrencyFromDB queries the DB for currency info without touching the cache.
// Both queries use db.Scoped with ServiceRoleScope to bypass FORCE-RLS on
// locations (no app.current_org_id is set on a fresh pooled connection, which
// would silently block every row). The lookup is keyed to a location_id the
// caller is already authorised for, so this does not widen the security boundary.
func fetchCurrencyFromDB(ctx context.Context, pool *pgxpool.Pool, locationID string) (Currency, error) {
	// --- Step 1: locations.currency_code → JOIN currencies ---
	var code, symbol string
	var decimals int

	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT c.code, c.symbol, c.decimal_digits
			FROM locations l
			JOIN currencies c ON c.code = l.currency_code
			WHERE l.id = $1
		`, locationID).Scan(&code, &symbol, &decimals)
	})
	if err == nil {
		return Currency{Code: code, Symbol: symbol, Decimals: decimals}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Currency{}, err
	}

	// --- Step 2: neutral fallback ---
	// Decimals stays 2 because it is the ISO 4217 majority and only affects how
	// an already-unusable amount is split; Code and Symbol stay empty so nothing
	// downstream can claim to know which currency this is.
	log.Printf("locations.CurrencyFor: no currency configured for location %s — "+
		"amounts will render without a currency until locations.currency_code is set", locationID)
	return Currency{Decimals: 2}, nil
}
