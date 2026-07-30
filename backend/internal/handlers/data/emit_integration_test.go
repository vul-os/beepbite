package data_test

// emit_integration_test.go — the generic REST layer actually emits.
//
// This is the claim the emit layer rests on: this backend has ONE write
// chokepoint, and it is this handler's insert/update/delete. Everything else in
// internal/sync proves the algebra; this proves that a real HTTP write against a
// real migrated Postgres produces the operations the ownership registry says it
// should — and that a handler with no emitter behaves exactly as it did before.
//
// Run:
//
//	cd backend && go test ./internal/handlers/data/ -run Integration -v

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/data"
	"github.com/beepbite/backend/internal/nodeid"
	"github.com/beepbite/backend/internal/sync/emit"
	"github.com/beepbite/backend/internal/sync/opsink"
	"github.com/beepbite/backend/internal/sync/opstore"
	"github.com/beepbite/backend/internal/sync/ownership"
	"github.com/beepbite/backend/internal/sync/substrate"
)

var (
	testPool       *pgxpool.Pool
	engineCacheDir string
)

func TestMain(m *testing.M) {
	pool, cleanup := testenv.MustStartPostgres(context.Background())
	defer cleanup()
	testPool = pool

	dir, err := os.MkdirTemp("", "data-engine-cache")
	if err != nil {
		log.Fatal(err)
	}
	engineCacheDir = dir
	defer os.RemoveAll(dir)

	os.Exit(m.Run())
}

func randHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func seedOrg(t *testing.T) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
			"Data Emit Org "+randHex(4)).Scan(&id)
	}); err != nil {
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

// seedLocation inserts a branch inside orgID. categories, items and most of the
// menu are location-scoped even though they are group-OWNED — see
// internal/sync/ownership/tables.go on why where a row lives does not decide who
// writes it.
func seedLocation(t *testing.T, orgID string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO locations (organization_id, name, slug) VALUES ($1,$2,$3) RETURNING id`,
			orgID, "Branch", "branch-"+randHex(4)).Scan(&id)
	}); err != nil {
		t.Fatalf("seed location: %v", err)
	}
	return id
}

// mount builds the handler under test. withSync=false is the shape every
// install that never enrols a peer runs.
func mount(t *testing.T, orgID string, withSync bool) (http.Handler, db.Scope) {
	t.Helper()
	h := data.NewHandler(testPool)
	if withSync {
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
		// The branch this node writes for. Any branch-owned table would be
		// refused without it; the tables exercised below are group-owned, and
		// TestIntegrationEmit_BranchGuard covers the other case.
		em, err := emit.New(opsink.New(eng, opstore.New(testPool, eng)), orgID)
		if err != nil {
			t.Fatal(err)
		}
		h = h.WithEmitter(em)
	}
	r := chi.NewRouter()
	h.Mount(r)

	scope := db.ServiceRoleScope()
	scope.OrgID = orgID
	return r, scope
}

func do(t *testing.T, h http.Handler, scope db.Scope, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, target, &buf)
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(db.ContextWithScope(req.Context(), scope))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

type storedOp struct {
	entity, key, field string
	kind               int16
}

func storedOps(t *testing.T, orgID string) []storedOp {
	t.Helper()
	ctx := context.Background()
	var out []storedOp
	if err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT entity, key, field, kind FROM sync_ops WHERE organization_id = $1
			 ORDER BY ts_wall, ts_counter, entity, key, field`, orgID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var o storedOp
			if err := rows.Scan(&o.entity, &o.key, &o.field, &o.kind); err != nil {
				return err
			}
			out = append(out, o)
		}
		return rows.Err()
	}); err != nil {
		t.Fatalf("read sync_ops: %v", err)
	}
	return out
}

func fieldsOf(ops []storedOp) []string {
	out := make([]string, 0, len(ops))
	for _, o := range ops {
		out = append(out, o.field)
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------

// TestIntegrationEmit_InsertProducesOnePerColumn: a POST through the generic
// layer becomes one §4.4 register write per emitted column of the returned row.
func TestIntegrationEmit_InsertProducesOnePerColumn(t *testing.T) {
	orgID := seedOrg(t)
	h, scope := mount(t, orgID, true)

	res := do(t, h, scope, http.MethodPost, "/data/categories", map[string]any{
		"name": "Grill", "sort_order": 1, "organization_id": orgID, "location_id": seedLocation(t, orgID),
	})
	if res.Code != http.StatusCreated {
		t.Fatalf("POST returned %d: %s", res.Code, res.Body.String())
	}

	ops := storedOps(t, orgID)
	if len(ops) == 0 {
		t.Fatal("a row was written through the generic REST layer and produced no operations — " +
			"this is the whole claim of the emit layer")
	}
	tbl, _ := ownership.Lookup("categories")
	for _, o := range ops {
		if o.entity != "categories" {
			t.Errorf("op on %s", o.entity)
		}
		if o.field == "" {
			t.Errorf("a group-owned row produced an op with no field; it should be a register write")
		}
		if !tbl.Emits(o.field) {
			t.Errorf("column %q is suppressed by the ownership registry and was emitted anyway", o.field)
		}
	}
	got := fieldsOf(ops)
	for _, want := range []string{"id", "name", "sort_order"} {
		if !contains(got, want) {
			t.Errorf("no register write for %q; emitted %v", want, got)
		}
	}
}

// TestIntegrationEmit_UpdateOnlyAssertsWhatItTouched is the subtle one. A PATCH
// that sets one column returns the whole row; republishing all of it would
// stamp forty registers with a fresh timestamp and silently outrank another
// branch's concurrent edit to a column this write never touched.
func TestIntegrationEmit_UpdateOnlyAssertsWhatItTouched(t *testing.T) {
	orgID := seedOrg(t)
	h, scope := mount(t, orgID, true)

	res := do(t, h, scope, http.MethodPost, "/data/categories", map[string]any{
		"name": "Grill", "sort_order": 1, "organization_id": orgID, "location_id": seedLocation(t, orgID),
	})
	if res.Code != http.StatusCreated {
		t.Fatalf("POST returned %d: %s", res.Code, res.Body.String())
	}
	var created []map[string]any
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	id, _ := created[0]["id"].(string)
	if id == "" {
		t.Fatalf("no id in %v", created[0])
	}
	insertedOps := len(storedOps(t, orgID))

	res = do(t, h, scope, http.MethodPatch, "/data/categories?eq=id,"+id, map[string]any{
		"name": "Grill & Braai",
	})
	if res.Code != http.StatusOK {
		t.Fatalf("PATCH returned %d: %s", res.Code, res.Body.String())
	}

	all := storedOps(t, orgID)
	update := all[insertedOps:]
	if len(update) != 2 {
		t.Fatalf("a one-column PATCH emitted %d operations (%v); want the key and the one "+
			"column it named", len(update), fieldsOf(update))
	}
	if got := fieldsOf(update); !equalStrings(got, []string{"id", "name"}) {
		t.Fatalf("PATCH emitted %v, want [id name]", got)
	}
}

func TestIntegrationEmit_DeleteEmitsATombstone(t *testing.T) {
	orgID := seedOrg(t)
	h, scope := mount(t, orgID, true)

	res := do(t, h, scope, http.MethodPost, "/data/categories", map[string]any{
		"name": "Temp", "organization_id": orgID, "location_id": seedLocation(t, orgID),
	})
	if res.Code != http.StatusCreated {
		t.Fatalf("POST returned %d: %s", res.Code, res.Body.String())
	}
	var created []map[string]any
	_ = json.Unmarshal(res.Body.Bytes(), &created)
	id, _ := created[0]["id"].(string)
	before := len(storedOps(t, orgID))

	res = do(t, h, scope, http.MethodDelete, "/data/categories?eq=id,"+id, nil)
	if res.Code != http.StatusOK && res.Code != http.StatusNoContent {
		t.Fatalf("DELETE returned %d: %s", res.Code, res.Body.String())
	}

	all := storedOps(t, orgID)
	del := all[before:]
	if len(del) != 1 {
		t.Fatalf("DELETE emitted %d operations (%v), want one tombstone", len(del), fieldsOf(del))
	}
	if del[0].field != ownership.DeletedField {
		t.Fatalf("DELETE emitted field %q, want %q", del[0].field, ownership.DeletedField)
	}
	if del[0].key != id {
		t.Fatalf("tombstone addressed %q, want the deleted row's id", del[0].key)
	}
}

// TestIntegrationEmit_SuppressedColumnsNeverReachTheLog. items.current_stock is
// a stored counter whose truth is SUM over stock_movements. A write that sets it
// must not publish it.
func TestIntegrationEmit_SuppressedColumnsNeverReachTheLog(t *testing.T) {
	orgID := seedOrg(t)
	h, scope := mount(t, orgID, true)

	locID := seedLocation(t, orgID)
	catRes := do(t, h, scope, http.MethodPost, "/data/categories", map[string]any{
		"name": "Grill", "organization_id": orgID, "location_id": locID,
	})
	if catRes.Code != http.StatusCreated {
		t.Fatalf("seeding a category returned %d: %s", catRes.Code, catRes.Body.String())
	}
	var cats []map[string]any
	if err := json.Unmarshal(catRes.Body.Bytes(), &cats); err != nil {
		t.Fatal(err)
	}
	catID, _ := cats[0]["id"].(string)

	res := do(t, h, scope, http.MethodPost, "/data/items", map[string]any{
		"location_id": locID, "category_id": catID, "name": "Ribeye",
		"price": 249.5, "current_stock": 7,
	})
	if res.Code != http.StatusCreated {
		t.Fatalf("POST returned %d: %s", res.Code, res.Body.String())
	}

	for _, o := range storedOps(t, orgID) {
		if o.entity == "items" && o.field == "current_stock" {
			t.Fatal("items.current_stock reached the operation log. It is the cache of SUM over " +
				"stock_movements; replicating it as a register is the clobbering the ledger " +
				"exists to prevent.")
		}
	}
}

// TestIntegrationEmit_BranchGuardRefusesAnotherBranchesRow: the single-writer
// claim, enforced at the HTTP boundary. The write is refused as a whole — the
// row does not land either, because a database that has drifted from its log is
// the failure the transactional emit exists to avoid.
func TestIntegrationEmit_BranchGuardRefusesAnotherBranchesRow(t *testing.T) {
	orgID := seedOrg(t)
	h, scope := mount(t, orgID, true) // this node's branch is orgID, not any location

	ctx := context.Background()
	locID := seedLocation(t, orgID)

	orderNo := "ORD-" + randHex(3)
	res := do(t, h, scope, http.MethodPost, "/data/orders", map[string]any{
		"location_id": locID, "order_number": orderNo, "organization_id": orgID,
		"status": "pending", "total_cents": 1000,
	})
	if res.Code == http.StatusCreated {
		t.Fatal("a node that is not this order's branch was allowed to write it; the " +
			"single-writer claim is what makes order sequencing conflict-free")
	}

	var n int
	if err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM orders WHERE order_number = $1`, orderNo).Scan(&n)
	}); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("the order row was committed even though its operation was refused")
	}
}

// TestIntegrationEmit_WithoutAnEmitterNothingChanges. Every install that never
// enrols a peer runs this shape, and it must behave exactly as it did before the
// emit layer existed.
func TestIntegrationEmit_WithoutAnEmitterNothingChanges(t *testing.T) {
	orgID := seedOrg(t)
	h, scope := mount(t, orgID, false)

	res := do(t, h, scope, http.MethodPost, "/data/categories", map[string]any{
		"name": "Grill", "organization_id": orgID, "location_id": seedLocation(t, orgID),
	})
	if res.Code != http.StatusCreated {
		t.Fatalf("POST returned %d: %s", res.Code, res.Body.String())
	}
	if ops := storedOps(t, orgID); len(ops) != 0 {
		t.Fatalf("a handler with no emitter wrote %d operations", len(ops))
	}

	var n int
	ctx := context.Background()
	if err := db.Scoped(ctx, testPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM categories WHERE organization_id = $1`, orgID).Scan(&n)
	}); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("the row did not land (%d rows)", n)
	}
}

// ---------------------------------------------------------------------------

func contains(hay []string, needle string) bool {
	for _, s := range hay {
		if s == needle {
			return true
		}
	}
	return false
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
