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
