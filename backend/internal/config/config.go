package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	Env      string
	Port     string
	DatabaseURL string

	JWTSecret      string
	AccessTokenTTL time.Duration
	RefreshTokenTTL time.Duration

	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string

	CORSOrigins []string

	WhatsAppVerifyToken   string
	WhatsAppAccessToken   string
	WhatsAppPhoneNumberID string

	// Platform-level Paystack (legacy fallback for flows that haven't been
	// migrated to per-location BYO). Leave empty in prod once everything is
	// merchant-scoped.
	PaystackSecretKey string
	PaystackPublicKey string

	// 32-byte key (hex, base64, or raw) used to AES-GCM encrypt sensitive
	// merchant data at rest — currently the bank account numbers stored in
	// bank_accounts.account_number_ciphertext (migration 27). Losing this
	// key means losing access to all encrypted columns — back it up in your
	// secret manager.
	PaymentKeyEncryptionSecret string

	// Test credentials exercised by `go run ./cmd/tests --payment-gateways`.
	// Never used at runtime in prod; tests call Paystack/Stripe's sandbox
	// APIs against these keys.
	PaystackTestSecretKey     string
	PaystackTestPublicKey     string
	PaystackTestWebhookSecret string
	StripeTestSecretKey       string
	StripeTestPublicKey       string
	StripeTestWebhookSecret   string

	ResendAPIKey string
	ResendFrom   string

	MapboxToken  string
	OpenAIAPIKey string
}

// Load reads the env file that matches `env` (local/dev/main) from the repo
// root and returns a populated Config. Env is resolved in this order:
//
//   1. explicit `env` argument (from --env flag)
//   2. APP_ENV environment variable
//   3. "local"
//
// Files are looked up relative to the repo root (the parent of the `backend/`
// directory). Missing optional files are fine; a missing required env var
// causes Load to return an error.
func Load(env string) (*Config, error) {
	if env == "" {
		env = os.Getenv("APP_ENV")
	}
	if env == "" {
		env = "local"
	}

	root, err := repoRoot()
	if err != nil {
		return nil, err
	}

	var file string
	switch env {
	case "local":
		file = filepath.Join(root, ".env")
	case "dev":
		file = filepath.Join(root, ".env.dev")
	case "main":
		file = filepath.Join(root, ".env.main")
	default:
		return nil, fmt.Errorf("unknown env %q (expected local|dev|main)", env)
	}

	if _, err := os.Stat(file); err == nil {
		if err := godotenv.Overload(file); err != nil {
			return nil, fmt.Errorf("load %s: %w", file, err)
		}
	}

	c := &Config{
		Env:                   env,
		Port:                  envOr("PORT", "8080"),
		DatabaseURL:           os.Getenv("DATABASE_URL"),
		JWTSecret:             os.Getenv("JWT_SECRET"),
		AccessTokenTTL:        envDuration("JWT_ACCESS_TTL", 15*time.Minute),
		RefreshTokenTTL:       envDuration("JWT_REFRESH_TTL", 30*24*time.Hour),
		GoogleClientID:        os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret:    os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:     os.Getenv("GOOGLE_REDIRECT_URL"),
		CORSOrigins:           splitCSV(os.Getenv("CORS_ORIGINS")),
		WhatsAppVerifyToken:   os.Getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
		WhatsAppAccessToken:   os.Getenv("WHATSAPP_ACCESS_TOKEN"),
		WhatsAppPhoneNumberID: os.Getenv("WHATSAPP_PHONE_NUMBER_ID"),
		PaystackSecretKey:          os.Getenv("PAYSTACK_SECRET_KEY"),
		PaystackPublicKey:          os.Getenv("PAYSTACK_PUBLIC_KEY"),
		PaymentKeyEncryptionSecret: os.Getenv("PAYMENT_KEY_ENCRYPTION_SECRET"),
		PaystackTestSecretKey:      os.Getenv("PAYSTACK_TEST_SECRET_KEY"),
		PaystackTestPublicKey:      os.Getenv("PAYSTACK_TEST_PUBLIC_KEY"),
		PaystackTestWebhookSecret:  os.Getenv("PAYSTACK_TEST_WEBHOOK_SECRET"),
		StripeTestSecretKey:        os.Getenv("STRIPE_TEST_SECRET_KEY"),
		StripeTestPublicKey:        os.Getenv("STRIPE_TEST_PUBLIC_KEY"),
		StripeTestWebhookSecret:    os.Getenv("STRIPE_TEST_WEBHOOK_SECRET"),
		ResendAPIKey:               os.Getenv("RESEND_API_KEY"),
		ResendFrom:            os.Getenv("RESEND_FROM"),
		MapboxToken:           os.Getenv("MAPBOX_TOKEN"),
		OpenAIAPIKey:          os.Getenv("OPENAI_API_KEY"),
	}

	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if c.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	return c, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return fallback
	}
	return d
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// repoRoot walks up from the running binary's directory looking for the file
// that anchors the repo (go.mod in backend/). This lets the server run from
// anywhere — `go run ./cmd/server`, a compiled binary placed in /usr/local/bin,
// or a test directory.
func repoRoot() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := cwd
	for i := 0; i < 10; i++ {
		if _, err := os.Stat(filepath.Join(dir, "backend", "go.mod")); err == nil {
			return dir, nil
		}
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil && filepath.Base(dir) == "backend" {
			return filepath.Dir(dir), nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return cwd, nil
}
