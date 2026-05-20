package pos

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/auth"
)

// ErrOrderNotPendingOnDelivery is returned when MarkPaidOnDelivery is called
// on an order whose status is not 'pending_on_delivery'.
var ErrOrderNotPendingOnDelivery = errors.New("order is not pending_on_delivery")

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

type markPaidOnDeliveryReq struct {
	Method             string `json:"method"`              // "cash" or "card_machine"
	AmountReceivedCents int64 `json:"amount_received_cents"`
}

type markPaidOnDeliveryResp struct {
	OrderID   string `json:"order_id"`
	PaymentID string `json:"payment_id"`
	Status    string `json:"status"`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// POST /orders/{order_id}/mark-paid-on-delivery
func (h *Handler) markPaidOnDelivery(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id is required")
		return
	}

	// Capability check: require can_settle.
	caps := auth.Capabilities(r.Context())
	if !hasCapability(caps, "can_settle") {
		writeErr(w, http.StatusForbidden, "forbidden: can_settle capability required")
		return
	}

	var req markPaidOnDeliveryReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.Method != "cash" && req.Method != "card_machine" {
		writeErr(w, http.StatusBadRequest, "method must be 'cash' or 'card_machine'")
		return
	}
	if req.AmountReceivedCents <= 0 {
		writeErr(w, http.StatusBadRequest, "amount_received_cents must be > 0")
		return
	}

	// Org-scope check: verify the caller owns the location this order belongs to.
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

	// Resolve actor from the scope (user ID of the staff member calling this).
	actorID := scope.UserID

	resp, err := h.store.MarkPaidOnDelivery(r.Context(), orderID, req, actorID)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
	case errors.Is(err, ErrOrderNotPendingOnDelivery):
		writeErr(w, http.StatusConflict, "order is not in pending_on_delivery status")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, resp)
	}
}

// ---------------------------------------------------------------------------
// Store method
// ---------------------------------------------------------------------------

// MarkPaidOnDelivery settles an on-delivery order: inserts an order_payments
// row, updates order status to 'paid' (via order_financial_details), and
// writes an audit_log entry — all within one transaction.
func (s *Store) MarkPaidOnDelivery(
	ctx context.Context,
	orderID string,
	req markPaidOnDeliveryReq,
	actorID string,
) (*markPaidOnDeliveryResp, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// --- 1. Lock and verify order status ---
	var status string
	err = tx.QueryRow(ctx,
		`SELECT status FROM orders WHERE id = $1 FOR UPDATE`,
		orderID,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != "pending_on_delivery" {
		return nil, ErrOrderNotPendingOnDelivery
	}

	// --- 2. Build the payment_method_code: "cash_on_delivery" or "card_on_delivery" ---
	// The on_delivery_payment_methods array uses "cash" / "card_machine".
	// We store the payment as these same codes (they exist in payment_methods seed).
	paymentMethodCode := "cash_on_delivery"
	if req.Method == "card_machine" {
		paymentMethodCode = "card_on_delivery"
	}

	// --- 3. Insert order_payments row ---
	var paymentID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO order_payments
		    (order_id, payment_method_code, amount_paid_cents, payment_status, paid_at)
		VALUES ($1, $2, $3, 'completed', timezone('utc'::text, now()))
		RETURNING id
	`, orderID, paymentMethodCode, req.AmountReceivedCents).Scan(&paymentID); err != nil {
		return nil, err
	}

	// --- 4. Update order_financial_details ---
	if _, err := tx.Exec(ctx, `
		UPDATE order_financial_details
		SET payment_status = 'paid',
		    payment_method = $2,
		    updated_at     = timezone('utc'::text, now())
		WHERE order_id = $1
	`, orderID, paymentMethodCode); err != nil {
		return nil, err
	}

	// --- 5. Update order status to 'completed' ---
	if _, err := tx.Exec(ctx, `
		UPDATE orders
		SET status = 'completed'
		WHERE id = $1
	`, orderID); err != nil {
		return nil, err
	}

	// --- 6. Write audit_log row ---
	afterJSON, _ := json.Marshal(map[string]interface{}{
		"status":              "completed",
		"payment_method_code": paymentMethodCode,
		"amount_cents":        req.AmountReceivedCents,
	})
	if _, err := tx.Exec(ctx, `
		INSERT INTO audit_log
		    (actor_type, actor_id, action, entity_type, entity_id, before_state, after_state)
		VALUES ('member', $1::uuid, 'order.paid_on_delivery', 'orders', $2::uuid, $3, $4)
	`, nullStr(actorID), orderID,
		[]byte(`{"status":"pending_on_delivery"}`),
		afterJSON,
	); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &markPaidOnDeliveryResp{
		OrderID:   orderID,
		PaymentID: paymentID,
		Status:    "completed",
	}, nil
}

// ---------------------------------------------------------------------------
// Capability helper
// ---------------------------------------------------------------------------

// hasCapability reports whether the named capability appears in caps.
func hasCapability(caps []string, name string) bool {
	for _, c := range caps {
		if c == name {
			return true
		}
	}
	return false
}
