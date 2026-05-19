# BeepBite Implementation Tasks

Derived from `ROADMAP.md`. Tier-1 / Tier-2 unchecked items grouped into independent, parallel-safe work units.

---

## Required environment variables

Set these in your shell or `.env` before running `go run ./cmd/server --env=local`.
Region codes are upper-case (e.g. `ZA`). Add more by repeating the block with a different region code.

### Core
| Variable | Purpose |
|---|---|
| `APP_ENV` | `local` / `dev` / `main` |
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | HS256 secret for email + staff JWT (audience claim disambiguates) |
| `CORS_ORIGINS` | Comma-separated frontend origins; first one is used for Paystack callbacks |
| `POST_AUTH_REDIRECT` | Where to send users after Google OAuth |

### Google OAuth
| Variable | Purpose |
|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client id |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URL` | OAuth callback URL |

### Payments — Paystack (per region, e.g. `ZA`)
| Variable | Purpose |
|---|---|
| `PAYSTACK_ZA_SECRET_KEY` | Live secret key for ZA |
| `PAYSTACK_ZA_PUBLIC_KEY` | Live public key |
| `PAYSTACK_ZA_WEBHOOK_SECRET` | HMAC secret for webhook verification (falls back to secret key) |
| `PAYSTACK_ZA_TEST_MODE` | `true` / `false` |
| `PAYMENT_KEY_ENCRYPTION_SECRET` | AES-GCM key (32 bytes base64) used to encrypt bank account numbers |

### Payments — Stripe (per region, e.g. `US`)
| Variable | Purpose |
|---|---|
| `STRIPE_US_SECRET_KEY` | Stripe secret key |
| `STRIPE_US_PUBLIC_KEY` | Stripe publishable key |
| `STRIPE_US_WEBHOOK_SECRET` | Webhook signing secret |

### WhatsApp Cloud API
| Variable | Purpose |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API token |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number id from Meta dashboard |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Token you set in Meta webhook config |

### Email — Resend
| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM` | From-address used for transactional email |

### Maps + AI
| Variable | Purpose |
|---|---|
| `MAPBOX_TOKEN` | Mapbox public token for delivery distance/geocoding |
| `OPENAI_API_KEY` | OpenAI key used by `/ai/menu` AI-menu features |

> Action: the only secret currently missing from CI/dev shells is
> `PAYMENT_KEY_ENCRYPTION_SECRET`. Generate one with
> `openssl rand -base64 32` and add it before running the bank-account / payout
> features.

---

## Wave 1 — Backend handlers (sonnet, 10 parallel)

Each agent creates a brand-new package under `backend/internal/handlers/<name>/` (or `backend/internal/jobs/<name>/`) and **must not** edit `backend/cmd/server/main.go`. Wiring into the router is done by the orchestrator after the wave completes.

- [ ] **B1 — Tables / dine-in handlers**
  `internal/handlers/tables` — `POST /tables/{id}/open-session`, `POST /sessions/{id}/close`, `POST /sessions/{id}/transfer`, `POST /sessions/{id}/split-check`, seat CRUD. Backed by migration-16 tables (`tables`, `table_sessions`, `seats`, `check_splits`).
- [ ] **B2 — KDS bump/recall/re-fire + order-create fan-out**
  `internal/handlers/kds` — order-create hook fans `order_items` to `kds_tickets` per `item_station_routing`; `POST /kds/tickets/{id}/bump`, `/recall`, `/refire`, `/rush`; events written to `kds_ticket_events`. SSE stream for `GET /kds/stations/{id}/stream`.
- [ ] **B3 — Order adjustments handlers**
  `internal/handlers/adjustments` — `POST /orders/{id}/void`, `/comp`, `/price-override`. PIN-gated approval via `staff.pin_hash`. Writes `order_adjustments` + `audit_log`. Enforces `trg_order_adjustments_approval` precondition. Blocks double-void.
- [ ] **B4 — Gift card handlers**
  `internal/handlers/giftcards` — `POST /gift-cards/issue`, `/redeem`, `/reload`, `/refund`, `GET /gift-cards/lookup`. Balance enforcement in Go (cannot go negative). Append-only ledger writes to `gift_card_transactions`.
- [ ] **B5 — Store credit + loyalty handlers**
  `internal/handlers/storecredit` — `/grant`, `/redeem`, `/refund-to-credit`; loyalty earn-on-order + redeem-as-tender bounded by `loyalty_config.max_redemption_pct_of_order`; loyalty expiry job. Writes `store_credits` + `loyalty_transactions`.
- [ ] **B6 — House account handlers**
  `internal/handlers/houseaccounts` — assign order charge to a house account, generate monthly invoice (`house_account_invoices`), record payment against invoice, list outstanding balance.
- [ ] **B7 — Bank account setup + Paystack transfer recipient**
  `internal/handlers/bankaccounts` — `POST /bank-accounts` encrypts the account number via AES-GCM (`secretbox.New(PAYMENT_KEY_ENCRYPTION_SECRET)`), calls Paystack `POST /transferrecipient`, persists `provider_recipient_id`. `GET /bank-accounts`, `DELETE /bank-accounts/{id}` (soft-delete).
- [ ] **B8 — Per-payment fee capture + weekly payout job**
  `internal/jobs/payouts` — scheduled worker (started from `main.go` later) that scans paid `order_payments` since last payout respecting `payout_schedules.hold_period_hours`, creates `merchant_payouts`, calls Paystack `POST /transfer` with `provider_recipient_id`, stores `provider_transfer_id`, deducts tier payout fee. Also a hook helper that writes per-payment tier transaction fee on each successful payment (extend `payment_fees` schema or create a new attribution row).
- [ ] **B9 — Transfer webhook + payout reconciliation**
  `internal/handlers/transferwebhook` — receives Paystack `transfer.success` / `transfer.failed` / `transfer.reversed`, updates `merchant_payouts.provider_transfer_status` + `audit_log`. Plus a reconciliation cron that sweeps stale `initiated` payouts via Paystack `GET /transfer/:id`.
- [ ] **B10 — GRN-receive + 3-way match + auto-PO suggestions**
  `internal/handlers/inventory` — on `goods_receipt_items` INSERT, bump `inventory_items.current_stock` + `cost_per_unit` + write `ingredient_price_history` + `stock_movements`. 3-way variance detector (PO ↔ GRN ↔ supplier_invoice) flips `supplier_invoices.match_status`. Suggest auto-POs when `current_stock < minimum_stock` from preferred supplier.

---

## Wave 2 — DONE

All 10 UI pages landed and `npm run build` is clean. Routes wired in `src/routes.jsx`:

| Route | Module |
|---|---|
| `/pos/login` | `pages/pos/login` (BlankLayout, public) |
| `/floor` + `/floor/edit` | `pages/floor` + `pages/floor/edit` |
| `/kds/expo` + `/kds/:stationId` | `pages/kds/expo` + `pages/kds/station` (BlankLayout, full-screen) |
| `/dev/adjustments` | `pages/order-adjustments-demo` |
| `/cash` | `pages/cash` |
| `/gift-cards` | `pages/gift-cards` |
| `/menu/schedules` | `pages/menu/schedules` |
| `/settings/payouts` | `pages/settings/payouts` |
| `/settings/promotions` | `pages/settings/promotions` |
| `/reports` (existing) | rewired onto migration-22 views |

### Known UI/backend mismatches surfaced by the agents

- **Adjustments**: backend `order_adjustments.adjustment_type` CHECK doesn't allow `'refund'` — refund flow will 500 until migration adds it.
- **KDS SSE auth**: native `EventSource` can't set `Authorization` headers. `use-sse.js` tries cookie-based auth first then falls back to `?token=`. Backend may need a token query-param fallback.
- **KDS expo**: no bulk `/kds/expo?location_id=` endpoint — page fans out N calls. Consider adding.
- **Promotions**: UI sends `per_customer_limit` on coupon_codes; schema only has `usage_limit_per_customer` on promotions. Either drop the field or add the column.
- **Menu schedules**: `item_price_schedules.price` is decimal(10,2), not `price_cents`. UI sends decimal to match schema.
- **Floor live view**: `tables` table has no `current_session_id` column — live status overlay relies on `tables.status` only.
- **Cash drawer**: `cash_drawer_eod_report` view must be exposed in the generic data handler's allowed-tables list.
- **Bank accounts**: backend requires `bank_name` (not just `bank_code`); the wizard sends both.
- **Gift cards**: backend uses `card_type` not `kind`, `issued_to_customer_id` not `customer_id`, `current_balance_cents` not `balance_cents`, and issue response doesn't include the plaintext code (only masked). UI matches the actual fields.
- **Reports**: 5 chart surfaces flagged `// TODO: requires new view` (status pie, response-time table, response-time trend, orders-vs-response-time, KPI cards). Other views render real data.

---

## Wave 2 — Frontend (opus, UI only)

Dispatched after backend lands. Each agent edits one new page module + its routes; shared components added under `src/components/` only if reused.

- [ ] **U1 — POS staff login screen** (`/pos/login`) — username/password + PIN modes, calls `/auth/staff/login` and `/auth/staff/pin-login`.
- [ ] **U2 — Floor plan editor + live floor view** (`/floor`) — drag tables (`pos_x`/`pos_y`), tap-to-open-session, status colors.
- [ ] **U3 — KDS per-station + expo screens** (`/kds/:stationId`, `/kds/expo`) — SSE stream, bump button, color-by-age.
- [ ] **U4 — Order adjustment modal** — reason-code picker + manager PIN challenge, drops into existing order detail page.
- [ ] **U5 — Cash drawer open/close + movements UI** (`/cash`) — denominations grid, blind-close toggle, EOD report.
- [ ] **U6 — Bank account setup wizard + payout history** (`/settings/payouts`).
- [ ] **U7 — Promotions config UI** (`/settings/promotions`) — rule-type picker, scope picker, coupon code mgmt.
- [ ] **U8 — Menu scheduling UI** (`/menu/schedules`) — daypart windows + happy-hour pricing.
- [ ] **U9 — Gift card lookup + issue flow** (`/gift-cards`).
- [ ] **U10 — Analytics dashboard rewire** (`/reports`) onto migration-22 views (`daily_sales_summary`, `hourly_sales_heatmap`, `menu_engineering`, etc.) — replaces deleted `get_analytics_*` RPCs.

---

## Wave 1 — DONE

All 10 backend packages landed and `go build ./...` from `backend/` is clean.

- ✅ B1 Tables — `internal/handlers/tables/`
- ✅ B2 KDS — `internal/handlers/kds/` (incl. SSE broker)
- ✅ B3 Adjustments — `internal/handlers/adjustments/`
- ✅ B4 Gift cards — `internal/handlers/giftcards/`
- ✅ B5 Store credit + loyalty — `internal/handlers/storecredit/`
- ✅ B6 House accounts — `internal/handlers/houseaccounts/`
- ✅ B7 Bank accounts — `internal/handlers/bankaccounts/` + `paystack/transferrecipient.go`
- ✅ B8 Payout job + fee capture — `internal/jobs/payouts/` + migration `20240101000030_payment_fees.sql`
- ✅ B9 Transfer webhook + recon — `internal/handlers/transferwebhook/` + `paystack/get_transfer.go`
- ✅ B10 Inventory GRN + 3-way match — `internal/handlers/inventory/`

Wiring in `cmd/server/main.go`: imports added, handlers instantiated, routes mounted, payout runner + transfer reconciler started as goroutines.

## Known schema follow-ups (from agent reports)

- `order_adjustments.adjustment_type` CHECK constraint doesn't include `'refund'` — B3's refund endpoint will be rejected by Postgres until a follow-up migration adds it.
- `kds_ticket_events.event_type` uses `'re_fired'` (underscore), code matches.
- `stock_movements.movement_type` CHECK doesn't allow `'grn'` — B10 maps GRN receives to `'purchase'`.
- No `updated_at` triggers on migrations 16, 17, 25 — application sets `updated_at = now()` explicitly.
- B8 named its table `beepbite_payment_fees` (migration 30) to avoid colliding with the existing `payment_fees` table from migration 4.
- `customers.loyalty_points` column is referenced by B5 but is not in migration 25; verify it's added elsewhere.

---

## Wave 3 — DONE

All 10 packages landed. `go build ./...` + `npm run build` both clean.

Backend (wired into `main.go`):
- ✅ W1 Audit log wiring — new `internal/handlers/data/audit.go` + allowlist; 10 sensitive tables tracked; cashdrawer.close + bankaccounts.update audit-wired.
- ✅ W2 Idempotency middleware — `internal/idempotency/` ready; **NOT yet mounted into routes** (orchestrator follow-up below).
- ✅ W3 Tip pooling — migration 32, `internal/handlers/tippools/`.
- ✅ W4 Labor cost views — migration 33 (`labor_cost_daily`, `sales_per_labor_hour`).
- ✅ W5 Recipe cost runner — migration 35 + `internal/jobs/recipecost/`, started as goroutine.
- ✅ W6 Waste + prep batches — migration 34 + `internal/handlers/waste/`.
- ✅ W7 Payroll handlers — `internal/handlers/payroll/` (CRUD rates + CSV export).

Frontend (wired into `routes.jsx`):
- ✅ W8 `/house-accounts` + `/house-accounts/:id`
- ✅ W9 `/inventory/suppliers`, `/purchase-orders`, `/auto-suggestions`, `/grns`, `/invoice-match`
- ✅ W10 `/settings/billing`

## Wave 3 follow-ups — DONE in Wave 5

- ✅ Idempotency middleware mounted on `/data/orders` + `/data/order_payments` POST via new `dataH.MountWithIdempotency` (Wave 5 A1).
- ✅ `staff_time_entries` already exists with event-log schema (`entry_type`+`timestamp`); `labor_cost_daily` view returns shape-clean (Wave 5 A5).
- ✅ All 41 migrations re-applied from scratch via `go run ./cmd/migrate --env=local --reset` — clean.
- ✅ Supplier contacts write-through: form upserts primary contact row, edit prefills from `is_primary=true` (Wave 5 A6).

---

## Wave 4 — DONE

All 10 packages landed. Backend + frontend builds green.

| Task | Result |
|---|---|
| W4.1 KDS fan-out trigger + runner | Migration 36 + `internal/jobs/kdsfanout/` (5s ticker, queue table) |
| W4.2 Reviews rewire | `services/reviews.js` + `pages/reviews/index.jsx` rewired off deleted RPCs |
| W4.3 Manager dashboard | `/manager` page (4 cards + audit log) |
| W4.4 Staff management UI | `/staff/manage` (profile/pay/security/schedule tabs) |
| W4.5 Reservations + waitlist | Migration 37 + `internal/handlers/reservations/` + `/reservations` + `/waitlist` |
| W4.6 Delivery zones | Migration 41 + `internal/handlers/deliveryzones/` (Go ray-casting) + `/settings/delivery-zones` (textarea polygon editor — no Mapbox dep) |
| W4.7 WhatsApp chatbot verify | `go vet` clean; fixed `ordering.go:967,974` (used `newState` in `processPayment`) |
| W4.8 Fiscal receipt sequencing | Migration 40 + `internal/handlers/fiscal/` (FOR UPDATE gap-free sequencer) |
| W4.9 Multi-currency (additive) | Migration 38 (currencies table, default_currency_code, fx_rate_to_zar) |
| W4.10 PII log + audit retention | Migration 39 + `internal/jobs/auditretention/` (daily archival sweep) + `internal/piiaccess/` helper |

Wiring in `main.go`: new handlers mounted, fan-out + retention runners started.

## Wave 4 follow-ups — DONE in Wave 5

- ✅ Per-table idempotency hook landed in `internal/handlers/data/idempotency.go` — see Wave 3 follow-up above.
- ✅ `POST /staff/{id}/set-pin` — bcrypted pin in `staff.pin_hash`, manager/owner check via org_member JOIN.
- ✅ `POST /staff/{id}/manager-set-password` — bcrypted, forces `must_change_password=true`, clears lockouts.
- ✅ Migration `20240101000042_reviews_reply.sql` adds `reply` + `replied_at`; reviews page modal pre-populates + saves via `reviewsService.saveReviewReply`.
- ✅ Manager dashboard `/data/promotions` now uses `or=location_id.eq.<id>,location_id.is.null` (new `or` filter on data handler); "Org-wide" badge added to promotions card. Settings/promotions page has same bug, deferred.
- ✅ Leaflet + react-leaflet installed; delivery-zones polygon editor is interactive map with click-to-vertex, undo/clear buttons, and "Advanced — paste GeoJSON" fallback.

---

## Wave 5 — DONE

| Task | Result |
|---|---|
| Onboarding refactor | `handle_new_user` trigger → profile-only; org/location creation moved to `onboarding-popup.jsx` with `.select().single()` fix |
| A1 Idempotency wrapper | `data/idempotency.go` + `MountWithIdempotency`; wired in `main.go` |
| A2 Staff auth manager endpoints | `set-pin` + `manager-set-password`; `MountManagerRoutes` wired in `main.go`; `staff/manage` UI calls the real endpoints |
| A3 Reviews reply | Migration 42 + service + modal save flow |
| A4 Promotions filter | OR filter on data handler + manager dashboard scoping by org+location |
| A5 staff_time_entries | Already exists, no work needed |
| A6 Supplier contacts | Form write-through to `supplier_contacts` with primary contact prefill |
| A7 Leaflet delivery zones | Interactive polygon editor replaces textarea |

## Wave 5 follow-ups (not yet done)

- [ ] Apply the same promotions OR-filter fix to `src/pages/settings/promotions/hooks/use-promotions.js` (settings management view has the same bug — Agent A4 flagged but did not fix).
- [ ] Remove the dead `src/pages/auth/verify-email.jsx` page (no email verification step in custom Go backend; signUp issues a session immediately).

## Wave 5 — verification pass (7 sonnet test agents, 2026-05-18)

All Wave 5 work spot-checked end-to-end. Findings + fixes applied in this pass:

| Surface | Result |
|---|---|
| Idempotency middleware | Body buffering ✓, schema match ✓; dead `\|\| req.Method != POST` guard removed |
| Staffauth manager endpoints | Org-member JOIN safe ✓, SQL parameterised ✓, PIN/password validation correct |
| Reviews reply | Migration ✓, allowlist ✓, modal pre-fill ✓. Caveat: no UI path to *delete* a reply (Send disabled on empty) — product decision |
| Promotions OR-filter | Column allowlist + parameterised values = **critically safe** against SQLi |
| Supplier contacts | Empty-contact junk-row prevented (only upsert when `name` provided) |
| Leaflet polygon editor | Lossless GeoJSON round-trip; Cape Town fallback when location lacks lat/lng |
| Onboarding e2e | **Two critical fixes**: (1) tenancy — fetchOrganizations now IN-queries via organization_members (Go backend has no RLS so the old select-all returned every org in the DB); (2) `signup.jsx` no longer redirects to dead `/verify-email`. Sign-in → `/home` redirect verified. |


---

## Wave 3 — Backend hardening + missing UI (sonnet, 10 parallel)

Backend:
- [ ] **W1 — Audit log wiring** — write `audit_log` rows from existing handlers that touch sensitive state: item price edits, staff role/permission changes, menu schedule mutations, promotion config edits, cash drawer close (over/short), subscription plan rate edits, bank account update. Each handler gets a single audit-log insert in the same txn.
- [ ] **W2 — Idempotency-Key middleware** — `internal/idempotency/` middleware reading `Idempotency-Key` header, writing to `idempotency_keys` (migration 23). Wire into `/orders` + `/order_payments` create, Paystack charge webhook, transfer webhook, WhatsApp inbound.
- [ ] **W3 — Tip pooling** — migration 32 with `tip_pools` + `tip_distributions`, handler package `internal/handlers/tippools/` for CRUD + distribute.
- [ ] **W4 — Labor cost views** — migration 33 with `labor_cost_daily` (join `labor_hours_daily` × `staff_pay_rates`), `sales_per_labor_hour` view.
- [ ] **W5 — Recipe cost recompute** — `internal/jobs/recipecost/` job triggered after `ingredient_price_history` insert; recursive cost recompute via `item_recipes`.
- [ ] **W6 — Waste tracking + prep batches** — migration 34 adds `stock_movements.waste_reason`, `prep_batches`, `item_recipes.yield_pct`. Handler `internal/handlers/waste/`.
- [ ] **W7 — Staff pay rates CRUD + payroll export** — handler `internal/handlers/payroll/` for `staff_pay_rates` CRUD + CSV export by pay period.

UI:
- [ ] **W8 — House account admin UI** at `/house-accounts` (list, detail, monthly invoice generate, payment record).
- [ ] **W9 — Supplier / PO / GRN workflow UI** at `/inventory/suppliers`, `/inventory/purchase-orders`, `/inventory/grns`, `/inventory/invoice-match`.
- [ ] **W10 — Subscription plan picker + billing dashboard** at `/settings/billing`.

---

## Out of scope for now

- Reservations / waitlist (Tier 3 — schema not yet shipped)
- Customer segments / marketing campaigns (schema not yet shipped)
- Delivery zone polygons (schema not yet shipped)
- WhatsApp chatbot port finalization (`internal/chatbot/` exists, needs end-to-end test)
- Multi-currency, fiscal receipt sequencing, PII access log (Tier 4 — defer)
