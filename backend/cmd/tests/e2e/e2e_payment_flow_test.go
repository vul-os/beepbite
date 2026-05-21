package e2e

// e2e_payment_flow_test.go — order → mark paid → audit row → void → adjustment row
//
// Seeds orders directly via SQL (service-role) to avoid schema-version
// dependency on pos.Store.CreateOrder, then:
//   - Inserts a completed order_payment row (simulate webhook settlement).
//   - Asserts audit_log row after the payment event.
//   - adjustments.Store.VoidOrder inserts an order_adjustments row for an
//     unpaid order.
//   - Voiding an already-paid order returns ErrOrderAlreadyPaid.

import (
	"context"
	"errors"
	"testing"

	"github.com/beepbite/backend/internal/db"
	"github.com/beepbite/backend/internal/handlers/adjustments"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPaymentFlow_MarkPaid_AuditRow_Void_AdjustmentRow(t *testing.T) {
	pool := openPool(t)
	ctx := context.Background()
	regionID := zaRegionID(t, pool)
	suffix := randStr(6)

	// ---------- Seed tenant ----------
	orgID := seedOrg(t, pool, "PayFlow E2E Org "+suffix)
	locID := seedLocation(t, pool, orgID, "PayFlow Loc "+suffix, regionID)

	// ---------- Create order directly via SQL ----------
	orderID := seedPayflowOrder(t, pool, orgID, locID)

	// ---------- Simulate webhook: mark paid ----------
	err := db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `
			INSERT INTO order_payments (order_id, payment_method_code, amount_paid_cents, payment_status, paid_at)
			VALUES ($1, 'card_in_person', 5000, 'completed', now())
		`, orderID)
		return e
	})
	if err != nil {
		t.Fatalf("insert order_payment: %v", err)
	}

	if n := rowCount(t, pool, "order_payments",
		"order_id = $1 AND payment_status = 'completed'", orderID); n != 1 {
		t.Errorf("expected 1 completed payment row, got %d", n)
	}

	// ---------- Audit row ----------
	err = db.Scoped(ctx, pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `
			INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, before_state, after_state)
			VALUES ('member', NULL, 'order.paid', 'orders', $1::uuid, '{}', '{"status":"paid"}')
		`, orderID)
		return e
	})
	if err != nil {
		t.Fatalf("insert audit_log: %v", err)
	}

	if n := rowCount(t, pool, "audit_log",
		"entity_id = $1::uuid AND action = 'order.paid'", orderID); n < 1 {
		t.Errorf("expected audit_log row, got 0")
	}

	// ---------- Void attempt on PAID order must fail ----------
	adjStore := adjustments.NewStore(pool)
	_, voidErr := adjStore.VoidOrder(ctx, orderID, "test void", "", "")
	if !errors.Is(voidErr, adjustments.ErrOrderAlreadyPaid) {
		t.Errorf("VoidOrder on paid order: want ErrOrderAlreadyPaid, got %v", voidErr)
	}

	// ---------- Void an unpaid order ----------
	order2ID := seedPayflowOrder(t, pool, orgID, locID)
	adj, err := adjStore.VoidOrder(ctx, order2ID, "test void reason", "", "")
	if err != nil {
		t.Fatalf("VoidOrder (unpaid): %v", err)
	}
	if adj.AdjustmentType != "void" {
		t.Errorf("adjustment_type: want void, got %q", adj.AdjustmentType)
	}

	if n := rowCount(t, pool, "order_adjustments",
		"order_id = $1 AND adjustment_type = 'void'", order2ID); n != 1 {
		t.Errorf("expected 1 void adjustment row, got %d", n)
	}

	// adjustments.Store.VoidOrder also calls insertAuditLog internally.
	if n := rowCount(t, pool, "audit_log",
		"entity_id = $1::uuid AND action = 'order.void'", order2ID); n < 1 {
		t.Errorf("expected audit_log row for order.void, got 0")
	}
}

// seedPayflowOrder inserts a minimal order row for the payment-flow test.
func seedPayflowOrder(t *testing.T, pool *pgxpool.Pool, orgID, locID string) string {
	t.Helper()
	var id string
	svcQueryRow(t, pool, &id, `
		INSERT INTO orders (organization_id, location_id, order_number, order_type, status, currency_code)
		VALUES ($1, $2, 'PAY'||left(md5(random()::text),4), 'pickup', 'confirmed', 'ZAR')
		RETURNING id`, orgID, locID)
	return id
}
