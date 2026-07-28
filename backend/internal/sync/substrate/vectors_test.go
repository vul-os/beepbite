package substrate_test

// vectors_test.go — SYNC.md §10's frozen conformance vectors, driven through the
// engine BeepBite actually links.
//
// # Why this file exists
//
// go.sum proves the engine module is the module. It proves nothing about whether
// that module's ENGINE computes the algebra BeepBite's merge semantics now rest
// on. This file closes that gap: every one of the 24 vectors frozen in the kotva
// repo at conformance/vectors/sync_vectors.json is driven through this binding
// and compared byte-for-byte against the values the specification froze —
// encodings, content addresses, COSE envelopes, merge verdicts, tie-breaks,
// death domination, PN-counter union semantics, RGA sibling order, cycle-safe
// tree replay, observable-state roots, range-Merkle folds, namespace scoping and
// the §12 refusal codes.
//
// It is also the thing that makes the label in mapping.go's package doc
// legitimate. "This is DMTAP-SYNC" is a claim about behaviour, and the only
// evidence for it that is not a reading of source is this job passing.
//
// # Why BeepBite carries its own driver
//
// The obvious alternative — `go test github.com/vul-os/kotva/bindings/go` in CI
// — cannot work. That module's own vectors_test.go resolves its native trace
// through a hardcoded ../../crates/kotva-sync-wasm/test/native-trace.json, which
// is not in the module zip and is not overridable by any environment variable,
// so the package's tests can never pass from a proxy fetch. FlowStock carries
// its own driver for the same reason. This is that driver, written against the
// vectors file rather than against a copy of it, so a vector that changes
// upstream changes here on the next checkout instead of drifting silently.
//
// # It never passes by doing nothing
//
// The vectors file is not in this repo, so this test needs a kotva checkout —
// KOTVA_DIR, which CI sets from actions/checkout at the tag matching the engine
// version in go.mod. Without it the test SKIPS, and the skip names how many
// vectors went unverified. With BEEPBITE_REQUIRE_SYNC_VECTORS=1 the skip becomes
// a failure, which is how CI runs it: a guard that has quietly stopped running
// looks exactly like one that passes.
//
// The count assertion is the other half. Exiting zero proves nothing if the
// dispatch table silently ignored an operation it did not recognise, so every
// vector must be claimed by a driver, every driver must make at least one
// byte-for-byte comparison against a frozen value, and the total must be exactly
// wantVectors. Adding a 25th vector upstream fails here until somebody drives it.

import (
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	kotvasync "github.com/vul-os/kotva/bindings/go"
)

// wantVectors is how many vectors SYNC.md §10 freezes. The file's own scope_note
// says "ALL 24"; if a checkout disagrees, the suite grew or shrank and this file
// has to be read again rather than adjusted.
const wantVectors = 24

// The vectors' fixed clocks. Their ops carry a 2023-11-14 wall, and the suite is
// driven at a frozen "now" 800 s later rather than at a real clock — the same
// two constants the engine's own harness uses. §3's skew bound is one-sided (an
// op from the past is not skewed), so 800 s behind is fine and 121 s ahead is
// not; drift_test.go covers that boundary.
const receiverNowMS = 1_700_000_900_000

// vectorsPath resolves the frozen file from a kotva checkout.
func vectorsPath() (string, bool) {
	dir := os.Getenv("KOTVA_DIR")
	if dir == "" {
		return "", false
	}
	p := filepath.Join(dir, "conformance", "vectors", "sync_vectors.json")
	if _, err := os.Stat(p); err != nil {
		return "", false
	}
	return p, true
}

type vector struct {
	Name      string                     `json:"name"`
	Operation string                     `json:"operation"`
	Input     map[string]json.RawMessage `json:"input"`
	Expected  map[string]json.RawMessage `json:"expected"`
}

func TestFrozenSyncVectors(t *testing.T) {
	path, ok := vectorsPath()
	if !ok {
		msg := fmt.Sprintf(
			"KOTVA_DIR is unset or carries no conformance/vectors/sync_vectors.json: "+
				"all %d SYNC conformance vectors went UNVERIFIED in this run. "+
				"Set KOTVA_DIR to a checkout of github.com/vul-os/kotva at tag bindings/go/<version>, "+
				"or set BEEPBITE_REQUIRE_SYNC_VECTORS=1 to make this a failure (CI does).",
			wantVectors)
		if os.Getenv("BEEPBITE_REQUIRE_SYNC_VECTORS") == "1" {
			t.Fatal(msg)
		}
		t.Skip(msg)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	var file struct {
		Vectors []vector `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
	if len(file.Vectors) != wantVectors {
		t.Fatalf("%s holds %d vectors, want %d — the frozen suite changed size, "+
			"so read it before changing this number", path, len(file.Vectors), wantVectors)
	}

	inst := newInstance(t)

	driven := 0
	for _, v := range file.Vectors {
		drive, known := drivers[v.Operation]
		if !known {
			t.Errorf("vector %q has operation %q, which no driver in this file claims — "+
				"it would otherwise pass by not being run", v.Name, v.Operation)
			continue
		}
		ok := t.Run(v.Name, func(t *testing.T) { drive(t, inst, v) })
		if ok {
			driven++
		}
	}

	if driven != wantVectors {
		t.Fatalf("drove %d of %d frozen vectors — a conformance run that skips a vector "+
			"is not a conformance run", driven, wantVectors)
	}
	t.Logf("drove all %d frozen SYNC conformance vectors from %s", driven, path)
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

type driver func(t *testing.T, in *kotvasync.Instance, v vector)

var drivers = map[string]driver{
	"sync_op_encode":                driveOpEncode,
	"sync_op_cose_sign1_verify":     driveCoseSign1,
	"sync_author_admission":         driveAuthorAdmission,
	"sync_lww_merge":                driveLWWMerge,
	"sync_orset_merge":              driveORSetMerge,
	"sync_orset_remove_validity":    driveORSetRemoveValidity,
	"sync_death_domination":         driveDeathDomination,
	"sync_death_tie":                driveDeathTie,
	"sync_pn_merge":                 drivePNMerge,
	"sync_counter_foreign_check":    driveCounterForeign,
	"sync_rga_sibling_order":        driveRGASiblingOrder,
	"sync_rga_tombstone_origin":     driveRGATombstoneOrigin,
	"sync_tree_move_replay":         driveTreeMoveReplay,
	"sync_snapshot_state_root":      driveSnapshotStateRoot,
	"sync_snapshot_fast_join":       driveSnapshotFastJoin,
	"sync_snapshot_body_fold":       driveSnapshotBodyFold,
	"sync_ext_value_validate":       driveExtValue,
	"sync_fastjoin_pull_response":   driveFastJoinPullResponse,
	"sync_fastjoin_floor_predicate": driveFastJoinFloorPredicate,
	"sync_recon_fingerprint":        driveReconFingerprint,
	"sync_ns_sparse_filter":         driveNsSparseFilter,
	"sync_ns_leak_check":            driveNsLeakCheck,
	"sync_gc_stability_cut":         driveStabilityCut,
}

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

func driveOpEncode(t *testing.T, in *kotvasync.Instance, v vector) {
	f := str(t, v.Input, "field")
	op := kotvasync.Op{
		Kind:   uint8(num(t, v.Input, "kind")),
		NS:     str(t, v.Input, "ns"),
		Target: str(t, v.Input, "target"),
		Field:  &f,
		Value:  kotvasync.Text(str(t, v.Input, "value_tstr")),
		HLC:    hlc(t, v.Input, "hlc"),
	}
	got, err := in.EncodeOp(op)
	if err != nil {
		t.Fatalf("EncodeOp: %v", err)
	}
	wantHex(t, "cbor_hex", got, v.Expected)

	// §2.2: decoding and re-encoding must reproduce the same bytes, or content
	// addressing rests on an encoder that spells one value two ways.
	back, err := in.DecodeOp(got)
	if err != nil {
		t.Fatalf("DecodeOp: %v", err)
	}
	again, err := in.EncodeOp(back)
	if err != nil {
		t.Fatalf("re-EncodeOp: %v", err)
	}
	if !equalHex(again, got) {
		t.Fatalf("round trip changed the bytes: %x -> %x", got, again)
	}
}

func driveCoseSign1(t *testing.T, in *kotvasync.Instance, v vector) {
	opBytes := hexIn(t, v.Input, "sync_op_cbor_hex")

	si, err := in.OpSigningInput(opBytes)
	if err != nil {
		t.Fatalf("OpSigningInput: %v", err)
	}
	if si.Author != str(t, v.Input, "signer_pubkey_hex") {
		t.Fatalf("signing input claims author %s", si.Author)
	}
	// The frozen value is the WIRE form: the protected header as a CBOR byte
	// string, which is how it appears inside the COSE_Sign1. si.Protected is the
	// header's own bytes, so the comparison goes through the engine's encoder
	// rather than through a hand-written "5826" prefix.
	protectedWire, err := in.EncodeValue(kotvasync.Bytes(mustHex(t, si.Protected)))
	if err != nil {
		t.Fatalf("encoding the protected header: %v", err)
	}
	wantHex(t, "protected_hex", protectedWire, v.Expected)
	if si.ExternalAAD != str(t, v.Input, "external_aad_hex") {
		t.Fatalf("external_aad: got %s", si.ExternalAAD)
	}
	if si.SigStructure != strOf(t, v.Expected, "sig_structure_hex") {
		t.Fatalf("Sig_structure: got %s", si.SigStructure)
	}

	// Ed25519 is deterministic (RFC 8032), so the frozen signature is a
	// reproducible known answer rather than a sample.
	seed := hexIn(t, v.Input, "signer_seed_hex")
	key := ed25519.NewKeyFromSeed(seed)
	preimage, err := si.Bytes()
	if err != nil {
		t.Fatalf("decoding the preimage: %v", err)
	}
	sig := ed25519.Sign(key, preimage)
	if hex.EncodeToString(sig) != strOf(t, v.Expected, "signature_hex") {
		t.Fatalf("signature: got %x", sig)
	}

	cose, err := in.OpAttachSignature(opBytes, sig)
	if err != nil {
		t.Fatalf("OpAttachSignature: %v", err)
	}
	if hex.EncodeToString(cose) != str(t, v.Input, "cose_sign1_hex") {
		t.Fatalf("assembled envelope: got %x", cose)
	}

	payload, err := in.VerifySignedOp(cose)
	if err != nil {
		t.Fatalf("VerifySignedOp: %v", err)
	}
	if !equalHex(payload, opBytes) {
		t.Fatalf("verifying the envelope yielded %x, not the op it carries", payload)
	}
	// Frozen in the wire form, as the protected header is: the payload is a
	// CBOR byte string inside the COSE_Sign1.
	payloadWire, err := in.EncodeValue(kotvasync.Bytes(payload))
	if err != nil {
		t.Fatalf("encoding the payload: %v", err)
	}
	wantHex(t, "payload_hex", payloadWire, v.Expected)

	parts, err := in.DecodeSignedOp(cose)
	if err != nil {
		t.Fatalf("DecodeSignedOp: %v", err)
	}
	if parts.Unprotected != strOf(t, v.Expected, "unprotected_hex") {
		t.Fatalf("unprotected header: got %s", parts.Unprotected)
	}

	id, err := in.OpID(opBytes)
	if err != nil {
		t.Fatalf("OpID: %v", err)
	}
	wantHex(t, "op_id_hex", id, v.Expected)

	// Both tampering cases must fail closed with the frozen registry code.
	for field, wantKey := range map[string]string{
		"tampered_payload_cose_sign1_hex": "tampered_payload",
		"substituted_kid_cose_sign1_hex":  "substituted_kid",
	} {
		var want struct {
			Code string `json:"error_code"`
		}
		if err := json.Unmarshal(v.Expected[wantKey], &want); err != nil {
			t.Fatalf("expected/%s: %v", wantKey, err)
		}
		_, err := in.VerifySignedOp(hexIn(t, v.Input, field))
		if !kotvasync.IsRefusal(err, want.Code) {
			t.Fatalf("%s verified or refused wrongly: %v, want %s", field, err, want.Code)
		}
	}
}

func driveAuthorAdmission(t *testing.T, in *kotvasync.Instance, v vector) {
	author := hexIn(t, v.Input, "op_hlc_author_hex")
	var admitted []string
	if err := json.Unmarshal(v.Input["admitted_authors_hex"], &admitted); err != nil {
		t.Fatalf("admitted_authors_hex: %v", err)
	}
	err := in.CheckAdmitted(author, admitted)
	wantRefusal(t, err, v.Expected)

	// And an admitted author is admitted, so the check is not simply refusing.
	if err := in.CheckAdmitted(mustHex(t, admitted[0]), admitted); err != nil {
		t.Fatalf("CheckAdmitted refused an admitted author: %v", err)
	}
}

func driveLWWMerge(t *testing.T, in *kotvasync.Instance, v vector) {
	ops := hexList(t, v.Input, "ops_cbor_hex")
	eng := ingestAll(t, in, ops)
	defer eng.Close()

	first := decodeOp(t, in, ops[0])
	cell, err := eng.LWWCell(first.Target, deref(first.Field))
	if err != nil || cell == nil {
		t.Fatalf("LWWCell = %v, %v", cell, err)
	}
	if got := tstr(t, cell.Value); got != strOf(t, v.Expected, "winner_value") {
		t.Fatalf("winner value: got %q", got)
	}
	if _, ok := v.Expected["winner_hlc_hex"]; ok {
		encoded, err := in.EncodeHLC(cell.HLC)
		if err != nil {
			t.Fatalf("EncodeHLC: %v", err)
		}
		wantHex(t, "winner_hlc_hex", encoded, v.Expected)
	}
	if _, ok := v.Expected["winner_value_cbor_hex"]; ok {
		encoded, err := in.EncodeValue(cell.Value)
		if err != nil {
			t.Fatalf("EncodeValue: %v", err)
		}
		wantHex(t, "winner_value_cbor_hex", encoded, v.Expected)
	}
	if boolOf(v.Expected, "apply_order_independent") {
		assertOrderIndependent(t, in, eng, ops)
	}
}

func driveORSetMerge(t *testing.T, in *kotvasync.Instance, v vector) {
	ops := hexList(t, v.Input, "ops_cbor_hex")
	eng := ingestAll(t, in, ops)
	defer eng.Close()

	target := decodeOp(t, in, ops[0]).Target
	element := kotvasync.Text(str(t, v.Input, "element"))

	present, err := eng.SetContains(target, element)
	if err != nil {
		t.Fatalf("SetContains: %v", err)
	}
	if present != boolOf(v.Expected, "present") {
		t.Fatalf("present = %v", present)
	}

	tags, err := eng.SetSurvivingTags(target, element)
	if err != nil {
		t.Fatalf("SetSurvivingTags: %v", err)
	}
	want := strOf(t, v.Expected, "surviving_add_tag_hlc_hex")
	var got []string
	for _, tag := range tags {
		b, err := in.EncodeHLC(tag.HLC)
		if err != nil {
			t.Fatalf("EncodeHLC: %v", err)
		}
		got = append(got, hex.EncodeToString(b))
	}
	if len(got) != 1 || got[0] != want {
		t.Fatalf("surviving add tags = %v, want exactly [%s] — an observed-remove "+
			"must tombstone the tag it saw and only that one", got, want)
	}
}

func driveORSetRemoveValidity(t *testing.T, in *kotvasync.Instance, v vector) {
	err := in.ValidateOp(hexIn(t, v.Input, "op_cbor_hex"), receiverNowMS)
	wantRefusal(t, err, v.Expected)
}

func driveDeathDomination(t *testing.T, in *kotvasync.Instance, v vector) {
	death := hexIn(t, v.Input, "death_op_cbor_hex")
	add := hexIn(t, v.Input, "concurrent_add_op_cbor_hex")
	eng := ingestAll(t, in, [][]byte{death, add})
	defer eng.Close()

	addOp := decodeOp(t, in, add)
	present, err := eng.SetContains(addOp.Target, addOp.Value)
	if err != nil {
		t.Fatalf("SetContains: %v", err)
	}
	if present != boolOf(v.Expected, "present") {
		t.Fatalf("present = %v — a death certificate must dominate a numerically "+
			"greater concurrent set-add", present)
	}
}

func driveDeathTie(t *testing.T, in *kotvasync.Instance, v vector) {
	death := hexIn(t, v.Input, "death_op_cbor_hex")
	live := hexIn(t, v.Input, "live_op_cbor_hex")
	eng := ingestAll(t, in, [][]byte{death, live})
	defer eng.Close()

	object := decodeOp(t, in, death).Target
	state, err := eng.DeathState(object)
	if err != nil {
		t.Fatalf("DeathState: %v", err)
	}
	if want := strOf(t, v.Expected, "winner"); (want == "Deleted") != state.Deleted {
		t.Fatalf("deleted = %v, want winner %q", state.Deleted, want)
	}
	if state.Class == nil || *state.Class != strOf(t, v.Expected, "class") {
		t.Fatalf("class = %v", state.Class)
	}
}

func drivePNMerge(t *testing.T, in *kotvasync.Instance, v vector) {
	ops := hexList(t, v.Input, "ops_cbor_hex")
	eng := ingestAll(t, in, ops)
	defer eng.Close()

	first := decodeOp(t, in, ops[0])
	total, err := eng.CounterTotal(first.Target, deref(first.Field))
	if err != nil {
		t.Fatalf("CounterTotal: %v", err)
	}
	if want := strconv.FormatInt(num(t, v.Expected, "total"), 10); total != want {
		t.Fatalf("total = %s, want %s", total, want)
	}

	entries, err := eng.CounterEntries(first.Target, deref(first.Field))
	if err != nil {
		t.Fatalf("CounterEntries: %v", err)
	}
	var wantP, wantN map[string]int64
	if err := json.Unmarshal(v.Expected["P"], &wantP); err != nil {
		t.Fatalf("expected/P: %v", err)
	}
	if err := json.Unmarshal(v.Expected["N"], &wantN); err != nil {
		t.Fatalf("expected/N: %v", err)
	}
	gotP := map[string]int64{}
	gotN := map[string]int64{}
	for _, e := range entries {
		gotP[e.Author] = e.P
		gotN[e.Author] = e.N
	}
	if !reflect.DeepEqual(gotP, wantP) || !reflect.DeepEqual(gotN, wantN) {
		t.Fatalf("per-author entries = P%v N%v, want P%v N%v — §4.6 merges the "+
			"union of op-id-keyed deltas, never a per-author max", gotP, gotN, wantP, wantN)
	}

	// distinct_op_ids: the third op is a byte-identical replay of the first, so
	// the log holds two ops and not three.
	seen := map[string]bool{}
	for _, op := range ops {
		id, err := in.OpID(op)
		if err != nil {
			t.Fatalf("OpID: %v", err)
		}
		seen[hex.EncodeToString(id)] = true
	}
	if int64(len(seen)) != num(t, v.Expected, "distinct_op_ids") {
		t.Fatalf("distinct op ids = %d", len(seen))
	}

	if boolOf(v.Expected, "replay_is_noop") {
		for _, op := range ops {
			if _, err := eng.IngestAmbientAuthenticated(op, receiverNowMS); err != nil {
				t.Fatalf("replay: %v", err)
			}
		}
		after, err := eng.CounterTotal(first.Target, deref(first.Field))
		if err != nil {
			t.Fatalf("CounterTotal: %v", err)
		}
		if after != total {
			t.Fatalf("replaying every op moved the total from %s to %s", total, after)
		}
	}
	if boolOf(v.Expected, "merge_is_associative") {
		assertOrderIndependent(t, in, eng, ops)
	}
}

func driveCounterForeign(t *testing.T, in *kotvasync.Instance, v vector) {
	err := in.CheckCounterEntry(
		hexIn(t, v.Input, "op_hlc_author_hex"),
		hexIn(t, v.Input, "target_entry_author_hex"),
	)
	wantRefusal(t, err, v.Expected)
}

func driveRGASiblingOrder(t *testing.T, in *kotvasync.Instance, v vector) {
	ops := append([][]byte{hexIn(t, v.Input, "origin_op_cbor_hex")},
		hexList(t, v.Input, "sibling_ops_cbor_hex")...)
	eng := ingestAll(t, in, ops)
	defer eng.Close()

	target := decodeOp(t, in, ops[0]).Target
	seq, err := eng.Sequence(target)
	if err != nil || seq == nil {
		t.Fatalf("Sequence = %v, %v", seq, err)
	}

	var want []string
	if err := json.Unmarshal(v.Expected["order_values"], &want); err != nil {
		t.Fatalf("expected/order_values: %v", err)
	}
	got := visibleValues(t, seq)
	// The origin atom leads; the frozen order names the two siblings after it.
	if len(got) < len(want) || !reflect.DeepEqual(got[len(got)-len(want):], want) {
		t.Fatalf("sibling order = %v, want it to end in %v — atoms sharing a "+
			"left-origin are ordered newer-first by element id", got, want)
	}
	if _, ok := v.Expected["order_by_element_id_desc"]; ok {
		var wantIDs []string
		if err := json.Unmarshal(v.Expected["order_by_element_id_desc"], &wantIDs); err != nil {
			t.Fatalf("expected/order_by_element_id_desc: %v", err)
		}
		var gotIDs []string
		for _, atom := range seq.Atoms {
			b, err := in.EncodeHLC(atom.ID)
			if err != nil {
				t.Fatalf("EncodeHLC: %v", err)
			}
			gotIDs = append(gotIDs, hex.EncodeToString(b))
		}
		if len(gotIDs) < len(wantIDs) || !reflect.DeepEqual(gotIDs[len(gotIDs)-len(wantIDs):], wantIDs) {
			t.Fatalf("element ids = %v, want them to end in %v", gotIDs, wantIDs)
		}
	}
}

func driveRGATombstoneOrigin(t *testing.T, in *kotvasync.Instance, v vector) {
	ops := [][]byte{
		hexIn(t, v.Input, "insert_x_cbor_hex"),
		hexIn(t, v.Input, "remove_x_cbor_hex"),
		hexIn(t, v.Input, "insert_y_cbor_hex"),
	}
	eng := ingestAll(t, in, ops)
	defer eng.Close()

	target := decodeOp(t, in, ops[0]).Target
	seq, err := eng.Sequence(target)
	if err != nil || seq == nil {
		t.Fatalf("Sequence = %v, %v", seq, err)
	}

	var wantVisible []string
	if err := json.Unmarshal(v.Expected["visible_sequence"], &wantVisible); err != nil {
		t.Fatalf("expected/visible_sequence: %v", err)
	}
	if got := visibleValues(t, seq); !reflect.DeepEqual(got, wantVisible) {
		t.Fatalf("visible sequence = %v, want %v", got, wantVisible)
	}

	// §4.7 keeps the tombstone until the stability cut, because a later insert
	// may still cite it as its origin — which is exactly what insert_y does.
	var wantAtoms []string
	if err := json.Unmarshal(v.Expected["atom_order_incl_tombstones"], &wantAtoms); err != nil {
		t.Fatalf("expected/atom_order_incl_tombstones: %v", err)
	}
	if len(seq.Atoms) != len(wantAtoms) {
		t.Fatalf("the sequence holds %d atoms, want %d (%v) — the tombstone was "+
			"dropped and the insert citing it had nothing to attach to",
			len(seq.Atoms), len(wantAtoms), wantAtoms)
	}
	tombstoned := 0
	for _, a := range seq.Atoms {
		if a.Tombstoned {
			tombstoned++
		}
	}
	if tombstoned != 1 {
		t.Fatalf("%d atoms are tombstoned, want 1", tombstoned)
	}
	if boolOf(v.Expected, "reject") {
		t.Fatal("this vector expects the insert to be rejected; the driver assumes it resolves")
	}
}

func driveTreeMoveReplay(t *testing.T, in *kotvasync.Instance, v vector) {
	ops := append(hexList(t, v.Input, "baseline_ops_cbor_hex"),
		hexList(t, v.Input, "colliding_ops_cbor_hex")...)
	eng := ingestAll(t, in, ops)
	defer eng.Close()

	tree, err := eng.Tree()
	if err != nil {
		t.Fatalf("Tree: %v", err)
	}

	var wantEdges []struct {
		Node   string `json:"node"`
		Parent string `json:"parent"`
		Ord    string `json:"ord"`
	}
	if err := json.Unmarshal(v.Expected["final_edges"], &wantEdges); err != nil {
		t.Fatalf("expected/final_edges: %v", err)
	}
	var want [][]string
	for _, e := range wantEdges {
		want = append(want, []string{e.Node, e.Parent, e.Ord})
	}
	got := append([][]string(nil), tree.Edges...)
	sortEdges(got)
	sortEdges(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("final edges = %v, want %v", got, want)
	}

	var wantApplied, wantSkipped []string
	if err := json.Unmarshal(v.Expected["applied"], &wantApplied); err != nil {
		t.Fatalf("expected/applied: %v", err)
	}
	if err := json.Unmarshal(v.Expected["skipped"], &wantSkipped); err != nil {
		t.Fatalf("expected/skipped: %v", err)
	}
	if len(tree.Skipped) != len(wantSkipped) {
		t.Fatalf("%d moves were skipped, want %d (%v) — a move closing a cycle is "+
			"skipped deterministically, which is a convergent outcome and not an error",
			len(tree.Skipped), len(wantSkipped), wantSkipped)
	}
	if len(tree.Applied) < len(wantApplied) {
		t.Fatalf("%d moves applied, want at least %d", len(tree.Applied), len(wantApplied))
	}
	if boolOf(v.Expected, "apply_order_independent") {
		assertOrderIndependent(t, in, eng, ops)
	}
}

func driveSnapshotStateRoot(t *testing.T, in *kotvasync.Instance, v vector) {
	// The vector spells its observable_state in prose (plain JSON scalars), not
	// in the engine's tagged ext-value form, so the frozen CBOR is the input the
	// engine can be held to: decode it, re-encode it, and require the same bytes
	// back. §6.1.1 re-sorts sections canonically on the way out, so this is the
	// assertion that makes "equal bytes means equal state" usable at all.
	encoded := hexOf(t, v.Expected, "observable_state_cbor_hex")
	decoded, err := in.DecodeObservableState(encoded)
	if err != nil {
		t.Fatalf("DecodeObservableState: %v", err)
	}
	again, err := in.EncodeObservableState(decoded)
	if err != nil {
		t.Fatalf("EncodeObservableState: %v", err)
	}
	if !equalHex(again, encoded) {
		t.Fatalf("observable-state round trip changed the bytes:\n  got  %x\n  want %x", again, encoded)
	}
	assertSectionCounts(t, decoded, v)

	root, err := in.ObservableStateRoot(encoded)
	if err != nil {
		t.Fatalf("ObservableStateRoot: %v", err)
	}
	wantHex(t, "root_hex", root, v.Expected)

	empty := hexOf(t, v.Expected, "empty_state_cbor_hex")
	emptyRoot, err := in.ObservableStateRoot(empty)
	if err != nil {
		t.Fatalf("ObservableStateRoot(empty): %v", err)
	}
	wantHex(t, "empty_state_root_hex", emptyRoot, v.Expected)

	// A root that does not match is 0x0A09, whose §12 action is HALT_ALERT
	// rather than a retry: it is evidence of divergence, not of a bad round.
	eng, err := in.NewEngine()
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	defer eng.Close()
	if err := eng.VerifyRoot(root); !kotvasync.IsRefusal(err, strOf(t, v.Expected, "mismatch_error_code")) {
		t.Fatalf("VerifyRoot(wrong root) = %v, want %s", err, strOf(t, v.Expected, "mismatch_error_code"))
	}
}

func driveSnapshotFastJoin(t *testing.T, in *kotvasync.Instance, v vector) {
	fastJoin := hexOf(t, v.Expected, "fast_join_state_cbor_hex")
	fullReplay := hexOf(t, v.Expected, "full_replay_state_cbor_hex")

	if boolOf(v.Expected, "states_byte_identical") && !equalHex(fastJoin, fullReplay) {
		t.Fatalf("the frozen fast-join and full-replay states are not byte-identical")
	}

	root, err := in.ObservableStateRoot(fastJoin)
	if err != nil {
		t.Fatalf("ObservableStateRoot: %v", err)
	}
	wantHex(t, "root_hex", root, v.Expected)

	// The snapshot's own committed state must still address to the snapshot's
	// root — fast-joining and then replaying past `covers` is what moves it.
	snapState := hexIn(t, v.Input, "snapshot_observable_state_cbor_hex")
	snapRoot, err := in.ObservableStateRoot(snapState)
	if err != nil {
		t.Fatalf("ObservableStateRoot(snapshot state): %v", err)
	}
	if hex.EncodeToString(snapRoot) != str(t, v.Input, "snapshot_root_hex") {
		t.Fatalf("the snapshot's state does not address to its own root: %x", snapRoot)
	}

	// And the canonical form is stable: decoding and re-encoding reproduces it,
	// which is what makes "equal bytes" a usable definition of "equal state".
	decoded, err := in.DecodeObservableState(fastJoin)
	if err != nil {
		t.Fatalf("DecodeObservableState: %v", err)
	}
	again, err := in.EncodeObservableState(decoded)
	if err != nil {
		t.Fatalf("EncodeObservableState: %v", err)
	}
	if !equalHex(again, fastJoin) {
		t.Fatalf("observable-state round trip changed the bytes")
	}
}

func driveSnapshotBodyFold(t *testing.T, in *kotvasync.Instance, v vector) {
	body := hexIn(t, v.Input, "snapshot_body_cbor_hex")
	root := hexIn(t, v.Input, "snapshot_root_hex")

	members, err := in.SnapshotBodyDecode(body)
	if err != nil {
		t.Fatalf("SnapshotBodyDecode: %v", err)
	}
	var wantOps []json.RawMessage
	if err := json.Unmarshal(v.Input["snapshot_body_ops"], &wantOps); err != nil {
		t.Fatalf("input/snapshot_body_ops: %v", err)
	}
	if len(members) != len(wantOps) {
		t.Fatalf("the body carries %d members, want %d", len(members), len(wantOps))
	}

	// §6.1.2's fold-then-recompute. Hashing the received bytes would prove only
	// that the sender shipped what it promised; this proves the ops PRODUCE the
	// committed state.
	state, err := in.SnapshotBodyVerifyRoot(body, root, "", receiverNowMS)
	if err != nil {
		t.Fatalf("SnapshotBodyVerifyRoot: %v", err)
	}
	wantHex(t, "folded_state_cbor_hex", state, v.Expected)

	folded, err := in.ObservableStateRoot(state)
	if err != nil {
		t.Fatalf("ObservableStateRoot: %v", err)
	}
	wantHex(t, "folded_root_hex", folded, v.Expected)

	// A body that does not reproduce the claimed root is discarded whole.
	wrong := append([]byte(nil), root...)
	wrong[len(wrong)-1] ^= 0x01
	_, err = in.SnapshotBodyVerifyRoot(body, wrong, "", receiverNowMS)
	if !kotvasync.IsRefusal(err, strOf(t, v.Expected, "body_mismatch_error_code")) {
		t.Fatalf("SnapshotBodyVerifyRoot(wrong root) = %v, want %s",
			err, strOf(t, v.Expected, "body_mismatch_error_code"))
	}
}

func driveExtValue(t *testing.T, in *kotvasync.Instance, v vector) {
	type valueCase struct {
		Case    string `json:"case"`
		CBORHex string `json:"cbor_hex"`
	}
	var accept, reject []valueCase
	if err := json.Unmarshal(v.Input["accept"], &accept); err != nil {
		t.Fatalf("input/accept: %v", err)
	}
	if err := json.Unmarshal(v.Input["reject"], &reject); err != nil {
		t.Fatalf("input/reject: %v", err)
	}
	if len(accept) == 0 || len(reject) == 0 {
		t.Fatal("the ext-value vector froze no cases")
	}

	for _, c := range accept {
		raw := mustHex(t, c.CBORHex)
		tagged, err := in.DecodeValue(raw)
		if err != nil {
			t.Fatalf("accept case %q was refused: %v", c.Case, err)
		}
		if ok, err := in.IsExtValue(tagged); err != nil || !ok {
			t.Fatalf("accept case %q is not an ext-value: ok=%v err=%v", c.Case, ok, err)
		}
		again, err := in.EncodeValue(tagged)
		if err != nil {
			t.Fatalf("accept case %q re-encode: %v", c.Case, err)
		}
		if !equalHex(again, raw) {
			t.Fatalf("accept case %q round trip changed the bytes: %s -> %x", c.Case, c.CBORHex, again)
		}
	}

	// A rejected case fails in one of two places and both count as refused: a
	// non-canonical item (float, null, undefined, tag) cannot be decoded at all,
	// while an integer-keyed map decodes as CBOR and is then not an ext-value.
	// Accepting either would put a value in the algebra that a second decoder
	// refuses, which is the same divergence by a different route.
	for _, c := range reject {
		tagged, err := in.DecodeValue(mustHex(t, c.CBORHex))
		if err != nil {
			continue
		}
		ok, err := in.IsExtValue(tagged)
		if err != nil {
			t.Fatalf("reject case %q: IsExtValue: %v", c.Case, err)
		}
		if ok {
			t.Fatalf("reject case %q was accepted as an ext-value (%s) — validation "+
				"is recursive, so a violation at depth 2 must be caught rather than "+
				"waved through by a shallow check", c.Case, tagged)
		}
	}

	// And the frozen registry entry is the engine's own: code and name together,
	// read out of §12 rather than restated here.
	assertRegistryEntry(t, in,
		strOf(t, v.Expected, "reject_error_code"), strOf(t, v.Expected, "reject_error_name"))

	// The carrier op — a real op whose value is one of the accepted shapes —
	// must still validate as a whole op.
	if err := in.ValidateOp(hexIn(t, v.Input, "carrier_op_cbor_hex"), receiverNowMS); err != nil {
		t.Fatalf("the carrier op was refused: %v", err)
	}
}

func driveFastJoinPullResponse(t *testing.T, in *kotvasync.Instance, v vector) {
	snapshot := hexOf(t, v.Expected, "snapshot_cbor_hex")
	if err := in.SnapshotVerify(snapshot); err != nil {
		t.Fatalf("SnapshotVerify: %v — the frozen snapshot's own signature does not verify", err)
	}
	decoded, err := in.SnapshotDecode(snapshot)
	if err != nil {
		t.Fatalf("SnapshotDecode: %v", err)
	}
	if decoded.Root != str(t, v.Input, "snapshot_root_hex") {
		t.Fatalf("snapshot root = %s", decoded.Root)
	}
	if decoded.Sig != strOf(t, v.Expected, "snapshot_sig_hex") {
		t.Fatalf("snapshot signature = %s", decoded.Sig)
	}
	if decoded.Signer != str(t, v.Input, "snapshot_signer_pubkey_hex") {
		t.Fatalf("snapshot signer = %s", decoded.Signer)
	}

	fastjoin := hexOf(t, v.Expected, "fastjoin_cbor_hex")
	addr, err := in.FastJoinStateAddress(fastjoin)
	if err != nil {
		t.Fatalf("FastJoinStateAddress: %v", err)
	}
	if hex.EncodeToString(addr) != strOf(t, v.Expected, "state_fetch_address_hex") {
		t.Fatalf("state fetch address = %x", addr)
	}

	// The inline body is a cache hint held to the same fold-then-recompute as a
	// fetched one — never a second source of truth.
	inline := hexOf(t, v.Expected, "inline_body_cbor_hex")
	members, err := in.SnapshotBodyDecode(inline)
	if err != nil {
		t.Fatalf("SnapshotBodyDecode: %v", err)
	}
	if int64(len(members)) != num(t, v.Input, "snapshot_body_op_count") {
		t.Fatalf("the inline body carries %d ops", len(members))
	}
	state, err := in.SnapshotBodyFold(inline, str(t, v.Input, "snapshot_ns"), receiverNowMS)
	if err != nil {
		t.Fatalf("SnapshotBodyFold: %v", err)
	}
	root, err := in.ObservableStateRoot(state)
	if err != nil {
		t.Fatalf("ObservableStateRoot: %v", err)
	}
	if hex.EncodeToString(root) != strOf(t, v.Expected, "inline_body_folds_to_root_hex") {
		t.Fatalf("the inline body folds to %x", root)
	}
}

func driveFastJoinFloorPredicate(t *testing.T, in *kotvasync.Instance, v vector) {
	// The conformant framing: each member of the surviving suffix is a
	// COSE_Sign1 embedded as a CBOR item, and verifying one yields exactly the
	// inner SyncOp bytes the vector froze.
	envelopes := hexList(t, v.Input, "surviving_suffix_ops_cbor_hex")
	inner := hexList(t, v.Input, "surviving_suffix_inner_syncop_cbor_hex")
	if len(envelopes) != len(inner) || len(envelopes) == 0 {
		t.Fatalf("the vector froze %d envelopes and %d inner ops", len(envelopes), len(inner))
	}
	for i := range envelopes {
		payload, err := in.VerifySignedOp(envelopes[i])
		if err != nil {
			t.Fatalf("suffix op %d does not verify: %v", i, err)
		}
		if !equalHex(payload, inner[i]) {
			t.Fatalf("suffix op %d carries %x, want %x", i, payload, inner[i])
		}
	}

	// C-06's framing rule, both sides of it. An op set whose members are
	// item-embedded round-trips; the frozen bstr-wrapped spelling of the same
	// ops is refused on decode with the frozen registry code rather than
	// unwrapped. Asserting only the refusal would pass for an engine that
	// refuses everything, which is why the conformant framing is driven first.
	conformant, err := in.SnapshotBodyEncode([]string{hex.EncodeToString(envelopes[0])})
	if err != nil {
		t.Fatalf("SnapshotBodyEncode: %v", err)
	}
	members, err := in.SnapshotBodyDecode(conformant)
	if err != nil {
		t.Fatalf("SnapshotBodyDecode(item-framed): %v", err)
	}
	if len(members) != 1 || members[0] != hex.EncodeToString(envelopes[0]) {
		t.Fatalf("item-framed round trip returned %v", members)
	}

	wrapped := hexOf(t, v.Expected, "ops_member_bstr_wrapped_NONCONFORMANT_cbor_hex")
	wantCode := strOf(t, v.Expected, "ops_member_bstr_wrapped_error_code")
	if boolOf(v.Expected, "ops_member_bstr_wrapped_conformant") {
		t.Fatal("this vector now calls bstr-wrapped members conformant; re-read §5.2 C-06")
	}
	if _, err := in.SnapshotBodyDecode(wrapped); !kotvasync.IsRefusal(err, wantCode) {
		t.Fatalf("a bstr-wrapped ops member decoded as %v, want %s", err, wantCode)
	}
}

func driveReconFingerprint(t *testing.T, in *kotvasync.Instance, v vector) {
	var opsByLabel map[string]string
	if err := json.Unmarshal(v.Input["ops_cbor_hex"], &opsByLabel); err != nil {
		t.Fatalf("input/ops_cbor_hex: %v", err)
	}
	var idsByLabel map[string]string
	if err := json.Unmarshal(v.Input["op_ids_hex"], &idsByLabel); err != nil {
		t.Fatalf("input/op_ids_hex: %v", err)
	}

	entry := func(label string) kotvasync.OpEntry {
		op := decodeOp(t, in, mustHex(t, opsByLabel[label]))
		// The frozen id must be the one the engine computes; otherwise the
		// fingerprint below would be folding over labels rather than ops.
		id, err := in.OpID(mustHex(t, opsByLabel[label]))
		if err != nil {
			t.Fatalf("OpID(%s): %v", label, err)
		}
		if hex.EncodeToString(id) != idsByLabel[label] {
			t.Fatalf("op %s addresses to %x, frozen as %s", label, id, idsByLabel[label])
		}
		return kotvasync.OpEntry{HLC: op.HLC, ID: idsByLabel[label]}
	}

	entries := func(key string) []kotvasync.OpEntry {
		var labels []string
		if err := json.Unmarshal(v.Input[key], &labels); err != nil {
			t.Fatalf("input/%s: %v", key, err)
		}
		out := make([]kotvasync.OpEntry, 0, len(labels))
		for _, l := range labels {
			out = append(out, entry(l))
		}
		return out
	}
	a := entries("replica_A_holds")
	b := entries("replica_B_holds")

	type side struct {
		FPHex string `json:"fp_hex"`
		Count uint64 `json:"count"`
	}
	type rangeExp struct {
		A     side `json:"A"`
		B     side `json:"B"`
		Match bool `json:"match"`
	}

	var full rangeExp
	if err := json.Unmarshal(v.Expected["full_range"], &full); err != nil {
		t.Fatalf("expected/full_range: %v", err)
	}
	for name, pair := range map[string]struct {
		entries []kotvasync.OpEntry
		want    side
	}{"A": {a, full.A}, "B": {b, full.B}} {
		fp, err := in.Fingerprint(pair.entries)
		if err != nil {
			t.Fatalf("Fingerprint(%s): %v", name, err)
		}
		if fp.FP != pair.want.FPHex || fp.Count != pair.want.Count {
			t.Fatalf("replica %s fingerprint = %s/%d, want %s/%d",
				name, fp.FP, fp.Count, pair.want.FPHex, pair.want.Count)
		}
	}

	lo := hlc(t, mustObject(t, v.Input, "range"), "lo")
	hi := hlc(t, mustObject(t, v.Input, "range"), "hi")
	split := hlc(t, v.Input, "split_at")

	for key, bounds := range map[string][2]kotvasync.HLC{
		"subrange_1": {lo, split},
		"subrange_2": {split, hi},
	} {
		var want rangeExp
		if err := json.Unmarshal(v.Expected[key], &want); err != nil {
			t.Fatalf("expected/%s: %v", key, err)
		}
		for name, pair := range map[string]struct {
			entries []kotvasync.OpEntry
			want    side
		}{"A": {a, want.A}, "B": {b, want.B}} {
			s, err := in.Summarize(pair.entries, bounds[0], bounds[1])
			if err != nil {
				t.Fatalf("Summarize(%s, %s): %v", key, name, err)
			}
			if s.FP != pair.want.FPHex || s.Count != pair.want.Count {
				t.Fatalf("%s replica %s = %s/%d, want %s/%d",
					key, name, s.FP, s.Count, pair.want.FPHex, pair.want.Count)
			}
		}
	}

	rec, err := in.Reconcile(a, b, lo, hi)
	if err != nil {
		t.Fatalf("Reconcile: %v", err)
	}
	if int64(len(rec.MissingThere)) != num(t, v.Expected, "ops_shipped_total") {
		t.Fatalf("reconciliation ships %d ops, want %d", len(rec.MissingThere), num(t, v.Expected, "ops_shipped_total"))
	}

	// An empty range and a range whose ops happen to fold to the same value are
	// distinguishable only because the count travels with the hash.
	empty, err := in.Fingerprint(nil)
	if err != nil {
		t.Fatalf("Fingerprint(empty): %v", err)
	}
	if empty.FP != strOf(t, v.Expected, "empty_range_fp_hex") || empty.Count != 0 {
		t.Fatalf("empty range = %s/%d", empty.FP, empty.Count)
	}
}

func driveNsSparseFilter(t *testing.T, in *kotvasync.Instance, v vector) {
	ops := hexList(t, v.Input, "responder_ops_cbor_hex")
	var docs []string
	for _, op := range ops {
		s, err := in.DecodeOpJSON(op)
		if err != nil {
			t.Fatalf("DecodeOpJSON: %v", err)
		}
		docs = append(docs, s)
	}
	var subscribed []string
	if err := json.Unmarshal(v.Input["caller_subscribed_ns"], &subscribed); err != nil {
		t.Fatalf("input/caller_subscribed_ns: %v", err)
	}

	shipped, err := in.ScopeToSubscription("["+strings.Join(docs, ",")+"]", subscribed)
	if err != nil {
		t.Fatalf("ScopeToSubscription: %v", err)
	}
	var want []string
	if err := json.Unmarshal(v.Expected["shipped_ops_cbor_hex"], &want); err != nil {
		t.Fatalf("expected/shipped_ops_cbor_hex: %v", err)
	}
	var got []string
	for _, b := range shipped {
		got = append(got, hex.EncodeToString(b))
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("sparse scoping shipped %v, want %v — an op outside the caller's "+
			"subscription must not leave the responder at all", got, want)
	}
}

func driveNsLeakCheck(t *testing.T, in *kotvasync.Instance, v vector) {
	err := in.CheckNsRef(str(t, v.Input, "op_ns"), str(t, v.Input, "ref_target_actual_ns"))
	wantRefusal(t, err, v.Expected)

	// A same-namespace reference is fine, so the check is not refusing wholesale.
	ns := str(t, v.Input, "op_ns")
	if err := in.CheckNsRef(ns, ns); err != nil {
		t.Fatalf("CheckNsRef refused a same-namespace reference: %v", err)
	}
}

func driveStabilityCut(t *testing.T, in *kotvasync.Instance, v vector) {
	var live []struct {
		Replica string `json:"replica"`
		HLC     struct {
			Wall    uint64 `json:"wall"`
			Counter uint32 `json:"counter"`
			Author  string `json:"author_hex"`
		} `json:"max_applied_hlc"`
	}
	if err := json.Unmarshal(v.Input["live_replica_watermarks"], &live); err != nil {
		t.Fatalf("input/live_replica_watermarks: %v", err)
	}

	var marks []*kotvasync.HLC
	for _, w := range live {
		marks = append(marks, &kotvasync.HLC{Wall: w.HLC.Wall, Counter: w.HLC.Counter, Author: w.HLC.Author})
	}
	cut, err := in.StabilityCut(marks)
	if err != nil {
		t.Fatalf("StabilityCut: %v", err)
	}
	if cut == nil {
		t.Fatal("StabilityCut returned no cut for two known watermarks")
	}
	if int64(cut.Counter) != num(t, v.Expected, "stability_cut_counter") {
		t.Fatalf("stability cut counter = %d, want %d", cut.Counter, num(t, v.Expected, "stability_cut_counter"))
	}

	// The stale replica is excluded by the caller's liveness decision — but an
	// UNKNOWN watermark must yield no cut at all, because "unknown" must never
	// be read as "caught up".
	if boolOf(v.Expected, "stale_replica_excluded") {
		none, err := in.StabilityCut(append(append([]*kotvasync.HLC(nil), marks...), nil))
		if err != nil {
			t.Fatalf("StabilityCut(with unknown): %v", err)
		}
		if none != nil {
			t.Fatalf("a live replica with no known watermark still produced a cut at %+v — "+
				"GC on incomplete knowledge is unrecoverable", none)
		}
	}
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

func newInstance(t *testing.T) *kotvasync.Instance {
	t.Helper()
	ctx := t.Context()
	rt, err := kotvasync.New(ctx)
	if err != nil {
		t.Fatalf("kotvasync.New: %v", err)
	}
	in, err := rt.Instance(ctx)
	if err != nil {
		t.Fatalf("Instance: %v", err)
	}
	t.Cleanup(func() {
		_ = in.Close(ctx)
		_ = rt.Close(ctx)
	})
	return in
}

// ingestAll folds every op into a fresh replica through the §5.6 ambient path.
// The vectors' ops are bare SyncOps rather than envelopes — the COSE framing is
// exercised on its own by SYNC-OP-02 — so this is the correct entry point and
// not a weakening: every §4 validator still runs.
func ingestAll(t *testing.T, in *kotvasync.Instance, ops [][]byte) *kotvasync.Engine {
	t.Helper()
	eng, err := in.NewEngine()
	if err != nil {
		t.Fatalf("NewEngine: %v", err)
	}
	for i, op := range ops {
		if _, err := eng.IngestAmbientAuthenticated(op, receiverNowMS); err != nil {
			eng.Close()
			t.Fatalf("ingesting op %d: %v", i, err)
		}
	}
	return eng
}

// assertOrderIndependent replays the same ops in reverse into a second replica
// and requires byte-identical observable state. Equal bytes is the definition of
// equal state (§6.1.1), which is a far stronger check than comparing whichever
// projection the vector happens to name.
func assertOrderIndependent(t *testing.T, in *kotvasync.Instance, forward *kotvasync.Engine, ops [][]byte) {
	t.Helper()
	reversed := make([][]byte, 0, len(ops))
	for i := len(ops) - 1; i >= 0; i-- {
		reversed = append(reversed, ops[i])
	}
	backward := ingestAll(t, in, reversed)
	defer backward.Close()

	a, err := forward.ObservableState()
	if err != nil {
		t.Fatalf("ObservableState: %v", err)
	}
	b, err := backward.ObservableState()
	if err != nil {
		t.Fatalf("ObservableState: %v", err)
	}
	if !equalHex(a, b) {
		t.Fatalf("apply order changed the observable state:\n  forward  %x\n  backward %x", a, b)
	}
}

func decodeOp(t *testing.T, in *kotvasync.Instance, raw []byte) kotvasync.Op {
	t.Helper()
	op, err := in.DecodeOp(raw)
	if err != nil {
		t.Fatalf("DecodeOp: %v", err)
	}
	return op
}

func visibleValues(t *testing.T, seq *kotvasync.Sequence) []string {
	t.Helper()
	var out []string
	for _, v := range seq.Values {
		out = append(out, tstr(t, v))
	}
	return out
}

func tstr(t *testing.T, tagged json.RawMessage) string {
	t.Helper()
	var v struct {
		Tstr *string `json:"tstr"`
	}
	if err := json.Unmarshal(tagged, &v); err != nil || v.Tstr == nil {
		t.Fatalf("value %s is not a tagged text", tagged)
	}
	return *v.Tstr
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func sortEdges(e [][]string) {
	sort.Slice(e, func(i, j int) bool { return strings.Join(e[i], "\x00") < strings.Join(e[j], "\x00") })
}

func equalHex(a, b []byte) bool { return hex.EncodeToString(a) == hex.EncodeToString(b) }

// wantRefusal asserts the engine refused with the frozen §12 registry entry —
// code, name and action together, because a product branching on the code needs
// all three to stay in step.
func wantRefusal(t *testing.T, err error, expected map[string]json.RawMessage) {
	t.Helper()
	se, ok := kotvasync.AsSyncError(err)
	if !ok {
		t.Fatalf("expected a substrate refusal, got %v", err)
	}
	if want := strOf(t, expected, "error_code"); se.Code != want {
		t.Fatalf("refusal code = %s, want %s", se.Code, want)
	}
	if raw, ok := expected["error_name"]; ok {
		var want string
		_ = json.Unmarshal(raw, &want)
		if se.Name != want {
			t.Fatalf("refusal name = %s, want %s", se.Name, want)
		}
	}
	if raw, ok := expected["action"]; ok {
		var want string
		_ = json.Unmarshal(raw, &want)
		if se.Action != want {
			t.Fatalf("refusal action = %s, want %s", se.Action, want)
		}
	}
}

func wantHex(t *testing.T, key string, got []byte, expected map[string]json.RawMessage) {
	t.Helper()
	var want string
	if err := json.Unmarshal(expected[key], &want); err != nil {
		t.Fatalf("expected/%s: %v", key, err)
	}
	if hex.EncodeToString(got) != want {
		t.Fatalf("%s:\n  got  %x\n  want %s", key, got, want)
	}
}

func str(t *testing.T, m map[string]json.RawMessage, key string) string {
	t.Helper()
	return strOf(t, m, key)
}

func strOf(t *testing.T, m map[string]json.RawMessage, key string) string {
	t.Helper()
	raw, ok := m[key]
	if !ok {
		t.Fatalf("the vector has no %q", key)
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatalf("%s is not a string: %v", key, err)
	}
	return s
}

func num(t *testing.T, m map[string]json.RawMessage, key string) int64 {
	t.Helper()
	raw, ok := m[key]
	if !ok {
		t.Fatalf("the vector has no %q", key)
	}
	var n int64
	if err := json.Unmarshal(raw, &n); err != nil {
		t.Fatalf("%s is not a number: %v", key, err)
	}
	return n
}

func boolOf(m map[string]json.RawMessage, key string) bool {
	raw, ok := m[key]
	if !ok {
		return false
	}
	var b bool
	_ = json.Unmarshal(raw, &b)
	return b
}

func hexIn(t *testing.T, m map[string]json.RawMessage, key string) []byte {
	t.Helper()
	return mustHex(t, strOf(t, m, key))
}

func hexOf(t *testing.T, m map[string]json.RawMessage, key string) []byte {
	t.Helper()
	return mustHex(t, strOf(t, m, key))
}

func hexList(t *testing.T, m map[string]json.RawMessage, key string) [][]byte {
	t.Helper()
	raw, ok := m[key]
	if !ok {
		t.Fatalf("the vector has no %q", key)
	}
	var hexes []string
	if err := json.Unmarshal(raw, &hexes); err != nil {
		t.Fatalf("%s is not a list of hex strings: %v", key, err)
	}
	out := make([][]byte, 0, len(hexes))
	for _, h := range hexes {
		out = append(out, mustHex(t, h))
	}
	return out
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("%q is not hex: %v", s, err)
	}
	return b
}

func mustObject(t *testing.T, m map[string]json.RawMessage, key string) map[string]json.RawMessage {
	t.Helper()
	raw, ok := m[key]
	if !ok {
		t.Fatalf("the vector has no %q", key)
	}
	var out map[string]json.RawMessage
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("%s is not an object: %v", key, err)
	}
	return out
}

func hlc(t *testing.T, m map[string]json.RawMessage, key string) kotvasync.HLC {
	t.Helper()
	obj := mustObject(t, m, key)
	var h struct {
		Wall    uint64 `json:"wall"`
		Counter uint32 `json:"counter"`
		Author  string `json:"author_hex"`
	}
	raw, _ := json.Marshal(obj)
	if err := json.Unmarshal(raw, &h); err != nil {
		t.Fatalf("%s is not an HLC: %v", key, err)
	}
	return kotvasync.HLC{Wall: h.Wall, Counter: h.Counter, Author: h.Author}
}

// assertRegistryEntry holds a frozen §12 code/name pair against the engine's own
// registry, so a vector that names a refusal names one the engine actually has.
func assertRegistryEntry(t *testing.T, in *kotvasync.Instance, code, name string) {
	t.Helper()
	entries, err := in.ErrorRegistry()
	if err != nil {
		t.Fatalf("ErrorRegistry: %v", err)
	}
	for _, e := range entries {
		if e.Code == code {
			if e.Name != name {
				t.Fatalf("§12 %s is %q in the engine, frozen as %q", code, e.Name, name)
			}
			return
		}
	}
	t.Fatalf("the engine's §12 registry has no %s", code)
}

// assertSectionCounts checks the decoded projection against the vector's own
// description of it: six sections, and the empty state has six empty ones.
func assertSectionCounts(t *testing.T, s kotvasync.ObservableState, v vector) {
	t.Helper()
	sections := [][][]json.RawMessage{s.ORSet, s.LWW, s.PN, s.Death, s.RGA, s.Tree}
	if want := num(t, v.Input, "empty_state_sections"); int64(len(sections)) != want {
		t.Fatalf("the projection has %d sections, want %d", len(sections), want)
	}
	for i, sec := range sections {
		if len(sec) == 0 {
			t.Fatalf("section %d of the frozen non-empty state decoded empty", i)
		}
	}
}
