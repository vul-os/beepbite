package peers_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/sync/peers"
)

var testPool *pgxpool.Pool

// The repo convention: DB-backed tests skip cleanly when there is no database,
// so `go test ./...` is runnable on a laptop without Docker.
func TestMain(m *testing.M) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		fmt.Println("peers: TEST_DATABASE_URL not set — skipping DB-backed tests")
		os.Exit(0)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		fmt.Printf("peers: cannot connect: %v\n", err)
		os.Exit(1)
	}
	// See the note in handlers/tables: connecting to TEST_DATABASE_URL does
	// not mean the schema is there, and package test binaries run
	// concurrently, so nothing guarantees another package migrated first.
	if err := testenv.ApplyMigrations(context.Background(), pool); err != nil {
		fmt.Printf("peers: apply migrations: %v\n", err)
		os.Exit(1)
	}
	testPool = pool
	code := m.Run()
	pool.Close()
	os.Exit(code)
}

// newOrg creates an organisation and returns a tenant scope for it, so every
// test runs under RLS exactly as a request would.
func newOrg(t *testing.T) db.Scope {
	t.Helper()
	ctx := context.Background()
	var id string
	err := testPool.QueryRow(ctx,
		`INSERT INTO organizations (name) VALUES ($1) RETURNING id::text`,
		"peers-test-"+time.Now().Format("150405.000000")).Scan(&id)
	if err != nil {
		t.Fatalf("create org: %v", err)
	}
	t.Cleanup(func() {
		_, _ = testPool.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, id)
	})
	return db.Scope{OrgID: id}
}

func keyA() []byte { return []byte("0123456789abcdef0123456789abcdef") }
func keyB() []byte { return []byte("ffffffffffffffffffffffffffffffff") }

func TestEnrol_ThenLookup(t *testing.T) {
	ctx, scope := context.Background(), newOrg(t)
	st := peers.New(testPool)

	p, err := st.Enrol(ctx, scope, peers.NewPeer{Name: "Harbour", URL: "https://b.example", NodeID: "node-b", PublicKey: keyA()})
	if err != nil {
		t.Fatalf("Enrol: %v", err)
	}
	if p.NodeID != "node-b" || string(p.PublicKey) != string(keyA()) {
		t.Fatalf("enrolled peer wrong: %+v", p)
	}

	got, err := st.ByNodeID(ctx, scope, "node-b")
	if err != nil {
		t.Fatalf("ByNodeID: %v", err)
	}
	if string(got.PublicKey) != string(keyA()) {
		t.Fatal("looked-up key differs from the enrolled one")
	}
}

func TestEnrol_SameKeyIsIdempotentAndRefreshesLabels(t *testing.T) {
	ctx, scope := context.Background(), newOrg(t)
	st := peers.New(testPool)

	if _, err := st.Enrol(ctx, scope, peers.NewPeer{Name: "old", URL: "https://old", NodeID: "n", PublicKey: keyA()}); err != nil {
		t.Fatal(err)
	}
	p, err := st.Enrol(ctx, scope, peers.NewPeer{Name: "new", URL: "https://new", NodeID: "n", PublicKey: keyA()})
	if err != nil {
		t.Fatalf("re-enrol with the same key must succeed: %v", err)
	}
	if p.Name != "new" || p.URL != "https://new" {
		t.Fatalf("labels not refreshed: %+v", p)
	}

	list, err := st.List(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("re-enrolling created a second row: %d peers", len(list))
	}
}

// The most important test in the package. A pinned key that can be replaced by
// presenting a new one is not pinned, and TOFU's entire value is that the
// second connection is checked against the first.
func TestEnrol_DifferentKeyIsRefusedAndChangesNothing(t *testing.T) {
	ctx, scope := context.Background(), newOrg(t)
	st := peers.New(testPool)

	if _, err := st.Enrol(ctx, scope, peers.NewPeer{Name: "Harbour", URL: "https://b", NodeID: "n", PublicKey: keyA()}); err != nil {
		t.Fatal(err)
	}

	_, err := st.Enrol(ctx, scope, peers.NewPeer{Name: "Harbour", URL: "https://b", NodeID: "n", PublicKey: keyB()})
	if !errors.Is(err, peers.ErrKeyChanged) {
		t.Fatalf("want ErrKeyChanged, got %v", err)
	}

	got, err := st.ByNodeID(ctx, scope, "n")
	if err != nil {
		t.Fatal(err)
	}
	if string(got.PublicKey) != string(keyA()) {
		t.Fatal("the stored key was replaced despite the refusal — the pin is not a pin")
	}
}

func TestRevoke_HidesFromListAndFromAuthLookup(t *testing.T) {
	ctx, scope := context.Background(), newOrg(t)
	st := peers.New(testPool)

	if _, err := st.Enrol(ctx, scope, peers.NewPeer{Name: "x", URL: "u", NodeID: "n", PublicKey: keyA()}); err != nil {
		t.Fatal(err)
	}
	if err := st.Revoke(ctx, scope, "n"); err != nil {
		t.Fatalf("Revoke: %v", err)
	}

	list, _ := st.List(ctx, scope)
	if len(list) != 0 {
		t.Fatalf("revoked peer still listed: %+v", list)
	}
	if _, err := st.ByNodeID(ctx, scope, "n"); !errors.Is(err, peers.ErrNotFound) {
		t.Fatalf("a revoked peer must fail the auth lookup, got %v", err)
	}
}

// Re-pairing after revocation still honours the original pin: it is an
// explicit unrevoke, not a fresh trust decision.
func TestEnrol_AfterRevokeStillHonoursThePin(t *testing.T) {
	ctx, scope := context.Background(), newOrg(t)
	st := peers.New(testPool)

	_, _ = st.Enrol(ctx, scope, peers.NewPeer{Name: "x", URL: "u", NodeID: "n", PublicKey: keyA()})
	_ = st.Revoke(ctx, scope, "n")

	if _, err := st.Enrol(ctx, scope, peers.NewPeer{Name: "x", URL: "u", NodeID: "n", PublicKey: keyB()}); !errors.Is(err, peers.ErrKeyChanged) {
		t.Fatalf("revocation must not clear the pin, got %v", err)
	}
	if _, err := st.Enrol(ctx, scope, peers.NewPeer{Name: "x", URL: "u", NodeID: "n", PublicKey: keyA()}); err != nil {
		t.Fatalf("re-pairing with the original key should succeed: %v", err)
	}
	if _, err := st.ByNodeID(ctx, scope, "n"); err != nil {
		t.Fatalf("peer should be active again: %v", err)
	}
}

func TestPeers_CrossTenantIsolation(t *testing.T) {
	ctx := context.Background()
	a, b := newOrg(t), newOrg(t)
	st := peers.New(testPool)

	if _, err := st.Enrol(ctx, a, peers.NewPeer{Name: "a-peer", URL: "u", NodeID: "shared", PublicKey: keyA()}); err != nil {
		t.Fatal(err)
	}

	if list, _ := st.List(ctx, b); len(list) != 0 {
		t.Fatalf("org B sees org A's peers: %+v", list)
	}
	if _, err := st.ByNodeID(ctx, b, "shared"); !errors.Is(err, peers.ErrNotFound) {
		t.Fatalf("org B resolved org A's peer, got %v", err)
	}

	// The same node ID may be enrolled independently by another org with a
	// different key — they are different pairings.
	if _, err := st.Enrol(ctx, b, peers.NewPeer{Name: "b-peer", URL: "u", NodeID: "shared", PublicKey: keyB()}); err != nil {
		t.Fatalf("org B should be able to enrol the same node id: %v", err)
	}
	got, _ := st.ByNodeID(ctx, a, "shared")
	if string(got.PublicKey) != string(keyA()) {
		t.Fatal("org B's enrolment overwrote org A's pinned key")
	}
}

func TestStatusRecording(t *testing.T) {
	ctx, scope := context.Background(), newOrg(t)
	st := peers.New(testPool)
	_, _ = st.Enrol(ctx, scope, peers.NewPeer{Name: "x", URL: "u", NodeID: "n", PublicKey: keyA()})

	now := time.Now()
	if err := st.RecordPull(ctx, scope, "n", now); err != nil {
		t.Fatal(err)
	}
	if err := st.SetEngine(ctx, scope, "n", "beepbite-oplog-v1"); err != nil {
		t.Fatal(err)
	}
	p, _ := st.ByNodeID(ctx, scope, "n")
	if p.LastPullAt == nil {
		t.Fatal("pull time not recorded")
	}
	if p.Engine != "beepbite-oplog-v1" {
		t.Fatalf("engine not recorded: %q", p.Engine)
	}

	if err := st.RecordError(ctx, scope, "n", "connection refused"); err != nil {
		t.Fatal(err)
	}
	p, _ = st.ByNodeID(ctx, scope, "n")
	if p.LastError != "connection refused" {
		t.Fatalf("error not recorded: %q", p.LastError)
	}
}

func TestUnknownPeerErrors(t *testing.T) {
	ctx, scope := context.Background(), newOrg(t)
	st := peers.New(testPool)
	if _, err := st.ByNodeID(ctx, scope, "nope"); !errors.Is(err, peers.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if err := st.Revoke(ctx, scope, "nope"); !errors.Is(err, peers.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

// ─── Nonce cache ─────────────────────────────────────────────────────────────

func TestNonces_ReplayDetected(t *testing.T) {
	ctx := context.Background()
	n := peers.NewNonceStore(testPool)
	peer := "node-" + time.Now().Format("150405.000000")

	first, err := n.RememberOnce(ctx, peer, "nonce-1", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !first {
		t.Fatal("first use of a nonce was reported as already seen")
	}

	second, err := n.RememberOnce(ctx, peer, "nonce-1", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if second {
		t.Fatal("a replayed nonce was accepted as new — the check is not atomic")
	}

	seen, err := n.Seen(ctx, peer, "nonce-1")
	if err != nil || !seen {
		t.Fatalf("Seen should report the spent nonce: seen=%v err=%v", seen, err)
	}
}

func TestNonces_ScopedPerPeer(t *testing.T) {
	ctx := context.Background()
	n := peers.NewNonceStore(testPool)
	stamp := time.Now().Format("150405.000000")

	if _, err := n.RememberOnce(ctx, "peer-a-"+stamp, "shared", time.Now()); err != nil {
		t.Fatal(err)
	}
	fresh, err := n.RememberOnce(ctx, "peer-b-"+stamp, "shared", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !fresh {
		t.Fatal("one peer's nonce blocked another peer's")
	}
}

func TestNonces_SweepDropsOnlyOldRows(t *testing.T) {
	ctx := context.Background()
	n := peers.NewNonceStore(testPool)
	peer := "sweep-" + time.Now().Format("150405.000000")

	old := time.Now().Add(-2 * time.Hour)
	if _, err := n.RememberOnce(ctx, peer, "old", old); err != nil {
		t.Fatal(err)
	}
	if _, err := n.RememberOnce(ctx, peer, "new", time.Now()); err != nil {
		t.Fatal(err)
	}

	if _, err := n.Sweep(ctx, time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	if seen, _ := n.Seen(ctx, peer, "old"); seen {
		t.Fatal("sweep left a stale nonce behind")
	}
	if seen, _ := n.Seen(ctx, peer, "new"); !seen {
		t.Fatal("sweep deleted a nonce still inside its window")
	}
}
