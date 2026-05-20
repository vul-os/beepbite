// adapter_test.go — unit tests for the Stripe payments.Provider adapter.
//
// All tests use httptest.Server stubs; no real Stripe API is called.
package stripe

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/payments"
)

// ── helpers ───────────────────────────────────────────────────────────────────

// stubServer returns an httptest.Server that responds to every request with
// the provided JSON body and status code. The caller must defer srv.Close().
func stubServer(t *testing.T, status int, body interface{}) *httptest.Server {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("stubServer: marshal: %v", err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write(raw)
	}))
	return srv
}

// adapterWithBase returns an Adapter whose underlying Client sends requests to
// the given httptest server base URL instead of the real Stripe API.
func adapterWithBase(base, webhookSecret string) *Adapter {
	hc := &http.Client{
		Timeout: 5 * time.Second,
		Transport: &prefixRoundTripper{
			base:  base,
			inner: http.DefaultTransport,
		},
	}
	return &Adapter{
		client:        NewClient(Config{SecretKey: "sk_test_stub", HTTPClient: hc}),
		webhookSecret: webhookSecret,
	}
}

// prefixRoundTripper rewrites requests so that only the path is appended to
// base, allowing the httptest server to intercept calls.
type prefixRoundTripper struct {
	base  string
	inner http.RoundTripper
}

func (rt *prefixRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	path := req.URL.Path
	newURL := rt.base + path
	if req.URL.RawQuery != "" {
		newURL += "?" + req.URL.RawQuery
	}
	cloned := req.Clone(req.Context())
	parsed, err := req.URL.Parse(newURL)
	if err != nil {
		return nil, err
	}
	cloned.URL = parsed
	return rt.inner.RoundTrip(cloned)
}

// ── Code ──────────────────────────────────────────────────────────────────────

func TestAdapter_Code(t *testing.T) {
	a := NewAdapterFromCreds("sk_test", "whsec_test", nil)
	if got := a.Code(); got != "stripe" {
		t.Fatalf("Code() = %q, want %q", got, "stripe")
	}
}

// ── InitCheckout ──────────────────────────────────────────────────────────────

func TestAdapter_InitCheckout_success(t *testing.T) {
	srv := stubServer(t, 200, map[string]interface{}{
		"id":  "cs_test_abc123",
		"url": "https://checkout.stripe.com/pay/cs_test_abc123",
	})
	defer srv.Close()

	a := adapterWithBase(srv.URL, "whsec_test")
	hostedURL, txnID, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:       "order-1",
		AmountCents:   1000,
		CurrencyCode:  "usd",
		CustomerEmail: "customer@example.com",
		CallbackURL:   "https://example.com/success",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(hostedURL, "https://checkout.stripe.com") {
		t.Errorf("hostedURL = %q, want stripe checkout URL", hostedURL)
	}
	if txnID != "cs_test_abc123" {
		t.Errorf("txnID = %q, want cs_test_abc123", txnID)
	}
}

func TestAdapter_InitCheckout_metadataCancelURL(t *testing.T) {
	srv := stubServer(t, 200, map[string]interface{}{
		"id":  "cs_cancel_test",
		"url": "https://checkout.stripe.com/pay/cs_cancel_test",
	})
	defer srv.Close()

	cancelURLJSON, _ := json.Marshal(map[string]string{"cancel_url": "https://example.com/cancel"})
	a := adapterWithBase(srv.URL, "whsec_test")
	_, _, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:      "order-2",
		AmountCents:  500,
		CurrencyCode: "eur",
		CallbackURL:  "https://example.com/success",
		MetadataJSON: cancelURLJSON,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestAdapter_InitCheckout_missingCallbackURL(t *testing.T) {
	a := NewAdapterFromCreds("sk_test", "whsec_test", nil)
	_, _, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:     "order-1",
		AmountCents: 1000,
	})
	if err == nil || !strings.Contains(err.Error(), "CallbackURL") {
		t.Fatalf("expected CallbackURL error, got: %v", err)
	}
}

func TestAdapter_InitCheckout_zeroCents(t *testing.T) {
	a := NewAdapterFromCreds("sk_test", "whsec_test", nil)
	_, _, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:     "order-1",
		CallbackURL: "https://example.com/success",
	})
	if err == nil || !strings.Contains(err.Error(), "amount") {
		t.Fatalf("expected amount error, got: %v", err)
	}
}

func TestAdapter_InitCheckout_stripeError(t *testing.T) {
	srv := stubServer(t, 400, map[string]interface{}{
		"error": map[string]string{
			"message": "No such plan",
			"type":    "invalid_request_error",
			"code":    "resource_missing",
		},
	})
	defer srv.Close()

	a := adapterWithBase(srv.URL, "whsec_test")
	_, _, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:     "order-1",
		AmountCents: 1000,
		CallbackURL: "https://example.com/success",
	})
	if err == nil {
		t.Fatal("expected error from Stripe 400 response")
	}
}

// ── VerifyWebhook ─────────────────────────────────────────────────────────────

func buildWebhookBody(t *testing.T, eventType, piID, orderID string) []byte {
	t.Helper()
	inner := map[string]interface{}{
		"object": map[string]interface{}{
			"id":             "cs_test_xyz",
			"payment_intent": piID,
			"metadata":       map[string]string{"order_id": orderID},
		},
	}
	raw, err := json.Marshal(map[string]interface{}{
		"id":      "evt_test_001",
		"type":    eventType,
		"created": time.Now().Unix(),
		"data":    inner,
	})
	if err != nil {
		t.Fatalf("build webhook body: %v", err)
	}
	return raw
}

func TestAdapter_VerifyWebhook_checkoutCompleted(t *testing.T) {
	const secret = "whsec_testSecret"
	body := buildWebhookBody(t, "checkout.session.completed", "pi_test_001", "order-42")
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := SignForTest(secret, ts, body)

	a := NewAdapterFromCreds("sk_test", secret, nil)
	ev, err := a.VerifyWebhook(context.Background(), sig, body, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ev.Kind != payments.EventCheckoutCompleted {
		t.Errorf("Kind = %q, want %q", ev.Kind, payments.EventCheckoutCompleted)
	}
	if ev.ProviderTxnID != "pi_test_001" {
		t.Errorf("ProviderTxnID = %q, want pi_test_001", ev.ProviderTxnID)
	}
	if ev.OrderID != "order-42" {
		t.Errorf("OrderID = %q, want order-42", ev.OrderID)
	}
}

func TestAdapter_VerifyWebhook_paymentFailed(t *testing.T) {
	const secret = "whsec_fail"
	body := buildWebhookBody(t, "payment_intent.payment_failed", "pi_fail_001", "order-99")
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := SignForTest(secret, ts, body)

	a := NewAdapterFromCreds("sk_test", secret, nil)
	ev, err := a.VerifyWebhook(context.Background(), sig, body, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ev.Kind != payments.EventCheckoutFailed {
		t.Errorf("Kind = %q, want %q", ev.Kind, payments.EventCheckoutFailed)
	}
}

func TestAdapter_VerifyWebhook_chargeRefunded(t *testing.T) {
	const secret = "whsec_refund"
	body := buildWebhookBody(t, "charge.refunded", "ch_refund_001", "order-7")
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := SignForTest(secret, ts, body)

	a := NewAdapterFromCreds("sk_test", secret, nil)
	ev, err := a.VerifyWebhook(context.Background(), sig, body, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ev.Kind != payments.EventRefundSucceeded {
		t.Errorf("Kind = %q, want %q", ev.Kind, payments.EventRefundSucceeded)
	}
}

func TestAdapter_VerifyWebhook_wrongSignature(t *testing.T) {
	const secret = "whsec_correct"
	body := buildWebhookBody(t, "checkout.session.completed", "pi_001", "order-1")
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := SignForTest("whsec_wrong", ts, body) // signed with wrong secret

	a := NewAdapterFromCreds("sk_test", secret, nil)
	_, err := a.VerifyWebhook(context.Background(), sig, body, nil)
	if err == nil {
		t.Fatal("expected signature mismatch error")
	}
	if err != payments.ErrWebhookSignatureInvalid {
		t.Errorf("expected ErrWebhookSignatureInvalid, got: %v", err)
	}
}

func TestAdapter_VerifyWebhook_overrideSecret(t *testing.T) {
	const override = "whsec_override"
	body := buildWebhookBody(t, "checkout.session.completed", "pi_001", "order-1")
	ts := fmt.Sprintf("%d", time.Now().Unix())
	sig := SignForTest(override, ts, body)

	// Adapter baked-in secret is different; override via webhookSecret param.
	a := NewAdapterFromCreds("sk_test", "whsec_adapter", nil)
	_, err := a.VerifyWebhook(context.Background(), sig, body, []byte(override))
	if err != nil {
		t.Fatalf("override secret should succeed: %v", err)
	}
}

func TestAdapter_VerifyWebhook_expiredTimestamp(t *testing.T) {
	const secret = "whsec_exp"
	body := buildWebhookBody(t, "checkout.session.completed", "pi_001", "order-1")
	// Timestamp 10 minutes in the past — outside the 5-min tolerance.
	oldTS := fmt.Sprintf("%d", time.Now().Add(-10*time.Minute).Unix())
	sig := SignForTest(secret, oldTS, body)

	a := NewAdapterFromCreds("sk_test", secret, nil)
	_, err := a.VerifyWebhook(context.Background(), sig, body, nil)
	if err == nil {
		t.Fatal("expected error for expired timestamp")
	}
	if err != payments.ErrWebhookSignatureInvalid {
		t.Errorf("expected ErrWebhookSignatureInvalid, got: %v", err)
	}
}

// ── Refund ────────────────────────────────────────────────────────────────────

func TestAdapter_Refund_success(t *testing.T) {
	srv := stubServer(t, 200, map[string]interface{}{
		"id":     "re_test_001",
		"status": "succeeded",
	})
	defer srv.Close()

	a := adapterWithBase(srv.URL, "whsec_test")
	refundID, err := a.Refund(context.Background(), "pi_test_001", payments.Amount{Cents: 500, CurrencyCode: "usd"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if refundID != "re_test_001" {
		t.Errorf("refundID = %q, want re_test_001", refundID)
	}
}

func TestAdapter_Refund_fullRefund(t *testing.T) {
	srv := stubServer(t, 200, map[string]interface{}{"id": "re_full_001"})
	defer srv.Close()

	a := adapterWithBase(srv.URL, "whsec_test")
	refundID, err := a.Refund(context.Background(), "ch_test_001", payments.Amount{Cents: 0}) // 0 = full
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if refundID == "" {
		t.Error("expected non-empty refundID")
	}
}

func TestAdapter_Refund_emptyTxnID(t *testing.T) {
	a := NewAdapterFromCreds("sk_test", "whsec_test", nil)
	_, err := a.Refund(context.Background(), "", payments.Amount{Cents: 100})
	if err == nil {
		t.Fatal("expected error for empty providerTxnID")
	}
}

func TestAdapter_Refund_stripeError(t *testing.T) {
	srv := stubServer(t, 400, map[string]interface{}{
		"error": map[string]string{
			"message": "Charge already refunded",
			"type":    "invalid_request_error",
			"code":    "charge_already_refunded",
		},
	})
	defer srv.Close()

	a := adapterWithBase(srv.URL, "whsec_test")
	_, err := a.Refund(context.Background(), "pi_already", payments.Amount{Cents: 100})
	if err == nil {
		t.Fatal("expected error from Stripe 400 response")
	}
}

// ── ChargeSaved ───────────────────────────────────────────────────────────────

func TestAdapter_ChargeSaved_success(t *testing.T) {
	srv := stubServer(t, 200, map[string]interface{}{
		"id":     "pi_saved_001",
		"status": "succeeded",
	})
	defer srv.Close()

	a := adapterWithBase(srv.URL, "whsec_test")
	txnID, err := a.ChargeSaved(context.Background(), "pm_card_visa",
		payments.Amount{Cents: 2000, CurrencyCode: "usd"}, "idem-key-001")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if txnID != "pi_saved_001" {
		t.Errorf("txnID = %q, want pi_saved_001", txnID)
	}
}

func TestAdapter_ChargeSaved_idempotencyKey(t *testing.T) {
	var gotHeader string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get("Idempotency-Key")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"id": "pi_idem_001"})
	}))
	defer srv.Close()

	a := adapterWithBase(srv.URL, "whsec_test")
	_, err := a.ChargeSaved(context.Background(), "pm_card_visa",
		payments.Amount{Cents: 1000, CurrencyCode: "usd"}, "unique-key-xyz")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotHeader != "unique-key-xyz" {
		t.Errorf("Idempotency-Key header = %q, want unique-key-xyz", gotHeader)
	}
}

func TestAdapter_ChargeSaved_emptyToken(t *testing.T) {
	a := NewAdapterFromCreds("sk_test", "whsec_test", nil)
	_, err := a.ChargeSaved(context.Background(), "",
		payments.Amount{Cents: 2000, CurrencyCode: "usd"}, "")
	if err == nil {
		t.Fatal("expected error for empty paymentMethodToken")
	}
}

func TestAdapter_ChargeSaved_zeroAmount(t *testing.T) {
	a := NewAdapterFromCreds("sk_test", "whsec_test", nil)
	_, err := a.ChargeSaved(context.Background(), "pm_card_visa",
		payments.Amount{Cents: 0}, "")
	if err == nil {
		t.Fatal("expected error for zero amount")
	}
}

func TestAdapter_ChargeSaved_stripeError(t *testing.T) {
	srv := stubServer(t, 402, map[string]interface{}{
		"error": map[string]string{
			"message": "Your card was declined",
			"type":    "card_error",
			"code":    "card_declined",
		},
	})
	defer srv.Close()

	a := adapterWithBase(srv.URL, "whsec_test")
	_, err := a.ChargeSaved(context.Background(), "pm_declined",
		payments.Amount{Cents: 1000, CurrencyCode: "usd"}, "")
	if err == nil {
		t.Fatal("expected card declined error")
	}
}

// ── Interface compliance ───────────────────────────────────────────────────────

// Compile-time assertion: Adapter satisfies payments.Provider.
var _ payments.Provider = (*Adapter)(nil)
