// Package deliveryzones exposes delivery zone CRUD and point-in-polygon lookup.
// Mount under an authenticated chi.Router group.
package deliveryzones

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	store *Store
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

func (h *Handler) Mount(r chi.Router) {
	r.Route("/delivery-zones", func(r chi.Router) {
		r.Post("/", h.create)
		r.Get("/", h.list)
		r.Post("/lookup", h.lookup)
		r.Get("/{id}", h.getOne)
		r.Patch("/{id}", h.update)
		r.Delete("/{id}", h.softDelete)
	})
}

// ---- DTOs ----

type createReq struct {
	OrganizationID      string `json:"organization_id"`
	LocationID          string `json:"location_id"`
	Name                string `json:"name"`
	Polygon             any    `json:"polygon"`
	DeliveryFeeCents    int64  `json:"delivery_fee_cents"`
	MinOrderCents       int64  `json:"min_order_cents"`
	EstimatedETAMinutes int    `json:"estimated_eta_minutes"`
	IsActive            *bool  `json:"is_active"`
	Priority            int    `json:"priority"`
}

// ---- handlers ----

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req createReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.OrganizationID == "" || req.LocationID == "" || req.Name == "" {
		writeErr(w, http.StatusBadRequest, "organization_id, location_id, and name are required")
		return
	}
	if req.Polygon == nil {
		writeErr(w, http.StatusBadRequest, "polygon is required")
		return
	}

	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	eta := 30
	if req.EstimatedETAMinutes > 0 {
		eta = req.EstimatedETAMinutes
	}

	zone, err := h.store.Create(r.Context(), Zone{
		OrganizationID:      req.OrganizationID,
		LocationID:          req.LocationID,
		Name:                req.Name,
		Polygon:             req.Polygon,
		DeliveryFeeCents:    req.DeliveryFeeCents,
		MinOrderCents:       req.MinOrderCents,
		EstimatedETAMinutes: eta,
		IsActive:            active,
		Priority:            req.Priority,
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, zone)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id query param required")
		return
	}
	zones, err := h.store.List(r.Context(), locationID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, zones)
}

func (h *Handler) getOne(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	zone, err := h.store.Get(r.Context(), id)
	switch {
	case errors.Is(err, ErrZoneNotFound):
		writeErr(w, http.StatusNotFound, "delivery zone not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, zone)
	}
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req UpdateFields
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	zone, err := h.store.Update(r.Context(), id, req)
	switch {
	case errors.Is(err, ErrZoneNotFound):
		writeErr(w, http.StatusNotFound, "delivery zone not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, zone)
	}
}

func (h *Handler) softDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	err := h.store.SoftDelete(r.Context(), id)
	switch {
	case errors.Is(err, ErrZoneNotFound):
		writeErr(w, http.StatusNotFound, "delivery zone not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func (h *Handler) lookup(w http.ResponseWriter, r *http.Request) {
	locationID := r.URL.Query().Get("location_id")
	lngStr := r.URL.Query().Get("lng")
	latStr := r.URL.Query().Get("lat")

	if locationID == "" || lngStr == "" || latStr == "" {
		writeErr(w, http.StatusBadRequest, "location_id, lng, and lat query params required")
		return
	}

	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid lng")
		return
	}
	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid lat")
		return
	}

	zone, err := h.store.Lookup(r.Context(), locationID, lng, lat)
	switch {
	case errors.Is(err, ErrZoneNotFound):
		writeErr(w, http.StatusNotFound, "no delivery zone covers this location")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, zone)
	}
}
