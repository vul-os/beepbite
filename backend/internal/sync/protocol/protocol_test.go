package protocol

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/nodeid"
	"github.com/beepbite/backend/internal/oplog"
)

func testIdentity(t *testing.T) *nodeid.Identity {
	t.Helper()
	id, err := nodeid.LoadOrCreate(filepath.Join(t.TempDir(), "node.json"))
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}
	return id
}

func baseEnvelope() Envelope {
	return Envelope{
		Engine:    Engine,
		Method:    "POST",
		Path:      "/api/sync/pull",
		Nonce:     "nonce-1",
		Timestamp: time.Now().UnixMilli(),
		NodeID:    "node-a",
		Org:       "org-1",
		Body:      []byte(`{"engine":"beepbite-oplog-v1"}`),
	}
}

// ─── Canonical encoding ──────────────────────────────────────────────────────

func TestCanonical_IsStable(t *testing.T) {
	e := baseEnvelope()
	if string(e.Canonical()) != string(e.Canonical()) {
		t.Fatal("Canonical is not deterministic")
	}
}

// The reason every field is length-prefixed: without it, moving a character
// across a field boundary produces identical bytes and therefore an identical
// signature, so a signature for one request would authenticate a different one.
func TestCanonical_FieldBoundaryShiftChangesEncoding(t *testing.T) {
	a := baseEnvelope()
	a.Path, a.Nonce = "/sync", "ab"

	b := baseEnvelope()
	b.Path, b.Nonce = "/syncab", ""

	if string(a.Canonical()) == string(b.Canonical()) {
		t.Fatal("two different envelopes share a canonical encoding — length prefixing is not working")
	}
}

func TestCanonical_BodyChangeChangesEncoding(t *testing.T) {
	a := baseEnvelope()
	b := baseEnvelope()
	b.Body = append(append([]byte{}, a.Body...), ' ')
	if string(a.Canonical()) == string(b.Canonical()) {
		t.Fatal("body is not covered by the canonical encoding")
	}
}

// ─── Signing ─────────────────────────────────────────────────────────────────

func TestSignVerify_RoundTrip(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	sig := Sign(id, e)
	if !Verify(id.Public, e, sig) {
		t.Fatal("a freshly signed envelope did not verify")
	}
}

func TestVerify_RejectsTampering(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	sig := Sign(id, e)

	for _, tc := range []struct {
		name   string
		mutate func(*Envelope)
	}{
		{"body", func(e *Envelope) { e.Body = []byte("different") }},
		{"nonce", func(e *Envelope) { e.Nonce = "nonce-2" }},
		{"path", func(e *Envelope) { e.Path = "/api/sync/push" }},
		{"method", func(e *Envelope) { e.Method = "GET" }},
		{"org", func(e *Envelope) { e.Org = "org-2" }},
		{"timestamp", func(e *Envelope) { e.Timestamp++ }},
		{"engine", func(e *Envelope) { e.Engine = "other" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad := e
			tc.mutate(&bad)
			if Verify(id.Public, bad, sig) {
				t.Fatalf("signature verified after %s was tampered with", tc.name)
			}
		})
	}
}

func TestVerify_RejectsWrongKey(t *testing.T) {
	a, b := testIdentity(t), testIdentity(t)
	e := baseEnvelope()
	if Verify(b.Public, e, Sign(a, e)) {
		t.Fatal("a signature verified against a different node's key")
	}
}

func TestVerify_RejectsGarbageSignature(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	for _, sig := range [][]byte{nil, {}, []byte("short"), make([]byte, 64)} {
		if Verify(id.Public, e, sig) {
			t.Fatalf("malformed signature %q verified", sig)
		}
	}
}

// ─── Freshness ───────────────────────────────────────────────────────────────

func TestCheckFreshness(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		name string
		ts   time.Time
		ok   bool
	}{
		{"now", now, true},
		{"just inside past", now.Add(-4 * time.Minute), true},
		{"just inside future", now.Add(4 * time.Minute), true},
		{"too old", now.Add(-6 * time.Minute), false},
		{"too far future", now.Add(6 * time.Minute), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := baseEnvelope()
			e.Timestamp = tc.ts.UnixMilli()
			err := CheckFreshness(e, now, DefaultSkew)
			if tc.ok && err != nil {
				t.Fatalf("expected fresh, got %v", err)
			}
			if !tc.ok && !errors.Is(err, ErrStaleTimestamp) {
				t.Fatalf("expected ErrStaleTimestamp, got %v", err)
			}
		})
	}
}

func TestCheckFreshness_ZeroTimestampIsStale(t *testing.T) {
	e := baseEnvelope()
	e.Timestamp = 0
	if !errors.Is(CheckFreshness(e, time.Now(), DefaultSkew), ErrStaleTimestamp) {
		t.Fatal("a missing timestamp must not be treated as fresh")
	}
}

// ─── Authenticate ────────────────────────────────────────────────────────────

// spyCache records whether the replay cache was consulted, so the ordering
// claim in Authenticate's doc comment is a test rather than a comment.
type spyCache struct {
	*MemCache
	seenCalls, rememberCalls int
}

func newSpy() *spyCache { return &spyCache{MemCache: NewMemCache(DefaultSkew)} }

func (c *spyCache) Seen(ctx context.Context, peer, nonce string) (bool, error) {
	c.seenCalls++
	return c.MemCache.Seen(ctx, peer, nonce)
}

func (c *spyCache) Remember(ctx context.Context, peer, nonce string, at time.Time) error {
	c.rememberCalls++
	return c.MemCache.Remember(ctx, peer, nonce, at)
}

func TestAuthenticate_HappyPath(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	cache := newSpy()
	if err := Authenticate(context.Background(), e, Sign(id, e), id.Public, cache, time.Now(), DefaultSkew); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	if cache.rememberCalls != 1 {
		t.Fatalf("nonce not remembered: %d calls", cache.rememberCalls)
	}
}

func TestAuthenticate_DetectsReplay(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	sig := Sign(id, e)
	cache := newSpy()
	ctx, now := context.Background(), time.Now()

	if err := Authenticate(ctx, e, sig, id.Public, cache, now, DefaultSkew); err != nil {
		t.Fatalf("first use rejected: %v", err)
	}
	if err := Authenticate(ctx, e, sig, id.Public, cache, now, DefaultSkew); !errors.Is(err, ErrReplayed) {
		t.Fatalf("second use of the same nonce: want ErrReplayed, got %v", err)
	}
}

func TestAuthenticate_EngineMismatchIsRefused(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	e.Engine = "someone-elses-crdt-v3"
	err := Authenticate(context.Background(), e, Sign(id, e), id.Public, newSpy(), time.Now(), DefaultSkew)
	if !errors.Is(err, ErrEngineMismatch) {
		t.Fatalf("want ErrEngineMismatch, got %v", err)
	}
}

// The order matters: an unauthenticated caller must not be able to make us
// write into the nonce store. If the cache is consulted before the signature is
// checked, garbage traffic becomes a free denial of service against it.
func TestAuthenticate_SignatureCheckedBeforeCache(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	cache := newSpy()

	err := Authenticate(context.Background(), e, []byte("not a signature"), id.Public, cache, time.Now(), DefaultSkew)
	if !errors.Is(err, ErrBadSignature) {
		t.Fatalf("want ErrBadSignature, got %v", err)
	}
	if cache.seenCalls != 0 || cache.rememberCalls != 0 {
		t.Fatalf("replay cache was touched for an unsigned request: seen=%d remember=%d",
			cache.seenCalls, cache.rememberCalls)
	}
}

func TestAuthenticate_StaleCheckedBeforeSignature(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	e.Timestamp = time.Now().Add(-time.Hour).UnixMilli()
	cache := newSpy()
	err := Authenticate(context.Background(), e, Sign(id, e), id.Public, cache, time.Now(), DefaultSkew)
	if !errors.Is(err, ErrStaleTimestamp) {
		t.Fatalf("want ErrStaleTimestamp, got %v", err)
	}
	if cache.seenCalls != 0 {
		t.Fatal("replay cache consulted for a stale request")
	}
}

func TestAuthenticate_EmptyNonceRefused(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	e.Nonce = ""
	if err := Authenticate(context.Background(), e, Sign(id, e), id.Public, newSpy(), time.Now(), DefaultSkew); !errors.Is(err, ErrMalformed) {
		t.Fatalf("want ErrMalformed for an empty nonce, got %v", err)
	}
}

// A cache that cannot be read must fail the request, not wave it through.
type brokenCache struct{}

func (brokenCache) Seen(context.Context, string, string) (bool, error) {
	return false, errors.New("cache unavailable")
}
func (brokenCache) Remember(context.Context, string, string, time.Time) error { return nil }

func TestAuthenticate_FailsClosedOnCacheError(t *testing.T) {
	id := testIdentity(t)
	e := baseEnvelope()
	err := Authenticate(context.Background(), e, Sign(id, e), id.Public, brokenCache{}, time.Now(), DefaultSkew)
	if err == nil {
		t.Fatal("an unreadable replay cache must fail the request, not be ignored")
	}
}

// ─── Wire ────────────────────────────────────────────────────────────────────

func goodOp() oplog.Op {
	return oplog.Op{
		ID:     "01J000000000000000000000",
		Kind:   oplog.KindSet,
		Entity: "menu_items",
		Key:    "k1",
		Field:  "name",
		Value:  []byte("Steak"),
		TS:     oplog.Timestamp{Wall: 1, Counter: 0, Node: "node-a"},
	}
}

func TestWire_RoundTrip(t *testing.T) {
	op := goodOp()
	sig := []byte("signature-bytes")
	back, gotSig, err := FromWire(ToWire(op, sig))
	if err != nil {
		t.Fatalf("FromWire: %v", err)
	}
	if back.ID != op.ID || back.Entity != op.Entity || back.Key != op.Key ||
		back.Field != op.Field || string(back.Value) != string(op.Value) ||
		back.TS != op.TS || back.Kind != op.Kind {
		t.Fatalf("round trip changed the op:\n got %+v\nwant %+v", back, op)
	}
	if string(gotSig) != string(sig) {
		t.Fatalf("signature not preserved: %q", gotSig)
	}
}

func TestFromWire_RejectsMalformed(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*WireOp)
	}{
		{"empty entity", func(w *WireOp) { w.Entity = "" }},
		{"oversized entity", func(w *WireOp) { w.Entity = strings.Repeat("x", MaxEntityLen+1) }},
		{"empty key", func(w *WireOp) { w.Key = "" }},
		{"oversized key", func(w *WireOp) { w.Key = strings.Repeat("x", MaxKeyLen+1) }},
		{"oversized field", func(w *WireOp) { w.Field = strings.Repeat("x", MaxFieldLen+1) }},
		{"empty node", func(w *WireOp) { w.Node = "" }},
		{"no id", func(w *WireOp) { w.ID = "" }},
		{"unknown kind", func(w *WireOp) { w.Kind = 7 }},
		{"value not base64", func(w *WireOp) { w.Value = "!!!!not base64!!!!" }},
		{"sig not base64", func(w *WireOp) { w.Signature = "!!!!" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := ToWire(goodOp(), nil)
			tc.mutate(&w)
			if _, _, err := FromWire(w); err == nil {
				t.Fatalf("%s was accepted", tc.name)
			}
		})
	}
}

// A peer must not be able to choose how much memory we allocate.
func TestFromWire_RejectsOversizedValueBeforeDecoding(t *testing.T) {
	w := ToWire(goodOp(), nil)
	w.Value = strings.Repeat("A", (MaxValueLen+1024)*4/3)
	if _, _, err := FromWire(w); !errors.Is(err, ErrMalformed) {
		t.Fatalf("oversized value: want ErrMalformed, got %v", err)
	}
}

func TestDecodeOps_RejectsOversizedBatch(t *testing.T) {
	ws := make([]WireOp, MaxOpsPerReq+1)
	for i := range ws {
		ws[i] = ToWire(goodOp(), nil)
	}
	if _, _, err := DecodeOps(ws); !errors.Is(err, ErrMalformed) {
		t.Fatalf("oversized batch: want ErrMalformed, got %v", err)
	}
}

func TestDecodeOps_ReportsWhichOpFailed(t *testing.T) {
	ws := []WireOp{ToWire(goodOp(), nil), ToWire(goodOp(), nil)}
	ws[1].Entity = ""
	_, _, err := DecodeOps(ws)
	if err == nil || !strings.Contains(err.Error(), "operation 1") {
		t.Fatalf("want an error naming operation 1, got %v", err)
	}
}

func TestCheckEngine(t *testing.T) {
	if err := CheckEngine(Engine); err != nil {
		t.Fatalf("own engine rejected: %v", err)
	}
	if !errors.Is(CheckEngine("other-engine"), ErrEngineMismatch) {
		t.Fatal("a foreign engine was accepted")
	}
}

// ─── MemCache ────────────────────────────────────────────────────────────────

func TestMemCache_ExpiredNonceIsForgotten(t *testing.T) {
	c := NewMemCache(10 * time.Millisecond)
	ctx := context.Background()
	if err := c.Remember(ctx, "peer", "n1", time.Now()); err != nil {
		t.Fatal(err)
	}
	seen, _ := c.Seen(ctx, "peer", "n1")
	if !seen {
		t.Fatal("nonce not remembered")
	}
	time.Sleep(20 * time.Millisecond)
	if seen, _ := c.Seen(ctx, "peer", "n1"); seen {
		t.Fatal("nonce outlived its window — it can no longer pass freshness anyway")
	}
}

func TestMemCache_NoncesAreScopedPerPeer(t *testing.T) {
	c := NewMemCache(DefaultSkew)
	ctx := context.Background()
	_ = c.Remember(ctx, "peer-a", "shared", time.Now())
	if seen, _ := c.Seen(ctx, "peer-b", "shared"); seen {
		t.Fatal("one peer's nonce blocked another peer's")
	}
}
