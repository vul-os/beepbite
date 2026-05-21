// Package reorder exposes the "quick re-order / the usual?" REST surface.
// Mount under an already-authenticated, org-scoped chi.Router group.
//
// Routes:
//
//	GET /customers/{customer_id}/recent-orders?limit=3
//	    Returns the customer's last N orders (default 3, max 20) with enough
//	    detail to clone one into the POS cart: each order's id, order_number,
//	    created_at, total_cents, and its line items (item_id, item_name,
//	    quantity, modifiers from order_item_modifiers).
//
// Org-scope guard: reads the customer's organization_id inside a scoped
// transaction (RLS enforced). Returns 404 when the customer does not exist
// or does not belong to the requesting org.
package reorder

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

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

// Mount registers all reorder routes under r.
// Call as: h.Mount(orgScopedRouter)
func (h *Handler) Mount(r chi.Router) {
	// Full-path registration (not r.Route) so multiple handlers can share the
	// /customers/{customer_id} prefix without a chi Mount() collision.
	r.Get("/customers/{customer_id}/recent-orders", h.listRecentOrders)
}

// listRecentOrders handles GET /customers/{customer_id}/recent-orders?limit=3.
func (h *Handler) listRecentOrders(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customer_id")
	if customerID == "" {
		writeErr(w, http.StatusBadRequest, "customer_id required")
		return
	}

	// Parse optional ?limit= query param.
	limit := 3
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			writeErr(w, http.StatusBadRequest, "limit must be a positive integer")
			return
		}
		limit = n
	}

	// Org-scope guard: verify the customer exists and belongs to this org.
	// db.Scoped + RLS means a tenant cannot read another tenant's customer.
	// Returns 404 (not 403) to avoid existence leaks.
	_, err := h.store.CustomerOrgID(r.Context(), customerID)
	switch {
	case errors.Is(err, ErrCustomerNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	orders, err := h.store.RecentOrders(r.Context(), customerID, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, orders)
}

// ---------------------------------------------------------------------------
// JSON helpers (local to keep package self-contained, matching cashdrawer style)
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
