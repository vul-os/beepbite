package webhookdelivery

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Signature tests (pure, no DB)
// ---------------------------------------------------------------------------

func TestSignVerifyRoundTrip(t *testing.T) {
	secret := "whsec_test_secret_key"
	body := []byte(`{"event":"order.paid","order_id":"abc123"}`)
	ts := time.Unix(1700000000, 0)

	header := Sign(secret, body, ts)
	if header == "" {
		t.Fatal("Sign returned empty header")
	}

	// Header should contain t= and v1= parts.
	if _, _, err := parseSignatureHeader(header); err != nil {
		t.Fatalf("parseSignatureHeader(%q): %v", header, err)
	}

	if err := Verify(secret, body, header); err != nil {
		t.Fatalf("Verify failed for valid signature: %v", err)
	}
}

func TestVerifyRejectsWrongSecret(t *testing.T) {
	body := []byte(`{"event":"order.paid"}`)
	ts := time.Unix(1700000000, 0)
	header := Sign("correct_secret", body, ts)

	if err := Verify("wrong_secret", body, header); err == nil {
		t.Fatal("expected Verify to fail with wrong secret, got nil")
	}
}

func TestVerifyRejectsAlteredBody(t *testing.T) {
	secret := "my_secret"
	originalBody := []byte(`{"event":"order.paid","amount":100}`)
	ts := time.Unix(1700000000, 0)
	header := Sign(secret, originalBody, ts)

	alteredBody := []byte(`{"event":"order.paid","amount":999}`)
	if err := Verify(secret, alteredBody, header); err == nil {
		t.Fatal("expected Verify to fail with altered body, got nil")
	}
}

func TestSignDeterministic(t *testing.T) {
	secret := "s3cr3t"
	body := []byte(`{"id":"x"}`)
	ts := time.Unix(1700000000, 0)

	h1 := Sign(secret, body, ts)
	h2 := Sign(secret, body, ts)
	if h1 != h2 {
		t.Fatalf("Sign is not deterministic: %q != %q", h1, h2)
	}
}

func TestSignDifferentTimestampsDifferentSigs(t *testing.T) {
	secret := "s3cr3t"
	body := []byte(`{"id":"x"}`)
	t1 := time.Unix(1700000000, 0)
	t2 := time.Unix(1700000001, 0)

	if Sign(secret, body, t1) == Sign(secret, body, t2) {
		t.Fatal("expected different signatures for different timestamps")
	}
}

func TestSignatureHeaderFormat(t *testing.T) {
	secret := "k"
	body := []byte(`{}`)
	ts := time.Unix(1234567890, 0)
	h := Sign(secret, body, ts)

	expected := fmt.Sprintf("t=%d,v1=", ts.Unix())
	if len(h) < len(expected) || h[:len(expected)] != expected {
		t.Fatalf("header %q does not start with %q", h, expected)
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

	secret := "endpoint_secret_xyz"
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
	}

	row := deliveryRow{
		ID:            "del_test_1",
		EndpointID:    "ep_test_1",
		OrgID:         "org_test_1",
		EventType:     "order.paid",
		Payload:       payloadJSON,
		Status:        "pending",
		Attempts:      0,
		EndpointURL:   srv.URL,
		SigningSecret: secret,
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
	if err := Verify(secret, receivedBody, receivedSigHdr); err != nil {
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
