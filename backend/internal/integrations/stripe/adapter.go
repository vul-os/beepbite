// adapter.go — wraps stripe.Manager / stripe.Client into the payments.Provider
// interface defined in internal/payments/provider.go.
//
// Usage:
//
//	mgr := stripe.NewManager(stripe.ManagerConfig{})
//	var p payments.Provider = stripe.NewAdapter(mgr, "us")
//
// The Adapter resolves the region-scoped credentials from the Manager once at
// construction time so per-call overhead is minimal.
package stripe

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/beepbite/backend/internal/payments"
)

// Adapter wraps a pre-configured *Client and a webhook secret to satisfy the
// payments.Provider interface for a specific Stripe credential set.
type Adapter struct {
	client        *Client
	webhookSecret string
}

// NewAdapter builds an Adapter from a Manager for the given region code.
// Returns an error when the region has no configured credentials.
func NewAdapter(mgr *Manager, regionCode string) (*Adapter, error) {
	client, creds, err := mgr.ClientFor(regionCode)
	if err != nil {
		return nil, fmt.Errorf("stripe adapter: %w", err)
	}
	return &Adapter{
		client:        client,
		webhookSecret: creds.WebhookSecret,
	}, nil
}

// NewAdapterFromCreds builds an Adapter directly from credentials without
// requiring a Manager. Useful in tests or handler code that has already
// resolved credentials.
func NewAdapterFromCreds(secretKey, webhookSecret string, hc *http.Client) *Adapter {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Adapter{
		client:        NewClient(Config{SecretKey: secretKey, HTTPClient: hc}),
		webhookSecret: webhookSecret,
	}
}

// Code implements payments.Provider. Always returns "stripe".
func (a *Adapter) Code() string { return "stripe" }

// ── InitCheckout ──────────────────────────────────────────────────────────────

// stripeCheckoutSession is the minimal subset of Stripe's Checkout Session
// object we decode.
type stripeCheckoutSession struct {
	ID  string `json:"id"`
	URL string `json:"url"`
}

// InitCheckout creates a Stripe Checkout Session (mode=payment) and returns
// the session URL (for customer redirect) and session ID (stored as
// providerTxnID).
//
// Mapping from CheckoutParams:
//   - params.CallbackURL  → success_url (also used as cancel_url when no
//     cancel_url key exists in MetadataJSON)
//   - params.CustomerEmail → customer_email
//   - params.OrderID is always forwarded as
//     payment_intent_data[metadata][order_id]
//   - MetadataJSON keys are forwarded as payment_intent_data[metadata][key]
//     (except the reserved "cancel_url" which becomes the cancel_url field)
func (a *Adapter) InitCheckout(
	ctx context.Context,
	params payments.CheckoutParams,
) (hostedURL, providerTxnID string, err error) {
	if params.AmountCents <= 0 {
		return "", "", fmt.Errorf("stripe: InitCheckout: amount must be > 0")
	}
	if params.CallbackURL == "" {
		return "", "", fmt.Errorf("stripe: InitCheckout: CallbackURL (success_url) is required")
	}

	currency := strings.ToLower(params.CurrencyCode)
	if currency == "" {
		currency = "usd"
	}

	cancelURL := params.CallbackURL
	extraMeta := jsonMetaMap(params.MetadataJSON)
	if v := extraMeta["cancel_url"]; v != "" {
		cancelURL = v
	}

	productName := "Order " + params.OrderID
	if params.CustomerName != "" {
		productName = "Order for " + params.CustomerName
	}

	form := url.Values{}
	form.Set("mode", "payment")
	form.Set("success_url", params.CallbackURL)
	form.Set("cancel_url", cancelURL)
	form.Set("line_items[0][price_data][currency]", currency)
	form.Set("line_items[0][price_data][unit_amount]", strconv.FormatInt(params.AmountCents, 10))
	form.Set("line_items[0][price_data][product_data][name]", productName)
	form.Set("line_items[0][quantity]", "1")
	if params.CustomerEmail != "" {
		form.Set("customer_email", params.CustomerEmail)
	}
	form.Set("payment_intent_data[metadata][order_id]", params.OrderID)
	for k, v := range extraMeta {
		if k == "cancel_url" {
			continue
		}
		form.Set("payment_intent_data[metadata]["+k+"]", v)
	}

	var sess stripeCheckoutSession
	if err := a.client.doForm(ctx, http.MethodPost, "/checkout/sessions", form, &sess); err != nil {
		return "", "", fmt.Errorf("stripe: create checkout session: %w", err)
	}
	if sess.URL == "" {
		return "", "", fmt.Errorf("stripe: checkout session returned empty URL")
	}
	return sess.URL, sess.ID, nil
}

// ── VerifyWebhook ─────────────────────────────────────────────────────────────

// VerifyWebhook validates the Stripe-Signature header and returns a normalised
// payments.Event.
//
// HMAC scheme (Stripe-specific):
//   - Header format: `t=<unix-timestamp>,v1=<hex-HMAC>[,v1=<hex-HMAC>…]`
//   - Signed payload: concatenation of `<timestamp>`, `.`, and the raw body bytes
//   - Algorithm: HMAC-SHA256 keyed with the webhook endpoint secret (whsec_…)
//   - Multiple v1= values are accepted for secret rotation
//   - Timestamp drift > 5 minutes is rejected (replay protection)
//
// webhookSecret overrides the adapter's built-in secret when non-nil/non-empty,
// allowing per-location BYO keys injected by the Registry.
func (a *Adapter) VerifyWebhook(
	_ context.Context,
	signature string,
	rawBody []byte,
	webhookSecret []byte,
) (payments.Event, error) {
	secret := string(webhookSecret)
	if secret == "" {
		secret = a.webhookSecret
	}

	if err := VerifyWebhookSignature(secret, rawBody, signature, time.Now()); err != nil {
		return payments.Event{}, payments.ErrWebhookSignatureInvalid
	}

	ev, err := ParseWebhookEvent(rawBody)
	if err != nil {
		return payments.Event{}, fmt.Errorf("stripe: parse webhook event: %w", err)
	}

	txnID, orderID := extractIDs(ev)

	return payments.Event{
		Kind:          mapStripeEventKind(ev.Type),
		ProviderTxnID: txnID,
		OrderID:       orderID,
		RawPayload:    rawBody,
		Signature:     signature,
		OccurredAt:    time.Unix(ev.Created, 0),
	}, nil
}

// mapStripeEventKind translates Stripe event types to the provider-neutral
// kind string defined in payments/provider.go.
func mapStripeEventKind(stripeType string) string {
	switch stripeType {
	case "checkout.session.completed", "payment_intent.succeeded":
		return payments.EventCheckoutCompleted
	case "payment_intent.payment_failed", "charge.failed":
		return payments.EventCheckoutFailed
	case "charge.refunded":
		return payments.EventRefundSucceeded
	case "transfer.created", "payout.paid":
		return payments.EventTransferSucceeded
	case "transfer.failed", "payout.failed":
		return payments.EventTransferFailed
	default:
		return "unknown"
	}
}

// extractIDs pulls the provider transaction ID and order ID from the Stripe
// event data envelope via best-effort JSON decode.
func extractIDs(ev *WebhookEvent) (txnID, orderID string) {
	var outer struct {
		Object struct {
			ID            string            `json:"id"`
			PaymentIntent string            `json:"payment_intent"`
			Metadata      map[string]string `json:"metadata"`
		} `json:"object"`
	}
	if err := json.Unmarshal(ev.Data, &outer); err != nil {
		return "", ""
	}
	txnID = outer.Object.PaymentIntent
	if txnID == "" {
		txnID = outer.Object.ID
	}
	if m := outer.Object.Metadata; m != nil {
		orderID = m["order_id"]
	}
	return txnID, orderID
}

// ── Refund ────────────────────────────────────────────────────────────────────

type stripeRefundResponse struct {
	ID string `json:"id"`
}

// Refund calls POST /v1/refunds. amount.Cents <= 0 triggers a full refund.
// providerTxnID may be a PaymentIntent (pi_…) or a Charge (ch_…).
func (a *Adapter) Refund(ctx context.Context, providerTxnID string, amount payments.Amount) (string, error) {
	if providerTxnID == "" {
		return "", fmt.Errorf("stripe: Refund: providerTxnID required")
	}
	form := url.Values{}
	if strings.HasPrefix(providerTxnID, "pi_") {
		form.Set("payment_intent", providerTxnID)
	} else {
		form.Set("charge", providerTxnID)
	}
	if amount.Cents > 0 {
		form.Set("amount", strconv.FormatInt(amount.Cents, 10))
	}
	var ref stripeRefundResponse
	if err := a.client.doForm(ctx, http.MethodPost, "/refunds", form, &ref); err != nil {
		return "", fmt.Errorf("stripe: refund: %w", err)
	}
	return ref.ID, nil
}

// ── ChargeSaved ───────────────────────────────────────────────────────────────

// ChargeSaved creates a PaymentIntent with confirm=true against a saved Stripe
// payment method. paymentMethodToken is a Stripe payment_method ID (pm_…).
// idempotencyKey is forwarded as the Idempotency-Key request header so Stripe
// safely de-duplicates retries.
func (a *Adapter) ChargeSaved(
	ctx context.Context,
	paymentMethodToken string,
	amount payments.Amount,
	idempotencyKey string,
) (string, error) {
	if paymentMethodToken == "" {
		return "", fmt.Errorf("stripe: ChargeSaved: paymentMethodToken required")
	}
	if amount.Cents <= 0 {
		return "", fmt.Errorf("stripe: ChargeSaved: amount.Cents must be > 0")
	}
	currency := strings.ToLower(amount.CurrencyCode)
	if currency == "" {
		currency = "usd"
	}

	form := url.Values{}
	form.Set("amount", strconv.FormatInt(amount.Cents, 10))
	form.Set("currency", currency)
	form.Set("payment_method", paymentMethodToken)
	form.Set("confirm", "true")
	form.Set("off_session", "true")

	// Build the request manually to attach the Idempotency-Key header.
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiBase+"/payment_intents",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("stripe: ChargeSaved: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+a.client.secretKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}

	resp, err := a.client.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("stripe: ChargeSaved: http: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var se stripeError
		_ = json.Unmarshal(raw, &se)
		msg := se.Err.Message
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return "", fmt.Errorf("stripe: ChargeSaved: %s (%s/%s)", msg, se.Err.Type, se.Err.Code)
	}

	var pi PaymentIntent
	if err := json.Unmarshal(raw, &pi); err != nil {
		return "", fmt.Errorf("stripe: ChargeSaved: decode: %w", err)
	}
	return pi.ID, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

// jsonMetaMap decodes a JSON object blob into a flat string-string map.
// Returns nil on any error or empty input.
func jsonMetaMap(raw []byte) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	var m map[string]string
	_ = json.Unmarshal(raw, &m)
	return m
}

// compile-time interface check
var _ payments.Provider = (*Adapter)(nil)
