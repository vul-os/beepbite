package payments

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"
)

// ReturnTokenTTL bounds how long a gateway return-URL token stays valid after
// Charge mints it. A pay link that is never used (browser closed mid-flow,
// tab abandoned, bookmarked and revisited weeks later) must not remain a
// forever-valid "settle this order" credential.
const ReturnTokenTTL = 2 * time.Hour

// SignReturnToken mints a tamper-evident, time-limited token binding orderID
// to this deployment's secret, for the ?ott= query parameter on the gateway
// return URL (ChargeRequest.ReturnURL — see that field's doc comment for the
// verify-on-return model this supports). The caller supplies secret (in
// practice cfg.JWTSecret — see cmd/server/main.go — reused rather than
// inventing a second required env var; a distinct secret would be strictly
// better isolation but is not worth a new required config knob for a token
// that only ever names an order id, never authenticates a user).
//
// This is deliberately NOT a JWT: the repo already carries golang-jwt for
// user-session claims, but a single non-negotiable "which order" fact needs
// none of that header/claims machinery — an HMAC-SHA256 over "orderID.expiry"
// is the whole job.
func SignReturnToken(secret, orderID string) string {
	exp := time.Now().Add(ReturnTokenTTL).Unix()
	payload := orderID + "." + strconv.FormatInt(exp, 10)
	sig := hmac.New(sha256.New, []byte(secret))
	sig.Write([]byte(payload))
	return b64(payload) + "." + b64(string(sig.Sum(nil)))
}

// VerifyReturnToken checks that token was minted by SignReturnToken with this
// secret and has not expired, returning the orderID it names. Fails closed
// (ok=false) on any parse error, signature mismatch or expiry — an invalid or
// stale token is never treated as naming a real order; the caller
// (marketplace/payreturn.go) must reject the request outright rather than
// guess.
func VerifyReturnToken(secret, token string) (orderID string, ok bool) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return "", false
	}
	payloadRaw, err := unb64(parts[0])
	if err != nil {
		return "", false
	}
	sigRaw, err := unb64(parts[1])
	if err != nil {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payloadRaw))
	if !hmac.Equal([]byte(sigRaw), mac.Sum(nil)) {
		return "", false
	}

	fields := strings.SplitN(payloadRaw, ".", 2)
	if len(fields) != 2 {
		return "", false
	}
	expUnix, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return "", false
	}
	if time.Now().Unix() > expUnix {
		return "", false
	}
	return fields[0], true
}

func b64(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }

func unb64(s string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	return string(raw), err
}
