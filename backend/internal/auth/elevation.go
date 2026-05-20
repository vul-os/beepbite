// Package auth — manager-elevation token (T9.5e).
//
// An elevation token is a short-lived (60-second), single-use JWT that a
// manager mints by entering their PIN. The cashier submits it in the
// X-Elevation-Token header to perform a single privileged operation they
// would otherwise lack the capability for.
//
// Single-use enforcement uses the elevation_tokens_used Postgres table.
// The token hash (SHA-256 of the raw JWT) is stored there atomically before
// the guarded handler executes; a second submission of the same JWT will find
// the hash already present and return ErrElevationUsed.
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Public sentinels
// ---------------------------------------------------------------------------

var (
	// ErrElevationExpired is returned when the token's ExpiresAt is in the past.
	ErrElevationExpired = errors.New("elevation token expired")

	// ErrElevationUsed is returned when the token hash is already present in
	// the elevation_tokens_used table (replay attempt).
	ErrElevationUsed = errors.New("elevation token already used")

	// ErrElevationMismatch is returned when the token's Action or TargetID does
	// not match the current request context.
	ErrElevationMismatch = errors.New("elevation token action/target mismatch")

	// ErrElevationInvalid is returned for any structural/signature failure.
	ErrElevationInvalid = errors.New("elevation token invalid")
)

// ---------------------------------------------------------------------------
// Token type
// ---------------------------------------------------------------------------

// ElevationToken carries the claims embedded in a manager-elevation JWT.
// All UUID fields are strings (project-wide convention).
type ElevationToken struct {
	// GrantedBy is the staff_id of the manager who approved the elevation.
	GrantedBy string
	// GrantedCapability is the single capability being elevated (e.g. "can_void").
	GrantedCapability string
	// Action is the operation being approved (e.g. "void").
	Action string
	// TargetID is the entity UUID the action operates on (e.g. an order_id).
	TargetID string
	// ExpiresAt is when the token becomes invalid (60 s after minting).
	ExpiresAt time.Time
}

// elevationAudience is the JWT audience string that separates elevation tokens
// from actor-overlay tokens ("actor-overlay") and staff session tokens ("staff").
const elevationAudience = "manager-elevation"

// ElevationTTL is the maximum life of a single-use elevation token.
const ElevationTTL = 60 * time.Second

// elevationClaims is the internal JWT claim set. Not exported — callers use
// ElevationToken.
type elevationClaims struct {
	GrantedBy         string `json:"granted_by"`
	GrantedCapability string `json:"granted_capability"`
	Action            string `json:"action"`
	TargetID          string `json:"target_id"`
	jwt.RegisteredClaims
}

// ---------------------------------------------------------------------------
// Mint / Parse
// ---------------------------------------------------------------------------

// MintElevationToken signs a new elevation JWT with the supplied HMAC secret.
// ExpiresAt in claims is ignored; the TTL is always ElevationTTL from now.
func MintElevationToken(secret []byte, claims ElevationToken) (string, error) {
	now := time.Now().UTC()
	exp := now.Add(ElevationTTL)

	c := elevationClaims{
		GrantedBy:         claims.GrantedBy,
		GrantedCapability: claims.GrantedCapability,
		Action:            claims.Action,
		TargetID:          claims.TargetID,
		RegisteredClaims: jwt.RegisteredClaims{
			Audience:  jwt.ClaimStrings{elevationAudience},
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
			NotBefore: jwt.NewNumericDate(now),
		},
	}

	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, c)
	signed, err := tok.SignedString(secret)
	if err != nil {
		return "", fmt.Errorf("mint elevation token: %w", err)
	}
	return signed, nil
}

// ParseElevationToken validates the signature, expiry, and audience of an
// elevation JWT and returns the embedded ElevationToken.
//
// It does NOT check single-use status — that requires a DB round-trip and is
// performed by ConsumeElevationToken. Parse is intentionally cheap and
// stateless so it can be called in middleware without touching the DB when the
// token is already structurally invalid.
func ParseElevationToken(secret []byte, signedJWT string) (ElevationToken, error) {
	c := &elevationClaims{}
	tok, err := jwt.ParseWithClaims(signedJWT, c, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("elevation token: unexpected signing method %v", t.Header["alg"])
		}
		return secret, nil
	}, jwt.WithAudience(elevationAudience))

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return ElevationToken{}, ErrElevationExpired
		}
		return ElevationToken{}, ErrElevationInvalid
	}
	if !tok.Valid {
		return ElevationToken{}, ErrElevationInvalid
	}
	if c.GrantedBy == "" || c.GrantedCapability == "" || c.Action == "" {
		return ElevationToken{}, ErrElevationInvalid
	}

	return ElevationToken{
		GrantedBy:         c.GrantedBy,
		GrantedCapability: c.GrantedCapability,
		Action:            c.Action,
		TargetID:          c.TargetID,
		ExpiresAt:         c.RegisteredClaims.ExpiresAt.Time,
	}, nil
}

// ---------------------------------------------------------------------------
// Single-use enforcement
// ---------------------------------------------------------------------------

// TokenHash returns the hex-encoded SHA-256 of signedJWT. Used as the
// deduplication key in elevation_tokens_used.
func TokenHash(signedJWT string) string {
	h := sha256.Sum256([]byte(signedJWT))
	return hex.EncodeToString(h[:])
}

// ConsumeElevationToken attempts to mark a token as used in the
// elevation_tokens_used table. It is idempotent in the sense that a second
// call for the same token returns ErrElevationUsed rather than inserting a
// duplicate row (the table has a UNIQUE constraint on token_hash).
//
// The INSERT uses ON CONFLICT DO NOTHING and checks RowsAffected to detect
// replay without relying on a database error code, making it portable across
// Postgres versions and less likely to break on future schema changes.
func ConsumeElevationToken(ctx context.Context, pool *pgxpool.Pool, signedJWT string) error {
	hash := TokenHash(signedJWT)
	ct, err := pool.Exec(ctx, `
INSERT INTO elevation_tokens_used (token_hash, used_at)
VALUES ($1, now())
ON CONFLICT (token_hash) DO NOTHING
`, hash)
	if err != nil {
		return fmt.Errorf("consume elevation token: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrElevationUsed
	}
	return nil
}

// ---------------------------------------------------------------------------
// DB row cleanup helper (optional, for tests / maintenance)
// ---------------------------------------------------------------------------

// IsElevationTokenUsed returns true if the token hash is already present in
// elevation_tokens_used. Used by tests; production code calls
// ConsumeElevationToken instead.
func IsElevationTokenUsed(ctx context.Context, pool *pgxpool.Pool, signedJWT string) (bool, error) {
	hash := TokenHash(signedJWT)
	var exists bool
	err := pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM elevation_tokens_used WHERE token_hash = $1)`,
		hash,
	).Scan(&exists)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return exists, err
}

// ---------------------------------------------------------------------------
// ElevationChecker implementation
// ---------------------------------------------------------------------------

// PoolElevationChecker is the production ElevationChecker that validates and
// consumes elevation tokens using a Postgres pool. Implements
// auth.ElevationChecker.
type PoolElevationChecker struct {
	Pool   *pgxpool.Pool
	Secret []byte
}

// CheckElevation validates the elevation token's signature, expiry, capability,
// action, and target, then consumes it atomically via ConsumeElevationToken.
//
// Returns the granting manager's staff_id on success.
// Returns one of ErrElevationExpired, ErrElevationUsed, ErrElevationMismatch,
// or ErrElevationInvalid on failure.
func (c *PoolElevationChecker) CheckElevation(ctx context.Context, rawToken, capability, action, targetID string) (string, error) {
	et, err := ParseElevationToken(c.Secret, rawToken)
	if err != nil {
		// Propagate ErrElevationExpired or ErrElevationInvalid unchanged.
		return "", err
	}

	// Capability must match.
	if et.GrantedCapability != capability {
		return "", ErrElevationMismatch
	}

	// Action must match (case-sensitive).
	if et.Action != action {
		return "", ErrElevationMismatch
	}

	// TargetID must match when the caller specifies one.
	if targetID != "" && et.TargetID != targetID {
		return "", ErrElevationMismatch
	}

	// Mark used — this is the single-use gate.
	if err := ConsumeElevationToken(ctx, c.Pool, rawToken); err != nil {
		// ConsumeElevationToken returns ErrElevationUsed on replay.
		return "", err
	}

	return et.GrantedBy, nil
}
