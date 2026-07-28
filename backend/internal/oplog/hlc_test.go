package oplog

import (
	"sync"
	"testing"
	"time"
)

// stalledClock returns a time.Now-shaped func that always reports the same
// instant, so tests can exercise the HLC's defining property: logical time
// (the Counter) must keep every event distinct even when physical time does
// not move at all.
func stalledClock(at time.Time) func() time.Time {
	return func() time.Time { return at }
}

func TestClock_MonotonicUnderStalledWallClock(t *testing.T) {
	frozen := time.UnixMilli(1_700_000_000_000)
	c := NewClock("n1")
	c.now = stalledClock(frozen)

	var prev Timestamp
	for i := 0; i < 5; i++ {
		ts := c.Now()
		if i == 0 {
			prev = ts
			continue
		}
		if ts.Compare(prev) <= 0 {
			t.Fatalf("call %d: timestamp %+v did not advance past previous %+v", i, ts, prev)
		}
		if ts.Wall != prev.Wall {
			t.Fatalf("call %d: Wall moved (%d -> %d) even though the wall clock is stalled", i, prev.Wall, ts.Wall)
		}
		if ts.Counter != prev.Counter+1 {
			t.Fatalf("call %d: Counter = %d, want %d (prev+1)", i, ts.Counter, prev.Counter+1)
		}
		prev = ts
	}
}

func TestClock_NowResetsCounterWhenWallAdvances(t *testing.T) {
	t0 := time.UnixMilli(1_700_000_000_000)
	c := NewClock("n1")
	c.now = stalledClock(t0)

	first := c.Now()
	second := c.Now() // wall stalled, counter should bump
	if second.Counter != first.Counter+1 {
		t.Fatalf("expected counter to bump while stalled, got %d then %d", first.Counter, second.Counter)
	}

	c.now = stalledClock(t0.Add(time.Second))
	third := c.Now()
	if third.Wall <= second.Wall {
		t.Fatalf("expected Wall to advance once physical clock advances, got %d -> %d", second.Wall, third.Wall)
	}
	if third.Counter != 0 {
		t.Fatalf("expected Counter to reset to 0 when Wall advances, got %d", third.Counter)
	}
}

func TestClock_UpdateRejectsExcessiveDrift(t *testing.T) {
	frozen := time.UnixMilli(1_700_000_000_000)
	c := NewClock("local")
	c.now = stalledClock(frozen)

	before := c.Now()

	// A remote node claiming a timestamp an hour in the future — comfortably
	// past the 5-minute default — must be rejected outright.
	remote := Timestamp{Wall: frozen.UnixMilli() + int64(time.Hour/time.Millisecond), Counter: 0, Node: "broken-peer"}
	_, err := c.Update(remote)
	if err != ErrClockDrift {
		t.Fatalf("Update() error = %v, want ErrClockDrift", err)
	}

	// The rejected update must leave local state completely untouched: a
	// subsequent Now() must not carry any trace of the rejected remote wall
	// value forward.
	after := c.Now()
	if after.Wall != before.Wall {
		t.Fatalf("rejected Update mutated clock state: Wall went from %d to %d", before.Wall, after.Wall)
	}
}

func TestClock_UpdateAcceptsDriftWithinBound(t *testing.T) {
	frozen := time.UnixMilli(1_700_000_000_000)
	c := NewClock("local")
	c.now = stalledClock(frozen)

	remote := Timestamp{Wall: frozen.UnixMilli() + int64(time.Minute/time.Millisecond), Counter: 7, Node: "peer"}
	got, err := c.Update(remote)
	if err != nil {
		t.Fatalf("Update() unexpected error: %v", err)
	}
	if got.Wall != remote.Wall {
		t.Fatalf("Wall = %d, want remote's %d (remote is ahead of local+physical)", got.Wall, remote.Wall)
	}
	if got.Counter != remote.Counter+1 {
		t.Fatalf("Counter = %d, want remote.Counter+1 = %d", got.Counter, remote.Counter+1)
	}
	if got.Node != "local" {
		t.Fatalf("Node = %q, want %q (Update always stamps with the local node)", got.Node, "local")
	}
}

func TestClock_UpdateTieBreaksByMaxCounterPlusOne(t *testing.T) {
	frozen := time.UnixMilli(1_700_000_000_000)
	c := NewClock("local")
	c.now = stalledClock(frozen)

	// Advance local counter to 3 at the same wall value the remote will use.
	for i := 0; i < 3; i++ {
		c.Now()
	}
	localBefore := c.Now() // counter now 4 (5th call)

	remote := Timestamp{Wall: localBefore.Wall, Counter: 1, Node: "peer"}
	got, err := c.Update(remote)
	if err != nil {
		t.Fatalf("Update() unexpected error: %v", err)
	}
	if got.Wall != localBefore.Wall {
		t.Fatalf("Wall = %d, want unchanged %d", got.Wall, localBefore.Wall)
	}
	wantCounter := localBefore.Counter + 1 // max(4,1)+1
	if got.Counter != wantCounter {
		t.Fatalf("Counter = %d, want max(local,remote)+1 = %d", got.Counter, wantCounter)
	}
}

func TestTimestamp_CompareIsTotalOrder(t *testing.T) {
	stamps := []Timestamp{
		{Wall: 100, Counter: 0, Node: "a"},
		{Wall: 100, Counter: 0, Node: "b"},
		{Wall: 100, Counter: 1, Node: "a"},
		{Wall: 100, Counter: 1, Node: "b"},
		{Wall: 101, Counter: 0, Node: "a"},
		{Wall: 99, Counter: 5, Node: "z"},
	}

	for i, a := range stamps {
		for j, b := range stamps {
			cmp := a.Compare(b)
			rev := b.Compare(a)
			if i == j {
				if cmp != 0 {
					t.Fatalf("a.Compare(a) = %d, want 0 for %+v", cmp, a)
				}
				continue
			}
			// Distinct timestamps must never compare equal (totality), and
			// the comparison must be antisymmetric.
			if cmp == 0 {
				t.Fatalf("distinct timestamps compared equal: %+v vs %+v", a, b)
			}
			if cmp != -rev {
				t.Fatalf("Compare not antisymmetric: %+v.Compare(%+v)=%d but reverse=%d", a, b, cmp, rev)
			}
		}
	}
}

func TestTimestamp_CompareNodeTiebreak(t *testing.T) {
	a := Timestamp{Wall: 100, Counter: 5, Node: "alpha"}
	b := Timestamp{Wall: 100, Counter: 5, Node: "beta"}
	if a.Compare(b) >= 0 {
		t.Fatalf("expected alpha < beta on Node tiebreak, got Compare=%d", a.Compare(b))
	}
	if b.Compare(a) <= 0 {
		t.Fatalf("expected beta > alpha on Node tiebreak, got Compare=%d", b.Compare(a))
	}
}

func TestClock_ConcurrentUse(t *testing.T) {
	c := NewClock("n1")
	const goroutines = 50
	const perGoroutine = 200

	seen := make([][]Timestamp, goroutines)
	var wg sync.WaitGroup
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			out := make([]Timestamp, perGoroutine)
			for i := 0; i < perGoroutine; i++ {
				out[i] = c.Now()
			}
			seen[g] = out
		}(g)
	}
	wg.Wait()

	// Every Timestamp minted by this clock must be unique (races under -race
	// would also catch concurrent map/counter corruption).
	all := make(map[Timestamp]bool, goroutines*perGoroutine)
	for _, out := range seen {
		for _, ts := range out {
			if all[ts] {
				t.Fatalf("duplicate timestamp minted under concurrent use: %+v", ts)
			}
			all[ts] = true
		}
	}
}
