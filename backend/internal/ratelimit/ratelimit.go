// Package ratelimit provides a pure in-memory, per-key token-bucket rate
// limiter and an http.Handler middleware that enforces it.
//
// # Algorithm
//
// Each key gets its own token bucket. A bucket holds up to [burst] tokens.
// Tokens refill at [ratePerMin] tokens per minute (i.e. one token every
// 60s/ratePerMin). Allow() computes how many tokens have accrued since the
// last call (using the injectable now function, which is time.Now in
// production), adds them to the bucket (capped at burst), and then either
// consumes one token (returns true) or returns false when the bucket is
// empty.
//
// # Concurrency
//
// A single sync.Mutex guards the bucket map.  Lock contention is minimal
// because the critical section is O(1) arithmetic; no I/O occurs.
//
// # Idle-key eviction
//
// New starts a background goroutine that sweeps the bucket map every
// [sweepInterval] and removes buckets that have been idle for more than
// [idleTimeout]. The goroutine exits when the Limiter's context is cancelled
// (i.e. when Close is called). Callers that do not call Close will leak the
// goroutine, which is acceptable for long-lived server processes where the
// Limiter lives for the lifetime of the program.
package ratelimit

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

const (
	// DefaultRatePerMin is the default request rate limit per API key.
	DefaultRatePerMin = 1000

	// DefaultBurst is the default maximum burst size (3× the per-minute rate
	// by default so a momentarily idle client can burst up to 3 000 requests
	// before being throttled).
	DefaultBurst = DefaultRatePerMin * 3

	// sweepInterval is how often the background goroutine removes idle buckets.
	sweepInterval = 5 * time.Minute

	// idleTimeout is how long a bucket must be untouched before it is evicted.
	idleTimeout = 15 * time.Minute
)

// nowFunc is a clock abstraction so tests can inject a fake clock.
type nowFunc func() time.Time

// bucket holds the state for a single key's token bucket.
type bucket struct {
	tokens   float64   // current token count (float for fractional accumulation)
	lastSeen time.Time // wall-clock time of the last Allow call
}

// Limiter is a concurrency-safe, per-key token-bucket rate limiter.
type Limiter struct {
	ratePerMin float64   // tokens granted per minute
	burst      float64   // maximum tokens in a bucket
	now        nowFunc   // injectable clock; time.Now in production
	mu         sync.Mutex
	buckets    map[string]*bucket
	stop       chan struct{} // closed by Close to stop the sweeper
}

// New creates a Limiter that allows ratePerMin requests per minute per key,
// with a burst capacity of burst. A background goroutine is started to evict
// idle buckets; call Close to stop it.
//
// ratePerMin and burst must both be > 0.
func New(ratePerMin int, burst int) *Limiter {
	return newWithClock(ratePerMin, burst, time.Now)
}

// newWithClock is the internal constructor that accepts an injectable clock.
// It is used by tests to control time deterministically.
func newWithClock(ratePerMin int, burst int, now nowFunc) *Limiter {
	l := &Limiter{
		ratePerMin: float64(ratePerMin),
		burst:      float64(burst),
		now:        now,
		buckets:    make(map[string]*bucket),
		stop:       make(chan struct{}),
	}
	go l.sweep()
	return l
}

// Allow returns true if the request for key is within the rate limit, and
// false if the bucket for that key is exhausted. It is safe to call from
// multiple goroutines.
func (l *Limiter) Allow(key string) bool {
	now := l.now()

	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	if !ok {
		// First request for this key: start with a full bucket minus one token.
		l.buckets[key] = &bucket{
			tokens:   l.burst - 1,
			lastSeen: now,
		}
		return true
	}

	// Refill: compute tokens earned since the last call.
	elapsed := now.Sub(b.lastSeen)
	if elapsed > 0 {
		earned := elapsed.Minutes() * l.ratePerMin
		b.tokens += earned
		if b.tokens > l.burst {
			b.tokens = l.burst
		}
	}
	b.lastSeen = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// remaining returns the current (floor) token count for key, or burst when
// no bucket exists yet. It acquires the lock internally.
func (l *Limiter) remaining(key string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[key]
	if !ok {
		return int(l.burst)
	}
	// Compute refill without mutating the bucket.
	now := l.now()
	elapsed := now.Sub(b.lastSeen)
	tokens := b.tokens
	if elapsed > 0 {
		tokens += elapsed.Minutes() * l.ratePerMin
		if tokens > l.burst {
			tokens = l.burst
		}
	}
	if tokens < 0 {
		tokens = 0
	}
	return int(tokens)
}

// Middleware returns a chi-compatible middleware that rate-limits requests by
// a string key extracted from the request via keyFn. keyFn is called on every
// request; if it returns an empty string the request passes through without
// rate limiting (useful when no API key is present, leaving auth middleware to
// reject it).
//
// On denial the middleware writes HTTP 429 with:
//   - Content-Type: application/json
//   - Retry-After: <seconds until one token refills>
//   - X-RateLimit-Limit: <burst>
//   - X-RateLimit-Remaining: 0
//   - body: {"error":"rate limit exceeded"}
//
// On success it sets:
//   - X-RateLimit-Limit: <burst>
//   - X-RateLimit-Remaining: <floor(current tokens after this call)>
func (l *Limiter) Middleware(keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := keyFn(r)
			if key == "" {
				// No key — pass through; auth middleware will reject if needed.
				next.ServeHTTP(w, r)
				return
			}

			limit := int(l.burst)

			if !l.Allow(key) {
				// Compute Retry-After: seconds until one token is available.
				// One token takes 60/ratePerMin seconds to accrue.
				retryAfterSec := int(60.0/l.ratePerMin) + 1
				if retryAfterSec < 1 {
					retryAfterSec = 1
				}

				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", limit))
				w.Header().Set("X-RateLimit-Remaining", "0")
				w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfterSec))
				w.WriteHeader(http.StatusTooManyRequests)
				_ = json.NewEncoder(w).Encode(map[string]string{
					"error": "rate limit exceeded",
				})
				return
			}

			remaining := l.remaining(key)
			w.Header().Set("X-RateLimit-Limit", fmt.Sprintf("%d", limit))
			w.Header().Set("X-RateLimit-Remaining", fmt.Sprintf("%d", remaining))
			next.ServeHTTP(w, r)
		})
	}
}

// Close stops the background sweep goroutine. It is safe to call multiple
// times. After Close, Allow continues to work correctly but idle buckets will
// no longer be evicted automatically.
func (l *Limiter) Close() {
	select {
	case <-l.stop:
		// already closed
	default:
		close(l.stop)
	}
}

// sweep periodically removes buckets that have been idle for longer than
// idleTimeout. It runs in its own goroutine and exits when l.stop is closed.
func (l *Limiter) sweep() {
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-l.stop:
			return
		case <-ticker.C:
			l.evictIdle()
		}
	}
}

// evictIdle removes buckets whose lastSeen is older than idleTimeout.
func (l *Limiter) evictIdle() {
	cutoff := l.now().Add(-idleTimeout)
	l.mu.Lock()
	defer l.mu.Unlock()
	for key, b := range l.buckets {
		if b.lastSeen.Before(cutoff) {
			delete(l.buckets, key)
		}
	}
}
