package payments_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/beepbite/backend/internal/payments"
)

// ─── Stub Provider ────────────────────────────────────────────────────────────

// stubProvider is a minimal in-process implementation of payments.Provider used
// only in unit tests.  It records calls but does not hit any network.
type stubProvider struct {
	code string
}

func (s *stubProvider) Code() string { return s.code }

func (s *stubProvider) InitCheckout(_ context.Context, params payments.CheckoutParams) (string, string, error) {
	if params.OrderID == "" {
		return "", "", errors.New("stub: OrderID required")
	}
	return "https://pay.example.com/session/abc123", "stub_txn_" + params.OrderID, nil
}

func (s *stubProvider) VerifyWebhook(_ context.Context, signature string, rawBody []byte, webhookSecret []byte) (payments.Event, error) {
	if signature != "valid-sig" {
		return payments.Event{}, payments.ErrWebhookSignatureInvalid
	}
	return payments.Event{
		Kind:          payments.EventCheckoutCompleted,
		ProviderTxnID: "stub_txn_1",
		OrderID:       "order-uuid-1",
		AmountCents:   5000,
		CurrencyCode:  "ZAR",
		RawPayload:    rawBody,
		Signature:     signature,
		OccurredAt:    time.Now().UTC(),
	}, nil
}

func (s *stubProvider) Refund(_ context.Context, providerTxnID string, amount payments.Amount) (string, error) {
	if providerTxnID == "" {
		return "", errors.New("stub: providerTxnID required")
	}
	_ = amount
	return "refund_" + providerTxnID, nil
}

func (s *stubProvider) ChargeSaved(_ context.Context, paymentMethodToken string, amount payments.Amount, idempotencyKey string) (string, error) {
	if paymentMethodToken == "" {
		return "", errors.New("stub: paymentMethodToken required")
	}
	_ = amount
	_ = idempotencyKey
	return "charge_" + paymentMethodToken, nil
}

// ensure stubProvider satisfies payments.Provider at compile time.
var _ payments.Provider = (*stubProvider)(nil)

// ─── staticRegistry ───────────────────────────────────────────────────────────

// staticRegistry is a test-only implementation of payments.Registry that maps
// locationID → Provider without any database interaction.
type staticRegistry struct {
	providers map[string]payments.Provider
	creds     map[string]*payments.Credentials
}

func newStaticRegistry() *staticRegistry {
	return &staticRegistry{
		providers: map[string]payments.Provider{},
		creds:     map[string]*payments.Credentials{},
	}
}

func (sr *staticRegistry) add(locationID string, p payments.Provider, creds *payments.Credentials) {
	sr.providers[locationID] = p
	sr.creds[locationID] = creds
}

func (sr *staticRegistry) For(_ context.Context, locationID string) (payments.Provider, *payments.Credentials, error) {
	p, ok := sr.providers[locationID]
	if !ok {
		return nil, nil, payments.ErrProviderNotConfigured
	}
	return p, sr.creds[locationID], nil
}

// ensure staticRegistry satisfies payments.Registry at compile time.
var _ payments.Registry = (*staticRegistry)(nil)

// ─── Tests ────────────────────────────────────────────────────────────────────

func TestStubProvider_Code(t *testing.T) {
	p := &stubProvider{code: "paystack"}
	if got := p.Code(); got != "paystack" {
		t.Fatalf("Code() = %q, want %q", got, "paystack")
	}
}

func TestStubProvider_InitCheckout(t *testing.T) {
	p := &stubProvider{code: "stripe"}

	t.Run("success", func(t *testing.T) {
		url, txnID, err := p.InitCheckout(context.Background(), payments.CheckoutParams{
			OrderID:       "order-abc",
			AmountCents:   9900,
			CurrencyCode:  "USD",
			CustomerEmail: "user@example.com",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if url == "" {
			t.Fatal("expected non-empty hostedURL")
		}
		if txnID == "" {
			t.Fatal("expected non-empty providerTxnID")
		}
	})

	t.Run("missing_order_id", func(t *testing.T) {
		_, _, err := p.InitCheckout(context.Background(), payments.CheckoutParams{})
		if err == nil {
			t.Fatal("expected error for missing OrderID")
		}
	})
}

func TestStubProvider_VerifyWebhook(t *testing.T) {
	p := &stubProvider{code: "paystack"}
	body := []byte(`{"event":"charge.success"}`)

	t.Run("valid_signature", func(t *testing.T) {
		ev, err := p.VerifyWebhook(context.Background(), "valid-sig", body, []byte("secret"))
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ev.Kind != payments.EventCheckoutCompleted {
			t.Fatalf("Kind = %q, want %q", ev.Kind, payments.EventCheckoutCompleted)
		}
	})

	t.Run("invalid_signature", func(t *testing.T) {
		_, err := p.VerifyWebhook(context.Background(), "bad-sig", body, []byte("secret"))
		if !errors.Is(err, payments.ErrWebhookSignatureInvalid) {
			t.Fatalf("expected ErrWebhookSignatureInvalid, got %v", err)
		}
	})
}

func TestStubProvider_Refund(t *testing.T) {
	p := &stubProvider{code: "payfast"}

	t.Run("success", func(t *testing.T) {
		refundID, err := p.Refund(context.Background(), "txn_123", payments.Amount{Cents: 1000, CurrencyCode: "ZAR"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if refundID == "" {
			t.Fatal("expected non-empty refundID")
		}
	})

	t.Run("missing_txn_id", func(t *testing.T) {
		_, err := p.Refund(context.Background(), "", payments.Amount{Cents: 1000})
		if err == nil {
			t.Fatal("expected error for empty providerTxnID")
		}
	})
}

func TestStubProvider_ChargeSaved(t *testing.T) {
	p := &stubProvider{code: "stripe"}

	t.Run("success", func(t *testing.T) {
		txnID, err := p.ChargeSaved(context.Background(), "tok_visa", payments.Amount{Cents: 5000, CurrencyCode: "USD"}, "idem-key-1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if txnID == "" {
			t.Fatal("expected non-empty txnID")
		}
	})

	t.Run("missing_token", func(t *testing.T) {
		_, err := p.ChargeSaved(context.Background(), "", payments.Amount{Cents: 5000}, "idem-key-2")
		if err == nil {
			t.Fatal("expected error for empty token")
		}
	})
}

func TestStaticRegistry_For(t *testing.T) {
	reg := newStaticRegistry()

	psProvider := &stubProvider{code: "paystack"}
	psCreds := &payments.Credentials{
		ProviderCode: "paystack",
		LocationID:   "loc-za-1",
		RegionCode:   "ZA",
		SecretKey:    "sk_test_xxx",
		Currency:     "ZAR",
		IsBYO:        true,
	}
	reg.add("loc-za-1", psProvider, psCreds)

	t.Run("configured_location", func(t *testing.T) {
		p, creds, err := reg.For(context.Background(), "loc-za-1")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if p.Code() != "paystack" {
			t.Fatalf("Code() = %q, want %q", p.Code(), "paystack")
		}
		if creds.LocationID != "loc-za-1" {
			t.Fatalf("LocationID = %q, want %q", creds.LocationID, "loc-za-1")
		}
		if !creds.IsBYO {
			t.Fatal("expected IsBYO=true for BYO credentials")
		}
	})

	t.Run("unconfigured_location", func(t *testing.T) {
		_, _, err := reg.For(context.Background(), "loc-unknown-999")
		if !errors.Is(err, payments.ErrProviderNotConfigured) {
			t.Fatalf("expected ErrProviderNotConfigured, got %v", err)
		}
	})
}

func TestAmount_Fields(t *testing.T) {
	a := payments.Amount{Cents: 25099, CurrencyCode: "ZAR"}
	if a.Cents != 25099 {
		t.Fatalf("Cents = %d, want 25099", a.Cents)
	}
	if a.CurrencyCode != "ZAR" {
		t.Fatalf("CurrencyCode = %q, want ZAR", a.CurrencyCode)
	}
}

func TestEventKindConstants(t *testing.T) {
	kinds := []string{
		payments.EventCheckoutCompleted,
		payments.EventCheckoutFailed,
		payments.EventRefundSucceeded,
		payments.EventRefundFailed,
		payments.EventTransferSucceeded,
		payments.EventTransferFailed,
	}
	seen := map[string]bool{}
	for _, k := range kinds {
		if k == "" {
			t.Fatalf("empty event kind constant")
		}
		if seen[k] {
			t.Fatalf("duplicate event kind constant: %q", k)
		}
		seen[k] = true
	}
}

func TestRegisterProvider(t *testing.T) {
	called := false
	payments.RegisterProvider("testprovider", func(creds *payments.Credentials) payments.Provider {
		called = true
		return &stubProvider{code: creds.ProviderCode}
	})

	// The factory should now be visible to DBRegistry.  We verify indirectly by
	// confirming RegisterProvider doesn't panic and accepts a valid factory.
	_ = called // factory isn't called until For() is invoked
}
