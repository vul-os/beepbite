package pos

// tax.go resolves the tax posture of a location: the rate, and — just as
// importantly — whether menu prices already contain it.
//
// The previous version resolved only a rate, and did so through a fallback
// chain whose middle tier queried a `regions` table that does not exist in the
// current schema (it lives only in migrations/legacy). A missing table raises
// an error that is not pgx.ErrNoRows, so instead of falling through to the 0%
// default, any location without an explicit tax_rates row failed the whole
// checkout. That branch is gone.

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/tax"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Per-process tax cache
// ---------------------------------------------------------------------------

type taxCacheEntry struct {
	config    tax.Config
	expiresAt time.Time
}

var (
	taxCacheMu  sync.Mutex
	taxCache    = make(map[string]taxCacheEntry)
	taxCacheTTL = 5 * time.Minute
	warnedNoTax sync.Map // locationID → struct{}: warn once per location
)

// TaxConfigFor returns the effective tax configuration for a location: the
// rate, the inclusive/exclusive convention, and the receipt label.
//
// Resolution order:
//
//  1. The first active row in tax_rates for the location, which carries its own
//     rate, is_inclusive and name. This is the path for operators who need
//     multiple named rates (reduced rates on food, say).
//  2. The location's own tax_rate / tax_inclusive / tax_label columns
//     (migration 056). This is the common case.
//  3. Zero tax, warned once.
//
// Tier 3 charges nothing rather than falling back to a jurisdiction's rate. An
// operator who has not configured tax yet is better served by a receipt that
// obviously shows no tax than by one that quietly applies 15% South African VAT
// to a restaurant in Osaka.
func TaxConfigFor(ctx context.Context, pool *pgxpool.Pool, locationID string) (tax.Config, error) {
	taxCacheMu.Lock()
	if entry, ok := taxCache[locationID]; ok && time.Now().Before(entry.expiresAt) {
		taxCacheMu.Unlock()
		return entry.config, nil
	}
	taxCacheMu.Unlock()

	cfg, err := fetchTaxConfig(ctx, pool, locationID)
	if err != nil {
		return tax.Config{}, err
	}

	taxCacheMu.Lock()
	taxCache[locationID] = taxCacheEntry{config: cfg, expiresAt: time.Now().Add(taxCacheTTL)}
	taxCacheMu.Unlock()

	return cfg, nil
}

// InvalidateTaxCache drops the cached configuration for a location, so an
// operator who edits their tax settings sees the change on the next order
// rather than up to five minutes later.
func InvalidateTaxCache(locationID string) {
	taxCacheMu.Lock()
	delete(taxCache, locationID)
	taxCacheMu.Unlock()
}

// TaxRateFor returns just the rate as a percentage (15.0 for 15%).
//
// Retained for call sites that only record the rate onto an order row. Prefer
// TaxConfigFor: a rate without its inclusive/exclusive flag is not enough to
// compute a total, and treating it as if it were is how the exclusive-only
// formula ended up in three different handlers.
func TaxRateFor(ctx context.Context, pool *pgxpool.Pool, locationID string) (float64, error) {
	cfg, err := TaxConfigFor(ctx, pool, locationID)
	if err != nil {
		return 0, err
	}
	return cfg.Rate.Percent(), nil
}

// fetchTaxConfig is a package-level var so tests can substitute the DB layer
// and exercise the real TaxConfigFor — including its cache — rather than a
// parallel copy of it. Mirrors the locations.fetchCurrency pattern.
var fetchTaxConfig = func(ctx context.Context, pool *pgxpool.Pool, locationID string) (tax.Config, error) {
	return fetchTaxConfigFromDB(ctx, pool, locationID)
}

// fetchTaxConfigFromDB performs the DB queries without touching the cache.
//
// Both queries use db.Scoped with ServiceRoleScope to bypass FORCE-RLS on
// tax_rates and locations (a fresh pooled connection has no app.current_org_id,
// which would silently block every row). The lookup is keyed to a location_id
// the caller is already authorised for, so this does not widen the security
// boundary.
func fetchTaxConfigFromDB(ctx context.Context, pool *pgxpool.Pool, locationID string) (tax.Config, error) {
	// --- Step 1: a named tax_rates row for this location ---
	var (
		rate      float64
		inclusive bool
		label     *string
	)
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT CAST(rate AS float8), is_inclusive, name
			FROM tax_rates
			WHERE location_id = $1
			  AND is_active = true
			ORDER BY created_at
			LIMIT 1
		`, locationID).Scan(&rate, &inclusive, &label)
	})
	if err == nil {
		return tax.Config{
			Rate:      tax.RateFromPercent(rate),
			Inclusive: inclusive,
			Label:     derefLabel(label),
		}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return tax.Config{}, err
	}

	// --- Step 2: the location's own tax settings ---
	err = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT CAST(tax_rate AS float8), tax_inclusive, tax_label
			FROM locations
			WHERE id = $1
		`, locationID).Scan(&rate, &inclusive, &label)
	})
	if err == nil {
		if rate > 0 {
			return tax.Config{
				Rate:      tax.RateFromPercent(rate),
				Inclusive: inclusive,
				Label:     derefLabel(label),
			}, nil
		}
		// A location row exists but its rate is 0. That is a legitimate
		// configuration (tax-exempt, or a jurisdiction with no sales tax), so
		// it is returned as-is — but the inclusive flag is still carried,
		// because it decides how a later non-zero rate will be applied.
		if _, warned := warnedNoTax.LoadOrStore(locationID, struct{}{}); !warned {
			log.Printf("pos.TaxConfigFor: location %s has tax_rate 0 — no tax will be charged. "+
				"Set locations.tax_rate and locations.tax_inclusive if this location is taxable.", locationID)
		}
		return tax.Config{Inclusive: inclusive, Label: derefLabel(label)}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return tax.Config{}, err
	}

	// --- Step 3: no location row at all ---
	if _, warned := warnedNoTax.LoadOrStore(locationID, struct{}{}); !warned {
		log.Printf("pos.TaxConfigFor: no tax configuration found for location %s — charging no tax", locationID)
	}
	return tax.Config{}, nil
}

func derefLabel(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
