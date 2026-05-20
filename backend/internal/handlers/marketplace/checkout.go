package marketplace

// checkout.go — POST /stores/{slug}/orders
//
// Public endpoint: unauthenticated callers (marketplace customers) submit an
// order directly against a store's public slug.  On-delivery fallback mirrors
// the logic in pos.CreateOrder:
//
//   - No active location_payment_credentials → consult on_delivery_payment_methods.
//   - Empty array                             → 422 "no payment method available".
//   - Non-empty + delivery                   → status='pending_on_delivery'.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ErrNoPaymentMethod is returned when no active credential and no on-delivery fallback exists.
var ErrNoPaymentMethod = errors.New("no payment method available")

// ErrStoreNotAcceptingOrders is returned when the location is not active / visible.
var ErrStoreNotAcceptingOrders = errors.New("store not accepting orders")

// ---------------------------------------------------------------------------
// Request / response types
// ---------------------------------------------------------------------------

// CheckoutLineInput is one cart line in the checkout request.
type CheckoutLineInput struct {
	ItemID   string `json:"item_id"`
	Quantity int    `json:"quantity"`
	Notes    string `json:"notes"`
}

// CheckoutReq is the POST /stores/{slug}/orders body.
type CheckoutReq struct {
	CustomerID       string              `json:"customer_id"`
	FulfillmentType  string              `json:"fulfillment_type"`  // "delivery" | "collection" | "dine_in"
	OnDeliveryMethod string              `json:"on_delivery_method"` // "cash" | "card_machine"
	DeliveryAddress  string              `json:"delivery_address"`
	Items            []CheckoutLineInput `json:"items"`
}

// CheckoutResp is the response body returned to the customer.
type CheckoutResp struct {
	OrderID       string  `json:"order_id"`
	OrderNumber   string  `json:"order_number"`
	Status        string  `json:"status"`
	PaymentMethod string  `json:"payment_method"`
	Total         float64 `json:"total"`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// POST /stores/{slug}/orders
func (h *Handler) createCheckoutOrder(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "slug required")
		return
	}

	var req CheckoutReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if len(req.Items) == 0 {
		writeError(w, http.StatusBadRequest, "items must not be empty")
		return
	}

	ft := req.FulfillmentType
	if ft != "delivery" && ft != "collection" && ft != "dine_in" {
		writeError(w, http.StatusBadRequest, "fulfillment_type must be one of: delivery, collection, dine_in")
		return
	}

	resp, err := h.checkoutStore.CreateCheckoutOrder(r.Context(), slug, req)
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrStoreNotAcceptingOrders):
		writeError(w, http.StatusNotFound, "store not found")
	case errors.Is(err, ErrNoPaymentMethod):
		writeError(w, http.StatusUnprocessableEntity, "no payment method available — store cannot accept orders right now")
	case err != nil:
		writeError(w, http.StatusInternalServerError, "internal error")
	default:
		writeJSON(w, http.StatusCreated, resp)
	}
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// CheckoutStore handles marketplace order creation.
type CheckoutStore struct {
	pool interface {
		QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
		BeginTx(ctx context.Context, txOptions pgx.TxOptions) (pgx.Tx, error)
	}
}

func newCheckoutStore(pool pgxPool) *CheckoutStore {
	return &CheckoutStore{pool: pool}
}

// pgxPool is the subset of pgxpool.Pool used by CheckoutStore (allows test injection).
type pgxPool interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	BeginTx(ctx context.Context, txOptions pgx.TxOptions) (pgx.Tx, error)
}

// CreateCheckoutOrder creates an order from the public checkout surface.
func (cs *CheckoutStore) CreateCheckoutOrder(
	ctx context.Context,
	slug string,
	req CheckoutReq,
) (*CheckoutResp, error) {
	tx, err := cs.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// --- 1. Resolve location by slug ---
	var locationID string
	var onDeliveryMethods []string
	err = tx.QueryRow(ctx, `
		SELECT id, on_delivery_payment_methods
		FROM locations
		WHERE slug = $1
		  AND is_marketplace_visible = true
		  AND is_active = true
	`, slug).Scan(&locationID, &onDeliveryMethods)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}

	// --- 2. Check active payment credential ---
	var hasActiveCredential bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM location_payment_credentials WHERE location_id = $1 AND is_active = true)`,
		locationID,
	).Scan(&hasActiveCredential); err != nil {
		return nil, err
	}

	initialStatus := "confirmed"
	initialPaymentMethod := "cash"

	if !hasActiveCredential {
		if len(onDeliveryMethods) == 0 {
			return nil, ErrNoPaymentMethod
		}
		if req.FulfillmentType == "delivery" {
			initialStatus = "pending_on_delivery"
			switch req.OnDeliveryMethod {
			case "card_machine":
				initialPaymentMethod = "card_on_delivery"
			default:
				initialPaymentMethod = "cash_on_delivery"
			}
		}
	}

	// --- 3. Resolve item prices ---
	type itemRow struct {
		price float64
	}
	itemCache := make(map[string]itemRow, len(req.Items))
	for _, line := range req.Items {
		if _, ok := itemCache[line.ItemID]; ok {
			continue
		}
		var ir itemRow
		err := tx.QueryRow(ctx,
			`SELECT price FROM items WHERE id = $1 AND location_id = $2 AND is_active = true AND is_86ed = false`,
			line.ItemID, locationID,
		).Scan(&ir.price)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("item not found: %s", line.ItemID)
		}
		if err != nil {
			return nil, err
		}
		itemCache[line.ItemID] = ir
	}

	// --- 4. Compute total ---
	var subtotal float64
	for _, line := range req.Items {
		subtotal += itemCache[line.ItemID].price * float64(line.Quantity)
	}
	const taxRate = 15.0
	taxAmount := subtotal * (taxRate / 100.0)
	total := subtotal + taxAmount

	// --- 5. Generate order number ---
	var maxSeq int
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(
			CASE
				WHEN order_number ~ '^MKT([0-9]+)$' THEN (regexp_replace(order_number, '^MKT', ''))::int
				ELSE 0
			END
		), 0)
		FROM orders
		WHERE location_id = $1
		  AND date_trunc('day', created_at AT TIME ZONE 'UTC') = date_trunc('day', now() AT TIME ZONE 'UTC')
	`, locationID).Scan(&maxSeq)
	orderNumber := fmt.Sprintf("MKT%04d", maxSeq+1)

	// --- 6. Insert order ---
	var orderID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO orders (location_id, customer_id, order_number, order_type, status)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, locationID, nullableStr(req.CustomerID), orderNumber, mapFulfillment(req.FulfillmentType), initialStatus,
	).Scan(&orderID); err != nil {
		return nil, err
	}

	// --- 7. Insert order_details ---
	var dAddr interface{}
	if req.DeliveryAddress != "" {
		dAddr = req.DeliveryAddress
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_details (order_id, estimated_prep_time, delivery_address)
		VALUES ($1, 30, $2)
	`, orderID, dAddr); err != nil {
		return nil, err
	}

	// --- 8. Insert order_financial_details ---
	if _, err := tx.Exec(ctx, `
		INSERT INTO order_financial_details
		    (order_id, subtotal, delivery_fee, total_amount, tax_rate, tax_amount, tax_inclusive, payment_status, payment_method)
		VALUES ($1, $2, 0, $3, $4, $5, false, 'pending', $6)
	`, orderID, subtotal, total, taxRate, taxAmount, initialPaymentMethod); err != nil {
		return nil, err
	}

	// --- 9. Insert order items ---
	for _, line := range req.Items {
		unitPrice := itemCache[line.ItemID].price
		totalPrice := unitPrice * float64(line.Quantity)
		if _, err := tx.Exec(ctx, `
			INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, special_instructions)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, orderID, line.ItemID, line.Quantity, unitPrice, totalPrice, nullableStr(line.Notes)); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &CheckoutResp{
		OrderID:       orderID,
		OrderNumber:   orderNumber,
		Status:        initialStatus,
		PaymentMethod: initialPaymentMethod,
		Total:         total,
	}, nil
}

// mapFulfillment maps fulfillment_type to the legacy order_type text column.
func mapFulfillment(ft string) string {
	switch ft {
	case "delivery":
		return "delivery"
	case "dine_in":
		return "dine_in"
	default:
		return "pickup"
	}
}

// nullableStr converts an empty string to nil for nullable DB columns.
func nullableStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
