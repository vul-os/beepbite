package config

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/joho/godotenv"

	"github.com/beepbite/backend/internal/fx"
)

type Config struct {
	Env         string
	Port        string
	DatabaseURL string

	JWTSecret       string
	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration

	CORSOrigins []string

	WhatsAppVerifyToken   string
	WhatsAppAppSecret     string
	WhatsAppAccessToken   string
	WhatsAppPhoneNumberID string

	MapboxToken  string
	GeminiAPIKey string

	// MapboxCountry / MapboxProximity bias address autocomplete toward a
	// region. Both are optional and default to EMPTY, meaning worldwide
	// results. They previously defaulted to "za" and the Johannesburg CBD,
	// which quietly made every address search in the product South African.
	MapboxCountry   string
	MapboxProximity string

	// FXProvider selects how the OPTIONAL consolidated multi-currency report
	// gets its exchange rates. There are three states and exactly three:
	//
	//	""                    off (the default). No conversion, and — because
	//	                      internal/fx builds no engine and no client at all
	//	                      in this state — no code capable of an outbound
	//	                      rate lookup.
	//	"openrate-embedded"   OpenRate runs inside this process. Nothing to
	//	                      deploy; this server fetches reference rates from
	//	                      the sources named in FXSources, lazily, the first
	//	                      time a report needs a rate older than FXMaxAge.
	//	"openrate"            an OpenRate server the operator already runs, at
	//	                      FXBaseURL. This process fetches nothing itself.
	//
	// Conversion is a reporting view only — it never changes a stored amount.
	FXProvider string

	// FXBaseURL is the OpenRate server root. Required by, and used only by,
	// FXProvider="openrate".
	FXBaseURL string

	// FXCacheTTL is how long a rate fetched from that server is reused. Used
	// only by FXProvider="openrate"; the embedded engine answers from an
	// in-memory snapshot and has no round trip to save.
	FXCacheTTL time.Duration

	// FXSources is the comma-separated source list for the embedded engine,
	// e.g. "ecb,coinbase". Empty means OpenRate's default set (ecb, coinbase,
	// luno, sarb). It is the operator's list of hosts this server will contact,
	// and nothing else can widen it.
	FXSources string

	// FXMaxAge is how stale the embedded engine's rates may be before a lookup
	// refreshes them. Embedded mode only.
	FXMaxAge time.Duration

	// FXFetchTimeout bounds a single source fetch in embedded mode. That fetch
	// happens inside a report request, so this is the worst case a report can
	// wait on a slow central bank before falling back to the rates already
	// held.
	FXFetchTimeout time.Duration
}

// FXSettings is the FX_* block in the form internal/fx consumes.
func (c *Config) FXSettings() fx.Settings {
	return fx.Settings{
		Provider:     c.FXProvider,
		BaseURL:      c.FXBaseURL,
		CacheTTL:     c.FXCacheTTL,
		SourceSpec:   c.FXSources,
		MaxAge:       c.FXMaxAge,
		FetchTimeout: c.FXFetchTimeout,
	}
}

// Load reads the env file that matches `env` (local/dev/main) from the repo
// root and returns a populated Config. Env is resolved in this order:
//
//  1. explicit `env` argument (from --env flag)
//  2. APP_ENV environment variable
//  3. "local"
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
		CORSOrigins:           splitCSV(os.Getenv("CORS_ORIGINS")),
		WhatsAppVerifyToken:   os.Getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
		WhatsAppAppSecret:     os.Getenv("WHATSAPP_APP_SECRET"),
		WhatsAppAccessToken:   os.Getenv("WHATSAPP_ACCESS_TOKEN"),
		WhatsAppPhoneNumberID: os.Getenv("WHATSAPP_PHONE_NUMBER_ID"),
		MapboxToken:           os.Getenv("MAPBOX_TOKEN"),
		GeminiAPIKey:          os.Getenv("GEMINI_API_KEY"),
		MapboxCountry:         os.Getenv("MAPBOX_COUNTRY"),
		MapboxProximity:       os.Getenv("MAPBOX_PROXIMITY"),
		FXProvider:            os.Getenv("FX_PROVIDER"),
		FXBaseURL:             os.Getenv("FX_OPENRATE_URL"),
		FXCacheTTL:            envDuration("FX_CACHE_TTL", 5*time.Minute),
		FXSources:             os.Getenv("FX_OPENRATE_SOURCES"),
		FXMaxAge:              envDuration("FX_OPENRATE_MAX_AGE", time.Hour),
		FXFetchTimeout:        envDuration("FX_OPENRATE_FETCH_TIMEOUT", 15*time.Second),
	}

	// Never leave AllowedOrigins empty: go-chi/cors turns an empty list into
	// ["*"], which with AllowCredentials=true is both invalid per the CORS spec
	// and an any-origin free-for-all. When CORS_ORIGINS is unset, allow only
	// local dev frontends — a real deployment MUST set CORS_ORIGINS to its own
	// origins.
	if len(c.CORSOrigins) == 0 {
		c.CORSOrigins = []string{"http://localhost:5173", "http://127.0.0.1:5173"}
		log.Printf("CORS_ORIGINS is not set — defaulting to local dev origins %v; set CORS_ORIGINS explicitly for any shared or production deployment", c.CORSOrigins)
	}

	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if c.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	// In production, an unset WHATSAPP_APP_SECRET silently disables
	// X-Hub-Signature-256 verification on the inbound webhook (see
	// internal/handlers/whatsappwebhook/handler.go), letting anyone POST
	// spoofed WhatsApp messages that the chatbot processes as if they came
	// from the trusted "from" phone number. Refuse to boot in that
	// configuration rather than degrade a payment/PII-adjacent surface
	// silently. Non-production envs may still leave it unset for local
	// testing without WhatsApp credentials.
	if env == "main" && c.WhatsAppAppSecret == "" {
		return nil, fmt.Errorf("WHATSAPP_APP_SECRET is required when APP_ENV=main (production) — without it, inbound WhatsApp webhook signature verification is disabled and any caller can inject messages as any phone number")
	}
	// An operator who names an FX provider but leaves out its one required
	// setting should learn about it now, not at the first consolidated report.
	// fx.Validate is free: building any of the three converters opens no
	// socket and starts no goroutine, which is the property that made
	// embedding the rate engine acceptable at all.
	if err := fx.Validate(c.FXSettings()); err != nil {
		return nil, fmt.Errorf("FX_PROVIDER configuration: %w", err)
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
