package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// PostSignupHook is called after a new user is created (email/password signup
// and Google OAuth new-user path). profileID and email identify the new user.
// Returning an error is treated as a warning only — the signup response is
// already committed and must not be rolled back.
type PostSignupHook func(ctx context.Context, pool *pgxpool.Pool, profileID, email string) error

type Handler struct {
	svc    *Service
	google *Google

	// postAuthRedirect is where /auth/google/callback sends the browser after
	// a successful OAuth exchange. Tokens are appended as URL fragment so the
	// SPA can pick them up without exposing them in the Referer header.
	postAuthRedirect string

	// pool + postSignup are set via WithPool to call post-signup hooks
	// (e.g. driverinvite.AcceptMatchingInvites) without creating an import
	// cycle (driverinvite/handler.go already imports auth).
	pool       *pgxpool.Pool
	postSignup PostSignupHook

	// EmailNotifier, if non-nil, is called to send transactional emails.
	// The orchestrator wires this after construction:
	//
	//   authH.EmailNotifier = emailNotify
	//
	// where emailNotify is a closure that calls email.Render then Provider.Send.
	// Guard every call with `if h.EmailNotifier != nil`.
	EmailNotifier func(to, template string, data map[string]any)
}

func NewHandler(svc *Service, google *Google, postAuthRedirect string) *Handler {
	return &Handler{svc: svc, google: google, postAuthRedirect: postAuthRedirect}
}

// WithPool wires a pool and a post-signup hook into the handler.
// Both must be non-nil to activate the hook.
//
// FLAG for orchestrator — add this one call in cmd/server/main.go after
// constructing authH:
//
//	authH.WithPool(database.Pool, driverinvite.AcceptMatchingInvites)
//
// where driverinvite is "github.com/beepbite/backend/internal/handlers/driverinvite".
func (h *Handler) WithPool(pool *pgxpool.Pool, hook PostSignupHook) *Handler {
	h.pool = pool
	h.postSignup = hook
	return h
}

func (h *Handler) Mount(r chi.Router) {
	r.Post("/signup", h.signUp)
	r.Post("/signin", h.signIn)
	r.Post("/refresh", h.refresh)
	r.Post("/signout", h.signOut)

	r.Get("/google", h.googleStart)
	r.Get("/google/callback", h.googleCallback)

	// Password reset (public — no auth required).
	r.Post("/password/forgot", h.passwordForgot)
	r.Post("/password/reset", h.passwordReset)

	// Email verification.
	r.Post("/verify/send", h.verifySend)       // public (accepts {email}) or authed
	r.Post("/verify/confirm", h.verifyConfirm) // public

	r.Group(func(r chi.Router) {
		r.Use(Middleware(h.svc))
		r.Get("/me", h.me)
	})
}

// --- DTOs ---

type credentialsReq struct {
	Email    string         `json:"email"`
	Password string         `json:"password"`
	Meta     map[string]any `json:"meta,omitempty"`
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

type sessionResp struct {
	User         userDTO   `json:"user"`
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
	TokenType    string    `json:"token_type"`
}

type userDTO struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
}

func toUserDTO(u *User) userDTO {
	return userDTO{ID: u.ID, Email: u.Email, EmailVerified: u.EmailVerified}
}

// --- Email/password ---

func (h *Handler) signUp(w http.ResponseWriter, r *http.Request) {
	var req credentialsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	user, tp, err := h.svc.SignUp(r.Context(), req.Email, req.Password, req.Meta, r.UserAgent())
	if err != nil {
		switch {
		case errors.Is(err, ErrUserExists):
			writeErr(w, http.StatusConflict, "user already exists")
		default:
			writeErr(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	// Accept any pending driver invites for this email (non-fatal).
	if h.pool != nil && h.postSignup != nil {
		if err := h.postSignup(r.Context(), h.pool, user.ID, req.Email); err != nil {
			log.Printf("warn: accept driver invites: %v", err)
		}
	}
	// Fire a verification email for new email/password signups (non-blocking).
	// Signup/login are not gated on verification — the session is issued above.
	go h.sendVerifyEmail(context.Background(), user.ID, req.Email)
	writeJSON(w, http.StatusCreated, toSession(user, tp))
}

func (h *Handler) signIn(w http.ResponseWriter, r *http.Request) {
	var req credentialsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	user, tp, err := h.svc.SignIn(r.Context(), req.Email, req.Password, r.UserAgent())
	if err != nil {
		if errors.Is(err, ErrInvalidCredential) {
			writeErr(w, http.StatusUnauthorized, "invalid email or password")
			return
		}
		log.Printf("signIn: %v", err)
		writeErr(w, http.StatusInternalServerError, "signin failed")
		return
	}
	writeJSON(w, http.StatusOK, toSession(user, tp))
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.RefreshToken == "" {
		writeErr(w, http.StatusBadRequest, "refresh_token required")
		return
	}
	user, tp, err := h.svc.Refresh(r.Context(), req.RefreshToken, r.UserAgent())
	if err != nil {
		if errors.Is(err, ErrRefreshInvalid) || errors.Is(err, ErrRefreshReused) {
			writeErr(w, http.StatusUnauthorized, "invalid refresh token")
			return
		}
		log.Printf("refresh: %v", err)
		writeErr(w, http.StatusInternalServerError, "refresh failed")
		return
	}
	writeJSON(w, http.StatusOK, toSession(user, tp))
}

func (h *Handler) signOut(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	_ = decodeJSON(r, &req) // optional body
	if err := h.svc.SignOut(r.Context(), req.RefreshToken); err != nil {
		log.Printf("signOut: %v", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	claims, _ := ClaimsFrom(r.Context())
	user, err := h.svc.Store().FindByID(r.Context(), claims.UserID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, toUserDTO(user))
}

// --- Google OAuth ---

func (h *Handler) googleStart(w http.ResponseWriter, r *http.Request) {
	if !h.google.Configured() {
		writeErr(w, http.StatusServiceUnavailable, "google oauth not configured")
		return
	}
	state := randomState()
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(10 * time.Minute),
	})
	http.Redirect(w, r, h.google.AuthURL(state), http.StatusFound)
}

// redirectOAuthError bounces the user back to the SPA sign-in page with a
// short reason code in the query string. Falls back to a JSON 400 only when
// no SPA redirect base is configured (CLI/dev contexts).
func (h *Handler) redirectOAuthError(w http.ResponseWriter, r *http.Request, reason string) {
	if h.postAuthRedirect == "" {
		writeErr(w, http.StatusBadRequest, "oauth error: "+reason)
		return
	}
	base := h.postAuthRedirect
	if i := strings.Index(base, "/auth/callback"); i >= 0 {
		base = base[:i]
	}
	http.Redirect(w, r, base+"/signin?oauth_error="+url.QueryEscape(reason), http.StatusFound)
}

func (h *Handler) googleCallback(w http.ResponseWriter, r *http.Request) {
	if !h.google.Configured() {
		writeErr(w, http.StatusServiceUnavailable, "google oauth not configured")
		return
	}

	// Google sends ?error=access_denied when the user clicks Cancel on the
	// consent screen. Clear the one-shot state cookie and bounce them back
	// to the SPA sign-in page instead of leaving them on a JSON error.
	if oauthErr := r.URL.Query().Get("error"); oauthErr != "" {
		http.SetCookie(w, &http.Cookie{Name: "oauth_state", Value: "", Path: "/", MaxAge: -1})
		h.redirectOAuthError(w, r, oauthErr)
		return
	}

	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie("oauth_state")
	if err != nil || cookie.Value == "" || cookie.Value != state {
		h.redirectOAuthError(w, r, "invalid_state")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "oauth_state", Value: "", Path: "/", MaxAge: -1})

	code := r.URL.Query().Get("code")
	if code == "" {
		h.redirectOAuthError(w, r, "missing_code")
		return
	}
	profile, err := h.google.Exchange(r.Context(), code)
	if err != nil {
		log.Printf("google exchange: %v", err)
		h.redirectOAuthError(w, r, "exchange_failed")
		return
	}
	meta := map[string]any{
		"full_name":  profile.Name,
		"avatar_url": profile.Picture,
	}
	user, tp, err := h.svc.SignInGoogle(r.Context(), profile.Email, profile.Sub, meta, r.UserAgent())
	if err != nil {
		log.Printf("google signin: %v", err)
		h.redirectOAuthError(w, r, "signin_failed")
		return
	}
	// Accept any pending driver invites for this email (non-fatal).
	// SignInGoogle upserts, so this is safe to call on every OAuth login —
	// AcceptMatchingInvites is a no-op when there are no pending invites,
	// and its INSERT uses ON CONFLICT DO NOTHING for already-accepted rows.
	if h.pool != nil && h.postSignup != nil {
		if err := h.postSignup(r.Context(), h.pool, user.ID, profile.Email); err != nil {
			log.Printf("warn: accept driver invites (google): %v", err)
		}
	}

	if h.postAuthRedirect == "" {
		// No SPA redirect configured — respond with JSON (useful for CLI/dev).
		writeJSON(w, http.StatusOK, toSession(user, tp))
		return
	}

	// Append tokens in fragment so they aren't sent in Referer or logged server-side.
	redirect := h.postAuthRedirect + "#access_token=" + tp.AccessToken +
		"&refresh_token=" + tp.RefreshToken +
		"&expires_at=" + tp.ExpiresAt.UTC().Format(time.RFC3339)
	http.Redirect(w, r, redirect, http.StatusFound)
}

// --- Password reset ---

type forgotReq struct {
	Email string `json:"email"`
}

type resetReq struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// passwordForgot handles POST /auth/password/forgot.
// Always returns 200 — never reveals whether the email exists.
func (h *Handler) passwordForgot(w http.ResponseWriter, r *http.Request) {
	var req forgotReq
	if err := decodeJSON(r, &req); err != nil {
		// Still 200 — caller may be probing.
		writeJSON(w, http.StatusOK, map[string]string{"message": "if that email exists, a reset link has been sent"})
		return
	}
	go func() {
		ctx := context.Background()
		user, err := h.svc.Store().FindByEmail(ctx, req.Email)
		if err != nil {
			// User not found or other error — silently drop.
			return
		}
		raw, hash, err := newRawToken()
		if err != nil {
			log.Printf("passwordForgot: generate token: %v", err)
			return
		}
		expiresAt := time.Now().UTC().Add(60 * time.Minute)
		if err := h.svc.Store().InsertPasswordResetToken(ctx, user.ID, hash, expiresAt); err != nil {
			log.Printf("passwordForgot: insert token: %v", err)
			return
		}
		if h.EmailNotifier != nil {
			_, name, _ := h.svc.Store().FindByIDForEmail(ctx, user.ID)
			h.EmailNotifier(user.Email, "password_reset", map[string]any{
				"name":           name,
				"resetURL":       "/auth/update-password?token=" + raw,
				"expiresMinutes": 60,
			})
		}
	}()

	writeJSON(w, http.StatusOK, map[string]string{"message": "if that email exists, a reset link has been sent"})
}

// passwordReset handles POST /auth/password/reset.
func (h *Handler) passwordReset(w http.ResponseWriter, r *http.Request) {
	var req resetReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Token == "" {
		writeErr(w, http.StatusBadRequest, "token required")
		return
	}
	if len(req.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	hash := HashToken(req.Token)
	userID, expiresAt, consumedAt, err := h.svc.Store().FindPasswordResetToken(r.Context(), hash)
	if errors.Is(err, ErrRefreshInvalid) || err != nil {
		writeErr(w, http.StatusBadRequest, "invalid or unknown token")
		return
	}
	if consumedAt != nil {
		writeErr(w, http.StatusGone, "token already used")
		return
	}
	if time.Now().UTC().After(expiresAt) {
		writeErr(w, http.StatusGone, "token expired")
		return
	}

	pwHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("passwordReset: bcrypt: %v", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	if err := h.svc.Store().UpdatePassword(r.Context(), userID, string(pwHash)); err != nil {
		log.Printf("passwordReset: update password: %v", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	if err := h.svc.Store().ConsumePasswordResetToken(r.Context(), hash); err != nil {
		log.Printf("passwordReset: consume token: %v", err)
		// Non-fatal — password is already updated.
	}
	// Revoke all refresh tokens for the user so existing sessions are invalidated.
	h.svc.Store().RevokeAllForUser(r.Context(), userID)

	writeJSON(w, http.StatusOK, map[string]string{"message": "password updated"})
}

// --- Email verification ---

type verifyEmailReq struct {
	Email string `json:"email"`
}

type verifyConfirmReq struct {
	Token string `json:"token"`
}

// verifySend handles POST /auth/verify/send.
// Accepts either a JWT-authenticated request or a public {email} body.
func (h *Handler) verifySend(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var userID, email string

	// Try JWT auth first.
	if claims, ok := ClaimsFrom(ctx); ok && claims.UserID != "" {
		userID = claims.UserID
		var name string
		var err error
		email, name, err = h.svc.Store().FindByIDForEmail(ctx, userID)
		if err != nil {
			writeErr(w, http.StatusNotFound, "user not found")
			return
		}
		_ = name
	} else {
		// Fall back to public body.
		// We must not use decodeJSON (DisallowUnknownFields would reject tokens).
		var req verifyEmailReq
		if jsonErr := json.NewDecoder(r.Body).Decode(&req); jsonErr != nil || req.Email == "" {
			writeErr(w, http.StatusBadRequest, "email required")
			return
		}
		user, err := h.svc.Store().FindByEmail(ctx, req.Email)
		if err != nil {
			// Don't leak whether email exists.
			writeJSON(w, http.StatusOK, map[string]string{"message": "if that email exists, a verification link has been sent"})
			return
		}
		userID = user.ID
		email = user.Email
	}

	go h.sendVerifyEmail(context.Background(), userID, email)
	writeJSON(w, http.StatusOK, map[string]string{"message": "verification email sent"})
}

// verifyConfirm handles POST /auth/verify/confirm.
func (h *Handler) verifyConfirm(w http.ResponseWriter, r *http.Request) {
	var req verifyConfirmReq
	if err := decodeJSON(r, &req); err != nil || req.Token == "" {
		writeErr(w, http.StatusBadRequest, "token required")
		return
	}

	hash := HashToken(req.Token)
	userID, expiresAt, consumedAt, err := h.svc.Store().FindEmailVerificationToken(r.Context(), hash)
	if errors.Is(err, ErrTokenInvalid) || err != nil {
		writeErr(w, http.StatusBadRequest, "invalid or unknown token")
		return
	}
	if consumedAt != nil {
		writeErr(w, http.StatusGone, "token already used")
		return
	}
	if time.Now().UTC().After(expiresAt) {
		writeErr(w, http.StatusGone, "token expired")
		return
	}

	if err := h.svc.Store().ConsumeEmailVerificationToken(r.Context(), hash, userID); err != nil {
		log.Printf("verifyConfirm: consume: %v", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "email verified"})
}

// sendVerifyEmail is a shared helper (called from signUp and verifySend).
// It creates an email_verification_tokens row and fires EmailNotifier.
// Safe to call in a goroutine — all errors are logged and dropped.
func (h *Handler) sendVerifyEmail(ctx context.Context, userID, email string) {
	raw, hash, err := newRawToken()
	if err != nil {
		log.Printf("sendVerifyEmail: generate token: %v", err)
		return
	}
	expiresAt := time.Now().UTC().Add(24 * time.Hour)
	if err := h.svc.Store().InsertEmailVerificationToken(ctx, userID, hash, expiresAt); err != nil {
		log.Printf("sendVerifyEmail: insert token: %v", err)
		return
	}
	if h.EmailNotifier != nil {
		_, name, _ := h.svc.Store().FindByIDForEmail(ctx, userID)
		if name == "" {
			name = email
		}
		h.EmailNotifier(email, "verify_email", map[string]any{
			"name":      name,
			"verifyURL": "/auth/verify-email?token=" + raw,
		})
	}
}

// newRawToken returns (raw, sha256Hex) using the same mechanic as NewRefreshToken.
func newRawToken() (raw, hashed string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	hashed = HashToken(raw)
	return raw, hashed, nil
}

// --- helpers ---

func toSession(u *User, tp *TokenPair) sessionResp {
	return sessionResp{
		User:         toUserDTO(u),
		AccessToken:  tp.AccessToken,
		RefreshToken: tp.RefreshToken,
		ExpiresAt:    tp.ExpiresAt,
		TokenType:    tp.TokenType,
	}
}

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func randomState() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
