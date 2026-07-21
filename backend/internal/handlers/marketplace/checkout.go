package marketplace

// checkout.go — POST /stores/{slug}/orders
//
// Public endpoint: unauthenticated callers (marketplace customers) submit an
// order directly against a store's public slug.  On-delivery fallback mirrors
// the logic in pos.CreateOrder:
//
// BeepBite takes no payment online, so every marketplace order is settled in
// person: at collection, or at the door on delivery.
//
//   - on_delivery_payment_methods empty → 422 "no payment method available".
//   - Non-empty + delivery              → status='pending_on_delivery'.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/beepbite/backend/internal/bizday"
	"github.com/beepbite/backend/internal/locations"
	"github.com/beepbite/backend/internal/money"
	"github.com/beepbite/backend/internal/payments"
	"github.com/beepbite/backend/internal/tax"
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
	FulfillmentType  string              `json:"fulfillment_type"`   // "delivery" | "collection" | "dine_in"
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

	// PayURL is set only when an online gateway is configured for this
	// deployment (see Handler.WithOnlinePayments): the hosted pay-page URL
	// (or, if the specific patala-fiat rail's Charge response carried no
	// redirect_url, a fallback reference string — see
	// PatalaGatewayProvider.Charge's own doc comment) the customer's
	// browser must be sent to next. Empty for the on-delivery path, exactly
	// as before this field existed.
	PayURL string `json:"pay_url,omitempty"`
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

	// gateway is the deployment-wide online payment provider, or nil when
	// none is configured (the default — see Handler.WithOnlinePayments and
	// internal/payments/gateway.go). When nil, CreateCheckoutOrder's
	// behaviour is EXACTLY the pre-existing on-delivery-only flow.
	gateway payments.PaymentProvider
	// gatewayCode is gateway.Code() (e.g. "stripe", "yoco"), cached so the
	// hot path does not call it repeatedly; also the payment_methods.code
	// / order_payments.payment_method_code value online-gateway rows use
	// (see EnsureOnlineTenderSeeded, called once at startup).
	gatewayCode string
	// returnSecret signs/verifies the ?ott= token on the gateway return URL
	// (see payments.SignReturnToken). In practice cfg.JWTSecret.
	returnSecret string
	// apiPublicURL is this backend's own externally-reachable base URL
	// (BEEPBITE_API_PUBLIC_URL) — where the gateway redirects the buyer's
	// browser back to (see buildReturnURL). Required for the gateway to be
	// wired in at all; see cmd/server/main.go.
	apiPublicURL string
}

func newCheckoutStore(pool *pgxpool.Pool) *CheckoutStore {
	return &CheckoutStore{pool: pool}
}

// buildReturnURL mints a signed, order-scoped return URL
// (BEEPBITE_API_PUBLIC_URL + /stores/{slug}/orders/{orderID}/pay/return?ott=...)
// for the gateway's hosted pay page to redirect the customer's browser back
// to once they finish paying — see ChargeRequest.ReturnURL's doc comment for
// why this replaces a poll loop, and payreturn.go for the endpoint itself.
func (cs *CheckoutStore) buildReturnURL(slug, orderID string) string {
	token := payments.SignReturnToken(cs.returnSecret, orderID)
	base := strings.TrimRight(cs.apiPublicURL, "/")
	return fmt.Sprintf("%s/stores/%s/orders/%s/pay/return?ott=%s",
		base, url.PathEscape(slug), url.PathEscape(orderID), url.QueryEscape(token))
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

	// --- 2. Resolve how this order will be paid ---
	onlineGateway := cs.gateway != nil

	var initialStatus, initialPaymentMethod string
	if onlineGateway {
		// Online-gateway path: the order awaits payment confirmation via the
		// provider's hosted pay page + beepbite's own verify-on-return (see
		// buildReturnURL / payreturn.go), not an on-delivery tender.
		// 'pending' is orders.status's own schema DEFAULT — no new status
		// value needed. on_delivery_payment_methods is irrelevant here: the
		// customer is paying up front, for every fulfillment type.
		initialStatus = "pending"
		initialPaymentMethod = cs.gatewayCode
	} else {
		// EXACTLY the pre-existing on-delivery-only flow — unchanged.
		initialStatus = "confirmed"
		initialPaymentMethod = "cash"

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
	// The location's currency, timezone and tax posture, in one cached query.
	// Resolved BEFORE the price arithmetic because Currency.Decimals is the
	// exponent that arithmetic depends on.
	settings, err := locations.SettingsFor(ctx, cs.pool, locationID)
	if err != nil {
		return nil, fmt.Errorf("resolving location settings: %w", err)
	}
	cur := settings.Currency

	unitPriceCentsByItem := make(map[string]int64, len(itemCache))
	for id, ir := range itemCache {
		// The currency's minor-unit exponent, not a literal 100. items.price is
		// a decimal in MAJOR units; ×100 turns a ¥1000 item into ¥100,000.
		unitPriceCentsByItem[id] = int64(math.Round(ir.price * float64(money.Scale(cur.Decimals))))
	}

	var subtotalCents int64
	for _, line := range req.Items {
		subtotalCents += unitPriceCentsByItem[line.ItemID] * int64(line.Quantity)
	}

	// Resolve the store's tax posture — rate AND inclusive/exclusive.
	//
	// This path previously applied the exclusive formula unconditionally while
	// the orders row recorded tax_inclusive from the schema default (true), so
	// a marketplace order in a VAT country was recorded as tax-inclusive and
	// charged as tax-exclusive: the customer paid the VAT twice.
	taxCfg, err := taxConfigFor(ctx, cs.pool, locationID, settings)
	if err != nil {
		return nil, fmt.Errorf("resolving tax configuration: %w", err)
	}
	taxed := taxCfg.Compute(subtotalCents)
	taxRate := taxCfg.Rate.Percent()
	taxInclusive := taxCfg.Inclusive
	taxCents := taxed.Tax
	totalCents := taxed.Gross

	// --- 5. Generate order number ---
	// Scoped by the store's TRADING day (migration 057's orders.business_date),
	// not the UTC day — see internal/bizday for why a UTC boundary resets the
	// sequence mid-service outside a narrow band of longitudes.
	businessDate := bizday.Date(time.Now(), settings.Zone())

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
		  AND business_date = $2::date
	`, locationID, businessDate).Scan(&maxSeq)
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
		    currency_code, delivery_address, estimated_prep_time,
		    business_date
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 30, $15::date)
		RETURNING id
	`,
		orgID, locationID, nullableStr(req.CustomerID), orderNumber,
		mapFulfillment(ft), ft, initialStatus,
		// tax_inclusive was a literal `false` here while the tax was computed
		// exclusively — internally consistent, but it ignored the store's
		// actual convention. It is now snapshotted from the configuration.
		subtotalCents, taxCents, totalCents, taxRate, taxInclusive,
		nullableStr(cur.Code), dAddr,
		businessDate,
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

	// --- 8. Online-gateway path only: start the charge and record a pending
	// tender ---
	//
	// This happens inside the same transaction as the order/order_items
	// insert above, on purpose: either the order AND its pending-payment
	// record both commit, or neither does. The tradeoff (an external HTTP
	// call to the processor happens while the tx is open) is deliberate for
	// this first wave — see docs/ONLINE-PAYMENTS.md — favouring "never leave
	// an order with no payment attempt at all" over minimising lock hold
	// time; a self-hoster with heavy online-order volume may want to move
	// this outside the transaction in a future iteration.
	var payURL string
	if onlineGateway {
		if cur.Code == "" {
			return nil, fmt.Errorf("online payment requires a configured store currency")
		}
		returnURL := cs.buildReturnURL(slug, orderID)
		receipt, err := cs.gateway.Charge(ctx, payments.ChargeRequest{
			OrderID:   orderID,
			Tender:    cs.gatewayCode,
			Amount:    payments.Amount{Cents: totalCents, CurrencyCode: cur.Code},
			Reference: orderNumber,
			ReturnURL: returnURL,
		})
		if err != nil {
			return nil, fmt.Errorf("starting online payment: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO order_payments
			    (order_id, payment_method_code, amount_paid_cents,
			     payment_reference, external_transaction_id, payment_status)
			VALUES ($1, $2, $3, NULLIF($4, ''), $5, 'pending')
		`, orderID, cs.gatewayCode, totalCents, receipt.Reference, receipt.ID); err != nil {
			return nil, err
		}
		// receipt.Reference is either the hosted-checkout redirect URL or,
		// absent one, a fallback reference string — see
		// PatalaGatewayProvider.Charge's own doc comment. Either way it is
		// what the customer's browser goes to next.
		payURL = receipt.Reference
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
		PayURL:        payURL,
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

// taxConfigFor resolves the effective tax posture — rate, inclusive/exclusive
// convention, and receipt label — for a location:
//
//  1. The first active row in tax_rates for the location, which carries its own
//     rate and is_inclusive.
//  2. The location's own tax settings, already resolved into `settings`.
//
// It returns BOTH the rate and the convention because a rate alone is not
// enough to compute a total, and treating it as if it were is how the
// exclusive-only formula ended up here in the first place.
//
// This is a local copy to avoid a cross-package dependency on the pos package.
func taxConfigFor(ctx context.Context, pool *pgxpool.Pool, locationID string, settings locations.Settings) (tax.Config, error) {
	var (
		rate      float64
		inclusive bool
		label     *string
	)
	err := pool.QueryRow(ctx, `
		SELECT CAST(rate AS float8), is_inclusive, name
		FROM tax_rates
		WHERE location_id = $1
		  AND is_active = true
		ORDER BY created_at
		LIMIT 1
	`, locationID).Scan(&rate, &inclusive, &label)
	if err == nil {
		cfg := tax.Config{Rate: tax.RateFromPercent(rate), Inclusive: inclusive}
		if label != nil {
			cfg.Label = *label
		}
		return cfg, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return tax.Config{}, err
	}

	// Fall back to the location's own tax_rate / tax_inclusive / tax_label
	// (migration 056). A zero rate here is a legitimate configuration —
	// tax-exempt, or a jurisdiction with no sales tax — and charges nothing
	// rather than inheriting some other country's rate.
	return settings.Tax, nil
}
