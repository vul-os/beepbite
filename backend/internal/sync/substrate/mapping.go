// Package substrate expresses BeepBite's multi-branch replication in the shared
// DMTAP Sync algebra (KOTVA `substrate/SYNC.md`, capability ③), so that the
// operation log carried between branches is the suite's algebra rather than a
// second one written here.
//
// Nothing about BeepBite's architecture moves. Storage is still Postgres
// (`sync_ops`, migration 004), transport is still the mutual-Ed25519 envelope in
// internal/sync/protocol, identity is still the per-node Ed25519 key in
// internal/nodeid. The engine is in-memory and does no I/O at all; what it
// supplies is the part that decides *which write wins*, the canonical bytes an
// operation is addressed and signed by, and the refusal codes for the things
// that must not be accepted.
//
// # This is DMTAP-SYNC, and the name is earned rather than claimed
//
// ROADMAP Stage 0's rule is that BeepBite's own hand-rolled algebra
// (internal/oplog) must never be called DMTAP-sync. That rule stands and this
// package does not weaken it: internal/oplog is still BeepBite's own engine and
// is still the default. What this package runs is not a re-implementation — it
// is the substrate's own Rust core, compiled to WebAssembly and executed under
// wazero, byte-for-byte the artifact the native runner and the browser binding
// execute. vectors_test.go drives all 24 of SYNC.md §10's frozen conformance
// vectors through it and compares the results against the frozen file, and CI
// runs that job with BEEPBITE_REQUIRE_SYNC_VECTORS=1 so it cannot skip. The
// label is legitimate exactly as far as that job is green, and no further.
//
// # The mapping, and the selection test for each choice
//
// SYNC.md §4.10 requires an implementation to write down, per modelled object,
// which primitive it chose and how it answered the selection test — because
// choosing §4.5 where §4.4 belongs is silent, permanent, converged data loss,
// and choosing §4.4 where §4.3 belongs loses writes that were never in conflict.
// BeepBite models two things, which are exactly internal/oplog's two Kinds.
//
// ## Group-owned registers (oplog.KindSet) → §4.4 LWW register (kind lww_set)
//
//	target  "<entity>/<key>"    field  <field>
//	value   bstr, the op's opaque Value bytes
//
// Menu, pricing and staff are group-owned and replicated down (ROADMAP Now-5),
// and internal/oplog already merges them last-writer-wins by HLC, so §4.4 is the
// faithful mapping rather than a reinterpretation. The register is per
// (entity, key, field) — per column, not per row — because that is what
// oplog.State does today; §4.1.1 places granularity in the address space, so
// keeping the field in the address keeps the behaviour identical.
//
// The value is an opaque byte string rather than a native structure because
// oplog.Op.Value is opaque by contract ("Encoding is the caller's business").
// ext-value has a bstr tag for precisely this, and it keeps the substrate from
// acquiring an opinion about a payload BeepBite has not yet decided the shape of.
//
// There is no §4.5 death certificate anywhere in this mapping, and that is a
// decision rather than an omission. internal/oplog has no tombstone Kind on
// purpose (see merge.go's doc): a row that should disappear is modelled by the
// caller as an ordinary write of a "deleted" field. The selection test — "is
// there any user action that restores this thing, using the same ordinary
// operation that created it?" — is answered YES for every row BeepBite deletes
// (an un-archived menu item is an ordinary edit), and a certificate that
// dominates every later write would make the restored row invisible on every
// replica with no error anywhere.
//
// ## Append-only ledgers (oplog.KindAdd) → §4.3 OR-Set (kind set_add)
//
//	target  "<entity>/<key>"
//	value   bstr, wall(8) ‖ counter(4) ‖ author(32) ‖ the op's Value bytes
//
// Stock movements, sales events, audit rows and GPS pings are append-only and
// union-merged, and the quantity on hand is SUM(qty) over that union at read
// time — never a stored counter. That is ROADMAP Now-5's answer to "two tills
// sold the last steak": concurrent offline sales add rather than clobber and
// land honestly at −2. §4.6's own closing note names this case and permits it: a
// counter that is a sum of immutable facts MAY be modelled as set-add of an
// immutable record with a read-side SUM. A PN-counter would converge on the same
// total and discard the ledger, which is the whole audit story.
//
// No set-remove is ever minted, because internal/oplog has no remove. An OR-Set
// with no removes is a grow-only set whose merge is plain union — the identity
// on what oplog.State already computes.
//
// The HLC stamp is folded into the element for a reason that is easy to miss and
// expensive to discover later. §4.3 element identity is the *value*: two adds
// carrying identical bytes collapse to one element carrying two add-tags, and a
// read-side SUM over the members would then count one sale where two happened —
// the −2 property inverted into a −1 bug, converged and silent on every replica.
// internal/oplog keys its Add set by Op.ID instead, so it does not have this
// problem; stamping the element restores the distinction the engine's own
// identity rule would otherwise erase. The three leading fields are fixed-width,
// so the framing is unambiguous without a length prefix.
//
// # What it costs
//
// Measured on an Apple M2 against github.com/vul-os/kotva/bindings/go v0.2.0,
// building ./cmd/server with and without a reachable call into this package:
//
//	embedded engine artifact   427,731 bytes (418 KiB)
//	cmd/server                 25,473,874 → 29,990,274 bytes (+4.31 MiB, +17.7%)
//
// "Reachable" is doing real work in that sentence and the measurement is easy to
// get wrong. A probe whose result is discarded, or guarded by a constant false,
// lets the linker prune the entire call graph and reports about half a megabyte
// — a number that is not wrong so much as measuring nothing. The figure above
// comes from a probe behind a runtime environment lookup that exercises Open,
// Mint, Ingest, Get, Members, VersionVector, StateRoot and Observe, so the whole
// package is genuinely linked. Reaching less of it measures less — a `if false`
// probe of the same call reported +0.53 MiB, and an earlier recorded figure for
// this adoption was +4.24 MiB — so the number is only meaningful alongside the
// surface it was taken against, which is why the surface is written down.
//
// cmd/server does not import this package today — Now-5's transport does not
// exist and nothing in the server's graph reaches it — so the server binary is
// unchanged at 25,473,874 bytes right now. The figure above is what wiring it in
// will cost, measured rather than estimated.
//
// The delta is worth stating plainly, because the artifact size alone
// understates it by an order of magnitude: only 418 KiB of those 4.31 MiB is the
// engine, and roughly 90% is wazero's optimizing compiler. That is the price of
// running WebAssembly without cgo, and cgo is the alternative BeepBite cannot
// take: with the engine linked, CGO_ENABLED=0 cross-compilation to linux/amd64,
// linux/arm64, windows/amd64 and darwin/arm64 all still succeed — which is
// ROADMAP Stage 2 precondition 5, and the reason the single static binary
// survives adopting the engine.
//
// Compiling the module is the expensive startup step (a few hundred milliseconds,
// once per process). Open takes a cache directory so a shop-counter machine that
// is power-cycled daily pays it once rather than every morning.
package substrate

import (
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	kotvasync "github.com/vul-os/kotva/bindings/go"

	"github.com/beepbite/backend/internal/nodeid"
	"github.com/beepbite/backend/internal/oplog"
)

// EngineName names the merge algebra a deployment running this package
// advertises in the internal/sync/protocol handshake.
//
// It is deliberately NOT protocol.Engine ("beepbite-oplog-v1"). The two algebras
// do not share a total order — internal/oplog breaks an exact timestamp tie on
// the node id's base32 spelling, the substrate on the author public key's raw
// bytes — so a mesh running both would converge to two different states and
// report success. ROADMAP Stage 2 is explicit that the choice is per deployment,
// recorded in the handshake, and that a peer speaking the other one is refused
// rather than silently mis-merged.
const EngineName = "dmtap-sync-v0"

// kinds holds the two §4.2 op-kind numbers this mapping uses.
//
// They are read from the engine at Open rather than written down here. SYNC.md's
// adoption notes say never to hard-code them, and there is a concrete trap in
// this particular product: oplog.KindSet is 1 and the substrate's set_add is
// also 1, while oplog.KindSet maps to lww_set which is 3. A hard-coded 1 would
// be silently wrong in the one direction nothing would catch.
type kinds struct {
	setAdd uint8
	lwwSet uint8
}

// DBKind renders an oplog.Kind as the §4.2 op-kind number sync_ops.kind stores.
//
// This is the only place the translation exists, and it goes through the numbers
// the engine reported at Open rather than through constants. internal/oplog's
// KindSet is 1 and the substrate's set_add is also 1 while KindSet maps to
// lww_set (3), so a hard-coded translation is wrong in exactly the direction
// that passes every CHECK constraint and describes the opposite operation.
func (e *Engine) DBKind(k oplog.Kind) (int16, error) {
	switch k {
	case oplog.KindSet:
		return int16(e.kinds.lwwSet), nil
	case oplog.KindAdd:
		return int16(e.kinds.setAdd), nil
	default:
		return 0, oplog.ErrUnknownKind
	}
}

// OplogKind reads a stored §4.2 kind back into BeepBite's vocabulary.
//
// A kind this product does not model — set_remove, death, counter, seq_insert,
// seq_remove, tree_move — is refused rather than coerced. The row did not come
// from BeepBite, and guessing at which primitive it meant is how an op ends up
// merged under the wrong algebra.
func (e *Engine) OplogKind(k int16) (oplog.Kind, error) {
	switch {
	case k == int16(e.kinds.lwwSet):
		return oplog.KindSet, nil
	case k == int16(e.kinds.setAdd):
		return oplog.KindAdd, nil
	default:
		return 0, fmt.Errorf("substrate: op kind %d is not one BeepBite models", k)
	}
}

// targetSep joins an entity and a key into a §4.1 target.
//
// An entity containing the separator would make the split ambiguous on the way
// back, so mint refuses one rather than round-tripping to a different address.
// Entities are table names, so this has never been reachable — which is the
// reason to check it now rather than to assume it stays that way.
const targetSep = "/"

// targetOf addresses one row.
func targetOf(entity, key string) string { return entity + targetSep + key }

// splitTarget is targetOf inverted. It splits at the first separator, which is
// exact because mintable entities contain none.
func splitTarget(target string) (entity, key string, err error) {
	entity, key, ok := strings.Cut(target, targetSep)
	if !ok || entity == "" || key == "" {
		return "", "", fmt.Errorf("substrate: %q is not an <entity>/<key> target", target)
	}
	return entity, key, nil
}

// ledgerElement builds the OR-Set element for one append-only op: the op's HLC
// in fixed-width big-endian form, then the author key, then the payload.
//
// See the package doc for why the stamp is part of the element and not merely
// part of the add-tag.
func ledgerElement(ts oplog.Timestamp, author []byte, payload []byte) json.RawMessage {
	b := make([]byte, 0, 8+4+len(author)+len(payload))
	var wall [8]byte
	binary.BigEndian.PutUint64(wall[:], uint64(ts.Wall))
	b = append(b, wall[:]...)
	var counter [4]byte
	binary.BigEndian.PutUint32(counter[:], ts.Counter)
	b = append(b, counter[:]...)
	b = append(b, author...)
	b = append(b, payload...)
	return kotvasync.Bytes(b)
}

// ledgerPayload reads back what ledgerElement wrote, returning the op's own
// Value bytes and the stamp that distinguishes it from an identical fact
// recorded at another moment.
func ledgerPayload(tagged json.RawMessage) (payload []byte, ts oplog.Timestamp, err error) {
	raw, err := untagBytes(tagged)
	if err != nil {
		return nil, oplog.Timestamp{}, err
	}
	const head = 8 + 4 + 32
	if len(raw) < head {
		return nil, oplog.Timestamp{}, fmt.Errorf(
			"substrate: ledger element is %d bytes, too short to carry its stamp", len(raw))
	}
	node, err := nodeFromAuthorBytes(raw[12:head])
	if err != nil {
		return nil, oplog.Timestamp{}, err
	}
	return raw[head:], oplog.Timestamp{
		Wall:    int64(binary.BigEndian.Uint64(raw[0:8])),
		Counter: binary.BigEndian.Uint32(raw[8:12]),
		Node:    node,
	}, nil
}

// untagBytes decodes a §4.1 tagged byte-string value.
//
// It refuses any other tag rather than coercing. A value the engine spells as
// text where this package expects bytes is a mapping bug, and guessing at it
// would make the bug converge instead of surface.
func untagBytes(tagged json.RawMessage) ([]byte, error) {
	var v struct {
		Bstr *string `json:"bstr"`
	}
	if err := json.Unmarshal(tagged, &v); err != nil || v.Bstr == nil {
		return nil, fmt.Errorf("substrate: engine value is not a tagged byte string: %s", tagged)
	}
	b, err := hex.DecodeString(*v.Bstr)
	if err != nil {
		return nil, fmt.Errorf("substrate: engine value is not hex: %w", err)
	}
	return b, nil
}

// authorHex spells a BeepBite node id the way the substrate names an author.
//
// The two are the same 32 bytes in two alphabets: a nodeid.NodeID *is* an
// Ed25519 public key (lowercase base32), and §3's author *is* an Ed25519 public
// key (lowercase hex). So this conversion is total and lossless, and there is no
// lookup table anywhere in this package mapping one identity space onto another
// — the identity spaces are the same one.
func authorHex(node string) (string, error) {
	id, err := nodeid.Parse(node)
	if err != nil {
		return "", fmt.Errorf("substrate: op node %q is not a BeepBite node id: %w", node, err)
	}
	return hex.EncodeToString(id[:]), nil
}

// nodeFromAuthor is authorHex inverted.
func nodeFromAuthor(author string) (string, error) {
	raw, err := hex.DecodeString(author)
	if err != nil {
		return "", fmt.Errorf("substrate: author %q is not hex: %w", author, err)
	}
	return nodeFromAuthorBytes(raw)
}

// nodeFromAuthorBytes renders raw public-key bytes as a BeepBite node id.
func nodeFromAuthorBytes(raw []byte) (string, error) {
	var id nodeid.NodeID
	if len(raw) != len(id) {
		return "", fmt.Errorf("substrate: author key is %d bytes, want %d", len(raw), len(id))
	}
	copy(id[:], raw)
	return id.String(), nil
}

// syncOp expresses an oplog.Op as a §4.1 SyncOp.
//
// The op's own HLC node becomes the SyncOp's author, so the key an op claims and
// the key it is signed with are the same value by construction rather than by a
// check somebody has to remember to write.
func syncOp(op oplog.Op, k kinds, ns string) (kotvasync.Op, error) {
	if err := op.Validate(); err != nil {
		return kotvasync.Op{}, err
	}
	if strings.Contains(op.Entity, targetSep) {
		return kotvasync.Op{}, fmt.Errorf(
			"substrate: entity %q contains %q, which would make its target ambiguous", op.Entity, targetSep)
	}
	if op.TS.Wall < 0 {
		return kotvasync.Op{}, fmt.Errorf("substrate: op %q has a negative wall clock", op.ID)
	}
	author, err := authorHex(op.TS.Node)
	if err != nil {
		return kotvasync.Op{}, err
	}
	hlc := kotvasync.HLC{Wall: uint64(op.TS.Wall), Counter: op.TS.Counter, Author: author}

	switch op.Kind {
	case oplog.KindSet:
		field := op.Field
		return kotvasync.Op{
			Kind:   k.lwwSet,
			NS:     ns,
			Target: targetOf(op.Entity, op.Key),
			Field:  &field,
			Value:  kotvasync.Bytes(op.Value),
			HLC:    hlc,
		}, nil

	case oplog.KindAdd:
		raw, err := hex.DecodeString(author)
		if err != nil {
			return kotvasync.Op{}, err
		}
		return kotvasync.Op{
			Kind:   k.setAdd,
			NS:     ns,
			Target: targetOf(op.Entity, op.Key),
			Value:  ledgerElement(op.TS, raw, op.Value),
			HLC:    hlc,
		}, nil

	default:
		// Unreachable: op.Validate above rejects every other Kind. Kept because
		// a Kind this mapping does not know must never reach the engine as a
		// guess — an op stored under the wrong primitive converges wrongly.
		return kotvasync.Op{}, oplog.ErrUnknownKind
	}
}

// fromSyncOp reads a decoded SyncOp back as the oplog.Op it was minted from.
//
// id is the op's §4.1 content address in lowercase hex — the identity the engine
// deduplicates on and the identity migration 004 stores.
func fromSyncOp(sop kotvasync.Op, id string, k kinds) (oplog.Op, error) {
	entity, key, err := splitTarget(sop.Target)
	if err != nil {
		return oplog.Op{}, err
	}
	if sop.HLC.Wall > 1<<62 {
		// The substrate's wall is a uint64 and BeepBite's is an int64. A value
		// this large is not a clock reading, and silently wrapping it negative
		// would invert the total order for every comparison afterwards.
		return oplog.Op{}, fmt.Errorf("substrate: op %s carries an out-of-range wall clock", id)
	}
	node, err := nodeFromAuthor(sop.HLC.Author)
	if err != nil {
		return oplog.Op{}, err
	}
	ts := oplog.Timestamp{Wall: int64(sop.HLC.Wall), Counter: sop.HLC.Counter, Node: node}

	out := oplog.Op{ID: id, Entity: entity, Key: key, TS: ts}
	switch sop.Kind {
	case k.lwwSet:
		out.Kind = oplog.KindSet
		if sop.Field != nil {
			out.Field = *sop.Field
		}
		if out.Value, err = untagBytes(sop.Value); err != nil {
			return oplog.Op{}, err
		}

	case k.setAdd:
		out.Kind = oplog.KindAdd
		payload, stamp, err := ledgerPayload(sop.Value)
		if err != nil {
			return oplog.Op{}, err
		}
		if stamp != ts {
			// The element's stamp and the op's own HLC are two recordings of
			// one fact. A disagreement means the element was built somewhere
			// other than ledgerElement, and accepting it would put an op in the
			// ledger under an identity no other replica would compute.
			return oplog.Op{}, fmt.Errorf(
				"substrate: op %s stamps its element %v but claims %v", id, stamp, ts)
		}
		out.Value = payload

	default:
		return oplog.Op{}, fmt.Errorf("substrate: op %s has kind %d, which BeepBite does not model", id, sop.Kind)
	}

	if err := out.Validate(); err != nil {
		return oplog.Op{}, fmt.Errorf("substrate: op %s does not validate as an oplog.Op: %w", id, err)
	}
	return out, nil
}
