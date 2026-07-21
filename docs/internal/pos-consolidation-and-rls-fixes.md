# POS Consolidation + RLS/Audit Fixes — Verification

**Date:** 2026-05-20
**Branch:** beepnew
**Server:** :8080 (`/tmp/beepbite-server-new`, env=local against the `beepbite` DB)

This documents the fixes that completed the Wave-11 data-layer regression work
(handler stores → `db.Scoped`, background jobs → service-role) and the POS order
flow, plus the bugs found while verifying end-to-end.

---

## Verified green

`go run ./cmd/tests --env=local --pos --kds --cashdrawer --adjustments --menu` →
**99/99 cases pass.** Covered flows:

- **POS:** create order (dine_in) → single charge → split charge → double-charge
  409 conflict. `order_payments` rows written; order status → `completed`.
- **KDS:** synchronous fanout on order create, list station tickets, bump, recall.
- **Cash drawer:** open → paid_in movement → get → close (over/short) → EOD list.
- **Adjustments:** capability gate (`can_void`), void validation, list adjustments,
  staff creation. (Full PIN-void is skipped — the set-pin route is not mounted.)
- **Menu:** category + item CRUD via the generic `/data` layer.

`go build ./...` and `go vet ./...` are clean.

---

## Fixes applied

### 1. `audit_log` writes need service-role (migration 013), even from tenant handlers
`audit_log` INSERT is restricted to `is_service_role()` so a compromised tenant
session cannot forge audit entries. The handler stores (and the generic data
layer's audit hook) run the mutation under the caller's **tenant** scope, so the
audit INSERT failed with `42501`.

**Fix:** new helper `db.WithTxServiceRole(ctx, tx, fn)` (`internal/db/scoped.go`)
elevates `app.is_service_role` for just the audit write (transaction-local), then
restores tenant scope. Applied in:
- `internal/handlers/cashdrawer/store.go` (close-session audit)
- `internal/handlers/adjustments/store.go` (`insertAuditLog`)
- `internal/handlers/data/audit.go` (`auditMutation` — fixes **all** audited tables
  via `/data`: items, promotions, order_adjustments, menu_schedules, …)

### 2. Cash-drawer close query referenced dropped columns
`internal/handlers/cashdrawer/store.go`: `op.amount_cents` → `op.amount_paid_cents`;
removed the join to `payment_methods` on the non-existent `op.payment_method_id`,
filtering on `op.payment_method_code = 'cash'` directly.

### 3. POS `CreateOrder` rewritten for the consolidated schema
`internal/handlers/pos/store.go` wrote to three tables that were consolidated away
(`order_details`, `order_financial_details`, `order_item_variations`) and omitted
`orders.organization_id`. Rewrote to a single `orders` insert with
`organization_id` (from the location) + cents financial columns
(`subtotal_cents`/`tax_cents`/`total_cents`) + `fulfillment_type` enum +
`estimated_prep_time`/`notes`, and `order_items` with `unit_price_cents`/
`total_price_cents`. Per-option pricing dropped (item_variation_options is gone).

### 4. POS `ChargeOrder` rewritten for the consolidated schema
`internal/handlers/pos/charge.go` read/wrote `order_financial_details`. Replaced
the paid check with `EXISTS(order_payments … payment_status='completed')` and
removed the financial-details UPDATE; payment is recorded in `order_payments`.

### 5. Migration 020 — KDS fanout trigger elevation
`migrations/020_kds_fanout_trigger_service_role.sql`: `queue_kds_fanout()` (AFTER
INSERT on `orders`) enqueues into `kds_fanout_queue`, which is service-role-only.
Under tenant scope the order insert aborted. The trigger now elevates
`app.is_service_role` for just the enqueue.

### 6. Background jobs / reconciler (agent fixes, verified)
`transferwebhook` recon's `column "organization_id" does not exist` error is gone
(it now JOINs `merchant_payouts` → `locations`). recipecost/payouts/kdsfanout/
auditretention use `db.ServiceRoleScope()`.

### 7. Test-harness fixes
- `cmd/tests/helpers.go`: bootstrap sets `on_delivery_payment_methods=['cash']` so
  the store can accept orders; category insert includes `organization_id`.
- `cmd/tests/suite_menu.go`: removed CRUD against dropped `item_variations` /
  `item_variation_options`.
- `cmd/tests/bootstrap.go`: `ensureSession` delegates to `bootstrapOrgAndLocation`
  (signup no longer auto-creates an org — auto-owner trigger dropped in migration 017).

---

## Pre-existing findings (NOT regressions; outside this scope)

From `go run ./cmd/tests --all` (181/187; the 6 below are pre-existing):

- **Org-anchored `/data` inserts omit `organization_id`.** `categories`, `customers`,
  and ~20 other tables have `organization_id NOT NULL` with no default. The
  frontend is inconsistent (e.g. `suppliers` sends it, `categories` does not), so
  those inserts fail RLS/NOT-NULL. Decide on one approach (data-layer auto-inject
  `current_org_id()`, a per-table trigger, or fix each caller).
- **`recipe_breakdown` / `recipe_summary` views don't exist** (allowlisted) — see
  `data-layer-regression.md` BUG-V4-01.
- **Malformed `eq` filters return 200, not 4xx.** `/data/items?eq=;drop,x` is
  silently ignored rather than rejected. **No SQL injection** (queries are
  parameterized; `items` table intact), but the filter parser should reject a
  malformed `eq` (`col` not matching `[a-z_]`). Hardening gap in
  `internal/handlers/data/filters.go`.
- **Other raw-pool handlers** (`fiscal`, `bankaccounts`, `giftcards`, `inventory`,
  `mark_paid_on_delivery`, `paymentwebhook`) still use `s.pool` without scope and
  will hit the same RLS/audit issues when exercised — not covered by current suites.
