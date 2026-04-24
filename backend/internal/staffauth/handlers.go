package staffauth

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Mount attaches the staff auth routes. Call under a chi.Route("/auth", ...)
// block alongside the email auth handler; Mount uses relative paths so the
// final routes are /auth/staff/login, /auth/staff/refresh, etc.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/staff", func(r chi.Router) {
		r.Post("/login", h.login)
		r.Post("/pin-login", h.pinLogin)
		r.Post("/refresh", h.refresh)
		r.Post("/logout", h.logout)
		r.Post("/set-password", h.setPassword)

		r.Group(func(r chi.Router) {
			r.Use(RequireStaff(h.svc))
			r.Get("/me", h.me)
		})
	})
}

// --- DTOs ---

type loginReq struct {
	LocationID string `json:"location_id"`
	Username   string `json:"username"`
	Password   string `json:"password"`
}

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

type pinLoginReq struct {
	LocationID string `json:"location_id"`
	Username   string `json:"username"`
	PIN        string `json:"pin"`
}

type setPasswordReq struct {
	ResetToken  string `json:"reset_token"`
	NewPassword string `json:"new_password"`
}

type sessionResp struct {
	Staff        staffDTO  `json:"staff"`
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"access_expires_at"`
	TokenType    string    `json:"token_type"`
}

type staffDTO struct {
	ID                 string  `json:"id"`
	LocationID         string  `json:"location_id"`
	Username           *string `json:"username"`
	FirstName          string  `json:"first_name"`
	LastName           string  `json:"last_name"`
	Role               string  `json:"role"`
	IsActive           bool    `json:"is_active"`
	MustChangePassword bool    `json:"must_change_password"`
}

func toStaffDTO(u *StaffUser) staffDTO {
	return staffDTO{
		ID:                 u.ID,
		LocationID:         u.LocationID,
		Username:           u.Username,
		FirstName:          u.FirstName,
		LastName:           u.LastName,
		Role:               u.Role,
		IsActive:           u.IsActive,
		MustChangePassword: u.MustChangePassword,
	}
}

func toSession(u *StaffUser, tp *TokenPair) sessionResp {
	return sessionResp{
		Staff:        toStaffDTO(u),
		AccessToken:  tp.AccessToken,
		RefreshToken: tp.RefreshToken,
		ExpiresAt:    tp.ExpiresAt,
		TokenType:    tp.TokenType,
	}
}

// --- Handlers ---

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	var req loginReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}
	user, tp, err := h.svc.SignIn(r.Context(), req.LocationID, req.Username, req.Password, r.UserAgent())
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidCredential):
			writeErr(w, http.StatusUnauthorized, "invalid username or password")
		case errors.Is(err, ErrStaffLocked):
			writeErr(w, http.StatusLocked, "account is temporarily locked")
		case errors.Is(err, ErrStaffInactive):
			writeErr(w, http.StatusForbidden, "account is inactive")
		default:
			log.Printf("staff login: %v", err)
			writeErr(w, http.StatusInternalServerError, "login failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, toSession(user, tp))
}

// pinLogin authenticates a cashier against staff.pin_hash. Same response
// shape as /login so register clients can reuse a single sign-in flow.
func (h *Handler) pinLogin(w http.ResponseWriter, r *http.Request) {
	var req pinLoginReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}
	user, tp, err := h.svc.SignInWithPIN(r.Context(), req.LocationID, req.Username, req.PIN, r.UserAgent())
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidCredential):
			writeErr(w, http.StatusUnauthorized, "invalid username or pin")
		case errors.Is(err, ErrStaffLocked):
			writeErr(w, http.StatusLocked, "account is temporarily locked")
		case errors.Is(err, ErrStaffInactive):
			writeErr(w, http.StatusForbidden, "account is inactive")
		default:
			log.Printf("staff pin-login: %v", err)
			writeErr(w, http.StatusInternalServerError, "login failed")
		}
		return
	}
	writeJSON(w, http.StatusOK, toSession(user, tp))
}

// setPassword consumes a staff_password_reset_tokens row and rotates the
// password. Responds 204 with no body — the client is expected to redirect
// to the login screen so the next access/refresh pair is tied to an actual
// authenticated sign-in.
func (h *Handler) setPassword(w http.ResponseWriter, r *http.Request) {
	var req setPasswordReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.ResetToken == "" {
		writeErr(w, http.StatusBadRequest, "reset_token required")
		return
	}
	if err := h.svc.SetPassword(r.Context(), req.ResetToken, req.NewPassword); err != nil {
		switch {
		case errors.Is(err, ErrPasswordTooShort):
			writeErr(w, http.StatusBadRequest, err.Error())
		case errors.Is(err, ErrResetTokenInvalid):
			writeErr(w, http.StatusUnauthorized, "invalid username or password")
		default:
			log.Printf("staff set-password: %v", err)
			writeErr(w, http.StatusInternalServerError, "set password failed")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
		log.Printf("staff refresh: %v", err)
		writeErr(w, http.StatusInternalServerError, "refresh failed")
		return
	}
	writeJSON(w, http.StatusOK, toSession(user, tp))
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	var req refreshReq
	_ = decodeJSON(r, &req) // optional body
	if err := h.svc.SignOut(r.Context(), req.RefreshToken); err != nil {
		log.Printf("staff logout: %v", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	claims, ok := FromContext(r.Context())
	if !ok {
		writeErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	user, err := h.svc.Store().GetByID(r.Context(), claims.StaffID)
	if err != nil {
		writeErr(w, http.StatusNotFound, "staff not found")
		return
	}
	writeJSON(w, http.StatusOK, toStaffDTO(user))
}

// --- JSON helpers ---
//
// decodeJSON/writeJSON/writeErr are duplicated from internal/auth because
// they're private there and the prompt asked us not to depend on that
// package. They're three lines each — a shared "httpx" package would be
// overkill for this surface.

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
