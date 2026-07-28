package webhookdelivery

import (
	"fmt"
	"os"
	"strings"
	"sync"

	"github.com/beepbite/backend/internal/secretbox"
)

// # The column called signing_secret_ciphertext
//
// It held plaintext. That is worse than a column honestly named
// signing_secret: an auditor reading the schema, or an engineer reading a
// query, concludes the value is encrypted and stops looking. A name is a claim,
// and this one was false.
//
// The name cannot be corrected — renaming an applied migration's column is not
// something this repo does. So the value is made to match the name instead: it
// is sealed with AES-256-GCM (internal/secretbox) before it reaches the
// database, and opened only in the process that signs a delivery. The misnomer
// is recorded in the schema itself by migration 003, so the next person to read
// it is told what happened rather than left to infer it.
//
// # Telling the two apart
//
// generateSigningSecret emits "whsec_<64 hex chars>". A sealed value is
// base64 of nonce||ciphertext and cannot begin with "whsec_" — base64's
// alphabet contains no underscore. The prefix is therefore an exact, cheap
// discriminator between "never encrypted" and "encrypted", which is what makes
// the conversion in cmd/encryptwebhooksecrets idempotent: a second run finds
// nothing left with the prefix and does nothing.
const legacyPlaintextPrefix = "whsec_"

// LooksLikeLegacyPlaintext reports whether stored is an unencrypted secret
// still in the pre-migration format.
func LooksLikeLegacyPlaintext(stored string) bool {
	return strings.HasPrefix(stored, legacyPlaintextPrefix)
}

// SecretCodec seals and opens endpoint signing secrets.
//
// A nil *SecretCodec, or one with a nil box, is a codec with no key: it can
// still READ legacy plaintext rows, so an operator who has not yet configured
// APP_KEY_ENCRYPTION_SECRET keeps working webhooks, but it cannot seal and
// cannot open anything already sealed. That asymmetry is deliberate — losing
// the key must not silently produce a fresh, wrong secret.
type SecretCodec struct {
	box *secretbox.Box
}

// NewSecretCodec builds a codec from an explicit key. An empty key yields a
// keyless codec (legacy-plaintext reads only).
func NewSecretCodec(key string) (*SecretCodec, error) {
	if key == "" {
		return &SecretCodec{}, nil
	}
	box, err := secretbox.New(key)
	if err != nil {
		return nil, fmt.Errorf("webhookdelivery: init secretbox: %w", err)
	}
	return &SecretCodec{box: box}, nil
}

// SecretCodecFromEnv reads WEBHOOK_KEY_ENCRYPTION_SECRET, falling back to
// APP_KEY_ENCRYPTION_SECRET — the same precedence internal/email uses.
func SecretCodecFromEnv() (*SecretCodec, error) {
	key := os.Getenv("WEBHOOK_KEY_ENCRYPTION_SECRET")
	if key == "" {
		key = os.Getenv("APP_KEY_ENCRYPTION_SECRET")
	}
	return NewSecretCodec(key)
}

// CanSeal reports whether a key is configured.
func (c *SecretCodec) CanSeal() bool { return c != nil && c.box != nil }

// Seal encrypts a plaintext signing secret for storage.
func (c *SecretCodec) Seal(plain string) (string, error) {
	if !c.CanSeal() {
		return "", fmt.Errorf("webhookdelivery: no encryption key configured " +
			"(set WEBHOOK_KEY_ENCRYPTION_SECRET or APP_KEY_ENCRYPTION_SECRET)")
	}
	return c.box.Encrypt(plain)
}

// Open returns the plaintext signing secret for a stored column value.
//
// A legacy plaintext row is returned as-is and reported through legacy, so the
// caller can say so out loud exactly once rather than on every delivery.
func (c *SecretCodec) Open(stored string) (plain string, legacy bool, err error) {
	if stored == "" {
		return "", false, fmt.Errorf("webhookdelivery: endpoint has no signing secret")
	}
	if LooksLikeLegacyPlaintext(stored) {
		return stored, true, nil
	}
	if !c.CanSeal() {
		return "", false, fmt.Errorf("webhookdelivery: signing secret is encrypted but no " +
			"key is configured (set WEBHOOK_KEY_ENCRYPTION_SECRET or APP_KEY_ENCRYPTION_SECRET)")
	}
	p, err := c.box.Decrypt(stored)
	if err != nil {
		return "", false, fmt.Errorf("webhookdelivery: open signing secret: %w", err)
	}
	return p, false, nil
}

// legacyWarned keeps the "this endpoint is still plaintext" warning to one line
// per endpoint per process. The warning matters, but a webhook that fires on
// every paid order would otherwise reprint it thousands of times a day and the
// operator would learn to filter it out — which is the same as not warning.
var legacyWarned sync.Map // endpointID -> struct{}

func shouldWarnLegacy(endpointID string) bool {
	_, loaded := legacyWarned.LoadOrStore(endpointID, struct{}{})
	return !loaded
}
