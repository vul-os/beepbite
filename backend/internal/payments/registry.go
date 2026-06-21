// registry.go — resolves the correct Provider + Credentials for a location.
//
// Resolution order:
//  1. Per-location BYO credentials from location_payment_credentials where
//     is_active = true (merchant's own gateway keys, encrypted at rest).
//  2. Platform-region fallback: read the location's region, then look up the
//     region's payment_provider code and return platform credentials from the
//     relevant env-var-backed manager (paystack.Manager / stripe.Manager).
//
// If neither source yields credentials, ErrProviderNotConfigured is returned.
//
// Encryption uses the secretbox package (AES-256-GCM) with the key from
// PAYMENT_KEY_ENCRYPTION_SECRET.
package payments

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/secretbox"
)

// ─── Registry interface ───────────────────────────────────────────────────────

// Registry resolves the Provider and Credentials for a given location.
// Call Registry.For at the start of any payment operation.
type Registry interface {
	// For returns the Provider and decrypted Credentials for locationID.
	// Returns ErrProviderNotConfigured when no credentials are available.
	For(ctx context.Context, locationID string) (Provider, *Credentials, error)
}

// ─── ProviderFactory ─────────────────────────────────────────────────────────

// ProviderFactory constructs a Provider from a Credentials bundle.
// Each adapter package registers its factory via RegisterProvider.
type ProviderFactory func(creds *Credentials) Provider

var (
	registeredProviders = map[string]ProviderFactory{}
)

// RegisterProvider registers a factory function for the given provider code.
// Call this from adapter packages' init() or explicit setup functions so the
// registry can construct providers without importing them directly.
func RegisterProvider(code string, factory ProviderFactory) {
	registeredProviders[strings.ToLower(code)] = factory
}

// ─── DBRegistry implementation ───────────────────────────────────────────────

// DBRegistry is the production Registry implementation backed by Postgres.
type DBRegistry struct {
	pool *pgxpool.Pool
	box  *secretbox.Box // AES-GCM box loaded from PAYMENT_KEY_ENCRYPTION_SECRET
}

// NewDBRegistry creates a DBRegistry.  box may be nil for testing; in that
// case per-store BYO credential decryption will fail and the registry falls
// back to platform credentials only.
func NewDBRegistry(pool *pgxpool.Pool, box *secretbox.Box) *DBRegistry {
	return &DBRegistry{pool: pool, box: box}
}

// NewDBRegistryFromEnv is a convenience constructor that reads
// PAYMENT_KEY_ENCRYPTION_SECRET from the environment and creates the Box.
// Returns an error if the env var is missing or the key is malformed.
func NewDBRegistryFromEnv(pool *pgxpool.Pool) (*DBRegistry, error) {
	secret := os.Getenv("PAYMENT_KEY_ENCRYPTION_SECRET")
	if secret == "" {
		return nil, errors.New("payments: PAYMENT_KEY_ENCRYPTION_SECRET env var is required")
	}
	box, err := secretbox.New(secret)
	if err != nil {
		return nil, fmt.Errorf("payments: init secretbox: %w", err)
	}
	return NewDBRegistry(pool, box), nil
}

// For implements Registry.
//
// Step 1 — query location_payment_credentials for an active BYO row.
// Step 2 — if found, decrypt the secret key and webhook secret with the
//
//	AES-GCM box, then look up the registered factory for the provider
//	code and construct the Provider.
//
// Step 3 — if no BYO row, call get_location_payment_provider() (a DB helper
//
//	function defined in migration 014) to resolve region → provider
//	code, then look up platform env-var credentials via the registered
//	platform-fallback factory.
//
// Step 4 — if no factory is registered for the resolved provider code, return
//
//	ErrProviderNotConfigured.
func (r *DBRegistry) For(ctx context.Context, locationID string) (Provider, *Credentials, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	// ── Step 1+2: try per-location BYO credentials ──────────────────────────
	creds, err := r.loadBYOCredentials(ctx, locationID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, fmt.Errorf("payments: query location credentials: %w", err)
	}
	if creds != nil {
		p, err := r.providerFromCreds(creds)
		if err != nil {
			return nil, nil, err
		}
		return p, creds, nil
	}

	// ── Step 3: platform-region fallback ────────────────────────────────────
	creds, err = r.loadPlatformCredentials(ctx, locationID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrProviderNotConfigured
		}
		return nil, nil, fmt.Errorf("payments: resolve region credentials: %w", err)
	}
	if creds == nil {
		return nil, nil, ErrProviderNotConfigured
	}

	p, err := r.providerFromCreds(creds)
	if err != nil {
		return nil, nil, err
	}
	return p, creds, nil
}

// loadBYOCredentials queries location_payment_credentials for an active row
// for locationID and decrypts the secret fields.  Returns nil, pgx.ErrNoRows
// when no active row exists.
func (r *DBRegistry) loadBYOCredentials(ctx context.Context, locationID string) (*Credentials, error) {
	const q = `
SELECT
    lpc.provider_code,
    lpc.public_key,
    lpc.secret_key_ciphertext,
    lpc.webhook_secret_ciphertext,
    lpc.is_test_mode,
    COALESCE(lpc.currency, r.currency, 'ZAR') AS currency,
    r.code AS region_code
FROM location_payment_credentials lpc
JOIN locations l ON l.id = lpc.location_id
JOIN regions   r ON r.id = l.region_id
WHERE lpc.location_id = $1
  AND lpc.is_active   = true
ORDER BY lpc.updated_at DESC
LIMIT 1`

	var (
		providerCode        string
		publicKey           *string
		secretKeyCiphertext *string
		webhookSecretCT     *string
		isTestMode          bool
		currency            string
		regionCode          string
	)
	err := r.pool.QueryRow(ctx, q, locationID).Scan(
		&providerCode,
		&publicKey,
		&secretKeyCiphertext,
		&webhookSecretCT,
		&isTestMode,
		&currency,
		&regionCode,
	)
	if err != nil {
		return nil, err // includes pgx.ErrNoRows
	}

	creds := &Credentials{
		ProviderCode: providerCode,
		LocationID:   locationID,
		RegionCode:   regionCode,
		Currency:     currency,
		IsTestMode:   isTestMode,
		IsBYO:        true,
	}
	if publicKey != nil {
		creds.PublicKey = *publicKey
	}

	if r.box != nil {
		if secretKeyCiphertext != nil && *secretKeyCiphertext != "" {
			sk, err := r.box.Decrypt(*secretKeyCiphertext)
			if err != nil {
				return nil, fmt.Errorf("payments: decrypt secret_key: %w", err)
			}
			creds.SecretKey = sk
		}
		if webhookSecretCT != nil && *webhookSecretCT != "" {
			ws, err := r.box.Decrypt(*webhookSecretCT)
			if err != nil {
				return nil, fmt.Errorf("payments: decrypt webhook_secret: %w", err)
			}
			creds.WebhookSecret = ws
		}
	}

	return creds, nil
}

// loadPlatformCredentials uses get_location_payment_provider() — a SQL helper
// defined in migration 014 — to resolve the location → region → provider chain,
// then returns platform credentials read from registered factories.
func (r *DBRegistry) loadPlatformCredentials(ctx context.Context, locationID string) (*Credentials, error) {
	const q = `
SELECT region_code, currency, payment_provider
FROM get_location_payment_provider($1)
LIMIT 1`

	var regionCode, currency, providerCode string
	err := r.pool.QueryRow(ctx, q, locationID).Scan(&regionCode, &currency, &providerCode)
	if err != nil {
		return nil, err // pgx.ErrNoRows → no region configured
	}
	if providerCode == "" {
		return nil, ErrProviderNotConfigured
	}

	// Ask the registered factory whether it can provide platform creds.
	// Platform adapters (paystack, stripe) expose a PlatformCredentials(regionCode)
	// helper that is called via the fallback factory mechanism.
	factory, ok := registeredProviders[strings.ToLower(providerCode)]
	if !ok {
		return nil, fmt.Errorf("%w: no factory registered for %q", ErrProviderNotConfigured, providerCode)
	}

	// Build a minimal platform-creds bundle and let the factory validate it.
	// Platform credentials (actual keys) are held inside the adapter; the
	// factory pattern ensures the registry doesn't import them directly.
	creds := &Credentials{
		ProviderCode: providerCode,
		LocationID:   "",
		RegionCode:   regionCode,
		Currency:     currency,
		IsBYO:        false,
	}

	// If the factory returns nil it means it has no platform creds for this
	// region (e.g. no PAYSTACK_ZA_SECRET_KEY env var).
	p := factory(creds)
	if p == nil {
		return nil, fmt.Errorf("%w: platform creds not configured for region %q provider %q", ErrProviderNotConfigured, regionCode, providerCode)
	}

	return creds, nil
}

// providerFromCreds looks up the registered factory for creds.ProviderCode
// and constructs a Provider.
func (r *DBRegistry) providerFromCreds(creds *Credentials) (Provider, error) {
	factory, ok := registeredProviders[strings.ToLower(creds.ProviderCode)]
	if !ok {
		return nil, fmt.Errorf("%w: no adapter registered for provider %q", ErrProviderNotConfigured, creds.ProviderCode)
	}
	p := factory(creds)
	if p == nil {
		return nil, fmt.Errorf("%w: factory for %q returned nil", ErrProviderNotConfigured, creds.ProviderCode)
	}
	return p, nil
}
