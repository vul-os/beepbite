package pos

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

type chargeReq struct {
	PaymentMethodCode   string `json:"payment_method_code"`
	AmountPaidCents     int64  `json:"amount_paid_cents"`
	TipAmountCents      int64  `json:"tip_amount_cents"`
	ChangeGivenCents    int64  `json:"change_given_cents"`
	PaymentReference    string `json:"payment_reference"`
	ProcessedByStaffID  string `json:"processed_by_staff_id"`
}

type chargeResp struct {
	OrderID       string `json:"order_id"`
	PaymentID     string `json:"payment_id"`
	PaymentStatus string `json:"payment_status"`
	SessionClosed bool   `json:"session_closed"`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// POST /pos/orders/{order_id}/charge
func (h *Handler) charge(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "order_id")
	if orderID == "" {
		writeErr(w, http.StatusBadRequest, "order_id is required")
		return
	}

	var req chargeReq
	if err := decodeJSON(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}

	if req.PaymentMethodCode == "" {
		writeErr(w, http.StatusBadRequest, "payment_method_code is required")
		return
	}
	if req.AmountPaidCents < 0 {
		writeErr(w, http.StatusBadRequest, "amount_paid_cents must be >= 0")
		return
	}

	resp, err := h.store.ChargeOrder(r.Context(), orderID, req)
	switch {
	case errors.Is(err, ErrOrderNotFound):
		writeErr(w, http.StatusNotFound, "order not found")
	case errors.Is(err, ErrOrderAlreadyPaid):
		writeErr(w, http.StatusConflict, "order already paid")
	case errors.Is(err, ErrPaymentMethodNotFound):
		writeErr(w, http.StatusBadRequest, "invalid payment_method_code")
	case err != nil:
		writeErr(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, resp)
	}
}

// ---------------------------------------------------------------------------
// Store method
// ---------------------------------------------------------------------------

// ChargeOrder records a payment for the given order and optionally closes the
// linked table session — all within a single transaction.
func (s *Store) ChargeOrder(ctx context.Context, orderID string, req chargeReq) (*chargeResp, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// --- 1. Look up order; check payment status ---
	var paymentStatus string
	var tableSessionID *string
	err = tx.QueryRow(ctx, `
		SELECT ofd.payment_status, o.table_session_id
		FROM orders o
		JOIN order_financial_details ofd ON ofd.order_id = o.id
		WHERE o.id = $1
	`, orderID).Scan(&paymentStatus, &tableSessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrOrderNotFound
	}
	if err != nil {
		return nil, err
	}
	if paymentStatus == "paid" {
		return nil, ErrOrderAlreadyPaid
	}

	// --- 2. Validate payment_method_code exists ---
	var pmExists bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM payment_methods WHERE code = $1 AND is_active = true)`,
		req.PaymentMethodCode,
	).Scan(&pmExists); err != nil {
		return nil, err
	}
	if !pmExists {
		return nil, ErrPaymentMethodNotFound
	}

	// --- 3. Insert order_payment ---
	var paymentID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO order_payments
		    (order_id, payment_method_code, amount_paid_cents, tip_amount_cents,
		     change_given_cents, payment_reference, payment_status, processed_by)
		VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7)
		RETURNING id
	`,
		orderID,
		req.PaymentMethodCode,
		req.AmountPaidCents,
		req.TipAmountCents,
		req.ChangeGivenCents,
		nullStr(req.PaymentReference),
		nullStr(req.ProcessedByStaffID),
	).Scan(&paymentID); err != nil {
		return nil, err
	}

	// --- 4. Update order_financial_details ---
	if _, err := tx.Exec(ctx, `
		UPDATE order_financial_details
		SET payment_status = 'paid',
		    payment_method = $2,
		    updated_at     = timezone('utc'::text, now())
		WHERE order_id = $1
	`, orderID, req.PaymentMethodCode); err != nil {
		return nil, err
	}

	// --- 5. Update order status to completed ---
	if _, err := tx.Exec(ctx, `
		UPDATE orders
		SET status = 'completed'
		WHERE id = $1
		  AND status IN ('pending', 'confirmed', 'preparing', 'ready')
	`, orderID); err != nil {
		return nil, err
	}

	// --- 6. Close the linked table session if open ---
	sessionClosed := false
	if tableSessionID != nil && *tableSessionID != "" {
		var sessionStatus string
		err := tx.QueryRow(ctx,
			`SELECT status FROM table_sessions WHERE id = $1 FOR UPDATE`, *tableSessionID,
		).Scan(&sessionStatus)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err == nil && sessionStatus == "open" {
			if _, err := tx.Exec(ctx, `
				UPDATE table_sessions
				SET status     = 'closed',
				    closed_at  = timezone('utc'::text, now()),
				    updated_at = timezone('utc'::text, now())
				WHERE id = $1
			`, *tableSessionID); err != nil {
				return nil, err
			}
			sessionClosed = true
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &chargeResp{
		OrderID:       orderID,
		PaymentID:     paymentID,
		PaymentStatus: "paid",
		SessionClosed: sessionClosed,
	}, nil
}
