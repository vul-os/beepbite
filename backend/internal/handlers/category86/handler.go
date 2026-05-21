// Package category86 exposes REST endpoints for bulk 86 / un-86 of an entire
// menu category (and its subcategories). Mount under an already-authenticated
// chi.Router group.
//
// Endpoints:
//
//	POST /categories/{category_id}/eighty-six    — set is_86ed = true on all items
//	POST /categories/{category_id}/un-eighty-six — clear is_86ed on all items
//
// Both endpoints are org-scoped: the category's location_id must belong to the
// authenticated user's org; otherwise 404 is returned (existence-leak avoidance,
// matching the cashdrawer style).
package category86

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// Handler is the HTTP handler for category-86 operations.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers the two routes on r. Call this inside your authenticated
// router group, e.g.:
//
//	category86.NewHandler(pool).Mount(r)
func (h *Handler) Mount(r chi.Router) {
	r.Route("/categories/{category_id}", func(r chi.Router) {
		r.Post("/eighty-six", h.eightySix)
		r.Post("/un-eighty-six", h.unEightySix)
	})
}

// eighty6Resp is the JSON body returned by both endpoints.
type eighty6Resp struct {
	CategoryID    string `json:"category_id"`
	ItemsAffected int64  `json:"items_affected"`
	Is86ed        bool   `json:"is_86ed"`
}

func (h *Handler) eightySix(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true)
}

func (h *Handler) unEightySix(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, false)
}

// handle is the shared implementation. flag=true → 86, flag=false → un-86.
func (h *Handler) handle(w http.ResponseWriter, r *http.Request, flag bool) {
	categoryID := chi.URLParam(r, "category_id")
	if categoryID == "" {
		writeErr(w, http.StatusBadRequest, "category_id required")
		return
	}

	// Cross-tenant guard: resolve the category's location and verify it belongs
	// to the caller's org. Returns 404 (not 403) to avoid existence leaks,
	// matching the cashdrawer pattern.
	locID, err := h.store.CategoryLocationID(r.Context(), categoryID)
	switch {
	case errors.Is(err, ErrCategoryNotFound):
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

	// Resolve org ID for the audit row from the db.Scope in context.
	scope := db.ScopeFromContext(r.Context())
	orgID := scope.OrgID

	var affected int64
	if flag {
		affected, err = h.store.EightySixCategory(r.Context(), categoryID, orgID)
	} else {
		affected, err = h.store.UnEightySixCategory(r.Context(), categoryID, orgID)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, eighty6Resp{
		CategoryID:    categoryID,
		ItemsAffected: affected,
		Is86ed:        flag,
	})
}

// --- JSON helpers (local to avoid coupling to a shared httpx package) ---

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
