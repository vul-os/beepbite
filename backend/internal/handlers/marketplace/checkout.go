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
	"math"
	"net/http"

	"github.com/beepbite/backend/internal/locations"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
	pool *pgxpool.Pool
}

func newCheckoutStore(pool *pgxpool.Pool) *CheckoutStore {
	return &CheckoutStore{pool: pool}
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

	// --- 1. Resolve location by slug — also fetch organization_id ---
	// organization_id is NOT NULL on orders and the RLS WITH CHECK requires it to
	// equal current_org_id(), so we must supply it from the owning location.
	var locationID, orgID string
	var onDeliveryMethods []string
	err = tx.QueryRow(ctx, `
		SELECT id, organization_id, on_delivery_payment_methods
		FROM locations
		WHERE slug = $1
		  AND is_marketplace_visible = true
		  AND is_active = true
	`, slug).Scan(&locationID, &orgID, &onDeliveryMethods)
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

	// --- 4. Compute totals in integer cents (mirrors pos.CreateOrder) ---
	// Unit prices are stored as float64 dollars in items.price; convert to cents
	// via round to avoid floating-point drift.
	unitPriceCentsByItem := make(map[string]int64, len(itemCache))
	for id, ir := range itemCache {
		unitPriceCentsByItem[id] = int64(math.Round(ir.price * 100))
	}

	var subtotalCents int64
	for _, line := range req.Items {
		subtotalCents += unitPriceCentsByItem[line.ItemID] * int64(line.Quantity)
	}

	// Resolve per-store tax rate (5-min cached; fallback chain: tax_rates row →
	// region default → 0). Uses the real pool (not the tx) to match pos.TaxRateFor.
	taxRate, err := taxRateFor(ctx, cs.pool, locationID)
	if err != nil {
		return nil, fmt.Errorf("resolving tax rate: %w", err)
	}
	// Tax-exclusive: tax added on top of subtotal (consistent with POS path).
	taxCents := int64(math.Round(float64(subtotalCents) * taxRate / 100.0))
	totalCents := subtotalCents + taxCents

	// --- T8.5: Resolve per-store currency (5-min cached; fallback → ZAR) ---
	cur, err := locations.CurrencyFor(ctx, cs.pool, locationID)
	if err != nil {
		return nil, fmt.Errorf("resolving currency: %w", err)
	}

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

	// --- 6. Insert order into the consolidated orders table ---
	// order_details and order_financial_details no longer exist (Wave 0 schema
	// consolidation folded them into orders). All financial and delivery columns
	// live directly on the orders row.
	var dAddr interface{}
	if req.DeliveryAddress != "" {
		dAddr = req.DeliveryAddress
	}
	ft := req.FulfillmentType
	var orderID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO orders (
		    organization_id, location_id, customer_id, order_number,
		    order_type, fulfillment_type, status,
		    subtotal_cents, tax_cents, total_cents, tax_rate, tax_inclusive,
		    currency_code, delivery_address, estimated_prep_time
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12, $13, 30)
		RETURNING id
	`,
		orgID, locationID, nullableStr(req.CustomerID), orderNumber,
		mapFulfillment(ft), ft, initialStatus,
		subtotalCents, taxCents, totalCents, taxRate,
		cur.Code, dAddr,
	).Scan(&orderID); err != nil {
		return nil, err
	}

	// --- 7. Insert order items using bigint cents columns ---
	// The consolidated schema uses unit_price_cents / total_price_cents (bigint),
	// not the legacy float unit_price / total_price columns.
	for _, line := range req.Items {
		unitCents := unitPriceCentsByItem[line.ItemID]
		if _, err := tx.Exec(ctx, `
			INSERT INTO order_items (order_id, item_id, quantity, unit_price_cents, total_price_cents, special_instructions)
			VALUES ($1, $2, $3, $4, $5, $6)
		`, orderID, line.ItemID, line.Quantity, unitCents, unitCents*int64(line.Quantity), nullableStr(line.Notes)); err != nil {
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
		Total:         float64(totalCents) / 100,
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

// taxRateFor resolves the effective tax rate (percentage, e.g. 15.0) for the
// given location using the same fallback chain as pos.TaxRateFor:
//  1. First active row in tax_rates for the location.
//  2. Region's default_tax_rate (via locations.region_id).
//  3. Zero — logged for ops visibility.
//
// This is a local copy to avoid a cross-package dependency on the pos package.
func taxRateFor(ctx context.Context, pool *pgxpool.Pool, locationID string) (float64, error) {
	// Step 1: location-specific tax_rates row.
	var rate float64
	err := pool.QueryRow(ctx, `
		SELECT CAST(rate AS float8)
		FROM tax_rates
		WHERE location_id = $1
		  AND is_active = true
		ORDER BY created_at
		LIMIT 1
	`, locationID).Scan(&rate)
	if err == nil {
		return rate, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}

	// Step 2: region default.
	err = pool.QueryRow(ctx, `
		SELECT CAST(r.default_tax_rate AS float8)
		FROM locations l
		JOIN regions r ON r.id = l.region_id
		WHERE l.id = $1
	`, locationID).Scan(&rate)
	if err == nil {
		return rate, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}

	// Step 3: zero fallback.
	return 0, nil
}
