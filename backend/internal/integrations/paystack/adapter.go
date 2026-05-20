// adapter.go — payments.Provider adapter wrapping paystack.Manager / Client.
//
// Adapter implements the generic payments.Provider interface so the rest of
// the codebase can use Paystack without knowing its internals.  The existing
// Manager and Client are kept entirely intact; Adapter is purely a translation
// layer on top.
//
// Adapter is NOT tied to a single region credential.  It holds a reference to
// the Manager and requires the caller to supply a region code (or resolved
// *Client + webhookSecret) at construction time, depending on the usage
// pattern:
//
//   - For a location-scoped checkout, build the Adapter via NewAdapter with an
//     explicit *Client + webhookSecret obtained from Manager.ClientFor or
//     Manager.ForLocation.
//   - The Code() / interface contract is met regardless.
package paystack

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/beepbite/backend/internal/payments"
)

// Adapter wraps a pre-configured *Client and a webhook secret to satisfy the
// payments.Provider interface for a specific Paystack credential set.
type Adapter struct {
	client        *Client
	webhookSecret string
}

// NewAdapter constructs an Adapter from a ready-made *Client and the webhook
// secret for that region.  Both arguments are required.
func NewAdapter(c *Client, webhookSecret string) *Adapter {
	return &Adapter{client: c, webhookSecret: webhookSecret}
}

// NewAdapterFromManager is a convenience constructor that looks up the region
// credentials from a Manager and builds the Client in one step.
func NewAdapterFromManager(m *Manager, regionCode string) (*Adapter, error) {
	c, creds, err := m.ClientFor(regionCode)
	if err != nil {
		return nil, err
	}
	return &Adapter{client: c, webhookSecret: creds.WebhookSecret}, nil
}

// Code implements payments.Provider.  Always returns "paystack".
func (a *Adapter) Code() string { return "paystack" }

// ── InitCheckout ─────────────────────────────────────────────────────────────

// initRequest mirrors the Paystack POST /transaction/initialize body.
type initRequest struct {
	Email       string                 `json:"email"`
	Amount      int64                  `json:"amount"` // in kobo / smallest unit
	Reference   string                 `json:"reference"`
	Currency    string                 `json:"currency"`
	CallbackURL string                 `json:"callback_url,omitempty"`
	Metadata    map[string]interface{} `json:"metadata,omitempty"`
}

type initResponseData struct {
	AuthorizationURL string `json:"authorization_url"`
	Reference        string `json:"reference"`
}

type initAPIResponse struct {
	Status  bool             `json:"status"`
	Message string           `json:"message"`
	Data    initResponseData `json:"data"`
}

// InitCheckout calls POST /transaction/initialize.
//
// params.AmountCents must be in the currency's smallest unit (kobo for NGN,
// cents for ZAR — Paystack treats all currencies in their smallest unit).
//
// Recognised MetadataJSON keys (decoded from JSON):
//
//	"email"        — required for Paystack; falls back to "noreply@beepbite.com"
//	"callback_url" — redirect URL after hosted payment; optional
//	"customer_name"— surfaced in Paystack dashboard; optional
//
// Returns (authorizationURL, reference, error).
func (a *Adapter) InitCheckout(ctx context.Context, params payments.CheckoutParams) (string, string, error) {
	email := params.CustomerEmail
	if email == "" {
		email = "noreply@beepbite.com"
	}
	ref := adapterReference(params.OrderID)

	meta := map[string]interface{}{
		"order_id": params.OrderID,
	}
	if params.CustomerName != "" {
		meta["customer_name"] = params.CustomerName
	}

	reqBody := initRequest{
		Email:       email,
		Amount:      params.AmountCents,
		Reference:   ref,
		Currency:    params.CurrencyCode,
		CallbackURL: params.CallbackURL,
		Metadata:    meta,
	}

	b, err := json.Marshal(reqBody)
	if err != nil {
		return "", "", fmt.Errorf("paystack adapter: InitCheckout: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.paystack.co/transaction/initialize", bytes.NewReader(b))
	if err != nil {
		return "", "", fmt.Errorf("paystack adapter: InitCheckout: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+a.client.secretKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := a.client.httpClient.Do(httpReq)
	if err != nil {
		return "", "", fmt.Errorf("paystack adapter: InitCheckout: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("paystack adapter: InitCheckout: HTTP %d: %s", resp.StatusCode, paystackMsg(raw))
	}

	var out initAPIResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", "", fmt.Errorf("paystack adapter: InitCheckout: decode: %w", err)
	}
	if !out.Status {
		return "", "", fmt.Errorf("paystack adapter: InitCheckout: %s", out.Message)
	}
	return out.Data.AuthorizationURL, out.Data.Reference, nil
}

// ── VerifyWebhook ─────────────────────────────────────────────────────────────

// VerifyWebhook authenticates the HMAC-SHA512 signature and parses the event.
//
// Paystack signs the raw request body with HMAC-SHA512 using the webhook secret
// and sends the hex digest in the "x-paystack-signature" header.  signature
// must be exactly that header value.  webhookSecret overrides the Adapter's
// built-in secret when non-empty, allowing callers with per-location BYO keys
// to pass those in directly.
func (a *Adapter) VerifyWebhook(_ context.Context, signature string, rawBody []byte, webhookSecret []byte) (payments.Event, error) {
	secret := string(webhookSecret)
	if secret == "" {
		secret = a.webhookSecret
	}
	if secret == "" {
		return payments.Event{}, fmt.Errorf("paystack adapter: VerifyWebhook: no webhook secret configured")
	}
	if signature == "" {
		return payments.Event{}, fmt.Errorf("paystack adapter: VerifyWebhook: missing signature header")
	}

	// Constant-time HMAC-SHA512 check.
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(rawBody)
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(signature), []byte(want)) {
		return payments.Event{}, payments.ErrWebhookSignatureInvalid
	}

	// Parse the event.
	var payload struct {
		Event string `json:"event"`
		Data  struct {
			ID        json.RawMessage `json:"id"`
			Reference string          `json:"reference"`
			Status    string          `json:"status"`
			Amount    int64           `json:"amount"`
			Currency  string          `json:"currency"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		return payments.Event{}, fmt.Errorf("paystack adapter: VerifyWebhook: parse body: %w", err)
	}

	txnID := ""
	if len(payload.Data.ID) > 0 {
		// ID can be a number or string in Paystack payloads.
		_ = json.Unmarshal(payload.Data.ID, &txnID)
		if txnID == "" {
			txnID = string(payload.Data.ID)
		}
	}

	return payments.Event{
		Kind:          mapEventKind(payload.Event),
		ProviderTxnID: txnID,
		OrderID:       payload.Data.Reference,
		AmountCents:   payload.Data.Amount,
		CurrencyCode:  payload.Data.Currency,
		RawPayload:    rawBody,
		Signature:     signature,
	}, nil
}

// mapEventKind converts a Paystack event string to the canonical event kind.
func mapEventKind(e string) string {
	switch e {
	case "charge.success":
		return payments.EventCheckoutCompleted
	case "charge.failed":
		return payments.EventCheckoutFailed
	case "transfer.success":
		return payments.EventTransferSucceeded
	case "transfer.failed":
		return payments.EventTransferFailed
	case "transfer.reversed":
		return payments.EventRefundSucceeded
	default:
		return e // preserve unknown events verbatim
	}
}

// ── Refund ────────────────────────────────────────────────────────────────────

type refundRequest struct {
	Transaction string `json:"transaction"`
	Amount      int64  `json:"amount,omitempty"` // 0 = full refund
}

type refundResponseData struct {
	ID int64 `json:"id"`
}

type refundAPIResponse struct {
	Status  bool               `json:"status"`
	Message string             `json:"message"`
	Data    refundResponseData `json:"data"`
}

// Refund calls POST /refund.  providerTxnID is the Paystack transaction id or
// reference.  amount.Cents == 0 means full refund.
func (a *Adapter) Refund(ctx context.Context, providerTxnID string, amount payments.Amount) (string, error) {
	reqBody := refundRequest{Transaction: providerTxnID, Amount: amount.Cents}
	b, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("paystack adapter: Refund: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.paystack.co/refund", bytes.NewReader(b))
	if err != nil {
		return "", fmt.Errorf("paystack adapter: Refund: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+a.client.secretKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := a.client.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("paystack adapter: Refund: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("paystack adapter: Refund: HTTP %d: %s", resp.StatusCode, paystackMsg(raw))
	}

	var out refundAPIResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("paystack adapter: Refund: decode: %w", err)
	}
	if !out.Status {
		return "", fmt.Errorf("paystack adapter: Refund: %s", out.Message)
	}
	return fmt.Sprintf("%d", out.Data.ID), nil
}

// ── ChargeSaved ───────────────────────────────────────────────────────────────

type chargeSavedRequest struct {
	AuthorizationCode string `json:"authorization_code"`
	Email             string `json:"email"`
	Amount            int64  `json:"amount"`
	Reference         string `json:"reference"`
	Currency          string `json:"currency"`
}

type chargeSavedData struct {
	ID        json.RawMessage `json:"id"`
	Reference string          `json:"reference"`
}

type chargeSavedAPIResponse struct {
	Status  bool            `json:"status"`
	Message string          `json:"message"`
	Data    chargeSavedData `json:"data"`
}

// ChargeSaved calls POST /transaction/charge_authorization.
// paymentMethodToken is the Paystack authorization_code from a previous checkout.
// idempotencyKey is used as the Paystack reference for de-duplication.
func (a *Adapter) ChargeSaved(ctx context.Context, paymentMethodToken string, amount payments.Amount, idempotencyKey string) (string, error) {
	currency := amount.CurrencyCode
	if currency == "" {
		currency = "ZAR"
	}
	ref := idempotencyKey
	if ref == "" {
		ref = adapterReference("saved")
	}

	reqBody := chargeSavedRequest{
		AuthorizationCode: paymentMethodToken,
		Email:             "",
		Amount:            amount.Cents,
		Reference:         ref,
		Currency:          currency,
	}
	b, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("paystack adapter: ChargeSaved: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.paystack.co/transaction/charge_authorization", bytes.NewReader(b))
	if err != nil {
		return "", fmt.Errorf("paystack adapter: ChargeSaved: build request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+a.client.secretKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := a.client.httpClient.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("paystack adapter: ChargeSaved: http: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("paystack adapter: ChargeSaved: HTTP %d: %s", resp.StatusCode, paystackMsg(raw))
	}

	var out chargeSavedAPIResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return "", fmt.Errorf("paystack adapter: ChargeSaved: decode: %w", err)
	}
	if !out.Status {
		return "", fmt.Errorf("paystack adapter: ChargeSaved: %s", out.Message)
	}

	txnID := ""
	if len(out.Data.ID) > 0 {
		_ = json.Unmarshal(out.Data.ID, &txnID)
		if txnID == "" {
			txnID = string(out.Data.ID)
		}
	}
	if txnID == "" {
		txnID = out.Data.Reference
	}
	return txnID, nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func adapterReference(prefix string) string {
	ts := time.Now().UnixMilli()
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("bb_%s_%d_%s", prefix, ts, hex.EncodeToString(b)[:6])
}

func paystackMsg(body []byte) string {
	var e struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &e) == nil && e.Message != "" {
		return e.Message
	}
	if len(body) > 200 {
		return string(body[:200])
	}
	return string(body)
}

// compile-time interface check
var _ payments.Provider = (*Adapter)(nil)
