package idempotency

import (
	"regexp"
	"testing"
)

// hashRequest is the correctness core of idempotency: the middleware rejects a
// reused Idempotency-Key whose (method, path, body) hashes differently (422
// "reused with different payload"), and replays only on an exact hash match. So
// the hash MUST be deterministic and MUST change when any field changes —
// otherwise two genuinely different requests could share a cached response
// (a double-charge or a cross-request data leak).

func TestHashRequest_Deterministic(t *testing.T) {
	body := []byte(`{"amount":100,"currency":"ZAR"}`)
	a := hashRequest("POST", "/api/v1/data/orders", body)
	b := hashRequest("POST", "/api/v1/data/orders", body)
	if a != b {
		t.Fatalf("same request hashed differently:\n  %s\n  %s", a, b)
	}
}

func TestHashRequest_BodySensitive(t *testing.T) {
	// The security-critical property: a different payload must not collide, so
	// the middleware's hash-mismatch guard fires instead of replaying.
	h1 := hashRequest("POST", "/orders", []byte(`{"amount":100}`))
	h2 := hashRequest("POST", "/orders", []byte(`{"amount":999}`))
	if h1 == h2 {
		t.Error("different bodies produced the same hash — mismatch guard would not fire")
	}
	// Empty vs non-empty body must also differ.
	if hashRequest("POST", "/orders", nil) == hashRequest("POST", "/orders", []byte("x")) {
		t.Error("empty and non-empty bodies collide")
	}
}

func TestHashRequest_MethodAndPathSensitive(t *testing.T) {
	body := []byte("x")
	base := hashRequest("POST", "/orders", body)
	if base == hashRequest("PATCH", "/orders", body) {
		t.Error("different methods collide")
	}
	if base == hashRequest("POST", "/order_payments", body) {
		t.Error("different paths collide")
	}
}

// The method/path/body are joined with "\n" separators. Verify that boundary
// actually prevents a field from bleeding into the next for ordinary
// (newline-free) paths: "/a" + "bc" must not hash like "/ab" + "c".
func TestHashRequest_FieldBoundary(t *testing.T) {
	if hashRequest("POST", "/a", []byte("bc")) == hashRequest("POST", "/ab", []byte("c")) {
		t.Error("path and body boundary collide — the separator is not doing its job")
	}
	if hashRequest("POST", "/a", []byte("b")) == hashRequest("POS", "T/a", []byte("b")) {
		t.Error("method and path boundary collide")
	}
}

func TestHashRequest_Format(t *testing.T) {
	h := hashRequest("POST", "/orders", []byte("x"))
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(h) {
		t.Errorf("hash %q is not a 64-char lowercase hex sha256", h)
	}
}
