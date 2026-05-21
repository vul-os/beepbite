// Package favorites exposes the customer-favourite-items REST surface.
// Mount under an already-authenticated, org-scoped chi.Router group.
//
// Routes (full-path registration to avoid chi Mount collision with other
// handlers that share the /customers/{customer_id} prefix):
//
//	GET    /customers/{customer_id}/favorites
//	POST   /customers/{customer_id}/favorites          body: {"item_id":"<uuid>"}
//	DELETE /customers/{customer_id}/favorites/{item_id}
//
// Org-scope guard: reads the customer's organization_id inside a scoped
// transaction (RLS enforced). Returns 404 when the customer does not exist
// or does not belong to the requesting org.
package favorites

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/db"
)

// Handler wires HTTP routes to Store.
type Handler struct {
	store *Store
}

// NewHandler returns a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all favorites routes under r.
// Full-path registration (not r.Route) so multiple handlers can share the
// /customers/{customer_id} prefix without a chi Mount() collision.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/customers/{customer_id}/favorites", h.listFavorites)
	r.Post("/customers/{customer_id}/favorites", h.addFavorite)
	r.Delete("/customers/{customer_id}/favorites/{item_id}", h.removeFavorite)
}

// --- DTOs ---

type addFavoriteReq struct {
	ItemID string `json:"item_id"`
}

// --- Handlers ---

// listFavorites handles GET /customers/{customer_id}/favorites.
func (h *Handler) listFavorites(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}

	// Org-scope guard: verify customer exists and is visible to this org.
	_, err := h.store.CustomerOrgID(r.Context(), customerID)
	switch {
	case errors.Is(err, ErrCustomerNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	items, err := h.store.ListFavorites(r.Context(), customerID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// addFavorite handles POST /customers/{customer_id}/favorites.
func (h *Handler) addFavorite(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}

	var req addFavoriteReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.ItemID == "" {
		writeErr(w, http.StatusBadRequest, "item_id required")
		return
	}

	// Org-scope guard.
	orgID, err := h.store.CustomerOrgID(r.Context(), customerID)
	switch {
	case errors.Is(err, ErrCustomerNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Confirm orgID matches the scope on the request (belt-and-suspenders).
	scope := db.ScopeFromContext(r.Context())
	if scope.OrgID != "" && scope.OrgID != orgID {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	// Fall back to the resolved orgID when scope.OrgID is empty (e.g. service role).
	if orgID == "" {
		orgID = scope.OrgID
	}

	fi, err := h.store.AddFavorite(r.Context(), orgID, customerID, req.ItemID)
	switch {
	case errors.Is(err, ErrItemNotFound):
		writeErr(w, http.StatusNotFound, "item not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, fi)
}

// removeFavorite handles DELETE /customers/{customer_id}/favorites/{item_id}.
func (h *Handler) removeFavorite(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	itemID := chi.URLParam(r, "item_id")
	if customerID == "" || itemID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id and item_id required")
		return
	}

	// Org-scope guard.
	orgID, err := h.store.CustomerOrgID(r.Context(), customerID)
	switch {
	case errors.Is(err, ErrCustomerNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Belt-and-suspenders org check.
	orgScope := auth.OrgScopeFrom(r.Context())
	if !auth.ScopeAllowsOrg(&orgScope, orgID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	err = h.store.RemoveFavorite(r.Context(), orgID, customerID, itemID)
	switch {
	case errors.Is(err, ErrFavoriteNotFound):
		writeErr(w, http.StatusNotFound, "favorite not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// JSON helpers (local to keep package self-contained, matching reorder style)
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
