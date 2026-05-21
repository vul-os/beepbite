// Package tabs exposes the open-tab / open-check REST surface (Wave 32).
// Mount under an already-authenticated chi.Router group.
//
// Endpoints:
//
//	POST   /tabs                       — open a new tab
//	GET    /tabs?location_id=          — list open tabs with running total
//	POST   /tabs/{order_id}/items      — append items and recompute totals
//	POST   /tabs/{order_id}/close      — mark ready for charge/settle
package tabs

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/auth"
)

// Handler holds a Store for tab operations.
type Handler struct {
	store *Store
}

// NewHandler creates a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all tab routes on r.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/tabs", func(r chi.Router) {
		r.Post("/", h.openTab)
		r.Get("/", h.listTabs)
		r.Post("/{order_id}/items", h.appendItems)
		r.Post("/{order_id}/close", h.closeTab)
	})
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

type openTabReq struct {
	LocationID string `json:"location_id"`
	TabName    string `json:"tab_name"`
	CustomerID string `json:"customer_id"`
}

type appendItemsReq struct {
	Items []ItemInput `json:"items"`
}

// ---------------------------------------------------------------------------
// POST /tabs
// ---------------------------------------------------------------------------

func (h *Handler) openTab(w http.ResponseWriter, r *http.Request) {
	var req openTabReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id is required")
		return
	}

	// Org-scope check: returns 404 (not 403) to avoid existence leaks.
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(req.LocationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	tab, err := h.store.OpenTab(r.Context(), req.LocationID, req.TabName, req.CustomerID)
	switch {
	case errors.Is(err, ErrTabNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tab)
}

// ---------------------------------------------------------------------------
// GET /tabs?location_id=
// ---------------------------------------------------------------------------

func (h *Handler) listTabs(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id query parameter is required")
		return
	}

	// Org-scope guard.
	if !auth.OrgScopeFrom(r.Context()).AllowsLocation(locationID) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}

	tabs, err := h.store.ListTabs(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tabs)
}

// ---------------------------------------------------------------------------
// POST /tabs/{order_id}/items
// ---------------------------------------------------------------------------

func (h *Handler) appendItems(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	// Cross-tenant guard: resolve tab→location then check scope.
	locID, err := h.store.TabLocationID(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrTabNotFound):
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

	var req appendItemsReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(req.Items) == 0 {
		writeErr(w, http.StatusBadRequest, "items must not be empty")
		return
	}

	result, err := h.store.AppendItems(r.Context(), orderID, req.Items)
	switch {
	case errors.Is(err, ErrTabNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case errors.Is(err, ErrTabAlreadyClosed):
		writeErr(w, http.StatusConflict, "tab is already closed")
		return
	case errors.Is(err, ErrItemNotFound):
		writeErr(w, http.StatusUnprocessableEntity, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, result)
}

// ---------------------------------------------------------------------------
// POST /tabs/{order_id}/close
// ---------------------------------------------------------------------------

func (h *Handler) closeTab(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	// Cross-tenant guard.
	locID, err := h.store.TabLocationID(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrTabNotFound):
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

	tab, err := h.store.CloseTab(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrTabNotFound):
		writeErr(w, http.StatusNotFound, "not found")
		return
	case errors.Is(err, ErrTabAlreadyClosed):
		writeErr(w, http.StatusConflict, "tab is already closed")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tab)
}
