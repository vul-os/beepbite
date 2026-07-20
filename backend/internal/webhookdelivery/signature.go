// Package webhookdelivery implements outbound webhook delivery for BeepBite:
// signing, emission, and a background dispatcher with retry/backoff.
package webhookdelivery

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"time"
)

// Sign produces the value for the X-BeepBite-Signature header.
// Format: t=<unix>,v1=<hex-hmac-sha256>
//
// The signed payload is "<timestamp>.<body>".
// secret is the endpoint's signing_secret. t is the timestamp to embed
// (use time.Now() in production; pass a fixed value in tests).
func Sign(secret string, body []byte, t time.Time) string {
	ts := strconv.FormatInt(t.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	// signed payload: "<timestamp>.<body>"
	mac.Write([]byte(ts))
	mac.Write([]byte("."))
	mac.Write(body)
	sig := hex.EncodeToString(mac.Sum(nil))
	return fmt.Sprintf("t=%s,v1=%s", ts, sig)
}

// Verify checks that headerValue (the raw X-BeepBite-Signature header) matches
// a freshly computed signature over body using secret.
// It returns nil on success and an error describing the mismatch otherwise.
//
// Callers that need replay protection should also check that the embedded
// timestamp is within an acceptable tolerance (e.g. ±5 minutes).
func Verify(secret string, body []byte, headerValue string) error {
	ts, v1, err := parseSignatureHeader(headerValue)
	if err != nil {
		return err
	}

	t := time.Unix(ts, 0)
	expected := Sign(secret, body, t)

	// parseSignatureHeader already validated the format; extract the v1 portion
	// of the expected header to compare only the hex signature.
	_, expectedV1, _ := parseSignatureHeader(expected)
	if !hmac.Equal([]byte(v1), []byte(expectedV1)) {
		return fmt.Errorf("webhookdelivery: signature mismatch")
	}
	return nil
}

// parseSignatureHeader parses "t=<unix>,v1=<hex>" and returns (timestamp, v1sig, err).
func parseSignatureHeader(h string) (ts int64, v1 string, err error) {
	// fast path: scan for t= and v1=
	var rawTs, rawV1 string
	n, _ := fmt.Sscanf(h, "t=%s", &rawTs)
	if n == 0 {
		return 0, "", fmt.Errorf("webhookdelivery: missing t= in signature header")
	}
	// rawTs may be "1234567890,v1=abc" — split at comma
	for i, c := range rawTs {
		if c == ',' {
			rawTs = rawTs[:i]
			break
		}
	}

	// scan v1=
	_, after, found := cutPrefix(h, "v1=")
	if !found {
		return 0, "", fmt.Errorf("webhookdelivery: missing v1= in signature header")
	}
	rawV1 = after

	ts, err = strconv.ParseInt(rawTs, 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("webhookdelivery: invalid timestamp in signature header: %w", err)
	}
	return ts, rawV1, nil
}

// cutPrefix returns s without the leading prefix and found=true, or s, false.
// This reimplements strings.Cut with a specific prefix (avoids import for a
// tiny helper; strings.Cut is available but let's keep the dep-free version).
func cutPrefix(s, prefix string) (before, after string, found bool) {
	if len(s) < len(prefix) {
		return s, "", false
	}
	for i := 0; i <= len(s)-len(prefix); i++ {
		if s[i:i+len(prefix)] == prefix {
			return s[:i], s[i+len(prefix):], true
		}
	}
	return s, "", false
}
