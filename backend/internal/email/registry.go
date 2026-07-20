// registry.go — resolves the correct Provider for a location (Wave 19).
//
// Resolution order:
//
//  1. Per-location BYO credentials from location_email_credentials where
//     is_active = true.  The encrypted_keys column is an AES-GCM ciphertext
//     (same secretbox scheme as payment credentials) of a provider-specific
//     JSON object.  See each adapter file for the expected JSON keys.
//
//  2. Platform default: env var EMAIL_PROVIDER_DEFAULT selects the provider
//     code; RESEND_API_KEY / EMAIL_FROM_DEFAULT supply the credentials.
//     Resend is used when EMAIL_PROVIDER_DEFAULT is unset.
//
// Metering hook — IMPORTANT:
//
//	The platform fallback path (step 2) is where per-send metering/billing
//	should be charged to the location.  The exact hook point is marked with
//	// METERING_HOOK inside For().  Do NOT import the metering package here;
//	instead the metering layer should wrap Registry (or intercept at the
//	handler layer) and call the metering service after a successful For() that
//	returns isBYO=false.
//
//	BYO path (step 1) is NOT metered — the merchant supplies their own API key.
package email

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/secretbox"
)

// ─── Registry ────────────────────────────────────────────────────────────────

// Registry resolves the Provider for a given location.
type Registry interface {
	// For returns the Provider for locationID.
	// isBYO is true when the caller's own API key was used (not metered).
	// Returns ErrProviderNotConfigured when no credentials are available.
	For(ctx context.Context, locationID string) (p Provider, isBYO bool, err error)
}

// ─── DBRegistry ───────────────────────────────────────────────────────────────

// DBRegistry is the production Registry implementation backed by Postgres.
type DBRegistry struct {
	pool       *pgxpool.Pool
	box        *secretbox.Box // AES-GCM box from EMAIL_KEY_ENCRYPTION_SECRET or PAYMENT_KEY_ENCRYPTION_SECRET
	httpClient *http.Client   // shared across constructed adapters
}

// NewDBRegistry creates a DBRegistry using the provided secretbox and pool.
// box may be nil; in that case BYO credential decryption will fail and the
// registry falls back to the platform default.
func NewDBRegistry(pool *pgxpool.Pool, box *secretbox.Box) *DBRegistry {
	return &DBRegistry{
		pool:       pool,
		box:        box,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// NewDBRegistryFromEnv is a convenience constructor that reads the encryption
// secret from the environment.  It prefers EMAIL_KEY_ENCRYPTION_SECRET, then
// falls back to PAYMENT_KEY_ENCRYPTION_SECRET (shared key, codebase
// convention).  Returns an error if neither is set or the key is malformed.
func NewDBRegistryFromEnv(pool *pgxpool.Pool) (*DBRegistry, error) {
	secret := os.Getenv("EMAIL_KEY_ENCRYPTION_SECRET")
	if secret == "" {
		secret = os.Getenv("PAYMENT_KEY_ENCRYPTION_SECRET")
	}
	// The encryption box is ONLY needed to decrypt BYO per-store email
	// credentials. The platform/central provider (built from RESEND_API_KEY etc.)
	// needs no decryption, so a missing secret must NOT disable transactional
	// email — it only disables the BYO path (buildBYOProvider nil-checks the box).
	if secret == "" {
		return NewDBRegistry(pool, nil), nil
	}
	box, err := secretbox.New(secret)
	if err != nil {
		return nil, fmt.Errorf("email: init secretbox: %w", err)
	}
	return NewDBRegistry(pool, box), nil
}

// For implements Registry.
//
// METERING_HOOK: when isBYO=false is returned the calling layer should record
// one email credit against locationID.  This package deliberately does not
// import the metering package to keep the dependency graph clean.
func (r *DBRegistry) For(ctx context.Context, locationID string) (Provider, bool, error) {
	// An empty locationID means "no specific store" (platform-level mail such as
	// auth/verify, password-reset, invites). Skip the per-location BYO lookup —
	// location_id is a uuid column, so querying it with "" would error — and use
	// the platform/central provider directly.
	if locationID == "" {
		p, err := r.buildPlatformProvider()
		if err != nil {
			return nil, false, err
		}
		return p, false, nil
	}

	// ── Step 1: try per-location BYO credentials ─────────────────────────────
	row, err := queryLocationCredentials(ctx, r.pool, locationID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("email: query location credentials: %w", err)
	}

	if err == nil {
		// BYO path — decrypt keys and construct provider.
		p, err := r.buildBYOProvider(row)
		if err != nil {
			return nil, false, err
		}
		// BYO path is NOT metered.
		return p, true, nil
	}

	// ── Step 2: platform default ──────────────────────────────────────────────
	p, err := r.buildPlatformProvider()
	if err != nil {
		return nil, false, err
	}

	// METERING_HOOK: at this point isBYO=false; the caller should meter one
	// email send against locationID before (or after) calling p.Send().
	return p, false, nil
}

// buildBYOProvider decrypts the credential blob and constructs the appropriate
// provider adapter.
func (r *DBRegistry) buildBYOProvider(row locationEmailCred) (Provider, error) {
	if r.box == nil {
		return nil, fmt.Errorf("%w: secretbox not initialised — cannot decrypt BYO email credentials", ErrProviderNotConfigured)
	}

	plain, err := r.box.Decrypt(row.encryptedKeys)
	if err != nil {
		return nil, fmt.Errorf("email: decrypt BYO keys for provider %q: %w", row.providerCode, err)
	}

	// The decrypted value is a JSON object whose keys depend on the provider.
	var keys map[string]string
	if err := json.Unmarshal([]byte(plain), &keys); err != nil {
		return nil, fmt.Errorf("email: parse BYO keys for provider %q: %w", row.providerCode, err)
	}

	senderEmail := ""
	if row.senderEmail != nil {
		senderEmail = *row.senderEmail
	}

	switch strings.ToLower(row.providerCode) {
	case "sendgrid":
		fromName := keys["from_name"]
		if fromName == "" {
			fromName = "BeepBite"
		}
		return NewSendGridAdapter(keys["api_key"], senderEmail, fromName, r.httpClient), nil

	case "mailgun":
		domain := keys["domain"]
		if domain == "" && row.senderDomain != nil {
			domain = *row.senderDomain
		}
		return NewMailgunAdapter(keys["api_key"], domain, senderEmail, keys["region"], r.httpClient), nil

	case "ses":
		return NewSESAdapter(keys["access_key_id"], keys["secret_access_key"], keys["region"], senderEmail, r.httpClient), nil

	case "smtp":
		return NewSMTPAdapter(keys["host"], keys["port"], keys["username"], keys["password"], senderEmail), nil

	default:
		return nil, fmt.Errorf("%w: unsupported BYO email provider %q", ErrProviderNotConfigured, row.providerCode)
	}
}

// buildPlatformProvider constructs the platform-default email provider from
// environment variables.
//
// Env vars:
//
//	EMAIL_PROVIDER_DEFAULT — provider code to use (default: "smtp")
//	EMAIL_FROM_DEFAULT     — default From address for platform sends
func (r *DBRegistry) buildPlatformProvider() (Provider, error) {
	fromAddr := os.Getenv("EMAIL_FROM_DEFAULT")
	if fromAddr == "" {
		fromAddr = defaultFromAddress
	}

	// SMTP is the default: it is the only transport a self-hoster can point at
	// their own server without signing up to anyone.
	providerCode := strings.ToLower(os.Getenv("EMAIL_PROVIDER_DEFAULT"))
	if providerCode == "" {
		providerCode = "smtp"
	}

	switch providerCode {
	case "sendgrid":
		apiKey := os.Getenv("SENDGRID_API_KEY")
		if apiKey == "" {
			return nil, fmt.Errorf("%w: SENDGRID_API_KEY env var not set", ErrProviderNotConfigured)
		}
		fromName := os.Getenv("EMAIL_FROM_NAME")
		if fromName == "" {
			fromName = "BeepBite"
		}
		return NewSendGridAdapter(apiKey, fromAddr, fromName, r.httpClient), nil

	case "mailgun":
		apiKey := os.Getenv("MAILGUN_API_KEY")
		domain := os.Getenv("MAILGUN_DOMAIN")
		if apiKey == "" || domain == "" {
			return nil, fmt.Errorf("%w: MAILGUN_API_KEY and MAILGUN_DOMAIN env vars are required", ErrProviderNotConfigured)
		}
		return NewMailgunAdapter(apiKey, domain, fromAddr, os.Getenv("MAILGUN_REGION"), r.httpClient), nil

	case "ses":
		akid := os.Getenv("AWS_ACCESS_KEY_ID")
		sak := os.Getenv("AWS_SECRET_ACCESS_KEY")
		region := os.Getenv("AWS_REGION")
		if akid == "" || sak == "" {
			return nil, fmt.Errorf("%w: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars are required", ErrProviderNotConfigured)
		}
		return NewSESAdapter(akid, sak, region, fromAddr, r.httpClient), nil

	case "smtp":
		host := os.Getenv("SMTP_HOST")
		port := os.Getenv("SMTP_PORT")
		if host == "" {
			return nil, fmt.Errorf("%w: SMTP_HOST env var is required", ErrProviderNotConfigured)
		}
		return NewSMTPAdapter(host, port, os.Getenv("SMTP_USERNAME"), os.Getenv("SMTP_PASSWORD"), fromAddr), nil

	default:
		return nil, fmt.Errorf("%w: unknown EMAIL_PROVIDER_DEFAULT %q", ErrProviderNotConfigured, providerCode)
	}
}
