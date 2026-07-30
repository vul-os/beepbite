package opsink_test

// opsink_test.go — the emit path against a real migrated Postgres.
//
// converge_test.go proves the algebra converges. This proves the thing that has
// to be true before convergence means anything: that an operation and the row
// it describes are one write. A log that is usually in step with its database
// is not a log.
//
// Run:
//
//	cd backend && go test ./internal/sync/opsink/ -v

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
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
	"github.com/beepbite/backend/internal/sync/emit"
	"github.com/beepbite/backend/internal/sync/opsink"
	"github.com/beepbite/backend/internal/sync/opstore"
	"github.com/beepbite/backend/internal/sync/ownership"
	"github.com/beepbite/backend/internal/sync/substrate"
)

var (
	testPool *pgxpool.Pool

	// engineCacheDir persists wazero's compiled machine code across every
	// substrate.Open in this package. These tests open a replica per branch per
	// test; the cache turns a few hundred milliseconds into single digits after
	// the first.
	engineCacheDir string
)

func TestMain(m *testing.M) {
	pool, cleanup := testenv.MustStartPostgres(context.Background())
	defer cleanup()
	testPool = pool

	dir, err := os.MkdirTemp("", "opsink-engine-cache")
	if err != nil {
		log.Fatal("engine cache dir:", err)
	}
	engineCacheDir = dir
	defer os.RemoveAll(engineCacheDir)

	os.Exit(m.Run())
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// seedOrg inserts a fresh organization and registers its cleanup. sync_ops
// cascades on delete, so removing the org removes every op a test wrote.
func seedOrg(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	var id string
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			"Opsink Test Org "+randHex(4)).Scan(&id)
	})
	if err != nil {
		t.Fatalf("seed org: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Scoped(context.Background(), testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, id)
			return err
		})
	})
	return id
}

// newEmitter wires an Emitter over a real engine and a real store, namespaced
// to orgID — which is what internal/sync/substrate uses as the §7 namespace.
func newEmitter(t *testing.T, orgID, branch string) (*emit.Emitter, *substrate.Engine) {
	t.Helper()
	id, err := nodeid.LoadOrCreate(filepath.Join(t.TempDir(), "node.json"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	eng, err := substrate.Open(ctx, substrate.Options{Identity: id, NS: orgID, CacheDir: engineCacheDir})
	if err != nil {
		t.Fatalf("substrate.Open: %v", err)
	}
	t.Cleanup(func() { _ = eng.Close(ctx) })

	em, err := emit.New(opsink.New(eng, opstore.New(testPool, eng)), branch)
	if err != nil {
		t.Fatalf("emit.New: %v", err)
	}
	return em, eng
}

func countOps(t *testing.T, orgID string) int {
	t.Helper()
	ctx := context.Background()
	var n int
	err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM sync_ops WHERE organization_id = $1`, orgID).Scan(&n)
	})
	if err != nil {
		t.Fatalf("count ops: %v", err)
	}
	return n
}

func scopeFor(orgID string) db.Scope {
	s := db.ServiceRoleScope()
	s.OrgID = orgID
	return s
}

// ---------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------

// TestIntegrationRowAndOperationCommitTogether. The operation is written
// through the caller's own transaction, so a write that lands has an operation
// and a write that does not, does not.
func TestIntegrationRowAndOperationCommitTogether(t *testing.T) {
	orgID := seedOrg(t)
	em, eng := newEmitter(t, orgID, branchA)
	ctx := context.Background()

	var locID string
	err := em.Scoped(ctx, testPool, scopeFor(orgID), func(tx pgx.Tx, rec *emit.Recorder) error {
		if err := tx.QueryRow(ctx,
			`INSERT INTO locations (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
			orgID, "Test Branch", "test-branch-"+randHex(4)).Scan(&locID); err != nil {
			return err
		}
		rec.Record(emit.Change{
			Table: "locations",
			Kind:  emit.Insert,
			Row:   map[string]any{"id": locID, "name": "Test Branch", "organization_id": orgID},
		})
		return nil
	})
	if err != nil {
		t.Fatalf("Scoped: %v", err)
	}

	if got := countOps(t, orgID); got != 3 {
		t.Fatalf("sync_ops holds %d rows, want one register write per emitted column (3)", got)
	}

	// Settle ran: the replica this node serves from holds what its log holds.
	if v, ok, err := eng.Get("locations", locID, "name"); err != nil || !ok {
		t.Fatalf("the replica does not hold the operation it just committed: ok=%v err=%v", ok, err)
	} else if s, _ := emit.DecodeText(v); s != "Test Branch" {
		t.Fatalf("replica holds %q", s)
	}
}

// TestIntegrationARolledBackWriteLeavesNoOperation is the other half, and the
// one that would be silently wrong under a design that appended in its own
// transaction: a row that never existed must not have an operation telling
// every other branch that it did.
func TestIntegrationARolledBackWriteLeavesNoOperation(t *testing.T) {
	orgID := seedOrg(t)
	em, eng := newEmitter(t, orgID, branchA)
	ctx := context.Background()

	boom := errors.New("the handler failed after the insert")
	err := em.Scoped(ctx, testPool, scopeFor(orgID), func(tx pgx.Tx, rec *emit.Recorder) error {
		var locID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO locations (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
			orgID, "Doomed", "doomed-"+randHex(4)).Scan(&locID); err != nil {
			return err
		}
		rec.Record(emit.Change{
			Table: "locations",
			Kind:  emit.Insert,
			Row:   map[string]any{"id": locID, "name": "Doomed"},
		})
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the handler's own failure", err)
	}

	if got := countOps(t, orgID); got != 0 {
		t.Fatalf("sync_ops holds %d rows after a rolled-back write", got)
	}

	// And the replica is untouched. This is what substrate.Engine.Prepare's
	// split from Admit buys: a minted operation whose transaction rolled back
	// must not be sitting in this node's in-memory state, advertising a version
	// vector no peer could ever be served from.
	root, err := eng.StateRoot()
	if err != nil {
		t.Fatal(err)
	}
	empty, err := substrate.Open(ctx, substrate.Options{
		Identity: mustIdentity(t), NS: orgID, CacheDir: engineCacheDir,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = empty.Close(ctx) }()
	emptyRoot, err := empty.StateRoot()
	if err != nil {
		t.Fatal(err)
	}
	if root != emptyRoot {
		t.Fatalf("the replica moved on a rolled-back write: %s vs an empty replica's %s", root, emptyRoot)
	}
}

// TestIntegrationARefusedChangeAbortsTheWrite. Emission failing is not a
// warning. If a row cannot be replicated — an unclassified table, a ledger
// edited in place, another branch's order — the write it belongs to does not
// happen either, because a database that has drifted from its log silently is
// the failure this whole layer exists to avoid.
func TestIntegrationARefusedChangeAbortsTheWrite(t *testing.T) {
	orgID := seedOrg(t)
	em, _ := newEmitter(t, orgID, branchA)
	ctx := context.Background()

	slug := "aborted-" + randHex(4)
	err := em.Scoped(ctx, testPool, scopeFor(orgID), func(tx pgx.Tx, rec *emit.Recorder) error {
		var locID string
		if err := tx.QueryRow(ctx,
			`INSERT INTO locations (organization_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
			orgID, "Aborted", slug).Scan(&locID); err != nil {
			return err
		}
		// A ledger row edited in place: refused, loudly.
		rec.Record(emit.Change{
			Table: "stock_movements",
			Kind:  emit.Update,
			Row:   map[string]any{"id": "mv-1", "inventory_item_id": "ing-1"},
		})
		return nil
	})
	if !errors.Is(err, emit.ErrLedgerMutated) {
		t.Fatalf("err = %v, want ErrLedgerMutated", err)
	}

	var n int
	if qerr := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM locations WHERE slug = $1`, slug).Scan(&n)
	}); qerr != nil {
		t.Fatal(qerr)
	}
	if n != 0 {
		t.Fatal("the row was committed even though its operation was refused")
	}
	if got := countOps(t, orgID); got != 0 {
		t.Fatalf("sync_ops holds %d rows", got)
	}
}

// TestIntegrationLedgerRowsLandAsAddsAddressedByTheirGroup checks that what
// reaches Postgres is what the ownership registry says it should be: the §4.2
// kind, and the entity/key split migration 004 stores as separate columns.
func TestIntegrationLedgerRowsLandAsAddsAddressedByTheirGroup(t *testing.T) {
	orgID := seedOrg(t)
	em, eng := newEmitter(t, orgID, branchA)
	ctx := context.Background()

	err := em.Scoped(ctx, testPool, scopeFor(orgID), func(tx pgx.Tx, rec *emit.Recorder) error {
		rec.Record(emit.Change{
			Table: "stock_movements",
			Kind:  emit.Insert,
			Row: map[string]any{
				"id": "mv-1", "inventory_item_id": "ing-steak",
				"movement_type": "sale", "quantity": num(-1, 0),
			},
		})
		return nil
	})
	if err != nil {
		t.Fatalf("Scoped: %v", err)
	}

	var entity, key, field string
	var kind int16
	if qerr := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT entity, key, field, kind FROM sync_ops WHERE organization_id = $1`, orgID).
			Scan(&entity, &key, &field, &kind)
	}); qerr != nil {
		t.Fatal(qerr)
	}
	if entity != "stock_movements" || key != "ing-steak" || field != "" {
		t.Fatalf("stored as %s/%s field=%q, want stock_movements/ing-steak with no field",
			entity, key, field)
	}
	wantKind, err := eng.DBKind(1) // oplog.KindSet == 1; the collision migration 004 warns about
	if err != nil {
		t.Fatal(err)
	}
	if kind == wantKind {
		t.Fatalf("a ledger member was stored under the last-writer-wins kind (%d)", kind)
	}
}

// TestIntegrationTheSameChangeTwiceIsOneRowAndTwoFacts.
//
// Two ledger inserts of genuinely the same fact are two facts and must both be
// stored. The same OPERATION offered twice — a retry, a replayed batch — is one
// row, because sync_ops.id is the content address. Both properties at once,
// because getting one right by breaking the other is the trap migration 004
// exists for.
func TestIntegrationTheSameChangeTwiceIsOneRowAndTwoFacts(t *testing.T) {
	orgID := seedOrg(t)
	em, eng := newEmitter(t, orgID, branchA)
	ctx := context.Background()

	movement := emit.Change{
		Table: "stock_movements",
		Kind:  emit.Insert,
		Row: map[string]any{
			"id": "mv-same", "inventory_item_id": "ing-steak",
			"movement_type": "sale", "quantity": num(-1, 0),
		},
	}
	for i := 0; i < 2; i++ {
		if err := em.Scoped(ctx, testPool, scopeFor(orgID), func(tx pgx.Tx, rec *emit.Recorder) error {
			rec.Record(movement)
			return nil
		}); err != nil {
			t.Fatalf("emit %d: %v", i, err)
		}
	}
	// Two facts: each emit minted a fresh stamp, so these are two operations.
	if got := countOps(t, orgID); got != 2 {
		t.Fatalf("sync_ops holds %d rows, want 2 — two recorded movements are two facts even "+
			"when every column matches", got)
	}
	members, err := eng.Members("stock_movements", "ing-steak")
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 {
		t.Fatalf("the ledger holds %d members, want 2", len(members))
	}

	// And the same operation re-offered is one row. Prepare it once, append it
	// twice, and the content address is what makes the second a no-op.
	store := opstore.New(testPool, eng)
	rec, err := eng.Prepare(mustPlanOne(t, movement), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	before := countOps(t, orgID)
	for i := 0; i < 2; i++ {
		if err := db.Scoped(ctx, testPool, scopeFor(orgID), func(tx pgx.Tx) error {
			_, aerr := store.AppendTx(ctx, tx, orgID, []substrate.Record{rec})
			return aerr
		}); err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
	}
	if got := countOps(t, orgID); got != before+1 {
		t.Fatalf("appending one operation twice wrote %d rows", got-before)
	}
}

// TestIntegrationANilEmitterStillRunsTheTransaction. A deployment with no sync
// configured holds a nil *Emitter, and every write path has to behave exactly as
// it did before this layer existed.
func TestIntegrationANilEmitterStillRunsTheTransaction(t *testing.T) {
	orgID := seedOrg(t)
	ctx := context.Background()
	var nilEmitter *emit.Emitter

	slug := "nil-emitter-" + randHex(4)
	err := nilEmitter.Scoped(ctx, testPool, scopeFor(orgID), func(tx pgx.Tx, rec *emit.Recorder) error {
		_, xerr := tx.Exec(ctx,
			`INSERT INTO locations (organization_id, name, slug) VALUES ($1, $2, $3)`,
			orgID, "No Sync Here", slug)
		// Recording against a nil Recorder must be safe: a store converted to
		// this seam does not know whether the deployment it is running in has
		// sync switched on.
		rec.Record(emit.Change{Table: "locations", Kind: emit.Insert, Row: map[string]any{"id": "x"}})
		return xerr
	})
	if err != nil {
		t.Fatalf("Scoped with a nil emitter: %v", err)
	}
	var n int
	if qerr := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM locations WHERE slug = $1`, slug).Scan(&n)
	}); qerr != nil {
		t.Fatal(qerr)
	}
	if n != 1 {
		t.Fatalf("the write did not happen (%d rows)", n)
	}
	if got := countOps(t, orgID); got != 0 {
		t.Fatalf("a nil emitter wrote %d operations", got)
	}
}

// TestIntegrationOpsAreScopedToTheirOrganization. The registry decides WHAT
// replicates; RLS decides WHO can see it, and the two have to hold together.
func TestIntegrationOpsAreScopedToTheirOrganization(t *testing.T) {
	orgA := seedOrg(t)
	orgB := seedOrg(t)
	em, _ := newEmitter(t, orgA, branchA)
	ctx := context.Background()

	if err := em.Scoped(ctx, testPool, scopeFor(orgA), func(tx pgx.Tx, rec *emit.Recorder) error {
		rec.Record(emit.Change{
			Table: "categories", Kind: emit.Insert,
			Row: map[string]any{"id": "cat-1", "name": "Grill"},
		})
		return nil
	}); err != nil {
		t.Fatalf("Scoped: %v", err)
	}

	if got := countOps(t, orgA); got == 0 {
		t.Fatal("org A's operations were not written")
	}
	if got := countOps(t, orgB); got != 0 {
		t.Fatalf("org B holds %d of org A's operations", got)
	}
}

// ---------------------------------------------------------------------------
// The tombstone, through the whole stack
// ---------------------------------------------------------------------------

func TestIntegrationDeleteStoresATombstoneRegister(t *testing.T) {
	orgID := seedOrg(t)
	em, _ := newEmitter(t, orgID, branchA)
	ctx := context.Background()

	if err := em.Scoped(ctx, testPool, scopeFor(orgID), func(tx pgx.Tx, rec *emit.Recorder) error {
		rec.Record(emit.Change{
			Table: "categories", Kind: emit.Delete,
			Row: map[string]any{"id": "cat-1"},
		})
		return nil
	}); err != nil {
		t.Fatalf("Scoped: %v", err)
	}

	var field string
	if qerr := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT field FROM sync_ops WHERE organization_id = $1 AND entity = 'categories'`, orgID).
			Scan(&field)
	}); qerr != nil {
		t.Fatal(qerr)
	}
	if field != ownership.DeletedField {
		t.Fatalf("delete stored field %q, want %q", field, ownership.DeletedField)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func mustIdentity(t *testing.T) *nodeid.Identity {
	t.Helper()
	id, err := nodeid.LoadOrCreate(filepath.Join(t.TempDir(), "node.json"))
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func mustPlanOne(t *testing.T, c emit.Change) oplog.Op {
	t.Helper()
	ops, err := emit.Plan(c, emit.Options{Branch: branchA})
	if err != nil {
		t.Fatal(err)
	}
	if len(ops) != 1 {
		t.Fatalf("%s %s produced %d ops, want 1", c.Kind, c.Table, len(ops))
	}
	return ops[0]
}
