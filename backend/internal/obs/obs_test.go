package obs

import (
	"bufio"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// ---------------------------------------------------------------------------
// 1. Registry.record — counters and error counting
// ---------------------------------------------------------------------------

func TestRegistry_RecordCounters(t *testing.T) {
	reg := NewRegistry()

	// Two successful requests on the same route.
	reg.record("/items", "GET", 200, 10.0)
	reg.record("/items", "GET", 204, 5.0)
	// One server error.
	reg.record("/items", "GET", 500, 20.0)

	reg.mu.Lock()
	m := reg.routes["GET /items"]
	if m == nil {
		reg.mu.Unlock()
		t.Fatal("route key GET /items not found")
	}
	got := *m
	reg.mu.Unlock()

	if got.requests != 3 {
		t.Errorf("requests: want 3, got %d", got.requests)
	}
	if got.errors != 1 {
		t.Errorf("errors: want 1 (status>=500), got %d", got.errors)
	}
}

func TestRegistry_RecordErrorThreshold(t *testing.T) {
	reg := NewRegistry()

	// 499 is NOT a server error.
	reg.record("/a", "GET", 499, 1)
	// 500 and 503 ARE.
	reg.record("/a", "GET", 500, 1)
	reg.record("/a", "GET", 503, 1)

	reg.mu.Lock()
	m := reg.routes["GET /a"]
	if m == nil {
		reg.mu.Unlock()
		t.Fatal("missing key")
	}
	got := *m
	reg.mu.Unlock()

	if got.errors != 2 {
		t.Errorf("errors: want 2 (500+503), got %d", got.errors)
	}
}

// ---------------------------------------------------------------------------
// 2. Latency percentiles on a known sample
// ---------------------------------------------------------------------------

func TestPercentile_KnownSample(t *testing.T) {
	// Build a routeMetrics with a controlled reservoir [1, 2, …, 100].
	m := &routeMetrics{}
	for i := 1; i <= 100; i++ {
		m.reservoir = append(m.reservoir, float64(i))
	}

	p50 := m.percentile(50)
	p95 := m.percentile(95)
	p99 := m.percentile(99)

	// Nearest-rank on 100 samples:
	//   p50 → rank ceil(50/100*100)-1 = 49 → sorted[49] = 50
	//   p95 → rank ceil(95/100*100)-1 = 94 → sorted[94] = 95
	//   p99 → rank ceil(99/100*100)-1 = 98 → sorted[98] = 99
	if p50 != 50 {
		t.Errorf("p50: want 50, got %.0f", p50)
	}
	if p95 != 95 {
		t.Errorf("p95: want 95, got %.0f", p95)
	}
	if p99 != 99 {
		t.Errorf("p99: want 99, got %.0f", p99)
	}
}

func TestPercentile_Empty(t *testing.T) {
	m := &routeMetrics{}
	if got := m.percentile(99); got != 0 {
		t.Errorf("percentile on empty reservoir: want 0, got %f", got)
	}
}

func TestPercentile_SingleElement(t *testing.T) {
	m := &routeMetrics{reservoir: []float64{42.5}}
	for _, p := range []float64{0, 50, 95, 99, 100} {
		if got := m.percentile(p); got != 42.5 {
			t.Errorf("percentile(%v) with single element: want 42.5, got %f", p, got)
		}
	}
}

// ---------------------------------------------------------------------------
// 3. Prometheus text output: histogram cumulative, +Inf == count, _sum present
// ---------------------------------------------------------------------------

func TestRegistry_HistogramOutput(t *testing.T) {
	reg := NewRegistry()

	// Bucket boundaries: 1,5,10,25,50,100,250,500,1000,…
	//   5 ms  → le>=5  cumulative buckets gain 1
	//   20 ms → le>=25 cumulative buckets gain 1
	//   200ms → le>=250 cumulative buckets gain 1
	reg.record("/test", "GET", 200, 5.0)
	reg.record("/test", "GET", 200, 20.0)
	reg.record("/test", "GET", 200, 200.0)

	w := httptest.NewRecorder()
	reg.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	body := w.Body.String()

	// Must contain http_requests_total for our route.
	if !strings.Contains(body, `http_requests_total{method="GET",route="/test"}`) {
		t.Errorf("missing http_requests_total line; body:\n%s", body)
	}

	// Parse per-bucket counts.
	bucketCounts := parseBuckets(t, body, "GET", "/test")

	// le=1: no request ≤1 ms → 0
	if v := bucketCounts["1"]; v != 0 {
		t.Errorf("le=1 bucket: want 0, got %d", v)
	}
	// le=5: one request (5 ms)
	if bucketCounts["5"] != 1 {
		t.Errorf("le=5 bucket: want 1, got %d", bucketCounts["5"])
	}
	// le=25: two requests (5 and 20 ms)
	if bucketCounts["25"] != 2 {
		t.Errorf("le=25 bucket: want 2, got %d", bucketCounts["25"])
	}
	// le=250: all three requests
	if bucketCounts["250"] != 3 {
		t.Errorf("le=250 bucket: want 3, got %d", bucketCounts["250"])
	}
	// +Inf must equal total count.
	if bucketCounts["+Inf"] != 3 {
		t.Errorf("+Inf bucket: want 3 (== request count), got %d", bucketCounts["+Inf"])
	}

	// _sum must be present.
	if !strings.Contains(body, `http_request_duration_ms_sum{method="GET",route="/test"}`) {
		t.Errorf("missing _sum line; body:\n%s", body)
	}

	// Verify cumulative monotonicity.
	assertBucketsCumulative(t, bucketCounts)
}

// parseBuckets extracts http_request_duration_ms_bucket counts for a given
// method+route from a Prometheus text body. Returns map[le]count.
func parseBuckets(t *testing.T, body, method, route string) map[string]int {
	t.Helper()
	counts := make(map[string]int)
	prefix := `http_request_duration_ms_bucket{method="` + method + `",route="` + route + `",le="`
	plusInfPrefix := `http_request_duration_ms_bucket{method="` + method + `",route="` + route + `",le="+Inf"}`

	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, plusInfPrefix) {
			rest := strings.TrimSpace(strings.TrimPrefix(line, plusInfPrefix))
			counts["+Inf"] = parseLeadingInt(rest)
			continue
		}
		if strings.HasPrefix(line, prefix) {
			after := strings.TrimPrefix(line, prefix)
			idx := strings.Index(after, `"`)
			if idx < 0 {
				continue
			}
			le := after[:idx]
			rest := strings.TrimSpace(strings.TrimPrefix(after[idx+1:], "} "))
			counts[le] = parseLeadingInt(rest)
		}
	}
	return counts
}

// parseLeadingInt parses the leading integer (or truncated float) from s.
func parseLeadingInt(s string) int {
	if dot := strings.IndexByte(s, '.'); dot >= 0 {
		s = s[:dot]
	}
	n := 0
	for _, ch := range strings.TrimSpace(s) {
		if ch < '0' || ch > '9' {
			break
		}
		n = n*10 + int(ch-'0')
	}
	return n
}

// assertBucketsCumulative checks that the known ordered le values are
// non-decreasing.
func assertBucketsCumulative(t *testing.T, counts map[string]int) {
	t.Helper()
	orderedLe := []string{"1", "5", "10", "25", "50", "100", "250", "500", "1000", "2500", "5000", "10000", "30000", "+Inf"}
	prev := 0
	for _, le := range orderedLe {
		v, ok := counts[le]
		if !ok {
			continue
		}
		if v < prev {
			t.Errorf("buckets not cumulative: le=%s has %d < previous %d", le, v, prev)
		}
		prev = v
	}
}

// ---------------------------------------------------------------------------
// 4. Middleware via httptest
// ---------------------------------------------------------------------------

func TestMiddleware_GeneratesRequestID(t *testing.T) {
	reg := NewRegistry()
	log := NewLogger()

	handler := Middleware(log, reg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/ping", nil)
	// No X-Request-Id header supplied.
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	id := rr.Header().Get("X-Request-Id")
	if id == "" {
		t.Error("X-Request-Id should be generated when absent from request")
	}
	// generateRequestID returns hex.EncodeToString of 16 bytes → 32 chars.
	if len(id) != 32 {
		t.Errorf("generated request ID len: want 32, got %d (%q)", len(id), id)
	}
}

func TestMiddleware_PreservesRequestID(t *testing.T) {
	reg := NewRegistry()
	log := NewLogger()

	supplied := "my-correlation-id-12345"

	handler := Middleware(log, reg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/ping", nil)
	req.Header.Set("X-Request-Id", supplied)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	got := rr.Header().Get("X-Request-Id")
	if got != supplied {
		t.Errorf("X-Request-Id: want %q, got %q", supplied, got)
	}
}

func TestMiddleware_CapturesStatusCode(t *testing.T) {
	reg := NewRegistry()
	log := NewLogger()

	cases := []struct {
		name   string
		status int
	}{
		{"200_OK", 200},
		{"404_NotFound", 404},
		{"500_InternalServerError", 500},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := Middleware(log, reg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
			}))
			req := httptest.NewRequest("GET", "/status-test", nil)
			rr := httptest.NewRecorder()
			handler.ServeHTTP(rr, req)

			if rr.Code != tc.status {
				t.Errorf("response status: want %d, got %d", tc.status, rr.Code)
			}
		})
	}
}

func TestMiddleware_RecordsIntoRegistry(t *testing.T) {
	reg := NewRegistry()
	log := NewLogger()

	handler := Middleware(log, reg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest("POST", "/orders", nil)
		handler.ServeHTTP(httptest.NewRecorder(), req)
	}

	reg.mu.Lock()
	m := reg.routes["POST /orders"]
	if m == nil {
		reg.mu.Unlock()
		t.Fatal("route POST /orders not recorded in registry")
	}
	got := *m
	reg.mu.Unlock()

	if got.requests != 3 {
		t.Errorf("requests: want 3, got %d", got.requests)
	}
	if got.errors != 3 {
		t.Errorf("errors: want 3 (all 500), got %d", got.errors)
	}
}

func TestMiddleware_ImplicitStatus200(t *testing.T) {
	// A handler that writes a body but never calls WriteHeader should be
	// treated as 200 and not counted as an error.
	reg := NewRegistry()
	log := NewLogger()

	handler := Middleware(log, reg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "hello")
	}))

	req := httptest.NewRequest("GET", "/hello", nil)
	handler.ServeHTTP(httptest.NewRecorder(), req)

	reg.mu.Lock()
	m := reg.routes["GET /hello"]
	if m == nil {
		reg.mu.Unlock()
		t.Fatal("route not recorded")
	}
	got := *m
	reg.mu.Unlock()

	if got.errors != 0 {
		t.Errorf("implicit 200 should not count as error, got errors=%d", got.errors)
	}
}

// ---------------------------------------------------------------------------
// 5. Concurrency — data-race detection (run with go test -race)
// ---------------------------------------------------------------------------

func TestRegistry_ConcurrentRecord(t *testing.T) {
	reg := NewRegistry()

	const goroutines = 50
	const perGoroutine = 100

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(i int) {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				status := 200
				if j%10 == 0 {
					status = 500
				}
				reg.record("/concurrent", "GET", status, float64(j))
			}
		}(i)
	}
	wg.Wait()

	reg.mu.Lock()
	m := reg.routes["GET /concurrent"]
	if m == nil {
		reg.mu.Unlock()
		t.Fatal("route not found after concurrent writes")
	}
	total := m.requests
	reg.mu.Unlock()

	if total != goroutines*perGoroutine {
		t.Errorf("requests: want %d, got %d", goroutines*perGoroutine, total)
	}
}

func TestMiddleware_Concurrent(t *testing.T) {
	reg := NewRegistry()
	log := NewLogger()

	handler := Middleware(log, reg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	const goroutines = 40
	const perGoroutine = 50

	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < perGoroutine; j++ {
				req := httptest.NewRequest("GET", "/race", nil)
				handler.ServeHTTP(httptest.NewRecorder(), req)
			}
		}()
	}
	wg.Wait()

	reg.mu.Lock()
	m := reg.routes["GET /race"]
	if m == nil {
		reg.mu.Unlock()
		t.Fatal("route not recorded after concurrent middleware calls")
	}
	total := m.requests
	reg.mu.Unlock()

	if total != goroutines*perGoroutine {
		t.Errorf("requests: want %d, got %d", goroutines*perGoroutine, total)
	}
}

func TestRegistry_ConcurrentHandlerRead(t *testing.T) {
	// Simultaneously write via middleware and read via Handler() /metrics
	// to exercise the mutex and expose any data race.
	reg := NewRegistry()
	log := NewLogger()

	handler := Middleware(log, reg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))

	var wg sync.WaitGroup

	// Writers: send requests through the middleware.
	const writers = 20
	wg.Add(writers)
	for i := 0; i < writers; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				req := httptest.NewRequest("GET", "/mixed", nil)
				handler.ServeHTTP(httptest.NewRecorder(), req)
			}
		}()
	}

	// Readers: scrape /metrics concurrently.
	const readers = 5
	wg.Add(readers)
	for i := 0; i < readers; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < 20; j++ {
				req := httptest.NewRequest("GET", "/metrics", nil)
				reg.Handler().ServeHTTP(httptest.NewRecorder(), req)
			}
		}()
	}

	wg.Wait()
}
