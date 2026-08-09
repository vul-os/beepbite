package fx

// embedded_test.go covers the in-process OpenRate engine, and the negative
// claim that made embedding acceptable in the first place: that FX being off
// leaves nothing behind that could talk to the network.
//
// The negative assertions here are deliberately made by COUNTING — round trips
// through an injected transport, Fetch calls on injected sources, live
// goroutines — and never by observing that no error occurred. A converter that
// silently did nothing and a converter that quietly fetched would both produce
// no error; only a counter tells them apart. Each counter is paired with a
// positive control in the same test, so a counter that stopped counting fails
// the suite instead of passing it.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	orfx "github.com/vul-os/openrate/fx"
	"github.com/vul-os/openrate/fxsource"
)

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

// recordingTransport counts every HTTP round trip attempted through it and
// refuses to perform any of them. Installed as http.DefaultTransport it sees
// traffic from every client built without an explicit Transport — which is how
// all but one of OpenRate's source adapters build theirs — so a fetch this test
// did not authorise is counted rather than executed.
type recordingTransport struct {
	n atomic.Int64
}

func (rt *recordingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.n.Add(1)
	return nil, fmt.Errorf("recordingTransport: refusing an unauthorised request to %s", req.URL)
}

func (rt *recordingTransport) count() int { return int(rt.n.Load()) }

// installRecordingTransport swaps the process default transport for the
// duration of the test. Tests using it must not run in parallel.
func installRecordingTransport(t *testing.T) *recordingTransport {
	t.Helper()
	rt := &recordingTransport{}
	orig := http.DefaultTransport
	http.DefaultTransport = rt
	t.Cleanup(func() { http.DefaultTransport = orig })
	return rt
}

// fakeSource is an fxsource.Source that yields fixed edges and counts how many
// times it was asked to fetch. It is the direct instrument for "were the
// operator's configured sources contacted?".
type fakeSource struct {
	name  string
	edges []orfx.Edge
	err   error

	fetches atomic.Int64
	delay   time.Duration
}

func (f *fakeSource) Name() string { return f.name }

func (f *fakeSource) Fetch(ctx context.Context) ([]orfx.Edge, error) {
	f.fetches.Add(1)
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.edges, nil
}

func (f *fakeSource) count() int { return int(f.fetches.Load()) }

// zarUSD is a source quoting a single pair, so conversions are exactly
// predictable: 1 ZAR = 0.054 USD.
func zarUSD(quotedAt time.Time) *fakeSource {
	return &fakeSource{
		name: "fake",
		edges: []orfx.Edge{
			{From: "ZAR", To: "USD", Rate: 0.054, Source: "fake", Time: quotedAt},
		},
	}
}

// settledGoroutines waits for the runtime's goroutine count to stop moving and
// returns it. Without settling, a count taken right after a previous test's
// httptest server closed measures that test's teardown, not this test's work.
func settledGoroutines(t *testing.T) int {
	t.Helper()
	var last, stable int
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		n := runtime.NumGoroutine()
		if n == last {
			if stable++; stable >= 3 {
				return n
			}
		} else {
			stable, last = 0, n
		}
		time.Sleep(10 * time.Millisecond)
	}
	return runtime.NumGoroutine()
}

// ---------------------------------------------------------------------------
// Off means silent — structurally
// ---------------------------------------------------------------------------

// TestOff_IsSilent is the load-bearing test of this change. Embedding a rate
// engine into the POS is only acceptable if switching FX off leaves nothing
// that can reach the network, and "nothing" has to be measured.
//
// Three independent instruments, all of which must read zero:
//
//  1. every HTTP round trip the process attempts, via the default transport
//  2. every Fetch call on the sources the operator configured
//  3. every goroutine still alive afterwards
//
// Each is then given a positive control in the same test — a deliberate request
// and a deliberate fetch — so that an instrument which had silently stopped
// measuring anything fails here rather than certifying silence.
func TestOff_IsSilent(t *testing.T) {
	rt := installRecordingTransport(t)
	src := zarUSD(time.Now())

	before := settledGoroutines(t)

	// Everything an enabled deployment would need is present in the settings.
	// The ONLY difference is that the provider is off.
	c, err := New(Settings{
		Provider:   "",
		BaseURL:    "http://openrate.invalid:8080",
		SourceSpec: "ecb,coinbase,luno,sarb",
		Sources:    []fxsource.Source{src},
	})
	if err != nil {
		t.Fatalf("New errored: %v", err)
	}
	if _, ok := c.(Disabled); !ok {
		t.Fatalf("FX off produced %T; it must produce Disabled, so that no engine, refresher, "+
			"source adapter or HTTP client exists to make a call in the first place", c)
	}

	// Exercise the seam the way a consolidated report would.
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if _, err := c.Convert(ctx, 100000, "ZAR", 2, "USD", 2); !errors.Is(err, ErrDisabled) {
			t.Fatalf("Convert err = %v, want ErrDisabled", err)
		}
		if _, err := c.Rate(ctx, "ZAR", "USD"); !errors.Is(err, ErrDisabled) {
			t.Fatalf("Rate err = %v, want ErrDisabled", err)
		}
	}

	after := settledGoroutines(t)

	if got := rt.count(); got != 0 {
		t.Errorf("FX off attempted %d HTTP round trip(s); it must attempt none", got)
	}
	if got := src.count(); got != 0 {
		t.Errorf("FX off fetched from the configured source %d time(s); it must never contact it", got)
	}
	if after > before {
		t.Errorf("FX off left %d extra goroutine(s) running (%d → %d); it must start none",
			after-before, before, after)
	}

	// --- positive controls: prove each counter can move at all -------------

	if resp, err := http.DefaultClient.Get("http://openrate.invalid:8080/api/v1/convert"); err == nil {
		resp.Body.Close()
	}
	if got := rt.count(); got != 1 {
		t.Errorf("round-trip counter read %d after one deliberate request; the counter is not "+
			"measuring anything, so its zero above proved nothing", got)
	}

	warm, err := NewEmbedded(EmbeddedOptions{Sources: []fxsource.Source{src}})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}
	if _, err := warm.Rate(ctx, "ZAR", "USD"); err != nil {
		t.Fatalf("enabled embedded Rate errored: %v", err)
	}
	if got := src.count(); got != 1 {
		t.Errorf("source fetch counter read %d after one deliberate lookup; the counter is not "+
			"measuring anything, so its zero above proved nothing", got)
	}
}

// TestConstructionIsInert backs the claim Validate relies on: building any of
// the three converters performs no I/O and starts nothing. That is what makes
// "validate by constructing and discarding" free, and what makes it safe for a
// host to build an Embedded behind a feature flag it never turns on.
func TestConstructionIsInert(t *testing.T) {
	rt := installRecordingTransport(t)
	src := zarUSD(time.Now())

	before := settledGoroutines(t)

	for _, provider := range []string{"", "openrate", "openrate-embedded"} {
		for i := 0; i < 10; i++ {
			if _, err := New(Settings{
				Provider: provider,
				BaseURL:  "http://openrate.invalid:8080",
				Sources:  []fxsource.Source{src},
			}); err != nil {
				t.Fatalf("New(%q) errored: %v", provider, err)
			}
		}
	}
	// The default source set builds real adapters — including the paid ones'
	// key lookups — and must still touch nothing.
	if _, err := NewEmbedded(EmbeddedOptions{SourceSpec: "ecb,coinbase,luno,sarb,oxr,polygon"}); err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}

	after := settledGoroutines(t)

	if got := rt.count(); got != 0 {
		t.Errorf("constructing converters attempted %d HTTP round trip(s); construction must be inert", got)
	}
	if got := src.count(); got != 0 {
		t.Errorf("constructing converters fetched %d time(s); construction must be inert", got)
	}
	if after > before {
		t.Errorf("constructing converters left %d extra goroutine(s) (%d → %d)", after-before, before, after)
	}
}

// TestEmbedded_OwnsNoBackgroundGoroutine: even switched ON and used, the
// embedded engine must not leave a refresh loop running in the POS process.
// Any recurring schedule belongs to the host, where it can be seen and
// cancelled.
func TestEmbedded_OwnsNoBackgroundGoroutine(t *testing.T) {
	src := zarUSD(time.Now())
	before := settledGoroutines(t)

	e, err := NewEmbedded(EmbeddedOptions{Sources: []fxsource.Source{src}})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := e.Rate(context.Background(), "ZAR", "USD"); err != nil {
			t.Fatalf("Rate errored: %v", err)
		}
	}
	if src.count() == 0 {
		t.Fatal("the engine never fetched, so this test proves nothing about what it leaves behind")
	}

	if after := settledGoroutines(t); after > before {
		t.Errorf("embedded FX left %d goroutine(s) running after use (%d → %d); it must own no "+
			"loop that outlives a call", after-before, before, after)
	}
}

// ---------------------------------------------------------------------------
// Embedded conversion
// ---------------------------------------------------------------------------

func TestEmbedded_ConvertCarriesProvenance(t *testing.T) {
	quotedAt := time.Date(2026, 7, 20, 8, 59, 58, 0, time.UTC)
	src := zarUSD(quotedAt)

	e, err := NewEmbedded(EmbeddedOptions{Sources: []fxsource.Source{src}})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}

	// R1,000.00 → USD at 0.054.
	conv, err := e.Convert(context.Background(), 100000, "ZAR", 2, "USD", 2)
	if err != nil {
		t.Fatalf("Convert errored: %v", err)
	}

	if conv.ToMinor != 5400 {
		t.Errorf("ToMinor = %d, want 5400 ($54.00)", conv.ToMinor)
	}
	if conv.FromMinor != 100000 {
		t.Errorf("FromMinor = %d; the source amount must be preserved verbatim", conv.FromMinor)
	}
	if conv.Rate.Value != 0.054 {
		t.Errorf("Rate.Value = %v, want 0.054", conv.Rate.Value)
	}
	// AsOf must be the QUOTE's timestamp, not the moment of the fetch. A rate
	// pulled today from a file published on Friday is a Friday rate.
	if !conv.Rate.AsOf.Equal(quotedAt) {
		t.Errorf("Rate.AsOf = %v, want the quote time %v — a converted figure carrying the fetch "+
			"time instead of the quote time overstates its freshness", conv.Rate.AsOf, quotedAt)
	}
	if conv.Rate.Provider != "openrate-embedded" {
		t.Errorf("Rate.Provider = %q, want openrate-embedded", conv.Rate.Provider)
	}
	if conv.Rate.From != "ZAR" || conv.Rate.To != "USD" {
		t.Errorf("Rate pair = %s→%s, want ZAR→USD", conv.Rate.From, conv.Rate.To)
	}
}

// TestEmbedded_AgreesWithTheHTTPClient: the same rate must produce the same
// money either way round. The two providers exist so an operator can choose a
// deployment, not two answers.
func TestEmbedded_AgreesWithTheHTTPClient(t *testing.T) {
	quotedAt := time.Date(2026, 7, 20, 8, 59, 58, 0, time.UTC)

	embedded, err := NewEmbedded(EmbeddedOptions{Sources: []fxsource.Source{zarUSD(quotedAt)}})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}
	remote, _ := newTestOpenRate(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(convertBody)) // same 0.054, same as_of
	})

	cases := []struct {
		minor          int64
		from           string
		fromDec, toDec int
	}{
		{100000, "ZAR", 2, 2},
		{1, "ZAR", 2, 2},
		{-100000, "ZAR", 2, 2},
		{999999999, "ZAR", 2, 0},
	}
	for _, tc := range cases {
		got, err := embedded.Convert(context.Background(), tc.minor, tc.from, tc.fromDec, "USD", tc.toDec)
		if err != nil {
			t.Fatalf("embedded Convert errored: %v", err)
		}
		want, err := remote.Convert(context.Background(), tc.minor, tc.from, tc.fromDec, "USD", tc.toDec)
		if err != nil {
			t.Fatalf("remote Convert errored: %v", err)
		}
		if got.ToMinor != want.ToMinor {
			t.Errorf("%d %s: embedded gave %d, the HTTP client gave %d — the two paths must not "+
				"disagree about the money", tc.minor, tc.from, got.ToMinor, want.ToMinor)
		}
		if !got.Rate.AsOf.Equal(want.Rate.AsOf) {
			t.Errorf("%d %s: as_of differs (%v vs %v)", tc.minor, tc.from, got.Rate.AsOf, want.Rate.AsOf)
		}
	}
}

func TestEmbedded_SameCurrencyNeedsNoFetch(t *testing.T) {
	// A source that always fails: even so, USD→USD must succeed without ever
	// being asked.
	src := &fakeSource{name: "broken", err: errors.New("source is down")}

	e, err := NewEmbedded(EmbeddedOptions{Sources: []fxsource.Source{src}})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}

	conv, err := e.Convert(context.Background(), 12345, "USD", 2, "USD", 2)
	if err != nil {
		t.Fatalf("same-currency Convert errored: %v", err)
	}
	if conv.ToMinor != 12345 {
		t.Errorf("ToMinor = %d, want the amount unchanged", conv.ToMinor)
	}
	if got := src.count(); got != 0 {
		t.Errorf("same-currency conversion fetched %d time(s); it must fetch none", got)
	}
}

func TestEmbedded_FetchesOncePerMaxAge(t *testing.T) {
	src := zarUSD(time.Now())
	clock := &fakeClock{t: time.Date(2026, 7, 20, 9, 0, 0, 0, time.UTC)}

	e, err := NewEmbedded(EmbeddedOptions{
		Sources: []fxsource.Source{src},
		MaxAge:  time.Hour,
		Now:     clock.now,
	})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}

	for i := 0; i < 20; i++ {
		if _, err := e.Rate(context.Background(), "ZAR", "USD"); err != nil {
			t.Fatalf("Rate errored: %v", err)
		}
	}
	if got := src.count(); got != 1 {
		t.Errorf("20 lookups inside one MaxAge window fetched %d time(s); want 1 — a report must "+
			"not re-fetch reference rates per row", got)
	}

	clock.advance(59 * time.Minute)
	if _, err := e.Rate(context.Background(), "ZAR", "USD"); err != nil {
		t.Fatalf("Rate errored: %v", err)
	}
	if got := src.count(); got != 1 {
		t.Errorf("a lookup 59 minutes in fetched again (%d total); MaxAge is an hour", got)
	}

	clock.advance(2 * time.Minute) // now 61 minutes old
	if _, err := e.Rate(context.Background(), "ZAR", "USD"); err != nil {
		t.Fatalf("Rate errored: %v", err)
	}
	if got := src.count(); got != 2 {
		t.Errorf("a lookup past MaxAge fetched %d time(s) in total; want 2 — stale rates must be "+
			"refreshed", got)
	}
}

// TestEmbedded_ConcurrentLookupsFetchOnce: a dashboard rendering many rows at
// once must not stampede the sources.
func TestEmbedded_ConcurrentLookupsFetchOnce(t *testing.T) {
	src := zarUSD(time.Now())
	src.delay = 50 * time.Millisecond // wide enough for every caller to pile up

	e, err := NewEmbedded(EmbeddedOptions{Sources: []fxsource.Source{src}})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}

	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := e.Rate(context.Background(), "ZAR", "USD"); err != nil {
				t.Errorf("Rate errored: %v", err)
			}
		}()
	}
	wg.Wait()

	if got := src.count(); got != 1 {
		t.Errorf("32 concurrent lookups fetched %d time(s); want 1", got)
	}
}

func TestEmbedded_UnreachablePairIsDistinguishable(t *testing.T) {
	e, err := NewEmbedded(EmbeddedOptions{Sources: []fxsource.Source{zarUSD(time.Now())}})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}

	_, err = e.Rate(context.Background(), "ZAR", "XTS")
	if !errors.Is(err, ErrUnsupportedPair) {
		t.Errorf("err = %v, want ErrUnsupportedPair — 'I cannot price this' is an answer, not a failure", err)
	}
}

// TestEmbedded_StaleRatesSurviveAFailedRefresh: once rates are loaded, a source
// outage must degrade to an OLD figure carrying its real age, not to no figure.
func TestEmbedded_StaleRatesSurviveAFailedRefresh(t *testing.T) {
	quotedAt := time.Date(2026, 7, 20, 8, 0, 0, 0, time.UTC)
	src := zarUSD(quotedAt)
	clock := &fakeClock{t: time.Date(2026, 7, 20, 9, 0, 0, 0, time.UTC)}

	e, err := NewEmbedded(EmbeddedOptions{
		Sources:  []fxsource.Source{src},
		MaxAge:   time.Hour,
		MinRetry: time.Minute,
		Now:      clock.now,
	})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}
	if _, err := e.Rate(context.Background(), "ZAR", "USD"); err != nil {
		t.Fatalf("first Rate errored: %v", err)
	}

	// The source goes down, and the snapshot ages past MaxAge.
	src.err = errors.New("source is down")
	clock.advance(2 * time.Hour)

	rate, err := e.Rate(context.Background(), "ZAR", "USD")
	if err != nil {
		t.Fatalf("Rate errored after a failed refresh: %v — an old rate labelled with its age is "+
			"more useful than no total at all", err)
	}
	if rate.Value != 0.054 {
		t.Errorf("Rate.Value = %v, want the previously loaded 0.054", rate.Value)
	}
	if !rate.AsOf.Equal(quotedAt) {
		t.Errorf("Rate.AsOf = %v, want the original quote time %v so the reader can see it is old",
			rate.AsOf, quotedAt)
	}
	if !rate.Stale(time.Hour) {
		t.Error("the served rate must report itself stale; hiding the age is the one thing this may not do")
	}
}

// TestEmbedded_FirstFetchFailureIsAnError: with nothing loaded, there is no
// number to show and the caller must be told, not handed a zero.
func TestEmbedded_FirstFetchFailureIsAnError(t *testing.T) {
	src := &fakeSource{name: "broken", err: errors.New("source is down")}
	clock := &fakeClock{t: time.Date(2026, 7, 20, 9, 0, 0, 0, time.UTC)}

	e, err := NewEmbedded(EmbeddedOptions{
		Sources:  []fxsource.Source{src},
		MinRetry: time.Minute,
		Now:      clock.now,
	})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}

	if _, err := e.Rate(context.Background(), "ZAR", "USD"); err == nil {
		t.Fatal("a lookup with no rates and a dead source must error, not return a zero rate")
	}

	// And it must not retry on every request while the source stays down.
	for i := 0; i < 10; i++ {
		if _, err := e.Rate(context.Background(), "ZAR", "USD"); err == nil {
			t.Fatal("expected a continued error")
		}
	}
	if got := src.count(); got != 1 {
		t.Errorf("11 lookups inside the retry floor fetched %d time(s); want 1", got)
	}

	clock.advance(2 * time.Minute)
	if _, err := e.Rate(context.Background(), "ZAR", "USD"); err == nil {
		t.Fatal("expected a continued error")
	}
	if got := src.count(); got != 2 {
		t.Errorf("a lookup past the retry floor fetched %d time(s) in total; want 2", got)
	}
}

// TestEmbedded_RefreshIsTheHostsHook: the explicit warm-up path ignores both the
// age of the snapshot and the retry floor, because the host asked for it.
func TestEmbedded_RefreshIsTheHostsHook(t *testing.T) {
	src := zarUSD(time.Now())
	e, err := NewEmbedded(EmbeddedOptions{Sources: []fxsource.Source{src}})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}

	for i := 1; i <= 3; i++ {
		if err := e.Refresh(context.Background()); err != nil {
			t.Fatalf("Refresh errored: %v", err)
		}
		if got := src.count(); got != i {
			t.Fatalf("after %d explicit Refresh calls the source saw %d fetch(es)", i, got)
		}
	}

	// A lookup right afterwards is served from what Refresh loaded.
	if _, err := e.Rate(context.Background(), "ZAR", "USD"); err != nil {
		t.Fatalf("Rate errored: %v", err)
	}
	if got := src.count(); got != 3 {
		t.Errorf("a lookup after a warm-up fetched again (%d total); it must reuse the warm snapshot", got)
	}

	// Status is the diagnostics surface that explains a missing or old rate.
	st := e.Sources()
	if len(st) != 1 || st[0].Name != "fake" || st[0].Edges != 1 {
		t.Errorf("Sources() = %+v, want one healthy entry for \"fake\" with 1 edge", st)
	}
}

func TestNewEmbedded_RequiresASource(t *testing.T) {
	// A converter that reports Enabled() but can never price anything is worse
	// than an error at boot.
	for _, spec := range []string{"no-such-source", "nope, also-nope"} {
		if _, err := NewEmbedded(EmbeddedOptions{SourceSpec: spec}); err == nil {
			t.Errorf("NewEmbedded(%q) must error rather than return an engine with no sources", spec)
		}
	}
	// Empty means OpenRate's default set, which is not empty.
	if _, err := NewEmbedded(EmbeddedOptions{}); err != nil {
		t.Errorf("NewEmbedded with no spec must use the default source set: %v", err)
	}
}

// TestNewEmbedded_IgnoresTheEnvironment: the source list must be the operator's
// list. fxsource.FromEnv would let OPENRATE_SOURCES in the POS process's
// environment widen the set of hosts this server contacts; Build does not.
func TestNewEmbedded_IgnoresTheEnvironment(t *testing.T) {
	t.Setenv("OPENRATE_SOURCES", "ecb,coinbase,luno,sarb,frankfurter,yahoo,erapi,fawazahmed0,boc")
	t.Setenv("OPENRATE_OXR_APP_ID", "not-a-real-key")

	e, err := NewEmbedded(EmbeddedOptions{SourceSpec: "ecb"})
	if err != nil {
		t.Fatalf("NewEmbedded errored: %v", err)
	}
	st := e.Sources()
	if len(st) != 1 || st[0].Name != "ecb" {
		t.Errorf("configured \"ecb\" but the engine holds %+v; an environment variable must not "+
			"widen the set of hosts the POS contacts", st)
	}
}

// ---------------------------------------------------------------------------

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}
