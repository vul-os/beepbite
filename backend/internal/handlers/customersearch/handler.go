// Package customersearch provides GET /customers/search?q=&limit= for the POS
// customer-lookup flow. Queries are org-scoped via Postgres RLS (the db.Scope
// injected by RequireOrgScope sets app.current_org_id, which the customers
// policy reads via current_org_id()). Mount after auth.Middleware and
// auth.RequireOrgScope.
package customersearch

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler wires the store to chi routes.
type Handler struct {
	store *Store
}

// NewHandler creates a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers GET /customers/search on r.
// Call after the authenticated group middleware is already in place:
//
//	r.Group(func(r chi.Router) {
//	    r.Use(auth.Middleware(svc))
//	    r.Use(auth.RequireOrgScope(pool))
//	    customerSearchHandler.Mount(r)
//	})
func (h *Handler) Mount(r chi.Router) {
	r.Route("/customers", func(r chi.Router) {
		r.Get("/search", h.search)
	})
}

// search handles GET /customers/search?q=<phone-or-name>&limit=20
//
// Query params:
//
//	q     — required, min 1 char; matched against whatsapp_number ILIKE and
//	        (first_name || ' ' || last_name) ILIKE (case-insensitive both).
//	limit — optional, 1-100, default 20.
//
// Response 200: { "customers": [ { id, name, phone, email, total_orders, last_order_date } ] }
// Response 400: { "error": "..." }
// Response 500: { "error": "..." }
func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) == 0 {
		writeErr(w, http.StatusBadRequest, "q is required")
		return
	}

	limit := 20
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		n, err := strconv.Atoi(lStr)
		if err != nil || n < 1 || n > 100 {
			writeErr(w, http.StatusBadRequest, "limit must be an integer between 1 and 100")
			return
		}
		limit = n
	}

	results, err := h.store.Search(r.Context(), q, limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"customers": results})
}

// --- IO helpers (package-local, same pattern as cashdrawer) ---

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
