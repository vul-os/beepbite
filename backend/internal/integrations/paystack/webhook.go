// webhook.go — Paystack webhook signature verification + event parsing.
//
// Paystack sends webhooks as POST JSON with header:
//
//	x-paystack-signature: <hex HMAC-SHA512 of raw body using your secret key>
//
// Paystack's header does not include a region marker, so the webhook handler
// routes by URL path (/webhooks/paystack/{region}) to pick the right secret.
// VerifyWebhookSignature takes the resolved secret directly.
package paystack

import (
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
)

// WebhookEvent is the minimal shape we care about. Paystack sends many event
// types; right now we only branch on charge.success / charge.failed /
// refund.processed. Raw is the full decoded payload if a handler needs more.
type WebhookEvent struct {
	Event string          `json:"event"`
	Data  WebhookData     `json:"data"`
	Raw   json.RawMessage `json:"-"`
}

type WebhookData struct {
	ID            json.RawMessage        `json:"id"`
	Reference     string                 `json:"reference"`
	Status        string                 `json:"status"`
	Amount        int64                  `json:"amount"`
	Currency      string                 `json:"currency"`
	Customer      map[string]interface{} `json:"customer"`
	Authorization map[string]interface{} `json:"authorization"`
	Metadata      map[string]interface{} `json:"metadata"`
}

// VerifyWebhookSignature checks the x-paystack-signature header value against
// HMAC-SHA512(secret, rawBody). Returns nil on match.
//
// Use constant-time comparison — a timing oracle on the signature lets
// attackers forge callbacks.
func VerifyWebhookSignature(secret string, rawBody []byte, sigHeader string) error {
	if secret == "" {
		return errors.New("paystack: missing secret for webhook verification")
	}
	if sigHeader == "" {
		return errors.New("paystack: missing x-paystack-signature header")
	}
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(rawBody)
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(strings.ToLower(sigHeader)), []byte(want)) {
		return errors.New("paystack: webhook signature mismatch")
	}
	return nil
}

// ParseWebhookEvent decodes the body. Does NOT verify signatures — call
// VerifyWebhookSignature first.
func ParseWebhookEvent(rawBody []byte) (*WebhookEvent, error) {
	var ev WebhookEvent
	if err := json.Unmarshal(rawBody, &ev); err != nil {
		return nil, err
	}
	ev.Raw = rawBody
	return &ev, nil
}
