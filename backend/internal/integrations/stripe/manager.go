// manager.go — region-scoped Stripe credential resolution.
//
// BeepBite runs a single central Stripe account per region. The regions
// table names the provider (`regions.payment_provider`); keys live in env
// vars of the form:
//
//	STRIPE_<REGION>_SECRET_KEY
//	STRIPE_<REGION>_PUBLIC_KEY      (optional — Stripe SDK rarely needs it server-side)
//	STRIPE_<REGION>_WEBHOOK_SECRET
//	STRIPE_<REGION>_TEST_MODE
//
// Region codes follow regions.code (ISO-3166 alpha-2, uppercase).
package stripe

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotConfigured — region has no Stripe credentials loaded.
var ErrNotConfigured = errors.New("stripe: no credentials configured for region")

// ErrWrongProvider — the region exists but its payment_provider isn't stripe.
var ErrWrongProvider = errors.New("stripe: region's payment provider is not stripe")

// Credentials is the cred bundle for one region.
type Credentials struct {
	RegionCode    string
	SecretKey     string
	PublicKey     string
	WebhookSecret string
	IsTestMode    bool
}

// LocationCreds preserves the old public shape so existing callers don't
// need large rewrites.
type LocationCreds struct {
	LocationID    string
	RegionCode    string
	PublicKey     string
	SecretKey     string
	WebhookSecret string
	IsTestMode    bool
	Currency      string
}

type Manager struct {
	creds      map[string]*Credentials // keyed by uppercase region code
	httpClient *http.Client
}

type ManagerConfig struct {
	// Regions to attempt to load from env. If empty, every region derived
	// from scanning os.Environ() for STRIPE_<REGION>_SECRET_KEY is loaded.
	Regions    []string
	HTTPClient *http.Client
}

func NewManager(cfg ManagerConfig) *Manager {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	m := &Manager{
		creds:      map[string]*Credentials{},
		httpClient: hc,
	}
	regions := cfg.Regions
	if len(regions) == 0 {
		regions = discoverRegions("STRIPE_")
	}
	for _, r := range regions {
		r = strings.ToUpper(strings.TrimSpace(r))
		if r == "" {
			continue
		}
		c := loadCredsFromEnv(r)
		if c == nil {
			log.Printf("stripe: region %s has no credentials (STRIPE_%s_SECRET_KEY unset) — payments unavailable", r, r)
			continue
		}
		m.creds[r] = c
	}
	return m
}

// ForRegion returns credentials for the given region code (case-insensitive).
func (m *Manager) ForRegion(regionCode string) (*Credentials, error) {
	if m == nil {
		return nil, ErrNotConfigured
	}
	c, ok := m.creds[strings.ToUpper(strings.TrimSpace(regionCode))]
	if !ok {
		return nil, ErrNotConfigured
	}
	return c, nil
}

// ForLocation resolves the region for a location via
// get_location_payment_provider, then returns the Stripe credentials for
// that region. Returns ErrWrongProvider when the region is configured for
// a non-stripe provider.
func (m *Manager) ForLocation(ctx context.Context, pool *pgxpool.Pool, locationID string) (*Client, *LocationCreds, error) {
	if pool == nil {
		return nil, nil, errors.New("stripe: pgx pool not provided")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var (
		region   string
		currency string
		provider string
	)
	err := pool.QueryRow(ctx, `
SELECT region_code, currency, payment_provider
FROM get_location_payment_provider($1)
LIMIT 1
`, locationID).Scan(&region, &currency, &provider)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrNotConfigured
		}
		return nil, nil, fmt.Errorf("stripe: load region for location: %w", err)
	}

	if !strings.EqualFold(provider, "stripe") {
		return nil, nil, fmt.Errorf("%w (got %q)", ErrWrongProvider, provider)
	}

	creds, err := m.ForRegion(region)
	if err != nil {
		return nil, nil, err
	}

	lc := &LocationCreds{
		LocationID:    locationID,
		RegionCode:    creds.RegionCode,
		PublicKey:     creds.PublicKey,
		SecretKey:     creds.SecretKey,
		WebhookSecret: creds.WebhookSecret,
		IsTestMode:    creds.IsTestMode,
		Currency:      currency,
	}
	c := NewClient(Config{SecretKey: creds.SecretKey, HTTPClient: m.httpClient})
	return c, lc, nil
}

// ClientFor returns a Stripe Client bound to the region's secret key. Useful
// for webhook handlers that resolve the region from the URL path.
func (m *Manager) ClientFor(regionCode string) (*Client, *Credentials, error) {
	creds, err := m.ForRegion(regionCode)
	if err != nil {
		return nil, nil, err
	}
	return NewClient(Config{SecretKey: creds.SecretKey, HTTPClient: m.httpClient}), creds, nil
}

func loadCredsFromEnv(region string) *Credentials {
	sk := os.Getenv("STRIPE_" + region + "_SECRET_KEY")
	if sk == "" {
		return nil
	}
	pk := os.Getenv("STRIPE_" + region + "_PUBLIC_KEY")
	wh := os.Getenv("STRIPE_" + region + "_WEBHOOK_SECRET")
	test := envBool("STRIPE_" + region + "_TEST_MODE")
	return &Credentials{
		RegionCode:    region,
		SecretKey:     sk,
		PublicKey:     pk,
		WebhookSecret: wh,
		IsTestMode:    test,
	}
}

func discoverRegions(prefix string) []string {
	seen := map[string]struct{}{}
	var out []string
	suffix := "_SECRET_KEY"
	for _, kv := range os.Environ() {
		eq := strings.IndexByte(kv, '=')
		if eq < 0 {
			continue
		}
		k := kv[:eq]
		if !strings.HasPrefix(k, prefix) || !strings.HasSuffix(k, suffix) {
			continue
		}
		region := k[len(prefix) : len(k)-len(suffix)]
		if region == "" {
			continue
		}
		if _, ok := seen[region]; ok {
			continue
		}
		seen[region] = struct{}{}
		out = append(out, region)
	}
	return out
}

func envBool(key string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "1", "true", "t", "yes", "y":
		return true
	}
	return false
}
