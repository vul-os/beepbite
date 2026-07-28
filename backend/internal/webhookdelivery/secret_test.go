package webhookdelivery

import (
	"strings"
	"testing"
)

// A 32-byte key, raw.
const testKey = "beepbite-test-key-32-bytes-long!"

func TestSealOpenRoundTrip(t *testing.T) {
	c, err := NewSecretCodec(testKey)
	if err != nil {
		t.Fatalf("NewSecretCodec: %v", err)
	}
	plain := "whsec_" + strings.Repeat("a", 64)

	sealed, err := c.Seal(plain)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if sealed == plain {
		t.Fatal("Seal returned the plaintext unchanged")
	}
	// The discriminator the whole migration rests on: a sealed value must not
	// be mistakable for a legacy plaintext one.
	if LooksLikeLegacyPlaintext(sealed) {
		t.Fatalf("sealed value %q still looks like legacy plaintext", sealed)
	}

	got, legacy, err := c.Open(sealed)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if legacy {
		t.Fatal("Open reported a sealed value as legacy")
	}
	if got != plain {
		t.Fatalf("round trip mismatch: got %q want %q", got, plain)
	}
}

// Sealing is randomised, so the same secret must not produce a constant column
// value — otherwise equal ciphertexts would reveal equal secrets across orgs.
func TestSealIsNondeterministic(t *testing.T) {
	c, _ := NewSecretCodec(testKey)
	a, err := c.Seal("whsec_abc")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	b, err := c.Seal("whsec_abc")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if a == b {
		t.Fatal("Seal produced identical ciphertext twice; nonce is not random")
	}
}

func TestOpenPassesThroughLegacyPlaintext(t *testing.T) {
	c, _ := NewSecretCodec(testKey)
	legacyVal := "whsec_" + strings.Repeat("f", 64)

	got, legacy, err := c.Open(legacyVal)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !legacy {
		t.Fatal("Open did not flag a plaintext row as legacy")
	}
	if got != legacyVal {
		t.Fatalf("legacy passthrough mangled the secret: %q", got)
	}
}

// A keyless codec must still deliver for legacy rows, but must refuse to seal.
// Falling back to storing plaintext is the defect, not a graceful degradation.
func TestKeylessCodecReadsLegacyButRefusesToSeal(t *testing.T) {
	c, err := NewSecretCodec("")
	if err != nil {
		t.Fatalf("NewSecretCodec(\"\"): %v", err)
	}
	if c.CanSeal() {
		t.Fatal("keyless codec claims it can seal")
	}
	if _, err := c.Seal("whsec_abc"); err == nil {
		t.Fatal("keyless Seal succeeded; it must fail closed")
	}
	if _, legacy, err := c.Open("whsec_abc"); err != nil || !legacy {
		t.Fatalf("keyless Open of legacy row: legacy=%v err=%v", legacy, err)
	}
}

// Without a key, a sealed value must be an error rather than being handed to
// the signer as if it were the secret.
func TestKeylessCodecCannotOpenSealed(t *testing.T) {
	keyed, _ := NewSecretCodec(testKey)
	sealed, err := keyed.Seal("whsec_abc")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	keyless, _ := NewSecretCodec("")
	if _, _, err := keyless.Open(sealed); err == nil {
		t.Fatal("keyless codec opened a sealed value")
	}
}

func TestOpenRejectsEmpty(t *testing.T) {
	c, _ := NewSecretCodec(testKey)
	if _, _, err := c.Open(""); err == nil {
		t.Fatal("empty stored secret was accepted")
	}
}

func TestWrongKeyCannotOpen(t *testing.T) {
	a, _ := NewSecretCodec(testKey)
	b, _ := NewSecretCodec("a-different-32-byte-key-000000!!")

	sealed, err := a.Seal("whsec_abc")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if _, _, err := b.Open(sealed); err == nil {
		t.Fatal("a different key opened the ciphertext")
	}
}

func TestLooksLikeLegacyPlaintext(t *testing.T) {
	cases := map[string]bool{
		"whsec_deadbeef": true,
		"whsec_":         true,
		"":               false,
		"AAAA/BBBB+cc==": false,
		"whsecX":         false,
		" whsec_x":       false,
	}
	for in, want := range cases {
		if got := LooksLikeLegacyPlaintext(in); got != want {
			t.Errorf("LooksLikeLegacyPlaintext(%q) = %v, want %v", in, got, want)
		}
	}
}
