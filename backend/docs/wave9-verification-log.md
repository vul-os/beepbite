# Wave 9 Verification Log

---

## 2026-05-19T00:00:00Z [capability-bypass] T9.4a/b/c smoke check

### Coverage matrix — handler × capability

| Handler | Route | Method | Capability gate | Status |
|---|---|---|---|---|
| adjustments | `/{order_id}/void` | POST | `can_void` via `RequireCapability` | PASS |
| adjustments | `/{order_id}/refund` | POST | `can_refund` via `RequireCapability` | PASS |
| adjustments | `/{order_id}/items/{item_id}/comp` | POST | `can_comp` via `RequireCapability` | PASS |
| adjustments | `/{order_id}/items/{item_id}/price-override` | POST | `can_comp` via `RequireCapability` | PASS |
| adjustments | `/{order_id}/adjustments` | GET | none (intentional — read-only list) | PASS |
| cashdrawer | `/sessions/{session_id}/close` | POST | `can_settle` via `RequireCapability` | PASS |
| cashdrawer | `/sessions/{session_id}/movements` (paid_out, no_sale) | POST | `can_settle` via in-handler `HasCapability` (body-conditional) | PASS |
| cashdrawer | `/{drawer_id}/sessions/open` | POST | none (any authenticated staff) | PASS by design |
| cashdrawer | `/{drawer_id}/sessions` | GET | none | PASS by design |
| cashdrawer | `/sessions/{session_id}` | GET | none | PASS by design |
| payroll | `/staff/{staff_id}/rates` | GET | `can_view_reports` via `RequireCapability` | PASS |
| payroll | `/export` | GET | `can_view_reports` via `RequireCapability` | PASS |
| payroll | `/staff/{staff_id}/rates` | POST | `can_manage_payroll` via `RequireCapability` | PASS |
| payroll | `/rates/{rate_id}` | PATCH | `can_manage_payroll` via `RequireCapability` | PASS |
| bankaccounts | `/bank-accounts/` | POST | NONE — **GAP** | FAIL |
| bankaccounts | `/bank-accounts/` | GET | NONE — **GAP** | FAIL |
| bankaccounts | `/bank-accounts/{id}` | GET | NONE — **GAP** | FAIL |
| bankaccounts | `/bank-accounts/{id}` | DELETE | NONE — **GAP** | FAIL |
| inventory | `/goods-receipts/{grn_id}/receive` | POST | `can_manage_inventory` via `RequireCapability` | PASS |
| inventory | `/supplier-invoices/{invoice_id}/match` | POST | `can_manage_inventory` via `RequireCapability` | PASS |
| inventory | `/purchase-orders` | POST | `can_manage_inventory` via `RequireCapability` | PASS |
| inventory | `/purchase-orders/{po_id}/submit` | POST | `can_manage_inventory` via `RequireCapability` | PASS |
| inventory | `/auto-po-suggestions` | GET | `can_view_inventory` via `RequireCapability` | PASS |
| waste | `/waste` | POST | `can_manage_inventory` via `RequireCapability` | PASS |
| waste | `/waste` | GET | `can_view_inventory` via `RequireCapability` | PASS |
| waste | `/waste/report` | GET | `can_view_inventory` via `RequireCapability` | PASS |
| waste | `/prep-batches` | POST | `can_manage_inventory` via `RequireCapability` | PASS |
| waste | `/prep-batches` | GET | `can_view_inventory` via `RequireCapability` | PASS |
| promotions | `/orders/{order_id}/apply-promotions` | POST | NONE — **GAP** | FAIL |
| pos | `/pos/orders` | POST | none (POS order creation, open to auth staff) | Note: no capability gate; debatable |
| pos | `/pos/orders/{order_id}/charge` | POST | none | Note |
| pos | `/orders/{order_id}/mark-paid-on-delivery` | POST | none | Note: expected `can_settle` per ROADMAP |

### Gaps found

1. **bankaccounts** — all four routes (POST/GET create/list/getByID/softDelete) have zero `RequireCapability` guards. Per ROADMAP, bank operations should require `can_settle`. The handler imports `auth` but does not call `RequireCapability` anywhere in `Mount()` or `Routes()`.

2. **promotions** — `POST /orders/{order_id}/apply-promotions` has no capability gate. If promotions config is staff-only, `can_manage_menu` or `can_manage_promotions` should be applied. Currently any authenticated user can invoke it.

3. **pos/mark-paid-on-delivery** — ROADMAP specifies `can_settle` for marking delivery orders as paid. The route has no `RequireCapability` applied.

### Build / vet / test results

- `go build ./...` — PASS (after fixing `ParseActorToken` redeclaration between `actortoken.go` and `actor_middleware.go`, and missing `jwt` import in `actor_middleware_test.go`)
- `go vet ./...` — PASS
- `go test -count=1 -short ./internal/handlers/adjustments/... ./internal/handlers/cashdrawer/... ./internal/auth/...` — PASS (`auth` ok 0.005s; no test files in adjustments/cashdrawer packages yet)

### Build fix applied

`internal/auth/actortoken.go`: renamed old `ParseActorToken(secret, jwt)` → `ParseActorTokenV1(secret, jwt)` to resolve redeclaration conflict with the newer `actor_middleware.go` version (`ParseActorToken(jwt, secret)`). Updated `actortoken_test.go` accordingly and renamed `testActorSecret` → `testActorV1Secret` to avoid collision with `actor_middleware_test.go`.

Added missing `github.com/golang-jwt/jwt/v5` import to `actor_middleware_test.go` (used `jwt.NewNumericDate` without import).

### Recommended actions

- Wire `RequireCapability("can_settle")` on `bankaccounts.Mount()` write routes (POST, DELETE) and read routes (GET) with appropriate capability.
- Wire `RequireCapability("can_manage_promotions")` or `can_manage_menu` on `promotions.Mount()`.
- Wire `RequireCapability("can_settle")` on `pos` mark-paid-on-delivery route.
- Add unit tests for adjustments and cashdrawer packages.
