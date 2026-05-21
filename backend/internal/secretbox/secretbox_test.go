package secretbox

import (
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// validRawKey is a fixed 32-byte ASCII key used as a raw string.
const validRawKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!" // 32 bytes

// validHexKey is the same 32 bytes expressed as hex (64 hex chars = 32 bytes of zeros).
const validHexKey = "0000000000000000000000000000000000000000000000000000000000000001"

// validBase64Key encodes exactly 32 bytes.
var validBase64Key = base64.StdEncoding.EncodeToString(make([]byte, 32))

func mustNew(t *testing.T, key string) *Box {
	t.Helper()
	b, err := New(key)
	if err != nil {
		t.Fatalf("New(%q) unexpected error: %v", key, err)
	}
	return b
}

// ---------------------------------------------------------------------------
// (1) New() — valid keys / invalid keys
// ---------------------------------------------------------------------------

func TestNew_ValidRawKey(t *testing.T) {
	_, err := New(validRawKey)
	if err != nil {
		t.Fatalf("expected nil error for raw 32-byte key, got: %v", err)
	}
}

func TestNew_ValidHexKey(t *testing.T) {
	_, err := New(validHexKey)
	if err != nil {
		t.Fatalf("expected nil error for 64-char hex key, got: %v", err)
	}
}

func TestNew_ValidBase64Key(t *testing.T) {
	_, err := New(validBase64Key)
	if err != nil {
		t.Fatalf("expected nil error for base64 key, got: %v", err)
	}
}

func TestNew_EmptyKey(t *testing.T) {
	_, err := New("")
	if err == nil {
		t.Fatal("expected error for empty key, got nil")
	}
}

func TestNew_ShortKey(t *testing.T) {
	_, err := New("tooshort")
	if err == nil {
		t.Fatal("expected error for short key, got nil")
	}
}

func TestNew_WrongLengthHex(t *testing.T) {
	// 30 bytes as hex → 60 chars — not 32 bytes raw, not 32 bytes decoded
	_, err := New(hex.EncodeToString(make([]byte, 30)))
	if err == nil {
		t.Fatal("expected error for 30-byte hex key, got nil")
	}
}

func TestNew_LongRawKey(t *testing.T) {
	_, err := New(strings.Repeat("A", 33))
	if err == nil {
		t.Fatal("expected error for 33-byte raw key, got nil")
	}
}

// ---------------------------------------------------------------------------
// (2) Encrypt → Decrypt round-trips
// ---------------------------------------------------------------------------

func TestRoundTrip_Normal(t *testing.T) {
	b := mustNew(t, validRawKey)
	plain := "hello, world!"
	ct, err := b.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}
	got, err := b.Decrypt(ct)
	if err != nil {
		t.Fatalf("Decrypt error: %v", err)
	}
	if got != plain {
		t.Fatalf("round-trip mismatch: got %q, want %q", got, plain)
	}
}

func TestRoundTrip_EmptyString(t *testing.T) {
	b := mustNew(t, validRawKey)
	ct, err := b.Encrypt("")
	if err != nil {
		t.Fatalf("Encrypt empty error: %v", err)
	}
	if ct != "" {
		t.Fatalf("expected empty ciphertext for empty input, got %q", ct)
	}
	got, err := b.Decrypt("")
	if err != nil {
		t.Fatalf("Decrypt empty error: %v", err)
	}
	if got != "" {
		t.Fatalf("expected empty plaintext, got %q", got)
	}
}

func TestRoundTrip_Unicode(t *testing.T) {
	b := mustNew(t, validRawKey)
	plain := "日本語テスト 🔐 «привет»"
	ct, err := b.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt unicode error: %v", err)
	}
	got, err := b.Decrypt(ct)
	if err != nil {
		t.Fatalf("Decrypt unicode error: %v", err)
	}
	if got != plain {
		t.Fatalf("unicode round-trip mismatch: got %q, want %q", got, plain)
	}
}

func TestRoundTrip_LongPlaintext(t *testing.T) {
	b := mustNew(t, validRawKey)
	plain := strings.Repeat("x", 4096)
	ct, err := b.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt long error: %v", err)
	}
	got, err := b.Decrypt(ct)
	if err != nil {
		t.Fatalf("Decrypt long error: %v", err)
	}
	if got != plain {
		t.Fatalf("long plaintext round-trip mismatch (lengths %d vs %d)", len(got), len(plain))
	}
}

func TestRoundTrip_BinaryishPayload(t *testing.T) {
	b := mustNew(t, validRawKey)
	// Simulate a PEM-ish or base64-encoded secret as plaintext.
	plain := base64.StdEncoding.EncodeToString([]byte("some binary-like secret \x00\x01\x02"))
	ct, err := b.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}
	got, err := b.Decrypt(ct)
	if err != nil {
		t.Fatalf("Decrypt error: %v", err)
	}
	if got != plain {
		t.Fatalf("binary-ish round-trip mismatch")
	}
}

// ---------------------------------------------------------------------------
// (3) Ciphertext != plaintext; two encryptions of the same plaintext differ
// ---------------------------------------------------------------------------

func TestEncrypt_CiphertextDiffersFromPlaintext(t *testing.T) {
	b := mustNew(t, validRawKey)
	plain := "super-secret-api-key"
	ct, err := b.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}
	if ct == plain {
		t.Fatal("ciphertext must differ from plaintext")
	}
}

func TestEncrypt_NondeterministicNonce(t *testing.T) {
	b := mustNew(t, validRawKey)
	plain := "same plaintext every time"
	ct1, err := b.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt #1 error: %v", err)
	}
	ct2, err := b.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt #2 error: %v", err)
	}
	if ct1 == ct2 {
		t.Fatal("two Encrypt calls with the same plaintext must produce different ciphertexts (random nonce)")
	}
}

// ---------------------------------------------------------------------------
// (4) Tampered ciphertext fails authentication
// ---------------------------------------------------------------------------

func TestDecrypt_TamperedCiphertext(t *testing.T) {
	b := mustNew(t, validRawKey)
	ct, err := b.Encrypt("sensitive data")
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}

	// Decode, flip a byte in the sealed portion, re-encode.
	raw, err := base64.StdEncoding.DecodeString(ct)
	if err != nil {
		t.Fatalf("base64 decode: %v", err)
	}
	// Flip the last byte (well within the sealed/tag region).
	raw[len(raw)-1] ^= 0xFF
	tampered := base64.StdEncoding.EncodeToString(raw)

	_, err = b.Decrypt(tampered)
	if err == nil {
		t.Fatal("expected error decrypting tampered ciphertext, got nil")
	}
}

func TestDecrypt_TamperedNonce(t *testing.T) {
	b := mustNew(t, validRawKey)
	ct, err := b.Encrypt("another secret")
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}

	raw, _ := base64.StdEncoding.DecodeString(ct)
	// Corrupt the first byte of the nonce.
	raw[0] ^= 0x01
	tampered := base64.StdEncoding.EncodeToString(raw)

	_, err = b.Decrypt(tampered)
	if err == nil {
		t.Fatal("expected error decrypting ciphertext with tampered nonce, got nil")
	}
}

// ---------------------------------------------------------------------------
// (5) Decrypt with a different key's Box fails
// ---------------------------------------------------------------------------

func TestDecrypt_WrongKey(t *testing.T) {
	b1 := mustNew(t, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!") // 32 bytes
	b2 := mustNew(t, "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB!") // different 32 bytes

	ct, err := b1.Encrypt("top secret")
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}
	_, err = b2.Decrypt(ct)
	if err == nil {
		t.Fatal("expected error decrypting with wrong key, got nil")
	}
}

// ---------------------------------------------------------------------------
// (6) Malformed / too-short input does not panic
// ---------------------------------------------------------------------------

func TestDecrypt_NotBase64(t *testing.T) {
	b := mustNew(t, validRawKey)
	_, err := b.Decrypt("this is !!! not valid base64 @@@")
	if err == nil {
		t.Fatal("expected error for non-base64 input, got nil")
	}
}

func TestDecrypt_TooShort(t *testing.T) {
	b := mustNew(t, validRawKey)
	// A valid base64 string that decodes to fewer bytes than nonce+overhead.
	tiny := base64.StdEncoding.EncodeToString([]byte("tiny"))
	_, err := b.Decrypt(tiny)
	if err == nil {
		t.Fatal("expected error for too-short ciphertext, got nil")
	}
}

func TestDecrypt_SingleByte(t *testing.T) {
	b := mustNew(t, validRawKey)
	_, err := b.Decrypt(base64.StdEncoding.EncodeToString([]byte{0x00}))
	if err == nil {
		t.Fatal("expected error for single-byte ciphertext, got nil")
	}
}

func TestDecrypt_RandomJunk(t *testing.T) {
	b := mustNew(t, validRawKey)
	// 50 random-looking bytes encoded as base64 — wrong nonce, wrong tag.
	junk := make([]byte, 50)
	for i := range junk {
		junk[i] = byte(i * 7)
	}
	_, err := b.Decrypt(base64.StdEncoding.EncodeToString(junk))
	if err == nil {
		t.Fatal("expected error for random junk ciphertext, got nil")
	}
}
