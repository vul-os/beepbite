// Package adjustments exposes REST endpoints for voiding, comping,
// price-overriding, and refunding orders, with PIN-gated manager approval.
// Mount under an already-authenticated chi.Router group at "/orders".
package adjustments

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler wires together the store and the chi routes.
type Handler struct {
	store *Store
}

// NewHandler constructs a Handler backed by pool.
func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{store: NewStore(pool)}
}

// Mount registers all adjustment routes on r.
// Callers should nest this under their /orders group:
//
//	r.Mount("/orders", adjustments.NewHandler(pool).Mount)
func (h *Handler) Mount(r chi.Router) {
	r.Post("/{order_id}/void", h.voidOrder)
	r.Post("/{order_id}/refund", h.refundOrder)
	r.Get("/{order_id}/adjustments", h.listAdjustments)

	r.Post("/{order_id}/items/{item_id}/comp", h.compItem)
	r.Post("/{order_id}/items/{item_id}/price-override", h.priceOverride)
}

// --- request DTOs ---

type baseAdjReq struct {
	ReasonCode      string `json:"reason_code"`       // informational; stored as reason_text
	AppliedByStaffID string `json:"applied_by_staff_id"`
	ApproverPIN     string `json:"approver_pin"`
	ApproverStaffID string `json:"approver_staff_id"` // whose PIN we're checking
}

type priceOverrideReq struct {
	baseAdjReq
	NewPriceCents int64 `json:"new_price_cents"`
}

// --- PIN helper used by every mutating handler ---

// authorise validates the manager PIN and returns the approver's staff ID.
// Returns (approverID, true) on success, or writes the error response and
// returns ("", false) so callers can bail immediately.
func (h *Handler) authorise(w http.ResponseWriter, r *http.Request, req baseAdjReq) (string, bool) {
	if req.AppliedByStaffID == "" {
		writeErr(w, http.StatusBadRequest, "applied_by_staff_id is required")
		return "", false
	}
	if req.ApproverStaffID == "" {
		writeErr(w, http.StatusBadRequest, "approver_staff_id is required")
		return "", false
	}
	if req.ApproverPIN == "" {
		writeErr(w, http.StatusBadRequest, "approver_pin is required")
		return "", false
	}

	approver, err := VerifyManagerPIN(r.Context(), h.store, req.ApproverStaffID, req.ApproverPIN)
	switch {
	case errors.Is(err, ErrApproverNotFound):
		writeErr(w, http.StatusUnauthorized, "approver not found")
		return "", false
	case errors.Is(err, ErrNotManager):
		writeErr(w, http.StatusForbidden, "approver does not have manager privileges")
		return "", false
	case errors.Is(err, ErrPINMismatch):
		writeErr(w, http.StatusUnauthorized, "manager PIN is incorrect")
		return "", false
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return "", false
	}

	// Self-approval guard (also enforced by DB trigger, but fail fast here).
	if req.AppliedByStaffID == approver.ID {
		writeErr(w, http.StatusUnprocessableEntity, "applied_by and approver must differ")
		return "", false
	}

	return approver.ID, true
}

// --- Handlers ---

// POST /orders/{order_id}/void
func (h *Handler) voidOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	var req baseAdjReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	approverID, ok := h.authorise(w, r, req)
	if !ok {
		return
	}

	adj, err := h.store.VoidOrder(r.Context(), orderID, req.ReasonCode, req.AppliedByStaffID, approverID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
	case errors.Is(err, ErrOrderAlreadyPaid):
		writeErr(w, http.StatusConflict, "order already has a completed payment; use refund instead")
	case errors.Is(err, ErrAlreadyVoided):
		writeErr(w, http.StatusConflict, "order already has an active void")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, adj)
	}
}

// POST /orders/{order_id}/items/{item_id}/comp
func (h *Handler) compItem(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	itemID := chi.URLParam(r, "item_id")
	if orderID == "" || itemID == "" {
		writeErr(w, http.StatusBadRequest, "order_id and item_id required")
		return
	}

	var req baseAdjReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	approverID, ok := h.authorise(w, r, req)
	if !ok {
		return
	}

	adj, err := h.store.CompItem(r.Context(), orderID, itemID, req.ReasonCode, req.AppliedByStaffID, approverID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
	case errors.Is(err, ErrItemNotFound):
		writeErr(w, http.StatusNotFound, "order item not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, adj)
	}
}

// POST /orders/{order_id}/items/{item_id}/price-override
func (h *Handler) priceOverride(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	itemID := chi.URLParam(r, "item_id")
	if orderID == "" || itemID == "" {
		writeErr(w, http.StatusBadRequest, "order_id and item_id required")
		return
	}

	var req priceOverrideReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.NewPriceCents < 0 {
		writeErr(w, http.StatusBadRequest, "new_price_cents must be >= 0")
		return
	}

	approverID, ok := h.authorise(w, r, req.baseAdjReq)
	if !ok {
		return
	}

	adj, err := h.store.PriceOverrideItem(
		r.Context(), orderID, itemID, req.NewPriceCents,
		req.ReasonCode, req.AppliedByStaffID, approverID,
	)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
	case errors.Is(err, ErrItemNotFound):
		writeErr(w, http.StatusNotFound, "order item not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, adj)
	}
}

// POST /orders/{order_id}/refund
func (h *Handler) refundOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	var req baseAdjReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	approverID, ok := h.authorise(w, r, req)
	if !ok {
		return
	}

	adj, err := h.store.RefundOrder(r.Context(), orderID, req.ReasonCode, req.AppliedByStaffID, approverID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusCreated, adj)
	}
}

// GET /orders/{order_id}/adjustments
func (h *Handler) listAdjustments(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id required")
		return
	}

	adjs, err := h.store.ListAdjustments(r.Context(), orderID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, adjs)
}
