package oplog

import (
	"bytes"
	"encoding/binary"
	"errors"
)

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
	// no-op. Callers are expected to mint IDs that are globally unique
	// (e.g. ULIDs) — this package does not generate or check them.
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

// Canonical returns a deterministic byte encoding of op, suitable for
// hashing or signing (Now-5's mutual-Ed25519 peer auth needs exactly this:
// two nodes must compute the identical bytes for the identical op).
//
// This is NOT encoding/json. JSON's map key ordering is unspecified across
// the language (Go happens to sort struct-derived object keys, but that is
// an implementation detail, not a promise), and its string escaping rules
// have changed between library versions before (e.g. HTML-escaping
// defaults). Either kind of drift would silently change the encoded bytes
// of an op that hasn't changed at all, which breaks both hashing and
// signature verification across a version skew between two branches'
// binaries — exactly the failure mode a canonical encoding exists to rule
// out. Instead every variable-length field (ID, Entity, Key, Field, Value,
// Node) is written as a fixed-width big-endian uint32 length prefix
// followed by its raw bytes. Length-prefixing (rather than a delimiter) is
// what makes the encoding unambiguous: two ops whose fields differ only in
// where a boundary falls — e.g. Entity="ab",Key="c" vs Entity="a",Key="bc"
// — encode to different byte strings, because the prefix records exactly
// where each field ends. A delimiter-based scheme could conflate the two
// wherever a field's content contains the delimiter.
func (op Op) Canonical() []byte {
	var buf bytes.Buffer
	buf.WriteByte(byte(op.Kind))
	writeLenPrefixed(&buf, []byte(op.ID))
	writeLenPrefixed(&buf, []byte(op.Entity))
	writeLenPrefixed(&buf, []byte(op.Key))
	writeLenPrefixed(&buf, []byte(op.Field))
	writeLenPrefixed(&buf, op.Value)

	var ts [12]byte
	binary.BigEndian.PutUint64(ts[0:8], uint64(op.TS.Wall))
	binary.BigEndian.PutUint32(ts[8:12], op.TS.Counter)
	buf.Write(ts[:])
	writeLenPrefixed(&buf, []byte(op.TS.Node))

	return buf.Bytes()
}

// writeLenPrefixed appends a 4-byte big-endian length followed by b to buf.
func writeLenPrefixed(buf *bytes.Buffer, b []byte) {
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(b)))
	buf.Write(length[:])
	buf.Write(b)
}
