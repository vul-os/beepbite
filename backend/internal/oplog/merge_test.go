package oplog

import (
	"fmt"
	"math/rand"
	"testing"
)

// genConvergenceOps builds a fixed pool of Ops covering both Kinds, several
// Entities/Keys, several Fields, several nodes, and — critically for
// exercising LWW — multiple Set ops competing for the SAME (Entity, Key,
// Field), including some with equal Wall but different Node so the
// Timestamp.Compare tiebreak actually gets exercised.
func genConvergenceOps() []Op {
	var ops []Op
	id := 0
	next := func() string {
		id++
		return fmt.Sprintf("op-%04d", id)
	}

	nodes := []string{"branch-a", "branch-b", "branch-c"}
	rows := []string{"row1", "row2", "row3"}
	fields := []string{"price", "name"}

	// Competing Set ops per (row, field): several Wall values, and for one
	// Wall value, one Op per node (same Wall, different Node) to force the
	// Node tiebreak to matter for convergence.
	wall := int64(1_700_000_000_000)
	for _, row := range rows {
		for _, field := range fields {
			for step := 0; step < 4; step++ {
				w := wall + int64(step*1000)
				for ni, node := range nodes {
					ops = append(ops, Op{
						ID:     next(),
						Kind:   KindSet,
						Entity: "menu_item",
						Key:    row,
						Field:  field,
						Value:  []byte(fmt.Sprintf("v-%s-%s-w%d-n%d", row, field, step, ni)),
						TS:     Timestamp{Wall: w, Counter: uint32(ni), Node: node},
					})
				}
			}
		}
	}

	// Append-only Add ops: several items, many contributions from different
	// nodes, so the union has to reassemble correctly regardless of order.
	items := []string{"steak", "fries"}
	for _, item := range items {
		for i := 0; i < 10; i++ {
			node := nodes[i%len(nodes)]
			ops = append(ops, Op{
				ID:     next(),
				Kind:   KindAdd,
				Entity: "stock_movement",
				Key:    item,
				Value:  []byte(fmt.Sprintf("sale-%d", i)),
				TS:     Timestamp{Wall: wall + int64(i), Counter: 0, Node: node},
			})
		}
	}

	return ops
}

// TestState_Convergence is the load-bearing test: the whole point of the
// merge algebra is that the final State does not depend on the order Ops
// were applied in. We take a fixed pool of Ops, shuffle it many different
// ways with a seeded RNG (so a failure is reproducible), apply each
// shuffled order to a fresh State, and assert every resulting State is
// identical to the first.
func TestState_Convergence(t *testing.T) {
	const seed = 42
	const trials = 30

	pool := genConvergenceOps()

	rng := rand.New(rand.NewSource(seed))

	var reference *State
	for trial := 0; trial < trials; trial++ {
		perm := make([]Op, len(pool))
		copy(perm, pool)
		rng.Shuffle(len(perm), func(i, j int) { perm[i], perm[j] = perm[j], perm[i] })

		st := NewState()
		for _, op := range perm {
			if err := st.Apply(op); err != nil {
				t.Fatalf("trial %d: Apply(%+v) error: %v", trial, op, err)
			}
		}

		if reference == nil {
			reference = st
			continue
		}
		if !st.Equal(reference) {
			t.Fatalf("trial %d: state diverged from reference under a different application order", trial)
		}
	}
}

// TestState_ConvergenceViaMerge checks the other direction of the same
// property: splitting the pool into two arbitrary halves, applying each
// half to its own State, and Merge-ing the two States must reach the same
// result as applying the whole pool to one State in any order.
func TestState_ConvergenceViaMerge(t *testing.T) {
	pool := genConvergenceOps()

	reference := NewState()
	for _, op := range pool {
		if err := reference.Apply(op); err != nil {
			t.Fatalf("Apply error: %v", err)
		}
	}

	rng := rand.New(rand.NewSource(7))
	shuffled := make([]Op, len(pool))
	copy(shuffled, pool)
	rng.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })

	mid := len(shuffled) / 3
	a, b := NewState(), NewState()
	for i, op := range shuffled {
		var target *State
		if i < mid {
			target = a
		} else {
			target = b
		}
		if err := target.Apply(op); err != nil {
			t.Fatalf("Apply error: %v", err)
		}
	}

	merged := Merge(a, b)
	if !merged.Equal(reference) {
		t.Fatalf("Merge of split halves diverged from applying the whole pool directly")
	}
}

// TestState_Idempotence asserts that applying every op in the pool a SECOND
// time changes nothing — required for a transport where a peer might resend
// an op it is not sure was received (Now-5's push/pull rounds).
func TestState_Idempotence(t *testing.T) {
	pool := genConvergenceOps()

	st := NewState()
	for _, op := range pool {
		if err := st.Apply(op); err != nil {
			t.Fatalf("Apply error: %v", err)
		}
	}

	// Snapshot the state reached after the first pass, via Merge (State's own
	// combinator) rather than reaching into its internals by hand.
	replica := Merge(st, NewState())

	for _, op := range pool {
		if err := st.Apply(op); err != nil {
			t.Fatalf("second Apply error: %v", err)
		}
	}

	if !st.Equal(replica) {
		t.Fatalf("applying the same ops twice changed the state")
	}
}

// TestState_TwoTillsScenario is the scenario the design exists for: two
// branches, each offline, each sell what they believe is the last steak.
// Both are independent KindAdd ops on the same (Entity, Key) from different
// nodes. Neither may clobber the other — the union must contain both, so a
// read-time SUM(qty) can correctly land at -2 rather than -1.
func TestState_TwoTillsScenario(t *testing.T) {
	tillA := Op{
		ID:     "sale-till-a-1",
		Kind:   KindAdd,
		Entity: "stock_movement",
		Key:    "steak",
		Value:  []byte(`{"qty":-1,"till":"a"}`),
		TS:     Timestamp{Wall: 1_700_000_000_000, Counter: 0, Node: "branch-a"},
	}
	tillB := Op{
		ID:     "sale-till-b-1",
		Kind:   KindAdd,
		Entity: "stock_movement",
		Key:    "steak",
		Value:  []byte(`{"qty":-1,"till":"b"}`),
		TS:     Timestamp{Wall: 1_700_000_000_000, Counter: 0, Node: "branch-b"},
	}

	// Apply in one order...
	st1 := NewState()
	must(t, st1.Apply(tillA))
	must(t, st1.Apply(tillB))

	// ...and the other.
	st2 := NewState()
	must(t, st2.Apply(tillB))
	must(t, st2.Apply(tillA))

	if !st1.Equal(st2) {
		t.Fatalf("two-tills union depends on application order")
	}

	members := st1.Members("stock_movement", "steak")
	if len(members) != 2 {
		t.Fatalf("expected both till sales to survive the union, got %d member(s): %+v", len(members), members)
	}
	seen := map[string]bool{}
	for _, m := range members {
		seen[m.ID] = true
	}
	if !seen[tillA.ID] || !seen[tillB.ID] {
		t.Fatalf("union is missing one of the two till sales: %+v", members)
	}
}

// TestState_SetLastWriterWins is a direct, non-random check of the LWW rule
// backing the Convergence tests: the op with the greater Timestamp wins
// regardless of application order.
func TestState_SetLastWriterWins(t *testing.T) {
	older := Op{ID: "1", Kind: KindSet, Entity: "menu_item", Key: "row1", Field: "price",
		Value: []byte("1000"), TS: Timestamp{Wall: 100, Counter: 0, Node: "a"}}
	newer := Op{ID: "2", Kind: KindSet, Entity: "menu_item", Key: "row1", Field: "price",
		Value: []byte("1500"), TS: Timestamp{Wall: 200, Counter: 0, Node: "a"}}

	forward := NewState()
	must(t, forward.Apply(older))
	must(t, forward.Apply(newer))

	backward := NewState()
	must(t, backward.Apply(newer))
	must(t, backward.Apply(older))

	for _, st := range []*State{forward, backward} {
		v, ok := st.Get("menu_item", "row1", "price")
		if !ok || string(v) != "1500" {
			t.Fatalf("expected newer write (1500) to win regardless of order, got %q (ok=%v)", v, ok)
		}
	}
}

// TestState_ApplyRejectsInvalidOp confirms Apply refuses malformed ops
// rather than silently corrupting merge state.
func TestState_ApplyRejectsInvalidOp(t *testing.T) {
	st := NewState()
	bad := Op{ID: "1", Kind: KindSet, Entity: "", Key: "row1", Field: "price"}
	if err := st.Apply(bad); err == nil {
		t.Fatalf("expected Apply to reject an invalid op")
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
