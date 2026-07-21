package marketplace_test

// DB-backed integration tests for the online-gateway checkout branch added to
// CreateCheckoutOrder (see checkout.go).
//
// Run:
//
//	cd backend && go test ./internal/handlers/marketplace/ -run OnlinePayment -v
//
// Starts an ephemeral Postgres via testenv.StartPostgres (Docker
// testcontainers -> local scratch DB -> ErrSkip), same as the repo's other
// *_integration_test.go files.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/cmd/tests/fixtures"
	"github.com/beepbite/backend/cmd/tests/testenv"
	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/marketplace"
	"github.com/beepbite/backend/internal/payments"
)

var onlineTestPool *pgxpool.Pool

func TestMain(m *testing.M) {
	ctx := context.Background()
	pool, cleanup, err := testenv.StartPostgres(ctx)
	if errors.Is(err, testenv.ErrSkip) {
		fmt.Println("skipping integration tests:", err)
		os.Exit(0)
	}
	if err != nil {
		fmt.Println("testenv.StartPostgres:", err)
		os.Exit(1)
	}
	defer cleanup()
	onlineTestPool = pool
	os.Exit(m.Run())
}

// mockGateway is a hand-rolled payments.PaymentProvider standing in for
// PatalaGatewayProvider — the real one needs `-tags patala` plus a compiled
// patala cdylib (see internal/payments/patala_gateway_test.go), which is
// out of scope for a fast, always-runnable unit/integration test of the
// CHECKOUT WIRING itself (as opposed to the adapter, already covered
// separately). It reproduces just the two properties checkout.go's online
// branch depends on: Charge returns StatusPending with a pay URL in
// Receipt.Reference and a non-empty Receipt.ID, and it echoes ReturnURL back
// so the test can assert checkout.go actually built and passed one through.
type mockGateway struct {
	code        string
	lastCharge  payments.ChargeRequest
	chargeCalls int
}

func (m *mockGateway) Code() string { return m.code }

func (m *mockGateway) Charge(ctx context.Context, req payments.ChargeRequest) (payments.Receipt, error) {
	m.chargeCalls++
	m.lastCharge = req
	return payments.Receipt{
		ID:         "mock-charge-token-" + req.OrderID,
		Tender:     m.code,
		Amount:     req.Amount,
		Status:     payments.StatusPending,
		Reference:  "https://pay.example.test/session/" + req.OrderID,
		OccurredAt: time.Now(),
	}, nil
}

func (m *mockGateway) Refund(ctx context.Context, req payments.RefundRequest) (payments.Receipt, error) {
	return payments.Receipt{}, errors.New("mockGateway: refund not supported")
}

func (m *mockGateway) GetStatus(ctx context.Context, chargeID string) (payments.Receipt, error) {
	return payments.Receipt{ID: chargeID, Status: payments.StatusPending}, nil
}

var _ payments.PaymentProvider = (*mockGateway)(nil)

// seedMarketplaceStore creates an org + a marketplace-visible location + a
// menu, and returns the slug and location id.
func seedMarketplaceStore(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tag string) (slug, locationID string, itemIDs []string) {
	t.Helper()
	orgID, ownerID, err := fixtures.SeedOrg(ctx, pool, "Online Pay Test Org "+tag)
	if err != nil {
		t.Fatalf("SeedOrg: %v", err)
	}
	slug = "online-pay-test-" + tag
	locationID, err = fixtures.SeedLocation(ctx, pool, orgID, "Online Pay Test Store", slug)
	if err != nil {
		t.Fatalf("SeedLocation: %v", err)
	}
	_, itemIDs, err = fixtures.SeedMenu(ctx, pool, locationID)
	if err != nil {
		t.Fatalf("SeedMenu: %v", err)
	}

	// Marketplace-visible is false by default (migration default) — flip it
	// on, same as a real shop opting into the public store directory.
	if err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE locations SET is_marketplace_visible = true WHERE id = $1`, locationID)
		return err
	}); err != nil {
		t.Fatalf("mark location marketplace-visible: %v", err)
	}

	t.Cleanup(func() {
		_ = db.Scoped(context.Background(), pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
			return err
		})
		_ = db.Scoped(context.Background(), pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
			_, err := tx.Exec(context.Background(), `DELETE FROM auth_users WHERE id = $1`, ownerID)
			return err
		})
	})
	return slug, locationID, itemIDs
}

func checkoutRouterFor(h *marketplace.Handler) http.Handler {
	r := chi.NewRouter()
	r.Route("/stores", h.Mount)
	return r
}

// TestOnlinePayment_CheckoutOrder_ReturnsPendingAndPayURL is the required
// "gateway configured" branch test: a configured online gateway must produce
// a pending order with a pay URL, and record a pending order_payments row
// carrying the gateway's charge token.
func TestOnlinePayment_CheckoutOrder_ReturnsPendingAndPayURL(t *testing.T) {
	ctx := context.Background()
	slug, locationID, itemIDs := seedMarketplaceStore(t, ctx, onlineTestPool, "gw")

	gw := &mockGateway{code: "mockpay"}
	h := marketplace.NewHandler(onlineTestPool).
		WithOnlinePayments(gw, "mockpay", "test-secret", "https://api.example.test")

	body := fmt.Sprintf(`{"fulfillment_type":"collection","items":[{"item_id":%q,"quantity":2}]}`, itemIDs[0])
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
	if resp.Status != "pending" {
		t.Errorf("expected status 'pending' for online-gateway order, got %q", resp.Status)
	}
	if resp.PayURL == "" {
		t.Error("expected a non-empty pay_url for online-gateway order")
	}
	if resp.PaymentMethod != "mockpay" {
		t.Errorf("expected payment_method %q, got %q", "mockpay", resp.PaymentMethod)
	}

	// The gateway must have been charged exactly once, with a ReturnURL
	// built by checkout.go (BEEPBITE_API_PUBLIC_URL + a signed order token).
	if gw.chargeCalls != 1 {
		t.Fatalf("expected exactly 1 Charge call, got %d", gw.chargeCalls)
	}
	if gw.lastCharge.ReturnURL == "" {
		t.Error("expected checkout.go to pass a non-empty ReturnURL into ChargeRequest")
	}

	// order_payments must carry a pending row with the gateway's charge
	// token in external_transaction_id (what SettleOnlinePayment reads back
	// later — see settle.go).
	var paymentStatus, externalTxnID string
	err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT payment_status::text, external_transaction_id
			FROM order_payments WHERE order_id = $1
		`, resp.OrderID).Scan(&paymentStatus, &externalTxnID)
	})
	if err != nil {
		t.Fatalf("query order_payments: %v", err)
	}
	if paymentStatus != "pending" {
		t.Errorf("expected order_payments.payment_status 'pending', got %q", paymentStatus)
	}
	if externalTxnID == "" {
		t.Error("expected order_payments.external_transaction_id to carry the gateway charge token")
	}

	// orders.status must be 'pending' (the schema default), not 'confirmed'
	// — the order must not be treated as paid until verify-on-return settles
	// it (see payments.SettleOnlinePayment).
	var orderStatus string
	err = db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status::text FROM orders WHERE id = $1`, resp.OrderID).Scan(&orderStatus)
	})
	if err != nil {
		t.Fatalf("query orders: %v", err)
	}
	if orderStatus != "pending" {
		t.Errorf("expected orders.status 'pending' before settlement, got %q", orderStatus)
	}
	_ = locationID
}

// TestOnlinePayment_CheckoutOrder_NoGatewayUnchanged is the required "gateway
// absent" branch test: with no WithOnlinePayments call (the default — every
// non-patala build, and any patala build with no BEEPBITE_ONLINE_PAYMENT_PROVIDER
// set), CreateCheckoutOrder must behave EXACTLY as it did before this feature
// existed — on-delivery only, no pay_url, gated on on_delivery_payment_methods.
func TestOnlinePayment_CheckoutOrder_NoGatewayUnchanged(t *testing.T) {
	ctx := context.Background()
	slug, locationID, itemIDs := seedMarketplaceStore(t, ctx, onlineTestPool, "nogw")

	// No on_delivery_payment_methods configured (the fixture default: '{}')
	// and no gateway wired in -> ErrNoPaymentMethod, exactly as before.
	h := marketplace.NewHandler(onlineTestPool) // WithOnlinePayments deliberately NOT called

	body := fmt.Sprintf(`{"fulfillment_type":"collection","items":[{"item_id":%q,"quantity":1}]}`, itemIDs[0])
	req := httptest.NewRequest(http.MethodPost, "/stores/"+slug+"/orders", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	checkoutRouterFor(h).ServeHTTP(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 (no payment method available) with no gateway and no on-delivery methods configured, got %d: %s", rr.Code, rr.Body.String())
	}

	// Now configure an on-delivery method directly (bypassing any admin
	// endpoint — this test only cares about CreateCheckoutOrder's own
	// on-delivery branch, unchanged) and confirm the pre-existing behaviour:
	// pending_on_delivery status, cash_on_delivery tender, no pay_url.
	if err := db.Scoped(ctx, onlineTestPool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE locations SET on_delivery_payment_methods = '{cash}' WHERE id = $1`, locationID)
		return err
	}); err != nil {
		t.Fatalf("set on_delivery_payment_methods: %v", err)
	}

	body2 := fmt.Sprintf(`{"fulfillment_type":"delivery","delivery_address":"1 Test Street","items":[{"item_id":%q,"quantity":1}]}`, itemIDs[0])
	req2 := httptest.NewRequest(http.MethodPost, "/stores/"+slug+"/orders", strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	checkoutRouterFor(h).ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr2.Code, rr2.Body.String())
	}
	var resp2 marketplace.CheckoutResp
	if err := json.Unmarshal(rr2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp2.Status != "pending_on_delivery" {
		t.Errorf("expected status 'pending_on_delivery', got %q", resp2.Status)
	}
	if resp2.PaymentMethod != "cash_on_delivery" {
		t.Errorf("expected payment_method 'cash_on_delivery', got %q", resp2.PaymentMethod)
	}
	if resp2.PayURL != "" {
		t.Errorf("expected no pay_url on the on-delivery path, got %q", resp2.PayURL)
	}
}
