package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testElevationSecret = "test-elevation-secret-key"

func sampleElevationClaims() ElevationToken {
	return ElevationToken{
		GrantedBy:         "mgr-0001-0000-0000-000000000000",
		GrantedCapability: "can_void",
		Action:            "void",
		TargetID:          "order-001-0000-0000-000000000000",
	}
}

// mintExpiredElevation builds a syntactically-valid HS256 elevation token whose
// ExpiresAt is in the past.
func mintExpiredElevation(t *testing.T, secret []byte) string {
	t.Helper()
	c := elevationClaims{
		GrantedBy:         "mgr",
		GrantedCapability: "can_void",
		Action:            "void",
		TargetID:          "order-x",
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{elevationAudience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-2 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-3 * time.Minute)),
			NotBefore: jwt.NewNumericDate(time.Now().Add(-3 * time.Minute)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	signed, err := tok.SignedString(secret)
	if err != nil {
		t.Fatalf("mintExpiredElevation: %v", err)
	}
	return signed
}

// TestElevationTokenRoundTrip mints a token and parses it back; all fields must
// survive the round-trip unchanged.
func TestElevationTokenRoundTrip(t *testing.T) {
	original := sampleElevationClaims()

	signed, err := MintElevationToken([]byte(testElevationSecret), original)
	if err != nil {
		t.Fatalf("MintElevationToken: %v", err)
	}
	if signed == "" {
		t.Fatal("MintElevationToken returned empty string")
	}

	parsed, err := ParseElevationToken([]byte(testElevationSecret), signed)
	if err != nil {
		t.Fatalf("ParseElevationToken: %v", err)
	}

	if parsed.GrantedBy != original.GrantedBy {
		t.Errorf("GrantedBy: got %q, want %q", parsed.GrantedBy, original.GrantedBy)
	}
	if parsed.GrantedCapability != original.GrantedCapability {
		t.Errorf("GrantedCapability: got %q, want %q", parsed.GrantedCapability, original.GrantedCapability)
	}
	if parsed.Action != original.Action {
		t.Errorf("Action: got %q, want %q", parsed.Action, original.Action)
	}
	if parsed.TargetID != original.TargetID {
		t.Errorf("TargetID: got %q, want %q", parsed.TargetID, original.TargetID)
	}
	if parsed.ExpiresAt.IsZero() {
		t.Error("ExpiresAt should not be zero")
	}
	// ExpiresAt should be approximately now+60s.
	wantExpiry := time.Now().Add(ElevationTTL)
	delta := wantExpiry.Sub(parsed.ExpiresAt)
	if delta < 0 {
		delta = -delta
	}
	if delta > 5*time.Second {
		t.Errorf("ExpiresAt not near expected: got %v, want ~%v", parsed.ExpiresAt, wantExpiry)
	}
}

// TestElevationTokenExpired verifies ErrElevationExpired is returned for a
// past-expiry token.
func TestElevationTokenExpired(t *testing.T) {
	signed := mintExpiredElevation(t, []byte(testElevationSecret))
	_, err := ParseElevationToken([]byte(testElevationSecret), signed)
	if err != ErrElevationExpired {
		t.Errorf("got %v, want ErrElevationExpired", err)
	}
}

// TestElevationTokenWrongSecret verifies ErrElevationInvalid for a bad key.
func TestElevationTokenWrongSecret(t *testing.T) {
	signed, err := MintElevationToken([]byte(testElevationSecret), sampleElevationClaims())
	if err != nil {
		t.Fatalf("MintElevationToken: %v", err)
	}
	_, err = ParseElevationToken([]byte("wrong-secret"), signed)
	if err != ErrElevationInvalid {
		t.Errorf("got %v, want ErrElevationInvalid", err)
	}
}

// TestElevationTokenWrongAudience verifies ErrElevationInvalid when the
// audience does not match elevationAudience.
func TestElevationTokenWrongAudience(t *testing.T) {
	c := elevationClaims{
		GrantedBy:         "mgr",
		GrantedCapability: "can_void",
		Action:            "void",
		TargetID:          "order-x",
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{"wrong-audience"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(60 * time.Second)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	signed, err := tok.SignedString([]byte(testElevationSecret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	_, err = ParseElevationToken([]byte(testElevationSecret), signed)
	if err != ErrElevationInvalid {
		t.Errorf("got %v, want ErrElevationInvalid", err)
	}
}

// TestElevationTokenMissingFields verifies ErrElevationInvalid when required
// fields are absent from the payload.
func TestElevationTokenMissingFields(t *testing.T) {
	// Token with empty GrantedBy.
	c := elevationClaims{
		GrantedBy:         "", // missing
		GrantedCapability: "can_void",
		Action:            "void",
		TargetID:          "order-x",
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{elevationAudience},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(60 * time.Second)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	signed, err := tok.SignedString([]byte(testElevationSecret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	_, err = ParseElevationToken([]byte(testElevationSecret), signed)
	if err != ErrElevationInvalid {
		t.Errorf("got %v, want ErrElevationInvalid", err)
	}
}

// TestTokenHash verifies the hash is consistent and non-empty.
func TestTokenHash(t *testing.T) {
	h1 := TokenHash("some.jwt.token")
	h2 := TokenHash("some.jwt.token")
	h3 := TokenHash("other.jwt.token")

	if h1 == "" {
		t.Fatal("TokenHash returned empty string")
	}
	if h1 != h2 {
		t.Error("TokenHash is not deterministic")
	}
	if h1 == h3 {
		t.Error("TokenHash should differ for different tokens")
	}
}
