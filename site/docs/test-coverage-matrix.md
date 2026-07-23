# Test Coverage Matrix — Wave 14 Snapshot

> **No `docs/feature-parity.md` found.** This matrix is built from the actual
> test suites present in the repository today (see inventory below) rather than
> a canonical v1 feature list.

Generated: 2026-05-21

---

## Test Inventory

### HTTP Smoke Suites (`backend/cmd/tests/suite_*.go`)

| Suite file | Suites exercised |
|---|---|
| `suite_sanity.go` | Health endpoint, unknown-path 404, unauthed /data 401, CORS origin header |
| `suite_auth.go` | Signup 201, duplicate signup 409, /auth/me, signin, wrong-password 401, refresh rotation, old refresh revoked, signout, post-signout refresh 401 |
| `suite_pentest.go` | Unauthed access on 6 protected routes, bad bearer tokens (4 variants), refresh-token reuse detection, data-layer allowlist (3 hidden tables), unknown RPC 404, SQL-injection filter rejection (3 variants), malformed select 400, update/delete without filter 400, CORS arbitrary-origin rejection |
| `suite_menu.go` | Create/list/update category, create/fetch/set-active item |
| `suite_recipes.go` | Create recipe component (item_recipes), recipe_breakdown view read, calculate_recipe_cost RPC |
| `suite_orders.go` | Create customer, create order with delivery address, create order_item, update status, fetch order |
| `suite_members.go` | check_invites, send_invitation, list_organization_invitations, cancel_invitation, non-member invite rejection |
| `suite_whatsapp.go` | Webhook GET handshake (wrong token → 403), malformed POST (no 5xx) |
| `suite_onboarding.go` | Signup → create org → GET orgs → create member (capabilities trigger) → re-signin → GET profile → check_invites → create location → GET locations |
| `suite_pos.go` | Create dine-in order, single-tender charge, split-tender charge, duplicate-charge 409 |
| `suite_kds.go` | Create station, route item to station, create POS order (fanout), list station tickets, bump ticket → status=bumped + event, recall ticket |
| `suite_cashdrawer.go` | Create drawer, open session, duplicate-open 409, paid_in movement, get session detail, close session, EOD list (closed sessions) |
| `suite_adjustments.go` | Create order, void without staff IDs → 400/403, list adjustments (empty), create applier + manager staff, set PIN, create order, void order, list adjustments (row present) |

### Go e2e Tests (`backend/cmd/tests/e2e/*_test.go`)

| Test file | Tests |
|---|---|
| `e2e_onboard_test.go` | `TestOnboard_OrgLocationMenuPublish` — org/location row assertions, RLS isolation for items across orgs |
| `e2e_cross_tenant_test.go` | `TestCrossTenant_OrgA_CannotRead_OrgB` — 7 cross-tenant security checks (orders, items, locations, members) |
| `e2e_pos_flow_test.go` | `TestPOSFlow_StaffOrder_KDSBump_Settle` — staff PIN hash, KDS ticket fired → bumped, kds_ticket_events row, split-tender order_payments |
| `e2e_capabilities_test.go` | `TestCapabilities_Owner_HasFullCaps`, `TestCapabilities_Staff_EmptyCaps_DeniedVoidCompSettle`, `TestCapabilities_Owner_AuthCapabilities_IncludesAll` |
| `e2e_payment_flow_test.go` | `TestPaymentFlow_MarkPaid_AuditRow_Void_AdjustmentRow` — order payment, audit_log row, VoidOrder on paid order → ErrOrderAlreadyPaid, VoidOrder on unpaid → adjustment + audit row |

### RLS Probe Suite (`backend/cmd/tests/rls/main.go`)

Stand-alone binary. Seeds two isolated orgs into a scratch DB, then runs a matrix of direct SQL probes:

- **Anonymous scope**: 11 tables → SELECT=0; INSERT blocked on organizations, orders, locations
- **Org A member scope**: orders/locations/categories/items/org_members/staff/wallet_transactions — sees own, not B's; cross-org INSERT/UPDATE/DELETE blocked
- **Service role scope**: sees all rows for both orgs; INSERT for any org succeeds
- **Marketplace scope**: locations/items only where `is_marketplace_visible=true`; INSERT blocked; hidden locations not visible
- **Special cases**: order_tracking_tokens, whatsapp_link_tokens (service-role-only), audit_log UPDATE/DELETE blocked, wallet_transactions append-only

### Frontend Tests (`src/__tests__/`)

| Test file | Coverage |
|---|---|
| `currency.test.js` | `formatPrice` (USD, ZAR, NGN, KES, GBP, EUR, defaults, string/NaN input, zero), `currencySymbol` (known + unknown codes) — 12 assertions |
| `pos-workspace-smoke.test.js` | PosWorkspacePage module initialisation smoke — no TDZ/circular-reference error, default export is a callable React component |
| `render-smoke.test.jsx` | OnboardingChecklist render smoke via React Testing Library — mounts without throw, shows "Setup progress" text |

---

## Coverage Matrix

| Feature / Area | Status | Test file(s) |
|---|---|---|
| **Auth — signup / signin / signout** | covered | `suite_auth.go`, `suite_onboarding.go`, `e2e_onboard_test.go` |
| **Auth — JWT refresh rotation** | covered | `suite_auth.go` |
| **Auth — bad/tampered token rejection** | covered | `suite_pentest.go` |
| **Auth — refresh-token reuse detection** | covered | `suite_pentest.go` |
| **Auth — Google OAuth** | missing | no test (GOOGLE_* env vars optional; flow not exercised) |
| **Onboarding — org creation + membership trigger** | covered | `suite_onboarding.go`, `e2e_capabilities_test.go` |
| **Onboarding — location creation** | covered | `suite_onboarding.go` |
| **Onboarding — checklist UI render** | partial | `render-smoke.test.jsx` (mount smoke only; no step-through) |
| **Menu — category CRUD** | covered | `suite_menu.go` |
| **Menu — item CRUD** | covered | `suite_menu.go` |
| **Menu — modifier groups / modifiers** | missing | schema exists (Wave 11); no smoke checks or e2e tests |
| **Recipes — component insert + breakdown view** | covered | `suite_recipes.go` |
| **Recipes — calculate_recipe_cost RPC** | partial | `suite_recipes.go` (best-effort; 200 or 400 accepted) |
| **Recipes — cost job runner** | missing | `jobs/recipecost` runner has no dedicated test |
| **Orders — customer + order create + status update** | covered | `suite_orders.go` |
| **Orders — order_items** | covered | `suite_orders.go` |
| **Orders — on-delivery / delivery address** | partial | `suite_orders.go` (delivery address field set; no driver flow) |
| **POS — dine-in order create** | covered | `suite_pos.go`, `e2e_pos_flow_test.go` |
| **POS — single-tender charge** | covered | `suite_pos.go` |
| **POS — split-tender charge** | covered | `suite_pos.go`, `e2e_pos_flow_test.go` |
| **POS — duplicate-charge guard (409)** | covered | `suite_pos.go` |
| **POS — workspace module init (TDZ guard)** | covered | `pos-workspace-smoke.test.js` |
| **KDS — ticket fanout on order create** | covered | `suite_kds.go`, `e2e_pos_flow_test.go` |
| **KDS — bump (fired → bumped) + event row** | covered | `suite_kds.go`, `e2e_pos_flow_test.go` |
| **KDS — recall ticket** | covered | `suite_kds.go` |
| **KDS — fanout job runner** | missing | `jobs/kdsfanout` runner has no dedicated test |
| **Cash drawer — open / movement / close / EOD list** | covered | `suite_cashdrawer.go` |
| **Adjustments — void order** | covered | `suite_adjustments.go`, `e2e_payment_flow_test.go` |
| **Adjustments — void already-paid order (ErrOrderAlreadyPaid)** | covered | `e2e_payment_flow_test.go` |
| **Adjustments — comp (item-level comp)** | missing | no smoke test exercises `/{id}/items/{item_id}/comp` |
| **Adjustments — audit_log row on void** | covered | `e2e_payment_flow_test.go` |
| **Audit log — retention job** | missing | `jobs/auditretention` runner has no dedicated test |
| **Staff PIN / actor-overlay JWT** | partial | `suite_adjustments.go` (set-pin + void path); actor overlay absent in test tokens, 403 accepted as correct |
| **Staff PIN — set-pin endpoint** | partial | `suite_adjustments.go` (tests route existence; skips gracefully on 404) |
| **Capabilities — owner full caps (trigger 019)** | covered | `suite_onboarding.go`, `e2e_capabilities_test.go` |
| **Capabilities — staff empty caps denied void/comp/settle** | covered | `e2e_capabilities_test.go` |
| **Members — invite send / list / cancel** | covered | `suite_members.go` |
| **Members — non-member invite rejection** | covered | `suite_members.go` |
| **Payments — card-in-person webhook settlement** | partial | `e2e_payment_flow_test.go` (SQL-level only; no Paystack/Stripe webhook call) |
| **Payments — Paystack/Stripe gateway integration** | missing | test keys optional; `--payment-gateways` flag not wired into CI |
| **Payments — transfer webhook** | missing | `handlers/transferwebhook` has no smoke test |
| **Payments — payouts job** | missing | `jobs/payouts` runner has no dedicated test |
| **Marketplace — location visibility (mkt scope)** | covered | `rls/main.go` (marketplace scope probes) |
| **Marketplace — browse / order flow** | missing | no HTTP-level marketplace smoke |
| **RLS — cross-tenant isolation (orders / items / members / locations)** | covered | `e2e_cross_tenant_test.go`, `rls/main.go` |
| **RLS — anonymous zero-rows on all tenant tables** | covered | `rls/main.go` |
| **RLS — service-role bypass** | covered | `rls/main.go`, e2e helper (`openPool` uses `ServiceRoleScope`) |
| **RLS — audit_log append-only (UPDATE/DELETE blocked)** | covered | `rls/main.go` |
| **RLS — wallet_transactions append-only** | covered | `rls/main.go` |
| **RLS — whatsapp_link_tokens service-role-only** | covered | `rls/main.go` |
| **Security — data-layer allowlist (hidden tables)** | covered | `suite_pentest.go` |
| **Security — SQL injection filter rejection** | covered | `suite_pentest.go` |
| **Security — CORS arbitrary-origin rejection** | covered | `suite_pentest.go`, `suite_sanity.go` |
| **WhatsApp — webhook handshake verification** | covered | `suite_whatsapp.go` |
| **WhatsApp — full message envelope processing** | missing | requires real phone_number_id; not tested |
| **Currency formatting (frontend lib)** | covered | `currency.test.js` |
| **Subdomain routing** | missing — feature not yet built (Wave 16/17/T7.6) | — |
| **Drivers / delivery portal** | missing — feature not yet built (Wave 16/17/T7.6) | — |
| **Live order tracking** | missing — feature not yet built (Wave 16/17/T7.6) | — |
| **WhatsApp binding flow** | missing — feature not yet built (Wave 16/17/T7.6) | — |
| **Gift cards** | missing | handler exists (`handlers/giftcards`); no smoke test |
| **House accounts** | missing | handler exists (`handlers/houseaccounts`); no smoke test |
| **Bank accounts / payment credentials** | missing | handlers exist; no smoke tests |
| **Inventory** | missing | handler exists (`handlers/inventory`); no smoke test |
| **Payroll** | missing | handler exists (`handlers/payroll`); no smoke test |
| **Delivery zones** | missing | handler exists (`handlers/deliveryzones`); no smoke test |
| **Fiscal / receipt printing** | missing | handler exists (`handlers/fiscal`); no smoke test |
| **Tables (dine-in layout)** | missing | handler exists (`handlers/tables`); no smoke test |
| **Tip pools** | missing | handler exists (`handlers/tippools`); no smoke test |
| **AI menu (aimenu handler)** | missing | only guarded by 401 in pentest; no functional test |

---

## Coverage Gap Summary

The biggest gaps, ranked by risk:

1. **Modifier groups / modifiers** — the Wave 11 schema consolidation replaced `item_variations` with `modifier_groups`/`modifiers`, but neither the HTTP smoke runner nor the e2e tests exercise this surface. Any regression in modifier CRUD or POS modifier resolution is invisible to CI.

2. **Background job runners** — `jobs/auditretention`, `jobs/kdsfanout`, `jobs/payouts`, and `jobs/recipecost` all have store-level logic and runner files that are modified on this branch (see git status) but have zero dedicated tests. The KDS fanout is indirectly exercised via the HTTP smoke, but the job runner path (cron-triggered bulk fanout) is untested.

3. **Comp (item-level void)** — the `/{order_id}/items/{item_id}/comp` endpoint exists in `handlers/adjustments` and is referenced in the test runner's flag description, but no suite calls it. Only order-level void is covered.

4. **Paystack / Stripe gateway calls** — the `--payment-gateways` flag exists in the test runner but is never run in CI. Card payments, refunds, and transfer webhooks are entirely absent from the automated pipeline.

5. **New handler surfaces with no tests** — gift cards, house accounts, bank accounts, payment credentials, inventory, payroll, delivery zones, fiscal, tables, and tip pools each have handler directories that are never exercised by any test suite. These represent the widest untested surface area.

6. **Actor-overlay / staff PIN gate** — `suite_adjustments.go` acknowledges that the capability gate fires a 403 in test tokens (actor overlay absent), and marks this as "expected." The actual PIN verification + actor-overlay JWT construction path is not exercised end-to-end.

7. **Frontend beyond POS workspace** — only three Vitest tests exist. The auth flow, onboarding steps, menu editor, KDS UI, cash drawer UI, and reporting pages have no frontend-level tests.
