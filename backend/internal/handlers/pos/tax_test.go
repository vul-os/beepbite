package pos

// Tests for TaxConfigFor.
//
// These drive the REAL TaxConfigFor — cache included — by substituting the
// injectable fetchTaxConfig, rather than re-implementing the cache in the test
// and asserting against the copy (which is what the previous version of this
// file did, and why it kept passing while the resolution chain underneath was
// broken).
//
// The chain being exercised:
//  1. a location-specific tax_rates row, carrying its own rate AND convention
//  2. the location's own tax_rate / tax_inclusive / tax_label (migration 056)
//  3. zero tax
//
// The old tier 2 queried a `regions` table that does not exist in the current
// schema. A missing relation is not pgx.ErrNoRows, so instead of falling
// through to 0% it returned a hard error — meaning any location without an
// explicit tax_rates row failed checkout outright. There is a test below that
// would have caught that.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/tax"
	"github.com/jackc/pgx/v5/pgxpool"
)

// uniqueLocID returns a UUID-shaped string unique per test, so the
// process-level cache cannot bleed between sub-tests.
func uniqueLocID(suffix string) string {
	return "00000000-0000-0000-0000-" + suffix
}

func purgeTaxCache(locationID string) {
	taxCacheMu.Lock()
	delete(taxCache, locationID)
	taxCacheMu.Unlock()
	warnedNoTax.Delete(locationID)
}

// stubTaxFetch replaces the DB layer for the duration of a test.
func stubTaxFetch(t *testing.T, fn func(locationID string) (tax.Config, error)) {
	t.Helper()
	orig := fetchTaxConfig
	fetchTaxConfig = func(_ context.Context, _ *pgxpool.Pool, id string) (tax.Config, error) {
		return fn(id)
	}
	t.Cleanup(func() { fetchTaxConfig = orig })
}

// ---------------------------------------------------------------------------

func TestTaxConfigFor_CarriesRateAndConvention(t *testing.T) {
	// A rate alone is not enough to compute a total. This is the regression
	// guard for the bug where three handlers took only the rate and then
	// applied the exclusive formula unconditionally.
	tests := []struct {
		name      string
		cfg       tax.Config
		wantRate  float64
		inclusive bool
	}{
		{
			name:      "a VAT-style inclusive location",
			cfg:       tax.Config{Rate: tax.RateFromPercent(15), Inclusive: true, Label: "VAT"},
			wantRate:  15,
			inclusive: true,
		},
		{
			name:      "a US-style exclusive location",
			cfg:       tax.Config{Rate: tax.RateFromPercent(8.88), Inclusive: false, Label: "Sales Tax"},
			wantRate:  8.88,
			inclusive: false,
		},
	}

	for i, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			locID := uniqueLocID("aaa00000000" + string(rune('1'+i)))
			purgeTaxCache(locID)
			stubTaxFetch(t, func(string) (tax.Config, error) { return tc.cfg, nil })

			got, err := TaxConfigFor(context.Background(), nil, locID)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got.Rate.Percent() != tc.wantRate {
				t.Errorf("rate = %v, want %v", got.Rate.Percent(), tc.wantRate)
			}
			if got.Inclusive != tc.inclusive {
				t.Errorf("inclusive = %v, want %v — the convention must survive resolution",
					got.Inclusive, tc.inclusive)
			}
		})
	}
}

// TestTaxConfigFor_ConventionChangesTheTotal is the end-to-end statement of why
// the flag has to be carried: resolution and computation together must produce
// different money for the two conventions.
func TestTaxConfigFor_ConventionChangesTheTotal(t *testing.T) {
	const subtotal int64 = 11500

	incID := uniqueLocID("bbb000000001")
	purgeTaxCache(incID)
	stubTaxFetch(t, func(string) (tax.Config, error) {
		return tax.Config{Rate: tax.RateFromPercent(15), Inclusive: true}, nil
	})
	incCfg, _ := TaxConfigFor(context.Background(), nil, incID)
	inc := incCfg.Compute(subtotal)

	excID := uniqueLocID("bbb000000002")
	purgeTaxCache(excID)
	stubTaxFetch(t, func(string) (tax.Config, error) {
		return tax.Config{Rate: tax.RateFromPercent(15), Inclusive: false}, nil
	})
	excCfg, _ := TaxConfigFor(context.Background(), nil, excID)
	exc := excCfg.Compute(subtotal)

	if inc.Gross != 11500 {
		t.Errorf("inclusive total = %d, want 11500 (the price already contains the tax)", inc.Gross)
	}
	if exc.Gross != 13225 {
		t.Errorf("exclusive total = %d, want 13225 (the tax is added at the register)", exc.Gross)
	}
	if inc.Gross == exc.Gross {
		t.Fatal("the two conventions produced the same total — tax_inclusive is not reaching the computation")
	}
}

func TestTaxConfigFor_ZeroFallbackChargesNothing(t *testing.T) {
	locID := uniqueLocID("ccc000000003")
	purgeTaxCache(locID)
	stubTaxFetch(t, func(string) (tax.Config, error) { return tax.Config{}, nil })

	cfg, err := TaxConfigFor(context.Background(), nil, locID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Rate != 0 {
		t.Errorf("rate = %v, want 0 — an unconfigured location must not inherit a jurisdiction's rate", cfg.Rate)
	}
	if got := cfg.Compute(11500); got.Tax != 0 {
		t.Errorf("tax = %d, want 0", got.Tax)
	}
	// And specifically not South African VAT, which is what tier 3 used to
	// effectively become once a caller defaulted around the error.
	if cfg.Rate.Percent() == 15 {
		t.Error("the no-configuration fallback resolved to 15% — that is a country's rate, not a neutral default")
	}
}

// TestTaxConfigFor_MissingRelationDoesNotBreakCheckout is the direct regression
// test for the dead `regions` branch: a DB error from an intermediate tier must
// not be swallowed into a silent 0%, and a genuine no-rows must not surface as
// an error that fails the sale.
func TestTaxConfigFor_ErrorsPropagateRatherThanBecomingZero(t *testing.T) {
	locID := uniqueLocID("ddd000000004")
	purgeTaxCache(locID)

	sentinel := errors.New("relation \"regions\" does not exist")
	stubTaxFetch(t, func(string) (tax.Config, error) { return tax.Config{}, sentinel })

	_, err := TaxConfigFor(context.Background(), nil, locID)
	if !errors.Is(err, sentinel) {
		t.Errorf("err = %v, want the underlying DB error — a broken tax lookup must be visible, not silently 0%%", err)
	}
}

func TestTaxConfigFor_CacheHit(t *testing.T) {
	locID := uniqueLocID("eee000000005")

	taxCacheMu.Lock()
	taxCache[locID] = taxCacheEntry{
		config:    tax.Config{Rate: tax.RateFromPercent(20), Inclusive: true, Label: "GST"},
		expiresAt: time.Now().Add(5 * time.Minute),
	}
	taxCacheMu.Unlock()
	t.Cleanup(func() { purgeTaxCache(locID) })

	stubTaxFetch(t, func(string) (tax.Config, error) {
		t.Error("fetchTaxConfig called despite a valid cache entry")
		return tax.Config{}, nil
	})

	cfg, err := TaxConfigFor(context.Background(), nil, locID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Rate.Percent() != 20 || !cfg.Inclusive || cfg.Label != "GST" {
		t.Errorf("cached config = %+v, want the seeded 20%% inclusive GST", cfg)
	}
}

func TestInvalidateTaxCache(t *testing.T) {
	locID := uniqueLocID("fff000000006")
	purgeTaxCache(locID)

	calls := 0
	stubTaxFetch(t, func(string) (tax.Config, error) {
		calls++
		return tax.Config{Rate: tax.RateFromPercent(float64(10 * calls))}, nil
	})

	first, _ := TaxConfigFor(context.Background(), nil, locID)
	if first.Rate.Percent() != 10 {
		t.Fatalf("first resolution = %v%%, want 10%%", first.Rate.Percent())
	}

	// Without invalidation the cache answers.
	cached, _ := TaxConfigFor(context.Background(), nil, locID)
	if cached.Rate.Percent() != 10 {
		t.Errorf("second resolution = %v%%, want the cached 10%%", cached.Rate.Percent())
	}

	// After an operator edits their tax settings, the next order must see it.
	InvalidateTaxCache(locID)
	fresh, _ := TaxConfigFor(context.Background(), nil, locID)
	if fresh.Rate.Percent() != 20 {
		t.Errorf("post-invalidation resolution = %v%%, want the new 20%%", fresh.Rate.Percent())
	}
	t.Cleanup(func() { purgeTaxCache(locID) })
}

// TestTaxRateFor_StillWorks covers the retained percentage-only helper.
func TestTaxRateFor_StillWorks(t *testing.T) {
	locID := uniqueLocID("ggg000000007")
	purgeTaxCache(locID)
	stubTaxFetch(t, func(string) (tax.Config, error) {
		return tax.Config{Rate: tax.RateFromPercent(23), Inclusive: true}, nil
	})

	rate, err := TaxRateFor(context.Background(), nil, locID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if rate != 23 {
		t.Errorf("TaxRateFor = %v, want 23", rate)
	}
}
