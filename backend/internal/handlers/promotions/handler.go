package promotions

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/beepbite/backend/internal/auth"
	"github.com/go-chi/chi/v5"
)

// Handler exposes the promotion engine over HTTP.
type Handler struct {
	engine *Engine
}

func NewHandler(engine *Engine) *Handler {
	return &Handler{engine: engine}
}

func (h *Handler) Mount(r chi.Router) {
	// Apply promotion to an order — no extra capability; cashiers use this during ring-up.
	r.Post("/orders/{order_id}/apply-promotions", h.apply)

	// Promotion configuration management — requires can_manage_promotions.
	r.With(auth.RequireCapability("can_manage_promotions")).Post("/promotions", h.createPromotion)
	r.With(auth.RequireCapability("can_manage_promotions")).Patch("/promotions/{promotion_id}", h.updatePromotion)
	r.With(auth.RequireCapability("can_manage_promotions")).Delete("/promotions/{promotion_id}", h.deletePromotion)
}

type applyReq struct {
	CouponCodes []string `json:"coupon_codes"`
}

func (h *Handler) apply(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeError(w, http.StatusBadRequest, "MISSING_ORDER_ID", "order_id is required")
		return
	}

	var req applyReq
	// An empty body is valid — means no coupon codes.
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid JSON in request body")
			return
		}
	}

	res, err := h.engine.Apply(r.Context(), orderID, req.CouponCodes)
	if err != nil {
		if errors.Is(err, errNoOrder) {
			writeError(w, http.StatusNotFound, "ORDER_NOT_FOUND", "Order not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---------------------------------------------------------------------------
// Promotion config management (gated: can_manage_promotions)
// ---------------------------------------------------------------------------

// createPromotion creates a new promotion record.
// Full implementation is tracked in a subsequent task; the route + capability
// gate are wired here so the permission boundary is enforced immediately.
func (h *Handler) createPromotion(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "createPromotion not yet implemented")
}

// updatePromotion updates a promotion's configuration.
func (h *Handler) updatePromotion(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "updatePromotion not yet implemented")
}

// deletePromotion removes a promotion.
func (h *Handler) deletePromotion(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotImplemented, "NOT_IMPLEMENTED", "deletePromotion not yet implemented")
}
