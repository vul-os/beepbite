package pos_test

// tax_rls_integration_test.go — pos.TaxConfigFor against a real, migrated
// Postgres, as the non-superuser bb_app role so RLS is genuinely enforced.
//
// tax_test.go drives TaxConfigFor with the DB layer stubbed out, which proves
// the cache and the tier ordering but cannot prove that the SQL matches the
// schema or that the reads survive FORCE ROW LEVEL SECURITY on tax_rates and
// locations. Those are exactly the properties that fail silently: a hidden row
// is pgx.ErrNoRows, which the resolution chain reads as "not configured".
//
// Run:
//
//	cd backend && go test ./internal/handlers/pos/ -run IntegrationPOSTax -v

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/fixtures"
	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/pos"
	"github.com/beepbite/backend/internal/locations"
)

var taxTestPool *pgxpool.Pool

func TestMain(m *testing.M) {
	pool, cleanup := testenv.MustStartPostgres(context.Background())
	defer cleanup()
	taxTestPool = pool
	os.Exit(m.Run())
}

// seedTaxLocation creates an org + location with an explicit locale posture and
// returns the location id, with both caches purged on cleanup so the
// process-level tax and settings caches cannot bleed into another test.
func seedTaxLocation(t *testing.T, ctx context.Context, loc fixtures.Locale, tag string) string {
	t.Helper()
	orgID, ownerID, err := fixtures.SeedOrg(ctx, taxTestPool, "POS Tax RLS Org "+tag)
	if err != nil {
		t.Fatalf("SeedOrg: %v", err)
	}
	locationID, err := fixtures.SeedLocationIn(ctx, taxTestPool, orgID,
		"POS Tax RLS Store", "pos-tax-rls-"+tag, loc)
	if err != nil {
		t.Fatalf("SeedLocationIn: %v", err)
	}
	t.Cleanup(func() {
		pos.InvalidateTaxCache(locationID)
		locations.InvalidateSettings(locationID)
		_ = db.Scoped(context.Background(), taxTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, e := tx.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
			return e
		})
		_ = db.Scoped(context.Background(), taxTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, e := tx.Exec(context.Background(), `DELETE FROM auth_users WHERE id = $1`, ownerID)
			return e
		})
	})
	return locationID
}

// TestIntegrationPOSTaxUnknownLocationErrors is the behaviour change: tier 3 used
// to return tax.Config{} with a NIL error and a log line, so a POS sale against a
// location whose row could not be read completed at 0% tax. The receipt showed a
// believable total and the revenue service was short.
func TestIntegrationPOSTaxUnknownLocationErrors(t *testing.T) {
	ctx := context.Background()
	const unknown = "00000000-0000-0000-0000-0000000000ff"
	pos.InvalidateTaxCache(unknown)

	cfg, err := pos.TaxConfigFor(ctx, taxTestPool, unknown)
	if err == nil {
		t.Fatalf("TaxConfigFor on an unreadable location returned %+v and a nil error — "+
			"'there is no such store' is not a tax posture, and charging 0%% on it is a "+
			"plausible number rather than a visible failure", cfg)
	}
	if !errors.Is(err, locations.ErrLocationNotFound) {
		t.Errorf("err = %v, want locations.ErrLocationNotFound", err)
	}
}

// TestIntegrationPOSTaxZeroRateOnARealRowIsNotAnError pins the deliberate
// asymmetry introduced alongside the change above. A location row that says
// tax_rate 0 IS a configuration — tax-exempt, or a jurisdiction with no sales
// tax — and must keep resolving to 0% with a nil error. Only the ABSENCE of the
// row became an error. Without this test the natural over-correction (erroring
// on any zero rate) would break every tax-exempt store.
func TestIntegrationPOSTaxZeroRateOnARealRowIsNotAnError(t *testing.T) {
	ctx := context.Background()
	exempt := fixtures.LocaleUS
	exempt.TaxRate = 0
	exempt.TaxInclusive = false
	exempt.TaxLabel = ""
	locationID := seedTaxLocation(t, ctx, exempt, "exempt")

	cfg, err := pos.TaxConfigFor(ctx, taxTestPool, locationID)
	if err != nil {
		t.Fatalf("TaxConfigFor on a tax-exempt location: %v — a real row saying 0 is an "+
			"answer, not a failure", err)
	}
	if cfg.Rate != 0 {
		t.Errorf("rate = %v, want 0", cfg.Rate)
	}
	if got := cfg.Compute(10000); got.Tax != 0 || got.Gross != 10000 {
		t.Errorf("Compute(10000) = %+v, want zero tax and an unchanged gross", got)
	}
}

// TestIntegrationPOSTaxRatesRowWinsOverTheLocationColumn exercises tier 1
// through the REAL SQL under RLS: a named tax_rates row must beat the location's
// own tax_rate column, and must carry its own inclusive/exclusive convention.
//
// The location is LocaleUS (8.31% EXCLUSIVE) and the tax_rates row is 25%
// INCLUSIVE, so rate and convention both disagree and either one being taken
// from the wrong place shows up here.
func TestIntegrationPOSTaxRatesRowWinsOverTheLocationColumn(t *testing.T) {
	ctx := context.Background()
	locationID := seedTaxLocation(t, ctx, fixtures.LocaleUS, "named-rate")

	if err := db.Scoped(ctx, taxTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `
			INSERT INTO tax_rates (location_id, name, rate, is_inclusive, is_active)
			VALUES ($1, 'Reduced', 25.00, true, true)`, locationID)
		return e
	}); err != nil {
		t.Fatalf("seed tax_rates row: %v", err)
	}
	pos.InvalidateTaxCache(locationID)

	cfg, err := pos.TaxConfigFor(ctx, taxTestPool, locationID)
	if err != nil {
		t.Fatalf("TaxConfigFor: %v", err)
	}
	if cfg.Rate.Percent() != 25 {
		t.Errorf("rate = %v%%, want 25%% from the tax_rates row; 8.31%% means the row was "+
			"invisible and the location column answered instead", cfg.Rate.Percent())
	}
	if !cfg.Inclusive {
		t.Error("inclusive = false, want true from the tax_rates row — the convention must " +
			"come from the same tier as the rate, or the total is computed with a " +
			"formula the rate was never meant for")
	}
	if cfg.Label != "Reduced" {
		t.Errorf("label = %q, want %q", cfg.Label, "Reduced")
	}
}
