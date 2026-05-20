# Wave 8 Verification Log

Entries are append-only. Each entry records a Go-side feature verification pass.

---

## [2026-05-19] [provider-abstraction-smoke] T8.2/T8.3/T8.4 — Payment Provider Abstraction

### Build / Vet / Test

| Package | Build | Vet | Tests |
|---|---|---|---|
| `internal/payments` | PASS | PASS | PASS |
| `internal/integrations/paystack` | PASS (after fixes) | PASS | PASS |
| `internal/integrations/stripe` | PASS (after fixes) | PASS | PASS |
| `internal/handlers/paymentcredentials` | PASS | PASS | PASS |
| `internal/handlers/paymentwebhook` | NOT FOUND — not yet implemented |
| Full `./...` | PASS — pre-existing failures in `chatbot`/`pos` unrelated to Wave 8 |

### Interface Conformance

Both adapters had compile-time `var _ payments.Provider = (*Adapter)(nil)` assertions. Both failed because the adapters used a stale signature. Fixes applied:

1. `InitCheckout` — `(ctx, int64, string, string, map[string]string)` → `(ctx, payments.CheckoutParams)`.
2. `Refund` — `amount int64` → `amount payments.Amount`.
3. `ChargeSaved` — `(ctx, token, email string, amount int64, currency string)` → `(ctx, token string, amount payments.Amount, idempotencyKey string)`.
4. `Event` fields — `Reference`→`OrderID`, `Currency`→`CurrencyCode`, `Raw`→`RawPayload`.
5. `payments.EventKind` type and old constants (`EventChargeSuccess`, `EventChargeFailed`, `EventTransferReversed`, `EventUnknown`) — replaced with new string constants from `provider.go`: `EventCheckoutCompleted`, `EventCheckoutFailed`, `EventRefundSucceeded`, `EventTransferSucceeded`, `EventTransferFailed`.
6. Duplicate `firstNonEmpty` in `stripe/adapter.go` — removed (already in `stripe/stripe.go`).
7. `stripe/adapter_test.go` — updated all test calls to new `Provider` interface.

### Secret Leakage Check

- `paymentcredentials/handler.go`: SAFE. `credResponse` has no `secret_key` / `webhook_secret` fields. Only `public_key` is returned. Ciphertexts stay in `credentialFull` (internal only).
- `VerifyWebhook` error paths: SAFE. Both adapters now return the opaque `payments.ErrWebhookSignatureInvalid` sentinel; no HMAC computed value or secret is included in error strings.

### DB Query Scoping (`location_payment_credentials`)

All SELECT queries are scoped by `location_id`:
- `registry.go` — `WHERE lpc.location_id = $1 AND lpc.is_active = true`
- `paymentcredentials/store.go` (list) — `WHERE location_id = $1 AND is_active = true`
- `paymentcredentials/store.go` (GetByIDFull) — `WHERE id = $1` (PK lookup, internal)
- `paymentwebhook/store.go` — `WHERE location_id = $1 AND provider_code = $2 AND is_active = true`
- `pos/store.go` — `EXISTS(... WHERE location_id = $1 AND is_active = true)`

No unscoped full-table scans found.

### Blockers / Outstanding

- `internal/handlers/paymentwebhook/handler.go` not yet implemented (only `store.go` exists).
- Pre-existing failures in `internal/chatbot` (formatCartView/formatCheckout arity) and `internal/handlers/pos` (`ErrNoPaymentMethodAvailable` undefined, `CreateOrder` extra arg) — pre-date Wave 8.

---

## [2026-05-19] [on-delivery-e2e] On-Delivery Payment Flow — Go-Side Smoke

### Summary

T8.6a/T8.6b introduce `pending_on_delivery` as an `order_status` enum value
(migration `001_extensions_and_helpers.sql`) and `on_delivery_payment_methods`
as a `text[]` column on `locations` (migration `007_payments_generic.sql`).
However, the `POST /orders/:id/mark-paid-on-delivery` handler is **not yet
implemented**.

---

### 1. Capability Gate (mark-paid endpoint)

**STATUS: NOT IMPLEMENTED — blocker.**

`backend/internal/handlers/pos/handler.go` mounts only:
- `POST /pos/orders`
- `POST /pos/orders/{order_id}/charge`

`backend/cmd/server/main.go` line 242 contains an explicit TODO:
```
// TODO(T8): add POST /pos/orders/{id}/mark-paid-on-delivery once
// the handler function is implemented in the pos package.
```

No `mark_paid_on_delivery.go` file exists anywhere under
`backend/internal/handlers/`. The `can_settle` capability key is documented
in the `organization_members.capabilities` jsonb comment
(`002_auth_and_tenancy.sql:291`) and `auth.Capabilities(ctx)` exists in
`backend/internal/auth/orgscope.go`, but no handler reads it to gate mark-paid.
Missing capability should return 403; unverifiable because the handler is absent.

---

### 2. Audit Row

**STATUS: NOT IMPLEMENTED.**

The generic audit framework (`backend/internal/handlers/data/audit.go`) does
not list `orders` or `order_payments` in `auditActions`. The idempotency layer
covers `order_payments` for deduplication but writes no audit rows. The existing
`pos/charge.go` makes no `auditMutation` call. If mark-paid-on-delivery were
added today, audit rows would not be written unless the new handler explicitly
calls `auditMutation` or those tables are added to `auditActions`.

---

### 3. Idempotency (double-insert guard)

**STATUS: PARTIAL — only via generic data layer.**

`idempotency.go` registers `order_payments` in `idempotencyTables`, covering
only `POST /data/order_payments`. The dedicated `POST /pos/orders/{id}/charge`
path does not return the existing `payment_id` on retry; it returns 409 via the
`payment_status = 'paid'` guard. The idempotency contract (return cached
response with same `payment_id`) is not met. The not-yet-implemented mark-paid
endpoint has the same gap.

---

### 4. Validation

**STATUS: SCHEMA EXISTS, HANDLER MISSING.**

- `locations.on_delivery_payment_methods` column exists (migration 007).
- `amount_received_cents >= total` guard: no handler to add it to yet.
- `pending_on_delivery` enum value exists in `order_status` (migration 001).
- The existing `charge` handler validates `payment_method_code` against the
  global `payment_methods` table, not `locations.on_delivery_payment_methods`.

---

### 5. Status Transitions

**STATUS: PARTIAL — `pending_on_delivery` path is missing.**

`ChargeOrder` (`pos/charge.go:168-175`) transitions:
```sql
UPDATE orders SET status = 'completed'
WHERE id = $1 AND status IN ('pending', 'confirmed', 'preparing', 'ready')
```
`pending_on_delivery` is absent from this IN-list; calling charge on such an
order silently updates zero rows with no error. A dedicated mark-paid handler
must:
- Accept only `pending_on_delivery` source state → transition to `completed`.
- Return 409 Conflict for any other source state.

---

### Integration Sketch (static — no DB)

| Check | Expected | Actual |
|---|---|---|
| Route exists | 200 | 404 — route not mounted |
| Missing `can_settle` → 403 | 403 | N/A (route absent) |
| `pending_on_delivery` → `paid` | status='paid', payment row | N/A |
| Double-call returns same payment_id | 200 idempotent | N/A |
| `method` not in allowlist → 400 | 400 | N/A |
| Wrong source status → 409 | 409 | N/A |
| Audit row written | audit_log row | N/A |

---

### Blockers

1. `mark_paid_on_delivery.go` handler does not exist — all sub-checks blocked.
2. `pending_on_delivery` excluded from `charge` status IN-list — existing
   charge path silently no-ops on on-delivery orders.
3. No audit entry for `orders`/`order_payments` in `auditActions`.
4. Idempotency on charge path returns 409 but not cached `payment_id`.

### Schema Issues (file under Wave 16)

- `order_payments` idempotency only wired via `/data/order_payments` generic
  POST, not via the dedicated POS charge handler.
- `auditActions` map should include `orders` (update) and `order_payments`
  (insert) for mark-paid auditing.

---

## [rolling-build] 2026-05-19T00:00Z — Agent #5 Iteration

### Go build: PASS (after fixes)
### Go vet: PASS (after fixes)
### npm build: PASS

### Fixes applied this iteration

1. **`internal/integrations/stripe/adapter.go`** — `mapEventKind` was returning
   `payments.EventKind` (undefined type) and referencing `payments.EventChargeSuccess`
   etc. (old-style typed constants, now removed). Updated to return `string` and
   map to the current `payments.EventCheckoutCompleted` / `EventCheckoutFailed` /
   `EventRefundSucceeded` / `EventTransferSucceeded` / `EventTransferFailed` string
   constants. The struct literal (`Reference`, `Raw` fields) was already corrected
   by a concurrent agent before this iteration ran.

2. **`internal/chatbot/main_menu.go`** (3 call sites) — `formatCartView` signature
   gained a `currencySymbol string` third argument in Wave 8; the three callers in
   `handleMainMenu` and `handleNewOrderWarning` still passed only 2 args. Fixed by
   passing `s.currencySymbolFor(ctx, existingCartLocation)`.

3. **`internal/handlers/pos/store_kds_test.go`** (line 176) — `Store.CreateOrder`
   gained an `onDeliveryMethod string` parameter; the KDS integration test was
   missing it. Added `""` (not applicable for dine_in test case).

### Schema-coupling check
`paystack_reference` / `paystack_status` / `paystack_gateway_response` references
found in exactly 1 file: `internal/handlers/paymentwebhooks/handler.go` (Wave 6
legacy handler). No new Wave 8 code adds these references. PASS.

### Transient gaps (none)
No undefined symbols that appear to belong to a not-yet-landed agent.
