// Package fiscal exposes the fiscal receipt sequencing REST surface.
// Mount under an already-authenticated chi.Router group.
package fiscal

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler holds a reference to the underlying store.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all fiscal routes onto r.
//
//	POST   /fiscal/orders/{order_id}/assign-receipt
//	GET    /fiscal/orders/{order_id}/receipt
//	POST   /fiscal/sequences
//	GET    /fiscal/sequences/{location_id}
func (h *Handler) Mount(r chi.Router) {
	r.Route("/fiscal", func(r chi.Router) {
		r.Post("/orders/{order_id}/assign-receipt", h.assignReceipt)
		r.Get("/orders/{order_id}/receipt", h.getReceipt)

		r.Post("/sequences", h.createSequence)
		r.Get("/sequences/{location_id}", h.getSequence)
	})
}

// --- request bodies ---

type createSequenceReq struct {
	LocationID     string `json:"location_id"`
	Prefix         string `json:"prefix"`
	ResetPolicy    string `json:"reset_policy"`
	StartingNumber int64  `json:"starting_number"`
}

// --- handlers ---

// assignReceipt atomically issues the next fiscal receipt number for an order.
// Returns 409 if the order already has one (receipts are immutable).
func (h *Handler) assignReceipt(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	out, err := h.store.AssignReceipt(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case errors.Is(err, ErrReceiptAlreadyIssued):
		writeErr(w, http.StatusConflict, err.Error())
		return
	case errors.Is(err, ErrSequenceNotFound):
		writeErr(w, http.StatusUnprocessableEntity, "no fiscal sequence configured for this location")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// getReceipt returns the fiscal receipt number already assigned to an order.
func (h *Handler) getReceipt(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	out, err := h.store.GetReceipt(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// createSequence initialises a fiscal_sequences row for a location.
func (h *Handler) createSequence(w http.ResponseWriter, r *http.Request) {
	var req createSequenceReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.LocationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}
	switch req.ResetPolicy {
	case "", "never", "yearly", "monthly":
	default:
		writeErr(w, http.StatusBadRequest, "reset_policy must be one of: never, yearly, monthly")
		return
	}
	if req.ResetPolicy == "" {
		req.ResetPolicy = "never"
	}
	if req.StartingNumber < 0 {
		writeErr(w, http.StatusBadRequest, "starting_number must be >= 0")
		return
	}

	seq, err := h.store.CreateSequence(r.Context(), req.LocationID, req.Prefix, req.ResetPolicy, req.StartingNumber)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, seq)
}

// getSequence reads the current state of a location's fiscal sequence.
func (h *Handler) getSequence(w http.ResponseWriter, r *http.Request) {
	locationID := chi.URLParam(r, "location_id")
	if locationID == "" {
		writeErr(w, http.StatusBadRequest, "location_id required")
		return
	}

	seq, err := h.store.GetSequence(r.Context(), locationID)
	switch {
	case errors.Is(err, ErrSequenceNotFound):
		writeErr(w, http.StatusNotFound, err.Error())
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, seq)
}
