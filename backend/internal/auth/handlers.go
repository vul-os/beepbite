package auth

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	svc    *Service
	google *Google

	// postAuthRedirect is where /auth/google/callback sends the browser after
	// a successful OAuth exchange. Tokens are appended as URL fragment so the
	// SPA can pick them up without exposing them in the Referer header.
	postAuthRedirect string
}

func NewHandler(svc *Service, google *Google, postAuthRedirect string) *Handler {
	return &Handler{svc: svc, google: google, postAuthRedirect: postAuthRedirect}
}

func (h *Handler) Mount(r chi.Router) {
	r.Post("/signup", h.signUp)
	r.Post("/signin", h.signIn)
	r.Post("/refresh", h.refresh)
	r.Post("/signout", h.signOut)

	r.Get("/google", h.googleStart)
	r.Get("/google/callback", h.googleCallback)

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
	User        userDTO    `json:"user"`
	AccessToken string     `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt   time.Time  `json:"expires_at"`
	TokenType   string     `json:"token_type"`
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

func (h *Handler) googleCallback(w http.ResponseWriter, r *http.Request) {
	if !h.google.Configured() {
		writeErr(w, http.StatusServiceUnavailable, "google oauth not configured")
		return
	}
	state := r.URL.Query().Get("state")
	cookie, err := r.Cookie("oauth_state")
	if err != nil || cookie.Value == "" || cookie.Value != state {
		writeErr(w, http.StatusBadRequest, "invalid oauth state")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "oauth_state", Value: "", Path: "/", MaxAge: -1})

	code := r.URL.Query().Get("code")
	if code == "" {
		writeErr(w, http.StatusBadRequest, "missing code")
		return
	}
	profile, err := h.google.Exchange(r.Context(), code)
	if err != nil {
		log.Printf("google exchange: %v", err)
		writeErr(w, http.StatusBadGateway, "google exchange failed")
		return
	}
	meta := map[string]any{
		"full_name":  profile.Name,
		"avatar_url": profile.Picture,
	}
	user, tp, err := h.svc.SignInGoogle(r.Context(), profile.Email, profile.Sub, meta, r.UserAgent())
	if err != nil {
		log.Printf("google signin: %v", err)
		writeErr(w, http.StatusInternalServerError, "signin failed")
		return
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
