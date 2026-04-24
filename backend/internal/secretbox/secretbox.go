// Package secretbox encrypts small secrets (payment gateway keys, webhook
// signing secrets) at rest using AES-256-GCM.
//
// The encryption key is a 32-byte value held by the Go process and loaded from
// PAYMENT_KEY_ENCRYPTION_SECRET. The DB never sees plaintext, so a leak of the
// DB alone is not sufficient to impersonate a merchant's Paystack/Stripe
// account — the attacker also needs the server secret.
//
// Ciphertext format: base64(nonce || sealed). Nonces are random per encryption.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
)

// Box is an AES-GCM AEAD bound to a single 32-byte key.
type Box struct {
	aead cipher.AEAD
}

// New parses a 32-byte key. The key may be supplied as:
//   - hex (64 chars)
//   - standard base64
//   - raw 32 bytes
//
// Anything else returns an error. We accept multiple encodings so operators
// can paste whichever format their secret manager spits out without a
// conversion step.
func New(key string) (*Box, error) {
	raw, err := decodeKey(key)
	if err != nil {
		return nil, err
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("secretbox: key must be 32 bytes, got %d", len(raw))
	}
	block, err := aes.NewCipher(raw)
	if err != nil {
		return nil, fmt.Errorf("secretbox: aes: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("secretbox: gcm: %w", err)
	}
	return &Box{aead: aead}, nil
}

// Encrypt returns a base64 string safe to store in a text column.
// Empty input → empty output (lets callers optionally skip encrypting
// nullable fields like webhook_secret without special casing).
func (b *Box) Encrypt(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("secretbox: nonce: %w", err)
	}
	sealed := b.aead.Seal(nil, nonce, []byte(plain), nil)
	buf := make([]byte, 0, len(nonce)+len(sealed))
	buf = append(buf, nonce...)
	buf = append(buf, sealed...)
	return base64.StdEncoding.EncodeToString(buf), nil
}

// Decrypt reverses Encrypt. Empty in → empty out, mirroring Encrypt.
func (b *Box) Decrypt(ct string) (string, error) {
	if ct == "" {
		return "", nil
	}
	buf, err := base64.StdEncoding.DecodeString(ct)
	if err != nil {
		return "", fmt.Errorf("secretbox: b64: %w", err)
	}
	nsz := b.aead.NonceSize()
	if len(buf) < nsz+b.aead.Overhead() {
		return "", errors.New("secretbox: ciphertext too short")
	}
	nonce, sealed := buf[:nsz], buf[nsz:]
	plain, err := b.aead.Open(nil, nonce, sealed, nil)
	if err != nil {
		return "", fmt.Errorf("secretbox: open: %w", err)
	}
	return string(plain), nil
}

// Mask returns a display-safe rendering of a secret (first 6 chars + "…").
// Use this when echoing a configured key back to the UI; never Decrypt → send.
func Mask(plain string) string {
	if len(plain) <= 8 {
		return "•••"
	}
	return plain[:6] + "…" + plain[len(plain)-4:]
}

func decodeKey(s string) ([]byte, error) {
	if s == "" {
		return nil, errors.New("secretbox: empty key")
	}
	if raw, err := hex.DecodeString(s); err == nil && len(raw) == 32 {
		return raw, nil
	}
	if raw, err := base64.StdEncoding.DecodeString(s); err == nil && len(raw) == 32 {
		return raw, nil
	}
	if raw, err := base64.RawStdEncoding.DecodeString(s); err == nil && len(raw) == 32 {
		return raw, nil
	}
	if len(s) == 32 {
		return []byte(s), nil
	}
	return nil, errors.New("secretbox: key must be 32 bytes (hex, base64, or raw)")
}

// GenerateKeyHex is a convenience for generating a fresh key during local
// setup — call it from a one-shot CLI or paste the output into .env.
func GenerateKeyHex() (string, error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}
