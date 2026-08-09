package fx

// provider.go turns configuration into a Converter.
//
// There are exactly three states, and an operator picks one with FX_PROVIDER:
//
//	off       (the default)  no conversion, and no code capable of a network call
//	embedded  "openrate-embedded"  OpenRate linked in; this process fetches rates
//	remote    "openrate"           an OpenRate server the operator already runs
//
// The three are a strict ladder of what the POS process is allowed to do, and
// New is the only place that decides. "Off" is not a flag consulted deeper
// down: it returns Disabled, and no Engine, Refresher, source adapter or HTTP
// client is ever constructed. There is nothing left that could emit a packet.

import (
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/vul-os/openrate/fxsource"
)

// Settings is the configuration the host hands to New — normally straight from
// internal/config, which reads it from the FX_* environment variables.
type Settings struct {
	// Provider selects the mode, case-insensitively:
	//
	//	"", "off", "none", "disabled"     off
	//	"openrate-embedded", "embedded"   in-process engine
	//	"openrate", "openrate-remote"     HTTP client to BaseURL
	//
	// Anything else is an error. An operator who names a provider and gets
	// silence would reasonably assume FX was working.
	Provider string

	// BaseURL is the OpenRate server root. Remote mode only, and required
	// there — there is no correct default endpoint and inventing one would be
	// exactly the surprise outbound call this package promises not to make.
	BaseURL string

	// CacheTTL is how long a fetched rate is reused. Remote mode only: the
	// embedded engine answers from an in-memory snapshot, so there is no round
	// trip to save and nothing to cache.
	CacheTTL time.Duration

	// SourceSpec names the rate sources for embedded mode, e.g. "ecb,coinbase".
	// Empty means OpenRate's default set. Embedded mode only.
	SourceSpec string

	// Sources supplies source adapters directly, bypassing SourceSpec.
	// Embedded mode only.
	Sources []fxsource.Source

	// MaxAge is how stale the embedded snapshot may be before a lookup
	// refreshes it. Embedded mode only; defaults to an hour.
	MaxAge time.Duration

	// FetchTimeout bounds one source fetch. Embedded mode only; defaults to
	// 15s.
	FetchTimeout time.Duration

	// Logger receives the provider's diagnostics. nil means slog.Default().
	Logger *slog.Logger
}

// New builds the Converter the settings describe, defaulting to Disabled.
func New(s Settings) (Converter, error) {
	switch strings.ToLower(strings.TrimSpace(s.Provider)) {
	case "", "off", "disabled", "none":
		// Note what is NOT built here. This is the whole of the "off means
		// silent" guarantee: not a suppressed call, an absent caller.
		return Disabled{}, nil

	case "openrate-embedded", "embedded":
		return NewEmbedded(EmbeddedOptions{
			Sources:      s.Sources,
			SourceSpec:   s.SourceSpec,
			MaxAge:       s.MaxAge,
			FetchTimeout: s.FetchTimeout,
			Logger:       s.Logger,
		})

	case "openrate", "openrate-remote":
		return NewOpenRate(OpenRateOptions{BaseURL: s.BaseURL, CacheTTL: s.CacheTTL})

	default:
		return Disabled{}, fmt.Errorf(
			"fx: unknown provider %q (want %q for an OpenRate server, %q to run the engine in-process, or empty to disable)",
			s.Provider, "openrate", "openrate-embedded")
	}
}

// Validate reports whether settings would produce a working Converter, without
// keeping one.
//
// It is implemented by building and discarding, which is free precisely because
// of the property the embedded mode is built on: constructing a converter
// touches nothing. No socket is opened, no goroutine started, no environment
// read, no packet sent — for any of the three modes. TestConstructionIsInert
// pins that, so this cheat cannot quietly stop being a cheat.
//
// It exists so a misconfigured FX triple fails at boot rather than at the first
// consolidated report, three weeks later, in front of a customer.
func Validate(s Settings) error {
	_, err := New(s)
	return err
}

// ParseTTL reads a duration from a configuration string, falling back to `def`
// for empty or malformed input. Bare integers are read as seconds.
func ParseTTL(s string, def time.Duration) time.Duration {
	s = strings.TrimSpace(s)
	if s == "" {
		return def
	}
	if d, err := time.ParseDuration(s); err == nil && d > 0 {
		return d
	}
	if n, err := strconv.Atoi(s); err == nil && n > 0 {
		return time.Duration(n) * time.Second
	}
	return def
}
