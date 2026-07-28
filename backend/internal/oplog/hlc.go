// Package oplog is BeepBite's own hybrid-logical-clock operation log and
// CRDT-style merge algebra for multi-branch sync (ROADMAP.md, "Now-5 —
// Multi-branch sync: HLC oplog, manual peer enrollment").
//
// This is BeepBite's own engine. It is explicitly NOT an implementation of,
// adapter for, or profile of any external sync specification — DMTAP
// included — and it MUST NOT be described as DMTAP-sync anywhere (see
// ROADMAP.md, "DMTAP — a staged, gated adoption plan", Stage 0). The package
// speaks no wire protocol, opens no transport and touches no database: Op,
// Timestamp and State are pure in-memory values, and Clock only keeps time.
// Nothing here is wired into the server. It is foundation for Now-5's
// symmetric push/pull rounds, which will layer transport, persistence and
// manual peer enrollment on top of this.
package oplog

import (
	"errors"
	"sync"
	"time"
)

// DefaultMaxDrift bounds how far into the future a remote timestamp may sit
// (relative to this node's own physical clock) before Update refuses it.
// Five minutes is generous enough to absorb ordinary NTP skew between two
// shops' routers while still catching a peer whose clock is badly wrong.
const DefaultMaxDrift = 5 * time.Minute

// ErrClockDrift is returned by Update when the remote timestamp's Wall
// component is further ahead of this node's physical clock than the
// configured max drift allows.
var ErrClockDrift = errors.New("oplog: remote timestamp exceeds max clock drift")

// Timestamp is a hybrid-logical-clock stamp: a wall-clock millisecond value
// plus a logical counter that advances within the same millisecond, plus the
// emitting node's identity.
type Timestamp struct {
	// Wall is Unix milliseconds.
	Wall int64

	// Counter disambiguates multiple events within the same Wall millisecond.
	Counter uint32

	// Node is the identity of the clock that produced this timestamp.
	Node string
}

// Compare gives a total order over Timestamp values: Wall first, then
// Counter, then Node lexicographically.
//
// The Node tiebreak is what makes the order total rather than merely
// partial. Wall+Counter alone can tie exactly — two different nodes can
// legitimately mint a timestamp with the same millisecond and the same
// counter value, because each node's counter only tracks collisions against
// its OWN prior timestamps, not every other node's. Without a final,
// deterministic tiebreak, two branches applying the same set of Ops could
// pick different "winners" for a Set register and diverge permanently. The
// Node string comparison is arbitrary — it does not mean node "a" is more
// authoritative than node "z" — but every replica evaluates the same
// arbitrary rule against the same bytes, so every replica agrees, and that
// is the only property required of a tiebreak for last-writer-wins merge to
// converge.
//
// Compare returns -1 if t < other, +1 if t > other, and 0 only when t and
// other are byte-for-byte identical.
func (t Timestamp) Compare(other Timestamp) int {
	if t.Wall != other.Wall {
		if t.Wall < other.Wall {
			return -1
		}
		return 1
	}
	if t.Counter != other.Counter {
		if t.Counter < other.Counter {
			return -1
		}
		return 1
	}
	if t.Node != other.Node {
		if t.Node < other.Node {
			return -1
		}
		return 1
	}
	return 0
}

// Clock is a hybrid logical clock for one node. The zero value is not usable;
// construct with NewClock or NewClockWithMaxDrift.
//
// Clock is safe for concurrent use by multiple goroutines.
type Clock struct {
	mu       sync.Mutex
	node     string
	maxDrift time.Duration
	lastWall int64
	counter  uint32

	// now is the physical-time source. It is a field (not a bare call to
	// time.Now) so tests can stall or rewind it to exercise the HLC's
	// defining property: logical time keeps advancing even when the wall
	// clock does not.
	now func() time.Time
}

// NewClock returns a Clock for the given node identity, using
// DefaultMaxDrift.
func NewClock(node string) *Clock {
	return NewClockWithMaxDrift(node, DefaultMaxDrift)
}

// NewClockWithMaxDrift returns a Clock for the given node identity with an
// explicit max-drift bound. See Update for why this bound exists.
func NewClockWithMaxDrift(node string, maxDrift time.Duration) *Clock {
	return &Clock{
		node:     node,
		maxDrift: maxDrift,
		now:      time.Now,
	}
}

// Now returns a new Timestamp for a local event, advancing the clock.
//
// Standard HLC rule: if the physical wall clock has moved past the last
// recorded wall value, adopt it and reset the counter to 0 (physical time is
// doing the work of disambiguation). Otherwise the wall clock has not
// visibly advanced (it stalled, or two calls landed in the same
// millisecond), so keep the last wall value and increment the counter —
// logical time keeps every event distinct even when physical time cannot.
func (c *Clock) Now() Timestamp {
	c.mu.Lock()
	defer c.mu.Unlock()

	physical := c.now().UnixMilli()
	if physical > c.lastWall {
		c.lastWall = physical
		c.counter = 0
	} else {
		c.counter++
	}
	return Timestamp{Wall: c.lastWall, Counter: c.counter, Node: c.node}
}

// Update folds a remote Timestamp (observed on an incoming Op) into this
// clock, per the standard HLC receive rule, and returns the new local
// Timestamp that records having seen it.
//
// The rule: l' = max(local wall, remote wall, physical now). If l' ties both
// local and remote wall, the new counter is max(local counter, remote
// counter) + 1; if it ties only one side, that side's counter + 1; if l'
// comes from physical time alone (strictly ahead of both), the counter
// resets to 0. This keeps HLC's core guarantee: any two events causally
// linked by a message (this Update call) are stamped so the receiver's
// timestamp compares greater than the sender's.
//
// Excessive drift is rejected, not adopted. If remote.Wall sits further
// ahead of this node's own physical clock than maxDrift allows, Update
// returns ErrClockDrift and does NOT touch the clock's state at all. This
// matters because HLC wall values are monotonic non-decreasing by
// construction — once adopted, a wall value can never go back down. A peer
// with a broken (or malicious) clock reporting, say, a timestamp ten years
// in the future would, if accepted, permanently drag this node's Now() into
// that future: every local event from that point on would carry the
// poisoned wall value, this node would out-rank every honest peer in every
// future LWW comparison regardless of true recency, and there is no way to
// undo it later since HLC never moves backward. Rejecting the update leaves
// this node's clock completely unaffected — the safe failure mode — while
// physical time continues to close the gap on its own for a peer whose
// clock is merely slow to synchronize rather than broken.
func (c *Clock) Update(remote Timestamp) (Timestamp, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	physical := c.now().UnixMilli()

	if remote.Wall-physical > c.maxDrift.Milliseconds() {
		return Timestamp{}, ErrClockDrift
	}

	newWall := physical
	if c.lastWall > newWall {
		newWall = c.lastWall
	}
	if remote.Wall > newWall {
		newWall = remote.Wall
	}

	switch {
	case newWall == c.lastWall && newWall == remote.Wall:
		m := c.counter
		if remote.Counter > m {
			m = remote.Counter
		}
		c.counter = m + 1
	case newWall == c.lastWall:
		c.counter++
	case newWall == remote.Wall:
		c.counter = remote.Counter + 1
	default:
		// newWall came from physical time alone, strictly ahead of both
		// recorded values: physical time is disambiguating, so logical
		// counter resets, exactly as in Now().
		c.counter = 0
	}
	c.lastWall = newWall
	return Timestamp{Wall: c.lastWall, Counter: c.counter, Node: c.node}, nil
}
