package pos

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
// Per-process tax-rate cache
// ---------------------------------------------------------------------------

type taxCacheEntry struct {
	rate      float64
	expiresAt time.Time
}

var (
	taxCacheMu    sync.Mutex
	taxCache      = make(map[string]taxCacheEntry)
	taxCacheTTL   = 5 * time.Minute
	warnedNoTax   sync.Map // locationID → struct{}: tracks locations we've already warned about
)

// TaxRateFor returns the effective tax rate (as a percentage, e.g. 15.0 for
// 15%) for the given location, with a 5-minute in-process cache.
//
// Fallback chain:
//  1. First active row in tax_rates for the location (is_active = true).
//  2. Region's default_tax_rate from the regions table (via location.region_id).
//  3. Zero — logged once per location via warn-log.
func TaxRateFor(ctx context.Context, pool *pgxpool.Pool, locationID string) (float64, error) {
	// --- Cache lookup ---
	taxCacheMu.Lock()
	if entry, ok := taxCache[locationID]; ok && time.Now().Before(entry.expiresAt) {
		taxCacheMu.Unlock()
		return entry.rate, nil
	}
	taxCacheMu.Unlock()

	rate, err := fetchTaxRate(ctx, pool, locationID)
	if err != nil {
		return 0, err
	}

	// --- Cache store ---
	taxCacheMu.Lock()
	taxCache[locationID] = taxCacheEntry{
		rate:      rate,
		expiresAt: time.Now().Add(taxCacheTTL),
	}
	taxCacheMu.Unlock()

	return rate, nil
}

// fetchTaxRate performs the actual DB queries without touching the cache.
// Both queries use db.Scoped with ServiceRoleScope to bypass FORCE-RLS on
// tax_rates and locations; the lookup is already keyed to a location_id the
// caller is authorised for, so this does not widen the security boundary.
func fetchTaxRate(ctx context.Context, pool *pgxpool.Pool, locationID string) (float64, error) {
	// --- Step 1: location-specific tax_rates row ---
	// ServiceRoleScope bypasses FORCE-RLS on tax_rates (no app.current_org_id
	// is set on a fresh pooled connection, which would silently block every row).
	var locRate float64
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT CAST(rate AS float8)
			FROM tax_rates
			WHERE location_id = $1
			  AND is_active = true
			ORDER BY created_at
			LIMIT 1
		`, locationID).Scan(&locRate)
	})
	if err == nil {
		return locRate, nil
	}
	// Any error other than "no rows" is a real DB problem.
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}

	// --- Step 2: region default ---
	// Same service-role wrap for the locations/regions join.
	var regionRate float64
	err = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT CAST(r.default_tax_rate AS float8)
			FROM locations l
			JOIN regions r ON r.id = l.region_id
			WHERE l.id = $1
		`, locationID).Scan(&regionRate)
	})
	if err == nil {
		return regionRate, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}

	// --- Step 3: zero fallback, warn once per location ---
	if _, alreadyWarned := warnedNoTax.LoadOrStore(locationID, struct{}{}); !alreadyWarned {
		log.Printf("pos.TaxRateFor: no tax_rates row and no region default for location %s — using 0%% VAT", locationID)
	}
	return 0, nil
}
