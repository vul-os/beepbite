package staffauth

import (
	"context"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Service wires the store + token helpers + bcrypt compare. Mirrors the
// shape of internal/auth.Service so the code reads the same across both
// sign-in surfaces.
type Service struct {
	store      *Store
	secret     string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewService(store *Store, secret string, accessTTL, refreshTTL time.Duration) *Service {
	return &Service{store: store, secret: secret, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

func (s *Service) Store() *Store { return s.store }

// SignIn authenticates (location_id, username, password). A successful call:
//   - clears failed_login_attempts and locked_until
//   - stamps last_login_at
//   - returns the staff record + an access/refresh pair
//
// On failure we increment failed_login_attempts; past the threshold the staff
// row is locked for lockoutDuration. We deliberately return ErrInvalidCredential
// for every "it didn't work" branch (not-found, wrong password, inactive) so
// callers can't probe for valid usernames.
func (s *Service) SignIn(ctx context.Context, locationID, username, password, userAgent string) (*StaffUser, *TokenPair, error) {
	if locationID == "" || username == "" || password == "" {
		return nil, nil, ErrInvalidCredential
	}
	user, err := s.store.GetByUsername(ctx, locationID, username)
	if errors.Is(err, ErrStaffNotFound) {
		return nil, nil, ErrInvalidCredential
	}
	if err != nil {
		return nil, nil, err
	}
	if !user.IsActive {
		return nil, nil, ErrStaffInactive
	}
	if user.LockedUntil != nil && time.Now().UTC().Before(*user.LockedUntil) {
		return nil, nil, ErrStaffLocked
	}
	if user.PasswordHash == nil {
		// Staff row exists but no password has been set yet (manager hasn't
		// issued credentials). Treat as invalid — password-set flow goes via
		// the reset-token endpoint (not yet implemented).
		return nil, nil, ErrInvalidCredential
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(password)); err != nil {
		_ = s.store.IncrementFailedAttempts(ctx, user.ID)
		return nil, nil, ErrInvalidCredential
	}
	if err := s.store.ClearFailedAttempts(ctx, user.ID); err != nil {
		return nil, nil, err
	}
	if err := s.store.UpdateLastLogin(ctx, user.ID); err != nil {
		return nil, nil, err
	}
	tp, err := s.issuePair(ctx, user, userAgent)
	if err != nil {
		return nil, nil, err
	}
	return user, tp, nil
}

// Refresh rotates a refresh token. Reuse of an already-revoked token is
// treated as compromise: we revoke every outstanding refresh for the staff
// member and force them to log in again.
func (s *Service) Refresh(ctx context.Context, refreshRaw, userAgent string) (*StaffUser, *TokenPair, error) {
	if refreshRaw == "" {
		return nil, nil, ErrRefreshInvalid
	}
	hash := hashToken(refreshRaw)
	row, err := s.store.GetRefreshTokenByHash(ctx, hash)
	if err != nil {
		return nil, nil, err
	}
	now := time.Now().UTC()
	if now.After(row.ExpiresAt) {
		return nil, nil, ErrRefreshInvalid
	}
	if row.RevokedAt != nil {
		s.store.RevokeAllForStaff(ctx, row.StaffID)
		return nil, nil, ErrRefreshReused
	}

	raw, newHash, err := newRefreshToken()
	if err != nil {
		return nil, nil, err
	}
	if _, err := s.store.ReplaceRefreshToken(ctx, row.ID, row.StaffID, newHash, userAgent, s.refreshTTL); err != nil {
		return nil, nil, err
	}

	user, err := s.store.GetByID(ctx, row.StaffID)
	if err != nil {
		return nil, nil, err
	}
	access, exp, err := issueAccess(user.ID, user.LocationID, user.Role, s.secret, s.accessTTL)
	if err != nil {
		return nil, nil, err
	}
	return user, &TokenPair{
		AccessToken:  access,
		RefreshToken: raw,
		ExpiresAt:    exp,
		TokenType:    "Bearer",
	}, nil
}

func (s *Service) SignOut(ctx context.Context, refreshRaw string) error {
	if refreshRaw == "" {
		return nil
	}
	return s.store.RevokeRefreshToken(ctx, hashToken(refreshRaw))
}

// VerifyAccess is used by the staff middleware — validates signature, expiry,
// and the "staff" audience.
func (s *Service) VerifyAccess(token string) (*StaffClaims, error) {
	return parseAccess(token, s.secret)
}

func (s *Service) issuePair(ctx context.Context, u *StaffUser, userAgent string) (*TokenPair, error) {
	access, exp, err := issueAccess(u.ID, u.LocationID, u.Role, s.secret, s.accessTTL)
	if err != nil {
		return nil, err
	}
	raw, hash, err := newRefreshToken()
	if err != nil {
		return nil, err
	}
	if _, err := s.store.InsertRefreshToken(ctx, u.ID, hash, userAgent, s.refreshTTL); err != nil {
		return nil, err
	}
	return &TokenPair{
		AccessToken:  access,
		RefreshToken: raw,
		ExpiresAt:    exp,
		TokenType:    "Bearer",
	}, nil
}

// minPasswordLength is the floor for staff passwords. Kept deliberately
// simple — the PIN-login surface is what cashiers actually use all day, so
// we don't force complexity theatre on the one-time password reset.
const minPasswordLength = 8

// ErrPasswordTooShort surfaces as a 400 from the set-password handler. Kept
// separate from ErrInvalidCredential because this one is safe to tell the
// user — there's no enumeration risk in reporting "your password is weak".
var ErrPasswordTooShort = errors.New("password must be at least 8 characters")

// SetPassword consumes a staff_password_reset_tokens row and rotates the
// staff password. We revoke all outstanding refresh tokens in the same
// transaction so a stolen session can't survive a forced reset. No tokens
// are issued here — the client is expected to sign in fresh with the new
// password so the audit trail reflects an actual login event.
func (s *Service) SetPassword(ctx context.Context, resetTokenRaw, newPassword string) error {
	if resetTokenRaw == "" {
		return ErrResetTokenInvalid
	}
	if len(newPassword) < minPasswordLength {
		return ErrPasswordTooShort
	}
	row, err := s.store.GetResetTokenByHash(ctx, hashToken(resetTokenRaw))
	if err != nil {
		return err
	}
	if row.ConsumedAt != nil {
		return ErrResetTokenInvalid
	}
	if time.Now().UTC().After(row.ExpiresAt) {
		return ErrResetTokenInvalid
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.store.ConsumePasswordReset(ctx, row.ID, row.StaffID, string(hash))
}

// SignInWithPIN mirrors SignIn but checks pin_hash. The failed-attempt
// counter is shared with password login — five strikes across either
// credential lock the account — so a brute force on the 4-digit PIN can't
// be a side-channel past the password lockout.
func (s *Service) SignInWithPIN(ctx context.Context, locationID, username, pin, userAgent string) (*StaffUser, *TokenPair, error) {
	if locationID == "" || username == "" || pin == "" {
		return nil, nil, ErrInvalidCredential
	}
	user, err := s.store.GetByUsername(ctx, locationID, username)
	if errors.Is(err, ErrStaffNotFound) {
		return nil, nil, ErrInvalidCredential
	}
	if err != nil {
		return nil, nil, err
	}
	if !user.IsActive {
		return nil, nil, ErrStaffInactive
	}
	if user.LockedUntil != nil && time.Now().UTC().Before(*user.LockedUntil) {
		return nil, nil, ErrStaffLocked
	}
	if user.PinHash == nil {
		// PIN login not enabled for this staff. Collapsed into the generic
		// invalid-credential path so clients can't probe which accounts have
		// a PIN configured.
		return nil, nil, ErrInvalidCredential
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*user.PinHash), []byte(pin)); err != nil {
		_ = s.store.IncrementFailedAttempts(ctx, user.ID)
		return nil, nil, ErrInvalidCredential
	}
	if err := s.store.ClearFailedAttempts(ctx, user.ID); err != nil {
		return nil, nil, err
	}
	if err := s.store.UpdateLastLogin(ctx, user.ID); err != nil {
		return nil, nil, err
	}
	tp, err := s.issuePair(ctx, user, userAgent)
	if err != nil {
		return nil, nil, err
	}
	return user, tp, nil
}
