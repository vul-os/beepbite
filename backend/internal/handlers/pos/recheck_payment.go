package pos

// recheck_payment.go — POST /pos/orders/{order_id}/recheck-payment
//
// Staff-facing backstop for an online-gateway order (see
// internal/handlers/marketplace/checkout.go) whose automatic verify-on-return
// never happened — the buyer paid on the provider's hosted page but closed
// the tab (or lost connectivity) before its redirect back to beepbite
// completed. A member of staff opening the order in the POS can hit this to
// trigger exactly ONE on-demand payments.SettleOnlinePayment verify. This is
// NOT a background poll loop and is not called automatically — see
// internal/payments/provider.go's package doc comment for the whole
// verify-on-return model this backstops.

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/beepbite/backend/internal/auth"
	"github.com/beepbite/backend/internal/payments"
)

type recheckPaymentResp struct {
	OrderID string `json:"order_id"`
	Status  string `json:"status"`
}

// POST /pos/orders/{order_id}/recheck-payment
func (h *Handler) recheckPayment(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id is required")
		return
	}

	if h.store.gateway == nil {
		writeErr(w, http.StatusServiceUnavailable, "no online payment gateway configured")
		return
	}

	// Org-scope check: verify the caller owns the location this order
	// belongs to — same guard pos/charge.go uses.
	scope := auth.OrgScopeFrom(r.Context())
	orderLocID, err := h.store.GetOrderLocationID(r.Context(), orderID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
		return
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !scope.AllowsLocation(orderLocID) {
		writeErr(w, http.StatusNotFound, "order not found")
		return
	}

	status, err := payments.SettleOnlinePayment(r.Context(), h.pool, h.store.gateway, orderID)
	if errors.Is(err, payments.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "no payment record for this order")
		return
	}
	if err != nil {
		// Fail closed: report whatever status SettleOnlinePayment returned
		// (never upgraded past it) alongside the error, rather than a bare
		// 500 with no information — the verify itself may simply be
		// transiently unreachable.
		writeJSON(w, http.StatusOK, recheckPaymentResp{OrderID: orderID, Status: string(status)})
		return
	}

	writeJSON(w, http.StatusOK, recheckPaymentResp{OrderID: orderID, Status: string(status)})
}
