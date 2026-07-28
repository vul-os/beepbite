package protocol

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"

	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/substrate"
)

// Wire limits.
//
// These are a trust boundary, not tuning. Everything below arrives from a peer
// and is used to size an allocation, so an absent bound is a peer-controlled
// memory allocation — the cheapest denial of service there is. The numbers are
// generous for legitimate traffic and small enough that a hostile peer cannot
// hurt us: an entity is a table name, a key is a UUID, and a value is one
// column of one row.
const (
	MaxEntityLen = 128
	MaxKeyLen    = 256
	MaxFieldLen  = 128
	MaxNodeIDLen = 128
	MaxValueLen  = 1 << 20 // 1 MiB
	MaxOpsPerReq = 1000

	// MaxCoseLen bounds the signed envelope. It is the value plus room for the
	// §4.1 framing (a protected header, a 64-byte signature and the op's own
	// address fields), because the envelope carries the value and cannot be
	// smaller than it.
	MaxCoseLen = MaxValueLen + 4096

	// OpIDLen is the §4.1 content address as this wire spells it: 33 bytes in
	// lowercase hex.
	OpIDLen = 66
)

// WireOp is the JSON form of an operation.
//
// # What actually travels
//
// Cose is the operation. It is the COSE_Sign1 envelope the author minted: the
// canonical §4.1 bytes plus a signature over them, and the only field a
// receiver is allowed to trust. Everything else is a PROJECTION the sender
// computed for the receiver's convenience — so a pull response can be indexed,
// paged and logged without decoding every envelope — and a receiver that is
// about to act on an op must get it from substrate.Engine.Ingest rather than
// from these fields.
//
// That distinction is load-bearing. The projection is peer-controlled and
// unsigned; the envelope is neither. A receiver that read Value out of the JSON
// and Kind out of the JSON would be merging whatever the sender typed, with the
// signature checked on something else entirely. FromWire below bounds the
// projection and refuses a structurally impossible one, and stops there: it
// does not and cannot decide whether the projection is TRUE.
//
// The signature travelling with the operation, rather than only covering the
// request, is what lets any node relay any other node's changes without
// becoming trusted to have not altered them.
type WireOp struct {
	// ID is the §4.1 content address, lowercase hex. Derivable from Cose by
	// anyone who holds it, and present so a receiver can dedup a batch before
	// paying for the verification.
	ID   string `json:"id"`
	Cose string `json:"cose"` // base64 COSE_Sign1 — the operation itself

	Kind    uint8  `json:"kind"`
	Entity  string `json:"entity"`
	Key     string `json:"key"`
	Field   string `json:"field,omitempty"`
	Value   string `json:"value,omitempty"` // base64
	Wall    int64  `json:"wall"`
	Counter uint32 `json:"counter"`
	Node    string `json:"node"`
}

// ToWire renders a minted record for transmission.
func ToWire(rec substrate.Record) WireOp {
	w := WireOp{
		ID:      rec.ID,
		Kind:    uint8(rec.Op.Kind),
		Entity:  rec.Op.Entity,
		Key:     rec.Op.Key,
		Field:   rec.Op.Field,
		Wall:    rec.Op.TS.Wall,
		Counter: rec.Op.TS.Counter,
		Node:    rec.Op.TS.Node,
	}
	if len(rec.Op.Value) > 0 {
		w.Value = base64.StdEncoding.EncodeToString(rec.Op.Value)
	}
	if len(rec.Cose) > 0 {
		w.Cose = base64.StdEncoding.EncodeToString(rec.Cose)
	}
	return w
}

// FromWire validates and decodes one operation from a peer.
//
// Every field is bounded before it is used, the id is checked to be a content
// address rather than a name, and the decoded projection is run through the
// algebra's own Validate so a peer cannot describe something the local engine
// would refuse to have produced. This function is the only place a peer's bytes
// become a substrate.Record, which is why the checking lives here rather than
// being spread across callers.
//
// What it does NOT do is decide the operation is genuine. Only ingesting the
// envelope does that — the signature check, the §4 validators and the §3 skew
// bound all live in the engine, and all three run before any state moves. A
// caller MUST pass the returned record's Cose to substrate.Engine.Ingest before
// treating any of its other fields as true.
func FromWire(w WireOp) (substrate.Record, error) {
	if len(w.Entity) == 0 || len(w.Entity) > MaxEntityLen {
		return substrate.Record{}, fmt.Errorf("%w: entity length %d", ErrMalformed, len(w.Entity))
	}
	if len(w.Key) == 0 || len(w.Key) > MaxKeyLen {
		return substrate.Record{}, fmt.Errorf("%w: key length %d", ErrMalformed, len(w.Key))
	}
	if len(w.Field) > MaxFieldLen {
		return substrate.Record{}, fmt.Errorf("%w: field length %d", ErrMalformed, len(w.Field))
	}
	if len(w.Node) == 0 || len(w.Node) > MaxNodeIDLen {
		return substrate.Record{}, fmt.Errorf("%w: node length %d", ErrMalformed, len(w.Node))
	}
	if len(w.ID) != OpIDLen {
		return substrate.Record{}, fmt.Errorf("%w: op id is %d characters, want %d", ErrMalformed, len(w.ID), OpIDLen)
	}
	if _, err := hex.DecodeString(w.ID); err != nil {
		return substrate.Record{}, fmt.Errorf("%w: op id is not hex", ErrMalformed)
	}

	// Reject the encoded lengths before decoding: base64 of 1 MiB is ~1.37 MiB,
	// and checking after the decode means we allocated it first.
	if base64.StdEncoding.DecodedLen(len(w.Value)) > MaxValueLen {
		return substrate.Record{}, fmt.Errorf("%w: value exceeds %d bytes", ErrMalformed, MaxValueLen)
	}
	if base64.StdEncoding.DecodedLen(len(w.Cose)) > MaxCoseLen {
		return substrate.Record{}, fmt.Errorf("%w: envelope exceeds %d bytes", ErrMalformed, MaxCoseLen)
	}
	value, err := base64.StdEncoding.DecodeString(w.Value)
	if err != nil {
		return substrate.Record{}, fmt.Errorf("%w: value is not base64", ErrMalformed)
	}
	cose, err := base64.StdEncoding.DecodeString(w.Cose)
	if err != nil {
		return substrate.Record{}, fmt.Errorf("%w: envelope is not base64", ErrMalformed)
	}
	if len(cose) == 0 {
		// An op with no envelope is unverifiable, and there is no longer a
		// mode in which that is acceptable: the engine will not assemble an
		// envelope without a signature, so an op that has none was never
		// minted by a conformant node.
		return substrate.Record{}, fmt.Errorf("%w: operation carries no signed envelope", ErrMalformed)
	}

	op := oplog.Op{
		ID:     w.ID,
		Kind:   oplog.Kind(w.Kind),
		Entity: w.Entity,
		Key:    w.Key,
		Field:  w.Field,
		Value:  value,
		TS: oplog.Timestamp{
			Wall:    w.Wall,
			Counter: w.Counter,
			Node:    w.Node,
		},
	}
	if err := op.Validate(); err != nil {
		return substrate.Record{}, fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	return substrate.Record{ID: w.ID, Cose: cose, Op: op}, nil
}

// DecodeOps converts a batch, refusing an oversized one outright rather than
// decoding until it runs out of memory.
func DecodeOps(ws []WireOp) ([]substrate.Record, error) {
	if len(ws) > MaxOpsPerReq {
		return nil, fmt.Errorf("%w: %d operations exceeds the %d limit", ErrMalformed, len(ws), MaxOpsPerReq)
	}
	recs := make([]substrate.Record, 0, len(ws))
	for i, w := range ws {
		rec, err := FromWire(w)
		if err != nil {
			return nil, fmt.Errorf("operation %d: %w", i, err)
		}
		recs = append(recs, rec)
	}
	return recs, nil
}
