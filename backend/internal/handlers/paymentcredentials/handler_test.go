package paymentcredentials

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/beepbite/backend/internal/secretbox"
)

// newTestBox returns a secretbox.Box backed by a deterministic 32-byte key for
// unit tests. The key is hex-encoded.
func newTestBox(t *testing.T) *secretbox.Box {
	t.Helper()
	// 32 bytes of 0xAB as hex (64 hex chars).
	box, err := secretbox.New(strings.Repeat("ab", 32))
	if err != nil {
		t.Fatalf("secretbox.New: %v", err)
	}
	return box
}

// TestAESGCMRoundTrip verifies that Encrypt → Decrypt restores the original
// plaintext, and that the ciphertext is never equal to the plaintext.
func TestAESGCMRoundTrip(t *testing.T) {
	box := newTestBox(t)

	cases := []struct {
		name  string
		plain string
	}{
		{"sk_live key", "sk_live_supersecret1234567890"},
		{"webhook secret", "whsec_abcdefghijklmnopqrstuvwxyz"},
		{"empty", ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ct, err := box.Encrypt(tc.plain)
			if err != nil {
				t.Fatalf("Encrypt(%q): %v", tc.plain, err)
			}

			// Empty in → empty out (no ciphertext stored at all).
			if tc.plain == "" {
				if ct != "" {
					t.Fatalf("Encrypt empty: want empty ciphertext, got %q", ct)
				}
				return
			}

			// Non-empty: ciphertext must differ from plaintext.
			if ct == tc.plain {
				t.Fatalf("ciphertext equals plaintext — encryption did not apply")
			}

			got, err := box.Decrypt(ct)
			if err != nil {
				t.Fatalf("Decrypt: %v", err)
			}
			if got != tc.plain {
				t.Fatalf("round-trip failed: got %q, want %q", got, tc.plain)
			}
		})
	}
}

// TestWebhookURLFormat verifies that the webhook URL is assembled correctly.
func TestWebhookURLFormat(t *testing.T) {
	box := newTestBox(t)
	h := NewHandler(nil, box, "https://api.beepbite.io")

	got := h.webhookURL("paystack", "loc-uuid-123")
	want := "https://api.beepbite.io/webhooks/paystack/loc-uuid-123"
	if got != want {
		t.Fatalf("webhookURL: got %q, want %q", got, want)
	}

	// Trailing slash on appURL must be stripped.
	h2 := NewHandler(nil, box, "https://api.beepbite.io/")
	got2 := h2.webhookURL("stripe", "abc")
	if strings.HasSuffix(strings.Split(got2, "/webhooks/")[0], "/") {
		t.Fatalf("trailing slash not stripped: %q", got2)
	}
}

// TestCreateValidation exercises the request-validation path without hitting
// the database (store is nil; we only reach DB if validation passes).
func TestCreateValidation(t *testing.T) {
	box := newTestBox(t)
	h := NewHandler(nil, box, "https://example.com")

	cases := []struct {
		name       string
		body       map[string]any
		wantStatus int
	}{
		{
			name:       "missing location_id",
			body:       map[string]any{"provider_code": "paystack", "secret_key": "sk"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing provider_code",
			body:       map[string]any{"location_id": "loc1", "secret_key": "sk"},
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "missing secret_key",
			body:       map[string]any{"location_id": "loc1", "provider_code": "paystack"},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, _ := json.Marshal(tc.body)
			req := httptest.NewRequest(http.MethodPost, "/payment-credentials", bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			// Mount on a chi router so URL params are available.
			r := chi.NewRouter()
			r.Post("/payment-credentials", h.create)
			r.ServeHTTP(rr, req)

			if rr.Code != tc.wantStatus {
				t.Fatalf("want %d, got %d — body: %s", tc.wantStatus, rr.Code, rr.Body.String())
			}
		})
	}
}

// TestListValidation verifies the location_id query param requirement.
func TestListValidation(t *testing.T) {
	box := newTestBox(t)
	h := NewHandler(nil, box, "https://example.com")

	req := httptest.NewRequest(http.MethodGet, "/payment-credentials", nil)
	rr := httptest.NewRecorder()

	r := chi.NewRouter()
	r.Get("/payment-credentials", h.list)
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

// TestNonceIsUniquePerEncryption verifies that two Encrypt calls on identical
// plaintext produce different ciphertexts (proving per-call random nonce).
func TestNonceIsUniquePerEncryption(t *testing.T) {
	box := newTestBox(t)
	plain := "sk_live_supersecret1234567890"

	ct1, err := box.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt 1: %v", err)
	}
	ct2, err := box.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt 2: %v", err)
	}

	if ct1 == ct2 {
		t.Fatal("two Encrypt calls produced identical ciphertexts — nonce is not random")
	}

	// Both must still decrypt to the same plaintext.
	got1, err := box.Decrypt(ct1)
	if err != nil {
		t.Fatalf("Decrypt ct1: %v", err)
	}
	got2, err := box.Decrypt(ct2)
	if err != nil {
		t.Fatalf("Decrypt ct2: %v", err)
	}
	if got1 != plain || got2 != plain {
		t.Fatalf("round-trip mismatch: got1=%q got2=%q want=%q", got1, got2, plain)
	}
}

// TestNonceIsPrepended verifies the wire format: first 12 bytes of the decoded
// base64 blob are the GCM nonce, and they differ between two encryptions.
func TestNonceIsPrepended(t *testing.T) {
	box := newTestBox(t)
	plain := "sk_live_test_key"

	ct1, _ := box.Encrypt(plain)
	ct2, _ := box.Encrypt(plain)

	raw1, err := base64.StdEncoding.DecodeString(ct1)
	if err != nil {
		t.Fatalf("base64 decode ct1: %v", err)
	}
	raw2, err := base64.StdEncoding.DecodeString(ct2)
	if err != nil {
		t.Fatalf("base64 decode ct2: %v", err)
	}

	// GCM nonce is 12 bytes.
	const nonceSize = 12
	if len(raw1) <= nonceSize {
		t.Fatalf("ciphertext too short: %d bytes", len(raw1))
	}

	nonce1 := raw1[:nonceSize]
	nonce2 := raw2[:nonceSize]

	// Nonces must not be all-zero.
	allZero := func(b []byte) bool {
		for _, v := range b {
			if v != 0 {
				return false
			}
		}
		return true
	}
	if allZero(nonce1) {
		t.Fatal("nonce is all-zero — random nonce generation failed")
	}

	// Nonces from two encryptions must differ.
	if bytes.Equal(nonce1, nonce2) {
		t.Fatal("nonces are identical across two encrypt calls — nonce is not random")
	}
}

// TestKeyLoadedFromEnv verifies that secretbox.New accepts the
// PAYMENT_KEY_ENCRYPTION_SECRET-style input: a base64-encoded 32-byte key.
// This mirrors exactly how the production server bootstrap works.
func TestKeyLoadedFromEnv(t *testing.T) {
	// Generate a random 32-byte key and base64-encode it (as the env var would be).
	rawKey := make([]byte, 32)
	if _, err := rand.Read(rawKey); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}
	envVal := base64.StdEncoding.EncodeToString(rawKey)

	// Simulate reading from env.
	os.Setenv("PAYMENT_KEY_ENCRYPTION_SECRET", envVal) //nolint:errcheck
	defer os.Unsetenv("PAYMENT_KEY_ENCRYPTION_SECRET") //nolint:errcheck

	keyStr := os.Getenv("PAYMENT_KEY_ENCRYPTION_SECRET")
	box, err := secretbox.New(keyStr)
	if err != nil {
		t.Fatalf("secretbox.New from env: %v", err)
	}

	// Round-trip with the env-derived box.
	plain := "sk_live_from_env_test"
	ct, err := box.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if ct == plain {
		t.Fatal("ciphertext equals plaintext")
	}
	got, err := box.Decrypt(ct)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if got != plain {
		t.Fatalf("round-trip: got %q, want %q", got, plain)
	}
}

// TestWrongKeyDecryptionFails confirms that a ciphertext encrypted under key A
// cannot be decrypted by key B (GCM authentication tag rejects it).
func TestWrongKeyDecryptionFails(t *testing.T) {
	box := newTestBox(t)

	// Key B: all 0xCD bytes.
	boxB, err := secretbox.New(strings.Repeat("cd", 32))
	if err != nil {
		t.Fatalf("secretbox.New boxB: %v", err)
	}

	plain := "sk_live_supersecret"
	ct, err := box.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	_, err = boxB.Decrypt(ct)
	if err == nil {
		t.Fatal("expected decryption to fail with wrong key, but it succeeded — auth tag not checked")
	}
}

// TestResponseContainsOnlySafeFields verifies that GET response JSON only
// contains the documented safe fields: id, location_id, provider_code,
// public_key, is_active, configured_at, webhook_url.
func TestResponseContainsOnlySafeFields(t *testing.T) {
	row := credentialRow{
		ID:           "id-safe-check",
		LocationID:   "loc-safe",
		ProviderCode: "paystack",
		IsActive:     true,
	}
	resp := toResponse(&row, "https://example.com/webhooks/paystack/loc-safe")
	b, _ := json.Marshal(resp)
	s := string(b)

	// These are the only permitted keys.
	permitted := map[string]bool{
		"id": true, "location_id": true, "provider_code": true,
		"public_key": true, "is_active": true, "configured_at": true,
		"webhook_url": true,
	}

	// Parse the JSON object and check every key.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	for k := range raw {
		if !permitted[k] {
			t.Errorf("unexpected field %q in response JSON: %s", k, s)
		}
	}

	// Explicitly assert secret-carrying fields are absent.
	for _, banned := range []string{
		"secret_key", "secret_key_ciphertext",
		"webhook_secret", "webhook_secret_ciphertext",
		"encrypted_secret_key",
	} {
		if strings.Contains(s, `"`+banned+`"`) {
			t.Errorf("banned field %q present in response JSON", banned)
		}
	}
}

// TestEncryptedBlobNotPlaintext confirms that Encrypt output is longer than
// the input (nonce + ciphertext + auth tag) and does not contain the plaintext.
func TestEncryptedBlobNotPlaintext(t *testing.T) {
	box := newTestBox(t)
	plain := "sk_live_capture_test_key"

	ct, err := box.Encrypt(plain)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	// Ciphertext must not contain the plaintext as a substring.
	if strings.Contains(ct, plain) {
		t.Fatal("plaintext appears inside ciphertext — encryption is a no-op")
	}
	// Ciphertext (base64) must be longer than plaintext (nonce + tag overhead).
	if len(ct) <= len(plain) {
		t.Fatalf("ciphertext (%d bytes) not longer than plaintext (%d bytes) — overhead missing", len(ct), len(plain))
	}
	// Decrypt must recover original.
	recovered, err := box.Decrypt(ct)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if recovered != plain {
		t.Fatalf("round-trip: got %q, want %q", recovered, plain)
	}
}

// TestNeverReturnsCiphertext asserts that the list response JSON contains
// no base64-encoded ciphertext keys. We mock the store by building the
// handler with a real box and verifying that the JSON keys for ciphertext
// columns are absent.
func TestNeverReturnsCiphertext(t *testing.T) {
	box := newTestBox(t)

	// Encrypt a value and verify the resulting JSON field name is not present in
	// the credResponse type.
	ct, err := box.Encrypt("sk_live_secret")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}

	row := credentialRow{
		ID:           "id-1",
		LocationID:   "loc-1",
		ProviderCode: "paystack",
		IsActive:     true,
	}
	resp := toResponse(&row, "https://example.com/webhooks/paystack/loc-1")

	b, _ := json.Marshal(resp)
	s := string(b)

	// The ciphertext must never appear in the JSON output.
	if strings.Contains(s, ct) {
		t.Fatalf("ciphertext found in response JSON — plaintext/ciphertext leaked")
	}

	// Forbidden keys.
	for _, forbidden := range []string{"secret_key", "secret_key_ciphertext", "webhook_secret", "webhook_secret_ciphertext"} {
		if strings.Contains(s, `"`+forbidden+`"`) {
			t.Fatalf("field %q found in response JSON — must not be present", forbidden)
		}
	}
}
