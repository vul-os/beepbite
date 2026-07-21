//go:build patala

package payments

import (
	"context"
	"os"
	"testing"
)

// These tests exercise the patala path entirely against patala-fiat's
// "manual" rail (built into the cdylib whenever the `fiat` feature is on at
// all — see patala_gateway.go's own doc comment) so they need zero real
// processor credentials and make zero network calls, while still proving
// the actual cgo round trip: PatalaConfigFromEnv -> patala.PatalaRailNewFiat
// -> Charge -> (self-contained token) -> GetStatus, through the real
// compiled Rust cdylib, not a mock of it.

func TestNewPatalaGatewayProvider_UnknownProviderFailsClosed(t *testing.T) {
	if _, err := NewPatalaGatewayProvider("not-a-real-processor"); err == nil {
		t.Fatal("NewPatalaGatewayProvider with an unknown provider name: want error, got nil")
	}
}

func TestNewPatalaGatewayProvider_EmptyNameFailsClosed(t *testing.T) {
	if _, err := NewPatalaGatewayProvider("   "); err == nil {
		t.Fatal("NewPatalaGatewayProvider with a blank name: want error, got nil")
	}
}

func TestPatalaGatewayProvider_Code(t *testing.T) {
	p, err := NewPatalaGatewayProvider("manual")
	if err != nil {
		t.Fatalf("NewPatalaGatewayProvider: %v", err)
	}
	if p.Code() != "manual" {
		t.Fatalf("Code() = %q, want %q", p.Code(), "manual")
	}
}

func TestPatalaGatewayProvider_ChargeThenGetStatusIsHonestlyPending(t *testing.T) {
	ctx := context.Background()
	p, err := NewPatalaGatewayProvider("manual")
	if err != nil {
		t.Fatalf("NewPatalaGatewayProvider: %v", err)
	}

	req := ChargeRequest{
		OrderID: "order-patala-1",
		Tender:  "irrelevant-not-validated-see-code-doc-comment",
		Amount:  Amount{Cents: 1000, CurrencyCode: "JPY"}, // zero-decimal -- money must render as 1000 JPY, never 10.00
	}
	receipt, err := p.Charge(ctx, req)
	if err != nil {
		t.Fatalf("Charge: %v", err)
	}
	if receipt.Status != StatusPending {
		t.Fatalf("Charge Status = %q, want %q (an online gateway charge is never settled synchronously)", receipt.Status, StatusPending)
	}
	if receipt.Tender != "manual" {
		t.Fatalf("Charge Tender = %q, want the provider id %q", receipt.Tender, "manual")
	}
	if receipt.ID == "" {
		t.Fatal("Charge did not return a non-empty self-contained charge token in Receipt.ID")
	}
	if receipt.Amount.Cents != req.Amount.Cents || receipt.Amount.CurrencyCode != req.Amount.CurrencyCode {
		t.Fatalf("Charge Amount = %+v, want %+v (the REQUEST's real total)", receipt.Amount, req.Amount)
	}

	// patala's ManualRail can only ever be marked paid via a direct Rust
	// call to mark_paid, which is NOT reachable through the generic
	// PatalaRailNewFiat/PatalaRail FFI surface this adapter uses (see
	// patala_gateway.go's module doc comment and patala-go/README.md's own
	// "what a consumer needs to know"). So GetStatus here must stay
	// honestly pending forever -- never fabricate a "settled" this seam
	// cannot actually observe.
	status, err := p.GetStatus(ctx, receipt.ID)
	if err != nil {
		t.Fatalf("GetStatus: %v", err)
	}
	if status.Status != StatusPending {
		t.Fatalf("GetStatus Status = %q, want %q (patala manual can never actually settle through this FFI surface)", status.Status, StatusPending)
	}
	if status.Amount.Cents != req.Amount.Cents || status.Amount.CurrencyCode != req.Amount.CurrencyCode {
		t.Fatalf("GetStatus Amount = %+v, want %+v (round-tripped from the charge token, not fabricated)", status.Amount, req.Amount)
	}
}

func TestPatalaGatewayProvider_ChargeRequiresOrderID(t *testing.T) {
	p, err := NewPatalaGatewayProvider("manual")
	if err != nil {
		t.Fatalf("NewPatalaGatewayProvider: %v", err)
	}
	_, err = p.Charge(context.Background(), ChargeRequest{
		Amount: Amount{Cents: 1000, CurrencyCode: "USD"},
	})
	if err == nil {
		t.Fatal("Charge with empty OrderID: want error, got nil")
	}
}

func TestPatalaGatewayProvider_ChargeRequiresPositiveAmount(t *testing.T) {
	p, err := NewPatalaGatewayProvider("manual")
	if err != nil {
		t.Fatalf("NewPatalaGatewayProvider: %v", err)
	}
	_, err = p.Charge(context.Background(), ChargeRequest{
		OrderID: "order-1",
		Amount:  Amount{Cents: 0, CurrencyCode: "USD"},
	})
	if err == nil {
		t.Fatal("Charge with zero amount: want error, got nil")
	}
}

func TestPatalaGatewayProvider_ChargeRequiresCurrency(t *testing.T) {
	p, err := NewPatalaGatewayProvider("manual")
	if err != nil {
		t.Fatalf("NewPatalaGatewayProvider: %v", err)
	}
	_, err = p.Charge(context.Background(), ChargeRequest{
		OrderID: "order-1",
		Amount:  Amount{Cents: 1000},
	})
	if err == nil {
		t.Fatal("Charge with empty currency: want error, got nil")
	}
}

func TestPatalaGatewayProvider_GetStatusRejectsCorruptChargeID(t *testing.T) {
	p, err := NewPatalaGatewayProvider("manual")
	if err != nil {
		t.Fatalf("NewPatalaGatewayProvider: %v", err)
	}
	if _, err := p.GetStatus(context.Background(), "not-a-real-token"); err != ErrPatalaChargeIDInvalid {
		t.Fatalf("GetStatus for a corrupt charge id = %v, want ErrPatalaChargeIDInvalid", err)
	}
	if _, err := p.GetStatus(context.Background(), ""); err != ErrPatalaChargeIDInvalid {
		t.Fatalf("GetStatus for an empty charge id = %v, want ErrPatalaChargeIDInvalid", err)
	}
}

func TestPatalaGatewayProvider_RefundUnsupported(t *testing.T) {
	p, err := NewPatalaGatewayProvider("manual")
	if err != nil {
		t.Fatalf("NewPatalaGatewayProvider: %v", err)
	}
	_, err = p.Refund(context.Background(), RefundRequest{
		ChargeID: "whatever",
		Amount:   Amount{Cents: 100, CurrencyCode: "USD"},
	})
	if err != ErrPatalaRefundUnsupported {
		t.Fatalf("Refund error = %v, want ErrPatalaRefundUnsupported", err)
	}
}

func TestPatalaConfigFromEnv(t *testing.T) {
	os.Setenv("BEEPBITE_STRIPE_SECRET_KEY", "sk_test_x")
	os.Setenv("BEEPBITE_STRIPE_WEBHOOK_SECRET", "whsec_x")
	os.Setenv("BEEPBITE_STRIPE_UNRELATED", "") // empty values must be dropped, not passed through
	defer func() {
		os.Unsetenv("BEEPBITE_STRIPE_SECRET_KEY")
		os.Unsetenv("BEEPBITE_STRIPE_WEBHOOK_SECRET")
		os.Unsetenv("BEEPBITE_STRIPE_UNRELATED")
	}()

	cfg := PatalaConfigFromEnv("stripe")
	if cfg["secret_key"] != "sk_test_x" {
		t.Fatalf(`cfg["secret_key"] = %q, want "sk_test_x"`, cfg["secret_key"])
	}
	if cfg["webhook_secret"] != "whsec_x" {
		t.Fatalf(`cfg["webhook_secret"] = %q, want "whsec_x"`, cfg["webhook_secret"])
	}
	if _, ok := cfg["unrelated"]; ok {
		t.Fatal("an empty-valued env var must not appear in the config map")
	}

	if got := PatalaConfigFromEnv("nobody-configured-this"); len(got) != 0 {
		t.Fatalf("PatalaConfigFromEnv for an unconfigured provider = %v, want empty", got)
	}
}

func TestPatalaConfigFromEnv_KeyOverrides(t *testing.T) {
	os.Setenv("BEEPBITE_ADYEN_HMAC_KEY", "deadbeef")
	defer os.Unsetenv("BEEPBITE_ADYEN_HMAC_KEY")

	cfg := PatalaConfigFromEnv("adyen")
	if cfg["hmac_key_hex"] != "deadbeef" {
		t.Fatalf(`cfg["hmac_key_hex"] = %q, want "deadbeef" (BEEPBITE_ADYEN_HMAC_KEY must map onto patala-fiat's own "hmac_key_hex" key, not a literal "hmac_key")`, cfg["hmac_key_hex"])
	}
	if _, ok := cfg["hmac_key"]; ok {
		t.Fatal("the un-overridden literal-lowercase key must not ALSO be present")
	}
}

// TestPatalaGatewayProvider_StripeConstructsOfflineFromEnv proves the config
// mapping (BEEPBITE_STRIPE_* -> patala-fiat's "secret_key"/"webhook_secret"
// keys) actually works for a REAL, feature-gated processor adapter, not
// just "manual" -- construction only, exactly like patala-go's own
// examples/fiatroundtrip and cackle's own equivalent test do for the
// identical reason (never dial a real processor from an automated test).
func TestPatalaGatewayProvider_StripeConstructsOfflineFromEnv(t *testing.T) {
	os.Setenv("BEEPBITE_STRIPE_SECRET_KEY", "sk_test_x")
	os.Setenv("BEEPBITE_STRIPE_WEBHOOK_SECRET", "whsec_x")
	defer func() {
		os.Unsetenv("BEEPBITE_STRIPE_SECRET_KEY")
		os.Unsetenv("BEEPBITE_STRIPE_WEBHOOK_SECRET")
	}()

	p, err := NewPatalaGatewayProvider("stripe")
	if err != nil {
		t.Fatalf("NewPatalaGatewayProvider(stripe): %v (is this build's cdylib compiled with fiat-stripe / fiat-all?)", err)
	}
	if p.Code() != "stripe" {
		t.Fatalf("Code() = %q, want stripe", p.Code())
	}
	// Construction-only: never Charge/GetStatus here, which would dial the
	// real Stripe API with a fake key.
}

func TestPatalaFiatProviderNames_IncludesManual(t *testing.T) {
	names := PatalaFiatProviderNames()
	found := false
	for _, n := range names {
		if n == "manual" {
			found = true
		}
	}
	if !found {
		t.Fatalf("PatalaFiatProviderNames() = %v, want it to include \"manual\"", names)
	}
}
