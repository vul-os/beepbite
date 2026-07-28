package webhookdelivery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Signature tests (pure, no DB)
// ---------------------------------------------------------------------------

func testSig(t *testing.T, secret, delivery string, body []byte, at time.Time) string {
	t.Helper()
	return Sign(secret, delivery, body, at)
}

func TestSignVerifyRoundTrip(t *testing.T) {
	secret := "whsec_test_secret_key"
	body := []byte(`{"event":"order.paid","order_id":"abc123"}`)
	now := time.Unix(1700000000, 0)

	header := testSig(t, secret, "del_1", body, now)
	if header == "" {
		t.Fatal("Sign returned empty header")
	}
	if _, _, err := parseSignatureHeader(header); err != nil {
		t.Fatalf("parseSignatureHeader(%q): %v", header, err)
	}
	if err := Verify(secret, "del_1", body, header, DefaultMaxSkew, now); err != nil {
		t.Fatalf("Verify failed for valid signature: %v", err)
	}
}

func TestVerifyRejectsWrongSecret(t *testing.T) {
	body := []byte(`{"event":"order.paid"}`)
	now := time.Unix(1700000000, 0)
	header := testSig(t, "correct_secret", "del_1", body, now)

	if err := Verify("wrong_secret", "del_1", body, header, DefaultMaxSkew, now); !errors.Is(err, ErrSignatureMismatch) {
		t.Fatalf("want ErrSignatureMismatch, got %v", err)
	}
}

func TestVerifyRejectsAlteredBody(t *testing.T) {
	secret := "my_secret"
	now := time.Unix(1700000000, 0)
	header := testSig(t, secret, "del_1", []byte(`{"event":"order.paid","amount":100}`), now)

	altered := []byte(`{"event":"order.paid","amount":999}`)
	if err := Verify(secret, "del_1", altered, header, DefaultMaxSkew, now); !errors.Is(err, ErrSignatureMismatch) {
		t.Fatalf("want ErrSignatureMismatch, got %v", err)
	}
}

// The defect this file was rewritten for. A signature captured once used to
// verify forever, because Verify re-derived the MAC from the timestamp in the
// header and then never compared that timestamp to anything.
func TestVerifyRejectsReplayOutsideWindow(t *testing.T) {
	secret := "s3cr3t"
	body := []byte(`{"order_id":"ord_1"}`)
	signedAt := time.Unix(1700000000, 0)
	header := testSig(t, secret, "del_1", body, signedAt)

	// Still good a minute later.
	if err := Verify(secret, "del_1", body, header, DefaultMaxSkew, signedAt.Add(time.Minute)); err != nil {
		t.Fatalf("signature should still be valid inside the window: %v", err)
	}
	// Refused an hour later, and a year later.
	for _, age := range []time.Duration{time.Hour, 365 * 24 * time.Hour} {
		err := Verify(secret, "del_1", body, header, DefaultMaxSkew, signedAt.Add(age))
		if !errors.Is(err, ErrTimestampSkew) {
			t.Fatalf("replay at +%s: want ErrTimestampSkew, got %v", age, err)
		}
	}
}

// A far-future timestamp is refused too. Accepting one lets a captured
// delivery be parked and replayed at a moment of the attacker's choosing.
func TestVerifyRejectsFarFutureTimestamp(t *testing.T) {
	secret := "s3cr3t"
	body := []byte(`{}`)
	now := time.Unix(1700000000, 0)
	header := testSig(t, secret, "del_1", body, now.Add(24*time.Hour))

	if err := Verify(secret, "del_1", body, header, DefaultMaxSkew, now); !errors.Is(err, ErrTimestampSkew) {
		t.Fatalf("want ErrTimestampSkew for future timestamp, got %v", err)
	}
}

// maxSkew<=0 must be an error, not an accidental "accept everything".
func TestVerifyRejectsNonPositiveSkew(t *testing.T) {
	secret := "s3cr3t"
	body := []byte(`{}`)
	now := time.Unix(1700000000, 0)
	header := testSig(t, secret, "del_1", body, now)

	for _, skew := range []time.Duration{0, -time.Minute} {
		if err := Verify(secret, "del_1", body, header, skew, now); err == nil {
			t.Fatalf("maxSkew=%s was accepted; an unbounded window must not be reachable", skew)
		}
	}
}

// The nonce is inside the MAC, so a captured delivery cannot be re-presented
// under a fresh id to slip past a receiver's dedupe cache.
func TestVerifyBindsDeliveryID(t *testing.T) {
	secret := "s3cr3t"
	body := []byte(`{"order_id":"ord_1"}`)
	now := time.Unix(1700000000, 0)
	header := testSig(t, secret, "del_1", body, now)

	if err := Verify(secret, "del_2", body, header, DefaultMaxSkew, now); !errors.Is(err, ErrSignatureMismatch) {
		t.Fatalf("want ErrSignatureMismatch for swapped delivery id, got %v", err)
	}
}

func TestSignDeterministic(t *testing.T) {
	secret, body, now := "s3cr3t", []byte(`{"id":"x"}`), time.Unix(1700000000, 0)
	if Sign(secret, "d", body, now) != Sign(secret, "d", body, now) {
		t.Fatal("Sign is not deterministic")
	}
}

func TestSignDifferentTimestampsDifferentSigs(t *testing.T) {
	secret, body := "s3cr3t", []byte(`{"id":"x"}`)
	if Sign(secret, "d", body, time.Unix(1700000000, 0)) == Sign(secret, "d", body, time.Unix(1700000001, 0)) {
		t.Fatal("expected different signatures for different timestamps")
	}
}

func TestSignatureHeaderFormat(t *testing.T) {
	ts := time.Unix(1234567890, 0)
	h := Sign("k", "d", []byte(`{}`), ts)
	if !strings.HasPrefix(h, fmt.Sprintf("t=%d,v1=", ts.Unix())) {
		t.Fatalf("header %q has the wrong shape", h)
	}
}

// The old parser scanned for "v1=" anywhere in the header and read the
// timestamp with Sscanf, so reordered and junk-laden headers parsed happily.
func TestParseSignatureHeaderRejectsMalformed(t *testing.T) {
	good := Sign("k", "d", []byte(`{}`), time.Unix(1700000000, 0))
	_, sig, err := parseSignatureHeader(good)
	if err != nil {
		t.Fatalf("well-formed header rejected: %v", err)
	}

	bad := []string{
		"",
		"t=1700000000",
		"v1=" + sig,
		"t=notanumber,v1=" + sig,
		"v1=" + sig + ",t=1700000000",   // reordered
		"t=1700000000,x=v1=" + sig,      // v1= present, but not as its own field
		"t=1700000000,v1=" + sig + "ff", // too long
		"t=1700000000,v1=" + sig[:62],   // too short
		"t=1700000000,v1=" + strings.Repeat("z", 64), // right length, not hex
	}
	for _, h := range bad {
		if _, _, err := parseSignatureHeader(h); err == nil {
			t.Fatalf("malformed header %q was accepted", h)
		}
	}
}

// ---------------------------------------------------------------------------
// dispatch test — no DB, uses httptest.Server as the webhook endpoint.
// Verifies that dispatch signs the payload and POSTs it correctly.
// ---------------------------------------------------------------------------

func TestDispatchSignsAndPosts(t *testing.T) {
	var (
		receivedBody   []byte
		receivedSigHdr string
		receivedEvtHdr string
		callCount      int32
	)

	// A legacy plaintext secret, so the keyless codec above can open it. The
	// "whsec_" prefix is what marks it as not-yet-encrypted.
	secret := "whsec_endpoint_secret_xyz"
	payload := map[string]any{"order_id": "ord_1", "amount": 150}
	payloadJSON, _ := json.Marshal(payload)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&callCount, 1)
		buf := make([]byte, 4096)
		n, _ := r.Body.Read(buf)
		receivedBody = buf[:n]
		receivedSigHdr = r.Header.Get("X-BeepBite-Signature")
		receivedEvtHdr = r.Header.Get("X-BeepBite-Event")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Build a runner with a nil pool — the HTTP call will succeed; the DB
	// call inside markDelivered will fail because pool is nil. We ignore that
	// DB error for this test and only inspect the outbound HTTP behaviour.
	runner := &Runner{
		client: &http.Client{Timeout: httpTimeout},
		db:     nil,
		codec:  &SecretCodec{}, // keyless: the row below holds a legacy plaintext secret
	}

	row := deliveryRow{
		ID:                      "del_test_1",
		EndpointID:              "ep_test_1",
		OrgID:                   "org_test_1",
		EventType:               "order.paid",
		Payload:                 payloadJSON,
		Status:                  "pending",
		Attempts:                0,
		EndpointURL:             srv.URL,
		SigningSecretCiphertext: secret,
	}

	// dispatch will panic on the nil-pool DB call. Recover and check HTTP side.
	func() {
		defer func() { recover() }() //nolint:errcheck
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		runner.dispatch(ctx, row)
	}()

	if atomic.LoadInt32(&callCount) == 0 {
		t.Fatal("expected the test server to receive exactly one POST, got 0")
	}

	// Verify body content.
	if string(receivedBody) != string(payloadJSON) {
		t.Fatalf("body mismatch:\n  got:  %s\n  want: %s", receivedBody, payloadJSON)
	}

	// Verify X-BeepBite-Event header.
	if receivedEvtHdr != "order.paid" {
		t.Fatalf("X-BeepBite-Event = %q, want %q", receivedEvtHdr, "order.paid")
	}

	// The signature in the header must verify against the received body.
	if err := VerifyNow(secret, row.ID, receivedBody, receivedSigHdr); err != nil {
		t.Fatalf("signature verification failed: %v\n  header: %s", err, receivedSigHdr)
	}
}

// ---------------------------------------------------------------------------
// Backoff duration tests
// ---------------------------------------------------------------------------

func TestBackoffDuration(t *testing.T) {
	cases := []struct {
		attempts int
		wantMin  time.Duration
		wantMax  time.Duration
	}{
		{0, 5 * time.Second, 6 * time.Second},
		{1, 10 * time.Second, 11 * time.Second},
		{2, 20 * time.Second, 21 * time.Second},
		{3, 40 * time.Second, 41 * time.Second},
		{4, 80 * time.Second, 81 * time.Second},
		{10, 5 * time.Minute, 5*time.Minute + 1},
	}
	for _, tc := range cases {
		d := backoffDuration(tc.attempts)
		if d < tc.wantMin || d > tc.wantMax {
			t.Errorf("backoffDuration(%d) = %v, want [%v, %v]",
				tc.attempts, d, tc.wantMin, tc.wantMax)
		}
	}
}

// ---------------------------------------------------------------------------
// Emit payload marshal test (pure, no DB)
// ---------------------------------------------------------------------------

func TestMarshalPayload(t *testing.T) {
	v := map[string]any{"event": "order.paid", "amount": 100}
	b, err := marshalPayload(v)
	if err != nil {
		t.Fatalf("marshalPayload: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if out["event"] != "order.paid" {
		t.Fatalf("unexpected event: %v", out["event"])
	}
}
