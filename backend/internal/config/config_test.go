package config

// The FX block is the only part of Config that can cause this server to make an
// outbound connection it was not previously making, so it is the part worth
// pinning: that the default is off, that the three states map to the three the
// fx seam knows about, and that naming a provider without its one required
// setting stops the boot instead of surfacing weeks later on a report.

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestFXSettings_MapsTheEnvBlock(t *testing.T) {
	c := &Config{
		FXProvider:     "openrate-embedded",
		FXBaseURL:      "http://openrate.internal:8080",
		FXCacheTTL:     7 * time.Minute,
		FXSources:      "ecb,coinbase",
		FXMaxAge:       2 * time.Hour,
		FXFetchTimeout: 9 * time.Second,
	}
	s := c.FXSettings()

	if s.Provider != "openrate-embedded" {
		t.Errorf("Provider = %q", s.Provider)
	}
	if s.BaseURL != "http://openrate.internal:8080" {
		t.Errorf("BaseURL = %q", s.BaseURL)
	}
	if s.CacheTTL != 7*time.Minute {
		t.Errorf("CacheTTL = %v", s.CacheTTL)
	}
	if s.SourceSpec != "ecb,coinbase" {
		t.Errorf("SourceSpec = %q — the operator's source list must reach the engine intact; "+
			"dropping it silently substitutes OpenRate's default set of hosts", s.SourceSpec)
	}
	if s.MaxAge != 2*time.Hour {
		t.Errorf("MaxAge = %v", s.MaxAge)
	}
	if s.FetchTimeout != 9*time.Second {
		t.Errorf("FetchTimeout = %v", s.FetchTimeout)
	}
	if len(s.Sources) != 0 {
		t.Errorf("Sources = %v; configuration names sources by string, it does not construct them", s.Sources)
	}
}

// TestLoad_FXBlock exercises the real Load, including the boot-time validation.
func TestLoad_FXBlock(t *testing.T) {
	// Load overlays the env file for the chosen environment, which would
	// override everything set here. "main" is the one environment whose file is
	// not committed; if a developer has created one locally, this test cannot
	// control the inputs and says so rather than passing vacuously.
	root, err := repoRoot()
	if err != nil {
		t.Fatalf("repoRoot: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ".env.main")); err == nil {
		t.Skip("a local .env.main would override this test's environment")
	}

	tests := []struct {
		name    string
		env     map[string]string
		wantErr bool
		check   func(*testing.T, *Config)
	}{
		{
			name: "unset is off, and off needs nothing else",
			env:  map[string]string{},
			check: func(t *testing.T, c *Config) {
				if c.FXProvider != "" {
					t.Errorf("FXProvider = %q, want empty — FX must be off unless asked for", c.FXProvider)
				}
			},
		},
		{
			name:    "remote OpenRate without its URL refuses to boot",
			env:     map[string]string{"FX_PROVIDER": "openrate"},
			wantErr: true,
		},
		{
			name: "remote OpenRate with its URL",
			env: map[string]string{
				"FX_PROVIDER":     "openrate",
				"FX_OPENRATE_URL": "http://openrate.internal:8080",
				"FX_CACHE_TTL":    "90s",
			},
			check: func(t *testing.T, c *Config) {
				if c.FXCacheTTL != 90*time.Second {
					t.Errorf("FXCacheTTL = %v, want 90s", c.FXCacheTTL)
				}
			},
		},
		{
			name: "embedded OpenRate needs no URL",
			env: map[string]string{
				"FX_PROVIDER":               "openrate-embedded",
				"FX_OPENRATE_SOURCES":       "ecb,coinbase",
				"FX_OPENRATE_MAX_AGE":       "30m",
				"FX_OPENRATE_FETCH_TIMEOUT": "8s",
			},
			check: func(t *testing.T, c *Config) {
				if c.FXSources != "ecb,coinbase" {
					t.Errorf("FXSources = %q", c.FXSources)
				}
				if c.FXMaxAge != 30*time.Minute {
					t.Errorf("FXMaxAge = %v, want 30m", c.FXMaxAge)
				}
				if c.FXFetchTimeout != 8*time.Second {
					t.Errorf("FXFetchTimeout = %v, want 8s", c.FXFetchTimeout)
				}
			},
		},
		{
			name: "embedded OpenRate whose sources resolve to nothing refuses to boot",
			env: map[string]string{
				"FX_PROVIDER":         "openrate-embedded",
				"FX_OPENRATE_SOURCES": "no-such-source",
			},
			wantErr: true,
		},
		{
			name:    "a misspelt provider refuses to boot rather than silently disabling FX",
			env:     map[string]string{"FX_PROVIDER": "openrate-embeded"},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// Every FX_* variable is cleared first, so one case cannot inherit
			// another's (or the developer's shell's) settings.
			for _, k := range []string{
				"FX_PROVIDER", "FX_OPENRATE_URL", "FX_CACHE_TTL",
				"FX_OPENRATE_SOURCES", "FX_OPENRATE_MAX_AGE", "FX_OPENRATE_FETCH_TIMEOUT",
			} {
				t.Setenv(k, "")
			}
			t.Setenv("DATABASE_URL", "postgres://localhost/beepbite_test")
			t.Setenv("JWT_SECRET", "test-secret")
			t.Setenv("WHATSAPP_APP_SECRET", "test-app-secret")
			t.Setenv("CORS_ORIGINS", "http://localhost:5173")
			for k, v := range tc.env {
				t.Setenv(k, v)
			}

			c, err := Load("main")
			if tc.wantErr {
				if err == nil {
					t.Fatal("Load succeeded; a named FX provider missing its required setting must stop the boot")
				}
				return
			}
			if err != nil {
				t.Fatalf("Load errored: %v", err)
			}
			if tc.check != nil {
				tc.check(t, c)
			}
		})
	}
}
