package oplog

// State holds the merged result of applying a set of Ops: one
// last-writer-wins value per (Entity, Key, Field) for KindSet ops, and one
// union set per (Entity, Key) for KindAdd ops.
//
// What this deliberately does NOT do:
//
//   - No delete. There is no tombstone Kind. A row that should disappear is
//     a modelling problem for the caller (e.g. a Set of a "deleted" field),
//     not something this package resolves itself.
//   - No counter. This is the trap the roadmap calls out by name (Now-5): a
//     stored mutable quantity is exactly the thing that lets two branches
//     clobber each other instead of converging. If stock quantity were a
//     KindSet register, two tills each selling the last steak while offline
//     would each compute "1 left, sell it, set stock to 0", and LWW merge
//     would silently keep only ONE of those two sales — the shop would
//     believe it sold one steak it didn't have, instead of sold two it
//     didn't have. The correct answer, per the roadmap, is that quantity is
//     never stored: each sale is its own KindAdd stock-movement Op (append
//     -only, union-merged, never clobbers), and quantity-on-hand is
//     SUM(qty) over that union at READ time. Both sales survive the merge
//     and the deficit is visible (-2), which is the honest state to be in.
//     This package supplies the union; the SUM is the caller's read path.
//   - No sequence allocation. Nothing here hands out order numbers or any
//     other value that must be unique-and-monotonic across nodes. Under
//     Now-5's ownership model that only ever needs to happen for
//     branch-owned data (orders, sequence numbers, the cash drawer), which
//     by definition has exactly one writer and so has no merge problem to
//     solve in the first place — it never enters this package.
//
// State is not safe for concurrent use by multiple goroutines. The
// concurrency-safe way to combine work happening on two different States
// (e.g. one per goroutine, or one per peer sync round) is Merge, not shared
// mutation of one State.
type State struct {
	// registers holds the current LWW winner per (Entity, Key, Field).
	registers map[regKey]registerValue

	// adds holds the current union set per (Entity, Key), keyed within by
	// Op.ID so a duplicate Add collapses to one member.
	adds map[addKey]map[string]Op
}

type regKey struct {
	Entity string
	Key    string
	Field  string
}

type addKey struct {
	Entity string
	Key    string
}

type registerValue struct {
	Value []byte
	TS    Timestamp
	OpID  string
}

// NewState returns an empty State.
func NewState() *State {
	return &State{
		registers: make(map[regKey]registerValue),
		adds:      make(map[addKey]map[string]Op),
	}
}

// Apply folds op into the state.
//
// Set (LWW): the incoming op wins iff its Timestamp compares strictly
// greater than the current holder's, per Timestamp.Compare. Two
// consequences fall out of that "strictly greater" test, and both are the
// point of using Timestamp.Compare rather than wall-clock time alone:
//
//   - Applying the SAME op twice is a no-op. The second application compares
//     its own Timestamp against itself (already the holder) and Compare
//     returns 0, which is not "strictly greater", so nothing changes.
//   - Applying a set of Set ops in ANY order reaches the same final state.
//     This is the standard LWW-register merge property: the winner is a
//     function of the ops' Timestamps alone (a total order, per hlc.go), not
//     of arrival order, so every possible application order computes the
//     same max and lands on the same winner.
//
// Add (union): op is stored under its own Op.ID within the (Entity, Key)
// set. Re-applying the same ID overwrites the map entry with an identical
// value, so it is also idempotent; applying a batch of distinct-ID Add ops
// in any order produces the same set, because set union does not care about
// insertion order.
func (s *State) Apply(op Op) error {
	if err := op.Validate(); err != nil {
		return err
	}

	switch op.Kind {
	case KindSet:
		k := regKey{Entity: op.Entity, Key: op.Key, Field: op.Field}
		cur, ok := s.registers[k]
		if !ok || op.TS.Compare(cur.TS) > 0 {
			s.registers[k] = registerValue{Value: op.Value, TS: op.TS, OpID: op.ID}
		}

	case KindAdd:
		k := addKey{Entity: op.Entity, Key: op.Key}
		set, ok := s.adds[k]
		if !ok {
			set = make(map[string]Op)
			s.adds[k] = set
		}
		set[op.ID] = op
	}

	return nil
}

// Get returns the current LWW value for (entity, key, field) and whether a
// Set op has ever established one.
func (s *State) Get(entity, key, field string) ([]byte, bool) {
	v, ok := s.registers[regKey{Entity: entity, Key: key, Field: field}]
	if !ok {
		return nil, false
	}
	return v.Value, true
}

// Members returns the current union-merged Add set for (entity, key). Order
// is unspecified — the whole point of an Add set is that order does not
// matter — so callers that need a stable order must sort the result
// themselves.
func (s *State) Members(entity, key string) []Op {
	set := s.adds[addKey{Entity: entity, Key: key}]
	if len(set) == 0 {
		return nil
	}
	out := make([]Op, 0, len(set))
	for _, op := range set {
		out = append(out, op)
	}
	return out
}

// Equal reports whether s and other hold identical merged state: the same
// LWW winners and the same Add-set members. It exists mainly for tests
// (asserting convergence across application orders) but is also the
// intended way to check "did this sync round actually change anything".
func (s *State) Equal(other *State) bool {
	if len(s.registers) != len(other.registers) {
		return false
	}
	for k, v := range s.registers {
		ov, ok := other.registers[k]
		if !ok || v.TS.Compare(ov.TS) != 0 || v.OpID != ov.OpID || !bytesEqual(v.Value, ov.Value) {
			return false
		}
	}

	if len(s.adds) != len(other.adds) {
		return false
	}
	for k, set := range s.adds {
		oset, ok := other.adds[k]
		if !ok || len(set) != len(oset) {
			return false
		}
		for id, op := range set {
			oop, ok := oset[id]
			if !ok || op.TS.Compare(oop.TS) != 0 || !bytesEqual(op.Value, oop.Value) ||
				op.Entity != oop.Entity || op.Key != oop.Key || op.Field != oop.Field || op.Kind != oop.Kind {
				return false
			}
		}
	}
	return true
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// Merge combines two States into a new one, without mutating either input.
//
// Both halves of State are join-semilattices — LWW-by-Timestamp for
// registers, set union for adds — so Merge can be computed directly from
// each side's already-reduced winners/members rather than replaying every
// Op that ever produced them. That is what makes Merge commutative,
// associative and idempotent (Merge(a,b) == Merge(b,a), Merge(Merge(a,b),c)
// == Merge(a,Merge(b,c)), Merge(a,a) == a): each property holds for max-by-
// Timestamp and for set union individually, so it holds for their pairing.
// This is also why Apply and Merge always agree — applying every Op from
// two logs in some interleaved order, or Merge-ing the two States those
// logs separately produced, reach the same result.
func Merge(a, b *State) *State {
	out := NewState()

	for k, v := range a.registers {
		out.registers[k] = v
	}
	for k, v := range b.registers {
		cur, ok := out.registers[k]
		if !ok || v.TS.Compare(cur.TS) > 0 {
			out.registers[k] = v
		}
	}

	for k, set := range a.adds {
		dst := make(map[string]Op, len(set))
		for id, op := range set {
			dst[id] = op
		}
		out.adds[k] = dst
	}
	for k, set := range b.adds {
		dst, ok := out.adds[k]
		if !ok {
			dst = make(map[string]Op, len(set))
			out.adds[k] = dst
		}
		for id, op := range set {
			dst[id] = op
		}
	}

	return out
}
