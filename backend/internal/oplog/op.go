package oplog

import "errors"

// Kind selects which merge rule an Op is subject to. These are the only two
// the Now-5 ownership model needs (ROADMAP.md): catalog and config rows
// (menu, pricing, staff) are last-writer-wins; stock movements, sales
// events, audit rows and GPS pings are append-only and union-merged. There
// is deliberately no delete, counter or sequence Kind — see merge.go's
// package-level doc for why.
type Kind uint8

const (
	// KindSet is a last-writer-wins write to a single (Entity, Key, Field)
	// register. Highest Timestamp under Timestamp.Compare wins.
	KindSet Kind = iota + 1

	// KindAdd is an insert into an append-only set keyed by (Entity, Key).
	// Members are unioned by Op.ID; nothing is ever removed by this package.
	KindAdd
)

var (
	// ErrEmptyEntity is returned by Validate when Entity is empty.
	ErrEmptyEntity = errors.New("oplog: entity is empty")
	// ErrEmptyKey is returned by Validate when Key is empty.
	ErrEmptyKey = errors.New("oplog: key is empty")
	// ErrSetNeedsField is returned by Validate for a KindSet Op with no Field.
	ErrSetNeedsField = errors.New("oplog: Set op requires Field")
	// ErrAddHasField is returned by Validate for a KindAdd Op that sets Field.
	ErrAddHasField = errors.New("oplog: Add op must not set Field")
	// ErrUnknownKind is returned by Validate for any Kind other than KindSet
	// or KindAdd.
	ErrUnknownKind = errors.New("oplog: unknown Kind")
)

// Op is one entry in a node's operation log.
//
// Entity is the table or collection the op belongs to (e.g. "menu_item",
// "stock_movement"). Key is the row identity within that Entity. Field is
// the column a KindSet op writes; it is meaningless for KindAdd and must be
// empty (an Add is a whole-record insert into a set, not a per-column
// write).
type Op struct {
	// ID uniquely identifies this op. It is the identity Add uses to dedup
	// on union and Set uses to recognise "this exact op, replayed" as a
	// no-op. This package neither generates nor checks it.
	//
	// It is a CONTENT ADDRESS, not a minted name: internal/sync/substrate
	// sets it to the shared engine's §4.1 address of the op's canonical
	// bytes, lowercase hex, and migration 004 stores exactly that as
	// sync_ops.id. A caller must not invent one. The reason is worth stating
	// where it will be read: while ops were addressed by a caller-minted
	// uuid and deduplicated by the engine on content, one operation was two
	// rows in Postgres and one op to the engine — so opstore.Append's
	// idempotence held for the log and not for the store, which is a
	// divergence no error surfaces.
	ID string

	Kind Kind

	Entity string
	Key    string

	// Field is the column name for KindSet, and must be empty for KindAdd.
	Field string

	// Value is the raw payload: the new register value for KindSet, or the
	// member payload for KindAdd. Encoding is the caller's business; this
	// package treats it as an opaque byte string.
	Value []byte

	// TS is the HLC timestamp under which this op was minted, per hlc.go.
	TS Timestamp
}

// Validate reports whether op is well-formed enough to Apply. It rejects an
// empty Entity or Key, a KindSet with no Field, a KindAdd with a Field, and
// any Kind other than KindSet/KindAdd.
func (op Op) Validate() error {
	if op.Entity == "" {
		return ErrEmptyEntity
	}
	if op.Key == "" {
		return ErrEmptyKey
	}
	switch op.Kind {
	case KindSet:
		if op.Field == "" {
			return ErrSetNeedsField
		}
	case KindAdd:
		if op.Field != "" {
			return ErrAddHasField
		}
	default:
		return ErrUnknownKind
	}
	return nil
}

// There is deliberately no canonical encoder in this package any more.
//
// Op.Canonical() used to render an op as length-prefixed bytes for hashing and
// signing, on the reasoning that two nodes must compute identical bytes for an
// identical op. That reasoning still holds; what changed is who owns the answer.
// internal/sync/substrate encodes an op through the shared engine's §4.1
// deterministic CBOR, addresses it by the content address of those bytes, and
// signs it as an RFC 9052 COSE_Sign1 — so the bytes two nodes agree on are the
// substrate's, proven byte-identical against the frozen conformance vectors on
// every CI run, rather than BeepBite's own and proven by nobody.
//
// Keeping a second encoder here would be strictly worse than having none: an op
// signed under one framing and addressed under the other is a signature that
// verifies against bytes nothing else in the system computes.
