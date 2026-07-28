package substrate_test

// drift_test.go — the two clock-drift bounds, and the order they run in.
//
// There are two, they are different sizes, and neither is a restatement of the
// other:
//
//	engine, op-ingest path    120 s   §3, refused with 0x0A05, state untouched
//	BeepBite, Observe path      5 m   oplog.DefaultMaxDrift, refused with
//	                                  oplog.ErrClockDrift, clock untouched
//
// The engine's bound cannot cover the second path. hlc.observe takes a clock
// handle and a timestamp and no receiver clock reading at all, so it has
// nothing to compare against; probed against v0.2.0 it accepts a stamp ten
// years in the future and drags the clock's wall permanently forward. HLC wall
// values are monotonic non-decreasing by construction, so that is not a
// transient error — every op the node mints afterwards carries the poisoned
// value and out-ranks every honest peer in every future last-writer-wins
// comparison.
//
// So the tests below assert the bound by its CONSEQUENCE rather than by its
// presence. "0x0A05 exists" and "ErrClockDrift is returned" are both true of an
// implementation that checks after the damage is done; the assertions that
// matter are that the substrate clock's wall is unchanged after a refusal, and
// that a stamp between the two bounds is accepted by one path and refused by
// the other. Remove the guard from Observe, or move it below the engine call,
// and TestObserveRefusesBeforeTheEngineClockSeesIt fails on the wall value.

import (
	"errors"
	"testing"
	"time"

	kotvasync "github.com/vul-os/kotva/bindings/go"

	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/substrate"
)

func TestObserveRefusesBeforeTheEngineClockSeesIt(t *testing.T) {
	e, _ := openEngine(t, "org-drift")

	now := time.Now()
	if _, err := e.Now(now); err != nil {
		t.Fatalf("Now: %v", err)
	}
	before, err := e.ClockWall()
	if err != nil {
		t.Fatalf("ClockWall: %v", err)
	}

	poison := oplog.Timestamp{
		Wall:    now.AddDate(10, 0, 0).UnixMilli(),
		Counter: 0,
		Node:    e.Node(),
	}
	if err := e.Observe(poison); !errors.Is(err, oplog.ErrClockDrift) {
		t.Fatalf("Observe(+10 years) = %v, want oplog.ErrClockDrift", err)
	}

	// The assertion the ordering exists for. A guard that ran after the engine's
	// clock had already folded the stamp in would still return ErrClockDrift
	// above and would still fail here.
	after, err := e.ClockWall()
	if err != nil {
		t.Fatalf("ClockWall: %v", err)
	}
	if after != before {
		t.Fatalf("the substrate clock moved from %d to %d despite the refusal — "+
			"a rejected stamp reached the engine's clock, which can never move back down",
			before, after)
	}

	// And the clock still stamps in the present rather than in 2036.
	ts, err := e.Now(now.Add(time.Millisecond))
	if err != nil {
		t.Fatalf("Now: %v", err)
	}
	if ts.Wall > now.Add(time.Hour).UnixMilli() {
		t.Fatalf("a local stamp now reads %d (%s) — the clock was poisoned",
			ts.Wall, time.UnixMilli(ts.Wall))
	}
}

func TestObserveAcceptsAStampInsideTheBound(t *testing.T) {
	e, _ := openEngine(t, "org-drift")

	now := time.Now()
	if _, err := e.Now(now); err != nil {
		t.Fatalf("Now: %v", err)
	}

	ahead := now.Add(time.Minute)
	remote := oplog.Timestamp{Wall: ahead.UnixMilli(), Counter: 3, Node: e.Node()}
	if err := e.Observe(remote); err != nil {
		t.Fatalf("Observe(+1 minute) = %v, want nil — the guard must not refuse ordinary NTP skew", err)
	}

	// Accepted means adopted: the clock is now no earlier than what it saw. If
	// this ever fails the guard has stopped forwarding to the engine at all,
	// which would make the test above pass for the wrong reason.
	wall, err := e.ClockWall()
	if err != nil {
		t.Fatalf("ClockWall: %v", err)
	}
	if wall < remote.Wall {
		t.Fatalf("clock wall is %d after observing %d — the stamp was refused or dropped", wall, remote.Wall)
	}
}

func TestIngestRefusesSkewAndLeavesTheReplicaUntouched(t *testing.T) {
	author, _ := openEngine(t, "org-drift")
	receiver, _ := openEngine(t, "org-drift")

	minted := time.Now()
	rec, err := author.Mint(setOp("menu_items", "k1", "name", []byte("steak")), minted)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	rootBefore, err := receiver.StateRoot()
	if err != nil {
		t.Fatalf("StateRoot: %v", err)
	}

	// The receiver's clock reads 121 s behind the op's stamp: the op is further
	// in the receiver's future than §3's 120 s allows.
	_, _, err = receiver.Ingest(rec.Cose, minted.Add(-121*time.Second))
	if !kotvasync.IsRefusal(err, substrate.SkewRefusalCode) {
		t.Fatalf("Ingest(+121s) = %v, want a %s refusal", err, substrate.SkewRefusalCode)
	}

	rootAfter, err := receiver.StateRoot()
	if err != nil {
		t.Fatalf("StateRoot: %v", err)
	}
	if rootAfter != rootBefore {
		t.Fatalf("the observable-state root moved from %s to %s on a refused op — "+
			"the refusal is supposed to happen before any state is touched", rootBefore, rootAfter)
	}

	// One second inside the bound, the same op is accepted — so the refusal
	// above is the skew check and not something else about the op.
	if _, fresh, err := receiver.Ingest(rec.Cose, minted.Add(-119*time.Second)); err != nil || !fresh {
		t.Fatalf("Ingest(+119s) = fresh=%v err=%v, want fresh=true nil", fresh, err)
	}
}

func TestTheTwoBoundsAreNotCollapsedIntoOne(t *testing.T) {
	e, _ := openEngine(t, "org-drift")
	receiver, _ := openEngine(t, "org-drift")

	engineBound, err := e.SkewBoundMS()
	if err != nil {
		t.Fatalf("SkewBoundMS: %v", err)
	}
	if engineBound != 120_000 {
		t.Fatalf("the linked engine's §3 skew bound is %d ms, not the 120 s this file was written against — "+
			"re-read SYNC.md §3 before adjusting anything here", engineBound)
	}
	if oplog.DefaultMaxDrift <= time.Duration(engineBound)*time.Millisecond {
		t.Fatalf("oplog.DefaultMaxDrift (%s) is no longer looser than the engine's bound (%d ms); "+
			"the two guard different paths and neither may be loosened to match the other",
			oplog.DefaultMaxDrift, engineBound)
	}

	// A stamp three minutes ahead sits between the two bounds. Observe must
	// take it; ingest must refuse it. Collapsing either bound onto the other
	// breaks exactly one of these two assertions.
	now := time.Now()
	between := now.Add(3 * time.Minute)

	if err := e.Observe(oplog.Timestamp{Wall: between.UnixMilli(), Node: e.Node()}); err != nil {
		t.Fatalf("Observe(+3m) = %v, want nil — inside oplog.DefaultMaxDrift", err)
	}

	rec, err := e.Mint(setOp("menu_items", "k2", "name", []byte("chops")), between)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if _, _, err := receiver.Ingest(rec.Cose, now); !kotvasync.IsRefusal(err, substrate.SkewRefusalCode) {
		t.Fatalf("Ingest(+3m) = %v, want a %s refusal — outside the engine's 120 s", err, substrate.SkewRefusalCode)
	}
}

func TestObserveRefusesAStampFromAnUnknownIdentitySpace(t *testing.T) {
	e, _ := openEngine(t, "org-drift")

	// A node id that is not a BeepBite node id at all. The author and the node
	// are the same 32 bytes in two alphabets, so anything that does not decode
	// is not a peer this replica could ever have merged with.
	err := e.Observe(oplog.Timestamp{Wall: time.Now().UnixMilli(), Node: "not-a-node-id"})
	if err == nil {
		t.Fatal("Observe accepted a stamp whose node is not a BeepBite node id")
	}
}
