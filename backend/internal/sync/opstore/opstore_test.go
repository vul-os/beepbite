// Package opstore_test holds DB-backed integration tests for the opstore
// Store.
//
// Run:
//
//	cd backend && go test ./internal/sync/opstore/ -run Integration -v
//
// Tests skip automatically when no Postgres backend is available (Docker
// absent and TEST_DATABASE_URL / DATABASE_URL unset) — see
// cmd/tests/testenv.StartPostgres.
package opstore_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/opstore"
)

// ---------------------------------------------------------------------------
// Package-level pool (shared across all Integration* tests)
// ---------------------------------------------------------------------------

var testPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping opstore integration tests:", err)
		os.Exit(0)
	}
	if err != nil {
		log.Fatal("testenv.StartPostgres:", err)
	}
	defer cleanup()
	testPool = pool
	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Seed / random helpers
// ---------------------------------------------------------------------------

// randHex returns n random hex bytes as a lowercase string, for disambiguating
// test data across runs and preventing collisions between parallel tests.
func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failing is not something a test can recover from
	}
	return hex.EncodeToString(b)
}

// newUUID returns a random RFC 4122 v4 UUID string. sync_ops.id is a real
// Postgres uuid column (migration 002), so op IDs used in tests must be
// UUID-formatted — internal/oplog's own doc comment suggests ULIDs as a
// perfectly valid Op.ID for the in-memory package, which is NOT the same
// format, so this package's tests are deliberately explicit about minting
// UUIDs rather than reusing whatever oplog's own tests use as IDs.
func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// svcQueryRow executes a single-row query under service-role scope. Mirrors
// the helper of the same name in internal/handlers/hardware's integration
// tests — duplicated here rather than imported, per this package's mandate
// to touch no existing files and add no new dependency between packages.
func svcQueryRow(t *testing.T, pool *pgxpool.Pool, dest any, query string, args ...any) {
	t.Helper()
	ctx := context.Background()
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, query, args...).Scan(dest)
	})
	if err != nil {
		t.Fatalf("svcQueryRow: %v\nquery: %s\nargs: %v", err, query, args)
	}
}

// seedOrg inserts a fresh organization and registers cleanup. sync_ops.
// organization_id REFERENCES organizations(id) ON DELETE CASCADE, so deleting
// the org also deletes every sync_ops row the test wrote for it.
func seedOrg(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	name := "Opstore Test Org " + randHex(4)
	var id string
	svcQueryRow(t, pool, &id, `INSERT INTO organizations (name) VALUES ($1) RETURNING id`, name)
	t.Cleanup(func() {
		ctx := context.Background()
		_ = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// ---------------------------------------------------------------------------
// Op builders
// ---------------------------------------------------------------------------

func setOp(node, entity, key, field string, value []byte, wall int64, counter uint32) oplog.Op {
	return oplog.Op{
		ID:     newUUID(),
		Kind:   oplog.KindSet,
		Entity: entity,
		Key:    key,
		Field:  field,
		Value:  value,
		TS:     oplog.Timestamp{Wall: wall, Counter: counter, Node: node},
	}
}

func addOp(node, entity, key string, value []byte, wall int64, counter uint32) oplog.Op {
	return oplog.Op{
		ID:     newUUID(),
		Kind:   oplog.KindAdd,
		Entity: entity,
		Key:    key,
		Value:  value,
		TS:     oplog.Timestamp{Wall: wall, Counter: counter, Node: node},
	}
}

// ---------------------------------------------------------------------------
// §1  Append / OpsFor round trip
// ---------------------------------------------------------------------------

func TestIntegrationAppendAndOpsFor_RoundTrip(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	store := opstore.New(testPool)

	entity, key := "menu_item", "item-"+randHex(4)
	node := "node-" + randHex(4)

	// A non-UTF8 payload — the store must treat value as an opaque byte
	// string, never assume text.
	rawValue := []byte{0x00, 0xff, 0xfe, 'h', 'i', 0x80}

	ops := []oplog.Op{
		setOp(node, entity, key, "name", []byte("Burger"), 1000, 0),
		setOp(node, entity, key, "price_cents", rawValue, 1000, 1),
		addOp(node, "stock_movement", key, []byte("sold:1"), 1001, 0),
	}

	inserted, err := store.Append(ctx, scope, ops, nil)
	if err != nil {
		t.Fatalf("Append: %v", err)
	}
	if inserted != len(ops) {
		t.Fatalf("Append: inserted = %d, want %d", inserted, len(ops))
	}

	got, err := store.OpsFor(ctx, scope, entity, key)
	if err != nil {
		t.Fatalf("OpsFor: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("OpsFor: got %d ops, want 2 (the stock_movement op is a different entity)", len(got))
	}
	// Total order: (ts_wall, ts_counter, ts_node) ascending.
	if got[0].Field != "name" || got[1].Field != "price_cents" {
		t.Errorf("OpsFor: order = [%s, %s], want [name, price_cents]", got[0].Field, got[1].Field)
	}
	if string(got[1].Value) != string(rawValue) {
		t.Errorf("OpsFor: non-UTF8 value round-tripped as %v, want %v", got[1].Value, rawValue)
	}
	if got[0].Kind != oplog.KindSet {
		t.Errorf("OpsFor: Kind = %v, want KindSet", got[0].Kind)
	}
	if got[0].TS.Node != node {
		t.Errorf("OpsFor: TS.Node = %q, want %q", got[0].TS.Node, node)
	}
}

// ---------------------------------------------------------------------------
// §2  Idempotent re-append
// ---------------------------------------------------------------------------

func TestIntegrationAppend_IdempotentReplay(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	store := opstore.New(testPool)

	entity, key := "menu_item", "item-"+randHex(4)
	node := "node-" + randHex(4)
	ops := []oplog.Op{
		setOp(node, entity, key, "name", []byte("Fries"), 2000, 0),
		addOp(node, "stock_movement", key, []byte("sold:1"), 2001, 0),
	}

	inserted, err := store.Append(ctx, scope, ops, nil)
	if err != nil {
		t.Fatalf("first Append: %v", err)
	}
	if inserted != 2 {
		t.Fatalf("first Append: inserted = %d, want 2", inserted)
	}

	// Re-send the exact same batch — a peer retrying after a lost ack.
	inserted, err = store.Append(ctx, scope, ops, nil)
	if err != nil {
		t.Fatalf("replayed Append: want nil error, got %v", err)
	}
	if inserted != 0 {
		t.Fatalf("replayed Append: inserted = %d, want 0", inserted)
	}

	got, err := store.OpsFor(ctx, scope, entity, key)
	if err != nil {
		t.Fatalf("OpsFor: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("OpsFor after replay: got %d ops, want 1 (no duplicate)", len(got))
	}
}

// ---------------------------------------------------------------------------
// §3  Since: unseen ops, order, and limit
// ---------------------------------------------------------------------------

func TestIntegrationSince_UnseenOrderAndLimit(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	store := opstore.New(testPool)

	entity := "menu_item"
	nodeA := "nodeA-" + randHex(4)
	nodeB := "nodeB-" + randHex(4)

	// Sorted by (wall, counter, node), the ascending order Since must return
	// them in, this batch is: op3 (wall 999), op0 (wall 1000, ctr 0), op1
	// (wall 1000, ctr 1), op2 (wall 1001), op4 (wall 1002).
	op0 := setOp(nodeA, entity, "item-a", "name", []byte("v0"), 1000, 0)
	op1 := setOp(nodeA, entity, "item-a", "name", []byte("v1"), 1000, 1)
	op2 := addOp(nodeA, "stock_movement", "item-a", []byte("m1"), 1001, 0)
	op3 := setOp(nodeB, entity, "item-b", "name", []byte("v0"), 999, 0)
	op4 := addOp(nodeB, "stock_movement", "item-b", []byte("m2"), 1002, 0)

	all := []oplog.Op{op0, op1, op2, op3, op4}
	if _, err := store.Append(ctx, scope, all, nil); err != nil {
		t.Fatalf("Append: %v", err)
	}

	// vv has "seen" exactly op0 from nodeA (wall 1000, counter 0), and knows
	// nothing about nodeB at all.
	vv := oplog.VersionVector{
		nodeA: oplog.Timestamp{Wall: 1000, Counter: 0, Node: nodeA},
	}

	got, err := store.Since(ctx, scope, vv, 10)
	if err != nil {
		t.Fatalf("Since: %v", err)
	}
	wantIDs := []string{op3.ID, op1.ID, op2.ID, op4.ID}
	gotIDs := make([]string, len(got))
	for i, op := range got {
		gotIDs[i] = op.ID
	}
	if !equalStrings(gotIDs, wantIDs) {
		t.Fatalf("Since: got IDs %v, want %v (op0 must be excluded, already seen)", gotIDs, wantIDs)
	}

	// Limit caps the page but preserves the same prefix order.
	limited, err := store.Since(ctx, scope, vv, 2)
	if err != nil {
		t.Fatalf("Since(limit=2): %v", err)
	}
	if len(limited) != 2 || limited[0].ID != op3.ID || limited[1].ID != op1.ID {
		gotIDs := make([]string, len(limited))
		for i, op := range limited {
			gotIDs[i] = op.ID
		}
		t.Fatalf("Since(limit=2): got IDs %v, want [%s, %s]", gotIDs, op3.ID, op1.ID)
	}
}

func equalStrings(a, b []string) bool {
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

// ---------------------------------------------------------------------------
// §4  VersionVector
// ---------------------------------------------------------------------------

func TestIntegrationVersionVector_MatchesAppended(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	store := opstore.New(testPool)

	nodeA := "nodeA-" + randHex(4)
	nodeB := "nodeB-" + randHex(4)

	ops := []oplog.Op{
		setOp(nodeA, "menu_item", "item-a", "name", []byte("v0"), 5000, 0),
		setOp(nodeA, "menu_item", "item-a", "name", []byte("v1"), 5000, 3), // highest for nodeA
		addOp(nodeB, "stock_movement", "item-a", []byte("m1"), 4999, 9),    // highest for nodeB
		addOp(nodeB, "stock_movement", "item-a", []byte("m2"), 4998, 0),
	}
	if _, err := store.Append(ctx, scope, ops, nil); err != nil {
		t.Fatalf("Append: %v", err)
	}

	want := oplog.NewVersionVector()
	for _, op := range ops {
		want.Observe(op)
	}

	got, err := store.VersionVector(ctx, scope)
	if err != nil {
		t.Fatalf("VersionVector: %v", err)
	}
	if len(got) != len(want) {
		t.Fatalf("VersionVector: got %d nodes, want %d (%v vs %v)", len(got), len(want), got, want)
	}
	for node, wantTS := range want {
		gotTS, ok := got[node]
		if !ok {
			t.Fatalf("VersionVector: missing entry for node %q", node)
		}
		if gotTS.Compare(wantTS) != 0 {
			t.Errorf("VersionVector[%q] = %+v, want %+v", node, gotTS, wantTS)
		}
	}
}

// ---------------------------------------------------------------------------
// §5  Cross-tenant isolation under RLS
// ---------------------------------------------------------------------------

// TestIntegrationCrossTenantIsolation is the load-bearing test: org A's ops
// must be completely invisible to a Store call scoped to org B, across every
// read path (Since, VersionVector, OpsFor), and the reverse must hold too.
func TestIntegrationCrossTenantIsolation(t *testing.T) {
	ctx := context.Background()
	orgA := seedOrg(t, testPool)
	orgB := seedOrg(t, testPool)
	scopeA := db.Scope{OrgID: orgA}
	scopeB := db.Scope{OrgID: orgB}
	store := opstore.New(testPool)

	entity, key := "menu_item", "shared-key-"+randHex(4) // same entity/key on purpose
	nodeA := "nodeA-" + randHex(4)
	nodeB := "nodeB-" + randHex(4)

	opsA := []oplog.Op{setOp(nodeA, entity, key, "name", []byte("Org A's burger"), 9000, 0)}
	opsB := []oplog.Op{setOp(nodeB, entity, key, "name", []byte("Org B's burger"), 9000, 0)}

	if _, err := store.Append(ctx, scopeA, opsA, nil); err != nil {
		t.Fatalf("Append(orgA): %v", err)
	}
	if _, err := store.Append(ctx, scopeB, opsB, nil); err != nil {
		t.Fatalf("Append(orgB): %v", err)
	}

	// OpsFor: org B must see only its own op for the shared (entity, key).
	gotB, err := store.OpsFor(ctx, scopeB, entity, key)
	if err != nil {
		t.Fatalf("OpsFor(scopeB): %v", err)
	}
	if len(gotB) != 1 || gotB[0].ID != opsB[0].ID {
		t.Fatalf("OpsFor(scopeB): got %d ops, want exactly org B's own op", len(gotB))
	}
	gotA, err := store.OpsFor(ctx, scopeA, entity, key)
	if err != nil {
		t.Fatalf("OpsFor(scopeA): %v", err)
	}
	if len(gotA) != 1 || gotA[0].ID != opsA[0].ID {
		t.Fatalf("OpsFor(scopeA): got %d ops, want exactly org A's own op", len(gotA))
	}

	// VersionVector: org B's vector must not contain nodeA at all.
	vvB, err := store.VersionVector(ctx, scopeB)
	if err != nil {
		t.Fatalf("VersionVector(scopeB): %v", err)
	}
	if _, ok := vvB[nodeA]; ok {
		t.Errorf("VersionVector(scopeB): leaked org A's node %q", nodeA)
	}
	if _, ok := vvB[nodeB]; !ok {
		t.Errorf("VersionVector(scopeB): missing org B's own node %q", nodeB)
	}

	// Since: org B, with an empty vv, must not see org A's op.
	sinceB, err := store.Since(ctx, scopeB, oplog.NewVersionVector(), 100)
	if err != nil {
		t.Fatalf("Since(scopeB): %v", err)
	}
	for _, op := range sinceB {
		if op.ID == opsA[0].ID {
			t.Fatalf("Since(scopeB): returned org A's op %q", op.ID)
		}
	}
}

// ---------------------------------------------------------------------------
// §6  Validation
// ---------------------------------------------------------------------------

func TestIntegrationAppend_RejectsSetWithNoField(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	store := opstore.New(testPool)

	bad := oplog.Op{
		ID:     newUUID(),
		Kind:   oplog.KindSet,
		Entity: "menu_item",
		Key:    "item-x",
		// Field intentionally left empty — invalid for KindSet.
		Value: []byte("x"),
		TS:    oplog.Timestamp{Wall: 1, Counter: 0, Node: "n"},
	}

	_, err := store.Append(ctx, scope, []oplog.Op{bad}, nil)
	if !errors.Is(err, oplog.ErrSetNeedsField) {
		t.Fatalf("Append(Set, no field): want ErrSetNeedsField, got %v", err)
	}
}

func TestIntegrationAppend_RejectsAddWithField(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	store := opstore.New(testPool)

	bad := oplog.Op{
		ID:     newUUID(),
		Kind:   oplog.KindAdd,
		Entity: "stock_movement",
		Key:    "item-x",
		Field:  "should-not-be-set", // invalid for KindAdd
		Value:  []byte("x"),
		TS:     oplog.Timestamp{Wall: 1, Counter: 0, Node: "n"},
	}

	_, err := store.Append(ctx, scope, []oplog.Op{bad}, nil)
	if !errors.Is(err, oplog.ErrAddHasField) {
		t.Fatalf("Append(Add, with field): want ErrAddHasField, got %v", err)
	}
}

// TestIntegrationAppend_BadOpInsertsNothing verifies all-or-nothing batch
// semantics: a batch with one invalid op among otherwise-good ones must
// insert none of them, and must fail before any transaction opens (Validate
// runs over the whole batch first).
func TestIntegrationAppend_BadOpInsertsNothing(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	store := opstore.New(testPool)

	entity, key := "menu_item", "item-"+randHex(4)
	node := "node-" + randHex(4)

	good1 := setOp(node, entity, key, "name", []byte("ok"), 1, 0)
	bad := oplog.Op{ // KindSet with empty Field — invalid
		ID:     newUUID(),
		Kind:   oplog.KindSet,
		Entity: entity,
		Key:    key,
		Value:  []byte("x"),
		TS:     oplog.Timestamp{Wall: 2, Counter: 0, Node: node},
	}
	good2 := setOp(node, entity, key, "price_cents", []byte("100"), 3, 0)

	_, err := store.Append(ctx, scope, []oplog.Op{good1, bad, good2}, nil)
	if err == nil {
		t.Fatal("Append with one bad op: want error, got nil")
	}

	got, err := store.OpsFor(ctx, scope, entity, key)
	if err != nil {
		t.Fatalf("OpsFor: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("OpsFor after rejected batch: got %d ops, want 0 (all-or-nothing)", len(got))
	}
}

// ---------------------------------------------------------------------------
// §7  Misc edge cases
// ---------------------------------------------------------------------------

func TestIntegrationAppend_EmptyBatch(t *testing.T) {
	ctx := context.Background()
	store := opstore.New(testPool)

	inserted, err := store.Append(ctx, db.Scope{OrgID: newUUID()}, nil, nil)
	if err != nil {
		t.Fatalf("Append(empty): want nil error, got %v", err)
	}
	if inserted != 0 {
		t.Fatalf("Append(empty): inserted = %d, want 0", inserted)
	}
}

func TestIntegrationAppend_EmptyOrgScope(t *testing.T) {
	ctx := context.Background()
	store := opstore.New(testPool)

	op := setOp("node", "menu_item", "item-x", "name", []byte("x"), 1, 0)
	_, err := store.Append(ctx, db.Scope{}, []oplog.Op{op}, nil)
	if !errors.Is(err, opstore.ErrEmptyOrgScope) {
		t.Fatalf("Append(empty org scope): want ErrEmptyOrgScope, got %v", err)
	}
}

func TestIntegrationAppend_SigsLengthMismatch(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	store := opstore.New(testPool)

	ops := []oplog.Op{
		setOp("node", "menu_item", "item-x", "name", []byte("x"), 1, 0),
		setOp("node", "menu_item", "item-y", "name", []byte("y"), 2, 0),
	}
	_, err := store.Append(ctx, scope, ops, [][]byte{[]byte("only-one-sig")})
	if !errors.Is(err, opstore.ErrSigsLengthMismatch) {
		t.Fatalf("Append(sigs length mismatch): want ErrSigsLengthMismatch, got %v", err)
	}
}
