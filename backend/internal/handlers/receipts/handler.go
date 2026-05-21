// Package receipts — see store.go for package-level docs.
package receipts

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler wires HTTP routes to the Store.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers the receipt route onto r.
// Expected wire-up (in main.go or equivalent):
//
//	receipts.NewHandler(pool).Mount(authGroup)
//
// This exposes:
//
//	GET /orders/{order_id}/receipt
func (h *Handler) Mount(r chi.Router) {
	r.Get("/orders/{order_id}/receipt", h.getReceipt)
}

// getReceipt handles GET /orders/{order_id}/receipt.
// It returns a structured receipt JSON for the given order.
// Cross-tenant guard: the order's location_id must be within the request's
// org scope; otherwise 404 is returned (not 403) to avoid existence leaks.
func (h *Handler) getReceipt(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	// Resolve the order's location so we can do the cross-tenant guard before
	// running the heavier JOIN query.
	locID, err := h.store.OrderLocationID(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Cross-tenant guard: 404 on foreign location to avoid existence leaks.
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	receipt, err := h.store.GetReceipt(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, receipt)
}

// ---------------------------------------------------------------------------
// JSON helpers (local copies — keeps the package self-contained, same
// approach as cashdrawer and adjustments).
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
