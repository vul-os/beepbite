package staffauth

// pin_verify.go — POST /pos/pin-verify
//
// Flow:
//  1. Caller must carry a valid member JWT (auth.Middleware already verified it).
//  2. Look up staff by (location_id, username).
//  3. Verify PIN via bcrypt; wrong PIN increments failed_login_attempts and
//     applies the 5-strike / 15-minute lockout from the shared counter.
//  4. On success, mint a 15-minute "actor-overlay" token via auth.IssueActorToken
//     carrying member_id, staff_id, location_id, and capabilities.
//  5. Write an audit_log row for every outcome (success and failure).
//
// The audit insert is attempted best-effort after the response is determined;
// a failure to audit does not change the HTTP status code.

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/beepbite/backend/internal/auth"
)

// actorOverlayTTL is the lifetime of the short-lived actor token. Deliberately
// short — it only needs to last for a single POS session handover.
const actorOverlayTTL = 15 * time.Minute

// PinVerifyRequest is the JSON body for POST /pos/pin-verify.
type PinVerifyRequest struct {
	Username   string `json:"username"`
	PIN        string `json:"pin"`
	LocationID string `json:"location_id"`
}

// PinVerifyResponse is returned on a successful PIN verify.
type PinVerifyResponse struct {
	ActorToken   string     `json:"actor_token"`
	ExpiresAt    time.Time  `json:"expires_at"`
	Staff        staffPVDTO `json:"staff"`
	Capabilities []string   `json:"capabilities"`
}

type staffPVDTO struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

// PinVerifyService holds the dependencies for the PIN-verify flow.
// It is intentionally a thin wrapper so the underlying Store is unchanged
// and tests can pass a pool directly.
type PinVerifyService struct {
	store  *Store
	secret []byte
	pool   *pgxpool.Pool
}

// NewPinVerifyService constructs a PinVerifyService. pool is used solely for
// the audit_log INSERT; all staff-row work goes through store.
func NewPinVerifyService(store *Store, secret string, pool *pgxpool.Pool) *PinVerifyService {
	return &PinVerifyService{store: store, secret: []byte(secret), pool: pool}
}

// Verify executes the PIN-verify flow described in the file-level comment.
// memberID is the subject from the caller's JWT (auth.Claims.UserID).
// memberCaps is the raw JSON from organization_members.capabilities for that member.
//
// On a PIN mismatch the function returns ErrInvalidCredential; callers map
// that to 401. The audit row is always written — failure rows use the
// "staff.pin_overlay_failed" action.
func (s *PinVerifyService) Verify(
	ctx context.Context,
	memberID string,
	memberCaps []byte,
	req PinVerifyRequest,
) (*PinVerifyResponse, error) {
	if req.LocationID == "" || req.Username == "" || req.PIN == "" {
		return nil, ErrInvalidCredential
	}

	user, err := s.store.GetByUsername(ctx, req.LocationID, req.Username)
	if errors.Is(err, ErrStaffNotFound) {
		// Don't leak whether the username exists.
		s.writeAudit(ctx, "", req.LocationID, "staff.pin_overlay_failed")
		return nil, ErrInvalidCredential
	}
	if err != nil {
		return nil, err
	}

	// Inactive staff cannot use the PIN overlay.
	if !user.IsActive {
		s.writeAudit(ctx, user.ID, req.LocationID, "staff.pin_overlay_failed")
		return nil, ErrStaffInactive
	}

	// Lockout check (shared counter with password login — same threshold/duration).
	if user.LockedUntil != nil && time.Now().UTC().Before(*user.LockedUntil) {
		s.writeAudit(ctx, user.ID, req.LocationID, "staff.pin_overlay_failed")
		return nil, ErrStaffLocked
	}

	if user.PinHash == nil {
		s.writeAudit(ctx, user.ID, req.LocationID, "staff.pin_overlay_failed")
		return nil, ErrInvalidCredential
	}

	// bcrypt compare — constant-time, intentionally slow.
	if err := bcrypt.CompareHashAndPassword([]byte(*user.PinHash), []byte(req.PIN)); err != nil {
		_ = s.store.IncrementFailedAttempts(ctx, user.ID)
		s.writeAudit(ctx, user.ID, req.LocationID, "staff.pin_overlay_failed")
		return nil, ErrInvalidCredential
	}

	// Success — clear the lockout counter.
	if err := s.store.ClearFailedAttempts(ctx, user.ID); err != nil {
		return nil, err
	}

	// Resolve capabilities: decode the member's jsonb, collect keys with value=true.
	caps := decodeCaps(memberCaps)

	// Mint the actor-overlay token using the shared auth package helper so
	// the T9.3 ActorOverlay middleware can parse it.
	tok, exp, err := auth.IssueActorToken(memberID, user.ID, req.LocationID, caps, s.secret, actorOverlayTTL)
	if err != nil {
		return nil, err
	}

	s.writeAudit(ctx, user.ID, req.LocationID, "staff.pin_overlay_verify")

	displayName := user.FirstName + " " + user.LastName

	return &PinVerifyResponse{
		ActorToken: tok,
		ExpiresAt:  exp,
		Staff: staffPVDTO{
			ID:          user.ID,
			DisplayName: displayName,
			Role:        user.Role,
		},
		Capabilities: caps,
	}, nil
}

// ---------------------------------------------------------------------------
// Capability helpers
// ---------------------------------------------------------------------------

// decodeCaps converts a capabilities JSONB object ({"can_pos":true, ...})
// into a slice of key strings. Non-boolean or false values are ignored.
func decodeCaps(raw []byte) []string {
	if len(raw) == 0 {
		return nil
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return nil
	}
	var caps []string
	for k, v := range obj {
		var b bool
		if err := json.Unmarshal(v, &b); err == nil && b {
			caps = append(caps, k)
		}
	}
	return caps
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

// writeAudit inserts a single audit_log row for a PIN-verify event.
// Errors are suppressed — audit failure must not affect the API response
// (best-effort semantics).
func (s *PinVerifyService) writeAudit(
	ctx context.Context,
	staffID string,
	locationID string,
	action string,
) {
	var staffIDVal any
	if staffID != "" {
		staffIDVal = staffID
	}

	_, _ = s.pool.Exec(ctx, `
INSERT INTO audit_log
    (actor_type, actor_id, action, entity_type, entity_id, location_id, metadata)
VALUES
    ('staff', $1, $2, 'staff', $1, $3::uuid, '{}')
`,
		staffIDVal,
		action,
		nullableUUID(locationID),
	)
}

// nullableUUID returns nil for an empty string so Postgres treats it as NULL.
func nullableUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}
