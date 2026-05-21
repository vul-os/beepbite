// Package cashout — see store.go for package-level documentation.
package cashout

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler wires the cashout store to HTTP.
type Handler struct {
	store *Store
}

// NewHandler returns a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers the cashout routes under r. Wire this under an already-
// authenticated, org-scoped chi.Router group — typically the same group that
// the cashdrawer handler is mounted on.
//
//	r.Mount("/", cashout.NewHandler(pool).Mount)   // or r.Route(..., h.Mount)
func (h *Handler) Mount(r chi.Router) {
	// GET /cash-out/{session_id}
	r.Get("/cash-out/{session_id}", h.getCashOutReport)
}

// --- Handlers ---

func (h *Handler) getCashOutReport(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "session_id")
	if sessionID == "" {
		writeErr(w, http.StatusBadRequest, "session_id required")
		return
	}

	// Cross-tenant guard: resolve session → drawer → location and verify scope.
	// Returns 404 (not 403) to avoid existence leaks.
	locID, err := h.store.SessionLocationID(r.Context(), sessionID)
	switch {
	case errors.Is(err, ErrSessionNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	report, err := h.store.GetReport(r.Context(), sessionID)
	switch {
	case errors.Is(err, ErrSessionNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, report)
}

// --- JSON helpers (local — same pattern as cashdrawer/io.go) ---

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
