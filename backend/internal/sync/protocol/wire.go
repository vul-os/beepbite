package protocol

import (
	"encoding/base64"
	"fmt"

	"github.com/beepbite/backend/internal/oplog"
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
)

// WireOp is the JSON form of an operation plus the signature of the node that
// emitted it.
//
// The signature travels with the operation rather than only covering the
// request, so an operation relayed by a third branch is still verifiable
// against its author. That is what makes any node able to relay any other
// node's changes without becoming trusted to have not altered them.
type WireOp struct {
	ID        string `json:"id"`
	Kind      uint8  `json:"kind"`
	Entity    string `json:"entity"`
	Key       string `json:"key"`
	Field     string `json:"field,omitempty"`
	Value     string `json:"value,omitempty"` // base64
	Wall      int64  `json:"wall"`
	Counter   uint32 `json:"counter"`
	Node      string `json:"node"`
	Signature string `json:"sig,omitempty"` // base64
}

// ToWire renders an operation for transmission.
func ToWire(op oplog.Op, sig []byte) WireOp {
	w := WireOp{
		ID:      op.ID,
		Kind:    uint8(op.Kind),
		Entity:  op.Entity,
		Key:     op.Key,
		Field:   op.Field,
		Wall:    op.TS.Wall,
		Counter: op.TS.Counter,
		Node:    op.TS.Node,
	}
	if len(op.Value) > 0 {
		w.Value = base64.StdEncoding.EncodeToString(op.Value)
	}
	if len(sig) > 0 {
		w.Signature = base64.StdEncoding.EncodeToString(sig)
	}
	return w
}

// FromWire validates and decodes one operation from a peer.
//
// Every field is bounded before it is used, and the decoded operation is run
// through the algebra's own Validate so that a peer cannot inject something the
// local engine would refuse to have produced. This function is the only place a
// peer's bytes become an oplog.Op, which is why the checking lives here rather
// than being spread across callers.
func FromWire(w WireOp) (oplog.Op, []byte, error) {
	if len(w.Entity) == 0 || len(w.Entity) > MaxEntityLen {
		return oplog.Op{}, nil, fmt.Errorf("%w: entity length %d", ErrMalformed, len(w.Entity))
	}
	if len(w.Key) == 0 || len(w.Key) > MaxKeyLen {
		return oplog.Op{}, nil, fmt.Errorf("%w: key length %d", ErrMalformed, len(w.Key))
	}
	if len(w.Field) > MaxFieldLen {
		return oplog.Op{}, nil, fmt.Errorf("%w: field length %d", ErrMalformed, len(w.Field))
	}
	if len(w.Node) == 0 || len(w.Node) > MaxNodeIDLen {
		return oplog.Op{}, nil, fmt.Errorf("%w: node length %d", ErrMalformed, len(w.Node))
	}
	if w.ID == "" {
		return oplog.Op{}, nil, fmt.Errorf("%w: operation has no id", ErrMalformed)
	}

	// Reject the encoded length before decoding: base64 of 1 MiB is ~1.37 MiB,
	// and checking after the decode means we allocated it first.
	if base64.StdEncoding.DecodedLen(len(w.Value)) > MaxValueLen {
		return oplog.Op{}, nil, fmt.Errorf("%w: value exceeds %d bytes", ErrMalformed, MaxValueLen)
	}
	value, err := base64.StdEncoding.DecodeString(w.Value)
	if err != nil {
		return oplog.Op{}, nil, fmt.Errorf("%w: value is not base64", ErrMalformed)
	}
	sig, err := base64.StdEncoding.DecodeString(w.Signature)
	if err != nil {
		return oplog.Op{}, nil, fmt.Errorf("%w: signature is not base64", ErrMalformed)
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
		return oplog.Op{}, nil, fmt.Errorf("%w: %v", ErrMalformed, err)
	}
	return op, sig, nil
}

// DecodeOps converts a batch, refusing an oversized one outright rather than
// decoding until it runs out of memory.
func DecodeOps(ws []WireOp) ([]oplog.Op, [][]byte, error) {
	if len(ws) > MaxOpsPerReq {
		return nil, nil, fmt.Errorf("%w: %d operations exceeds the %d limit", ErrMalformed, len(ws), MaxOpsPerReq)
	}
	ops := make([]oplog.Op, 0, len(ws))
	sigs := make([][]byte, 0, len(ws))
	for i, w := range ws {
		op, sig, err := FromWire(w)
		if err != nil {
			return nil, nil, fmt.Errorf("operation %d: %w", i, err)
		}
		ops = append(ops, op)
		sigs = append(sigs, sig)
	}
	return ops, sigs, nil
}
