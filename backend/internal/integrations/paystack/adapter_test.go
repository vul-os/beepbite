// adapter_test.go — unit tests for paystack.Adapter using httptest.Server stubs.
// No external Paystack calls are made.
package paystack

import (
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/beepbite/backend/internal/payments"
)

// ── helpers ───────────────────────────────────────────────────────────────────

// newTestAdapter builds an Adapter whose HTTP client routes all requests to srv
// regardless of the hard-coded api.paystack.co host in the adapter.
func newTestAdapter(srv *httptest.Server, webhookSecret string) *Adapter {
	c := NewClient(Config{
		SecretKey:  "sk_test_dummy",
		HTTPClient: srv.Client(),
	})
	// Replace the HTTP client transport with one that rewrites the host to the
	// test server, so api.paystack.co calls hit our stub.
	c.httpClient = &http.Client{
		Transport: rewriteTransport{base: srv.URL, inner: srv.Client().Transport},
	}
	return NewAdapter(c, webhookSecret)
}

// rewriteTransport rewrites the host of every outgoing request to the test
// server URL so the adapter's hard-coded api.paystack.co calls hit the stub.
type rewriteTransport struct {
	base  string // e.g. "http://127.0.0.1:XXXXX"
	inner http.RoundTripper
}

func (rt rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	cloned := req.Clone(req.Context())
	host := strings.TrimPrefix(strings.TrimSuffix(rt.base, "/"), "http://")
	cloned.URL.Scheme = "http"
	cloned.URL.Host = host
	tr := rt.inner
	if tr == nil {
		tr = http.DefaultTransport
	}
	return tr.RoundTrip(cloned)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func signBody(secret string, body []byte) string {
	mac := hmac.New(sha512.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// ── Code ──────────────────────────────────────────────────────────────────────

func TestAdapter_Code(t *testing.T) {
	a := &Adapter{}
	if got := a.Code(); got != "paystack" {
		t.Fatalf("Code() = %q; want \"paystack\"", got)
	}
}

// ── InitCheckout ──────────────────────────────────────────────────────────────

func TestAdapter_InitCheckout_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("want POST, got %s", r.Method)
		}
		if !strings.Contains(r.URL.Path, "initialize") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			t.Error("missing Bearer token")
		}

		// Verify amount forwarded correctly.
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["amount"].(float64) != 5000 {
			t.Errorf("amount = %v; want 5000", body["amount"])
		}
		if body["currency"] != "ZAR" {
			t.Errorf("currency = %v; want ZAR", body["currency"])
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":  true,
			"message": "Authorization URL created",
			"data": map[string]interface{}{
				"authorization_url": "https://checkout.paystack.com/abc123",
				"reference":         "ref_test_001",
			},
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "whsec_test")
	url, ref, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:       "order-1",
		AmountCents:   5000,
		CurrencyCode:  "ZAR",
		CustomerEmail: "customer@example.com",
		CallbackURL:   "https://example.com/success",
	})
	if err != nil {
		t.Fatalf("InitCheckout error: %v", err)
	}
	if url != "https://checkout.paystack.com/abc123" {
		t.Errorf("url = %q; want checkout URL", url)
	}
	if ref != "ref_test_001" {
		t.Errorf("ref = %q; want ref_test_001", ref)
	}
}

func TestAdapter_InitCheckout_FallbackEmail(t *testing.T) {
	// When no CustomerEmail is provided, should fall back to noreply address.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["email"] != "noreply@beepbite.com" {
			t.Errorf("email = %v; want noreply@beepbite.com", body["email"])
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status": true,
			"data": map[string]interface{}{
				"authorization_url": "https://checkout.paystack.com/x",
				"reference":         "r",
			},
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, _, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:      "o",
		AmountCents:  100,
		CurrencyCode: "ZAR",
	})
	if err != nil {
		t.Fatalf("InitCheckout error: %v", err)
	}
}

func TestAdapter_InitCheckout_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
			"message": "Invalid key",
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, _, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:      "o",
		AmountCents:  100,
		CurrencyCode: "ZAR",
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "HTTP 401") {
		t.Errorf("error should mention HTTP 401, got: %v", err)
	}
}

func TestAdapter_InitCheckout_APIFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":  false,
			"message": "Email is required",
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, _, err := a.InitCheckout(context.Background(), payments.CheckoutParams{
		OrderID:      "o",
		AmountCents:  100,
		CurrencyCode: "ZAR",
	})
	if err == nil {
		t.Fatal("expected error for status=false")
	}
}

// ── VerifyWebhook ─────────────────────────────────────────────────────────────

func TestAdapter_VerifyWebhook_ChargeSuccess(t *testing.T) {
	secret := "wh_secret_test"
	body := []byte(`{"event":"charge.success","data":{"id":12345,"reference":"ref_abc","status":"success","amount":10000,"currency":"ZAR"}}`)
	sig := signBody(secret, body)

	a := &Adapter{webhookSecret: secret}
	ev, err := a.VerifyWebhook(context.Background(), sig, body, nil)
	if err != nil {
		t.Fatalf("VerifyWebhook error: %v", err)
	}
	if ev.Kind != payments.EventCheckoutCompleted {
		t.Errorf("Kind = %q; want %q", ev.Kind, payments.EventCheckoutCompleted)
	}
	if ev.AmountCents != 10000 {
		t.Errorf("AmountCents = %d; want 10000", ev.AmountCents)
	}
	if ev.CurrencyCode != "ZAR" {
		t.Errorf("CurrencyCode = %q; want ZAR", ev.CurrencyCode)
	}
	if len(ev.RawPayload) == 0 {
		t.Error("RawPayload should not be empty")
	}
}

func TestAdapter_VerifyWebhook_AllEventKinds(t *testing.T) {
	secret := "sec"
	cases := []struct {
		event string
		want  string
	}{
		{"charge.success", payments.EventCheckoutCompleted},
		{"charge.failed", payments.EventCheckoutFailed},
		{"transfer.success", payments.EventTransferSucceeded},
		{"transfer.failed", payments.EventTransferFailed},
		{"transfer.reversed", payments.EventRefundSucceeded},
		// Unknown events are passed through verbatim.
		{"invoice.update", "invoice.update"},
	}
	for _, tc := range cases {
		body := []byte(`{"event":"` + tc.event + `","data":{"reference":"r","amount":0,"currency":"ZAR"}}`)
		sig := signBody(secret, body)
		a := &Adapter{webhookSecret: secret}
		ev, err := a.VerifyWebhook(context.Background(), sig, body, nil)
		if err != nil {
			t.Errorf("[%s] unexpected error: %v", tc.event, err)
			continue
		}
		if ev.Kind != tc.want {
			t.Errorf("[%s] Kind = %q; want %q", tc.event, ev.Kind, tc.want)
		}
	}
}

func TestAdapter_VerifyWebhook_BadSignature(t *testing.T) {
	secret := "real_secret"
	body := []byte(`{"event":"charge.success","data":{}}`)
	a := &Adapter{webhookSecret: secret}
	_, err := a.VerifyWebhook(context.Background(), "badsig", body, nil)
	if err == nil {
		t.Fatal("expected signature mismatch error")
	}
	// Should return the canonical sentinel error.
	if err != payments.ErrWebhookSignatureInvalid {
		t.Errorf("expected ErrWebhookSignatureInvalid, got: %v", err)
	}
}

func TestAdapter_VerifyWebhook_OverrideSecret(t *testing.T) {
	// Adapter has one secret, but caller passes a per-location BYO secret.
	adapterSecret := "adapter_default"
	byoSecret := "byo_location_secret"
	body := []byte(`{"event":"transfer.success","data":{"reference":"x","amount":500,"currency":"NGN"}}`)
	sig := signBody(byoSecret, body)

	a := &Adapter{webhookSecret: adapterSecret}
	ev, err := a.VerifyWebhook(context.Background(), sig, body, []byte(byoSecret))
	if err != nil {
		t.Fatalf("VerifyWebhook with BYO secret error: %v", err)
	}
	if ev.Kind != payments.EventTransferSucceeded {
		t.Errorf("Kind = %q; want %q", ev.Kind, payments.EventTransferSucceeded)
	}
}

func TestAdapter_VerifyWebhook_MissingSignature(t *testing.T) {
	a := &Adapter{webhookSecret: "s"}
	_, err := a.VerifyWebhook(context.Background(), "", []byte(`{}`), nil)
	if err == nil || !strings.Contains(err.Error(), "missing signature") {
		t.Errorf("expected missing signature error, got: %v", err)
	}
}

func TestAdapter_VerifyWebhook_MissingSecret(t *testing.T) {
	a := &Adapter{}
	_, err := a.VerifyWebhook(context.Background(), "sig", []byte(`{}`), nil)
	if err == nil || !strings.Contains(err.Error(), "no webhook secret") {
		t.Errorf("expected no webhook secret error, got: %v", err)
	}
}

// ── Refund ────────────────────────────────────────────────────────────────────

func TestAdapter_Refund_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("want POST, got %s", r.Method)
		}
		if !strings.HasSuffix(r.URL.Path, "/refund") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		_ = json.Unmarshal(body, &req)
		if req["transaction"] != "txn_123" {
			t.Errorf("transaction = %v; want txn_123", req["transaction"])
		}
		if req["amount"].(float64) != 5000 {
			t.Errorf("amount = %v; want 5000", req["amount"])
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":  true,
			"message": "Refund has been queued for processing",
			"data": map[string]interface{}{
				"id": 9876,
			},
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	refundID, err := a.Refund(context.Background(), "txn_123", payments.Amount{Cents: 5000, CurrencyCode: "ZAR"})
	if err != nil {
		t.Fatalf("Refund error: %v", err)
	}
	if refundID != "9876" {
		t.Errorf("refundID = %q; want 9876", refundID)
	}
}

func TestAdapter_Refund_FullRefund(t *testing.T) {
	// Cents == 0 should omit the amount field (full refund to Paystack).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		_ = json.Unmarshal(body, &req)
		if _, ok := req["amount"]; ok {
			// amount=0 is omitempty — should not be present in the JSON.
			t.Errorf("amount field should be omitted for full refund, got: %v", req["amount"])
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status": true,
			"data":   map[string]interface{}{"id": 1},
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, err := a.Refund(context.Background(), "txn_full", payments.Amount{Cents: 0, CurrencyCode: "ZAR"})
	if err != nil {
		t.Fatalf("Refund full error: %v", err)
	}
}

func TestAdapter_Refund_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"message": "Transaction not found",
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, err := a.Refund(context.Background(), "bad_txn", payments.Amount{Cents: 0})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestAdapter_Refund_APIFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":  false,
			"message": "Cannot refund this transaction",
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, err := a.Refund(context.Background(), "txn_456", payments.Amount{Cents: 1000, CurrencyCode: "ZAR"})
	if err == nil || !strings.Contains(err.Error(), "Cannot refund") {
		t.Errorf("expected api failure error, got: %v", err)
	}
}

// ── ChargeSaved ───────────────────────────────────────────────────────────────

func TestAdapter_ChargeSaved_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("want POST, got %s", r.Method)
		}
		if !strings.Contains(r.URL.Path, "charge_authorization") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		_ = json.Unmarshal(body, &req)
		if req["authorization_code"] != "AUTH_xyz" {
			t.Errorf("authorization_code = %v; want AUTH_xyz", req["authorization_code"])
		}
		if req["reference"] != "idem_key_001" {
			t.Errorf("reference = %v; want idem_key_001", req["reference"])
		}
		if req["amount"].(float64) != 20000 {
			t.Errorf("amount = %v; want 20000", req["amount"])
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status":  true,
			"message": "Charge attempted",
			"data": map[string]interface{}{
				"id":        42,
				"reference": "charge_ref_001",
			},
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	txnID, err := a.ChargeSaved(context.Background(), "AUTH_xyz",
		payments.Amount{Cents: 20000, CurrencyCode: "ZAR"}, "idem_key_001")
	if err != nil {
		t.Fatalf("ChargeSaved error: %v", err)
	}
	if txnID == "" {
		t.Error("expected non-empty txnID")
	}
}

func TestAdapter_ChargeSaved_DefaultCurrency(t *testing.T) {
	// Empty CurrencyCode should default to ZAR.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		_ = json.Unmarshal(body, &req)
		if req["currency"] != "ZAR" {
			t.Errorf("currency = %v; want ZAR (default)", req["currency"])
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status": true,
			"data":   map[string]interface{}{"id": 1, "reference": "r"},
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, err := a.ChargeSaved(context.Background(), "AUTH_c",
		payments.Amount{Cents: 500}, "key")
	if err != nil {
		t.Fatalf("ChargeSaved error: %v", err)
	}
}

func TestAdapter_ChargeSaved_AutoReference(t *testing.T) {
	// Empty idempotencyKey — adapter should generate a reference automatically.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		_ = json.Unmarshal(body, &req)
		ref, _ := req["reference"].(string)
		if ref == "" {
			t.Error("reference should be auto-generated when idempotencyKey is empty")
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"status": true,
			"data":   map[string]interface{}{"id": 2, "reference": ref},
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, err := a.ChargeSaved(context.Background(), "AUTH_d",
		payments.Amount{Cents: 100, CurrencyCode: "ZAR"}, "")
	if err != nil {
		t.Fatalf("ChargeSaved error: %v", err)
	}
}

func TestAdapter_ChargeSaved_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]interface{}{
			"message": "Card declined",
		})
	}))
	defer srv.Close()

	a := newTestAdapter(srv, "s")
	_, err := a.ChargeSaved(context.Background(), "AUTH_bad",
		payments.Amount{Cents: 1000, CurrencyCode: "ZAR"}, "k")
	if err == nil {
		t.Fatal("expected error")
	}
	if !strings.Contains(err.Error(), "HTTP 422") {
		t.Errorf("expected HTTP 422 in error, got: %v", err)
	}
}

// ── compile-time interface satisfaction ───────────────────────────────────────

func TestAdapter_ImplementsProvider(t *testing.T) {
	var _ payments.Provider = (*Adapter)(nil)
}
