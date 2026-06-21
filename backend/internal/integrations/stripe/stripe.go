// Package stripe is a small, dependency-free Stripe client that supports
// per-location (BYO) secret keys.
//
// The surface is intentionally narrow — we only need what BeepBite's
// checkout + webhook flow requires:
//
//   - CreatePaymentIntent: opens a payment and returns the client_secret
//     so the merchant's storefront can confirm it with Stripe.js.
//   - RetrievePaymentIntent: used to reconcile after redirect or from the
//     webhook handler.
//   - VerifyWebhookSignature: validates Stripe-Signature headers.
//
// Why no official SDK? The SDK is large and pulls global singletons for
// api keys — we need one client per location, and we only use a few REST
// endpoints. A small bespoke client is easier to reason about here.
package stripe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const apiBase = "https://api.stripe.com/v1"

type Client struct {
	secretKey  string
	httpClient *http.Client
}

type Config struct {
	SecretKey  string
	HTTPClient *http.Client
}

func NewClient(cfg Config) *Client {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{secretKey: cfg.SecretKey, httpClient: hc}
}

// PaymentIntent is the subset of Stripe's PaymentIntent object we care about.
// Stripe's full shape is large; we only decode fields the app reads.
type PaymentIntent struct {
	ID               string                 `json:"id"`
	ClientSecret     string                 `json:"client_secret"`
	Status           string                 `json:"status"` // requires_payment_method, succeeded, …
	Amount           int64                  `json:"amount"`
	AmountReceived   int64                  `json:"amount_received"`
	Currency         string                 `json:"currency"`
	Metadata         map[string]string      `json:"metadata"`
	LatestCharge     string                 `json:"latest_charge"`
	PaymentMethod    string                 `json:"payment_method"`
	LastPaymentError map[string]interface{} `json:"last_payment_error"`
}

type stripeError struct {
	Err struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error"`
}

// CreatePaymentIntentParams — inputs for a new payment.
type CreatePaymentIntentParams struct {
	AmountCents int64
	Currency    string // "zar", "usd", …
	// OrderID flows through as metadata so the webhook can reconcile back to
	// our order_payments row without parsing references.
	OrderID       string
	LocationID    string
	CustomerEmail string
	Description   string
	// ReceiptEmail sends a Stripe-hosted receipt; optional.
	ReceiptEmail string
}

func (c *Client) CreatePaymentIntent(ctx context.Context, p CreatePaymentIntentParams) (*PaymentIntent, error) {
	if c.secretKey == "" {
		return nil, errors.New("stripe: secret key not set")
	}
	if p.AmountCents <= 0 {
		return nil, errors.New("stripe: amount must be > 0")
	}
	currency := p.Currency
	if currency == "" {
		currency = "zar"
	}

	form := url.Values{}
	form.Set("amount", strconv.FormatInt(p.AmountCents, 10))
	form.Set("currency", currency)
	form.Set("automatic_payment_methods[enabled]", "true")
	if p.CustomerEmail != "" {
		form.Set("receipt_email", firstNonEmpty(p.ReceiptEmail, p.CustomerEmail))
	}
	if p.Description != "" {
		form.Set("description", p.Description)
	}
	if p.OrderID != "" {
		form.Set("metadata[order_id]", p.OrderID)
	}
	if p.LocationID != "" {
		form.Set("metadata[location_id]", p.LocationID)
	}

	var pi PaymentIntent
	if err := c.doForm(ctx, http.MethodPost, "/payment_intents", form, &pi); err != nil {
		return nil, err
	}
	return &pi, nil
}

// RetrievePaymentIntent fetches current state of a PaymentIntent.
func (c *Client) RetrievePaymentIntent(ctx context.Context, id string) (*PaymentIntent, error) {
	if c.secretKey == "" {
		return nil, errors.New("stripe: secret key not set")
	}
	if id == "" {
		return nil, errors.New("stripe: id required")
	}
	var pi PaymentIntent
	if err := c.doForm(ctx, http.MethodGet, "/payment_intents/"+url.PathEscape(id), nil, &pi); err != nil {
		return nil, err
	}
	return &pi, nil
}

func (c *Client) doForm(ctx context.Context, method, path string, form url.Values, out any) error {
	var body io.Reader
	if form != nil && method != http.MethodGet {
		body = bytes.NewBufferString(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, apiBase+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("stripe: request: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var se stripeError
		_ = json.Unmarshal(raw, &se)
		msg := se.Err.Message
		if msg == "" {
			msg = fmt.Sprintf("status %d", resp.StatusCode)
		}
		return fmt.Errorf("stripe: %s (%s/%s)", msg, se.Err.Type, se.Err.Code)
	}

	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("stripe: decode: %w", err)
		}
	}
	return nil
}

func firstNonEmpty(xs ...string) string {
	for _, x := range xs {
		if x != "" {
			return x
		}
	}
	return ""
}
