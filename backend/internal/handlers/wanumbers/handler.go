package wanumbers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler wires the platform-admin CRUD surface for whatsapp_phone_numbers.
// The caller MUST apply auth.Middleware + admin.RequirePlatformAdmin before
// calling Mount so that all routes are protected.
//
// Typical wiring in main.go (inside the existing platform-admin group):
//
//	r.Group(func(r chi.Router) {
//	    r.Use(auth.Middleware(svc))
//	    r.Use(admin.RequirePlatformAdmin(database.Pool))
//	    adminH.Mount(r)       // existing /admin/*
//	    waNumbersH.Mount(r)   // /admin/wa-numbers/*
//	})
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount wires the wa-numbers endpoints under /admin/wa-numbers.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/admin/wa-numbers", func(r chi.Router) {
		r.Get("/", h.list)
		r.Post("/", h.create)
		r.Get("/{id}", h.get)
		r.Patch("/{id}", h.update)
		r.Post("/{id}/deactivate", h.deactivate)
	})
}

// ---------------------------------------------------------------------------
// GET /admin/wa-numbers?active_only=true
// ---------------------------------------------------------------------------

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	activeOnly := strings.EqualFold(r.URL.Query().Get("active_only"), "true")
	rows, err := h.store.List(r.Context(), activeOnly)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

// ---------------------------------------------------------------------------
// GET /admin/wa-numbers/{id}
// ---------------------------------------------------------------------------

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}
	row, err := h.store.Get(r.Context(), id)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "number not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, row)
	}
}

// ---------------------------------------------------------------------------
// POST /admin/wa-numbers
// ---------------------------------------------------------------------------

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req CreateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if req.MetaPhoneNumberID == "" {
		writeErr(w, http.StatusBadRequest, "meta_phone_number_id is required")
		return
	}
	if req.DisplayPhone == "" {
		writeErr(w, http.StatusBadRequest, "display_phone is required")
		return
	}
	if req.Country == "" {
		writeErr(w, http.StatusBadRequest, "country is required")
		return
	}

	row, err := h.store.Create(r.Context(), req)
	switch {
	case errors.Is(err, ErrDuplicatePhoneNumberID):
		writeErr(w, http.StatusConflict, "meta_phone_number_id already registered")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, row)
	}
}

// ---------------------------------------------------------------------------
// PATCH /admin/wa-numbers/{id}
// ---------------------------------------------------------------------------

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	var req UpdateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	row, err := h.store.Update(r.Context(), id, req)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "number not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, row)
	}
}

// ---------------------------------------------------------------------------
// POST /admin/wa-numbers/{id}/deactivate
// ---------------------------------------------------------------------------

func (h *Handler) deactivate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeErr(w, http.StatusBadRequest, "id required")
		return
	}

	err := h.store.Deactivate(r.Context(), id)
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "number not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, map[string]string{"status": "deactivated"})
	}
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
