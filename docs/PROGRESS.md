# BeepBite — Wave Progress Tracker

Hand-maintained checklist. Update status markers when a wave is complete or in-progress.
Format: `- [x] Wave N` = DONE, `- [~] Wave N` = IN-PROGRESS, `- [ ] Wave N` = not started.

---

## Completed Waves ✅

- [x] **Wave 0** — Schema consolidation + Row-Level Security
  - Consolidated all legacy migrations into 19 numbered SQL files (`001`–`019`)
  - RLS policies applied across all tenant-scoped tables
  - Sub-items (onboarding RLS hotfix, migrations 016–019):
    - `016_rls_bootstrap_fixes.sql` — RLS bootstrap edge-case fixes
    - `017_trigger_elevate_to_service_role.sql` — service-role elevation trigger
    - `018_org_created_by_returning_fix.sql` — RETURNING clause fix for org creation
    - `019_owner_default_capabilities.sql` — owner capability defaults
- [x] **Wave 6** — Safety: tenant isolation, audit attribution, KDS resilience
  - Tenant isolation enforced via RLS on all tables
  - Audit attribution wired to staff actor overlay
  - KDS resilience improvements shipped
- [~] **Wave 7** — Marketplace foundations (MOSTLY done — see verification 2026-05-21)
  - Marketplace handler + routes scaffolded (T7.2 ✓), discover/store pages live (T7.4 ✓)
  - Chatbot slug search + Mapbox (T7.3 ✓), `/s/:slug` PIN keypad (T7.5 ✓)
  - **T7.6 wildcard subdomain routing — NOT done** (backend middleware, frontend StoreContext, deploy doc all absent)
  - `lookup_location_by_slug()` was missing — added in migration 021 (foundation patch)
- [x] **Wave 8** — Generic multi-provider payments + BYO keys + on-delivery
  - Paystack integration with BYO API keys
  - On-delivery payment option
  - Webhook handler for transfer events
- [x] **Wave 9** — Staff PIN actor-overlay + capability flags
  - Staff PIN auth flow (`staffauth` package: handlers, service, store)
  - Capability flags schema + enforcement middleware
- [x] **Wave 18** — Pricing model exploration
  - Billing model doc + pricing directory added
  - Tiered plan structure defined

---

## Verification + Foundation Patch — 2026-05-21

Multi-agent verification pass against the "done" waves. Result: core POS/KDS/cash/auth/onboarding flows confirmed working (live e2e: **191/191 checks pass**). Found and fixed runtime-breaking defects in the marketplace/payments edges via **migration 021 (`021_foundation_patch.sql`)** + handler fixes:
- ✅ Marketplace checkout rewritten to use the real consolidated `orders`/`order_items` tables (was inserting into dropped `order_details`/`order_financial_details` → would 500 on every public checkout).
- ✅ Created missing SQL `get_location_payment_provider()` (payment platform-fallback was a dead letter) and `lookup_location_by_slug()`.
- ✅ Restored `recipe_breakdown` view (existed only in `legacy/`).
- ✅ Data handler now auto-injects `organization_id` from session scope on inserts; rejects semicolons in filter query strings (injection-guard bypass closed).
- ✅ Per-store `currency_code` now set on marketplace orders (T8.5 gap closed).
- ✅ Stale `suite_orders.go` updated to consolidated schema.

**Known-still-open after patch:** Wave 7 T7.6 (wildcard subdomain — whole feature absent); Wave 11 schema gaps below.

### Round 2 — dynamic test build-out + deeper fixes (same day)
Built out Wave 14 testing infra and, by actually *running* the new suites, found bugs static review missed:
- ✅ **Wave 9 staffauth was broken under RLS.** Every `staffauth` Store query (login, pin-login, pin-verify, refresh, lockout, manager set-PIN/password) ran on a non-scoped connection, so under FORCE RLS it saw zero rows → staff auth was non-functional. Fixed: all `staffauth` Store methods now run via `db.Scoped(..., db.ServiceRoleScope(), ...)` (the explicit WHERE / credential checks remain the authorization boundary). Verified: actor-overlay + staff suites green.
- ✅ **`MarkPaidOnDelivery` dropped-table bug** (`UPDATE order_financial_details`) — fixed to update `orders` only.
- ✅ **Audit rows were invisible to tenants.** 5 of 9 `audit_log` writers (`adjustments`, `data/audit.go`, `cashdrawer`, `pos/mark_paid_on_delivery`, `staffauth/pin_verify`) omitted `organization_id`, so the SELECT policy (`organization_id = current_org_id() OR is_service_role()`) hid them from the owning tenant. Fixed all 5; new audit rows carry `organization_id`. (Wave 6 attribution sets `actor_id` correctly — that part worked.)
- ✅ **Wave 14**: CI extended to actually run `go test ./...` + smoke suites (was build/vet only); added `suite_staff`/`suite_audit`/`suite_actor_overlay`, `e2e_marketplace`/`e2e_on_delivery_payment`, `docs/test-coverage-matrix.md`.

**Live e2e after round 2: 253/253 pass.** Frontend Vitest: 18/18.

**Still open:** Wave 7 T7.6 subdomain (absent); Wave 11 schema gaps (below); historical audit_log rows pre-fix remain NULL org (no backfill); Wave 14 tasks blocked by unbuilt features (subdomain/drivers/WhatsApp binding).

---

### Round 3 — POS payment fix, owner dashboard, Wave 11 completion (2026-05-21)
- ✅ **POS payment bug fixed.** In-store POS (dine_in/takeaway) was incorrectly gated on having an online credential or on-delivery method → 422 "no payment method available". Now only DELIVERY orders are gated; in-store settles cash at the till. Verified: dine_in→201, delivery (no method)→422.
- ✅ **Owner stats dashboard.** New `internal/handlers/stats/` (`GET /stats/summary?period=day|week|month|year`, `GET /stats/heatmap?weeks=`) wired into the org-scoped group. `/home` rebuilt: removed the redundant embedded POS, kept the live-orders list, added period filter + KPI cards (gross/orders/AOV/new customers w/ deltas) + sales-trend chart (recharts) + a 7×24 busy-days/hours heatmap. `seeddemo` enriched to ~1,200 orders/year with realistic day/hour weighting. Verified against seeded data.
- ✅ **Wave 11 completed** (migration 022): `order_item_modifiers` table, `order_items.course_id` FK, KDS course-fire trigger. POS CreateOrder now persists modifier selections (price-snapshotted into totals) + course assignment; Quick POS migrated off legacy `item_variations` to `modifier_groups`. Verified end-to-end (modifier price in total + DB rows). Caveat: course-fire trigger relies on `course_number`↔`courses.sort_order` alignment (kds_tickets has no `course_id` FK yet — flagged for a follow-up).

**Live e2e: 253/253. Frontend Vitest: 18/18.**

### Round 4 — orders-to-kitchen fix, dashboard real data, Wave 16 drivers (2026-05-21)
- ✅ **Orders now reach the kitchen.** Root cause: KDS fanout only queried `item_station_routing`, but seeded/real data routes via `category_station_routing` → 0 tickets (`kds_ticket_ids: null`). Fixed with a 3-layer routing fallback (item → category → location's default station) across all 3 fanout paths (`pos/store.go`, `kds/store.go`, `kds/store_tx.go`); seeder now also writes `item_station_routing`. POS fanout is now synchronous inside the order tx. Verified: order → `kds_ticket_ids: [..]`. (Also fixed a placeholder/arg-count bug + an un-elevated `kds_fanout_queue` enqueue introduced during the fix.)
- ✅ **Dashboard shows real data.** `/home` gated on `activeLocation` (null after login → showed onboarding instead of data); now falls back to the org's first location + a loading guard. No mock data.
- ✅ **Wave 16 — Drivers/delivery/live-tracking** (migration 023 adds `orders.delivery_address_id`): new `internal/handlers/driver` (assignments accept/pickup/deliver/cancel, shifts online/offline, location pings — all `can_drive`-gated, cross-org), `internal/handlers/tracking` (`GET /track/:token`, public, privacy-gated via `pings_visible_to_customer`), `internal/handlers/driverinvite` (invite driver by email + `AcceptMatchingInvites` hook). Frontend: `/driver` portal (assignments, online toggle, geolocation ping loop), `/track/:token` (Leaflet live map + status stepper), store-page delivery/collection selector. Endpoints smoke-verified (invite 201, assignments 403 without can_drive, track 404 on bad token).

**Live e2e: 253/253.**

**Remaining wires/gaps (small):** (1) `driverinvite.AcceptMatchingInvites(ctx,pool,profileID,email)` is built but NOT yet called from the signup flow — a driver's invite won't auto-accept on signup until that hook is added to the auth signup handler. (2) `GET /stores/:slug` doesn't yet expose `offers_delivery`/`offers_collection` (store page defaults to showing both). (3) `organization_invites` has no `capabilities` column — driverinvite stamps `can_drive` at accept time instead. (4) Wave 16 driver flow not yet exercised end-to-end (needs seeded driver assignments).

---

### Round 5 — /data handler fixes + Wave 19 (Wallet/Quotas/LLM/Email) (2026-05-21)
- ✅ **KDS expo / generic-data fixes** (surfaced while testing the kitchen display): (1) `in=` filter on enum columns 500'd — pgx couldn't encode `[]any` against the enum array → cast to `text` (`filters.go`); (2) `select=` with spaces (supabase-client style `id, name`) → 400 — now trims each column (`handler.go`); (3) `expo.jsx` selected non-existent `orders.table_number` (consolidated to `table_session_id`) → removed. Expo board now loads + shows in-flight orders. (NOTE: these are uncommitted — a server running the committed build still 400s until rebuilt.)
- ✅ **Wave 19 — Wallet + Quotas + multi-LLM + BYO email** (10 parallel agents + migration 024): 
  - Backend packages: `internal/handlers/wallet` (balance/topup/ledger/auto-refill — verified 200), `internal/quota` (per-resource usage), `internal/metering` (wallet debit + quota increment, idempotent), `internal/llm` (Provider interface + Anthropic/OpenAI/Gemini/Moonshot adapters + cost-aware router reading `llm_model_pricing`), `internal/email` (Resend/SendGrid/Mailgun/SES/SMTP + BYO per-store creds).
  - Jobs (wired + started): `walletrefill` (auto-refill cron), `dunning` (failure ladder), `llmsync` (litellm pricing sync + model discovery).
  - Migration 024: quota_usage, llm_model_pricing, llm_messages, llm_tool_executions, email_providers, location_email_credentials, + org_wallets auto-refill columns.
  - Frontend: `/settings/billing/wallet` (balance, top-up, auto-refill, ledger).
  - Integration fix: aligned `PUT /wallet/auto-refill` (handler ↔ frontend `enabled` field + `auto_refill_enabled` column).

**Live e2e: 253/253. Full backend + frontend build green.**

**Wave 19 follow-ups (not blocking):** metering/email/llm packages are built but not yet *called* from request handlers (no metered handler wraps them yet); LLM adapters' live wire formats partly stubbed (TODOs); `llm_model_pricing` seeds at 02:00 / on fetch (empty until then); dunning needs `organizations.service_degraded`/`dunning_stage` columns flagged; walletrefill provider-charge hook needs an org→location resolution; minor `org_wallets` column dup (`saved_payment_method_id` vs migration-024 `payment_method_token`).

---

## In Progress ⏳

_(none active)_

---

## Not Started ⬜

- [ ] **Wave 10** — USD billing via FX
- [ ] **Wave 12** — KDS hardening + UI completeness
- [ ] **Wave 13** — Offline Tier 1 (network resilience)
- [ ] **Wave 14** — Testing infrastructure (smoke + e2e + seeded fixtures)
- [ ] **Wave 15** — Penetration testing
- [ ] **Wave 16** — Drivers, delivery portal, live tracking
- [ ] **Wave 17** — WhatsApp account binding
- [ ] **Wave 19** — Wallet + quotas + multi-LLM provider abstraction
- [ ] **Wave 20** — Customer chat assistant
- [ ] **Wave 21** — Manage your store from WhatsApp
- [ ] **Wave 22** — Public API + scoped keys + tenant webhooks
- [ ] **Wave 23** — Custom domains
- [ ] **Wave 24** — Easy wins (10 POS quality-of-life features)
- [ ] **Wave 25** — Observability + multi-region deployment
- [ ] **Wave 26** — Platform admin tool
- [ ] **Wave 27** — Receipts (PDF + email + WhatsApp + reprint)
- [ ] **Wave 28** — Customer marketplace reviews
- [ ] **Wave 29** — Hardware integration (ESC/POS printers + scanner + display + scale)
- [ ] **Wave 30** — Internationalization (i18n) + accessibility
- [ ] **Wave 31** — Backups + DR + GDPR/POPIA data deletion
- [ ] **Wave 32** — Help center + onboarding wizard
- [ ] **Wave 33** — v2 deferred (later)
- [ ] **Wave 34** — Invoicing (platform → stores, B2B, VAT-aware)
- [ ] **Wave 35** — Unified workspace: one app, role-aware views
- [ ] **Wave 36** — Responsiveness sweep
- [ ] **Wave 37** — WhatsApp multi-number support
- [ ] **Wave 38** — BYO SMTP + central email metering
- [ ] **Wave 39** — Security gaps: 2FA + tenant audit-log + activity alerts
- [ ] **Wave 40** — Operational gaps: image uploads, time-clock, WA templates, EOD email
- [ ] **Wave 41** — Easy wins extended (10 more POS features)
- [ ] **Wave 42** — Legal foundation: ToS / Privacy / Cookie consent / Compliance pack
- [ ] **Wave 43** — Native shell (Tauri + Capacitor)
- [ ] **Wave 44** — Deferred follow-ups (drop-in slots)
