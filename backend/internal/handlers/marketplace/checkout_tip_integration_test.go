package marketplace_test

// DB-backed integration tests for tip_cents on POST /stores/{slug}/orders
// (see checkout.go's CheckoutReq.TipCents and CreateCheckoutOrder).
//
// These exist to prove the money actually moves: the checkout UI shows the
// customer subtotal + tip as their total and, on the on-delivery path, tells
// them to have that total in cash ready — so the persisted order must carry
// the same number, and the online-gateway path must charge it. A test that
// only checks the request struct has a tip_cents field would not catch a
// bug where the field is accepted but silently dropped before the total is
// computed, or added to the wrong side of the tax calculation.
//
// Run:
//
//	cd backend && go test ./internal/handlers/marketplace/ -run Tip -v
//
// Uses the same onlineTestPool / seedMarketplaceStore fixtures as
// checkout_online_integration_test.go (same package, same TestMain).

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/marketplace"
)

// TestCheckoutOrder_TipCents_AddsToStoredTotalAndGratuity is the core proof:
// on the on-delivery path (no gateway configured), a tip_cents in the request
// must land, cent for cent, on the stored order — both as the delta on
// total_cents and as orders.gratuity_cents — matching what the checkout UI
// showed the customer as their total.
func TestCheckoutOrder_TipCents_AddsToStoredTotalAndGratuity(t *testing.T) {
	ctx := context.Background()
	slug, locationID, itemIDs := seedMarketplaceStore(t, ctx, onlineTestPool, "tip-ondelivery")

	if err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE locations SET on_delivery_payment_methods = '{cash}' WHERE id = $1`, locationID)
		return err
	}); err != nil {
		t.Fatalf("set on_delivery_payment_methods: %v", err)
	}

	h := marketplace.NewHandler(onlineTestPool) // no gateway — on-delivery path
	router := checkoutRouterFor(h)

	place := func(tipCents int64) marketplace.CheckoutResp {
		t.Helper()
		body := fmt.Sprintf(
			`{"fulfillment_type":"collection","items":[{"item_id":%q,"quantity":1}],"tip_cents":%d}`,
			itemIDs[0], tipCents,
		)
		req := httptest.NewRequest(http.MethodPost, "/stores/"+slug+"/orders", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("tip_cents=%d: expected 201, got %d: %s", tipCents, rr.Code, rr.Body.String())
		}
		var resp marketplace.CheckoutResp
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		return resp
	}

	// Baseline order with no tip.
	noTip := place(0)

	// Same cart, R5.00 tip (500 cents — the fixture's ZAR locale has 2 decimals).
	const tipCents = int64(500)
	withTip := place(tipCents)

	var noTipTotal, withTipTotal, gratuityCents int64
	if err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT total_cents FROM orders WHERE id = $1`, noTip.OrderID).Scan(&noTipTotal); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT total_cents, gratuity_cents FROM orders WHERE id = $1`, withTip.OrderID).
			Scan(&withTipTotal, &gratuityCents)
	}); err != nil {
		t.Fatalf("query orders: %v", err)
	}

	if withTipTotal-noTipTotal != tipCents {
		t.Errorf("expected the tipped order's total_cents to exceed the untipped one by exactly %d, got %d (no-tip=%d, with-tip=%d)",
			tipCents, withTipTotal-noTipTotal, noTipTotal, withTipTotal)
	}
	if gratuityCents != tipCents {
		t.Errorf("expected orders.gratuity_cents = %d, got %d", tipCents, gratuityCents)
	}
}

// TestCheckoutOrder_TipCents_BilledOnOnlineGatewayPath proves the tip is not
// merely stored but actually charged: on the online-gateway path, the amount
// sent to the payment provider must include the tip, not just the pre-tip
// total.
func TestCheckoutOrder_TipCents_BilledOnOnlineGatewayPath(t *testing.T) {
	ctx := context.Background()
	slug, _, itemIDs := seedMarketplaceStore(t, ctx, onlineTestPool, "tip-online")

	gw := &mockGateway{code: "mockpay"}
	h := marketplace.NewHandler(onlineTestPool).
		WithOnlinePayments(gw, "mockpay", "test-secret", "https://api.example.test")

	const tipCents = int64(1234)
	body := fmt.Sprintf(
		`{"fulfillment_type":"collection","items":[{"item_id":%q,"quantity":1}],"tip_cents":%d}`,
		itemIDs[0], tipCents,
	)
	req := httptest.NewRequest(http.MethodPost, "/stores/"+slug+"/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	checkoutRouterFor(h).ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp marketplace.CheckoutResp
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if gw.chargeCalls != 1 {
		t.Fatalf("expected exactly 1 Charge call, got %d", gw.chargeCalls)
	}

	var totalCents, gratuityCents int64
	if err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT total_cents, gratuity_cents FROM orders WHERE id = $1`, resp.OrderID).
			Scan(&totalCents, &gratuityCents)
	}); err != nil {
		t.Fatalf("query orders: %v", err)
	}

	if gratuityCents != tipCents {
		t.Errorf("expected orders.gratuity_cents = %d, got %d", tipCents, gratuityCents)
	}
	// The gateway must have been charged the STORED total, tip included — not
	// a pre-tip figure the client happened to display.
	if gw.lastCharge.Amount.Cents != totalCents {
		t.Errorf("expected the gateway Charge amount (%d) to equal the stored order total_cents (%d)",
			gw.lastCharge.Amount.Cents, totalCents)
	}
	if totalCents < tipCents {
		t.Fatalf("sanity: stored total_cents (%d) is smaller than the tip alone (%d)", totalCents, tipCents)
	}
}

// TestCheckoutOrder_NegativeTip_Returns400 confirms a negative tip is
// rejected before it can ever reach the total computation.
func TestCheckoutOrder_NegativeTip_Returns400(t *testing.T) {
	ctx := context.Background()
	slug, _, itemIDs := seedMarketplaceStore(t, ctx, onlineTestPool, "tip-negative")

	h := marketplace.NewHandler(onlineTestPool)
	body := fmt.Sprintf(`{"fulfillment_type":"collection","items":[{"item_id":%q,"quantity":1}],"tip_cents":-1}`, itemIDs[0])
	req := httptest.NewRequest(http.MethodPost, "/stores/"+slug+"/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	checkoutRouterFor(h).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for negative tip_cents, got %d: %s", rr.Code, rr.Body.String())
	}
	_ = ctx
}

// TestCheckoutOrder_ImplausibleTip_Returns400 confirms a tip wildly out of
// proportion to the order's own subtotal (e.g. a client unit-conversion bug
// sending major units where cents were expected) is rejected rather than
// silently stored and billed.
func TestCheckoutOrder_ImplausibleTip_Returns400(t *testing.T) {
	ctx := context.Background()
	slug, locationID, itemIDs := seedMarketplaceStore(t, ctx, onlineTestPool, "tip-implausible")

	// The tip's own sanity check only runs once the item lines are priced
	// (step 4), which is after the ErrNoPaymentMethod check (step 2) — so an
	// unconfigured store would fail with 422 before the tip is ever looked
	// at, masking what this test wants to prove.
	if err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE locations SET on_delivery_payment_methods = '{cash}' WHERE id = $1`, locationID)
		return err
	}); err != nil {
		t.Fatalf("set on_delivery_payment_methods: %v", err)
	}

	h := marketplace.NewHandler(onlineTestPool)
	// Burger is 89.00 ZAR = 8900 cents; ask for a tip of 1,000,000 cents —
	// far past the 3x-subtotal sanity cap.
	body := fmt.Sprintf(`{"fulfillment_type":"collection","items":[{"item_id":%q,"quantity":1}],"tip_cents":1000000}`, itemIDs[0])
	req := httptest.NewRequest(http.MethodPost, "/stores/"+slug+"/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	checkoutRouterFor(h).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for an implausible tip_cents, got %d: %s", rr.Code, rr.Body.String())
	}
	_ = ctx
}
