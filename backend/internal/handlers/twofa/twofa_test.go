package twofa

// White-box unit tests for the pure, non-DB logic in this package.
// No database is required: Store methods that hit Postgres are NOT tested here.
//
// Covered:
//   - hashBackupCode: deterministic, one-way, distinct inputs → distinct hashes
//   - generateBackupCode: correct length, charset, uniqueness across N calls
//   - TOTP round-trip: generate secret → compute code → totp.Validate passes;
//     wrong code and stale/empty code fail
//   - otpauth URL shape via totp.Generate (mirrors what enroll does)

import (
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

// ---------------------------------------------------------------------------
// hashBackupCode
// ---------------------------------------------------------------------------

func TestHashBackupCode_Deterministic(t *testing.T) {
	const raw = "ABCD1234"
	h1 := hashBackupCode(raw)
	h2 := hashBackupCode(raw)
	if h1 != h2 {
		t.Errorf("hashBackupCode not deterministic: %q vs %q", h1, h2)
	}
}

func TestHashBackupCode_OneWay(t *testing.T) {
	const raw = "MYSECRETCODE"
	h := hashBackupCode(raw)
	if h == raw {
		t.Errorf("hashBackupCode returned the plaintext itself: %q", h)
	}
}

func TestHashBackupCode_DistinctInputs(t *testing.T) {
	h1 := hashBackupCode("AAAAAAAA")
	h2 := hashBackupCode("BBBBBBBB")
	if h1 == h2 {
		t.Errorf("different inputs produced the same hash: %q", h1)
	}
}

func TestHashBackupCode_IsHex64(t *testing.T) {
	// SHA-256 produces 32 bytes = 64 hex chars.
	h := hashBackupCode("TestInput")
	if len(h) != 64 {
		t.Errorf("expected 64-char hex hash, got len=%d: %q", len(h), h)
	}
	for _, c := range h {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Errorf("non-hex char %q in hash %q", c, h)
			break
		}
	}
}

// ---------------------------------------------------------------------------
// generateBackupCode
// ---------------------------------------------------------------------------

const backupCodeCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func TestGenerateBackupCode_Length(t *testing.T) {
	code, err := generateBackupCode()
	if err != nil {
		t.Fatalf("generateBackupCode: %v", err)
	}
	if len(code) != 8 {
		t.Errorf("expected length 8, got %d: %q", len(code), code)
	}
}

func TestGenerateBackupCode_Charset(t *testing.T) {
	for i := 0; i < 20; i++ {
		code, err := generateBackupCode()
		if err != nil {
			t.Fatalf("generateBackupCode: %v", err)
		}
		for _, c := range code {
			if !strings.ContainsRune(backupCodeCharset, c) {
				t.Errorf("char %q not in allowed charset (code=%q)", c, code)
			}
		}
	}
}

func TestGenerateBackupCode_Uniqueness(t *testing.T) {
	const n = 200
	seen := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		code, err := generateBackupCode()
		if err != nil {
			t.Fatalf("generateBackupCode iteration %d: %v", i, err)
		}
		if _, dup := seen[code]; dup {
			// Collisions are statistically near-impossible (32^8 ≈ 1T); flag it.
			t.Errorf("duplicate backup code generated: %q", code)
		}
		seen[code] = struct{}{}
	}
}

// ---------------------------------------------------------------------------
// TOTP round-trip (mirrors what enroll + verify do)
// ---------------------------------------------------------------------------

func TestTOTP_ValidCode_Passes(t *testing.T) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "BeepBite",
		AccountName: "test@example.com",
	})
	if err != nil {
		t.Fatalf("totp.Generate: %v", err)
	}
	secret := key.Secret()

	// Compute the current code (same as what an authenticator app would show).
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("totp.GenerateCode: %v", err)
	}

	// This is the exact call made by the verify and disable handlers.
	if !totp.Validate(code, secret) {
		t.Error("totp.Validate returned false for a freshly-generated code")
	}
}

func TestTOTP_WrongCode_Fails(t *testing.T) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "BeepBite",
		AccountName: "test@example.com",
	})
	if err != nil {
		t.Fatalf("totp.Generate: %v", err)
	}

	if totp.Validate("000000", key.Secret()) {
		// The chance that "000000" happens to be the real code is 1/1 000 000.
		// If this ever fires legitimately, just re-run.
		t.Error("totp.Validate accepted '000000' as a valid code (false positive?)")
	}
}

func TestTOTP_EmptyCode_Fails(t *testing.T) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "BeepBite",
		AccountName: "test@example.com",
	})
	if err != nil {
		t.Fatalf("totp.Generate: %v", err)
	}

	if totp.Validate("", key.Secret()) {
		t.Error("totp.Validate accepted an empty code")
	}
}

func TestTOTP_CodeForDifferentSecret_Fails(t *testing.T) {
	key1, err := totp.Generate(totp.GenerateOpts{Issuer: "BeepBite", AccountName: "a@example.com"})
	if err != nil {
		t.Fatalf("totp.Generate key1: %v", err)
	}
	key2, err := totp.Generate(totp.GenerateOpts{Issuer: "BeepBite", AccountName: "b@example.com"})
	if err != nil {
		t.Fatalf("totp.Generate key2: %v", err)
	}

	code, err := totp.GenerateCode(key1.Secret(), time.Now())
	if err != nil {
		t.Fatalf("totp.GenerateCode: %v", err)
	}

	// A code from key1 must not validate against key2's secret.
	if totp.Validate(code, key2.Secret()) {
		t.Error("totp.Validate accepted a code from a different secret")
	}
}

// ---------------------------------------------------------------------------
// otpauth URL shape (mirrors enroll handler)
// ---------------------------------------------------------------------------

func TestEnroll_OTPAuthURLShape(t *testing.T) {
	email := "demo@beepbite.com"
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "BeepBite",
		AccountName: email,
	})
	if err != nil {
		t.Fatalf("totp.Generate: %v", err)
	}

	u := key.URL()
	if !strings.HasPrefix(u, "otpauth://totp/") {
		t.Errorf("URL does not start with otpauth://totp/: %q", u)
	}
	if !strings.Contains(u, "BeepBite") {
		t.Errorf("URL does not contain issuer 'BeepBite': %q", u)
	}
	if !strings.Contains(u, email) {
		t.Errorf("URL does not contain account name %q: %q", email, u)
	}
	if !strings.Contains(u, "secret=") {
		t.Errorf("URL missing 'secret=' parameter: %q", u)
	}
}
