// manager.go — region-scoped Paystack credential resolution.
//
// BeepBite runs a single central Paystack account per region. The regions
// table names the provider (`regions.payment_provider`); the actual keys
// live in env vars of the form:
//
//	PAYSTACK_<REGION>_SECRET_KEY
//	PAYSTACK_<REGION>_PUBLIC_KEY
//	PAYSTACK_<REGION>_WEBHOOK_SECRET
//	PAYSTACK_<REGION>_TEST_MODE
//
// e.g. PAYSTACK_ZA_SECRET_KEY / PAYSTACK_ZA_PUBLIC_KEY. Region codes follow
// the regions.code column (ISO-3166 alpha-2, uppercase).
//
// Manager loads every configured region at startup into an in-memory map.
// ForRegion looks up directly by region code; ForLocation walks through
// get_location_payment_provider(location_id) and dispatches.
package paystack

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

// ErrNotConfigured is returned when the requested region has no Paystack
// credentials loaded from env. Callers should treat this as "this region
// cannot accept Paystack" rather than a real failure.
var ErrNotConfigured = errors.New("paystack: no credentials configured for region")

// ErrWrongProvider is returned by ForLocation when the region's configured
// provider is not Paystack. Callers can surface "wrong provider for this
// region" and fall back or route to the correct integration.
var ErrWrongProvider = errors.New("paystack: region's payment provider is not paystack")

// Credentials is the cred bundle for one region.
type Credentials struct {
	RegionCode    string
	SecretKey     string
	PublicKey     string
	WebhookSecret string
	IsTestMode    bool
}

// LocationCreds preserves the old public shape so existing callers don't
// need large rewrites. RegionCode / Currency come from the SQL helper.
type LocationCreds struct {
	LocationID    string
	RegionCode    string
	Currency      string
	PublicKey     string
	SecretKey     string
	WebhookSecret string
	IsTestMode    bool
}

// Manager resolves Paystack credentials per region.
type Manager struct {
	creds       map[string]*Credentials // keyed by uppercase region code
	frontendURL string
	httpClient  *http.Client
}

type ManagerConfig struct {
	// Regions to attempt to load from env. If empty, every region derived
	// from scanning os.Environ() for PAYSTACK_<REGION>_SECRET_KEY is loaded.
	Regions     []string
	FrontendURL string
	HTTPClient  *http.Client
}

func NewManager(cfg ManagerConfig) *Manager {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	m := &Manager{
		creds:       map[string]*Credentials{},
		frontendURL: cfg.FrontendURL,
		httpClient:  hc,
	}
	regions := cfg.Regions
	if len(regions) == 0 {
		regions = discoverRegions("PAYSTACK_")
	}
	for _, r := range regions {
		r = strings.ToUpper(strings.TrimSpace(r))
		if r == "" {
			continue
		}
		c := loadCredsFromEnv(r)
		if c == nil {
			// Not configured yet (e.g. KE). Log and keep going.
			log.Printf("paystack: region %s has no credentials (PAYSTACK_%s_SECRET_KEY unset) — payments unavailable", r, r)
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
// get_location_payment_provider, then returns the Paystack credentials for
// that region. If the region's configured provider is not paystack, returns
// ErrWrongProvider so the caller can surface a clear message.
//
// The legacy (Client, *LocationCreds, error) return shape is preserved so
// existing callers (e.g. paymentwebhooks) compile with minimal edits.
func (m *Manager) ForLocation(ctx context.Context, pool *pgxpool.Pool, locationID string) (*Client, *LocationCreds, error) {
	if pool == nil {
		return nil, nil, errors.New("paystack: pgx pool not provided")
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
		return nil, nil, fmt.Errorf("paystack: load region for location: %w", err)
	}

	if !strings.EqualFold(provider, "paystack") {
		return nil, nil, fmt.Errorf("%w (got %q)", ErrWrongProvider, provider)
	}

	creds, err := m.ForRegion(region)
	if err != nil {
		return nil, nil, err
	}

	lc := &LocationCreds{
		LocationID:    locationID,
		RegionCode:    creds.RegionCode,
		Currency:      currency,
		PublicKey:     creds.PublicKey,
		SecretKey:     creds.SecretKey,
		WebhookSecret: creds.WebhookSecret,
		IsTestMode:    creds.IsTestMode,
	}
	c := NewClient(Config{
		SecretKey:   creds.SecretKey,
		FrontendURL: m.frontendURL,
		HTTPClient:  m.httpClient,
	})
	return c, lc, nil
}

// ClientFor returns a Paystack Client bound to the given region's secret key.
// Webhook handlers use this when they know the region from the URL path.
func (m *Manager) ClientFor(regionCode string) (*Client, *Credentials, error) {
	creds, err := m.ForRegion(regionCode)
	if err != nil {
		return nil, nil, err
	}
	return NewClient(Config{
		SecretKey:   creds.SecretKey,
		FrontendURL: m.frontendURL,
		HTTPClient:  m.httpClient,
	}), creds, nil
}

func loadCredsFromEnv(region string) *Credentials {
	sk := os.Getenv("PAYSTACK_" + region + "_SECRET_KEY")
	if sk == "" {
		return nil
	}
	pk := os.Getenv("PAYSTACK_" + region + "_PUBLIC_KEY")
	wh := os.Getenv("PAYSTACK_" + region + "_WEBHOOK_SECRET")
	if wh == "" {
		// Paystack signs webhooks with the same secret key unless rotated.
		wh = sk
	}
	test := envBool("PAYSTACK_" + region + "_TEST_MODE")
	return &Credentials{
		RegionCode:    region,
		SecretKey:     sk,
		PublicKey:     pk,
		WebhookSecret: wh,
		IsTestMode:    test,
	}
}

// discoverRegions walks os.Environ() for <prefix><REGION>_SECRET_KEY entries
// and returns the distinct REGION codes. Used when the caller didn't pass
// an explicit region list.
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
