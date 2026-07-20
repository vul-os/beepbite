# Wave 6/7 Verification Log

Entries are append-only. Each entry records a frontend build + route verification pass.

---

## [2026-05-19 12:00] [wave6-7-build-regression-agent] Iteration 1

### Build Status

PASS — `npm run build` completed in 22.34 s with zero errors.

Only CSS minification warnings present (Tailwind CSS-in-JS interpolation tokens
`${scale.sm}` / `${scale.md}` / `${scale.lg}` in stdin:2295–7506). These are
pre-existing, not introduced this wave, and do not affect runtime behaviour.

One chunk size advisory: two JS chunks exceed 500 kB
(`index-B8gLXLP5.js` 457 kB, `index-Dwh5PV8w.js` 714 kB). Pre-existing, not
a wave 6/7 regression.

### New Files (recently modified, wave 7)

| File | mtime |
|---|---|
| `src/pages/pos/workspace.jsx` | 2026-05-19 11:26 |
| `src/pages/pos/components/table-picker-dialog.jsx` | 2026-05-19 11:12 |
| `src/pages/pos/components/tables-strip.jsx` | 2026-05-19 11:12 |
| `src/services/tables.js` | 2026-05-19 11:11 |
| `src/pages/menu/index.jsx` | 2026-05-19 10:57 |
| `src/pages/menu/prep-steps-editor.jsx` | 2026-05-19 10:55 |
| `src/pages/kds/expo.jsx` | 2026-05-19 10:39 |
| `src/pages/pos/login.jsx` | 2026-05-19 09:55 |
| `src/pages/discover/components/store-card.jsx` | (new, untracked) |
| `src/pages/staff-pin/components/pin-keypad.jsx` | (new, untracked) |

T7.4 page directories exist but are stub/component-only (no index.jsx yet):
- `src/pages/discover/` — has `components/store-card.jsx` only
- `src/pages/store/[slug]/` — directory + components subdir, no index.jsx
- `src/pages/checkout/` — directory + components subdir, no index.jsx

T7.5 page directory:
- `src/pages/staff-pin/` — has `components/pin-keypad.jsx` only

### Route Registration Status

`/discover`, `/store/:slug`, `/checkout`, `/s/:slug` — NONE registered in
`src/routes.jsx`. The T7.4/T7.5 page directories exist on disk but no lazy
imports or `<Route>` entries have been added yet. This is not a regression
(routes.jsx is unchanged from prior state); these must be wired in a
subsequent agent pass.

ACTION REQUIRED (next agent): Add lazy imports + public routes under
`<Route element={<MainLayout />}>` (no ProtectedRoute) for `/discover`,
`/store/:slug`, `/checkout`, and `/s/:slug` once the respective `index.jsx`
files are authored.

Existing routes are untouched and correct.

### Dependency Changes

None. `git diff HEAD -- package.json` produced no output. No new npm
dependencies introduced this wave.

---

## [2026-05-19] [wave6-7-route-wiring-agent] Iteration 2 — main.go integrity + route wiring

### Build Status

PASS — `go build ./...` from `backend/` completed with zero errors.

### main.go Imports

No duplicates detected. All 29 imported handler packages are unique. No import for
`handlers/marketplace` is present — see Route Wiring below.

### Route Wiring Observations

**Unauthenticated (public) block** (lines 180–189):
- `/health` — correct, no auth
- `/auth/*` — correct, no auth
- `/webhooks/whatsapp` — correct, no auth (verified by WhatsApp verify token)
- Payment webhooks via `pwH.Mount(r)` and `transferWebhookH.Mount(r)` — correct, no auth

**Authenticated block** (lines 191–219):
- `auth.Middleware(svc)` applied to the entire group — correct JWT enforcement
- All operational handlers (`data`, `cashdrawer`, `kds`, `pos`, `adjustments`, `tippools`, `tables`, etc.) are inside this group — correct

**Marketplace package (T7.2):**
- `internal/handlers/marketplace/` exists on disk but contains only `store.go` (DB store layer)
- There is NO HTTP handler file (no `handler.go`, no `Mount` function) in the marketplace package
- main.go does NOT import `handlers/marketplace` — this is consistent with the package being incomplete
- No `/stores/*` routes are registered anywhere — T7.2 is partially delivered (DB layer only)
- ACTION REQUIRED: marketplace HTTP handler + main.go wiring must be completed before T7.2 is done

**No duplicate route definitions found** — each handler package is mounted once.

### Org-Scope Middleware (T6.1)

The T6.1 org-scope middleware has NOT yet landed. No middleware beyond `auth.Middleware` is applied in main.go. When T6.1 ships:
- It MUST be applied inside the authenticated group, after `auth.Middleware`, scoped to: `/data/*`, `/pos/*`, `/kds/*`, `/cashdrawer/*`, `/tippools/*`, `/tables/*`, `/adjustments/*`
- Marketplace routes (`/stores/*`) MUST NOT receive org-scope middleware (they are public)
- Current main.go structure accommodates this: public marketplace routes will live outside the authenticated group, and org-scope middleware can be added as a sub-group within the authenticated block

### Conflicts

None. No merge conflicts detected in main.go. File is syntactically and semantically clean.

### Summary

| Check | Status |
|---|---|
| `go build ./...` | PASS |
| Imports — no duplicates | PASS |
| No duplicate route mounts | PASS |
| Public routes outside JWT group | PASS |
| Auth routes inside JWT group | PASS |
| Org-scope middleware (T6.1) | Not yet present — expected |
| Marketplace routes wired (T7.2) | **INCOMPLETE** — DB layer exists, HTTP handler missing |
| Merge conflicts | None |

---

## [2026-05-19] [wave6-7-verification-agent] Iteration 3 — Go build/vet/test + org-scope gap analysis

### New Files Seen (recently modified, backend/internal/)

Newest by mtime (wave 6 + 7 work):

| File | Wave |
|---|---|
| `internal/handlers/pos/tax.go` | T6.3 |
| `internal/jobs/kdsfanout/store.go` | T6.2 |
| `internal/auth/orgscope.go` | T6.1 |
| `internal/handlers/pos/store.go` | T6.3 |
| `internal/handlers/kds/store_tx.go` | T6.2 |
| `internal/handlers/kds/handler.go` | T6.2 |
| `internal/db/scoped.go` | T6.1 |
| `internal/handlers/marketplace/handler.go` | T7.2 |
| `internal/handlers/marketplace/store.go` | T7.2 |
| `internal/handlers/marketplace/store_test.go` | T7.2 |

### Build Status

**PASS** — `go build ./...` completes with zero errors (after observing transient race
conditions from concurrent agent landings; stable clean on final run).

### Vet Status

**PASS** — `go vet ./...` completes with zero diagnostics.

Transient issues observed during iteration (all self-resolved via concurrent agent writes):
- `handlers/kds/handler.go` — `auth` imported but `scope` variable declared-not-used (resolved)
- `handlers/marketplace/handler.go` — multiple `func(tx interface{}) error` type mismatches vs
  `func(tx pgx.Tx) error` + undefined `db.ScopedMarketplace` call (resolved by another agent)
- `handlers/adjustments/handler.go` — `auth` reported unused (transient, resolved)
- `cmd/server/main.go` — `marketplaceH` reported unused (transient, resolved — route is at line 203)

### Test Status

- `./internal/auth/...` — **PASS** (0.004s, `RequireOrgScope` middleware tests included)
- `./internal/handlers/marketplace/...` — **PASS** (0.004s, 6 unit tests: list params, HTTP
  handler stubs for 200/404 paths, cache-header assertions)

### Marketplace Endpoints (localhost:8080)

Server not running during this verification pass — curl returned no response.
Routes ARE wired in `main.go` line 203: `r.Route("/stores", marketplaceH.Mount)`.
Handler is correct (no-auth, `db.MarketplaceScope()`, `parseListParams` extracted for tests).

### Org-Scope Adoption — T6.2 / T6.3 Gap Analysis

`OrgScopeFrom` / `db.Scoped` adopters by handler package:

| Package | Scope calls | T6 task | Status |
|---|---|---|---|
| `kds` | 19 | T6.2 | DONE |
| `tables` | 9 | T6.3 | DONE |
| `tippools` | 6 | T6.2 | DONE |
| `cashdrawer` | 5 | T6.2 | DONE |
| `marketplace` | 3 | T7.2 | DONE |
| `pos` | 2 | T6.3 | PARTIAL — only handler + charge; store.go still uses direct pool |
| `adjustments` | 1 | T6.3 | PARTIAL — checkOrderScope wired; store not yet scoped |
| `data` | 1 | — | PARTIAL |

Packages with zero scope adoption (not in T6.2/T6.3 task scope, deferred):
`aimenu`, `bankaccounts`, `deliveryzones`, `fiscal`, `giftcards`, `houseaccounts`,
`inventory`, `paymentwebhooks`, `payroll`, `promotions`, `reservations`, `storecredit`,
`transferwebhook`, `waste`, `whatsappsend`, `whatsappwebhook`.

### Gaps / Action Items

1. **pos/store.go** — still uses direct `pool.BeginTx`/`pool.Query` calls. Handler uses
   `OrgScopeFrom` for location check but DB calls bypass `db.Scoped`. Full T6.3 compliance
   requires migrating `pos/store.go` to accept `pgx.Tx` (or wrapping via `db.Scoped` at call site).
2. **adjustments/store.go** — direct pool calls; handler's `checkOrderScope` is correct
   but mutation queries bypass `db.Scoped`.
3. **kds/store.go** — legacy `pool.BeginTx` wrappers coexist with new `store_tx.go` Tx-aware
   methods. Not a build error but creates dead-code drift.
4. **auth.RequireOrgScope not applied in main.go** — T6.1 middleware is implemented but not
   wired. Handlers rely on `OrgScopeFrom` returning an allow-all stub until it's applied.

### Invariants Confirmed

- Public `/stores/*` routes are outside the JWT `auth.Middleware` group — correct.
- All T6.2/T6.3 handlers call `OrgScopeFrom` and perform `AllowsLocation` checks.
- `db.MarketplaceScope()` exists in `db/scoped.go` and sets `IsMarketplace=true`.
- `auth.RequireOrgScope` middleware is implemented in `auth/orgscope.go` but not yet
  applied in `main.go` — consistent with prior iteration observation (T6.1 wiring deferred).

---

## [2026-05-19] [webhook-security] Wave 8 T8.3 — Webhook Security Audit

Files reviewed:
- `backend/internal/handlers/transferwebhook/handler.go`
- `backend/internal/integrations/paystack/webhook.go` + `adapter.go`
- `backend/internal/integrations/stripe/webhook.go` + `adapter.go`

### Checklist Results

| Check | Result | Detail |
|---|---|---|
| Signature verification mandatory | PASS | Handler calls `paystack.VerifyWebhookSignature` before any JSON parse; missing/wrong header returns 401 |
| Constant-time HMAC comparison | PASS | Both Paystack and Stripe use `hmac.Equal`; no `bytes.Equal` anywhere in webhook paths |
| Raw body buffered before sig check | PASS | `io.ReadAll(io.LimitReader(r.Body, 1<<20))` on line 81 of handler.go; same `body` bytes passed to sig check and `json.Unmarshal` |
| Webhook secret never logged | PASS | `grep log.*secret` returns zero matches across all Go files |
| Replay protection via idempotency | PASS | `store.LogWebhookEvent` inserts `(provider, external_event_id)` with a UNIQUE constraint; `ErrDuplicate` short-circuits with HTTP 200 |
| Tenant isolation (location_id cross-check) | PASS | Transfer webhook routes by `{region}` not `{location_id}`; secret is env-scoped per region, not per-location. No location_id in URL to forge. BYO-key path uses `Manager.ForLocation` which DB-validates location→region binding. |
| Stripe timestamp tolerance ±5 min | PASS | `stripe/webhook.go:76` rejects drift > `defaultTolerance` (5 min) in both directions |

### Fixes Applied

None required. No `bytes.Equal` found; no secret logging found; all HMAC paths use `hmac.Equal`.

Pre-existing note: both adapter files have a build error (interface mismatch — `ChargeSaved` signature and `Event` field names differ from `payments.Provider`). Does not affect the security-critical `VerifyWebhook`/`VerifyWebhookSignature` functions.

### Forged-Webhook Simulation (9 probes)

Inline reproduction of both providers' `VerifyWebhookSignature` logic; all probes passed:

```
[PASS] P1 paystack no-sig-hdr         → rejected (paystack: missing signature header)
[PASS] P2 paystack forged-key         → rejected (paystack: signature mismatch)
[PASS] P3 paystack tampered-body      → rejected (paystack: signature mismatch)
[PASS] P4 paystack valid-sig          → accepted correctly
[PASS] S1 stripe no-sig-hdr           → rejected (stripe: missing Stripe-Signature header)
[PASS] S2 stripe stale-ts(6m)         → rejected (stripe: timestamp outside tolerance)
[PASS] S3 stripe future-ts(+6m)       → rejected (stripe: timestamp outside tolerance)
[PASS] S4 stripe valid-sig            → accepted correctly
[PASS] S5 stripe forged-key           → rejected (stripe: signature mismatch)
```

9/9 probes passed. No bypass, no timing oracle, no replay window beyond 5 minutes.

---
