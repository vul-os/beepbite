package promotions

import (
	"encoding/json"
	"errors"
	"net/http"

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
	r.Post("/orders/{order_id}/apply-promotions", h.apply)
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
