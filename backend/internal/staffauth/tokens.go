package staffauth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// staffAudience distinguishes staff tokens from email-auth tokens, which use
// the same signing secret. A token issued for an auth_user will fail the
// audience check here, and vice versa — so a stolen access token can't be
// reused across surfaces.
const staffAudience = "staff"

// StaffClaims are the JWT claims embedded in a staff access token. StaffID
// doubles as `sub`, but we keep the explicit field too so handlers don't
// have to remember what `sub` means in this package.
type StaffClaims struct {
	StaffID    string `json:"staff_id"`
	LocationID string `json:"location_id"`
	Role       string `json:"role"`
	jwt.RegisteredClaims
}

type TokenPair struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"`
}

// issueAccess signs a short-lived HS256 JWT with audience "staff".
func issueAccess(staffID, locationID, role, secret string, ttl time.Duration) (string, time.Time, error) {
	now := time.Now().UTC()
	exp := now.Add(ttl)
	claims := StaffClaims{
		StaffID:    staffID,
		LocationID: locationID,
		Role:       role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   staffID,
			Audience:  jwt.ClaimStrings{staffAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			NotBefore: jwt.NewNumericDate(now),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		return "", time.Time{}, err
	}
	return s, exp, nil
}

// parseAccess validates the signature, expiry, and audience of a staff JWT.
func parseAccess(token, secret string) (*StaffClaims, error) {
	claims := &StaffClaims{}
	_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if claims.StaffID == "" {
		return nil, fmt.Errorf("token missing staff_id")
	}
	// Enforce audience manually — jwt/v5's default verification treats an
	// empty expected audience as "any" which would let email-auth tokens in.
	if !hasAudience(claims.Audience, staffAudience) {
		return nil, fmt.Errorf("token audience mismatch")
	}
	return claims, nil
}

func hasAudience(got jwt.ClaimStrings, want string) bool {
	for _, a := range got {
		if a == want {
			return true
		}
	}
	return false
}

// newRefreshToken returns (raw, sha256Hex). The raw form goes to the client;
// the hash is what we store in staff_refresh_tokens. Mirrors internal/auth
// so the rotation logic reads the same.
func newRefreshToken() (raw, hashed string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	hashed = hashToken(raw)
	return raw, hashed, nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
