// Package onboarding — HTTP handler for the setup wizard progress endpoints.
//
// Routes (mount under an org-scoped chi.Router group):
//
//	GET  /onboarding/progress  — return current step + completed_steps
//	PUT  /onboarding/progress  — upsert step + completed_steps
//	GET  /onboarding/status    — derive real completion from live DB counts
//
// All routes require a valid JWT with an org scope (wired by RequireOrgScope
// middleware in main.go). RLS is enforced via db.Scoped in the store layer.
package onboarding

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler wires HTTP routes to Store.
type Handler struct {
	store *Store
}

// NewHandler returns a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers onboarding routes under r.
// Call inside an already-authenticated, org-scoped chi.Router group.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/onboarding", func(r chi.Router) {
		r.Get("/progress", h.getProgress)
		r.Put("/progress", h.putProgress)
		r.Get("/status", h.getStatus)
	})
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

type putProgressReq struct {
	Step           int      `json:"step"`
	CompletedSteps []string `json:"completed_steps"`
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// getProgress handles GET /onboarding/progress.
// Returns 200 with the progress row, or 404 when the org hasn't started the
// wizard yet (wizard UI should treat 404 as step=0, completed_steps=[]).
func (h *Handler) getProgress(w http.ResponseWriter, r *http.Request) {
	p, err := h.store.GetProgress(r.Context())
	switch {
	case errors.Is(err, ErrNotFound):
		// Return a zeroed progress so the client can start from step 0.
		writeJSON(w, http.StatusOK, Progress{
			Step:           0,
			CompletedSteps: []string{},
		})
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, p)
	}
}

// putProgress handles PUT /onboarding/progress.
// Upserts the progress row. Returns the saved row.
func (h *Handler) putProgress(w http.ResponseWriter, r *http.Request) {
	var req putProgressReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Step < 0 {
		writeErr(w, http.StatusBadRequest, "step must be >= 0")
		return
	}
	if req.CompletedSteps == nil {
		req.CompletedSteps = []string{}
	}

	p, err := h.store.UpsertProgress(r.Context(), req.Step, req.CompletedSteps)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// getStatus handles GET /onboarding/status.
// Queries live table counts so the wizard can show real completion state.
func (h *Handler) getStatus(w http.ResponseWriter, r *http.Request) {
	st, err := h.store.GetStatus(r.Context())
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// ---------------------------------------------------------------------------
// JSON helpers (package-local, consistent with other handlers)
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}
