// Package userprefs exposes two JWT-authenticated endpoints for per-user
// workspace view preferences (Wave 35 / Now-27).
//
// Wire in main.go after auth.Middleware + auth.RequireOrgScope:
//
//	prefsH := userprefs.NewHandler(pool)
//	prefsH.Mount(r)   // registers GET /me/preferences and PUT /me/preferences
//
// GET /me/preferences  — returns the caller's current preference row (404 when
//
//	none exists yet; the frontend falls back to localStorage in that case).
//
// PUT /me/preferences  — upserts the preference row; body is JSON with any
//
//	subset of { last_view_pos, last_view_kds }.
//
// Both endpoints require auth.Middleware (Bearer JWT). The UserID from Claims
// is used as profile_id so every user sees only their own row; RLS enforces
// this at the DB layer too.
package userprefs

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler serves GET /me/preferences and PUT /me/preferences.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers the preference routes on r.
// r must be wrapped in at least auth.Middleware by the caller.
//
// Routes added:
//
//	GET /me/preferences
//	PUT /me/preferences
func (h *Handler) Mount(r chi.Router) {
	r.Get("/me/preferences", h.getPrefs)
	r.Put("/me/preferences", h.putPrefs)
}

// ---------------------------------------------------------------------------
// GET /me/preferences
// ---------------------------------------------------------------------------

// getPrefs returns the calling user's preference row.
//
// Preferences are a per-user singleton, so "not saved yet" is a normal empty
// state rather than an error: we return 200 with a default (null view) body.
// This keeps callers simple and avoids logging a spurious 404 on every load
// for users who have never explicitly changed a view preference.
//
// 200 OK  — preference row as JSON (defaults when none saved yet).
// 401     — missing or invalid JWT.
func (h *Handler) getPrefs(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil || claims.UserID == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	prefs, err := h.store.Get(r.Context(), claims.UserID)
	if errors.Is(err, ErrNotFound) {
		// No row yet — return an empty/default singleton, not a 404.
		writeJSON(w, http.StatusOK, Prefs{ProfileID: claims.UserID})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

// ---------------------------------------------------------------------------
// PUT /me/preferences
// ---------------------------------------------------------------------------

// putPrefs upserts the calling user's preference row.
//
// Body: { "last_view_pos"?: "quick"|"full"|"floor"|"orders",
//
//	"last_view_kds"?: "station"|"expo"|"bumpbar" }
//
// 200 OK  — updated preference row as JSON.
// 400     — invalid JSON body or unrecognized view name.
// 401     — missing or invalid JWT.
func (h *Handler) putPrefs(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok || claims == nil || claims.UserID == "" {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	var req UpdateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate POS view name when provided.
	if req.LastViewPOS != nil {
		switch *req.LastViewPOS {
		case "quick", "full", "floor", "orders":
			// valid
		default:
			writeErr(w, http.StatusBadRequest, "last_view_pos must be one of: quick, full, floor, orders")
			return
		}
	}

	// Validate KDS view name when provided.
	if req.LastViewKDS != nil {
		switch *req.LastViewKDS {
		case "station", "expo", "bumpbar":
			// valid
		default:
			writeErr(w, http.StatusBadRequest, "last_view_kds must be one of: station, expo, bumpbar")
			return
		}
	}

	prefs, err := h.store.Upsert(r.Context(), claims.UserID, req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}

	writeJSON(w, http.StatusOK, prefs)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
