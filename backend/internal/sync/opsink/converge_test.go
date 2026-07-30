package opsink_test

// converge_test.go — BeepBite's own multi-branch merge suite, under induced
// partition, driven through the emit layer.
//
// This is the suite ROADMAP Stage 2 precondition 4 asks for. It exercises the
// four properties that precondition names, using the ownership decisions in
// internal/sync/ownership and the operations internal/sync/emit produces from
// them — not hand-written ops, because hand-written ops prove the engine merges
// and prove nothing about whether BeepBite hands it the right ones.
//
//	1. concurrent offline sales of the last unit converge to −2, not −1
//	2. concurrent menu edits resolve identically on both engines
//	3. an order sequence never collides across branches
//	4. a partition healed after N minutes produces the same drawer total as one
//	   that never partitioned
//
// and the property underneath all four:
//
//	5. the converged state is BYTE-IDENTICAL regardless of the order in which
//	   the two branches exchanged their operations
//
// "Both engines" means the shared DMTAP-SYNC engine (internal/sync/substrate)
// and BeepBite's own HLC algebra (internal/oplog), fed the same operation
// sequence. Property 5's byte-identity is the substrate's §6.1 state root, which
// internal/oplog has no equivalent of; against internal/oplog the comparison is
// State.Equal plus an assertion that the two engines return the same answer for
// every register and every set this suite reads. Those are different strengths
// of claim and the tests say which is which.
//
// # A note on ties
//
// The two algebras break an exact (wall, counter) tie differently — internal/
// oplog on the node id's base32 spelling, the substrate on the author key's raw
// bytes — so a deliberately tied write is the one case where they may disagree,
// by design and by documentation (see internal/sync/substrate's EngineName).
// Every last-writer-wins comparison in this suite is decided by a wall clock
// difference, which is what a partition between two shops actually produces.
// assertNoTie fails the suite if that stops being true, rather than letting a
// tie make a passing run mean less than it looks.

import (
	"bytes"
	"context"
	"math/big"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/beepbite/backend/internal/nodeid"
	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/emit"
	"github.com/beepbite/backend/internal/sync/substrate"
)

const (
	orgNS   = "11111111-1111-1111-1111-111111111111"
	branchA = "aaaaaaaa-0000-0000-0000-000000000001"
	branchB = "bbbbbbbb-0000-0000-0000-000000000002"
)

// t0 is the suite's zero hour. Every wall clock below is an offset from it, so
// the ordering the tests depend on is visible in one place.
var t0 = time.Date(2026, 7, 30, 9, 0, 0, 0, time.UTC)

func at(d time.Duration) time.Time { return t0.Add(d) }

// ---------------------------------------------------------------------------
// A branch
// ---------------------------------------------------------------------------

// branch is one node: its engine, the branch it writes for, and everything it
// has authored.
type branchNode struct {
	name   string
	eng    *substrate.Engine
	branch string
	log    []substrate.Record
}

func newBranch(t *testing.T, name, location string) *branchNode {
	t.Helper()
	id, err := nodeid.LoadOrCreate(filepath.Join(t.TempDir(), "node.json"))
	if err != nil {
		t.Fatalf("%s: nodeid.LoadOrCreate: %v", name, err)
	}
	ctx := context.Background()
	e, err := substrate.Open(ctx, substrate.Options{Identity: id, NS: orgNS, CacheDir: engineCacheDir})
	if err != nil {
		t.Fatalf("%s: substrate.Open: %v", name, err)
	}
	t.Cleanup(func() { _ = e.Close(ctx) })
	return &branchNode{name: name, eng: e, branch: location}
}

// write plans a change through the ownership registry and mints the operations
// it produces, at the given wall clock. It does NOT admit them to this node's
// own replica — replicas are built explicitly by heal(), so that every
// assertion is about a replica whose whole history the test named.
func (b *branchNode) write(t *testing.T, when time.Time, c emit.Change) []substrate.Record {
	t.Helper()
	ops, err := emit.Plan(c, emit.Options{Branch: b.branch})
	if err != nil {
		t.Fatalf("%s: Plan(%s %s): %v", b.name, c.Kind, c.Table, err)
	}
	if len(ops) == 0 {
		t.Fatalf("%s: %s %s produced no operations", b.name, c.Kind, c.Table)
	}
	out := make([]substrate.Record, 0, len(ops))
	for _, op := range ops {
		rec, err := b.eng.Prepare(op, when)
		if err != nil {
			t.Fatalf("%s: Prepare(%s/%s.%s): %v", b.name, op.Entity, op.Key, op.Field, err)
		}
		out = append(out, rec)
		b.log = append(b.log, rec)
	}
	return out
}

// ---------------------------------------------------------------------------
// Replicas
// ---------------------------------------------------------------------------

// heal builds a fresh replica from a sequence of operations, ingesting each
// through the same verified-envelope path a peer's operation takes.
//
// The receiver clock is each op's own stamp, so the §3 skew bound is satisfied
// for a partition of any length — which is the point of a partition test.
func heal(t *testing.T, recs ...substrate.Record) *substrate.Engine {
	t.Helper()
	id, err := nodeid.LoadOrCreate(filepath.Join(t.TempDir(), "node.json"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	e, err := substrate.Open(ctx, substrate.Options{Identity: id, NS: orgNS, CacheDir: engineCacheDir})
	if err != nil {
		t.Fatalf("substrate.Open: %v", err)
	}
	t.Cleanup(func() { _ = e.Close(ctx) })

	for _, rec := range recs {
		if _, _, err := e.Ingest(rec.Cose, time.UnixMilli(rec.Op.TS.Wall)); err != nil {
			t.Fatalf("ingesting %s/%s.%s: %v", rec.Op.Entity, rec.Op.Key, rec.Op.Field, err)
		}
	}
	return e
}

// healOplog is heal for BeepBite's own algebra: the same operations, applied to
// internal/oplog's State.
func healOplog(t *testing.T, recs ...substrate.Record) *oplog.State {
	t.Helper()
	s := oplog.NewState()
	for _, rec := range recs {
		if err := s.Apply(rec.Op); err != nil {
			t.Fatalf("oplog.Apply(%s/%s.%s): %v", rec.Op.Entity, rec.Op.Key, rec.Op.Field, err)
		}
	}
	return s
}

func interleave(a, b []substrate.Record) []substrate.Record {
	out := make([]substrate.Record, 0, len(a)+len(b))
	for i := 0; i < len(a) || i < len(b); i++ {
		if i < len(a) {
			out = append(out, a[i])
		}
		if i < len(b) {
			out = append(out, b[i])
		}
	}
	return out
}

func concat(sets ...[]substrate.Record) []substrate.Record {
	var out []substrate.Record
	for _, s := range sets {
		out = append(out, s...)
	}
	return out
}

func reversed(recs []substrate.Record) []substrate.Record {
	out := make([]substrate.Record, len(recs))
	for i, r := range recs {
		out[len(recs)-1-i] = r
	}
	return out
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

// assertNoTie fails if two authors write the SAME last-writer-wins register at
// the same (wall, counter).
//
// The scope of that sentence is the whole point, and getting it wrong once
// already made this helper fire on a case that is not a problem. A tie only
// matters where something arbitrates. §4.4 registers arbitrate — and the two
// algebras break an exact tie differently, internal/oplog on the node id's
// base32 spelling and the substrate on the author key's raw bytes — so a tied
// register write is a comparison neither engine can be said to lose.
//
// A §4.3 add-only set does not arbitrate at all: two members are two members
// whatever their stamps say, which is exactly why the two tills selling the
// last steak in the same millisecond is a case this suite WANTS rather than one
// it has to avoid. And two ties on different registers are two independent
// comparisons, so only a collision on one address counts.
func assertNoTie(t *testing.T, recs []substrate.Record) {
	t.Helper()
	type addr struct {
		entity, key, field string
		wall               int64
		counter            uint32
	}
	seen := map[addr]string{}
	for _, r := range recs {
		if r.Op.Kind != oplog.KindSet {
			continue
		}
		a := addr{r.Op.Entity, r.Op.Key, r.Op.Field, r.Op.TS.Wall, r.Op.TS.Counter}
		if node, ok := seen[a]; ok && node != r.Op.TS.Node {
			t.Fatalf("two authors wrote %s/%s.%s at the same stamp (%d, %d): %s and %s. The two "+
				"engines break an exact tie differently by design, so this suite must not "+
				"contain one.", a.entity, a.key, a.field, a.wall, a.counter, node, r.Op.TS.Node)
		}
		seen[a] = r.Op.TS.Node
	}
}

// assertSameRoot is the byte-identity claim: two replicas that have converged
// agree on the §6.1 content address of their whole observable state, which
// covers every register and every set element including the ones no assertion
// below reads.
func assertSameRoot(t *testing.T, what string, a, b *substrate.Engine) {
	t.Helper()
	ra, err := a.StateRoot()
	if err != nil {
		t.Fatal(err)
	}
	rb, err := b.StateRoot()
	if err != nil {
		t.Fatal(err)
	}
	if ra != rb {
		t.Fatalf("%s: the two replicas did not converge — state roots %s and %s", what, ra, rb)
	}
	t.Logf("%s: converged, state root %s", what, ra)
}

// ledgerSum reads a §4.3 set back and adds up one column of its members,
// exactly. This is the read path every quantity in this product is supposed to
// use: SUM over the union at read time, never a stored counter.
func ledgerSum(t *testing.T, e *substrate.Engine, entity, key, column string) *big.Rat {
	t.Helper()
	members, err := e.Members(entity, key)
	if err != nil {
		t.Fatalf("Members(%s/%s): %v", entity, key, err)
	}
	total := new(big.Rat)
	for _, m := range members {
		row, err := emit.DecodeRow(m.Value)
		if err != nil {
			t.Fatalf("decoding a %s member: %v", entity, err)
		}
		v, ok := row[column]
		if !ok {
			t.Fatalf("a %s member carries no %s column", entity, column)
		}
		q, err := emit.DecodeNumeric(v)
		if err != nil {
			t.Fatalf("%s.%s: %v", entity, column, err)
		}
		total.Add(total, q)
	}
	return total
}

func ledgerSumOplog(t *testing.T, s *oplog.State, entity, key, column string) *big.Rat {
	t.Helper()
	total := new(big.Rat)
	for _, op := range s.Members(entity, key) {
		row, err := emit.DecodeRow(op.Value)
		if err != nil {
			t.Fatalf("decoding a %s member: %v", entity, err)
		}
		q, err := emit.DecodeNumeric(row[column])
		if err != nil {
			t.Fatalf("%s.%s: %v", entity, column, err)
		}
		total.Add(total, q)
	}
	return total
}

func rat(n int64) *big.Rat { return new(big.Rat).SetInt64(n) }

func num(mant int64, exp int32) pgtype.Numeric {
	return pgtype.Numeric{Int: big.NewInt(mant), Exp: exp, Valid: true}
}

// register reads one last-writer-wins winner off a replica, as text.
func register(t *testing.T, e *substrate.Engine, entity, key, field string) string {
	t.Helper()
	v, ok, err := e.Get(entity, key, field)
	if err != nil {
		t.Fatalf("Get(%s/%s.%s): %v", entity, key, field, err)
	}
	if !ok {
		t.Fatalf("%s/%s.%s has no value", entity, key, field)
	}
	s, err := emit.DecodeText(v)
	if err != nil {
		t.Fatalf("%s/%s.%s: %v", entity, key, field, err)
	}
	return s
}

func registerOplog(t *testing.T, s *oplog.State, entity, key, field string) string {
	t.Helper()
	v, ok := s.Get(entity, key, field)
	if !ok {
		t.Fatalf("%s/%s.%s has no value in the oplog state", entity, key, field)
	}
	out, err := emit.DecodeText(v)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// ---------------------------------------------------------------------------
// 1. Two tills, one steak, minus two
// ---------------------------------------------------------------------------

// TestConcurrentSalesOfTheLastUnitConvergeAtMinusTwo is the property ROADMAP
// Now-5 names, end to end: from the ownership decision that stock_movements is
// an append-only ledger grouped by inventory_item_id, through the operations
// emit produces, to the read-time SUM over the healed union.
//
// The failure it excludes is not a crash. It is a converged, silent −1: both
// branches agree, nothing errors, and the shop believes it sold one steak it
// did not have instead of two.
func TestConcurrentSalesOfTheLastUnitConvergeAtMinusTwo(t *testing.T) {
	a := newBranch(t, "A", branchA)
	b := newBranch(t, "B", branchB)

	sale := func(id string) emit.Change {
		return emit.Change{
			Table: "stock_movements",
			Kind:  emit.Insert,
			Row: map[string]any{
				"id":                id,
				"inventory_item_id": "ing-steak",
				"movement_type":     "sale",
				"quantity":          num(-1, 0),
				"notes":             nil,
			},
		}
	}

	// The partition: neither branch can see the other, and each sells the last
	// steak within the same second.
	fromA := a.write(t, at(0), sale("mv-a"))
	fromB := b.write(t, at(0), sale("mv-b"))

	all := interleave(fromA, fromB)
	assertNoTie(t, all)

	merged := heal(t, all...)
	reverse := heal(t, reversed(all)...)
	assertSameRoot(t, "two concurrent sales", merged, reverse)

	members, err := merged.Members("stock_movements", "ing-steak")
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 {
		t.Fatalf("the healed ledger holds %d movements, want 2 — one of the two sales was lost "+
			"on merge, which is the −1 bug", len(members))
	}

	got := ledgerSum(t, merged, "stock_movements", "ing-steak", "quantity")
	if got.Cmp(rat(-2)) != 0 {
		t.Fatalf("stock on hand is %s, want -2", got.RatString())
	}

	// The same operations through BeepBite's own algebra must answer the same.
	own := healOplog(t, all...)
	if n := len(own.Members("stock_movements", "ing-steak")); n != 2 {
		t.Fatalf("internal/oplog kept %d movements, want 2", n)
	}
	if gotOwn := ledgerSumOplog(t, own, "stock_movements", "ing-steak", "quantity"); gotOwn.Cmp(got) != 0 {
		t.Fatalf("the two engines disagree on stock: substrate %s, oplog %s",
			got.RatString(), gotOwn.RatString())
	}
	t.Logf("both engines: two concurrent sales of the last unit converge at %s", got.RatString())
}

// A stricter version of the same trap: two sales that are identical in every
// column a fact carries, including the quantity and the note, differing only in
// the row's own primary key. §4.3 identifies an element by its VALUE, so if the
// payload did not carry that key — or if the substrate's element stamp were
// dropped — these two would collapse into one member and the SUM would report
// −1 with nothing to notice.
func TestTwoSalesIdenticalInEverythingButTheirKeyBothSurvive(t *testing.T) {
	a := newBranch(t, "A", branchA)

	sale := func(id string) emit.Change {
		return emit.Change{
			Table: "stock_movements",
			Kind:  emit.Insert,
			Row: map[string]any{
				"id":                id,
				"inventory_item_id": "ing-steak",
				"movement_type":     "sale",
				"quantity":          num(-1, 0),
				"notes":             "table 4",
			},
		}
	}
	// Same branch, same millisecond: the case where nothing but the mapping's
	// own identity work distinguishes them.
	recs := concat(a.write(t, at(0), sale("mv-1")), a.write(t, at(0), sale("mv-2")))
	if recs[0].ID == recs[1].ID {
		t.Fatal("two distinct sales were minted as one operation")
	}

	merged := heal(t, recs...)
	if n, _ := merged.Members("stock_movements", "ing-steak"); len(n) != 2 {
		t.Fatalf("the ledger holds %d members, want 2", len(n))
	}
	if got := ledgerSum(t, merged, "stock_movements", "ing-steak", "quantity"); got.Cmp(rat(-2)) != 0 {
		t.Fatalf("stock on hand is %s, want -2", got.RatString())
	}
}

// ---------------------------------------------------------------------------
// 2. Concurrent menu edits
// ---------------------------------------------------------------------------

// TestConcurrentMenuEditsResolveIdenticallyOnBothEngines covers the group-owned
// half of the model. Two managers edit one menu item from two branches during a
// partition. Both replicas must reach the same answer, both engines must reach
// the same answer as each other, and — because the mapping puts one register
// per COLUMN rather than per row — an edit to a different column of the same
// item must survive rather than being clobbered by the later write.
func TestConcurrentMenuEditsResolveIdenticallyOnBothEngines(t *testing.T) {
	a := newBranch(t, "A", branchA)
	b := newBranch(t, "B", branchB)

	// A renames the item at 09:00.
	fromA := a.write(t, at(0), emit.Change{
		Table: "items", Kind: emit.Update,
		Row: map[string]any{"id": "item-ribeye", "name": "Ribeye"},
	})
	// B renames it differently at 09:05 — later, so B wins — and also edits a
	// column A did not touch.
	fromB := b.write(t, at(5*time.Minute), emit.Change{
		Table: "items", Kind: emit.Update,
		Row: map[string]any{"id": "item-ribeye", "name": "Ribeye 300g", "description": "dry aged"},
	})

	all := concat(fromA, fromB)
	assertNoTie(t, all)

	merged := heal(t, all...)
	reverse := heal(t, reversed(all)...)
	assertSameRoot(t, "concurrent menu edits", merged, reverse)

	if got := register(t, merged, "items", "item-ribeye", "name"); got != "Ribeye 300g" {
		t.Fatalf("name = %q, want the later write to win", got)
	}
	if got := register(t, merged, "items", "item-ribeye", "description"); got != "dry aged" {
		t.Fatalf("description = %q; a column only one side touched was lost", got)
	}
	// Arrival order must not change the winner.
	if got := register(t, reverse, "items", "item-ribeye", "name"); got != "Ribeye 300g" {
		t.Fatalf("name = %q when the operations arrived in the other order", got)
	}

	own := healOplog(t, all...)
	ownReverse := healOplog(t, reversed(all)...)
	if !own.Equal(ownReverse) {
		t.Fatal("internal/oplog reached two different states from one operation set")
	}
	for _, field := range []string{"name", "description"} {
		sub := register(t, merged, "items", "item-ribeye", field)
		got := registerOplog(t, own, "items", "item-ribeye", field)
		if sub != got {
			t.Fatalf("the two engines disagree on items.%s: substrate %q, oplog %q", field, sub, got)
		}
	}
	t.Log("both engines: the later edit wins, and the untouched column survives")
}

// ---------------------------------------------------------------------------
// 3. Order numbers across branches
// ---------------------------------------------------------------------------

// TestOrderNumbersDoNotCollideAcrossBranches covers the sequencing half.
//
// Two branches, offline from each other, both issue order number 100. Under
// Now-5 that is not a conflict to resolve: the order sequence is branch-owned
// and the receipt number is scoped by location, so the two orders are two
// different rows and both numbers stand. What must NOT happen is one order's
// row overwriting the other's, or one branch's sequence counter overwriting the
// other's.
//
// The second half of the property is the guard that makes it structural rather
// than lucky: branch B is refused when it tries to author an operation for a
// row belonging to branch A. There is no timestamp race to lose, because the
// write never becomes an operation.
func TestOrderNumbersDoNotCollideAcrossBranches(t *testing.T) {
	a := newBranch(t, "A", branchA)
	b := newBranch(t, "B", branchB)

	fromA := concat(
		a.write(t, at(0), emit.Change{
			Table: "orders", Kind: emit.Insert,
			Row: map[string]any{"id": "order-a", "location_id": branchA, "order_number": "100", "status": "open"},
		}),
		a.write(t, at(time.Second), emit.Change{
			Table: "fiscal_sequences", Kind: emit.Update,
			Row: map[string]any{"location_id": branchA, "current_number": int64(100)},
		}),
	)
	fromB := concat(
		b.write(t, at(2*time.Second), emit.Change{
			Table: "orders", Kind: emit.Insert,
			Row: map[string]any{"id": "order-b", "location_id": branchB, "order_number": "100", "status": "open"},
		}),
		b.write(t, at(3*time.Second), emit.Change{
			Table: "fiscal_sequences", Kind: emit.Update,
			Row: map[string]any{"location_id": branchB, "current_number": int64(100)},
		}),
	)

	all := interleave(fromA, fromB)
	assertNoTie(t, all)

	merged := heal(t, all...)
	assertSameRoot(t, "two branches at order 100", merged, heal(t, reversed(all)...))

	if got := register(t, merged, "orders", "order-a", "order_number"); got != "100" {
		t.Fatalf("branch A's order number is %q", got)
	}
	if got := register(t, merged, "orders", "order-b", "order_number"); got != "100" {
		t.Fatalf("branch B's order number is %q", got)
	}
	for _, key := range []string{branchA, branchB} {
		v, ok, err := merged.Get("fiscal_sequences", key, "current_number")
		if err != nil || !ok {
			t.Fatalf("fiscal_sequences/%s: ok=%v err=%v", key, ok, err)
		}
		q, err := emit.DecodeNumeric(v)
		if err != nil {
			t.Fatal(err)
		}
		if q.Cmp(rat(100)) != 0 {
			t.Fatalf("fiscal_sequences/%s = %s, want 100 — one branch's sequence overwrote the other's",
				key, q.RatString())
		}
	}

	own := healOplog(t, all...)
	for _, key := range []string{"order-a", "order-b"} {
		if got := registerOplog(t, own, "orders", key, "order_number"); got != "100" {
			t.Fatalf("internal/oplog: %s order number is %q", key, got)
		}
	}

	// The guard. Branch B has no business writing branch A's order at all.
	if _, err := emit.Plan(emit.Change{
		Table: "orders", Kind: emit.Update,
		Row: map[string]any{"id": "order-a", "location_id": branchA, "status": "void"},
	}, emit.Options{Branch: branchB}); err == nil {
		t.Fatal("branch B was allowed to author an operation on branch A's order; the " +
			"single-writer claim is what makes sequencing conflict-free, and it has to be " +
			"enforced rather than assumed")
	}
	t.Log("both engines: two branches both at order 100, neither overwriting the other")
}

// ---------------------------------------------------------------------------
// 4. A healed partition and an unpartitioned drawer
// ---------------------------------------------------------------------------

// TestHealedPartitionMatchesAnUnpartitionedDrawer is the fourth property, and
// the one that says the length of a partition does not change the answer.
//
// One drawer session; two branches recording movements into it over twenty
// minutes. The same operations are then delivered two ways:
//
//	partitioned  — nothing crosses for twenty minutes, then everything at once
//	live         — every operation crosses as it is made
//
// Both must reach the same total AND the same state root. Byte-identical, not
// merely equal-looking: the root covers every element in the set, including the
// ones the total does not distinguish.
func TestHealedPartitionMatchesAnUnpartitionedDrawer(t *testing.T) {
	a := newBranch(t, "A", branchA)
	b := newBranch(t, "B", branchB)

	const session = "drawer-session-1"
	movement := func(id string, cents int64, kind string) emit.Change {
		return emit.Change{
			Table: "cash_drawer_movements",
			Kind:  emit.Insert,
			Row: map[string]any{
				"id":                     id,
				"cash_drawer_session_id": session,
				"movement_type":          kind,
				"amount_cents":           cents,
				"reason":                 nil,
			},
		}
	}

	var fromA, fromB []substrate.Record
	for i, m := range []struct {
		id    string
		cents int64
		kind  string
		when  time.Duration
	}{
		{"mv-a1", 50000, "open_float", 0},
		{"mv-a2", -2000, "payout", 4 * time.Minute},
		{"mv-a3", 12500, "payin", 11 * time.Minute},
		{"mv-a4", -500, "payout", 19 * time.Minute},
	} {
		_ = i
		fromA = append(fromA, a.write(t, at(m.when), movement(m.id, m.cents, m.kind))...)
	}
	for _, m := range []struct {
		id    string
		cents int64
		kind  string
		when  time.Duration
	}{
		{"mv-b1", 7500, "payin", 2 * time.Minute},
		{"mv-b2", -1000, "payout", 9 * time.Minute},
		{"mv-b3", 3000, "payin", 17 * time.Minute},
	} {
		fromB = append(fromB, b.write(t, at(m.when), movement(m.id, m.cents, m.kind))...)
	}

	// Partitioned: each side's whole twenty minutes, then the other's.
	partitioned := heal(t, concat(fromA, fromB)...)
	// Live: every operation crossing as it is made.
	live := heal(t, interleave(fromA, fromB)...)

	assertSameRoot(t, "a drawer partitioned for twenty minutes vs one that never was", partitioned, live)

	want := rat(50000 - 2000 + 12500 - 500 + 7500 - 1000 + 3000)
	for name, e := range map[string]*substrate.Engine{"partitioned": partitioned, "live": live} {
		got := ledgerSum(t, e, "cash_drawer_movements", session, "amount_cents")
		if got.Cmp(want) != 0 {
			t.Fatalf("%s drawer totals %s cents, want %s", name, got.RatString(), want.RatString())
		}
		members, _ := e.Members("cash_drawer_movements", session)
		if len(members) != 7 {
			t.Fatalf("%s drawer holds %d movements, want 7", name, len(members))
		}
	}

	ownPartitioned := healOplog(t, concat(fromA, fromB)...)
	ownLive := healOplog(t, interleave(fromA, fromB)...)
	if !ownPartitioned.Equal(ownLive) {
		t.Fatal("internal/oplog: the partitioned drawer and the live one are different states")
	}
	if got := ledgerSumOplog(t, ownPartitioned, "cash_drawer_movements", session, "amount_cents"); got.Cmp(want) != 0 {
		t.Fatalf("internal/oplog drawer totals %s cents, want %s", got.RatString(), want.RatString())
	}
	t.Logf("both engines: %s cents either way", want.RatString())
}

// ---------------------------------------------------------------------------
// 5. Byte-identical convergence over every exchange order
// ---------------------------------------------------------------------------

// TestConvergedStateIsByteIdenticalOverEveryExchangeOrder is the property the
// four above are instances of, asserted over a mixed workload: registers and
// ledgers, both branches, several targets.
//
// Every permutation is not tractable, so this drives a set of orderings chosen
// to be the ones that actually differ — each side first, interleaved, and both
// reversals — and compares the §6.1 state root of each against the first.
// A single differing byte anywhere in the observable state fails it.
func TestConvergedStateIsByteIdenticalOverEveryExchangeOrder(t *testing.T) {
	a := newBranch(t, "A", branchA)
	b := newBranch(t, "B", branchB)

	fromA := concat(
		a.write(t, at(0), emit.Change{
			Table: "items", Kind: emit.Update,
			Row: map[string]any{"id": "item-1", "name": "Ribeye", "price": num(24950, -2)},
		}),
		a.write(t, at(time.Minute), emit.Change{
			Table: "stock_movements", Kind: emit.Insert,
			Row: map[string]any{"id": "mv-a", "inventory_item_id": "ing-steak", "quantity": num(-1, 0)},
		}),
		a.write(t, at(2*time.Minute), emit.Change{
			Table: "orders", Kind: emit.Insert,
			Row: map[string]any{"id": "order-a", "location_id": branchA, "order_number": "100"},
		}),
		a.write(t, at(6*time.Minute), emit.Change{
			Table: "categories", Kind: emit.Delete,
			Row: map[string]any{"id": "cat-old"},
		}),
	)
	fromB := concat(
		b.write(t, at(3*time.Minute), emit.Change{
			Table: "items", Kind: emit.Update,
			Row: map[string]any{"id": "item-1", "name": "Ribeye 300g"},
		}),
		b.write(t, at(4*time.Minute), emit.Change{
			Table: "stock_movements", Kind: emit.Insert,
			Row: map[string]any{"id": "mv-b", "inventory_item_id": "ing-steak", "quantity": num(-1, 0)},
		}),
		b.write(t, at(5*time.Minute), emit.Change{
			Table: "loyalty_transactions", Kind: emit.Insert,
			Row: map[string]any{"id": "lt-b", "customer_id": "cust-1", "txn_type": "earn", "points": int64(120)},
		}),
	)

	assertNoTie(t, concat(fromA, fromB))

	orders := map[string][]substrate.Record{
		"A then B":            concat(fromA, fromB),
		"B then A":            concat(fromB, fromA),
		"interleaved":         interleave(fromA, fromB),
		"A then B rev":        reversed(concat(fromA, fromB)),
		"B first, A reversed": concat(fromB, reversed(fromA)),
	}

	var want string
	names := make([]string, 0, len(orders))
	for name := range orders {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		e := heal(t, orders[name]...)
		root, err := e.StateRoot()
		if err != nil {
			t.Fatalf("%s: StateRoot: %v", name, err)
		}
		if want == "" {
			want = root
			t.Logf("state root: %s", root)
			continue
		}
		if root != want {
			t.Fatalf("exchange order %q converged to %s, not %s — the merged state is not a "+
				"function of the operation SET, which is the whole claim", name, root, want)
		}
	}

	// The same claim for BeepBite's own algebra, in the strength it supports:
	// State.Equal rather than a content address, because internal/oplog has no
	// state root to compare bytes of.
	base := healOplog(t, orders["A then B"]...)
	for _, name := range names {
		if got := healOplog(t, orders[name]...); !base.Equal(got) {
			t.Fatalf("internal/oplog: exchange order %q reached a different state", name)
		}
	}

	// And the two engines must agree on what they converged TO, not merely each
	// be self-consistent.
	merged := heal(t, orders["A then B"]...)
	if sub, own := register(t, merged, "items", "item-1", "name"), registerOplog(t, base, "items", "item-1", "name"); sub != own {
		t.Fatalf("the engines disagree on items/item-1.name: %q vs %q", sub, own)
	}
	subStock := ledgerSum(t, merged, "stock_movements", "ing-steak", "quantity")
	ownStock := ledgerSumOplog(t, base, "stock_movements", "ing-steak", "quantity")
	if subStock.Cmp(ownStock) != 0 || subStock.Cmp(rat(-2)) != 0 {
		t.Fatalf("stock: substrate %s, oplog %s, want -2", subStock.RatString(), ownStock.RatString())
	}
	if v, ok, _ := merged.Get("categories", "cat-old", "_deleted"); !ok || !bytes.Equal(v, mustEncode(t, true)) {
		t.Fatal("the tombstone did not survive the merge")
	}
}

func mustEncode(t *testing.T, v any) []byte {
	t.Helper()
	b, err := emit.EncodeValue(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
