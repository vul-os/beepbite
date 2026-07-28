package substrate_test

// substrate_test.go — the mapping, and the properties it has to preserve.
//
// The conformance vectors (vectors_test.go) prove the engine computes the
// substrate's algebra. These prove BeepBite hands it the right ops: that an
// operation survives the round trip into §4.1 and back, that its identity is a
// content address rather than a name anybody minted, and that the two places
// where the mapping could quietly lose data — the ledger's element identity and
// the entity/key split — do not.

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/nodeid"
	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/substrate"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// openEngine brings up one replica with a fresh identity, and closes it when the
// test ends.
func openEngine(t *testing.T, ns string) (*substrate.Engine, *nodeid.Identity) {
	t.Helper()
	id, err := nodeid.LoadOrCreate(filepath.Join(t.TempDir(), "node.json"))
	if err != nil {
		t.Fatalf("nodeid.LoadOrCreate: %v", err)
	}
	ctx := context.Background()
	e, err := substrate.Open(ctx, substrate.Options{Identity: id, NS: ns})
	if err != nil {
		t.Fatalf("substrate.Open: %v", err)
	}
	t.Cleanup(func() { _ = e.Close(ctx) })
	return e, id
}

func setOp(entity, key, field string, value []byte) oplog.Op {
	return oplog.Op{Kind: oplog.KindSet, Entity: entity, Key: key, Field: field, Value: value}
}

func addOp(entity, key string, value []byte) oplog.Op {
	return oplog.Op{Kind: oplog.KindAdd, Entity: entity, Key: key, Value: value}
}

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

func TestMintedOpSurvivesTheRoundTrip(t *testing.T) {
	author, _ := openEngine(t, "org-1")
	peer, _ := openEngine(t, "org-1")

	now := time.Now()
	rec, err := author.Mint(setOp("menu_items", "row-1", "price_cents", []byte("1299")), now)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	got, fresh, err := peer.Ingest(rec.Cose, now)
	if err != nil {
		t.Fatalf("Ingest: %v", err)
	}
	if !fresh {
		t.Fatal("the peer reports it already had an op it has never seen")
	}
	if got.ID != rec.ID {
		t.Fatalf("the two replicas address the same op differently: %s vs %s", rec.ID, got.ID)
	}
	if got.Op.Entity != "menu_items" || got.Op.Key != "row-1" || got.Op.Field != "price_cents" {
		t.Fatalf("address did not survive the round trip: %+v", got.Op)
	}
	if !bytes.Equal(got.Op.Value, []byte("1299")) {
		t.Fatalf("value did not survive the round trip: %q", got.Op.Value)
	}
	if got.Op.TS != rec.Op.TS {
		t.Fatalf("stamp did not survive the round trip: %+v vs %+v", got.Op.TS, rec.Op.TS)
	}
	if got.Op.TS.Node != author.Node() {
		t.Fatalf("op claims node %q, minted by %q", got.Op.TS.Node, author.Node())
	}

	value, ok, err := peer.Get("menu_items", "row-1", "price_cents")
	if err != nil || !ok {
		t.Fatalf("Get = ok=%v err=%v, want the register to hold a value", ok, err)
	}
	if !bytes.Equal(value, []byte("1299")) {
		t.Fatalf("Get returned %q", value)
	}
}

func TestOpIDIsAContentAddressAndNotACallerName(t *testing.T) {
	e, _ := openEngine(t, "org-1")

	// A caller-supplied id is ignored. Nothing about the op's identity may come
	// from outside the bytes of the op.
	op := setOp("menu_items", "row-1", "name", []byte("steak"))
	op.ID = "aaaaaaaa-0000-0000-0000-000000000001"

	rec, err := e.Mint(op, time.Now())
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if rec.ID == op.ID {
		t.Fatal("Mint kept the caller's id — an op's identity must be its content address")
	}
	// 33-byte §18.1.5 v0 address, lowercase hex.
	if len(rec.ID) != 66 {
		t.Fatalf("op id is %d characters (%q), want 66", len(rec.ID), rec.ID)
	}
}

// TestOpAddressDistinguishesEveryField is the property internal/oplog's deleted
// Op.Canonical() tests were really asserting, restated where the encoder now
// lives: two ops that differ anywhere must not collide, or one would silently
// stand in for the other everywhere identity is used.
func TestOpAddressDistinguishesEveryField(t *testing.T) {
	e, _ := openEngine(t, "org-1")

	at := time.Now()
	base, err := e.Mint(setOp("entity", "key", "field", []byte("value")), at)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	variants := []struct {
		name string
		op   oplog.Op
	}{
		{"different entity", setOp("entity2", "key", "field", []byte("value"))},
		{"different key", setOp("entity", "key2", "field", []byte("value"))},
		{"different field", setOp("entity", "key", "field2", []byte("value"))},
		{"different value", setOp("entity", "key", "field", []byte("value2"))},
		{"different kind", addOp("entity", "key", []byte("value"))},
		// The boundary case the length-prefixed encoder existed for: "ab"/"c"
		// and "a"/"bc" concatenate to the same string.
		{"shifted entity/key boundary", setOp("ab", "c", "field", []byte("value"))},
	}
	seen := map[string]string{base.ID: "base"}
	for _, v := range variants {
		rec, err := e.Mint(v.op, at)
		if err != nil {
			t.Fatalf("Mint(%s): %v", v.name, err)
		}
		if prev, dup := seen[rec.ID]; dup {
			t.Fatalf("%q addresses to the same op as %q (%s)", v.name, prev, rec.ID)
		}
		seen[rec.ID] = v.name
	}

	// And the stamp is part of the address too: the same op minted twice is two
	// ops, because the clock advanced between them.
	again, err := e.Mint(setOp("entity", "key", "field", []byte("value")), at)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if again.ID == base.ID {
		t.Fatal("two ops minted at different logical times share one address")
	}
}

func TestReIngestingAnOpChangesNothing(t *testing.T) {
	author, _ := openEngine(t, "org-1")
	peer, _ := openEngine(t, "org-1")

	now := time.Now()
	rec, err := author.Mint(setOp("menu_items", "row-1", "name", []byte("steak")), now)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if _, fresh, err := peer.Ingest(rec.Cose, now); err != nil || !fresh {
		t.Fatalf("first Ingest = fresh=%v err=%v", fresh, err)
	}
	root, err := peer.StateRoot()
	if err != nil {
		t.Fatalf("StateRoot: %v", err)
	}

	_, fresh, err := peer.Ingest(rec.Cose, now)
	if err != nil {
		t.Fatalf("second Ingest: %v", err)
	}
	if fresh {
		t.Fatal("the replica reports a replayed op as new — dedup is by content address and must not miss")
	}
	after, err := peer.StateRoot()
	if err != nil {
		t.Fatalf("StateRoot: %v", err)
	}
	if after != root {
		t.Fatalf("re-ingesting one op moved the state root from %s to %s", root, after)
	}
}

// ---------------------------------------------------------------------------
// The ledger's element identity
// ---------------------------------------------------------------------------

// TestIdenticalLedgerFactsBothSurvive is the −2 property at the level the
// mapping can break it. §4.3 identifies an OR-Set element by its value, so two
// adds carrying identical bytes would collapse into one element — and a
// read-side SUM would then report one sale where two happened, converged and
// identical on every replica, with nothing to notice.
func TestIdenticalLedgerFactsBothSurvive(t *testing.T) {
	e, _ := openEngine(t, "org-1")

	at := time.Now()
	first, err := e.Mint(addOp("stock_movements", "steak", []byte("-1")), at)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	second, err := e.Mint(addOp("stock_movements", "steak", []byte("-1")), at)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if first.ID == second.ID {
		t.Fatal("two distinct sales minted one op")
	}

	members, err := e.Members("stock_movements", "steak")
	if err != nil {
		t.Fatalf("Members: %v", err)
	}
	if len(members) != 2 {
		t.Fatalf("the ledger holds %d members, want 2 — two tills each sold the last steak "+
			"and the merge kept one of them", len(members))
	}
	for i, m := range members {
		if !bytes.Equal(m.Value, []byte("-1")) {
			t.Fatalf("member %d carries %q, want the op's own payload back", i, m.Value)
		}
	}
	if members[0].TS == members[1].TS {
		t.Fatal("both members carry the same stamp, so they are not actually distinguished")
	}
}

func TestLedgerMembersAreScopedToTheirTarget(t *testing.T) {
	e, _ := openEngine(t, "org-1")

	at := time.Now()
	if _, err := e.Mint(addOp("stock_movements", "steak", []byte("-1")), at); err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if _, err := e.Mint(addOp("stock_movements", "chops", []byte("-4")), at); err != nil {
		t.Fatalf("Mint: %v", err)
	}
	members, err := e.Members("stock_movements", "steak")
	if err != nil {
		t.Fatalf("Members: %v", err)
	}
	if len(members) != 1 || !bytes.Equal(members[0].Value, []byte("-1")) {
		t.Fatalf("Members leaked across keys: %+v", members)
	}
}

// ---------------------------------------------------------------------------
// Convergence
// ---------------------------------------------------------------------------

// TestApplyOrderDoesNotChangeTheState is the local half of ROADMAP Stage 2's
// precondition 4. It is NOT that precondition: it compares the substrate against
// itself under two arrival orders, not against internal/oplog under an induced
// partition, and it does not compare drawer totals or sequence numbers. Stage 2
// stays unmet.
func TestApplyOrderDoesNotChangeTheState(t *testing.T) {
	author, _ := openEngine(t, "org-1")
	forward, _ := openEngine(t, "org-1")
	backward, _ := openEngine(t, "org-1")

	at := time.Now()
	var envelopes [][]byte
	for _, op := range []oplog.Op{
		setOp("menu_items", "row-1", "name", []byte("steak")),
		addOp("stock_movements", "steak", []byte("-1")),
		setOp("menu_items", "row-1", "name", []byte("ribeye")),
		addOp("stock_movements", "steak", []byte("-1")),
		setOp("menu_items", "row-2", "name", []byte("chops")),
	} {
		rec, err := author.Mint(op, at)
		if err != nil {
			t.Fatalf("Mint: %v", err)
		}
		envelopes = append(envelopes, rec.Cose)
	}

	for _, cose := range envelopes {
		if _, _, err := forward.Ingest(cose, at); err != nil {
			t.Fatalf("forward Ingest: %v", err)
		}
	}
	for i := len(envelopes) - 1; i >= 0; i-- {
		if _, _, err := backward.Ingest(envelopes[i], at); err != nil {
			t.Fatalf("backward Ingest: %v", err)
		}
	}

	a, err := forward.StateRoot()
	if err != nil {
		t.Fatalf("StateRoot: %v", err)
	}
	b, err := backward.StateRoot()
	if err != nil {
		t.Fatalf("StateRoot: %v", err)
	}
	if a != b {
		t.Fatalf("two arrival orders of the same five ops produced different observable state: %s vs %s", a, b)
	}

	// And the merge picked the later write, not merely a consistent one.
	name, ok, err := forward.Get("menu_items", "row-1", "name")
	if err != nil || !ok {
		t.Fatalf("Get = ok=%v err=%v", ok, err)
	}
	if !bytes.Equal(name, []byte("ribeye")) {
		t.Fatalf("the register holds %q, want the later write %q", name, "ribeye")
	}
}

func TestVersionVectorNamesTheAuthorInBeepBitesOwnSpelling(t *testing.T) {
	author, _ := openEngine(t, "org-1")

	if _, err := author.Mint(setOp("menu_items", "row-1", "name", []byte("steak")), time.Now()); err != nil {
		t.Fatalf("Mint: %v", err)
	}
	vv, err := author.VersionVector()
	if err != nil {
		t.Fatalf("VersionVector: %v", err)
	}
	mark, ok := vv[author.Node()]
	if !ok {
		t.Fatalf("the vector has no entry for this node (%s); it holds %v", author.Node(), vv)
	}
	if mark.Node != author.Node() {
		t.Fatalf("mark names node %q", mark.Node)
	}
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

func TestOpFromAnotherNamespaceIsRefused(t *testing.T) {
	author, _ := openEngine(t, "org-1")
	peer, _ := openEngine(t, "org-2")

	now := time.Now()
	rec, err := author.Mint(setOp("menu_items", "row-1", "name", []byte("steak")), now)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if _, _, err := peer.Ingest(rec.Cose, now); err == nil {
		t.Fatal("a replica merged an op belonging to another organisation's namespace")
	}
}

func TestATamperedEnvelopeIsRefused(t *testing.T) {
	author, _ := openEngine(t, "org-1")
	peer, _ := openEngine(t, "org-1")

	now := time.Now()
	rec, err := author.Mint(setOp("menu_items", "row-1", "name", []byte("steak")), now)
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	tampered := bytes.Clone(rec.Cose)
	tampered[len(tampered)/2] ^= 0x01

	if _, _, err := peer.Ingest(tampered, now); err == nil {
		t.Fatal("a replica merged an op whose envelope had been altered in flight")
	}
	if peer.Stats().Ingested != 0 {
		t.Fatalf("a refused op was counted as ingested: %+v", peer.Stats())
	}
}

func TestAnEntityContainingTheTargetSeparatorIsRefused(t *testing.T) {
	e, _ := openEngine(t, "org-1")

	// The target is "<entity>/<key>", so an entity carrying a separator would
	// split back into a different address than it was minted from — a row
	// written under one name and read under another.
	if _, err := e.Mint(setOp("menu/items", "row-1", "name", []byte("x")), time.Now()); err == nil {
		t.Fatal("Mint accepted an entity whose target would be ambiguous")
	}
}

func TestAnInvalidOpNeverReachesTheEngine(t *testing.T) {
	e, _ := openEngine(t, "org-1")

	for name, op := range map[string]oplog.Op{
		"set with no field": setOp("menu_items", "row-1", "", []byte("x")),
		"add with a field":  {Kind: oplog.KindAdd, Entity: "stock_movements", Key: "steak", Field: "qty"},
		"unknown kind":      {Kind: oplog.Kind(9), Entity: "menu_items", Key: "row-1"},
		"empty entity":      setOp("", "row-1", "name", []byte("x")),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := e.Mint(op, time.Now()); err == nil {
				t.Fatalf("Mint accepted an op oplog.Op.Validate rejects")
			}
		})
	}
}

func TestOpenRefusesWithoutAnIdentityOrNamespace(t *testing.T) {
	ctx := context.Background()
	id, err := nodeid.LoadOrCreate(filepath.Join(t.TempDir(), "node.json"))
	if err != nil {
		t.Fatalf("nodeid.LoadOrCreate: %v", err)
	}
	if _, err := substrate.Open(ctx, substrate.Options{NS: "org-1"}); err == nil {
		t.Fatal("Open succeeded with no identity — there would be no key to sign with")
	}
	if _, err := substrate.Open(ctx, substrate.Options{Identity: id}); err == nil {
		t.Fatal("Open succeeded with no namespace — every op would land in the default one")
	}
}
