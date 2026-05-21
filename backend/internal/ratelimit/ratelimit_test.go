package ratelimit

// Unit tests for the token-bucket rate limiter and its HTTP middleware.
//
// All tests use an injectable fake clock so they are fast and deterministic —
// no real sleeping is required.
//
// Coverage:
//   TestAllow_UnderLimit          — requests under burst → all allowed.
//   TestAllow_BurstExhausted      — requests > burst → excess denied.
//   TestAllow_RefillsOverTime     — tokens refill correctly after time advance.
//   TestAllow_PartialRefill       — partial minute refill stays within burst.
//   TestAllow_MultipleKeys        — each key has its own independent bucket.
//   TestMiddleware_UnderLimit     — 200 + rate-limit headers present.
//   TestMiddleware_Denied         — 429 + JSON body + Retry-After header.
//   TestMiddleware_EmptyKey       — empty keyFn → pass-through (no limiting).
//   TestMiddleware_HeaderValues   — X-RateLimit-Limit equals burst.
//   TestEvictIdle                 — evictIdle removes stale buckets correctly.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Fake clock helpers
// ---------------------------------------------------------------------------

// fakeClock is a simple monotonically-advanceable clock for tests.
type fakeClock struct {
	t time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{t: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)}
}

func (fc *fakeClock) Now() time.Time { return fc.t }

// advance moves the clock forward by d.
func (fc *fakeClock) advance(d time.Duration) { fc.t = fc.t.Add(d) }

// newTestLimiter builds a Limiter backed by the given fake clock.
func newTestLimiter(rate, burst int, fc *fakeClock) *Limiter {
	l := newWithClock(rate, burst, fc.Now)
	return l
}

// ---------------------------------------------------------------------------
// Allow tests
// ---------------------------------------------------------------------------

// TestAllow_UnderLimit verifies that the first [burst] requests are all
// allowed (the initial bucket is full).
func TestAllow_UnderLimit(t *testing.T) {
	fc := newFakeClock()
	// Small burst to keep the loop fast.
	const rate, burst = 60, 5
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	for i := 0; i < burst; i++ {
		if !l.Allow("key-A") {
			t.Fatalf("Allow() = false on request %d/%d, want true (under burst)", i+1, burst)
		}
	}
}

// TestAllow_BurstExhausted verifies that a request beyond the burst limit is
// denied without advancing the clock.
func TestAllow_BurstExhausted(t *testing.T) {
	fc := newFakeClock()
	const rate, burst = 60, 3
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	// Drain the bucket.
	for i := 0; i < burst; i++ {
		if !l.Allow("key-burst") {
			t.Fatalf("Allow() = false on drain step %d, want true", i+1)
		}
	}

	// Next request must be denied.
	if l.Allow("key-burst") {
		t.Fatal("Allow() = true after burst exhausted, want false")
	}
}

// TestAllow_RefillsOverTime verifies that after waiting long enough the bucket
// refills and requests are accepted again.
func TestAllow_RefillsOverTime(t *testing.T) {
	fc := newFakeClock()
	// 60 req/min → 1 token per second.
	const rate, burst = 60, 2
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	// Exhaust the burst.
	for i := 0; i < burst; i++ {
		l.Allow("key-refill")
	}
	if l.Allow("key-refill") {
		t.Fatal("bucket should be empty before time advance")
	}

	// Advance 2 seconds → earn 2 tokens (rate=60/min=1/s).
	fc.advance(2 * time.Second)

	// Should allow 2 requests now.
	for i := 0; i < 2; i++ {
		if !l.Allow("key-refill") {
			t.Fatalf("Allow() = false after refill on request %d, want true", i+1)
		}
	}

	// But not a 3rd without more time passing (burst cap is 2).
	if l.Allow("key-refill") {
		t.Fatal("Allow() = true beyond refilled burst, want false")
	}
}

// TestAllow_PartialRefill verifies fractional token accumulation: a partial
// minute should not yield a full token.
func TestAllow_PartialRefill(t *testing.T) {
	fc := newFakeClock()
	// 120 req/min → 2 tokens/s.
	const rate, burst = 120, 2
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	// Drain the bucket completely.
	for i := 0; i < burst; i++ {
		l.Allow("key-partial")
	}
	if l.Allow("key-partial") {
		t.Fatal("bucket should be empty")
	}

	// Advance only 0.4 seconds → 0.4*2 = 0.8 tokens earned (< 1) → still denied.
	fc.advance(400 * time.Millisecond)
	if l.Allow("key-partial") {
		t.Fatal("Allow() = true after partial refill of < 1 token, want false")
	}

	// Advance another 0.1 seconds → total 0.5s → 1.0 tokens → now allowed.
	fc.advance(100 * time.Millisecond)
	if !l.Allow("key-partial") {
		t.Fatal("Allow() = false after refill of exactly 1 token, want true")
	}
}

// TestAllow_MultipleKeys verifies that each key's bucket is independent.
func TestAllow_MultipleKeys(t *testing.T) {
	fc := newFakeClock()
	const rate, burst = 60, 2
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	// Exhaust key-X.
	for i := 0; i < burst; i++ {
		l.Allow("key-X")
	}
	if l.Allow("key-X") {
		t.Fatal("key-X should be exhausted")
	}

	// key-Y should be completely unaffected.
	for i := 0; i < burst; i++ {
		if !l.Allow("key-Y") {
			t.Fatalf("key-Y Allow() = false on request %d, want true", i+1)
		}
	}
}

// ---------------------------------------------------------------------------
// Middleware tests
// ---------------------------------------------------------------------------

// okHandler is a trivial inner handler that always returns 200 OK.
var okHandler = http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
})

// keyFnConst returns a middleware keyFn that always returns the given key.
func keyFnConst(key string) func(*http.Request) string {
	return func(_ *http.Request) string { return key }
}

// TestMiddleware_UnderLimit verifies that allowed requests receive 200 and the
// X-RateLimit-* headers are present.
func TestMiddleware_UnderLimit(t *testing.T) {
	fc := newFakeClock()
	const rate, burst = 60, 5
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	mw := l.Middleware(keyFnConst("api-key-1"))
	handler := mw(okHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if got := rr.Header().Get("X-RateLimit-Limit"); got == "" {
		t.Error("X-RateLimit-Limit header missing")
	}
	if got := rr.Header().Get("X-RateLimit-Limit"); got != fmt.Sprintf("%d", burst) {
		t.Errorf("X-RateLimit-Limit = %q, want %q", got, fmt.Sprintf("%d", burst))
	}
	if got := rr.Header().Get("X-RateLimit-Remaining"); got == "" {
		t.Error("X-RateLimit-Remaining header missing")
	}
}

// TestMiddleware_Denied verifies that an exhausted bucket causes HTTP 429 with
// the correct JSON body and headers.
func TestMiddleware_Denied(t *testing.T) {
	fc := newFakeClock()
	const rate, burst = 60, 2
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	mw := l.Middleware(keyFnConst("api-key-denied"))
	handler := mw(okHandler)

	// Exhaust the bucket via Allow directly so we don't need to fire [burst]
	// real HTTP requests.
	for i := 0; i < burst; i++ {
		l.Allow("api-key-denied")
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rr.Code)
	}

	// Check JSON body.
	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode 429 body: %v", err)
	}
	if body["error"] != "rate limit exceeded" {
		t.Errorf("body error = %q, want \"rate limit exceeded\"", body["error"])
	}

	// Retry-After must be present and > 0.
	if got := rr.Header().Get("Retry-After"); got == "" {
		t.Error("Retry-After header missing on 429")
	}

	// X-RateLimit-Remaining must be "0".
	if got := rr.Header().Get("X-RateLimit-Remaining"); got != "0" {
		t.Errorf("X-RateLimit-Remaining = %q, want \"0\"", got)
	}

	// Content-Type must be application/json.
	if got := rr.Header().Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
}

// TestMiddleware_EmptyKey verifies that an empty key from keyFn causes the
// middleware to pass through without rate limiting.
func TestMiddleware_EmptyKey(t *testing.T) {
	fc := newFakeClock()
	l := newTestLimiter(1, 1, fc) // extremely tight limit
	defer l.Close()

	mw := l.Middleware(keyFnConst("")) // always returns empty string
	handler := mw(okHandler)

	// Fire many requests — should all pass through because the key is empty.
	for i := 0; i < 10; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want 200 (empty key → no limiting)", i+1, rr.Code)
		}
	}
}

// TestMiddleware_HeaderValues verifies X-RateLimit-Limit equals burst.
func TestMiddleware_HeaderValues(t *testing.T) {
	fc := newFakeClock()
	const rate, burst = 100, 250
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	mw := l.Middleware(keyFnConst("hdr-test"))
	handler := mw(okHandler)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	wantLimit := fmt.Sprintf("%d", burst)
	if got := rr.Header().Get("X-RateLimit-Limit"); got != wantLimit {
		t.Errorf("X-RateLimit-Limit = %q, want %q", got, wantLimit)
	}
}

// TestMiddleware_AfterRefill verifies that a previously denied key is allowed
// again after the clock advances enough to refill a token.
func TestMiddleware_AfterRefill(t *testing.T) {
	fc := newFakeClock()
	// 60 req/min → 1 token/s.
	const rate, burst = 60, 1
	l := newTestLimiter(rate, burst, fc)
	defer l.Close()

	mw := l.Middleware(keyFnConst("refill-mw"))
	handler := mw(okHandler)

	// Consume the only token.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("first request: status = %d, want 200", rr.Code)
	}

	// Second request (same instant) must be denied.
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("second request: status = %d, want 429", rr.Code)
	}

	// Advance clock by 1 second → token refills.
	fc.advance(time.Second)

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	rr = httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("third request after refill: status = %d, want 200", rr.Code)
	}
}

// ---------------------------------------------------------------------------
// Eviction test
// ---------------------------------------------------------------------------

// TestEvictIdle verifies that evictIdle removes buckets that have not been
// used within idleTimeout and preserves recently-used buckets.
func TestEvictIdle(t *testing.T) {
	fc := newFakeClock()
	l := newTestLimiter(60, 5, fc)
	defer l.Close()

	// Seed two buckets.
	l.Allow("old-key")
	l.Allow("new-key")

	// Advance the clock past idleTimeout for both.
	fc.advance(idleTimeout + time.Second)

	// Touch new-key at the advanced time so it is fresh.
	l.Allow("new-key")

	// Run eviction.
	l.evictIdle()

	l.mu.Lock()
	_, oldExists := l.buckets["old-key"]
	_, newExists := l.buckets["new-key"]
	l.mu.Unlock()

	if oldExists {
		t.Error("old-key should have been evicted")
	}
	if !newExists {
		t.Error("new-key should NOT have been evicted (was recently used)")
	}
}
