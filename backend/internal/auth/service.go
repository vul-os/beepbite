package auth

import (
	"context"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// Service glues the store + token helpers + password hashing. Handlers call
// into these methods rather than touching the store directly.
type Service struct {
	store           *Store
	secret          string
	accessTTL       time.Duration
	refreshTTL      time.Duration
}

func NewService(store *Store, secret string, accessTTL, refreshTTL time.Duration) *Service {
	return &Service{store: store, secret: secret, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

func (s *Service) Store() *Store { return s.store }

func (s *Service) SignUp(ctx context.Context, email, password string, meta map[string]any, userAgent string) (*User, *TokenPair, error) {
	if len(password) < 8 {
		return nil, nil, errors.New("password must be at least 8 characters")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, nil, err
	}
	user, err := s.store.CreateEmailUser(ctx, email, string(hash), meta)
	if err != nil {
		return nil, nil, err
	}
	tp, err := s.issuePair(ctx, user, userAgent)
	if err != nil {
		return nil, nil, err
	}
	return user, tp, nil
}

func (s *Service) SignIn(ctx context.Context, email, password, userAgent string) (*User, *TokenPair, error) {
	user, err := s.store.FindByEmail(ctx, email)
	if errors.Is(err, ErrUserNotFound) {
		return nil, nil, ErrInvalidCredential
	}
	if err != nil {
		return nil, nil, err
	}
	if user.PasswordHash == nil {
		// OAuth-only account
		return nil, nil, ErrInvalidCredential
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(password)); err != nil {
		return nil, nil, ErrInvalidCredential
	}
	s.store.RecordSignIn(ctx, user.ID)
	tp, err := s.issuePair(ctx, user, userAgent)
	if err != nil {
		return nil, nil, err
	}
	return user, tp, nil
}

// SignInGoogle is called after an OAuth code exchange has yielded the Google
// identity. Upserts the user and issues a session.
func (s *Service) SignInGoogle(ctx context.Context, email, googleSub string, meta map[string]any, userAgent string) (*User, *TokenPair, error) {
	user, err := s.store.UpsertGoogleUser(ctx, email, googleSub, meta)
	if err != nil {
		return nil, nil, err
	}
	s.store.RecordSignIn(ctx, user.ID)
	tp, err := s.issuePair(ctx, user, userAgent)
	if err != nil {
		return nil, nil, err
	}
	return user, tp, nil
}

// Refresh rotates a refresh token. If the token has already been used (revoked
// with a replaced_by set) we treat it as a compromise and revoke every token
// for that user.
func (s *Service) Refresh(ctx context.Context, refreshRaw, userAgent string) (*User, *TokenPair, error) {
	hash := HashToken(refreshRaw)
	row, err := s.store.FindRefresh(ctx, hash)
	if err != nil {
		return nil, nil, err
	}
	now := time.Now().UTC()
	if now.After(row.ExpiresAt) {
		return nil, nil, ErrRefreshInvalid
	}
	if row.RevokedAt != nil {
		// Reuse detected — revoke every outstanding refresh for this user.
		s.store.RevokeAllForUser(ctx, row.UserID)
		return nil, nil, ErrRefreshReused
	}

	raw, newHash, err := NewRefreshToken()
	if err != nil {
		return nil, nil, err
	}
	if _, err := s.store.RotateRefresh(ctx, row.ID, row.UserID, newHash, userAgent, s.refreshTTL); err != nil {
		return nil, nil, err
	}

	user, err := s.store.FindByID(ctx, row.UserID)
	if err != nil {
		return nil, nil, err
	}
	access, exp, err := IssueAccess(user.ID, user.Email, s.secret, s.accessTTL)
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
	return s.store.RevokeRefresh(ctx, HashToken(refreshRaw))
}

func (s *Service) issuePair(ctx context.Context, u *User, userAgent string) (*TokenPair, error) {
	access, exp, err := IssueAccess(u.ID, u.Email, s.secret, s.accessTTL)
	if err != nil {
		return nil, err
	}
	raw, hash, err := NewRefreshToken()
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

// VerifyAccess is used by the auth middleware.
func (s *Service) VerifyAccess(token string) (*Claims, error) {
	return Parse(token, s.secret)
}
