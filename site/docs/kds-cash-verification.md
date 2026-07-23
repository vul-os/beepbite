# KDS + Cash Drawer + Adjustments Verification — V5

> **UPDATE 2026-05-20 (post-fix):** All handler bugs below (#1 POS create-order,
> #2 cash drawer, #3 adjustments) and the recipecost/transferwebhook job failures
> are **fixed and verified**. The POS→charge→KDS→cashdrawer→adjustments suites now
> pass 99/99 (`go run ./cmd/tests --pos --kds --cashdrawer --adjustments --menu`).
> Key fixes: handler stores use `db.Scoped`; `audit_log` writes elevate via the new
> `db.WithTxServiceRole` helper (audit INSERT is service-role-only per migration 013);
> the cash-drawer close query used dropped columns (`payment_method_id`/`amount_cents`
> → `payment_method_code`/`amount_paid_cents`); the POS handler was rewritten for the
> consolidated `orders`/`order_items` schema (it wrote to the dropped `order_details`,
> `order_financial_details`, `order_item_variations` tables); migration 020 lets the
> `queue_kds_fanout()` trigger write its service-role `kds_fanout_queue`; and the
> generic data-layer audit hook now elevates too. See the session summary for detail.

**Date:** 2026-05-20  
**Agent:** V5 verification agent  
**Branch:** beepnew  
**Server:** :8080 (go run ./cmd/server, log at /tmp/beepbite-server.log)

---

## Setup

Test user `v5-1779264843@example.com` signed up, org created, owner membership inserted directly via psql (auto-trigger not present), location `27ab3182...`, KDS station `62b24235...`, menu item `cde6dd84...` with `item_station_routing`, cash drawer `05618669...`, manager staff `54acf67c...` with bcrypt PIN "9999", cashier staff `52e6f940...`. Order `745581c4...` and order item inserted directly (bypassing POS handler — see Bug #1 below).

---

## Flow Results

### Flow 1: Order → KDS Fanout — PASS

`POST /kds/orders/745581c4.../fanout` returned HTTP 201 with 2 tickets (order item routed to 2 stations). Confirmed `kds_tickets` rows with `status=fired` in DB. The KDS handler correctly uses `db.Scoped` for RLS.

```
kds_tickets: 2 rows, both status=fired
kds_ticket_events: 1 fired event auto-created by fanout store
```

### Flow 2: KDS Bump — PASS

`POST /kds/tickets/bfd373e1.../bump` with `{"performed_by":"54acf67c..."}` returned HTTP 200. Ticket status transitioned `fired → bumped`, `bumped_at` timestamp set. A `kds_ticket_events` row with `event_type=bumped`, `performed_by=54acf67c...` was created.

```
kds_ticket_events: fired + bumped rows confirmed
```

### Flow 3: Cash Drawer — FAIL (handler bug, flow verified at DB level)

`POST /cash-drawers/{drawer_id}/sessions/open` returned HTTP 404 "not found".

**Root cause (Bug #2):** `cashdrawer.Store.DrawerLocationID` and `SessionLocationID` use `s.pool.QueryRow` directly (no session vars). `cash_drawers` RLS policy `USING (location_id IN (SELECT ... WHERE organization_id = current_org_id()))` evaluates to false when `current_org_id()` is NULL → returns ErrDrawerNotFound. Same applies to `getSession`, `postMovement`, `closeSession`, and `listSessions`.

**DB-level verification:** Session opened (float=5000c), movement inserted (paid_in +2000c), session closed (declared=7000c, over_short=0). Schema works correctly.

### Flow 4: Adjustment Void — FAIL (handler bug; capability gate PASSES)

`POST /{order_id}/void` with owner token (has `can_void`) returned HTTP 404 "order not found".

**Root cause (Bug #3):** `adjustments.Store.GetOrderLocationID` uses `s.pool.QueryRow` directly, and `VoidOrder`/`CompItem`/etc. use `s.pool.BeginTx` without `db.Scoped`. The `orders` table RLS (`organization_id = current_org_id()`) blocks the query when no session vars are set.

**DB-level verification:** Direct psql insert confirmed `order_adjustments` row created with `adjustment_type=void`, `applied_by`, `approved_by`, `approval_status=approved`. Corresponding `audit_log` row inserted with `actor_type=staff`, `actor_id` set correctly.

**Note:** The adjustments handler is mounted at `/{order_id}/void` (no `/orders` prefix) in the org-scoped group. Path is correct.

### Flow 5: Capability Gate — PASS

`POST /{order_id}/void` with a `staff` role user (empty `capabilities={}`) returned HTTP 403:
```json
{"capability":"can_void","error":"missing_capability"}
```
`auth.RequireCapability("can_void")` middleware correctly gates the endpoint.

---

## Handler Bugs Reported

### Bug #1: POS CreateOrder — RLS failure (location not found)

**File:** `backend/internal/handlers/pos/store.go:90`  
`s.pool.BeginTx(ctx, pgx.TxOptions{})` — raw transaction without session vars. The location existence check `SELECT EXISTS(SELECT 1 FROM locations WHERE id = $1)` is blocked by `locations` RLS (`organization_id = current_org_id()`). Returns `ErrLocationNotFound`. Workaround required: insert order directly or use `db.Scoped`.

### Bug #2: Cash Drawer — DrawerLocationID / SessionLocationID use raw pool queries

**File:** `backend/internal/handlers/cashdrawer/store.go:346-371`  
`DrawerLocationID` and `SessionLocationID` call `s.pool.QueryRow` directly. `cash_drawers` RLS blocks `SELECT location_id` when `current_org_id()` is NULL (no session vars). All five cash drawer handler methods fail (open, list, movement, close, get).  
**Fix:** Wrap with `db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), ...)` or accept a scoped tx.

### Bug #3: Adjustments Store — raw pool.BeginTx without session vars

**File:** `backend/internal/handlers/adjustments/store.go:50-55,220`  
`GetOrderLocationID` and all mutating methods (`VoidOrder`, `CompItem`, `PriceOverrideItem`, `RefundOrder`) use `s.pool.QueryRow` or `s.pool.BeginTx` directly. The `orders` and `order_adjustments` table RLS blocks all operations when `current_org_id()` is NULL.  
**Fix:** Same pattern as Bug #2 — use `db.Scoped` for the transaction.

---

## Background Job: recipecost RLS Error — CONFIRMED FAILING

Server log shows periodic failures (every 5 minutes):
```
recipecost: insert no-op run: insert recipe_cost_runs: ERROR: new row violates row-level security policy for table "recipe_cost_runs" (SQLSTATE 42501)
```
The `recipecost.Runner` uses a raw pool connection without service-role session vars. This is the same bug class as Bugs #1–3 above. Additionally:
```
transferwebhook/recon: list stuck payouts: ERROR: column "organization_id" does not exist (SQLSTATE 42703)
```
The transfer reconciler references a non-existent column `organization_id` — separate schema mismatch.

---

## Additional Notes

- `kds_fanout_queue` table is empty — the fanout worker (`kdsfanout.Runner`) found no pending items. Synchronous fanout via `POST /kds/orders/{id}/fanout` is the tested path.
- The `trg_default_member_capabilities` trigger on `organization_members` correctly auto-fills full capabilities for `owner` role (migration 019). Tested and confirmed.
- Signup does not auto-create an `organization_members` row — onboarding flow requires the user to POST to `/data/organization_members` after creating the org (this is the intended design per server log evidence).
- Test data cleaned up: `DELETE FROM auth_users WHERE email LIKE 'v5-%@example.com'` (5 rows removed).
