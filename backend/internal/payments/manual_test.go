package payments

import (
	"context"
	"errors"
	"testing"
)

func TestValidTender(t *testing.T) {
	valid := []string{
		"cash", "card", "transfer", "voucher",
		"cash_on_delivery", "card_on_delivery",
		// Case and surrounding whitespace must not decide whether a shop gets paid.
		"CASH", "  Card  ",
	}
	for _, code := range valid {
		if !ValidTender(code) {
			t.Errorf("ValidTender(%q) = false, want true", code)
		}
	}

	// Anything that implies BeepBite processed a card must be rejected: the
	// whole point of the manual-tender model is that no gateway exists.
	invalid := []string{"", "paystack", "stripe", "yoco", "card_token", "online"}
	for _, code := range invalid {
		if ValidTender(code) {
			t.Errorf("ValidTender(%q) = true, want false", code)
		}
	}
}

func TestManualTenderCode(t *testing.T) {
	if got := NewManualTender(nil).Code(); got != "manual" {
		t.Errorf("Code() = %q, want %q", got, "manual")
	}
}

// TestChargeRejectsBadInputBeforeTouchingDB passes a nil Querier on purpose: if
// validation ever regresses and lets one of these through, the call panics
// instead of silently writing a bad tender row.
func TestChargeRejectsBadInputBeforeTouchingDB(t *testing.T) {
	m := NewManualTender(nil)
	ctx := context.Background()

	cases := []struct {
		name string
		req  ChargeRequest
		want error
	}{
		{
			name: "unknown tender",
			req:  ChargeRequest{OrderID: "o1", Tender: "stripe", Amount: Amount{Cents: 100}},
			want: ErrUnknownTender,
		},
		{
			name: "empty tender",
			req:  ChargeRequest{OrderID: "o1", Tender: "", Amount: Amount{Cents: 100}},
			want: ErrUnknownTender,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := m.Charge(ctx, tc.req); !errors.Is(err, tc.want) {
				t.Fatalf("Charge() error = %v, want %v", err, tc.want)
			}
		})
	}

	if _, err := m.Charge(ctx, ChargeRequest{Tender: "cash", Amount: Amount{Cents: 100}}); err == nil {
		t.Error("Charge() with no order_id returned nil error")
	}
	if _, err := m.Charge(ctx, ChargeRequest{OrderID: "o1", Tender: "cash", Amount: Amount{Cents: -1}}); err == nil {
		t.Error("Charge() with negative amount returned nil error")
	}
}

func TestRefundRejectsBadInputBeforeTouchingDB(t *testing.T) {
	m := NewManualTender(nil)
	ctx := context.Background()

	if _, err := m.Refund(ctx, RefundRequest{Amount: Amount{Cents: 100}}); err == nil {
		t.Error("Refund() with no charge_id returned nil error")
	}
	if _, err := m.Refund(ctx, RefundRequest{ChargeID: "p1", Amount: Amount{Cents: 0}}); err == nil {
		t.Error("Refund() with zero amount returned nil error")
	}
}

func TestGetStatusEmptyIDIsNotFound(t *testing.T) {
	if _, err := NewManualTender(nil).GetStatus(context.Background(), ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetStatus(\"\") error = %v, want %v", err, ErrNotFound)
	}
}

func TestStatusFromDB(t *testing.T) {
	cases := map[string]Status{
		"completed": StatusSettled,
		"failed":    StatusFailed,
		"cancelled": StatusFailed,
		"pending":   StatusPending,
		"anything":  StatusPending,
	}
	for in, want := range cases {
		if got := statusFromDB(in); got != want {
			t.Errorf("statusFromDB(%q) = %q, want %q", in, got, want)
		}
	}
}
