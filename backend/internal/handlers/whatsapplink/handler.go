// Package whatsapplink serves the WhatsApp number ↔ account binding endpoints.
//
// Mount in main.go / routes.go:
//
//	whatsappLinkH := whatsapplink.NewHandler(pool)
//
//	// Public (no auth) — reads the pending phone for a token:
//	r.Get("/link-whatsapp/{token}", whatsappLinkH.GetPhone)
//
//	// Authenticated — binds the phone to the caller's profile:
//	r.With(auth.Middleware(authSvc)).Post("/link-whatsapp/{token}", whatsappLinkH.Bind)
//
// Token issuance (called by the WhatsApp webhook, not mounted here):
//
//	tok, err := whatsappLinkH.Store().IssueLinkToken(ctx, phoneE164)
package whatsapplink

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler serves the WhatsApp link endpoints.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Store returns the underlying Store so callers (e.g. the WhatsApp webhook)
// can call IssueLinkToken without going through HTTP.
func (h *Handler) Store() *Store { return h.store }

// ---------------------------------------------------------------------------
// GET /link-whatsapp/{token} — PUBLIC
// ---------------------------------------------------------------------------

// GetPhone handles GET /link-whatsapp/{token}.
//
// Surface: PUBLIC (no auth required).
// Returns the phone number associated with the token so the frontend can
// display it before the user confirms the binding.
//
// Status codes:
//
//	200 — { token, phone_e164, expires_at }
//	404 — token not found
//	410 — token expired or already consumed
func (h *Handler) GetPhone(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token required")
		return
	}

	lt, err := h.store.GetPendingPhone(r.Context(), token)
	switch {
	case errors.Is(err, ErrTokenNotFound):
		writeError(w, http.StatusNotFound, "token not found")
		return
	case errors.Is(err, ErrTokenExpired), errors.Is(err, ErrTokenConsumed):
		writeError(w, http.StatusGone, "token expired or already used")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, lt)
}

// ---------------------------------------------------------------------------
// POST /link-whatsapp/{token} — AUTHENTICATED
// ---------------------------------------------------------------------------

// Bind handles POST /link-whatsapp/{token}.
//
// Surface: AUTHENTICATED (requires a valid bearer JWT; auth.Middleware must
// run before this handler).
// Binds the phone associated with token to the calling user's profile,
// enforcing the 3-number cap.
//
// Status codes:
//
//	201 — { id, profile_id, phone_e164, bound_at }  (binding created)
//	401 — missing / invalid bearer token
//	409 — phone already bound to another account (or cap exceeded — body says which)
//	410 — token expired or already consumed
//	500 — internal error
func (h *Handler) Bind(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil || claims.UserID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	token := chi.URLParam(r, "token")
	if token == "" {
		writeError(w, http.StatusBadRequest, "token required")
		return
	}

	link, err := h.store.BindPhone(r.Context(), token, claims.UserID)
	switch {
	case errors.Is(err, ErrTokenNotFound):
		writeError(w, http.StatusNotFound, "token not found")
		return
	case errors.Is(err, ErrTokenExpired), errors.Is(err, ErrTokenConsumed):
		writeError(w, http.StatusGone, "token expired or already used")
		return
	case errors.Is(err, ErrAtCap):
		writeError(w, http.StatusConflict, "you have already linked 3 WhatsApp numbers (maximum)")
		return
	case errors.Is(err, ErrDuplicatePhone):
		writeError(w, http.StatusConflict, "this phone number is already linked to an account")
		return
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusCreated, link)
}

// ---------------------------------------------------------------------------
// GET /link-whatsapp — AUTHENTICATED (manage-numbers view)
// ---------------------------------------------------------------------------

// ListLinks handles GET /link-whatsapp.
//
// Surface: AUTHENTICATED.
// Returns all WhatsApp numbers bound to the calling user's profile.
//
// Status codes:
//
//	200 — { links: [...] }
//	401 — missing / invalid bearer token
func (h *Handler) ListLinks(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil || claims.UserID == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	links, err := h.store.ListLinks(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"links": links})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
