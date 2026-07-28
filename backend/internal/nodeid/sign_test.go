package nodeid

import (
	"bytes"
	"crypto/ed25519"
	"path/filepath"
	"testing"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// newIdentity returns a fresh, unpersisted Identity for tests that only
// need to sign and verify, not exercise the store.
func newIdentity(t *testing.T) *Identity {
	t.Helper()
	path := filepath.Join(t.TempDir(), "node.json")
	id, err := LoadOrCreate(path)
	if err != nil {
		t.Fatalf("LoadOrCreate: %v", err)
	}
	return id
}

// ---------------------------------------------------------------------------
// Sign / Verify — happy path
// ---------------------------------------------------------------------------

func TestSignVerify_HappyPath(t *testing.T) {
	id := newIdentity(t)
	payload := []byte("job-42:accept")

	sig := id.Sign("job-bid", payload)
	if len(sig) != ed25519.SignatureSize {
		t.Fatalf("Sign returned %d bytes, want %d", len(sig), ed25519.SignatureSize)
	}
	if !Verify(id.Public, "job-bid", payload, sig) {
		t.Fatal("Verify rejected a signature produced by Sign with matching purpose/payload/key")
	}
}

func TestSignVerify_EmptyPayloadIsValid(t *testing.T) {
	id := newIdentity(t)
	sig := id.Sign("heartbeat", nil)
	if !Verify(id.Public, "heartbeat", nil, sig) {
		t.Fatal("Verify rejected a signature over an empty payload")
	}
}

// ---------------------------------------------------------------------------
// Verify — must fail (not panic) on tampering
// ---------------------------------------------------------------------------

func TestVerify_FailsOnTamperedPayload(t *testing.T) {
	id := newIdentity(t)
	sig := id.Sign("branch-head", []byte("seq=100"))

	if Verify(id.Public, "branch-head", []byte("seq=999"), sig) {
		t.Fatal("Verify accepted a signature over a payload it was not signed for")
	}
}

func TestVerify_FailsOnTamperedSignature(t *testing.T) {
	id := newIdentity(t)
	payload := []byte("seq=100")
	sig := id.Sign("branch-head", payload)

	tampered := bytes.Clone(sig)
	tampered[0] ^= 0xFF

	if Verify(id.Public, "branch-head", payload, tampered) {
		t.Fatal("Verify accepted a signature with a flipped byte")
	}
}

func TestVerify_FailsOnDifferentPurpose(t *testing.T) {
	id := newIdentity(t)
	payload := []byte("seq=100")
	sig := id.Sign("branch-head", payload)

	if Verify(id.Public, "peer-invite", payload, sig) {
		t.Fatal("Verify accepted a signature under a different purpose than it was signed with")
	}
}

func TestVerify_FailsOnDifferentKey(t *testing.T) {
	signer := newIdentity(t)
	other := newIdentity(t)
	payload := []byte("seq=100")
	sig := signer.Sign("branch-head", payload)

	if Verify(other.Public, "branch-head", payload, sig) {
		t.Fatal("Verify accepted a signature against the wrong public key")
	}
}

func TestVerify_FailsOnWrongLengthSignature(t *testing.T) {
	id := newIdentity(t)
	payload := []byte("seq=100")

	cases := [][]byte{
		nil,
		{},
		[]byte("too short"),
		bytes.Repeat([]byte{0x01}, ed25519.SignatureSize+1),
	}
	for _, sig := range cases {
		if Verify(id.Public, "branch-head", payload, sig) {
			t.Errorf("Verify accepted a %d-byte signature (want SignatureSize=%d)", len(sig), ed25519.SignatureSize)
		}
	}
}

func TestVerify_FailsOnMalformedPublicKeyWithoutPanic(t *testing.T) {
	id := newIdentity(t)
	payload := []byte("seq=100")
	sig := id.Sign("branch-head", payload)

	var zero NodeID // 32 zero bytes: syntactically a NodeID, not a valid curve point
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("Verify panicked on a malformed/zero public key: %v", r)
		}
	}()
	if Verify(zero, "branch-head", payload, sig) {
		t.Fatal("Verify accepted a signature against an all-zero public key")
	}
}

// ---------------------------------------------------------------------------
// Domain separation / length-prefixing
// ---------------------------------------------------------------------------

// TestDomainSeparation_LengthPrefixPreventsFieldBoundaryCollision constructs
// two (purpose, payload) pairs whose *naive* concatenation (purpose+payload,
// no length prefix, no separator) would be byte-identical:
//
//	purpose="ab", payload="c"   -> naive concat "abc"
//	purpose="a",  payload="bc"  -> naive concat "abc"
//
// If envelope() ever regressed to plain concatenation, signatures for these
// two pairs would be identical and cross-verify. With length-prefixing they
// must not.
func TestDomainSeparation_LengthPrefixPreventsFieldBoundaryCollision(t *testing.T) {
	id := newIdentity(t)

	purposeA, payloadA := "ab", []byte("c")
	purposeB, payloadB := "a", []byte("bc")

	// Sanity-check the premise: naive concatenation really does collide.
	naiveA := purposeA + string(payloadA)
	naiveB := purposeB + string(payloadB)
	if naiveA != naiveB {
		t.Fatalf("test premise broken: naive concatenations differ (%q vs %q)", naiveA, naiveB)
	}

	sigA := id.Sign(purposeA, payloadA)
	sigB := id.Sign(purposeB, payloadB)

	if bytes.Equal(sigA, sigB) {
		t.Fatal("signatures for two different (purpose, payload) pairs with colliding naive concatenation are identical")
	}

	// And neither signature must verify against the other pair.
	if Verify(id.Public, purposeB, payloadB, sigA) {
		t.Fatal("signature for (purposeA, payloadA) verified against (purposeB, payloadB)")
	}
	if Verify(id.Public, purposeA, payloadA, sigB) {
		t.Fatal("signature for (purposeB, payloadB) verified against (purposeA, payloadA)")
	}
}

func TestEnvelope_DiffersFromPlainConcatenation(t *testing.T) {
	got := envelope("p", []byte("x"))
	naive := []byte(domainContext + "p" + "x")
	if bytes.Equal(got, naive) {
		t.Fatal("envelope() produced plain concatenation instead of length-prefixed framing")
	}
}
