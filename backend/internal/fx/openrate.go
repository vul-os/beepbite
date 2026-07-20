package fx

// openrate.go talks to OpenRate (https://github.com/vul-os/openrate), our own
// open-source exchange-rate engine, over its read-only JSON API.
//
// OpenRate models currencies as a graph and returns, alongside every rate, the
// path it took, the sources behind each leg, and an as_of timestamp for the
// freshest edge on that path. That provenance is why it is the provider here:
// a consolidated total is only defensible if the operator can see where the
// number came from and how old it is.
//
// The base URL is supplied by the operator — typically their own OpenRate
// instance. Nothing is hardcoded to a hosted endpoint, and no third-party FX
// API is called, proxied or resold.
//
// This client deliberately does NOT embed OpenRate as a Go library. The library
// form (openrate.Start) boots the full engine in-process, which would put a
// refresh loop and outbound source fetches inside the POS server whether or not
// the feature is on. An HTTP client to an address the operator names keeps the
// dependency at arm's length and the "off means silent" guarantee trivially
// true.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// OpenRate is a Converter backed by an OpenRate instance.
type OpenRate struct {
	// baseURL is the API root, e.g. "http://openrate.internal:8080/api/v1".
	baseURL string
	client  *http.Client

	// Rates are cached briefly. A dashboard renders many rows against the same
	// pair, and none of them need a separate round trip — nor should a reports
	// page be able to hammer the operator's rate service.
	mu    sync.Mutex
	cache map[string]cachedRate
	ttl   time.Duration
}

type cachedRate struct {
	rate      Rate
	expiresAt time.Time
}

// OpenRateOptions configures the client.
type OpenRateOptions struct {
	// BaseURL is the OpenRate server root. Either the bare host
	// ("http://host:8080") or the API root ("http://host:8080/api/v1") is
	// accepted; the suffix is normalised.
	BaseURL string
	// Timeout bounds a single request. Defaults to 5s — a reporting nicety must
	// never be able to hang a page.
	Timeout time.Duration
	// CacheTTL is how long a fetched rate is reused. Defaults to 5 minutes.
	CacheTTL time.Duration
	// HTTPClient overrides the transport, for tests.
	HTTPClient *http.Client
}

// NewOpenRate builds an OpenRate-backed Converter.
//
// It returns an error for a missing or unparseable BaseURL rather than falling
// back to a default endpoint: there is no correct default, and silently
// choosing one would be exactly the "surprise outbound call" this package
// promises not to make.
func NewOpenRate(opts OpenRateOptions) (*OpenRate, error) {
	raw := strings.TrimSpace(opts.BaseURL)
	if raw == "" {
		return nil, fmt.Errorf("fx: OpenRate base URL is required")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("fx: invalid OpenRate base URL %q", opts.BaseURL)
	}

	base := strings.TrimRight(u.String(), "/")
	if !strings.HasSuffix(base, "/api/v1") {
		base += "/api/v1"
	}

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ttl := opts.CacheTTL
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}

	return &OpenRate{
		baseURL: base,
		client:  client,
		cache:   make(map[string]cachedRate),
		ttl:     ttl,
	}, nil
}

// Enabled always reports true: an OpenRate client only exists when the operator
// configured one.
func (o *OpenRate) Enabled() bool { return true }

// Name identifies the provider in report footers and diagnostics.
func (o *OpenRate) Name() string { return "openrate" }

// convertResponse mirrors GET /api/v1/convert.
type convertResponse struct {
	From   string  `json:"from"`
	To     string  `json:"to"`
	Amount float64 `json:"amount"`
	Result float64 `json:"result"`
	Rate   struct {
		Rate float64 `json:"rate"`
		Hops int     `json:"hops"`
		AsOf string  `json:"as_of"`
	} `json:"rate"`
}

// Rate fetches the current rate for a pair.
//
// It uses /convert with amount=1 rather than /rates, because /rates returns
// every currency against a base — a much larger response for a single pair, and
// one whose per-pair as_of would then have to be picked out anyway.
func (o *OpenRate) Rate(ctx context.Context, from, to string) (Rate, error) {
	from = strings.ToUpper(strings.TrimSpace(from))
	to = strings.ToUpper(strings.TrimSpace(to))

	if from == "" || to == "" {
		return Rate{}, fmt.Errorf("fx: both currencies are required")
	}
	if from == to {
		// Identity, answered locally. A same-currency "conversion" must never
		// depend on a network call succeeding.
		return Rate{From: from, To: to, Value: 1, AsOf: time.Now(), Provider: o.Name()}, nil
	}

	key := from + ">" + to
	o.mu.Lock()
	if c, ok := o.cache[key]; ok && time.Now().Before(c.expiresAt) {
		o.mu.Unlock()
		return c.rate, nil
	}
	o.mu.Unlock()

	endpoint := fmt.Sprintf("%s/convert?from=%s&to=%s&amount=1",
		o.baseURL, url.QueryEscape(from), url.QueryEscape(to))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Rate{}, fmt.Errorf("fx: build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := o.client.Do(req)
	if err != nil {
		return Rate{}, fmt.Errorf("fx: openrate request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		// OpenRate returns 404 when no path connects the pair in the current
		// snapshot — a real answer ("I cannot price this"), not a transport
		// failure, so it gets its own sentinel.
		return Rate{}, fmt.Errorf("%w: %s→%s", ErrUnsupportedPair, from, to)
	}
	if resp.StatusCode != http.StatusOK {
		return Rate{}, fmt.Errorf("fx: openrate returned %s", resp.Status)
	}

	var body convertResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Rate{}, fmt.Errorf("fx: decode openrate response: %w", err)
	}
	if body.Rate.Rate <= 0 {
		return Rate{}, fmt.Errorf("%w: %s→%s returned a non-positive rate", ErrUnsupportedPair, from, to)
	}

	rate := Rate{
		From:     from,
		To:       to,
		Value:    body.Rate.Rate,
		AsOf:     parseAsOf(body.Rate.AsOf),
		Provider: o.Name(),
	}

	o.mu.Lock()
	o.cache[key] = cachedRate{rate: rate, expiresAt: time.Now().Add(o.ttl)}
	o.mu.Unlock()

	return rate, nil
}

// Convert converts an amount, applying the rate to integer minor units.
//
// The conversion is done locally via Apply rather than by trusting OpenRate's
// own `result` field, because `result` is a major-unit float and this codebase
// deals in minor units — doing the rescale here keeps the exponent handling in
// one place and the rounding rule the same as everywhere else in the system.
func (o *OpenRate) Convert(ctx context.Context, minor int64, from string, fromDecimals int, to string, toDecimals int) (Conversion, error) {
	rate, err := o.Rate(ctx, from, to)
	if err != nil {
		return Conversion{}, err
	}
	return Conversion{
		FromMinor:    minor,
		FromDecimals: fromDecimals,
		ToMinor:      Apply(minor, rate.Value, fromDecimals, toDecimals),
		ToDecimals:   toDecimals,
		Rate:         rate,
	}, nil
}

// parseAsOf reads OpenRate's RFC-3339 as_of, returning the zero time when it is
// absent or unparseable.
//
// A zero AsOf is meaningful downstream: Rate.Stale treats it as "unknown age"
// and callers should render it as such rather than as "just now".
func parseAsOf(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}

var _ Converter = (*OpenRate)(nil)

// ---------------------------------------------------------------------------
// Construction from configuration
// ---------------------------------------------------------------------------

// FromEnv builds the Converter described by a configuration triple, defaulting
// to Disabled.
//
// provider is matched case-insensitively; anything other than "openrate" —
// including the empty string, which is the shipped default — yields Disabled
// with no error. Misconfiguration of an explicitly requested provider IS an
// error, because an operator who asked for FX and got silence would reasonably
// assume it was working.
func FromEnv(provider, baseURL string, cacheTTL time.Duration) (Converter, error) {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "", "off", "disabled", "none":
		return Disabled{}, nil
	case "openrate":
		return NewOpenRate(OpenRateOptions{BaseURL: baseURL, CacheTTL: cacheTTL})
	default:
		return Disabled{}, fmt.Errorf("fx: unknown provider %q (want \"openrate\" or empty to disable)", provider)
	}
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
