package nodeid

import (
	"crypto/ed25519"
	"crypto/rand"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// randomNodeID generates a fresh Ed25519 keypair and returns just the
// public half as a NodeID, for tests that only need a plausible identity
// and don't care about signing.
func randomNodeID(t *testing.T) NodeID {
	t.Helper()
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("ed25519.GenerateKey: %v", err)
	}
	id, err := nodeIDFromPublicKey(pub)
	if err != nil {
		t.Fatalf("nodeIDFromPublicKey: %v", err)
	}
	return id
}

// ---------------------------------------------------------------------------
// String / Parse round trip
// ---------------------------------------------------------------------------

func TestNodeID_RoundTrip(t *testing.T) {
	for i := 0; i < 20; i++ {
		id := randomNodeID(t)

		s := id.String()
		got, err := Parse(s)
		if err != nil {
			t.Fatalf("Parse(%q) unexpected error: %v", s, err)
		}
		if got != id {
			t.Fatalf("round trip mismatch: original %v, parsed %v (text form %q)", id, got, s)
		}
	}
}

func TestNodeID_String_IsLowercaseUnpadded(t *testing.T) {
	id := randomNodeID(t)
	s := id.String()

	if s != strings.ToLower(s) {
		t.Errorf("String() %q is not all-lowercase", s)
	}
	if strings.Contains(s, "=") {
		t.Errorf("String() %q contains padding, want unpadded base32", s)
	}
}

func TestNodeID_Parse_IsCaseInsensitive(t *testing.T) {
	id := randomNodeID(t)
	upper := strings.ToUpper(id.String())

	got, err := Parse(upper)
	if err != nil {
		t.Fatalf("Parse(%q) unexpected error: %v", upper, err)
	}
	if got != id {
		t.Fatalf("Parse of uppercase text form gave a different NodeID")
	}
}

// ---------------------------------------------------------------------------
// Parse — invalid input
// ---------------------------------------------------------------------------

func TestNodeID_Parse_RejectsInvalidBase32(t *testing.T) {
	_, err := Parse("not valid base32!!!")
	if err == nil {
		t.Fatal("expected an error for invalid base32 text, got nil")
	}
}

func TestNodeID_Parse_RejectsWrongLength(t *testing.T) {
	cases := []string{
		"",
		"aaaaaaaa", // far too short
		strings.Repeat("a", 200) + strings.Repeat("b", 200), // absurdly long, decodes to way more than 32 bytes
	}
	for _, s := range cases {
		if _, err := Parse(s); err == nil {
			t.Errorf("Parse(%q): expected an error for wrong-length input, got nil", s)
		}
	}
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

func TestNodeID_Fingerprint_IsPrefixOfString(t *testing.T) {
	id := randomNodeID(t)
	fp := id.Fingerprint()
	full := id.String()

	if len(fp) != 8 {
		t.Errorf("Fingerprint() length = %d, want 8", len(fp))
	}
	if !strings.HasPrefix(full, fp) {
		t.Errorf("Fingerprint() %q is not a prefix of String() %q", fp, full)
	}
}

func TestNodeID_Fingerprint_DiffersAcrossKeys(t *testing.T) {
	a := randomNodeID(t)
	b := randomNodeID(t)
	if a == b {
		t.Fatal("two independently generated NodeIDs collided; cannot test fingerprint difference")
	}
	// Not a strict requirement (short prefixes can theoretically collide),
	// but for two random 32-byte keys collision odds are astronomically
	// low, so this is a meaningful smoke test rather than a flaky one.
	if a.Fingerprint() == b.Fingerprint() {
		t.Errorf("fingerprints collided for distinct keys: %s", a.Fingerprint())
	}
}

// ---------------------------------------------------------------------------
// PublicKey conversion
// ---------------------------------------------------------------------------

func TestNodeID_PublicKey_RoundTripsThroughEd25519(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("ed25519.GenerateKey: %v", err)
	}
	id, err := nodeIDFromPublicKey(pub)
	if err != nil {
		t.Fatalf("nodeIDFromPublicKey: %v", err)
	}
	if !id.PublicKey().Equal(pub) {
		t.Errorf("PublicKey() did not round-trip the original ed25519.PublicKey")
	}
}
