// Package twofa provides HTTP handlers for TOTP-based two-factor authentication.
//
// Routes (all require a valid JWT via auth.Middleware):
//
//	GET  /2fa/status   — current TOTP status for the caller
//	POST /2fa/enroll   — generate a TOTP secret, return otpauth:// URL
//	POST /2fa/verify   — validate a TOTP code, enable 2FA, return backup codes
//	POST /2fa/disable  — disable 2FA (requires a valid TOTP code or backup code)
//
// Encryption: TOTP secrets are encrypted via internal/secretbox using the env
// var TOTP_KEY_ENCRYPTION_SECRET (falls back to PAYMENT_KEY_ENCRYPTION_SECRET
// if not set — they share the same 32-byte AES key format).
package twofa

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/secretbox"
)

// Handler exposes the TOTP endpoints.
type Handler struct {
	store  *Store
	issuer string // shown in authenticator apps, e.g. "BeepBite"
}

// NewHandler constructs a Handler. It reads the encryption key from env;
// if unset, the enroll/verify/disable endpoints return 503 (not 500) so
// operators know it is a configuration issue.
func NewHandler(pool *pgxpool.Pool) *Handler {
	key := os.Getenv("TOTP_KEY_ENCRYPTION_SECRET")
	if key == "" {
		key = os.Getenv("PAYMENT_KEY_ENCRYPTION_SECRET")
	}
	var box *secretbox.Box
	if key != "" {
		b, err := secretbox.New(key)
		if err == nil {
			box = b
		}
	}
	return &Handler{
		store:  NewStore(pool, box),
		issuer: "BeepBite",
	}
}

// Mount registers all 2FA routes on r.
// Wire after auth.Middleware so ClaimsFrom is populated.
//
//	r.Mount("/2fa", twofa.NewHandler(pool).Mount)
func (h *Handler) Mount(r chi.Router) {
	r.Get("/status", h.status)
	r.Post("/enroll", h.enroll)
	r.Post("/verify", h.verify)
	r.Post("/disable", h.disable)
}

// ---------------------------------------------------------------------------
// GET /2fa/status
// ---------------------------------------------------------------------------

func (h *Handler) status(w http.ResponseWriter, r *http.Request) {
	userID := mustUserID(w, r)
	if userID == "" {
		return
	}

	st, err := h.store.GetStatus(r.Context(), userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// ---------------------------------------------------------------------------
// POST /2fa/enroll — generate TOTP secret, persist encrypted, return otpauth URL
// ---------------------------------------------------------------------------

type enrollResp struct {
	OTPAuthURL string `json:"otpauth_url"`
	// The handler also returns the account label for display
	AccountName string `json:"account_name"`
}

func (h *Handler) enroll(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil || claims.UserID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID := claims.UserID
	email := claims.Email

	if h.store.box == nil {
		writeErr(w, http.StatusServiceUnavailable,
			"TOTP encryption key not configured (TOTP_KEY_ENCRYPTION_SECRET)")
		return
	}

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      h.issuer,
		AccountName: email,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "failed to generate TOTP secret")
		return
	}

	if err := h.store.StorePendingSecret(r.Context(), userID, key.Secret()); err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			writeErr(w, http.StatusNotFound, "user not found")
		case errors.Is(err, ErrNoBox):
			writeErr(w, http.StatusServiceUnavailable, "encryption not configured")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, enrollResp{
		OTPAuthURL:  key.URL(),
		AccountName: email,
	})
}

// ---------------------------------------------------------------------------
// POST /2fa/verify — validate TOTP code, set totp_enabled, return backup codes
// ---------------------------------------------------------------------------

type verifyReq struct {
	Code string `json:"code"`
}

type verifyResp struct {
	BackupCodes []string `json:"backup_codes"`
}

func (h *Handler) verify(w http.ResponseWriter, r *http.Request) {
	userID := mustUserID(w, r)
	if userID == "" {
		return
	}

	var req verifyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.Code == "" {
		writeErr(w, http.StatusBadRequest, "code is required")
		return
	}

	secret, err := h.store.LoadPendingSecret(r.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrTOTPNotEnrolled):
			writeErr(w, http.StatusBadRequest, "no pending TOTP enrollment; call /2fa/enroll first")
		case errors.Is(err, ErrUserNotFound):
			writeErr(w, http.StatusNotFound, "user not found")
		case errors.Is(err, ErrNoBox):
			writeErr(w, http.StatusServiceUnavailable, "encryption not configured")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	if !totp.Validate(req.Code, secret) {
		writeErr(w, http.StatusUnauthorized, "invalid TOTP code")
		return
	}

	codes, err := h.store.EnableTOTP(r.Context(), userID)
	if err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			writeErr(w, http.StatusNotFound, "user not found")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, verifyResp{BackupCodes: codes})
}

// ---------------------------------------------------------------------------
// POST /2fa/disable — disable TOTP (requires a valid code or backup code)
// ---------------------------------------------------------------------------

type disableReq struct {
	Code       string `json:"code"`        // TOTP code from app
	BackupCode string `json:"backup_code"` // one-time backup code
}

func (h *Handler) disable(w http.ResponseWriter, r *http.Request) {
	userID := mustUserID(w, r)
	if userID == "" {
		return
	}

	var req disableReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	if req.Code == "" && req.BackupCode == "" {
		writeErr(w, http.StatusBadRequest, "code or backup_code is required")
		return
	}

	// Validate via TOTP code or backup code.
	if req.Code != "" {
		secret, err := h.store.LoadPendingSecret(r.Context(), userID)
		if err != nil {
			switch {
			case errors.Is(err, ErrTOTPNotEnrolled):
				writeErr(w, http.StatusBadRequest, "TOTP not enrolled")
			case errors.Is(err, ErrUserNotFound):
				writeErr(w, http.StatusNotFound, "user not found")
			default:
				writeErr(w, http.StatusInternalServerError, err.Error())
			}
			return
		}
		if !totp.Validate(req.Code, secret) {
			writeErr(w, http.StatusUnauthorized, "invalid TOTP code")
			return
		}
	} else {
		// Backup code path.
		if err := h.store.RedeemBackupCode(r.Context(), userID, req.BackupCode); err != nil {
			switch {
			case errors.Is(err, ErrBackupCodeBad):
				writeErr(w, http.StatusUnauthorized, "backup code not found or already used")
			default:
				writeErr(w, http.StatusInternalServerError, err.Error())
			}
			return
		}
	}

	if err := h.store.DisableTOTP(r.Context(), userID); err != nil {
		switch {
		case errors.Is(err, ErrUserNotFound):
			writeErr(w, http.StatusNotFound, "user not found")
		default:
			writeErr(w, http.StatusInternalServerError, err.Error())
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// mustUserID extracts the UserID from JWT claims, writes 401 and returns ""
// if claims are absent.
func mustUserID(w http.ResponseWriter, r *http.Request) string {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil || claims.UserID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return ""
	}
	return claims.UserID
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
