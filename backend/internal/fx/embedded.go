package fx

// embedded.go runs OpenRate (https://github.com/vul-os/openrate) inside the POS
// process as a Go library, with no rate server to deploy and no socket between
// the report and the number.
//
// # Why this is now safe
//
// The historical objection to embedding was concrete: the only library entry
// point used to be openrate.Start, which bound a listener, launched a refresh
// loop and began fetching from the internet before it returned. Linking that
// into the POS put a background network dependency in every deployment,
// whether or not the operator had asked for currency conversion.
//
// OpenRate 0.1.2 split those responsibilities apart, so the risk is gone at the
// source rather than merely avoided here:
//
//   - openrate.NewEngine builds an INERT value. It starts no goroutine, opens
//     no socket, reads no environment variable and sends no packet. It answers
//     conversions from whatever snapshot it holds, and says "I don't know"
//     until something gives it one.
//   - openrate.NewRefresher is the only type that can touch the network, and
//     even it does nothing until Refresh or Run is called.
//
// # What "off" means here
//
// Off is structural, not documentary. When FX is disabled, New returns
// Disabled and NO Embedded exists — so there is no Engine, no Refresher, no
// source adapter and no code path that could emit a packet. It is not that the
// fetch is skipped; it is that the thing that fetches was never built. See
// TestOff_IsSilent, which counts round trips through an injected transport and
// counts goroutines, rather than inferring silence from an absent error.
//
// # No background loop
//
// Even when embedded FX is ON, this type owns no goroutine that outlives a
// call. OpenRate offers Refresher.Run — a ticker loop the caller launches — and
// this package deliberately does not use it: a till should not hold an open
// schedule of outbound requests for a reporting feature that may be opened once
// a month. Instead the snapshot is refreshed lazily, on the first Rate call
// that finds it missing or older than MaxAge, inside that caller's context and
// bounded by that caller's deadline.
//
// A host that would rather pay the fetch cost up front can call Refresh itself,
// on a ticker it owns and cancels. Ownership of any recurring schedule stays
// with the host, where it can be seen.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/vul-os/openrate"
	"github.com/vul-os/openrate/fxsource"
)

// Default tuning for the embedded engine.
const (
	// defaultMaxAge is how stale the in-process snapshot may become before the
	// next lookup refreshes it. Reference rates are published daily; an hour is
	// far tighter than the data changes and still means at most 24 fetches a
	// day from a till that is being used all day.
	defaultMaxAge = time.Hour

	// defaultFetchTimeout bounds a single source fetch. OpenRate's own default
	// is 50s, sized for the SARB host; that is far too long to sit inside a
	// report request, and a source that slow simply gets dropped from this
	// refresh and retried on the next one.
	defaultFetchTimeout = 15 * time.Second

	// defaultMinRetry is the floor between refresh ATTEMPTS. Without it, a
	// dashboard that polls while every source is down would retry on every
	// single request.
	defaultMinRetry = 30 * time.Second
)

// Embedded is a Converter backed by an in-process OpenRate engine.
//
// It is safe for concurrent use. At most one refresh runs at a time; callers
// that arrive during one wait for it rather than starting their own.
type Embedded struct {
	engine    *openrate.Engine
	refresher *openrate.Refresher

	maxAge   time.Duration
	minRetry time.Duration
	now      func() time.Time

	// mu serialises refresh attempts and guards the three fields below. It is
	// held across the fetch, which is what makes a stampede impossible; reads
	// of the snapshot never take it, because the Engine has its own lock and
	// keeps serving the previous snapshot throughout.
	mu          sync.Mutex
	lastAttempt time.Time
	lastErr     error

	// loadedAt is when THIS type last loaded rates, read from the same clock
	// as everything else here. Deliberately not Snapshot.BuiltAt: the
	// Refresher stamps that from time.Now regardless of the clock the host
	// injected, so comparing the two would mix clocks and make age meaningless
	// under a test clock — the one condition the staleness rule most needs to
	// be testable under.
	//
	// It is atomic, not guarded by mu, so a lookup can establish that the
	// snapshot is fresh without queueing behind an in-flight refresh. A report
	// holding a rate that is 61 minutes old should render it, not block for a
	// slow central bank.
	loadedAt atomic.Int64 // unix nanoseconds; 0 means never loaded
}

// EmbeddedOptions configures the in-process engine.
type EmbeddedOptions struct {
	// Sources are the rate providers, supplied explicitly. When empty,
	// SourceSpec is resolved instead.
	Sources []fxsource.Source

	// SourceSpec is a comma-separated source list, e.g. "ecb,coinbase". Empty
	// means fxsource.DefaultSources (ecb, coinbase, luno, sarb).
	//
	// It is resolved with fxsource.Build, which is pure, and NOT with
	// fxsource.FromEnv, which would let an OPENRATE_SOURCES variable in the
	// POS process's environment widen the set of hosts this server contacts
	// without the operator having named them here.
	SourceSpec string

	// MaxAge is how stale the snapshot may be before a lookup refreshes it.
	// Defaults to one hour.
	MaxAge time.Duration

	// FetchTimeout bounds one source fetch. Defaults to 15s.
	FetchTimeout time.Duration

	// MinRetry is the floor between refresh attempts. Defaults to 30s.
	MinRetry time.Duration

	// Logger receives one warning per failed source fetch. nil means
	// slog.Default().
	Logger *slog.Logger

	// Now overrides the clock, for tests.
	Now func() time.Time
}

// NewEmbedded builds an in-process OpenRate-backed Converter.
//
// Nothing here touches the network: it constructs an Engine (inert by
// construction) and a Refresher (which fetches only when asked). A caller may
// build one and never use it at no cost — a property config validation relies
// on, and one TestEmbedded_ConstructionIsInert pins.
//
// It returns an error when the source spec resolves to nothing, rather than
// silently producing a converter that reports Enabled() but can never price
// anything.
func NewEmbedded(opts EmbeddedOptions) (*Embedded, error) {
	srcs := opts.Sources
	if len(srcs) == 0 {
		srcs = fxsource.Build(opts.SourceSpec)
	}
	if len(srcs) == 0 {
		return nil, fmt.Errorf("fx: embedded OpenRate needs at least one rate source; %q named none known", opts.SourceSpec)
	}

	log := opts.Logger
	if log == nil {
		log = slog.Default()
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	maxAge := opts.MaxAge
	if maxAge <= 0 {
		maxAge = defaultMaxAge
	}
	fetchTimeout := opts.FetchTimeout
	if fetchTimeout <= 0 {
		fetchTimeout = defaultFetchTimeout
	}
	minRetry := opts.MinRetry
	if minRetry <= 0 {
		minRetry = defaultMinRetry
	}

	engine := openrate.NewEngine(openrate.EngineOptions{Logger: log, Now: now})
	refresher := openrate.NewRefresher(engine, openrate.RefreshOptions{
		Sources:      srcs,
		FetchTimeout: fetchTimeout,
		Logger:       log,
	})

	return &Embedded{
		engine:    engine,
		refresher: refresher,
		maxAge:    maxAge,
		minRetry:  minRetry,
		now:       now,
	}, nil
}

// Enabled always reports true: an Embedded only exists when the operator asked
// for embedded FX.
func (e *Embedded) Enabled() bool { return true }

// Name identifies the provider in report footers and diagnostics. It is
// deliberately distinct from the HTTP client's "openrate": the two answer from
// different snapshots refreshed on different schedules, and an operator
// comparing two reports needs to see which one produced a figure.
func (e *Embedded) Name() string { return "openrate-embedded" }

// Sources reports the last fetch outcome for each configured source, in
// configuration order — for an admin diagnostics view that has to explain why a
// rate is missing or old.
func (e *Embedded) Sources() []openrate.SourceStatus { return e.refresher.Status() }

// Refresh fetches every source once and loads the result, ignoring the age of
// the current snapshot and the retry floor.
//
// It exists so a host that wants rates warm before the first report can pay for
// them on its own schedule — at boot, or on a ticker it owns. It is never
// called by this package; lookups refresh lazily instead.
func (e *Embedded) Refresh(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.refresh(ctx)
}

// Rate returns the current rate for a pair, refreshing first if the snapshot is
// missing or stale.
func (e *Embedded) Rate(ctx context.Context, from, to string) (Rate, error) {
	from = strings.ToUpper(strings.TrimSpace(from))
	to = strings.ToUpper(strings.TrimSpace(to))

	if from == "" || to == "" {
		return Rate{}, fmt.Errorf("fx: both currencies are required")
	}
	if from == to {
		// Identity, answered locally — and, unlike the HTTP client, without
		// even needing a snapshot to exist.
		return Rate{From: from, To: to, Value: 1, AsOf: e.now(), Provider: e.Name()}, nil
	}

	if err := e.ensureRates(ctx); err != nil {
		return Rate{}, err
	}

	conv, err := e.engine.Convert(from, to, 1)
	switch {
	case errors.Is(err, openrate.ErrUnknownPair):
		// A real answer ("I cannot price this"), not a transport failure — the
		// same distinction the HTTP client draws from a 404.
		return Rate{}, fmt.Errorf("%w: %s→%s", ErrUnsupportedPair, from, to)
	case err != nil:
		return Rate{}, fmt.Errorf("fx: openrate convert %s→%s: %w", from, to, err)
	}
	if conv.Rate <= 0 {
		return Rate{}, fmt.Errorf("%w: %s→%s resolved to a non-positive rate", ErrUnsupportedPair, from, to)
	}

	return Rate{
		From:     from,
		To:       to,
		Value:    conv.Rate,
		AsOf:     conv.AsOf,
		Provider: e.Name(),
	}, nil
}

// Convert converts an amount, applying the rate to integer minor units.
func (e *Embedded) Convert(ctx context.Context, minor int64, from string, fromDecimals int, to string, toDecimals int) (Conversion, error) {
	rate, err := e.Rate(ctx, from, to)
	if err != nil {
		return Conversion{}, err
	}
	return applyRate(rate, minor, fromDecimals, toDecimals), nil
}

// ensureRates refreshes the snapshot if it is empty or older than MaxAge.
//
// A stale-but-present snapshot is never fatal: if a refresh fails while rates
// are already loaded, the old ones are used and Rate.AsOf tells the reader how
// old they are, which is the whole point of carrying provenance. Only a failure
// with NOTHING loaded is reported as an error, because there is no number to
// show.
func (e *Embedded) ensureRates(ctx context.Context) error {
	if e.fresh() {
		return nil
	}

	e.mu.Lock()
	defer e.mu.Unlock()

	// Re-check: another caller may have refreshed while this one waited.
	if e.fresh() {
		return nil
	}

	if !e.lastAttempt.IsZero() && e.now().Sub(e.lastAttempt) < e.minRetry {
		if e.hasRates() {
			return nil
		}
		if e.lastErr != nil {
			return e.lastErr
		}
		return fmt.Errorf("%w: the embedded engine holds no rates yet", ErrUnsupportedPair)
	}

	err := e.refresh(ctx)
	if err != nil && e.hasRates() {
		// Serve what we have; the caller sees the age via Rate.AsOf.
		return nil
	}
	return err
}

// refresh performs the fetch and records the outcome. Callers hold e.mu.
func (e *Embedded) refresh(ctx context.Context) error {
	now := e.now()
	e.lastAttempt = now
	if err := e.refresher.Refresh(ctx); err != nil {
		e.lastErr = fmt.Errorf("fx: embedded openrate refresh failed: %w", err)
		return e.lastErr
	}
	e.lastErr = nil
	e.loadedAt.Store(now.UnixNano())
	return nil
}

// fresh reports whether rates are loaded and younger than MaxAge.
func (e *Embedded) fresh() bool {
	loaded := e.loadedAt.Load()
	if loaded == 0 {
		return false
	}
	return e.now().Sub(time.Unix(0, loaded)) < e.maxAge
}

// hasRates reports whether the snapshot holds anything at all.
func (e *Embedded) hasRates() bool {
	return len(e.engine.Snapshot().Currencies) > 0
}

var _ Converter = (*Embedded)(nil)
