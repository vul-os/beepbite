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
//
// Every record these tests store is minted by a real substrate.Engine rather
// than hand-built, because the identity being tested is the engine's: an op's
// id is the content address of its canonical bytes, and a test that made one up
// would be testing a string column rather than the property migration 004
// exists for.
package opstore_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/nodeid"
	"github.com/beepbite/backend/internal/oplog"
	"github.com/beepbite/backend/internal/sync/opstore"
	"github.com/beepbite/backend/internal/sync/substrate"
)

// ---------------------------------------------------------------------------
// Package-level pool (shared across all Integration* tests)
// ---------------------------------------------------------------------------

var (
	testPool *pgxpool.Pool

	// engineCacheDir persists wazero's compiled machine code across every
	// substrate.Open in this package. Compiling the module is a few hundred
	// milliseconds and these tests open a replica per node per test; the cache
	// turns that into single-digit milliseconds after the first.
	engineCacheDir string
)

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

	engineCacheDir, err = os.MkdirTemp("", "opstore-engine-cache")
	if err != nil {
		log.Fatal("engine cache dir:", err)
	}
	defer os.RemoveAll(engineCacheDir)

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

// newUUID returns a random RFC 4122 v4 UUID string. Organisation ids are real
// Postgres uuids; op ids no longer are (migration 004 made them content
// addresses), so this is used only where a uuid is genuinely called for.
func newUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// svcQueryRow executes a single-row query under service-role scope.
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
// Engine helpers
// ---------------------------------------------------------------------------

// openEngine brings up one replica with a fresh node identity, in ns.
func openEngine(t *testing.T, ns string) *substrate.Engine {
	t.Helper()
	id, err := nodeid.LoadOrCreate(filepath.Join(t.TempDir(), "node.json"))
	if err != nil {
		t.Fatalf("nodeid.LoadOrCreate: %v", err)
	}
	ctx := context.Background()
	e, err := substrate.Open(ctx, substrate.Options{Identity: id, NS: ns, CacheDir: engineCacheDir})
	if err != nil {
		t.Fatalf("substrate.Open: %v", err)
	}
	t.Cleanup(func() { _ = e.Close(ctx) })
	return e
}

// mintSet mints a last-writer-wins register write at the given wall clock.
//
// The stamp comes from the engine's own §3 clock, which is monotonic, so a
// caller that asks for a wall no later than the previous one gets the previous
// wall with a higher counter — the same rule internal/oplog's Clock applies,
// and the reason these tests hand each node its own engine.
func mintSet(t *testing.T, e *substrate.Engine, entity, key, field string, value []byte, wallMS int64) substrate.Record {
	t.Helper()
	rec, err := e.Mint(oplog.Op{
		Kind: oplog.KindSet, Entity: entity, Key: key, Field: field, Value: value,
	}, time.UnixMilli(wallMS))
	if err != nil {
		t.Fatalf("Mint(set): %v", err)
	}
	return rec
}

// mintAdd mints an append-only ledger member at the given wall clock.
func mintAdd(t *testing.T, e *substrate.Engine, entity, key string, value []byte, wallMS int64) substrate.Record {
	t.Helper()
	rec, err := e.Mint(oplog.Op{
		Kind: oplog.KindAdd, Entity: entity, Key: key, Value: value,
	}, time.UnixMilli(wallMS))
	if err != nil {
		t.Fatalf("Mint(add): %v", err)
	}
	return rec
}

func ids(recs []substrate.Record) []string {
	out := make([]string, len(recs))
	for i, r := range recs {
		out[i] = r.ID
	}
	return out
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
// §1  Append / OpsFor round trip
// ---------------------------------------------------------------------------

func TestIntegrationAppendAndOpsFor_RoundTrip(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	eng := openEngine(t, orgID)
	store := opstore.New(testPool, eng)

	entity, key := "menu_item", "item-"+randHex(4)

	// A non-UTF8 payload — the store must treat value as an opaque byte
	// string, never assume text.
	rawValue := []byte{0x00, 0xff, 0xfe, 'h', 'i', 0x80}

	recs := []substrate.Record{
		mintSet(t, eng, entity, key, "name", []byte("Burger"), 1000),
		mintSet(t, eng, entity, key, "price_cents", rawValue, 1000),
		mintAdd(t, eng, "stock_movement", key, []byte("sold:1"), 1001),
	}

	inserted, err := store.Append(ctx, scope, recs)
	if err != nil {
		t.Fatalf("Append: %v", err)
	}
	if inserted != len(recs) {
		t.Fatalf("Append: inserted = %d, want %d", inserted, len(recs))
	}

	got, err := store.OpsFor(ctx, scope, entity, key)
	if err != nil {
		t.Fatalf("OpsFor: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("OpsFor: got %d ops, want 2 (the stock_movement op is a different entity)", len(got))
	}
	// Total order: (ts_wall, ts_counter, ts_node) ascending.
	if got[0].Op.Field != "name" || got[1].Op.Field != "price_cents" {
		t.Errorf("OpsFor: order = [%s, %s], want [name, price_cents]", got[0].Op.Field, got[1].Op.Field)
	}
	if string(got[1].Op.Value) != string(rawValue) {
		t.Errorf("OpsFor: non-UTF8 value round-tripped as %v, want %v", got[1].Op.Value, rawValue)
	}
	if got[0].Op.Kind != oplog.KindSet {
		t.Errorf("OpsFor: Kind = %v, want KindSet", got[0].Op.Kind)
	}
	if got[0].Op.TS.Node != eng.Node() {
		t.Errorf("OpsFor: TS.Node = %q, want %q", got[0].Op.TS.Node, eng.Node())
	}
	if got[0].ID != recs[0].ID {
		t.Errorf("OpsFor: id = %q, want the content address %q", got[0].ID, recs[0].ID)
	}

	// The envelope is the row's source of truth, so it has to survive intact:
	// a peer verifies these exact bytes against the author's key.
	if string(got[0].Cose) != string(recs[0].Cose) {
		t.Error("OpsFor: the stored COSE_Sign1 envelope does not match the minted one")
	}
	peer := openEngine(t, orgID)
	if _, fresh, err := peer.Ingest(got[0].Cose, time.UnixMilli(1000)); err != nil || !fresh {
		t.Fatalf("a peer could not ingest the stored envelope: fresh=%v err=%v", fresh, err)
	}
}

// ---------------------------------------------------------------------------
// §2  Idempotent re-append
// ---------------------------------------------------------------------------

func TestIntegrationAppend_IdempotentReplay(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	eng := openEngine(t, orgID)
	store := opstore.New(testPool, eng)

	entity, key := "menu_item", "item-"+randHex(4)
	recs := []substrate.Record{
		mintSet(t, eng, entity, key, "name", []byte("Fries"), 2000),
		mintAdd(t, eng, "stock_movement", key, []byte("sold:1"), 2001),
	}

	inserted, err := store.Append(ctx, scope, recs)
	if err != nil {
		t.Fatalf("first Append: %v", err)
	}
	if inserted != 2 {
		t.Fatalf("first Append: inserted = %d, want 2", inserted)
	}

	// Re-send the exact same batch — a peer retrying after a lost ack.
	inserted, err = store.Append(ctx, scope, recs)
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

// TestIntegrationAppend_RelayedOpIsOneRow is the bug migration 004 exists for,
// stated as a test.
//
// A peer receives an operation, ingests it, and appends what it now holds. Under
// migration 002 the id was minted by whoever wrote the row, so the relayed copy
// carried a different uuid from the original, inserted a second row, and the
// engine — which deduplicates on content — considered it the same op. Postgres
// and the log disagreed about how many operations existed, with no error
// anywhere. The content address makes the two agree by construction.
func TestIntegrationAppend_RelayedOpIsOneRow(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	author := openEngine(t, orgID)
	relay := openEngine(t, orgID)
	store := opstore.New(testPool, relay)

	entity, key := "menu_item", "item-"+randHex(4)
	original := mintSet(t, author, entity, key, "name", []byte("Burger"), 3000)

	// The relay ingests the envelope and appends the record IT derived — which
	// is not the same Go value the author held, only the same operation.
	relayed, fresh, err := relay.Ingest(original.Cose, time.UnixMilli(3000))
	if err != nil || !fresh {
		t.Fatalf("relay Ingest: fresh=%v err=%v", fresh, err)
	}
	if relayed.ID != original.ID {
		t.Fatalf("the relay addresses the op as %s, the author as %s — two replicas "+
			"must derive one identity from one operation", relayed.ID, original.ID)
	}

	if n, err := store.Append(ctx, scope, []substrate.Record{original}); err != nil || n != 1 {
		t.Fatalf("Append(original): %d, %v", n, err)
	}
	if n, err := store.Append(ctx, scope, []substrate.Record{relayed}); err != nil || n != 0 {
		t.Fatalf("Append(relayed): inserted %d (err=%v), want 0 — one operation became two rows", n, err)
	}

	got, err := store.OpsFor(ctx, scope, entity, key)
	if err != nil {
		t.Fatalf("OpsFor: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("the log holds %d rows for one operation", len(got))
	}
}

// ---------------------------------------------------------------------------
// §3  Since: unseen ops, order, and limit
// ---------------------------------------------------------------------------

func TestIntegrationSince_UnseenOrderAndLimit(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	engA := openEngine(t, orgID)
	engB := openEngine(t, orgID)
	store := opstore.New(testPool, engA)

	entity := "menu_item"
	nodeA, nodeB := engA.Node(), engB.Node()

	// Sorted by (wall, counter, node), the ascending order Since must return
	// them in: op3 (wall 999), op0 (wall 1000, ctr 0), op1 (wall 1000, ctr 1),
	// op2 (wall 1001), op4 (wall 1002).
	op0 := mintSet(t, engA, entity, "item-a", "name", []byte("v0"), 1000)
	op1 := mintSet(t, engA, entity, "item-a", "name", []byte("v1"), 1000)
	op2 := mintAdd(t, engA, "stock_movement", "item-a", []byte("m1"), 1001)
	op3 := mintSet(t, engB, entity, "item-b", "name", []byte("v0"), 999)
	op4 := mintAdd(t, engB, "stock_movement", "item-b", []byte("m2"), 1002)

	all := []substrate.Record{op0, op1, op2, op3, op4}
	if _, err := store.Append(ctx, scope, all); err != nil {
		t.Fatalf("Append: %v", err)
	}
	if op1.Op.TS.Counter != op0.Op.TS.Counter+1 {
		t.Fatalf("the two same-millisecond ops did not get distinct counters: %+v, %+v",
			op0.Op.TS, op1.Op.TS)
	}

	// vv has "seen" exactly op0 from nodeA, and knows nothing about nodeB.
	vv := oplog.VersionVector{nodeA: op0.Op.TS}

	got, err := store.Since(ctx, scope, vv, 10)
	if err != nil {
		t.Fatalf("Since: %v", err)
	}
	wantIDs := []string{op3.ID, op1.ID, op2.ID, op4.ID}
	if !equalStrings(ids(got), wantIDs) {
		t.Fatalf("Since: got IDs %v, want %v (op0 must be excluded, already seen)", ids(got), wantIDs)
	}

	// Limit caps the page but preserves the same prefix order.
	limited, err := store.Since(ctx, scope, vv, 2)
	if err != nil {
		t.Fatalf("Since(limit=2): %v", err)
	}
	if !equalStrings(ids(limited), []string{op3.ID, op1.ID}) {
		t.Fatalf("Since(limit=2): got IDs %v, want [%s, %s]", ids(limited), op3.ID, op1.ID)
	}

	// nodeB was never in vv, so every one of its ops qualified — the "unlisted
	// node means the zero Timestamp" rule, exercised rather than assumed.
	sawB := false
	for _, rec := range got {
		if rec.Op.TS.Node == nodeB {
			sawB = true
		}
	}
	if !sawB {
		t.Fatalf("Since returned nothing from node %s, which the vector had never heard of", nodeB)
	}
}

// ---------------------------------------------------------------------------
// §4  VersionVector
// ---------------------------------------------------------------------------

func TestIntegrationVersionVector_MatchesAppended(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	engA := openEngine(t, orgID)
	engB := openEngine(t, orgID)
	store := opstore.New(testPool, engA)

	recs := []substrate.Record{
		mintSet(t, engA, "menu_item", "item-a", "name", []byte("v0"), 5000),
		mintSet(t, engA, "menu_item", "item-a", "name", []byte("v1"), 5001), // highest for A
		mintAdd(t, engB, "stock_movement", "item-a", []byte("m1"), 4998),
		mintAdd(t, engB, "stock_movement", "item-a", []byte("m2"), 4999), // highest for B
	}
	if _, err := store.Append(ctx, scope, recs); err != nil {
		t.Fatalf("Append: %v", err)
	}

	want := oplog.NewVersionVector()
	for _, rec := range recs {
		want.Observe(rec.Op)
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

	// And it agrees with what the engine itself holds, which is the whole point
	// of deriving it from the log rather than storing it: the two cannot drift
	// because neither is a second copy of the other.
	engineVV, err := engA.VersionVector()
	if err != nil {
		t.Fatalf("engine VersionVector: %v", err)
	}
	if engineVV[engA.Node()].Compare(got[engA.Node()]) != 0 {
		t.Errorf("the store and the engine disagree about node A's high-water mark: %+v vs %+v",
			got[engA.Node()], engineVV[engA.Node()])
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
	engA := openEngine(t, orgA)
	engB := openEngine(t, orgB)
	storeA := opstore.New(testPool, engA)
	storeB := opstore.New(testPool, engB)

	entity, key := "menu_item", "shared-key-"+randHex(4) // same entity/key on purpose
	nodeA, nodeB := engA.Node(), engB.Node()

	recA := mintSet(t, engA, entity, key, "name", []byte("Org A's burger"), 9000)
	recB := mintSet(t, engB, entity, key, "name", []byte("Org B's burger"), 9000)

	if _, err := storeA.Append(ctx, scopeA, []substrate.Record{recA}); err != nil {
		t.Fatalf("Append(orgA): %v", err)
	}
	if _, err := storeB.Append(ctx, scopeB, []substrate.Record{recB}); err != nil {
		t.Fatalf("Append(orgB): %v", err)
	}

	// OpsFor: org B must see only its own op for the shared (entity, key).
	gotB, err := storeB.OpsFor(ctx, scopeB, entity, key)
	if err != nil {
		t.Fatalf("OpsFor(scopeB): %v", err)
	}
	if len(gotB) != 1 || gotB[0].ID != recB.ID {
		t.Fatalf("OpsFor(scopeB): got %d ops, want exactly org B's own op", len(gotB))
	}
	gotA, err := storeA.OpsFor(ctx, scopeA, entity, key)
	if err != nil {
		t.Fatalf("OpsFor(scopeA): %v", err)
	}
	if len(gotA) != 1 || gotA[0].ID != recA.ID {
		t.Fatalf("OpsFor(scopeA): got %d ops, want exactly org A's own op", len(gotA))
	}

	// VersionVector: org B's vector must not contain nodeA at all.
	vvB, err := storeB.VersionVector(ctx, scopeB)
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
	sinceB, err := storeB.Since(ctx, scopeB, oplog.NewVersionVector(), 100)
	if err != nil {
		t.Fatalf("Since(scopeB): %v", err)
	}
	for _, rec := range sinceB {
		if rec.ID == recA.ID {
			t.Fatalf("Since(scopeB): returned org A's op %q", rec.ID)
		}
	}
}

// ---------------------------------------------------------------------------
// §6  Validation
// ---------------------------------------------------------------------------

// corrupt returns a well-formed record whose Op has been broken in one way, so
// the validation below is testing Append's own checks rather than the engine's
// (the engine will not mint any of these at all).
func corrupt(t *testing.T, eng *substrate.Engine, mutate func(*substrate.Record)) substrate.Record {
	t.Helper()
	rec := mintSet(t, eng, "menu_item", "item-"+randHex(4), "name", []byte("ok"), 1)
	mutate(&rec)
	return rec
}

func TestIntegrationAppend_RejectsSetWithNoField(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	eng := openEngine(t, orgID)
	store := opstore.New(testPool, eng)

	bad := corrupt(t, eng, func(r *substrate.Record) { r.Op.Field = "" })
	_, err := store.Append(ctx, db.Scope{OrgID: orgID}, []substrate.Record{bad})
	if !errors.Is(err, oplog.ErrSetNeedsField) {
		t.Fatalf("Append(Set, no field): want ErrSetNeedsField, got %v", err)
	}
}

func TestIntegrationAppend_RejectsAddWithField(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	eng := openEngine(t, orgID)
	store := opstore.New(testPool, eng)

	bad := corrupt(t, eng, func(r *substrate.Record) { r.Op.Kind = oplog.KindAdd })
	_, err := store.Append(ctx, db.Scope{OrgID: orgID}, []substrate.Record{bad})
	if !errors.Is(err, oplog.ErrAddHasField) {
		t.Fatalf("Append(Add, with field): want ErrAddHasField, got %v", err)
	}
}

func TestIntegrationAppend_RejectsANonAddressID(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	eng := openEngine(t, orgID)
	store := opstore.New(testPool, eng)

	// A uuid is exactly what this column used to hold, and exactly what must
	// not be storable now: a row keyed by a name rather than by its content is
	// a row the engine would insert a second time.
	bad := corrupt(t, eng, func(r *substrate.Record) { r.ID = newUUID() })
	_, err := store.Append(ctx, db.Scope{OrgID: orgID}, []substrate.Record{bad})
	if !errors.Is(err, opstore.ErrBadOpID) {
		t.Fatalf("Append(uuid id): want ErrBadOpID, got %v", err)
	}
}

func TestIntegrationAppend_RejectsAnUnsignedRecord(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	eng := openEngine(t, orgID)
	store := opstore.New(testPool, eng)

	bad := corrupt(t, eng, func(r *substrate.Record) { r.Cose = nil })
	_, err := store.Append(ctx, db.Scope{OrgID: orgID}, []substrate.Record{bad})
	if !errors.Is(err, opstore.ErrNoEnvelope) {
		t.Fatalf("Append(no envelope): want ErrNoEnvelope, got %v", err)
	}
}

// TestIntegrationAppend_BadOpInsertsNothing verifies all-or-nothing batch
// semantics: a batch with one invalid record among otherwise-good ones must
// insert none of them, and must fail before any transaction opens.
func TestIntegrationAppend_BadOpInsertsNothing(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	scope := db.Scope{OrgID: orgID}
	eng := openEngine(t, orgID)
	store := opstore.New(testPool, eng)

	entity, key := "menu_item", "item-"+randHex(4)
	good1 := mintSet(t, eng, entity, key, "name", []byte("ok"), 1)
	bad := corrupt(t, eng, func(r *substrate.Record) { r.Op.Field = "" })
	good2 := mintSet(t, eng, entity, key, "price_cents", []byte("100"), 3)

	if _, err := store.Append(ctx, scope, []substrate.Record{good1, bad, good2}); err == nil {
		t.Fatal("Append with one bad record: want error, got nil")
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
	orgID := seedOrg(t, testPool)
	store := opstore.New(testPool, openEngine(t, orgID))

	inserted, err := store.Append(ctx, db.Scope{OrgID: orgID}, nil)
	if err != nil {
		t.Fatalf("Append(empty): want nil error, got %v", err)
	}
	if inserted != 0 {
		t.Fatalf("Append(empty): inserted = %d, want 0", inserted)
	}
}

func TestIntegrationAppend_EmptyOrgScope(t *testing.T) {
	ctx := context.Background()
	orgID := seedOrg(t, testPool)
	eng := openEngine(t, orgID)
	store := opstore.New(testPool, eng)

	rec := mintSet(t, eng, "menu_item", "item-x", "name", []byte("x"), 1)
	_, err := store.Append(ctx, db.Scope{}, []substrate.Record{rec})
	if !errors.Is(err, opstore.ErrEmptyOrgScope) {
		t.Fatalf("Append(empty org scope): want ErrEmptyOrgScope, got %v", err)
	}
}
