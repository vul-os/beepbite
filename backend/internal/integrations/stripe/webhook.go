// webhook.go — Stripe webhook signature verification.
//
// Stripe signs webhooks via the `Stripe-Signature` header:
//
//	Stripe-Signature: t=<unix ts>,v1=<hex HMAC>,v1=<hex HMAC>,…
//
// Signed payload is `<t>.<raw body>` with HMAC-SHA256 using the endpoint
// webhook secret (whsec_…). A single request may carry multiple v1 values
// when signing secret rotation is in flight — any match is accepted.
//
// We enforce a 5-minute tolerance on the timestamp to prevent replay.
package stripe

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// defaultTolerance is the max drift we accept between Stripe's timestamp and
// ours. Matches Stripe's official library default.
const defaultTolerance = 5 * time.Minute

// WebhookEvent mirrors Stripe's event envelope. Data is parsed lazily by the
// caller if it needs provider-specific fields beyond the top-level type.
type WebhookEvent struct {
	ID      string          `json:"id"`
	Type    string          `json:"type"`
	Created int64           `json:"created"`
	Data    json.RawMessage `json:"data"`
}

// VerifyWebhookSignature validates the Stripe-Signature header against the
// raw request body using the endpoint's webhook secret.
//
// Pass time.Now() in most cases. now is a parameter purely to make tests
// deterministic.
func VerifyWebhookSignature(secret string, rawBody []byte, sigHeader string, now time.Time) error {
	if secret == "" {
		return errors.New("stripe: missing webhook secret")
	}
	if sigHeader == "" {
		return errors.New("stripe: missing Stripe-Signature header")
	}

	var (
		tsStr string
		v1s   []string
	)
	for _, part := range strings.Split(sigHeader, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) != 2 {
			continue
		}
		switch kv[0] {
		case "t":
			tsStr = kv[1]
		case "v1":
			v1s = append(v1s, kv[1])
		}
	}
	if tsStr == "" || len(v1s) == 0 {
		return errors.New("stripe: malformed Stripe-Signature header")
	}

	ts, err := strconv.ParseInt(tsStr, 10, 64)
	if err != nil {
		return fmt.Errorf("stripe: bad timestamp: %w", err)
	}
	if drift := now.Sub(time.Unix(ts, 0)); drift > defaultTolerance || drift < -defaultTolerance {
		return errors.New("stripe: timestamp outside tolerance")
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(tsStr))
	mac.Write([]byte{'.'})
	mac.Write(rawBody)
	want := hex.EncodeToString(mac.Sum(nil))

	for _, got := range v1s {
		if hmac.Equal([]byte(got), []byte(want)) {
			return nil
		}
	}
	return errors.New("stripe: signature mismatch")
}

// ParseWebhookEvent decodes the envelope. Does NOT verify — call
// VerifyWebhookSignature first.
func ParseWebhookEvent(rawBody []byte) (*WebhookEvent, error) {
	var ev WebhookEvent
	if err := json.Unmarshal(rawBody, &ev); err != nil {
		return nil, err
	}
	return &ev, nil
}

// SignForTest produces a Stripe-Signature header for a given payload. Used
// only by the test suite — not exported-ish, but kept public so cmd/tests
// can live outside this package.
func SignForTest(secret, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts))
	mac.Write([]byte{'.'})
	mac.Write(body)
	return fmt.Sprintf("t=%s,v1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}
