package fx

// The most important assertions here are the negative ones: that FX is off by
// default, that "off" makes no network call, and that conversion never touches
// a stored amount.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Off by default
// ---------------------------------------------------------------------------

func TestDisabled_IsTheDefault(t *testing.T) {
	// The zero value of the seam's default implementation must be usable and
	// must be off — a deployment that configures nothing gets no FX and no
	// outbound traffic.
	var c Converter = Disabled{}

	if c.Enabled() {
		t.Error("Disabled.Enabled() must be false")
	}
	if _, err := c.Convert(context.Background(), 1000, "USD", 2, "EUR", 2); !errors.Is(err, ErrDisabled) {
		t.Errorf("Convert err = %v, want ErrDisabled", err)
	}
	if _, err := c.Rate(context.Background(), "USD", "EUR"); !errors.Is(err, ErrDisabled) {
		t.Errorf("Rate err = %v, want ErrDisabled", err)
	}
}

func TestFromEnv_DefaultsToDisabled(t *testing.T) {
	tests := []struct {
		name     string
		provider string
	}{
		{"unset is the shipped default", ""},
		{"explicit off", "off"},
		{"explicit disabled", "disabled"},
		{"explicit none", "none"},
		{"whitespace only", "   "},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c, err := FromEnv(tc.provider, "", 0)
			if err != nil {
				t.Fatalf("FromEnv(%q) errored: %v", tc.provider, err)
			}
			if c.Enabled() {
				t.Errorf("FromEnv(%q) returned an ENABLED converter; FX must default to off", tc.provider)
			}
		})
	}
}

// TestFromEnv_DisabledMakesNoNetworkCall proves the "no default outbound
// traffic" promise: a server stands ready and must never be contacted.
func TestFromEnv_DisabledMakesNoNetworkCall(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// A base URL is present but no provider is selected.
	c, err := FromEnv("", srv.URL, 0)
	if err != nil {
		t.Fatalf("FromEnv errored: %v", err)
	}

	_, _ = c.Convert(context.Background(), 100000, "ZAR", 2, "USD", 2)
	_, _ = c.Rate(context.Background(), "ZAR", "USD")

	if hits != 0 {
		t.Errorf("disabled FX made %d outbound request(s); it must make none", hits)
	}
}

func TestFromEnv_UnknownProviderIsAnError(t *testing.T) {
	// An operator who explicitly asked for a provider must not silently get
	// silence.
	if _, err := FromEnv("some-fx-api.example.com", "http://x", 0); err == nil {
		t.Error("an unknown provider must error rather than quietly disabling FX")
	}
}

func TestNewOpenRate_RequiresExplicitURL(t *testing.T) {
	// There is no correct default endpoint, and picking one would be exactly
	// the surprise outbound call this package promises not to make.
	for _, bad := range []string{"", "   ", "not a url", "/relative/only"} {
		if _, err := NewOpenRate(OpenRateOptions{BaseURL: bad}); err == nil {
			t.Errorf("NewOpenRate(%q) must error rather than assume an endpoint", bad)
		}
	}
}

func TestNewOpenRate_NormalisesBaseURL(t *testing.T) {
	for _, in := range []string{
		"http://openrate.internal:8080",
		"http://openrate.internal:8080/",
		"http://openrate.internal:8080/api/v1",
	} {
		o, err := NewOpenRate(OpenRateOptions{BaseURL: in})
		if err != nil {
			t.Fatalf("NewOpenRate(%q) errored: %v", in, err)
		}
		if o.baseURL != "http://openrate.internal:8080/api/v1" {
			t.Errorf("NewOpenRate(%q).baseURL = %q, want the /api/v1 root", in, o.baseURL)
		}
	}
}

// ---------------------------------------------------------------------------
// Conversion arithmetic
// ---------------------------------------------------------------------------

// TestApply_RescalesBetweenExponents is the multi-currency version of the
// /100 bug: converting between currencies with different minor-unit exponents
// is off by 100× if the exponents are ignored, and no plausible exchange rate
// makes that obvious.
func TestApply_RescalesBetweenExponents(t *testing.T) {
	tests := []struct {
		name     string
		minor    int64
		rate     float64
		from, to int
		want     int64
	}{
		{
			// ¥10,000 (0 decimals) at 0.0067 USD/JPY = $67.00 = 6700 cents.
			// Ignoring the exponents would give 67 cents or $6,700.
			name: "JPY to USD", minor: 10000, rate: 0.0067, from: 0, to: 2, want: 6700,
		},
		{
			// $67.00 back to yen.
			name: "USD to JPY", minor: 6700, rate: 149.25, from: 2, to: 0, want: 10000,
		},
		{
			// KD 1.000 (3 decimals) at 3.26 USD/KWD = $3.26.
			name: "KWD to USD", minor: 1000, rate: 3.26, from: 3, to: 2, want: 326,
		},
		{
			name: "same exponent", minor: 10000, rate: 0.054, from: 2, to: 2, want: 540,
		},
		{
			name: "identity rate is a no-op", minor: 12345, rate: 1, from: 2, to: 2, want: 12345,
		},
		{
			name: "negative amounts convert symmetrically", minor: -10000, rate: 0.054, from: 2, to: 2, want: -540,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := Apply(tc.minor, tc.rate, tc.from, tc.to); got != tc.want {
				t.Errorf("Apply(%d, %v, %d, %d) = %d, want %d",
					tc.minor, tc.rate, tc.from, tc.to, got, tc.want)
			}
		})
	}
}

func TestApply_RefundMirrorsSale(t *testing.T) {
	for _, minor := range []int64{1, 99, 1250, 999999} {
		if Apply(minor, 0.0543, 2, 2) != -Apply(-minor, 0.0543, 2, 2) {
			t.Errorf("conversion rounding is asymmetric at %d", minor)
		}
	}
}

func TestRate_Stale(t *testing.T) {
	fresh := Rate{AsOf: time.Now()}
	if fresh.Stale(time.Hour) {
		t.Error("a just-fetched rate is not stale")
	}

	old := Rate{AsOf: time.Now().Add(-72 * time.Hour)}
	if !old.Stale(time.Hour) {
		t.Error("a three-day-old rate is stale")
	}

	// An unknown age is not the same as fresh, but it is also not a lie —
	// callers render it as "unknown".
	var unknown Rate
	if unknown.Stale(time.Hour) {
		t.Error("a zero AsOf must not be reported as stale; it is unknown")
	}
}

// ---------------------------------------------------------------------------
// OpenRate client
// ---------------------------------------------------------------------------

func newTestOpenRate(t *testing.T, handler http.HandlerFunc) (*OpenRate, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	o, err := NewOpenRate(OpenRateOptions{BaseURL: srv.URL, CacheTTL: time.Minute})
	if err != nil {
		t.Fatalf("NewOpenRate errored: %v", err)
	}
	return o, srv
}

const convertBody = `{
  "from":"ZAR","to":"USD","amount":1,"result":0.054,
  "rate":{"rate":0.054,"hops":1,"as_of":"2026-07-20T08:59:58Z"}
}`

func TestOpenRate_ConvertCarriesProvenance(t *testing.T) {
	o, _ := newTestOpenRate(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Path; got != "/api/v1/convert" {
			t.Errorf("requested %q, want /api/v1/convert", got)
		}
		q := r.URL.Query()
		if q.Get("from") != "ZAR" || q.Get("to") != "USD" || q.Get("amount") != "1" {
			t.Errorf("unexpected query %v", q)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(convertBody))
	})

	// R1,000.00 → USD at 0.054.
	conv, err := o.Convert(context.Background(), 100000, "ZAR", 2, "USD", 2)
	if err != nil {
		t.Fatalf("Convert errored: %v", err)
	}

	if conv.ToMinor != 5400 {
		t.Errorf("ToMinor = %d, want 5400 ($54.00)", conv.ToMinor)
	}

	// The original must survive the conversion untouched — callers show both.
	if conv.FromMinor != 100000 {
		t.Errorf("FromMinor = %d; the source amount must be preserved verbatim", conv.FromMinor)
	}

	// Provenance is mandatory: a total with no rate and no timestamp is not
	// something an operator can act on.
	if conv.Rate.Value != 0.054 {
		t.Errorf("Rate.Value = %v, want 0.054", conv.Rate.Value)
	}
	if conv.Rate.AsOf.IsZero() {
		t.Error("Rate.AsOf must be populated — a converted figure without a timestamp is unusable")
	}
	if conv.Rate.Provider != "openrate" {
		t.Errorf("Rate.Provider = %q, want openrate", conv.Rate.Provider)
	}
	if conv.Rate.From != "ZAR" || conv.Rate.To != "USD" {
		t.Errorf("Rate pair = %s→%s, want ZAR→USD", conv.Rate.From, conv.Rate.To)
	}
}

func TestOpenRate_SameCurrencyNeedsNoNetwork(t *testing.T) {
	var hits int
	o, _ := newTestOpenRate(t, func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.WriteHeader(http.StatusInternalServerError)
	})

	// Even with a broken server, USD→USD must succeed: a same-currency
	// "conversion" must never depend on a network call.
	conv, err := o.Convert(context.Background(), 12345, "USD", 2, "USD", 2)
	if err != nil {
		t.Fatalf("same-currency Convert errored: %v", err)
	}
	if conv.ToMinor != 12345 {
		t.Errorf("ToMinor = %d, want the amount unchanged", conv.ToMinor)
	}
	if hits != 0 {
		t.Errorf("same-currency conversion made %d request(s); it must make none", hits)
	}
}

func TestOpenRate_CachesRates(t *testing.T) {
	var hits int
	o, _ := newTestOpenRate(t, func(w http.ResponseWriter, r *http.Request) {
		hits++
		_, _ = w.Write([]byte(convertBody))
	})

	for i := 0; i < 5; i++ {
		if _, err := o.Rate(context.Background(), "ZAR", "USD"); err != nil {
			t.Fatalf("Rate errored: %v", err)
		}
	}
	if hits != 1 {
		t.Errorf("made %d requests for 5 lookups of the same pair; want 1 (a report must not hammer the rate service)", hits)
	}
}

func TestOpenRate_UnreachablePairIsDistinguishable(t *testing.T) {
	o, _ := newTestOpenRate(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"unknown or unreachable currency pair"}`))
	})

	_, err := o.Rate(context.Background(), "ZAR", "XTS")
	if !errors.Is(err, ErrUnsupportedPair) {
		t.Errorf("err = %v, want ErrUnsupportedPair — 'I cannot price this' is an answer, not a transport failure", err)
	}
}

func TestOpenRate_ServerErrorsPropagate(t *testing.T) {
	o, _ := newTestOpenRate(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})

	if _, err := o.Rate(context.Background(), "ZAR", "USD"); err == nil {
		t.Error("a 502 from the rate service must surface as an error, not a silent zero rate")
	}
}

func TestOpenRate_RejectsNonPositiveRate(t *testing.T) {
	o, _ := newTestOpenRate(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"from":"ZAR","to":"USD","rate":{"rate":0}}`))
	})

	// A zero rate would convert every amount to nothing.
	if _, err := o.Rate(context.Background(), "ZAR", "USD"); err == nil {
		t.Error("a non-positive rate must be rejected, not applied")
	}
}

func TestParseTTL(t *testing.T) {
	tests := []struct {
		in   string
		want time.Duration
	}{
		{"", 5 * time.Minute},
		{"90s", 90 * time.Second},
		{"10m", 10 * time.Minute},
		{"30", 30 * time.Second},
		{"garbage", 5 * time.Minute},
		{"-5m", 5 * time.Minute},
	}
	for _, tc := range tests {
		if got := ParseTTL(tc.in, 5*time.Minute); got != tc.want {
			t.Errorf("ParseTTL(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}
