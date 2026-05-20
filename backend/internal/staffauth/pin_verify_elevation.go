package staffauth

// pin_verify_elevation.go — POST /pos/pin-verify-elevation
//
// Flow:
//  1. Caller must carry a valid member JWT (auth.Middleware already verified it).
//  2. Validate action and target_id are non-empty.
//  3. Look up the manager staff row by (location_id, username).
//  4. Verify the PIN matches the manager's pin_hash.
//  5. Confirm the manager has the required capability for the requested action.
//  6. Mint a 60-second single-use elevation token embedding
//     (granted_by, granted_capability, action, target_id).
//  7. Audit-log the elevation grant (best-effort).
//
// The caller (typically a cashier's browser) then includes the returned
// elevation_token in the X-Elevation-Token header of the privileged request.
// RequireCapabilityWithElevation middleware will validate and consume it there.

import (
	"context"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/beepbite/backend/internal/auth"
)

// actionCapabilityMap maps action names to the staff capability they require.
// Extend when new elevation-gated actions are added.
var actionCapabilityMap = map[string]string{
	"void":           "can_void",
	"refund":         "can_refund",
	"comp":           "can_comp",
	"price_override": "can_comp",
	"discount":       "can_comp",
}

// CapabilityForAction returns the required capability for the named action, or
// an empty string if the action is not recognised.
func CapabilityForAction(action string) string {
	return actionCapabilityMap[action]
}

// PinVerifyElevationRequest is the JSON body for POST /pos/pin-verify-elevation.
type PinVerifyElevationRequest struct {
	Username   string `json:"username"`
	PIN        string `json:"pin"`
	LocationID string `json:"location_id"`
	Action     string `json:"action"`
	TargetID   string `json:"target_id"` // UUID of the entity being acted upon
}

// PinVerifyElevationResponse is returned on a successful elevation grant.
type PinVerifyElevationResponse struct {
	ElevationToken    string    `json:"elevation_token"`
	ExpiresAt         time.Time `json:"expires_at"`
	ExpiresInSeconds  int       `json:"expires_in_seconds"`
	GrantedCapability string    `json:"granted_capability"`
	GrantedForAction  string    `json:"granted_for_action"`
	GrantedForTarget  string    `json:"granted_for_target"`
}

// managerElevationRoles is the set of staff roles that may approve elevation.
var managerElevationRoles = map[string]struct{}{
	"owner":   {},
	"manager": {},
	"admin":   {},
}

// PinVerifyElevationService handles the elevation PIN-verify flow.
// It deliberately reuses PinVerifyService's store and secret to avoid
// duplicating bcrypt / lockout logic.
type PinVerifyElevationService struct {
	store  *Store
	secret []byte
	pvSvc  *PinVerifyService
}

// NewPinVerifyElevationService constructs a PinVerifyElevationService.
func NewPinVerifyElevationService(pvSvc *PinVerifyService) *PinVerifyElevationService {
	return &PinVerifyElevationService{
		store:  pvSvc.store,
		secret: []byte(pvSvc.secret),
		pvSvc:  pvSvc,
	}
}

// VerifyElevation runs the elevation PIN-verify flow.
// Returns PinVerifyElevationResponse on success.
// Returns ErrInvalidCredential / ErrStaffLocked / ErrStaffInactive on auth failures.
// Returns ErrNotManager when the PIN owner lacks a manager role.
// Returns ErrCapabilityMissing when the manager doesn't have the required capability.
// Returns ErrUnknownAction when the action name isn't mapped to any capability.
func (s *PinVerifyElevationService) VerifyElevation(
	ctx context.Context,
	req PinVerifyElevationRequest,
) (*PinVerifyElevationResponse, error) {
	if req.LocationID == "" || req.Username == "" || req.PIN == "" {
		return nil, ErrInvalidCredential
	}
	if req.Action == "" {
		return nil, ErrUnknownAction
	}
	if req.TargetID == "" {
		return nil, ErrMissingTarget
	}

	requiredCap := CapabilityForAction(req.Action)
	if requiredCap == "" {
		return nil, ErrUnknownAction
	}

	user, err := s.store.GetByUsername(ctx, req.LocationID, req.Username)
	if errors.Is(err, ErrStaffNotFound) {
		s.pvSvc.writeAudit(ctx, "", req.LocationID, "staff.elevation_failed")
		return nil, ErrInvalidCredential
	}
	if err != nil {
		return nil, err
	}

	if !user.IsActive {
		s.pvSvc.writeAudit(ctx, user.ID, req.LocationID, "staff.elevation_failed")
		return nil, ErrStaffInactive
	}

	if user.LockedUntil != nil && time.Now().UTC().Before(*user.LockedUntil) {
		s.pvSvc.writeAudit(ctx, user.ID, req.LocationID, "staff.elevation_failed")
		return nil, ErrStaffLocked
	}

	// Only manager-level roles may grant elevation.
	if _, isManager := managerElevationRoles[user.Role]; !isManager {
		s.pvSvc.writeAudit(ctx, user.ID, req.LocationID, "staff.elevation_failed")
		return nil, ErrNotManager
	}

	if user.PinHash == nil {
		s.pvSvc.writeAudit(ctx, user.ID, req.LocationID, "staff.elevation_failed")
		return nil, ErrInvalidCredential
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*user.PinHash), []byte(req.PIN)); err != nil {
		_ = s.store.IncrementFailedAttempts(ctx, user.ID)
		s.pvSvc.writeAudit(ctx, user.ID, req.LocationID, "staff.elevation_failed")
		return nil, ErrInvalidCredential
	}

	// Success — clear lockout counter.
	if err := s.store.ClearFailedAttempts(ctx, user.ID); err != nil {
		return nil, err
	}

	// Check the manager actually has the capability.
	// We use the staff-level capabilities stored in the org membership for
	// this staff member's location. The capabilities here come from the
	// staff row's own capabilities (if set) or we use the role-based default.
	// For now we gate on role because staff rows don't carry per-row caps;
	// the OrgScope membership capabilities belong to the portal member, not
	// to the POS staff row. A future T9.x may add staff.capabilities jsonb.
	// Until then: owner/manager/admin implicitly carry all POS capabilities.
	// This matches the existing VerifyManagerPIN behaviour in adjustments/pin.go.

	signedTok, err := auth.MintElevationToken(s.secret, auth.ElevationToken{
		GrantedBy:         user.ID,
		GrantedCapability: requiredCap,
		Action:            req.Action,
		TargetID:          req.TargetID,
	})
	if err != nil {
		return nil, err
	}

	expiresAt := time.Now().UTC().Add(auth.ElevationTTL)

	s.pvSvc.writeAudit(ctx, user.ID, req.LocationID, "staff.elevation_granted")

	return &PinVerifyElevationResponse{
		ElevationToken:    signedTok,
		ExpiresAt:         expiresAt,
		ExpiresInSeconds:  int(auth.ElevationTTL.Seconds()),
		GrantedCapability: requiredCap,
		GrantedForAction:  req.Action,
		GrantedForTarget:  req.TargetID,
	}, nil
}

// ---------------------------------------------------------------------------
// Sentinel errors specific to elevation
// ---------------------------------------------------------------------------

// ErrNotManager is returned when the PIN-entering staff member does not hold a
// manager-level role (owner / manager / admin).
var ErrNotManager = errors.New("staff role does not permit elevation")

// ErrCapabilityMissing is reserved for future per-staff capability rows. Not
// currently reachable since role-based caps are used above.
var ErrCapabilityMissing = errors.New("manager does not have the required capability")

// ErrUnknownAction is returned when the requested action is not in the
// actionCapabilityMap.
var ErrUnknownAction = errors.New("unknown elevation action")

// ErrMissingTarget is returned when target_id is absent but required.
var ErrMissingTarget = errors.New("target_id is required for elevation")
