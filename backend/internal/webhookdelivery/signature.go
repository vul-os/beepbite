// Package webhookdelivery implements outbound webhook delivery for BeepBite:
// signing, emission, and a background dispatcher with retry/backoff.
package webhookdelivery

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// # What a signature proves, and what it does not
//
// The header is "t=<unix>,v1=<hex-hmac-sha256>" over the payload
// "<timestamp>.<delivery-id>.<body>".
//
// The timestamp is INSIDE the MAC, so it cannot be altered without
// invalidating the whole header. That is necessary but not sufficient: the
// timestamp is still a value the sender chose, which the receiver reads back
// out of an attacker-relayed header. Binding alone therefore proves only that
// whoever held the secret once signed that pair — it says nothing about *when*
// the request arrived. Without a bound on the gap between the signed instant
// and now, a delivery captured today is replayable forever, which is precisely
// the hole this file used to have.
//
// So Verify enforces two further things:
//
//  1. An acceptance window. A signature whose timestamp is further from the
//     receiver's clock than maxSkew — in EITHER direction — is refused. Future
//     timestamps are refused as well as old ones, because accepting them lets a
//     captured delivery be parked and replayed at a chosen moment.
//
//  2. A nonce. The delivery id is signed alongside the body and travels in its
//     own header, so a receiver can reject a repeat within the window by
//     remembering the ids it has already accepted. The window bounds how long
//     that memory must be; the nonce is what makes the window sufficient.
//     Neither works alone: a window still admits replays inside it, and a nonce
//     without one needs unbounded storage.
//
// A receiver still has to keep the nonce cache — this package cannot do that
// for someone else's server. What it can do is refuse to offer a Verify that
// silently skips the check, which is why maxSkew is a required argument rather
// than an option with a permissive default.
const (
	// DefaultMaxSkew is the acceptance window used by VerifyNow. Five minutes
	// is the usual choice: long enough to absorb ordinary clock drift and a
	// retry, short enough that a receiver's nonce cache stays small.
	DefaultMaxSkew = 5 * time.Minute

	// SignatureHeader carries "t=<unix>,v1=<hex>".
	SignatureHeader = "X-BeepBite-Signature"
	// DeliveryHeader carries the delivery id — the nonce. It is signed, so it
	// cannot be swapped for a fresh one to slip past a receiver's dedupe cache.
	DeliveryHeader = "X-BeepBite-Delivery"
	// EventHeader names the event type. It is NOT signed; treat it as a routing
	// hint and read the authoritative type out of the verified body.
	EventHeader = "X-BeepBite-Event"
)

// Errors a receiver may want to distinguish. The usual mapping is 400 for a
// malformed header and 401 for both a bad MAC and a stale one.
var (
	ErrMalformedSignature = errors.New("webhookdelivery: malformed signature header")
	ErrSignatureMismatch  = errors.New("webhookdelivery: signature mismatch")
	ErrTimestampSkew      = errors.New("webhookdelivery: signature timestamp outside acceptance window")
)

// Sign produces the value for the X-BeepBite-Signature header.
//
// deliveryID is the nonce; it must be unique per delivery and must be sent in
// the X-BeepBite-Delivery header. Retries of the SAME delivery deliberately
// reuse the same id: a receiver that already accepted it should treat the retry
// as the duplicate it is.
func Sign(secret, deliveryID string, body []byte, t time.Time) string {
	ts := strconv.FormatInt(t.Unix(), 10)
	return fmt.Sprintf("t=%s,v1=%s", ts, mac(secret, ts, deliveryID, body))
}

// mac computes the hex HMAC-SHA256 over "<ts>.<deliveryID>.<body>".
//
// The separators are what stop one field's contents from being read as part of
// its neighbour: without them a delivery id ending in digits could be shifted
// into the timestamp, and two different (ts, id) pairs would share a MAC.
func mac(secret, ts, deliveryID string, body []byte) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte(ts))
	m.Write([]byte("."))
	m.Write([]byte(deliveryID))
	m.Write([]byte("."))
	m.Write(body)
	return hex.EncodeToString(m.Sum(nil))
}

// Verify checks headerValue against body, and refuses a timestamp further than
// maxSkew from now in either direction.
//
// maxSkew must be > 0. A zero or negative value is rejected rather than read as
// "no limit": an unbounded window is the defect this function exists to close,
// and it must not be reachable by passing a zero value.
//
// Verify does NOT deduplicate. The caller must reject a repeated deliveryID
// seen within maxSkew; see the package comment.
func Verify(secret, deliveryID string, body []byte, headerValue string, maxSkew time.Duration, now time.Time) error {
	if maxSkew <= 0 {
		return fmt.Errorf("webhookdelivery: maxSkew must be positive, got %s", maxSkew)
	}

	ts, v1, err := parseSignatureHeader(headerValue)
	if err != nil {
		return err
	}

	// Compare the MAC before looking at the clock. The timestamp is only worth
	// reasoning about once we know the sender held the secret; checking skew
	// first would be answering "is this fresh?" about unauthenticated input.
	expected := mac(secret, strconv.FormatInt(ts, 10), deliveryID, body)
	if !hmac.Equal([]byte(v1), []byte(expected)) {
		return ErrSignatureMismatch
	}

	delta := now.Sub(time.Unix(ts, 0))
	if delta < 0 {
		delta = -delta
	}
	if delta > maxSkew {
		return fmt.Errorf("%w: off by %s (limit %s)", ErrTimestampSkew, delta.Truncate(time.Second), maxSkew)
	}
	return nil
}

// VerifyNow is Verify with the default window against the current clock.
func VerifyNow(secret, deliveryID string, body []byte, headerValue string) error {
	return Verify(secret, deliveryID, body, headerValue, DefaultMaxSkew, time.Now())
}

// parseSignatureHeader parses exactly "t=<unix>,v1=<hex>" and nothing else.
//
// The previous implementation scanned for "v1=" anywhere in the string and read
// the timestamp with Sscanf, so headers with reordered, repeated or trailing
// junk fields parsed successfully. A signature header is machine-generated and
// has one legal shape; anything else is refused rather than interpreted.
func parseSignatureHeader(h string) (ts int64, v1 string, err error) {
	tsPart, sigPart, found := strings.Cut(h, ",")
	if !found {
		return 0, "", fmt.Errorf("%w: want \"t=<unix>,v1=<hex>\"", ErrMalformedSignature)
	}
	rawTs, ok := strings.CutPrefix(tsPart, "t=")
	if !ok {
		return 0, "", fmt.Errorf("%w: missing t=", ErrMalformedSignature)
	}
	rawV1, ok := strings.CutPrefix(sigPart, "v1=")
	if !ok {
		return 0, "", fmt.Errorf("%w: missing v1=", ErrMalformedSignature)
	}

	ts, err = strconv.ParseInt(rawTs, 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("%w: bad timestamp", ErrMalformedSignature)
	}
	// A MAC is 32 bytes, so 64 hex chars. Checking the shape here keeps
	// hmac.Equal from being handed something that cannot possibly match, and
	// makes a truncated header a clear 400 rather than a confusing 401.
	if len(rawV1) != hex.EncodedLen(sha256.Size) {
		return 0, "", fmt.Errorf("%w: v1 must be %d hex chars, got %d",
			ErrMalformedSignature, hex.EncodedLen(sha256.Size), len(rawV1))
	}
	if _, err := hex.DecodeString(rawV1); err != nil {
		return 0, "", fmt.Errorf("%w: v1 is not hex", ErrMalformedSignature)
	}
	return ts, rawV1, nil
}
