package protocol

import (
	"context"
	"sync"
	"time"
)

// MemCache is an in-memory ReplayCache.
//
// It is the right implementation for tests and for a single-process deployment
// that never restarts mid-window. It is the wrong one for anything else, and
// the reason is worth stating: the guarantee is "a nonce is spent once", and a
// process restart forgets every spent nonce, reopening the replay window for
// exactly as long as the freshness bound allows. The durable implementation
// lives beside the database.
type MemCache struct {
	mu   sync.Mutex
	seen map[string]time.Time
	ttl  time.Duration
}

// NewMemCache returns a cache that forgets entries older than ttl. A ttl of
// zero uses DefaultSkew, which is the shortest correct value: a nonce cannot be
// replayed successfully once its envelope is outside the freshness window.
func NewMemCache(ttl time.Duration) *MemCache {
	if ttl <= 0 {
		ttl = DefaultSkew
	}
	return &MemCache{seen: make(map[string]time.Time), ttl: ttl}
}

func key(peerNode, nonce string) string { return peerNode + "\x00" + nonce }

func (c *MemCache) Seen(_ context.Context, peerNode, nonce string) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	at, ok := c.seen[key(peerNode, nonce)]
	if !ok {
		return false, nil
	}
	// An expired entry is indistinguishable from never having seen it, because
	// an envelope bearing it can no longer pass the freshness check either.
	if time.Since(at) > c.ttl {
		delete(c.seen, key(peerNode, nonce))
		return false, nil
	}
	return true, nil
}

func (c *MemCache) Remember(_ context.Context, peerNode, nonce string, at time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sweepLocked()
	c.seen[key(peerNode, nonce)] = at
	return nil
}

// sweepLocked drops expired entries. Called on write so the map cannot grow
// without bound in a long-running process; the cost is amortised across the
// writes that caused the growth.
func (c *MemCache) sweepLocked() {
	if len(c.seen) < 1024 {
		return
	}
	cutoff := time.Now().Add(-c.ttl)
	for k, at := range c.seen {
		if at.Before(cutoff) {
			delete(c.seen, k)
		}
	}
}

// Len reports how many nonces are currently remembered. For tests and metrics.
func (c *MemCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.seen)
}
