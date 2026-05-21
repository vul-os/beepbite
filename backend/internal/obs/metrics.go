package obs

import (
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
)

// ---------------------------------------------------------------------------
// Histogram / reservoir
// ---------------------------------------------------------------------------

// numBuckets is the number of fixed latency histogram buckets.
const numBuckets = 13

// histogramBuckets are the upper-bounds (in milliseconds) for the fixed-width
// latency buckets. They cover sub-millisecond through ~30 s.
var histogramBuckets = [numBuckets]float64{1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000}

// routeMetrics holds per-route counters and a sorted reservoir of latency
// samples (milliseconds, float64) used for p50/p95/p99 estimation.
//
// reservoir is bounded to maxReservoirSize to keep memory use constant.
const maxReservoirSize = 1024

type routeMetrics struct {
	requests  uint64
	errors    uint64 // status >= 500
	reservoir []float64
	buckets   [numBuckets]uint64 // cumulative counts per LE bucket
	sum       float64            // sum of all latency values (ms)
}

// record appends a latency observation and updates counters.
func (m *routeMetrics) record(latencyMs float64, isErr bool) {
	m.requests++
	if isErr {
		m.errors++
	}
	m.sum += latencyMs
	// Update histogram buckets.
	for i, le := range histogramBuckets {
		if latencyMs <= le {
			m.buckets[i]++
		}
	}
	// Bounded reservoir: when full, replace a random-ish slot by cycling on
	// total request count (deterministic but sufficiently spread).
	if uint64(len(m.reservoir)) < maxReservoirSize {
		m.reservoir = append(m.reservoir, latencyMs)
	} else {
		idx := m.requests % maxReservoirSize
		m.reservoir[idx] = latencyMs
	}
}

// percentile returns the p-th percentile (0–100) of the reservoir, or 0 when
// there are no samples. The reservoir is sorted in place each call — fine
// because this only runs when /metrics is scraped.
func (m *routeMetrics) percentile(p float64) float64 {
	n := len(m.reservoir)
	if n == 0 {
		return 0
	}
	sorted := make([]float64, n)
	copy(sorted, m.reservoir)
	sort.Float64s(sorted)
	// Nearest-rank method.
	rank := int(math.Ceil(p/100*float64(n))) - 1
	if rank < 0 {
		rank = 0
	}
	if rank >= n {
		rank = n - 1
	}
	return sorted[rank]
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// Registry is a concurrency-safe, in-memory metrics store. Create one with
// NewRegistry and share it across the application.
type Registry struct {
	mu     sync.Mutex
	routes map[string]*routeMetrics
}

// NewRegistry allocates and returns a new Registry.
func NewRegistry() *Registry {
	return &Registry{
		routes: make(map[string]*routeMetrics),
	}
}

// record is called by the middleware after each request.
func (reg *Registry) record(route, method string, statusCode int, latencyMs float64) {
	key := method + " " + route
	isErr := statusCode >= 500

	reg.mu.Lock()
	m, ok := reg.routes[key]
	if !ok {
		m = &routeMetrics{}
		reg.routes[key] = m
	}
	m.record(latencyMs, isErr)
	reg.mu.Unlock()
}

// ---------------------------------------------------------------------------
// Prometheus-style text exposition
// ---------------------------------------------------------------------------

// Handler returns an http.Handler that serves a Prometheus-compatible text
// exposition of all recorded metrics. Mount it at /metrics.
func (reg *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		reg.writeTo(w)
	})
}

// writeTo serialises all metrics to w in Prometheus text format.
func (reg *Registry) writeTo(w io.Writer) {
	reg.mu.Lock()
	// Snapshot the keys so we can release the lock before sorting/printing.
	type snapshot struct {
		key    string
		m      routeMetrics
		method string
		route  string
	}
	snaps := make([]snapshot, 0, len(reg.routes))
	for key, m := range reg.routes {
		parts := strings.SplitN(key, " ", 2)
		method, route := parts[0], parts[1]
		cp := *m
		cp.reservoir = make([]float64, len(m.reservoir))
		copy(cp.reservoir, m.reservoir)
		snaps = append(snaps, snapshot{key: key, m: cp, method: method, route: route})
	}
	reg.mu.Unlock()

	sort.Slice(snaps, func(i, j int) bool { return snaps[i].key < snaps[j].key })

	// --- http_requests_total ---
	fmt.Fprintln(w, "# HELP http_requests_total Total number of HTTP requests processed.")
	fmt.Fprintln(w, "# TYPE http_requests_total counter")
	for _, s := range snaps {
		fmt.Fprintf(w, "http_requests_total{method=%q,route=%q} %d\n",
			s.method, s.route, s.m.requests)
	}

	// --- http_errors_total ---
	fmt.Fprintln(w, "# HELP http_errors_total Total number of HTTP requests with status >= 500.")
	fmt.Fprintln(w, "# TYPE http_errors_total counter")
	for _, s := range snaps {
		fmt.Fprintf(w, "http_errors_total{method=%q,route=%q} %d\n",
			s.method, s.route, s.m.errors)
	}

	// --- http_request_duration_ms (histogram) ---
	fmt.Fprintln(w, "# HELP http_request_duration_ms HTTP request latency in milliseconds.")
	fmt.Fprintln(w, "# TYPE http_request_duration_ms histogram")
	for _, s := range snaps {
		labels := fmt.Sprintf("method=%q,route=%q", s.method, s.route)
		for i, le := range histogramBuckets {
			fmt.Fprintf(w, "http_request_duration_ms_bucket{%s,le=\"%.0f\"} %d\n",
				labels, le, s.m.buckets[i])
		}
		fmt.Fprintf(w, "http_request_duration_ms_bucket{%s,le=\"+Inf\"} %d\n",
			labels, s.m.requests)
		fmt.Fprintf(w, "http_request_duration_ms_sum{%s} %.3f\n", labels, s.m.sum)
		fmt.Fprintf(w, "http_request_duration_ms_count{%s} %d\n", labels, s.m.requests)
	}

	// --- p50/p95/p99 summary (convenience — not standard Prometheus but useful) ---
	fmt.Fprintln(w, "# HELP http_request_duration_ms_summary Latency percentiles (p50/p95/p99) in milliseconds.")
	fmt.Fprintln(w, "# TYPE http_request_duration_ms_summary summary")
	for _, s := range snaps {
		labels := fmt.Sprintf("method=%q,route=%q", s.method, s.route)
		fmt.Fprintf(w, "http_request_duration_ms_summary{%s,quantile=\"0.5\"} %.3f\n",
			labels, s.m.percentile(50))
		fmt.Fprintf(w, "http_request_duration_ms_summary{%s,quantile=\"0.95\"} %.3f\n",
			labels, s.m.percentile(95))
		fmt.Fprintf(w, "http_request_duration_ms_summary{%s,quantile=\"0.99\"} %.3f\n",
			labels, s.m.percentile(99))
	}
}
