package oplog

import "sort"

// VersionVector maps a node identity to the highest Timestamp seen from that
// node. It is how one branch tells another "here is everything I have",
// compactly, without shipping the whole log.
//
// A VersionVector is always DERIVED from an oplog by replaying Observe over
// its Ops (or folded together from two vectors via Dominates/Missing) — this
// package never persists one as its own source of truth. A stored vector
// can drift from the log it is supposed to describe: a crash after writing
// the vector but before the op it describes is durable (or the reverse
// ordering) silently produces a vector that claims to have seen an op it
// does not have, or fails to claim one it does, and either way the gap is
// invisible until a peer sync round quietly skips or re-sends the wrong
// ops. Recomputing the vector from the log on demand makes that class of
// bug structurally impossible: the vector cannot disagree with the log,
// because it is nothing but a summary of it.
type VersionVector map[string]Timestamp

// NewVersionVector returns an empty, ready-to-use VersionVector.
func NewVersionVector() VersionVector {
	return make(VersionVector)
}

// Observe folds op into the vector: if op.TS is newer than the vector's
// current entry for op.TS.Node (or there is no entry yet), it becomes the
// new entry.
func (vv VersionVector) Observe(op Op) {
	cur, ok := vv[op.TS.Node]
	if !ok || op.TS.Compare(cur) > 0 {
		vv[op.TS.Node] = op.TS
	}
}

// Dominates reports whether vv has seen everything other has seen: for
// every node other has an entry for, vv has an entry that is equal to or
// newer than it. An empty other is trivially dominated.
func (vv VersionVector) Dominates(other VersionVector) bool {
	for node, ts := range other {
		mine, ok := vv[node]
		if !ok || mine.Compare(ts) < 0 {
			return false
		}
	}
	return true
}

// Missing returns the nodes where other is strictly ahead of vv — the set a
// pull request should ask for — sorted for a deterministic result. A node
// vv has never heard of at all counts as "other is ahead" too, since vv's
// implicit knowledge of that node is the zero Timestamp.
func (vv VersionVector) Missing(other VersionVector) []string {
	var missing []string
	for node, ts := range other {
		mine, ok := vv[node]
		if !ok || mine.Compare(ts) < 0 {
			missing = append(missing, node)
		}
	}
	sort.Strings(missing)
	return missing
}
