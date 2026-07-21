# BeepBite — Implementation Tasks

Companion to [ROADMAP.md](./ROADMAP.md). Each task is parallel-safe within its wave, names the agent it's intended for, the files it can edit, and the acceptance criteria.

> **Conventions**
> - **Agent**: `sonnet` for execution; `opus` for adversarial pen-testing and ambiguous research.
> - **Files** lists the paths an agent may touch. Anything outside is off-limits unless explicitly noted.
> - **Acceptance** is a short checklist a reviewer can verify in under a minute.
> - **Migrations** declare their number range up-front so concurrent waves don't collide.
> - Wiring into `backend/cmd/server/main.go` is done by the orchestrator after a wave completes, **not** by individual agents.

---

## Required environment variables

Set these in your shell or `.env` before `go run ./cmd/server --env=local`.

### Core
| Variable | Purpose |
|---|---|
| `APP_ENV` | `local` / `dev` / `main` |
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | HS256 secret for email + staff JWT (audience claim disambiguates; see follow-up to split) |
| `CORS_ORIGINS` | Comma-separated frontend origins; first is used for Paystack callbacks |
| `POST_AUTH_REDIRECT` | Where to send users after Google OAuth |
| `PAYMENT_KEY_ENCRYPTION_SECRET` | AES-GCM key (32 bytes base64) for bank-account + BYO provider keys |

### Google OAuth
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URL`

### Payments — platform-side fallback per region (e.g. `ZA`)
`PAYSTACK_ZA_SECRET_KEY`, `PAYSTACK_ZA_PUBLIC_KEY`, `PAYSTACK_ZA_WEBHOOK_SECRET`, `PAYSTACK_ZA_TEST_MODE`

### Payments — Stripe (per region, e.g. `US`)
`STRIPE_US_SECRET_KEY`, `STRIPE_US_PUBLIC_KEY`, `STRIPE_US_WEBHOOK_SECRET`

### WhatsApp Cloud API
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`

### Email — Resend
`RESEND_API_KEY`, `RESEND_FROM`

### Maps + AI
`MAPBOX_TOKEN`, `OPENAI_API_KEY`

### FX (added in Wave 10)
`FX_PROVIDER` (one of: `openexchangerates`, `exchangerate-host`, `currencylayer`, `fixer`), `FX_API_KEY`, `FX_FETCH_INTERVAL` (default `1h`)

### Email — central provider (Wave 38; per-tenant BYO overrides this)
| Variable | Purpose |
|---|---|
| `EMAIL_PROVIDER_DEFAULT` | `resend` / `sendgrid` / `mailgun` / `ses` / `smtp` |
| `RESEND_API_KEY` | Already present; default Resend account |
| `EMAIL_FROM_DEFAULT` | `no-reply@beepbite.io` |
| `EMAIL_REPLY_TO_DEFAULT` | `support@beepbite.io` |
| `BEEPBITE_DPO_EMAIL` | Required for GDPR/POPIA compliance pack (Wave 42). Data Protection Officer contact. |

### BeepBite legal info (used on platform-issued invoices, added in Wave 35)
| Variable | Purpose |
|---|---|
| `BEEPBITE_LEGAL_NAME` | Required. Legal entity name on invoice header. |
| `BEEPBITE_REGISTERED_ADDRESS` | Required. Multi-line allowed. |
| `BEEPBITE_REGISTERED_COUNTRY` | Required. ISO-3166 two-letter code. |
| `BEEPBITE_COMPANY_NUMBER` | Optional. Companies-house / CIPC / equivalent registration number. |
| `BEEPBITE_VAT_NUMBER` | **Optional. Empty → no VAT line on platform-issued invoices.** |
| `BEEPBITE_VAT_RATE_PERCENT` | Required only if `BEEPBITE_VAT_NUMBER` set. Numeric (e.g. `15`). |
| `BEEPBITE_INVOICE_PREFIX` | Optional. Defaults to `BB`. Becomes the prefix of invoice numbers (e.g. `BB-2026-000123`). |

### Testing
`TEST_DATABASE_URL` — points to an ephemeral Postgres; `cmd/tests` and integration `_test.go` skip if unset.

---

## Shipped (Wave 1 → Wave 5)

Past waves are summarised in `task.md` (legacy). All 46 migrations apply clean. All listed handlers and pages exist in the tree. The unblocked work below is what remains.

| Wave | Outcome |
|---|---|
| Wave 1 | 10 backend handler packages (tables, kds, adjustments, giftcards, storecredit, houseaccounts, bankaccounts, payouts job, transferwebhook, inventory) |
| Wave 2 | 10 frontend pages (`/pos/login`, `/floor`, `/kds/*`, `/cash`, `/gift-cards`, `/menu/schedules`, `/settings/payouts`, `/settings/promotions`, `/dev/adjustments`, `/reports`) |
| Wave 3 | Audit-log wiring, idempotency package, tip pools, labor cost view, recipe cost runner, waste tracking, payroll CSV, house-account UI, supplier/PO/GRN UI, billing UI |
| Wave 4 | KDS fan-out trigger + runner, reviews rewire, manager dashboard, staff-manage UI, reservations + waitlist, delivery zones, chatbot verify, fiscal sequencer, multi-currency additive, PII log + audit retention |
| Wave 5 | Onboarding refactor, idempotency wrapper mount, staffauth manager endpoints, reviews reply, promotions OR-filter, supplier contacts, Leaflet delivery-zone editor |

`task.md` (singular) can be deleted once this file is checked in.

---

# Wave 0 — Schema consolidation + Row-Level Security (OPUS, phased)

**Why now**: this is a fresh system. Forty-six chronological migrations get folded into thirteen domain-scoped migrations, with **RLS enabled on every tenant-scoped table from creation**. Defense in depth: even a buggy handler can't leak across orgs because Postgres will refuse the SELECT. Driven by **opus** because the design judgment is high-stakes — getting the RLS predicate wrong silently breaks the whole system.

**Phasing**:
- **Phase A** runs first (sequential): one opus designs the plan + foundational helpers.
- **Phase B** runs in parallel after Phase A: six opus agents own two migrations each.
- **Phase C** runs after Phase B: one opus writes the verification suite that becomes the wave's acceptance gate.

**Outcome migration set** (numbers 001–014, plus 015 for cross-cutting policies if needed):

| # | Migration | Owner |
|---|---|---|
| 001 | `extensions_and_helpers.sql` — pgcrypto, ulid (if used), enums, RLS helper functions, session-variable contract | Phase A |
| 002 | `auth_and_tenancy.sql` — auth_users, refresh_tokens, profiles, organizations, organization_members + capabilities jsonb, organization_invites | Phase B.1 |
| 003 | `staff_and_pin.sql` — staff (member_id FK, display_name, no global email unique), staff_refresh_tokens, password_reset_tokens, pin-overlay tokens | Phase B.1 |
| 004 | `menu.sql` — categories, items, modifier_groups, modifiers, item_recipes (recursive), courses, menu_schedules, item_price_schedules, item_menu_schedules, allergens, dietary_tags, 86-list | Phase B.2 |
| 005 | `inventory.sql` — inventory_items, suppliers, purchase_orders, goods_receipts, supplier_invoices, ingredient_price_history, stock_movements, prep_batches | Phase B.2 |
| 006 | `tables_and_floor.sql` — sections, tables, table_sessions, seats, check_splits | Phase B.3 |
| 007 | `orders_and_kds.sql` — orders (client-supplied ULID + idempotency_key), order_items, order_payments, kitchen_stations, item/category station_routing, kds_tickets, kds_ticket_events, kds_fanout_queue, kds_display_groups, fiscal_receipts, tax_rates | Phase B.3 |
| 008 | `payments_generic.sql` — locations (with slug + city + country + currency), regions, payment_providers, location_payment_credentials, payment_attempts, refunds, webhook_event_log, exchange_rates, subscription_plans, subscription_invoices, bank_accounts, merchant_payouts, payout_schedules, beepbite_payment_fees | Phase B.4 |
| 009 | `cash_and_adjustments.sql` — cash_drawers, cash_drawer_sessions, cash_drawer_movements, cash_drawer_counts, adjustment_reasons, order_adjustments, pos_shifts | Phase B.4 |
| 010 | `engagement.sql` — promotions, coupon_codes, promotion_redemptions, order_item_discounts, gift_cards, gift_card_transactions, store_credits, house_accounts, house_account_invoices, loyalty_config, loyalty_transactions, customers, reservations, waitlist | Phase B.5 |
| 011 | `delivery.sql` — delivery_zones (Go ray-casting; PostGIS noted for later), delivery_partners, delivery_partner_credentials, delivery_partner_orders, whatsapp_routing | Phase B.5 |
| 012 | `shifts_payroll_tipping.sql` — staff_pay_rates, staff_shifts, staff_time_entries, tip_pools, tip_distributions, payroll_periods | Phase B.6 |
| 013 | `compliance.sql` — audit_log (polymorphic actor), idempotency_keys, pii_access_log, audit_archive | Phase B.6 |
| 014 | `seed_and_views.sql` — seeded reference data (regions, payment_providers, default tax rates, default subscription plans), reporting views (daily_sales_summary, hourly_sales_heatmap, menu_engineering, labor_cost_daily, etc.), `refresh_reporting_views()` | Phase C |

**Files moved**: every existing migration in `backend/migrations/*.sql` moves to `backend/migrations/legacy/`. New migrations live at `backend/migrations/001_*.sql` … `014_*.sql`.

**Output of Phase A determines exact field lists in Phase B**. Phase B opus agents wait until Phase A doc lands; they then implement their migrations using the conventions document as the contract.

### Phase A — Plan + helpers (1 opus, sequential)

#### T0.A.1 — Consolidation plan + RLS conventions doc (opus)
Read every migration in `backend/migrations/`, every Go handler that does CRUD, and the auth + actor model. Produce `docs/schema-consolidation-plan.md` covering:
- The exact set of tables each consolidated migration owns (no duplicates, no orphans).
- The session-variable contract (`app.current_user_id uuid`, `app.current_org_id uuid`, `app.current_capabilities jsonb`, `app.current_actor_id uuid`, `app.is_service_role bool`).
- The RLS pattern template per row kind:
  - **Org-scoped tables** (orders, items, etc.) — `USING (organization_id = current_org_id() OR current_setting('app.is_service_role', true)::bool)`.
  - **Location-scoped tables** (tables, kds_tickets, etc.) — same with location_id resolved via `locations.organization_id`.
  - **Member-scoped tables** (refresh_tokens, etc.) — `USING (user_id = current_user_id())`.
  - **Public-via-marketplace tables** (locations when `is_marketplace_visible=true`) — separate `marketplace_role` SELECT policy.
  - **Service-only tables** (idempotency_keys, audit_log writes) — `WITH CHECK` on service_role.
- The helper SQL functions: `current_org_id()`, `current_user_id()`, `current_capabilities()`, `has_capability(text)`, `is_service_role()`.
- The Go pgxpool integration contract: every acquired connection runs `SELECT set_config('app.current_user_id', $1, true)` etc. before serving the request.
- The migration ordering (FK dependencies) and one-shot data migration from legacy to new shape (if we keep production data; if dev-only, just drop and rebuild).
- The list of tables NOT under RLS (e.g., `regions`, `currencies`, `payment_providers` — global reference data — readable by everyone, writable only by service_role).

This task is **research and design only — no SQL written yet** beyond the helper functions. Plan must be reviewable in one sitting.
- **Files**: `docs/schema-consolidation-plan.md` (new)
- **Acceptance**: every existing table accounted for in exactly one consolidated migration; every RLS policy template covers a known threat (anonymous read, cross-tenant read, cross-tenant write, capability bypass); plan is signed off before Phase B begins.

#### T0.A.1b — Competitive feature parity audit (opus, parallel with T0.A.1)
Independent research task — does not block migration design. Read public documentation, demo videos, and feature pages for **Toast, Square for Restaurants, Lightspeed K-Series, TouchBistro, Lavu, Clover, Loyverse, MarketMan**. Produce `docs/feature-parity.md` enumerating every restaurant-POS feature those products ship. For each, recommend:
- **v1** — ship in this roadmap window (and link to the wave + task it belongs in, or create a new one).
- **v2** — defer; note the trigger condition (e.g., "when we have 50 multi-location merchants").
- **skip** — explicit non-goal with rationale.

Group features by surface (FoH ordering, KDS, payments, inventory, reporting, marketing, integrations, hardware). For each accepted v1 feature, drop a one-line addition into the matching Wave's task list — these become the "comprehensive feature testing" target list in T14.7.
- **Files**: `docs/feature-parity.md` (new); appends to tasks.md per acceptance.
- **Acceptance**: doc covers ≥150 line items; the v1 accept-set has a clear home in tasks.md or fires new tasks into a Wave 16 backlog.

#### T0.A.2 — Migration 001 (helpers + session contract) (opus)
Implement `backend/migrations/001_extensions_and_helpers.sql`:
- `CREATE EXTENSION IF NOT EXISTS pgcrypto;` plus any others required.
- Helper functions per T0.A.1: `current_org_id()`, `current_user_id()`, `current_capabilities()`, `has_capability(text)`, `is_service_role()`.
- Common enums: `order_status`, `payment_status`, `kds_event_type`, `actor_type`.
- `service_role` and `marketplace_role` Postgres roles.
- `GRANT` baseline so service_role can bypass, marketplace_role has narrow SELECT grants (specific tables added in Phase B).
- **Files**: `backend/migrations/001_extensions_and_helpers.sql` (new)
- **Acceptance**: `SELECT current_org_id()` returns NULL when no session var set; returns the uuid when `set_config('app.current_org_id', <uuid>, true)` is called; clean migrate from empty DB.

#### T0.A.3 — pgxpool session-variable injection (opus, Go side)
The Go bridge: when a request arrives with a JWT, after auth middleware resolves claims, every database operation runs on a connection that has `app.current_user_id`, `app.current_org_id`, `app.current_capabilities`, `app.current_actor_id` set via `SET LOCAL` inside the request's transaction. Two strategies, choose the simpler:
- **Per-request transaction** (recommended): every handler wraps its work in `BeginTx`, sets session vars, commits.
- **AcquireFunc hook**: hook into `pgxpool.Config.AfterConnect` won't work (connections are pooled); use a request-scoped wrapper that calls `set_config` on first query.

Land a clean `internal/db/scoped.go` package exposing `Scoped(ctx, pool, fn func(tx pgx.Tx) error)` that does the transaction + session-var setup. Update one representative handler (e.g., kds) to use it as a pattern.
- **Files**: `backend/internal/db/scoped.go` (new), `backend/internal/handlers/kds/handler.go` (one-handler reference port)
- **Acceptance**: integration test confirms a SELECT through `Scoped` returns only the caller's org's rows even when no `WHERE organization_id=` is in the query.

### Phase B — Domain migrations (6 opus agents in parallel)

Each Phase B task implements TWO consolidated migrations using the conventions from T0.A.1. Each migration must:
- Define the table with all columns (incl. `organization_id` / `location_id` where applicable, `created_at`, `updated_at`, `idempotency_key` where applicable).
- Add indexes including the `organization_id` / `location_id` leading index for RLS query performance.
- Apply `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` and `… FORCE ROW LEVEL SECURITY;`.
- Create the appropriate policies per the template (org-scoped / location-scoped / member-scoped / public / service-only).
- Grant the right access to `service_role` and (where relevant) `marketplace_role`.
- Include triggers explicitly (no implicit cross-migration trigger dependencies).
- End with a comment block listing every policy + reasoning.

#### T0.B.1 — Migrations 002 (auth + tenancy) + 003 (staff + PIN) (opus)
Migration 002 absorbs legacy 1, 2, 13, 14, 43, plus:
- `organization_members.role` CHECK extended to include `'kitchen'`, `'pos'`, **`'driver'`**.
- `organization_members.capabilities jsonb` default `'{}'` — documented keys include `can_pos`, `can_kitchen`, `can_void`, `can_comp`, `can_settle`, `can_view_reports`, **`can_drive`**.
- **`whatsapp_accounts`** (id, profile_id FK, phone_e164 text UNIQUE, verified_at, created_at) — partial unique index enforces max 3 verified rows per profile via a CHECK on a trigger-maintained `profiles.whatsapp_count`.
- **`whatsapp_link_tokens`** (token text PK, phone_e164, intent enum `'bind' | 'order'`, profile_id nullable, expires_at, used_at).

Migration 003 absorbs legacy 21 plus the new `member_id` link, removal of `staff.email UNIQUE NOT NULL`, addition of `display_name`, and capability flags on `organization_members`.
- **Files**: `backend/migrations/002_auth_and_tenancy.sql`, `backend/migrations/003_staff_and_pin.sql` (new)
- **Acceptance**: RLS smoke proves `auth_users` and `staff` are member-scoped reads; organization_members and organizations are org-scoped; `whatsapp_accounts` is profile-scoped (only owner can SELECT); link tokens are service-role-only; the max-3-numbers invariant is enforced.

#### T0.B.2 — Migrations 004 (menu) + 005 (inventory) (opus)
Migration 004 absorbs legacy 2 (menu pieces), 5–9, 24, 44 — plus the **new modifier_groups + modifiers** model (replacing item_variations) and the **courses table**. Migration 005 absorbs 2 (inventory pieces), 20, 34, 35.
- **Files**: `backend/migrations/004_menu.sql`, `backend/migrations/005_inventory.sql` (new)
- **Acceptance**: RLS smoke proves org-A cannot read org-B menu items or inventory; recursive recipe cost still works; modifier-group hierarchy supports min/max/required.

#### T0.B.3 — Migrations 006 (tables + floor) + 007 (orders + KDS) (opus)
Migration 006 absorbs legacy 16. Migration 007 absorbs legacy 2 (orders pieces), 17, 28 (KDS expo + report views), 36 (fanout queue), 40 (fiscal), 45 (nullable customer), 46 (default station route) — plus **client-supplied ULIDs**, **idempotency_key on orders + order_items**, **`'ready'` event in kds_ticket_events**, **category_station_routing**, **kds_display_groups**, **tax_rates**, **`orders.fulfillment_type enum 'collection' | 'delivery' | 'dine_in'`**, and **`order_tracking_tokens`** (token text PK, order_id FK, customer_profile_id FK, expires_at, revoked_at).
- **Files**: `backend/migrations/006_tables_and_floor.sql`, `backend/migrations/007_orders_and_kds.sql` (new)
- **Acceptance**: RLS smoke proves cross-org KDS ticket SELECT returns empty; client can supply order ULID on insert; idempotency_key uniqueness enforced; `order_tracking_tokens` SELECT requires either the token-bearing customer OR the order's org-member (driver included).

#### T0.B.4 — Migrations 008 (payments) + 009 (cash + adjustments) (opus)
Migration 008 absorbs legacy 2 (locations), 4, 15, 26, 27, 30, 38, 41 (delivery zones moved), 43 — plus **locations.slug + city + country + on_delivery_payment_methods text[]**, **`offers_delivery bool default false`**, **`offers_collection bool default true`** (CHECK: at least one true), **`is_marketplace_visible bool default false`**, **payment_providers registry**, **location_payment_credentials** (BYO keys, encrypted), **payment_attempts** (generic provider txn log; drop paystack-specific columns from `order_payments`), **exchange_rates**, **subscription_invoices** with USD + local + rate snapshot, **whatsapp_routing**, the new order status `'pending_on_delivery'` added to the `order_status` enum (defined in migration 001), and the **wallet system**:
- `org_wallets` (org_id PK, balance_cents bigint NOT NULL DEFAULT 0, hold_cents bigint NOT NULL DEFAULT 0, currency_code text NOT NULL, updated_at). One row per org.
- `wallet_topups` (id, org_id, amount_cents, currency_code, payment_attempt_id FK nullable, status enum `'initiated' | 'succeeded' | 'failed' | 'refunded'`, created_at, completed_at).
- `wallet_transactions` (id, org_id, kind enum `'topup' | 'debit_llm' | 'debit_whatsapp' | 'debit_sms' | 'debit_bulk_import' | 'debit_overage' | 'refund' | 'adjustment'`, amount_cents bigint (signed), reason text, ref_type text nullable, ref_id uuid nullable, idempotency_key text UNIQUE, balance_after_cents bigint, created_at) — append-only. Trigger updates `org_wallets.balance_cents`.

Migration 009 absorbs legacy 18, 31 plus **pos_shifts**.
- **Files**: `backend/migrations/008_payments_generic.sql`, `backend/migrations/009_cash_and_adjustments.sql` (new)
- **Acceptance**: marketplace_role can SELECT locations where `is_marketplace_visible=true` only; bank_accounts encrypted_account_number is non-readable by non-service connections; payment_attempts unique on (provider_code, provider_txn_id).

#### T0.B.5 — Migrations 010 (engagement) + 011 (delivery) (opus)
Migration 010 absorbs legacy 19, 25, 37, 42. Migration 011 absorbs legacy 12, 41 plus the full driver model:
- **`driver_assignments`** (id, order_id FK, driver_member_id FK, status enum `'offered' | 'accepted' | 'picked_up' | 'delivered' | 'canceled'`, offered_at, accepted_at, picked_up_at, delivered_at, canceled_reason).
- **`driver_location_pings`** (driver_member_id, lat double, lng double, accuracy_m, heading_deg, speed_mps, recorded_at) — partitioned by month for retention; index on (driver_member_id, recorded_at DESC). 7-day retention enforced by a scheduled DELETE in the audit-retention job.
- **`driver_shifts`** (driver_member_id, started_at, ended_at, status enum `'online' | 'paused' | 'offline'`) — only one open shift per driver enforced by partial unique index.
- **`driver_emergency_contacts`** (driver_member_id, name, phone_e164, share_trip_token nullable).
- Helper function `pings_visible_to_customer(track_token text)` returns the latest ping only if (a) order's `out_for_delivery` status is active, (b) driver is within 5 km of delivery address, (c) caller's profile matches the order's customer. Returns NULL otherwise (used by the public track endpoint).
- **Files**: `backend/migrations/010_engagement.sql`, `backend/migrations/011_delivery.sql` (new)
- **Acceptance**: gift card balance ledger preserves append-only invariant via RLS WITH CHECK; `driver_location_pings` SELECT is gated to: the driver themselves, the org of the assigned order, or `pings_visible_to_customer` for the matching customer; cross-org driver SELECT returns empty.

#### T0.B.6 — Migrations 012 (shifts + payroll + tipping) + 013 (compliance) (opus)
Migration 012 absorbs legacy 2 (staff_shifts, staff_time_entries), 29, 32, 33. Migration 013 absorbs legacy 23, 39.
- **Files**: `backend/migrations/012_shifts_payroll_tipping.sql`, `backend/migrations/013_compliance.sql` (new)
- **Acceptance**: audit_log is writable by service_role only (handlers must use scoped insert); idempotency_keys not RLS-scoped (system-level); pii_access_log writes from any authenticated session, reads by service_role only.

### Phase C — Verification + seed + views (1 opus, sequential)

#### T0.C.1 — Migration 014 (seed + reporting views) (opus)
Absorbs legacy 22, 28 (report views), 33 (labor cost). Adds **seeded regions** (ZA, NG, KE, GH, US, GB, EU), **payment_providers** (paystack, stripe, payfast disabled), **default subscription_plans**, **default adjustment_reasons** (per-region inserted only on tenant creation, not here). All views explicitly tagged with `security_invoker = on` (Postgres 15+) so they run under the caller's RLS context.
- **Files**: `backend/migrations/014_seed_and_views.sql` (new)
- **Acceptance**: every reporting view returns scoped data under the caller's session; service_role sees all rows.

#### T0.C.2 — RLS verification suite (opus)
Write `backend/cmd/tests/rls/` smoke suite. For every table the consolidation creates:
- **Anonymous connection**: SELECT returns 0 rows; INSERT raises permission error.
- **Member of org A**: SELECT returns only org-A rows; INSERT works on org A, blocked on org B; UPDATE/DELETE blocked on org B.
- **Service-role connection**: SELECT returns all rows; INSERT works for any org.
- **Marketplace-role connection**: SELECT on `locations` returns only `is_marketplace_visible=true` rows; SELECT on `items` returns only items belonging to marketplace-visible locations; INSERT blocked on every table.

This suite is the **acceptance gate for Wave 0**. If any table fails, the migration is wrong, not the test.
- **Files**: `backend/cmd/tests/rls/*.go` (new), `docs/pentest/rls-foundation.md` (new — report)
- **Acceptance**: every consolidated table covered by at least four probes (anonymous, org-A, org-B, service); all pass.

#### T0.C.3 — Legacy migration archival (opus)
Move every file in `backend/migrations/2024*.sql` into `backend/migrations/legacy/`. Update `cmd/migrate` to skip the `legacy/` directory. Update the README and any docs that reference legacy migration numbers.
- **Files**: `backend/migrations/legacy/*` (moved), `backend/cmd/migrate/main.go`, `README.md` (if needed)
- **Acceptance**: `go run ./cmd/migrate --env=local --reset` runs only the 001–014 sequence; fresh DB boots clean; legacy files preserved for reference but not executed.

---

**Wave 0 sequencing summary**:
```
T0.A.1 (plan) ──► T0.A.2 (mig 001) ──► T0.A.3 (Go pgx)
                                       │
                ┌──────┬──────┬────────┴───┬──────┬──────┐
                ▼      ▼      ▼            ▼      ▼      ▼
              T0.B.1 T0.B.2 T0.B.3       T0.B.4 T0.B.5 T0.B.6   ← parallel
                                       │
                                       ▼
                              T0.C.1 ──► T0.C.2 ──► T0.C.3
```

After Wave 0 lands, every Wave 6+ migration number shifts. **Renumbering**: Wave 6 takes 015; Wave 7 takes 016; Wave 8 takes 017–018; Wave 9 takes 019; Wave 10 takes 020; Wave 11 takes 021–022; Wave 12 takes 023; Wave 13 takes 024. Update each wave's "Migration numbers owned" line below before kickoff.

---

# Wave 6 — Safety: tenant isolation, audit attribution, KDS resilience

**Why now**: marketplace launch exposes the directory publicly. Cross-tenant exposure must be closed first **at the handler layer** (Wave 0 closes it at the DB layer; both run). All `sonnet`, 6 parallel.

**Migration numbers owned**: none — `kds_fanout_queue` dead-letter columns are already part of consolidated migration 007 (orders_and_kds). This wave is purely application code.

### T6.1 — Shared org-scope middleware (sonnet)
Add `internal/auth/orgscope.go` exposing `RequireOrgScope` HTTP middleware. It resolves the JWT's `UserID` to the set of `(organization_id, location_id, role, capabilities)` rows via `organization_members` and injects an `OrgScope` value into context. Provides helper `OrgScopeFrom(ctx)` and `ScopeAllowsLocation(scope, locID uuid.UUID) bool`.
- **Files**: `backend/internal/auth/orgscope.go` (new), `backend/internal/auth/orgscope_test.go` (new)
- **Acceptance**: middleware unit-tested with stub `pgxpool`; valid JWT for org A returns scope listing only org-A locations; missing membership returns 403 not 401.

### T6.2 — Wire org-scope into KDS + cashdrawer + tippools (sonnet)
Every endpoint in `handlers/kds`, `handlers/cashdrawer`, `handlers/tippools` that accepts `location_id` or `station_id` cross-checks via `ScopeAllowsLocation`. Mismatch → 404 (not 403, to avoid existence leak).
- **Files**: `backend/internal/handlers/kds/handler.go`, `backend/internal/handlers/cashdrawer/handler.go`, `backend/internal/handlers/tippools/handler.go`
- **Acceptance**: Wave 15 cross-tenant probe (T15.1) returns 404 on every endpoint with foreign IDs.

### T6.3 — Wire org-scope into POS + tables + adjustments (sonnet)
Same as T6.2 for `handlers/pos`, `handlers/tables`, `handlers/adjustments`. Note `pos.CreateOrder` also accepts `table_session_id` — verify the session belongs to the caller's scope.
- **Files**: `backend/internal/handlers/pos/handler.go`, `backend/internal/handlers/tables/handler.go`, `backend/internal/handlers/adjustments/handler.go`
- **Acceptance**: cross-tenant POS create-order returns 404; tampered `table_session_id` returns 404.

### T6.4 — Fix audit actor context key (sonnet)
`data/audit.go` reads `ctx.Value("actor_id")` (string key) but `auth.Middleware` stores claims under `claimsKey int`. Add a small middleware step that, after auth middleware runs, copies `claims.UserID` to the string `"actor_id"` key. Or update `actorIDFromCtx` to read claims directly via `auth.ClaimsFrom`.
- **Files**: `backend/internal/handlers/data/audit.go`, `backend/internal/auth/middleware.go`
- **Acceptance**: a void-adjustment via the data handler produces an `audit_log` row with non-null `actor_id` and `actor_type='member'`.

### T6.5 — KDS fan-out explicit fallback + dead-letter cap (sonnet)
In `pos/store.go`, the `_ = err` swallow after `fanoutInsideTx` is replaced with an explicit `INSERT INTO kds_fanout_queue` so the kitchen never silently misses an order. The runner uses the `retry_count` and `state='dead'` columns shipped in consolidated migration 007 to park failing rows after 10 retries.
- **Files**: `backend/internal/handlers/pos/store.go`, `backend/internal/jobs/kdsfanout/runner.go`
- **Acceptance**: deliberately route an item to a non-existent station; order still creates, queue row appears, after 10 retries it's marked `'dead'` and a single error log fires (not a flood).

### T6.6 — Tax rate from `tax_rates` table per location (sonnet)
Replace `const taxRate = 15.0` in `pos/store.go:150` with a lookup against the existing `tax_rates` table (created in migration 2) filtered by `location_id` + `is_default=true`. Cache per-process for 5 minutes. Fallback to region's `tax_default` if no row.
- **Files**: `backend/internal/handlers/pos/store.go`, `backend/internal/handlers/pos/tax.go` (new)
- **Acceptance**: switch a location's `tax_rates` row to 10%; new order computes 10% VAT; restart and try a fresh location with no row; falls back to its region default.

---

# Wave 7 — Marketplace foundations

**Why now**: customers cannot find a store without a slug; `/s/:slug` cannot resolve. Without this, the marketplace doesn't exist. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `locations.slug`, `city`, `country`, and `lookup_location_by_slug()` ship in consolidated migration 008 (payments_generic / locations).

### T7.1 — (REMOVED — folded into Wave 0 / migration 008)
Schema for slug + city + country + lookup function lives in consolidated migration 008. This wave's slot is freed.

### T7.2 — Public store directory endpoints (sonnet)
Public (no-auth) routes `GET /stores` and `GET /stores/:slug` in a new `handlers/marketplace` package. List supports `?q=`, `?city=`, `?lat=&lng=&radius_km=`, paginated. Returns store name, slug, city, country, hours, cuisine tags. Detail returns store + currently available menu snapshot (categories + items, only `available=true && !is_86ed`).
- **Files**: `backend/internal/handlers/marketplace/{handler,store,store_test}.go` (new)
- **Acceptance**: `GET /stores?q=burger` returns matching active locations only; `GET /stores/:slug` returns 404 for unknown slug; menu items are filtered by `available_from/until` and `is_86ed`.

### T7.3 — Chatbot uses slug search + live Mapbox (sonnet)
`internal/chatbot/ordering.go` `getStoresBySearch` matches on both `name ILIKE` and `slug ILIKE`. Replace the always-false `geocodeAddress` stub in `external_stubs.go` with a call into the existing live `internal/integrations/mapbox/` client.
- **Files**: `backend/internal/chatbot/ordering.go`, `backend/internal/chatbot/external_stubs.go`, `backend/internal/chatbot/service.go`
- **Acceptance**: WhatsApp typing `myrestaurant-durban` returns that store; address-typed flow geocodes via Mapbox; both have integration coverage in Wave 14.

### T7.4 — Frontend marketplace surfaces (sonnet)
New routes `/discover` (search + store list), `/store/:slug` (store page with menu + cart), `/checkout` (delivery address, tip, hosted payment kickoff). Anonymous customer cart persists to `localStorage` keyed by slug.
- **Files**: `src/routes.jsx`, `src/pages/discover/*` (new), `src/pages/store/*` (new), `src/pages/checkout/*` (new), `src/services/marketplace.js` (new)
- **Acceptance**: build clean; navigation flow demonstrated end-to-end against a seeded store; cart survives reload.

### T7.5 — `/s/:slug` slug-scoped PIN keypad (sonnet)
Replace `/pos/login`'s manual location selector with a slug-scoped variant at `/s/:slug`. On load, calls `GET /stores/:slug` to resolve `location_id`, then the existing PIN-login flow is pre-scoped. The old `/pos/login` keeps working for direct-link access.
- **Files**: `src/routes.jsx`, `src/pages/staff-pin/*` (new)
- **Acceptance**: `/s/myrestaurant-durban` shows a keypad branded with the store name; bad slug shows a clean 404 page (no auth-form leak).

### T7.6 — Wildcard subdomain routing `mystore.beepbite.io` (sonnet)
Two halves:
- **Backend** middleware `internal/subdomain/middleware.go` reads `r.Host`, extracts the first label, looks up `lookup_location_by_slug(slug)`. If matched, sets `r.Context()` with `subdomain_location_id`. Reserved subdomains (`app`, `api`, `www`, `admin`) skip the lookup. Marketplace and store endpoints respect the context: hitting `/` on `mystore.beepbite.io` is equivalent to `/store/mystore` on `app.beepbite.io`.
- **Frontend** reads `window.location.hostname` once on boot, extracts the subdomain via the same reserved-list. If non-reserved, sets a `StoreContext` provider that auto-redirects `/` → `/store/<slug>` (customer view) and `/s` → the PIN keypad for this store.
- **Fly.io**: document the one-time setup in `docs/deploy.md` — `fly certs add '*.beepbite.io'`, wildcard A/AAAA records to the Fly app IP, smoke test with `curl -H 'Host: mystore.beepbite.io' https://<app>.fly.dev/`.
- **Files**: `backend/internal/subdomain/middleware.go` (new), `backend/cmd/server/main.go` (wiring), `src/context/store-context.jsx` (new), `src/App.jsx`, `docs/deploy.md` (new section)
- **Acceptance**: `curl -H 'Host: mystore.beepbite.io' https://app.fly.dev/api/stores/me` returns the store profile; `app.beepbite.io` continues to behave as the central marketplace; `https://api.beepbite.io` continues to behave as the API (reserved subdomains skipped).

---

# Wave 8 — Generic multi-provider payments + BYO keys

**Why now**: BeepBite settles in the merchant's account, not ours. The platform-keys-per-region model from Wave 5 is being inverted. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `payment_providers`, `location_payment_credentials`, `payment_attempts`, and the dropped paystack-specific columns all live in consolidated migration 008.

### T8.1 — (REMOVED — folded into Wave 0 / migration 008)
Schema for the generic payment abstraction ships in consolidated migration 008.

### T8.2 — `PaymentProvider` interface + adapters (sonnet)
Define `internal/payments/provider.go`:
```go
type Provider interface {
    Code() string
    InitCheckout(ctx, amount, currency, orderID, metadata) (hostedURL string, providerTxnID string, err error)
    VerifyWebhook(ctx, signature, rawBody []byte, webhookSecret []byte) (event Event, err error)
    Refund(ctx, providerTxnID, amount) (refundID string, err error)
}
```
Make `paystack.Manager` and `stripe.Manager` satisfy this via thin adapters in `internal/payments/{paystack,stripe}/adapter.go`. New `internal/payments/registry.go` resolves: if store has `location_payment_credentials` row, use it; else fall back to platform region key.
- **Files**: `backend/internal/payments/*` (new), `backend/internal/integrations/paystack/adapter.go` (new), `backend/internal/integrations/stripe/adapter.go` (new)
- **Acceptance**: existing webhook handler compiles unchanged when routed through the registry; a third (stub) provider can be added with one file + one row.

### T8.3 — Unified webhook route (sonnet)
`POST /webhooks/:provider/:location_id` in a new `handlers/paymentwebhook` (rename existing `paymentwebhooks` to a unified handler). Looks up `location_payment_credentials` for the (provider, location), calls `Provider.VerifyWebhook`, dispatches event. Existing `/payments/webhooks/paystack/:location_id` kept as a redirect for backward compat.
- **Files**: `backend/internal/handlers/paymentwebhook/{handler,handler_test}.go` (new), `backend/cmd/server/main.go` (wiring)
- **Acceptance**: webhook signed with the wrong secret returns 401; valid event records an `audit_log` row + `payment_attempts` update.

### T8.4 — BYO keys settings page (sonnet)
New tab in `/settings/location/:locationId` → "Payments". Form per provider: paste secret key + webhook secret, save (server encrypts via AES-GCM with `PAYMENT_KEY_ENCRYPTION_SECRET`). Reveals the auto-generated webhook URL (`/webhooks/:provider/:location_id`) with copy-to-clipboard. Step-by-step provider-dashboard instructions per provider.
- **Files**: `src/pages/settings/location/payments/*` (new), `src/services/payments.js` (new), Markdown for instructions in `src/content/payment-setup/{paystack,stripe,payfast}.md`
- **Acceptance**: paste a Paystack test secret; webhook URL appears; firing a sandbox webhook from Paystack's dashboard records an event.

### T8.5 — Per-store currency at checkout (sonnet)
`locations.default_currency_code` already exists. Wire it into POS + chatbot + marketplace checkout: every order is created with `currency` = store currency; payment provider call uses that currency. UI displays the symbol throughout.
- **Files**: `backend/internal/handlers/pos/store.go`, `backend/internal/chatbot/ordering.go`, `src/pages/checkout/index.jsx`, `src/lib/currency.js` (new)
- **Acceptance**: a US-region store charges in USD via Stripe; a ZA-region store in ZAR via Paystack; both store the currency on the order row.

### T8.6 — On-delivery payment fallback (sonnet)
`locations.on_delivery_payment_methods text[]` (ships in Wave 0 / migration 008) — values `'cash'`, `'card_machine'`. A new order status `'pending_on_delivery'` joins the lifecycle (also in 008).
- **Backend**: marketplace checkout endpoint checks `location_payment_credentials` for the store. If none active and delivery is selected and `on_delivery_payment_methods` has at least one entry, the order is created in `'pending_on_delivery'`. New endpoint `POST /orders/:id/mark-paid-on-delivery` (staff-PIN-gated, capability `can_settle`) sets status to paid and records the payment method (`cash` or `card_machine`).
- **Frontend (settings)**: Payments tab gains a section "Payment on delivery" with checkboxes "Accept cash on delivery" and "Accept card machine on delivery". A red banner appears if no online provider AND no on-delivery method is enabled ("Customers cannot complete orders").
- **Frontend (checkout)**: when no online provider is configured, the checkout shows the on-delivery options instead of a redirect-to-pay button. Confirmation message tells the customer what to expect at the door.
- **Files**: `backend/internal/handlers/marketplace/checkout.go` (new), `backend/internal/handlers/pos/mark_paid_on_delivery.go` (new), `src/pages/settings/location/payments/on-delivery-section.jsx` (new), `src/pages/checkout/index.jsx`
- **Acceptance**: a store with no provider and `on_delivery_payment_methods=['cash']` can complete a checkout; the order appears in `/home` orders list with `pending_on_delivery` status; staff PIN-gated "Mark paid (cash)" button completes the order; the audit log records who marked it paid.

---

# Wave 9 — Staff PIN actor-overlay + capability flags

**Why now**: today's staff PIN issues a parallel session; we need it to identify the *actor* on top of an existing member session for cross-store flexibility and audit attribution. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `staff.member_id`, `display_name`, dropped `staff.email UNIQUE`, `organization_members.capabilities jsonb`, and extended role CHECK all live in consolidated migrations 002 (auth_and_tenancy) and 003 (staff_and_pin).

### T9.1 — (REMOVED — folded into Wave 0 / migrations 002 + 003)
Schema for capability flags + flexible staff linkage ships in consolidated migrations 002 and 003.

### T9.2 — `POST /pos/pin-verify` actor-overlay endpoint (sonnet)
Accepts the existing member bearer token + a PIN. Resolves the PIN against `staff` rows scoped to a location (`location_id` derived from member scope or supplied). Returns a short-lived (15-min) actor token containing `{member_id, staff_id, location_id, capabilities}`. Audit-logs the verify event regardless of outcome.
- **Files**: `backend/internal/staffauth/pin_verify.go` (new), `backend/internal/staffauth/service.go`
- **Acceptance**: wrong PIN logs `staff.pin_overlay_failed`, returns 401; correct PIN returns the actor token; lockout after 5 failures (shared counter); successful verify writes `audit_log` actor=`staff`.

### T9.3 — `ActorFromContext` composition middleware (sonnet)
New middleware reads either the staff-session JWT (legacy `/pos/login` flow) or the actor-overlay token (`X-Actor-Token` header). Populates an `Actor` value in context (member_id, staff_id, capabilities). Existing `auth.Middleware` still runs first.
- **Files**: `backend/internal/auth/actor.go` (new)
- **Acceptance**: an endpoint that requires `can_void` returns 403 if the actor lacks it, regardless of which path supplied the actor.

### T9.4 — Capability checks on sensitive endpoints (sonnet)
Add `RequireCapability("can_void")` etc. to adjustments handlers (void, comp, refund), cashdrawer close, reports endpoints. Wire `actor_id` into audit_log writes everywhere financial mutations happen.
- **Files**: `backend/internal/handlers/adjustments/handler.go`, `backend/internal/handlers/cashdrawer/handler.go`, `backend/internal/handlers/payroll/handler.go`, `backend/internal/handlers/data/audit.go`
- **Acceptance**: a member with `role=staff` and no `can_void` capability gets 403 trying to void; the same member with `can_void=true` succeeds and the audit row records their member_id.

### T9.5 — Frontend uses actor-overlay (sonnet)
`/s/:slug` keypad calls `POST /pos/pin-verify` and stores the actor token in memory (NOT localStorage) for the device session. Every POS / KDS mutating call sends `X-Actor-Token`. Auto-expires after 15 min idle; quick re-PIN. Capability flags drive UI: void / comp buttons hidden when missing.
- **Files**: `src/pages/staff-pin/index.jsx`, `src/lib/actor-token.js` (new), `src/services/api-client.js`, `src/pages/pos/workspace.jsx`
- **Acceptance**: visible POS controls match the actor's capabilities; idle for 15 min and the next action re-prompts for PIN.

---

# Wave 10 — USD billing via FX

**Why now**: BeepBite subscriptions are priced globally in USD; we charge in the merchant's local currency via Paystack at a snapshot rate so neither party guesses FX. All `sonnet`, 3 parallel.

**Migration numbers owned**: none — `exchange_rates` and `subscription_invoices` (with USD + local + rate snapshot) ship in consolidated migration 008.

### T10.1 — Pick the FX provider (sonnet, RESEARCH)
Decide between **openexchangerates.org**, **exchangerate.host**, **exchangerate-api.com**, **frankfurter.app**, **currencylayer.com**, **fixer.io** for our hourly (or 2-hourly) fetch. Constraints:
- Free tier supports at least USD→ZAR, USD→NGN, USD→KES, USD→GHS, USD→EUR, USD→GBP, USD→USD pass-through.
- 720+ requests/month (one per hour) on free tier, or 360+ (one per 2h). Document the cap.
- Stable for ≥3 years; ideally returns ECB or central-bank-sourced rates.
- HTTPS, no auth or simple API-key auth.

Output: short doc at `docs/fx-provider.md` with the chosen provider, the rationale, the env-var name, the request shape, and the rate-limit posture. Set `FX_PROVIDER` accordingly and update [tasks.md](./tasks.md) and [ROADMAP.md](./ROADMAP.md). No code in this task.
- **Files**: `docs/fx-provider.md` (new), this file's env-var table
- **Acceptance**: a one-page doc, a clear pick, a working `curl` example for USD→ZAR.

### T10.2 — `exchange_rates` schema (sonnet)
Migration 52:
- `exchange_rates` (id, base_code text, quote_code text, rate numeric(20,10), source text, fetched_at timestamptz, expires_at timestamptz) — index on `(base_code, quote_code, fetched_at DESC)`.
- `subscription_invoices` (org_id, period_start, period_end, amount_usd_cents bigint, amount_local_cents bigint, currency_code text, fx_rate_snapshot numeric(20,10), fx_fetched_at timestamptz, provider_txn_id text, status, created_at, paid_at).
- View `latest_exchange_rate(base, quote)` returns most recent non-expired row.
- **Files**: `backend/migrations/20240101000052_exchange_rates_and_subscription_invoices.sql` (new)
- **Acceptance**: clean reset; a manual INSERT into `exchange_rates` is reflected in `latest_exchange_rate('USD','ZAR')`.

### T10.3 — Hourly FX fetch worker (sonnet)
`internal/jobs/fxrates/` worker. On startup and every `FX_FETCH_INTERVAL` (default 1h), fetches USD→{ZAR,NGN,KES,GHS,EUR,GBP,USD} from the chosen provider (T10.1), inserts an `exchange_rates` row with `expires_at = now() + interval '1.5 * FX_FETCH_INTERVAL'`. Single-instance lock via `pg_advisory_lock` so multiple replicas don't all fetch.
- **Files**: `backend/internal/jobs/fxrates/runner.go` (new), `backend/internal/jobs/fxrates/provider_*.go` (per-provider client), `backend/cmd/server/main.go` (start goroutine)
- **Acceptance**: server boot inserts initial rates; subsequent rows appear hourly; advisory-lock smoke test in Wave 14.

### T10.4 — Subscription invoice generator (sonnet)
Job runs monthly: for each org on a paid `subscription_plans` tier, generate a `subscription_invoices` row (USD amount = plan's USD price, look up latest FX rate to org's local currency, snapshot the rate). Charges via Paystack/Stripe in local currency. On webhook success, sets `paid_at`.
- **Files**: `backend/internal/jobs/subscription_billing/runner.go` (new), `backend/internal/handlers/billing/invoices.go` (new)
- **Acceptance**: invoice row stores both currencies + snapshot rate; UI in `/settings/billing` shows USD price AND ZAR charge with the rate displayed.

---

# Wave 11 — POS dual UI + full workspace hardening

**Why now**: the data model needs modifier groups and courses to support real restaurants; the workspace UI needs the missing void / split / discount controls. All `sonnet`, 6 parallel.

**Migration numbers owned**: 53, 54.

### T11.1 — Modifier groups + modifiers schema (sonnet)
Migration 53:
- `modifier_groups` (item_id, name, min_select, max_select, is_required, sort_order).
- `modifiers` (group_id, name, price_cents, is_default, sort_order, is_available).
- `order_item_modifiers` (order_item_id, modifier_id, price_cents_snapshot).
- Migrate existing `item_variations`/`item_variation_options` data into the new shape via a one-shot UPSERT in the migration; keep old tables for one release for safety.
- **Files**: `backend/migrations/20240101000053_modifier_groups.sql` (new)
- **Acceptance**: clean reset; every existing item with variations has equivalent modifier_groups; old endpoints continue to work via a compat view.

### T11.2 — Courses table + order item assignment (sonnet)
Migration 54:
- `courses` (location_id, name, sort_order, fire_on_previous_course_bumped bool default false).
- Add `course_id uuid REFERENCES courses(id)` to `order_items` (nullable; existing `course_number` int kept for back-compat).
- Trigger: when a course-tagged ticket is bumped and `fire_on_previous_course_bumped=true`, enqueue the next course's items into `kds_fanout_queue`.
- **Files**: `backend/migrations/20240101000054_courses.sql` (new)
- **Acceptance**: a 3-course order fires only the first course on order create; bumping fires the next.

### T11.3 — POS workspace: modifier picker + course assignment (sonnet)
`/pos/workspace` ticket panel: when an item with modifier_groups is tapped, present a modifier picker (respect min/max/required). Per-item course dropdown sitting on each ticket line.
- **Files**: `src/pages/pos/workspace.jsx`, `src/pages/pos/components/modifier-picker.jsx` (new), `src/pages/pos/components/course-select.jsx` (new), `src/services/pos.js`
- **Acceptance**: an item with a required modifier group cannot be added without a selection; course label appears on the printed kitchen ticket.

### T11.4 — POS workspace: void / comp / discount inline (sonnet)
Move the adjustments demo at `/dev/adjustments` into the workspace ticket panel. Right-click (or long-press on touch) a line item → menu → Void / Comp / Discount → reason picker → optional manager PIN challenge (driven by `requires_manager_approval` on `adjustment_reasons`).
- **Files**: `src/pages/pos/workspace.jsx`, `src/pages/pos/components/adjustment-menu.jsx` (new), removal of `/dev/adjustments` route
- **Acceptance**: manager-required reason triggers PIN modal; success updates the line and writes `order_adjustments` + `audit_log`.

### T11.5 — POS workspace: split tender + split-check by seat (sonnet)
Tender modal supports splitting one ticket across multiple payment methods (cash + card + gift card + house account). Split-check by seat uses existing `check_splits`/`check_split_items` schema; each split gets its own tender flow.
- **Files**: `src/pages/pos/workspace.jsx`, `src/pages/pos/components/tender-modal.jsx`, `src/pages/pos/components/split-by-seat.jsx` (new)
- **Acceptance**: a $30 order paid $10 cash + $20 card produces two `order_payments` rows summing to total; tax distributes proportionally; split-by-seat yields two checks each with their own subtotal.

### T11.6 — Quick POS chrome-less kiosk (sonnet)
`/home` quick POS gets a chrome-less variant at `/q/:slug` (no top bar, no sidebar, single page) for counter-service kiosks. Same `POST /pos/orders` backend; UX collapses the cart and grid into a single full-screen view; tender flow inline.
- **Files**: `src/routes.jsx`, `src/pages/quick-pos/*` (new), reuse home components
- **Acceptance**: opens in Chrome kiosk mode without scrollbars or browser chrome; tap-to-order-to-tender in under 5 taps.

---

# Wave 12 — KDS hardening + UI completeness

**Why now**: cleanup pass on the kitchen surface after Wave 6 fixed the resilience holes. All `sonnet`, 4 parallel.

**Migration numbers owned**: 55.

### T12.1 — Category routing + display groups + 'ready' event (sonnet)
Migration 55:
- `category_station_routing` (category_id, station_id, is_primary) for category-level routes; fan-out resolves item route first, then category fallback.
- `kds_display_groups` (location_id, name, station_ids uuid[], display_order, auto_recall_seconds).
- Add `'ready'` and `'served'` to `kds_ticket_events.event_type` CHECK.
- **Files**: `backend/migrations/20240101000055_kds_routing_and_groups.sql` (new)
- **Acceptance**: an item with no item-level routing falls back to its category's primary station; display groups persist; bump → `'served'` event recorded.

### T12.2 — Fix KDS N+1 queries (sonnet)
`kds.Store.GetTicketDetail` and `ListStationTickets` currently fire 1 + 3N queries. Replace with single queries using `jsonb_agg` subqueries (`json_build_object` over the joined rows) or batched `WHERE ticket_id = ANY($1)` with Go-side grouping.
- **Files**: `backend/internal/handlers/kds/store.go`
- **Acceptance**: benchmark shows ≥80% reduction in query count; integration test covers the new query.

### T12.3 — KDS bump-bar keyboard hotkeys (sonnet)
`/kds/:stationId` listens for hotkeys: `1`-`9` bumps the Nth ticket; `r` recalls last bumped; `space` bumps the focused ticket; `?` shows a hotkey overlay. Persists focus across re-renders.
- **Files**: `src/pages/kds/station.jsx`, `src/pages/kds/hooks/use-hotkeys.js` (new)
- **Acceptance**: line cook can run the station with no mouse; overlay documents every key.

### T12.4 — Station-config UI (sonnet)
New `/settings/kitchen` page: list stations, drag categories → station to bind, drag items → station, edit display groups. Reads/writes via the generic data handler against `kitchen_stations`, `item_station_routing`, `category_station_routing` (T12.1), `kds_display_groups`.
- **Files**: `src/pages/settings/kitchen/*` (new)
- **Acceptance**: a fresh location can be fully kitchen-routed in <5 minutes.

---

# Wave 13 — Offline Tier 1 (network resilience)

**Why now**: loadshedding tolerance + global flaky-network resilience. Tier 1 is "30s–2min outage is invisible to the user." All `sonnet`, 5 parallel.

**Migration numbers owned**: 56.

### T13.1 — Client-ID + idempotency on orders (sonnet)
Migration 56:
- Remove `DEFAULT gen_random_uuid()` from `orders.id` and `order_items.id`; PK now accepts client-supplied ULIDs (still uuid-compatible — ULIDs encode as uuids).
- Add `client_id text UNIQUE` and `idempotency_key text` columns to `orders` and `order_items`. Existing client-supplied uuid in `orders.id` stays; new clients send ULIDs.
- **Files**: `backend/migrations/20240101000056_client_ids_and_idempotency.sql` (new)
- **Acceptance**: server accepts client-supplied `id`; duplicate `id` returns 409 with the existing row; duplicate `idempotency_key` returns 200 with the existing row.

### T13.2 — Idempotency middleware on all POS mutating routes (sonnet)
Extend the existing `internal/idempotency/` package to cover **every** POS-side mutating endpoint, not just `/data/orders` + `/data/order_payments`. Includes `pos/orders`, `pos/orders/:id/charge`, `kds/tickets/:id/bump`, `cashdrawer/*`, `adjustments/*`.
- **Files**: `backend/internal/handlers/pos/handler.go`, `backend/internal/handlers/kds/handler.go`, `backend/internal/handlers/cashdrawer/handler.go`, `backend/internal/handlers/adjustments/handler.go`, `backend/internal/idempotency/middleware.go`
- **Acceptance**: replaying a captured POST with the same `Idempotency-Key` produces the original 2xx, not a duplicate side-effect.

### T13.3 — Service worker + Workbox (sonnet)
Vite PWA plugin (`vite-plugin-pwa`) + Workbox config. Cache app shell + static assets. Cache the menu snapshot per store on visit (cache-first, ~5 minute stale-while-revalidate). Background sync queue for POST requests tagged `bb-sync`.
- **Files**: `vite.config.js`, `src/sw-register.js` (new), `package.json`
- **Acceptance**: install the PWA; offline-mode in DevTools; app shell + last-loaded menu still render; tap "place order" — request queues and replays on reconnect.

### T13.4 — IndexedDB mutation queue (sonnet)
`src/lib/sync-queue.js` provides `enqueueMutation({ url, method, headers, body, idempotencyKey })`. Persists to IndexedDB (`idb` library). Background reconnect listener replays pending entries; on 409/conflict, surfaces a one-tap "review conflict" UX. ULID generator client-side.
- **Files**: `src/lib/sync-queue.js` (new), `src/lib/ulid.js` (new), `src/services/api-client.js` (route POST/PUT/PATCH through queue when offline)
- **Acceptance**: kill the network in DevTools, place 3 orders in 60s, restore network, all 3 sync in order; each order has the client-generated ULID server-side.

### T13.5 — KDS SSE missed-events cursor (sonnet)
Today's SSE stream just pushes new events. Add `?since_event_id=<uuid>` so a reconnecting client replays missed events since its last seen ID. Server keeps an in-memory ring buffer of last 1000 events per station; falls back to DB query for older.
- **Files**: `backend/internal/handlers/kds/sse.go`, `src/pages/kds/hooks/use-sse.js`
- **Acceptance**: disconnect a KDS screen for 30s, reconnect, missed bump/recall events replay; no gaps.

---

# Wave 14 — Testing infrastructure (smoke + e2e + seeded fixtures)

**Why now**: pen-test wave (15) needs reliable scenario tooling. CI needs a green path that actually runs Go tests. All `sonnet`, 6 parallel except where noted.

### T14.1 — Fixtures package with seeded multi-tenant data (sonnet)
`backend/cmd/tests/fixtures/seed.go` exports typed seed helpers: `SeedOrg(name)`, `SeedLocation(orgID, slug, city)`, `SeedMember(orgID, role, caps)`, `SeedStaff(locID, displayName, pin)`, `SeedMenu(locID)`, `SeedKitchen(locID)`, `SeedPaymentProvider(locID, code, testKeys)`. Returns a `SeedResult` struct that owns its cleanup. Crucially, seeds **two orgs in every scenario by default** so cross-tenant probes are trivial.
- **Files**: `backend/cmd/tests/fixtures/seed.go` (new), `backend/cmd/tests/fixtures/cleanup.go` (new)
- **Acceptance**: `cmd/tests --seed` creates two orgs with full menus, staff, payment providers; teardown leaves no orphans.

### T14.2 — Ephemeral Postgres via testcontainers (sonnet)
New `backend/cmd/tests/testenv/` package boots a Postgres container, runs `cmd/migrate`, returns a `*pgxpool.Pool`. Wraps the existing `_test.go` integration tests so they no longer require an external `TEST_DATABASE_URL`. `TestMain` in `cmd/tests/testenv_test.go` is the entry point for `go test ./cmd/tests/...`.
- **Files**: `backend/cmd/tests/testenv/postgres.go` (new), `backend/go.mod` (testcontainers-go), `Makefile` (new)
- **Acceptance**: `make test` from a fresh checkout passes without preexisting DB; existing `_test.go` files updated to use the helper.

### T14.3 — Smoke suite expansion (sonnet)
Extend the existing `cmd/tests/main.go` runner with these new suites (one Go file each):
- `suite_staff.go` — staff create, set-pin, pin-login, manager-set-password.
- `suite_pos.go` — POS CreateOrder via typed handler, idempotency, ULID client-supplied ID.
- `suite_kds.go` — list tickets per station, bump → status transition, recall, rush.
- `suite_cashdrawer.go` — open + close + movement events.
- `suite_audit.go` — void / comp / refund leave `audit_log` rows with non-null `actor_id`.
- `suite_actor_overlay.go` — pin-verify happy path + lockout + capability check.

Each suite ≤30s. `--all` runs them all in <2 minutes.
- **Files**: `backend/cmd/tests/suite_staff.go`, `suite_pos.go`, `suite_kds.go`, `suite_cashdrawer.go`, `suite_audit.go`, `suite_actor_overlay.go` (all new)
- **Acceptance**: `go run ./cmd/tests --all` returns 0 failures against a seeded env.

### T14.4 — End-to-end scenarios (sonnet)
`backend/cmd/tests/e2e/` package with scenario-style tests:
- `e2e_onboard_tenant_test.go` — signup → org → location with slug → menu → publish.
- `e2e_pos_flow_test.go` — staff PIN-login → dine-in order → KDS bump → settle cash.
- `e2e_payment_flow_test.go` — hosted checkout (stub provider) → webhook → audit → void → refund.
- `e2e_chatbot_flow_test.go` — WhatsApp inbound → slug search → cart → order → KDS ticket.
- `e2e_marketplace_test.go` — two stores in same city → search returns both → order via slug.
- `e2e_delivery_zone_test.go` — polygon zone → in-zone address → fee applied → out-for-delivery transition.

Each scenario uses `fixtures.SeedOrg` to set up its own tenants and tears them down.
- **Files**: `backend/cmd/tests/e2e/*.go` (new)
- **Acceptance**: `go test ./cmd/tests/e2e/...` runs in ≤5 minutes against testcontainers.

### T14.5 — CI workflow (sonnet)
New GitHub Actions workflow `.github/workflows/test.yml`. Steps: `go build ./...`, `go test ./...`, then boot the server with a fresh ephemeral DB, then `go run ./cmd/tests --all`. Also `npm ci`, `npm run build`, `npm run test:run` (Vitest, set up in T14.6). Runs on every push and PR.
- **Files**: `.github/workflows/test.yml` (new)
- **Acceptance**: PRs that break a smoke or unit test fail CI; a green PR is a deployable PR.

### T14.6 — Vitest setup for frontend (sonnet)
Install Vitest + Testing Library. Add `npm run test:run` script. Write seed unit tests for `src/lib/currency.js`, `src/lib/ulid.js`, `src/lib/sync-queue.js`, `src/lib/actor-token.js`. Add 1–2 component tests for the PIN keypad and the modifier picker.
- **Files**: `package.json`, `vitest.config.js` (new), `src/**/*.test.{js,jsx}` (new)
- **Acceptance**: `npm run test:run` succeeds with at least 8 passing tests; CI runs it.

### T14.7 — Comprehensive feature parity test pass (sonnet, fan-out)
Read `docs/feature-parity.md` (output of T0.A.1b). For every feature marked **v1**, verify a smoke or e2e test exists that exercises it. Gap report at `docs/test-coverage-matrix.md` — three columns: feature, status (covered/partial/missing), test file. Missing coverage spawns a follow-up smoke task. This task is itself **fan-out**: open one sub-task per ~10 features so multiple sonnet agents can work in parallel.
- **Files**: `docs/test-coverage-matrix.md` (new), one or more `backend/cmd/tests/suite_<feature>.go` files (new) for each gap.
- **Acceptance**: matrix lists every v1 feature; every "missing" row gets either a new smoke suite or an explicit "deferred to v2" note that updates `feature-parity.md` accordingly.

### T14.8 — Subdomain routing integration test (sonnet)
Test the wildcard subdomain middleware (T7.6). Boot the server, fire requests with different `Host` headers, assert the resolved `location_id` in the response. Cover reserved subdomains (api, app, www, admin) and unknown subdomains (404). Frontend test: load the SPA with a stubbed `window.location.hostname` and verify `StoreContext` resolves correctly.
- **Files**: `backend/cmd/tests/suite_subdomain.go` (new), `src/context/store-context.test.jsx` (new)
- **Acceptance**: 6+ subdomain scenarios pass; CI runs the suite.

### T14.9 — On-delivery payment flow e2e (sonnet)
End-to-end scenario: seed a store with no `location_payment_credentials` and `on_delivery_payment_methods=['cash','card_machine']`. Walk through marketplace checkout → confirm `pending_on_delivery` status → staff PIN-login → mark-paid-on-delivery (cash) → verify `order_payments` row + audit log + capability check enforces `can_settle`.
- **Files**: `backend/cmd/tests/e2e/e2e_on_delivery_payment_test.go` (new)
- **Acceptance**: scenario passes; capability bypass attempt (PIN without `can_settle`) returns 403.

### T14.10 — Driver portal e2e (sonnet)
Seed two orgs (A, B); seed one driver invited to both; seed one delivery order at each. Walk through: driver signs in → `/driver` shows both orders → accept A's → pickup → ping (in radius) → mark delivered. Then verify org-A staff CANNOT see org-B order assignments, and vice versa, in their dashboards (cross-org RLS holds for driver_assignments).
- **Files**: `backend/cmd/tests/e2e/e2e_driver_portal_test.go` (new)
- **Acceptance**: scenario passes including the cross-tenant RLS check.

### T14.11 — Live tracking radius gate (sonnet)
Seed an order in `out_for_delivery`. Driver ping at 10 km from delivery address → `/api/orders/:id/track` returns ETA but no driver coordinates. Move ping to 3 km → coordinates appear. Move to 6 km → coordinates hidden again. Switch the JWT to a different customer → 403.
- **Files**: `backend/cmd/tests/e2e/e2e_live_tracking_test.go` (new)
- **Acceptance**: every case returns the expected shape; failing a single case fails the suite.

### T14.12 — WhatsApp link flow e2e (sonnet)
Simulate inbound WhatsApp from unknown number → bot responds with link → land on `/link-whatsapp/:token` → sign in → bind → next inbound from that number proceeds to menu. Verify: replay of the same token returns "used"; 4th bind attempt returns the replace-flow signal; "/unlink" command unbinds and the next message is again welcomed as unknown.
- **Files**: `backend/cmd/tests/e2e/e2e_whatsapp_binding_test.go` (new)
- **Acceptance**: every scenario passes; assertions on whatsapp_accounts row state at each step.

---

# Wave 15 — Penetration testing (OPUS)

**Why opus**: adversarial reasoning, finding novel bypass paths, judging when an "almost-correct" defense is actually broken. Each opus task **writes failing tests first** that demonstrate the attack, then files fix-tasks back into a new wave if the attack succeeds.

**Output discipline**: every opus pen-test task ends with a report file at `docs/pentest/<topic>.md` summarising (a) attempted attacks, (b) results (defended / leaked), (c) recommended fixes referencing affected files and line numbers.

### T15.1 — Cross-tenant contamination (opus)
Build `backend/cmd/tests/pentest/crosstenant/` with tests that probe every authenticated endpoint with an org-A bearer token against org-B resources. **Every probe must return 403 or 404, never 200 with foreign data.** Coverage list (exhaustive, not aspirational):
- `GET/POST/PUT/DELETE` against `/data/{table}` for orders, order_items, order_payments, kds_tickets, kitchen_stations, staff, tables, cash_drawers, cash_drawer_sessions, gift_cards, house_accounts, bank_accounts, audit_log, exchange_rates.
- POST `/pos/orders` with foreign `location_id`, foreign `table_session_id`.
- POST `/kds/tickets/:id/bump` with foreign ticket.
- POST `/cash-drawers/:id/close` with foreign drawer.
- POST `/orders/:id/void` with foreign order.
- POST `/staff/:id/set-pin` with foreign staff.

Use `fixtures.SeedOrg` to set up two orgs. The test fails if any probe leaks data.
- **Files**: `backend/cmd/tests/pentest/crosstenant/*.go` (new), `docs/pentest/crosstenant.md` (new)
- **Acceptance**: every endpoint listed returns 403/404 with org-A bearer hitting org-B IDs; the report names every endpoint tested and the result for each.

### T15.2 — Auth & session adversarial (opus)
`backend/cmd/tests/pentest/auth/`. Coverage:
- Refresh-token rotation: capture refresh A, rotate to B, replay A → all sessions for that user revoked.
- Audience-claim tampering: take a member access token, strip `aud` or swap to `"staff"`, hit a staff-only endpoint → 401.
- Cross-surface token reuse: staff token against member-only endpoint and vice versa.
- Lockout bypass via parallel requests: fire 20 concurrent wrong PINs; verify exactly 5 increments before lockout (no race that allows >5).
- JWT signature swap: re-sign with a guessed weak secret → 401.
- Missing-bearer / malformed-bearer / wrong-prefix variants.
- Idle-session token replay after the actor-overlay 15-min TTL.
- **Files**: `backend/cmd/tests/pentest/auth/*.go` (new), `docs/pentest/auth.md` (new)
- **Acceptance**: every attack class is captured by a test that currently passes (= defends correctly) or files a fix-task in a new Wave 16 if a leak is found.

### T15.3 — Payments adversarial (opus)
`backend/cmd/tests/pentest/payments/`. Coverage:
- Webhook signature replay: capture a valid Paystack webhook, replay it → second time should be a no-op (idempotency).
- Forged webhook: HMAC with a guessed secret → 401.
- Currency manipulation: place a $10 USD order, intercept the provider-init call, swap currency to ZAR → server must reject (currency must match `locations.default_currency_code`).
- Price tampering: POST `/pos/orders` with a line price below the menu price → server must reprice from the menu and reject or recompute.
- Idempotency-key replay across different orders: same key, different body → server must 409 (request-hash collision).
- Webhook URL guessing: POST to `/webhooks/paystack/<random-locID>` → 404 (no leak of valid IDs).
- Refund amount > original charge → reject.
- **Files**: `backend/cmd/tests/pentest/payments/*.go` (new), `docs/pentest/payments.md` (new)
- **Acceptance**: every attack class blocked; report lists exact response codes and the defending code path.

### T15.4 — Marketplace adversarial (opus)
`backend/cmd/tests/pentest/marketplace/`. Coverage:
- Slug enumeration: scrape `/stores?q=` with common substrings, verify only `is_marketplace_visible=true` stores appear (the migration in T7.1 should default new stores to NOT visible until owner opts in).
- IDOR on `/stores/:slug/menu`: a private store responds 404 even if slug is guessed.
- XSS in store name / description / item name / item description: render in the chatbot HTML reply and in the React marketplace page; verify proper escaping.
- Order injection via inflated quantities / negative quantities / oversized strings.
- Bot abuse: 1000 reqs/min from one IP on `/stores` → rate limit response.
- **Files**: `backend/cmd/tests/pentest/marketplace/*.go` (new), `docs/pentest/marketplace.md` (new)
- **Acceptance**: leaks documented and fixed before marketplace public launch.

### T15.6 — Driver location privacy adversarial (opus)
`backend/cmd/tests/pentest/driver_privacy/`. Coverage:
- Without a tracking token: try `GET /driver_location_pings` via the data handler with an attacker JWT (no driver role). Expect empty (RLS).
- With a stale tracking token (order delivered an hour ago): track endpoint must refuse fresh pings.
- Outside the 5 km radius: precise coordinates must NOT appear in response (only ETA / progress bar).
- Customer A's token used to view Customer B's order: 403.
- Driver A in org X tries to read driver B's pings in org Y: 403/empty even if both orgs share the driver.
- "Share trip" token leak: a stolen share-trip token should expire on delivered.
- Coordinate-precision attack: probe whether the rounded "outside-radius" response leaks enough to triangulate driver location across repeated calls — verify it returns a stable, low-precision blob, not a raw coordinate.
- **Files**: `backend/cmd/tests/pentest/driver_privacy/*.go` (new), `docs/pentest/driver-privacy.md` (new)
- **Acceptance**: every attack class blocked; report names specific defending code paths.

### T15.7 — WhatsApp account hijack adversarial (opus)
`backend/cmd/tests/pentest/whatsapp_binding/`. Coverage:
- Token enumeration: try sequential / brute-forced `whatsapp_link_tokens` values; expect 404 (tokens are cryptographically random and indexed-but-not-leaked).
- Token replay after `used_at`: subsequent bind attempt returns 410 Gone.
- Cross-account binding: attacker JWT calls `POST /api/whatsapp/link/:token/bind` for a token minted for someone else's phone — should succeed (token IS the secret) but ONLY if attacker is the JWT-holder choosing to claim. Verify the bot's "first message after bind" goes to the new account, not the old; verify there is no path for the original phone owner to unwittingly become bound to attacker's account.
- 4th-binding bypass: try multiple parallel bind requests when account has 2 numbers, racing toward 4. Verify the database constraint enforces ≤3 atomically.
- Unlink-without-confirmation: try POST `/unlink` without the chatbot's confirmation step.
- Replace-flow CSRF: token from one tab + replace target from another → must reject.
- **Files**: `backend/cmd/tests/pentest/whatsapp_binding/*.go` (new), `docs/pentest/whatsapp-binding.md` (new)
- **Acceptance**: every attack class blocked; specifically the 4-number race condition is shown to be tight (no successful 4th).

### T15.5 — Injection + abuse (opus)
`backend/cmd/tests/pentest/injection/`. Coverage:
- SQL injection in filter values: extend the existing `--pentest` suite with edge cases (unicode, double-encoding, second-order via stored strings).
- Header spoofing: `X-Forwarded-For` / `X-Real-IP` / `Host` manipulation for rate limit bypass.
- Path traversal: `/data/{table}` with `../` or null bytes in IDs.
- Mass assignment: POST a body with fields the API doesn't document (e.g., `is_admin: true`); ensure unknown fields are rejected or ignored.
- LDAP / NoSQL / template injection patterns (best-effort sweep).
- **Files**: `backend/cmd/tests/pentest/injection/*.go` (new), `docs/pentest/injection.md` (new)
- **Acceptance**: every attack class blocked; report names the specific input that defends.

---

# Wave 16 — Drivers, delivery portal, live tracking

**Why now**: in-house delivery is differentiating; partner-based delivery (Uber Eats / DoorDash) stays for later. Driver portal exposes per-driver, per-store aggregation that no existing handler supports. Schema lives in Wave 0; this wave is application code. All `sonnet`, 6 parallel.

**Migration numbers owned**: none (driver tables + assignments + pings + tracking-tokens all in consolidated migrations 002, 007, 011).

### T16.1 — Driver invite + role onboarding (sonnet)
A store owner / manager invites a person by email with role `'driver'` and capability `can_drive:true`. The invite flow already exists for org members — extend it to surface the driver role explicitly in `/staff/manage` UI. Email-match auto-acceptance on signup is unchanged.
- **Files**: `backend/internal/handlers/data/allowlist.go` (verify `driver` role accepted), `src/pages/staff/manage.jsx`, `src/pages/staff/manage/invite-driver-modal.jsx` (new)
- **Acceptance**: owner invites `driver@example.com`; driver signs up; their membership row has `role='driver'`, `capabilities->'can_drive'=true`; appears under "Drivers" tab in `/staff/manage`.

### T16.2 — Driver portal backend endpoints (sonnet)
New handler `internal/handlers/driverportal/`. Endpoints:
- `GET /driver/me` — current driver's profile + list of orgs they have `driver` role in.
- `GET /driver/orders` — union of active `driver_assignments` across every org the caller drives for, plus eligible-to-claim orders (assignment status `'offered'`) within the driver's preferred radius.
- `POST /driver/orders/:id/accept` — accept an offered assignment.
- `POST /driver/orders/:id/pickup` — mark picked up (sets `picked_up_at`, transitions order to `out_for_delivery`).
- `POST /driver/orders/:id/deliver` — mark delivered.
- `POST /driver/ping` — record location ping (rate-limited at 1/5s per driver). Body: `{lat, lng, accuracy_m, heading_deg, speed_mps}`.
- `POST /driver/shift/start`, `POST /driver/shift/end`, `POST /driver/shift/pause`.

All endpoints enforce `has_capability('can_drive')`. Cross-org aggregation works because RLS lets the driver see rows in every org they're a member of, automatically.
- **Files**: `backend/internal/handlers/driverportal/{handler,store}.go` (new)
- **Acceptance**: driver-of-org-A-and-B sees orders from both in `/driver/orders`; non-driver gets 403; ping rate-limit returns 429 on burst; pickup transitions order status and triggers KDS event.

### T16.3 — Driver portal frontend (sonnet)
New route `/driver` (not nested under any tenant). Anyone can navigate. If signed-in user has zero `driver` memberships: empty-state card explaining the invite flow. If has memberships: live map (Leaflet, no Mapbox dep) with active deliveries, sliding panel of orders to accept, big toggle for online/offline. Mobile-first layout — drivers use phones.
- **Files**: `src/routes.jsx`, `src/pages/driver/*` (new), `src/services/driver.js` (new)
- **Acceptance**: works in mobile viewport (375px wide); online toggle starts a geolocation watch that POSTs `/driver/ping` every 5s; status transitions show on the map in real time (poll or SSE — poll first, SSE later).

### T16.4 — Customer-facing live tracking page (sonnet)
New route `/track/:token` (works on any host: `app.beepbite.io/track/...` and `mystore.beepbite.io/track/...`). Page loads if (a) caller has a valid JWT, (b) JWT's profile matches the order's customer profile, (c) `order_tracking_tokens.expires_at > now() AND revoked_at IS NULL`. Renders: store pin, delivery address pin, driver pin (only if `pings_visible_to_customer` returns non-null). Outside the 5-km radius the page shows ETA and a stylized progress bar instead of an exact marker.
- **Files**: `src/pages/track/index.jsx` (new), `backend/internal/handlers/tracking/handler.go` (new — `GET /api/orders/:id/track?token=...`)
- **Acceptance**: customer can view own order; another customer's token returns 403; canceled order returns "order canceled"; driver more than 5 km away → map shows store + dest only, no driver marker; ETA is computed from last ping.

### T16.5 — Driver dispatch flow (sonnet)
When an order is paid and in `out_for_delivery` (or transition trigger fires), insert a `driver_assignments` row in `'offered'` status for the location's eligible drivers (within their preferred radius and currently online). First driver to call `/driver/orders/:id/accept` wins via `UPDATE ... WHERE status='offered'` returning affected rows; others get a 409. Also wire a manager-side "assign driver" override on the order detail.
- **Files**: `backend/internal/jobs/dispatch/runner.go` (new), `backend/internal/handlers/orders/assign_driver.go` (new), `src/pages/order-detail/assign-driver-modal.jsx` (new)
- **Acceptance**: paid delivery order generates offered-assignments; first accept wins; manual override works; idle order with no acceptance for 5 min triggers re-offer to a wider radius.

### T16.6 — Privacy safety guardrails (sonnet)
- Pings older than 7 days deleted nightly via the existing audit-retention job (add a job for it).
- Driver "share trip" link: a driver can copy a one-tap link that grants a chosen contact (separate from the customer) view-only access to their live location for the duration of the trip. Uses a separate `share_trip_token`.
- Emergency contact widget on the driver portal — one big button surfaces the configured number.
- Driver location is NOT exposed on any handler other than `/api/orders/:id/track`; even the owner of the store can only see "driver assigned, ETA X min" — not exact coordinates — unless the driver explicitly opts in.
- **Files**: `backend/internal/jobs/auditretention/runner.go`, `backend/internal/handlers/driverportal/share_trip.go` (new), `src/pages/driver/components/emergency-button.jsx` (new)
- **Acceptance**: store owner SELECT on `driver_location_pings` returns empty rows under RLS; only the driver themselves and the matching customer (via track endpoint) see pings; share-trip token works without requiring the contact to sign in.

---

# Wave 17 — WhatsApp account binding (max 3 numbers per email)

**Why now**: orders need real identities; live tracking needs a JWT-bound customer. The current chatbot treats each phone number as anonymous. Schema in Wave 0. All `sonnet`, 4 parallel.

**Migration numbers owned**: none (`whatsapp_accounts`, `whatsapp_link_tokens` ship in consolidated migration 002).

### T17.1 — Link-token issuance + landing endpoint (sonnet)
- `POST /api/whatsapp/link-init` (called by chatbot internally) — given a phone_e164, mints a `whatsapp_link_tokens` row with `intent='bind'`, returns the token + the constructed URL `app.beepbite.io/link-whatsapp/<token>`.
- `GET /api/whatsapp/link/:token` — returns token state (`new` / `awaiting-confirm` / `used` / `expired`) and the phone number, no auth (intentionally public — the token IS the secret).
- `POST /api/whatsapp/link/:token/bind` — requires a valid JWT; verifies the token; checks the calling profile's `whatsapp_count < 3`; inserts a `whatsapp_accounts` row; marks token used. Returns the bound phone number for the chatbot to confirm.
- **Files**: `backend/internal/handlers/whatsappauth/{handler,store}.go` (new)
- **Acceptance**: token lifecycle correct; max-3 enforced (4th attempt returns a structured error listing existing numbers for the UI to offer replacement); used token cannot be replayed.

### T17.2 — Chatbot first-message gate (sonnet)
Modify `internal/chatbot/service.go` entrypoint: on every inbound message, look up `whatsapp_accounts` by phone_e164. If not bound:
- If no active `whatsapp_link_tokens` row for this number → mint one and reply with the link only. Halt the conversation.
- If an active token exists → reply "Waiting for you to confirm at <link>" and halt.

Once bound, the message proceeds normally. Add a "/account" command that returns the bound account's email (masked) and a "/unlink" flow.
- **Files**: `backend/internal/chatbot/service.go`, `backend/internal/chatbot/account_gate.go` (new)
- **Acceptance**: unknown number gets exactly one welcome message + the link, no menu; bound number sees the menu; "/unlink" returns a confirmation question and removes the binding on yes.

### T17.3 — Link-WhatsApp landing page (sonnet)
New route `/link-whatsapp/:token` in the React app. If unauthenticated, redirects to `/signin?return_to=...` (passing the link state through). If authenticated, fetches the token state; shows: "Add **+27 12 345 6789** to your BeepBite account?" with two buttons (Add / Cancel). If account is at 3 numbers, shows the list with "Replace" buttons. On success, message: "Done. Return to WhatsApp — your next message will continue normally." Provides a deep link `whatsapp://send?phone=...` to nudge the user back.
- **Files**: `src/routes.jsx`, `src/pages/link-whatsapp/index.jsx` (new), `src/pages/link-whatsapp/replace-modal.jsx` (new)
- **Acceptance**: full flow demonstrable end-to-end with seeded fixtures; replace flow correctly unbinds the old number and binds the new; expired token shows a clean message + a "try again" CTA that pings the bot.

### T17.4 — Account management UI (sonnet)
In `/settings/account` (or under the user's profile sheet from the top-bar avatar), a "Linked WhatsApp numbers" section lists bound numbers with "Remove" buttons. Removing a number unbinds it and the bot will treat that phone as anonymous again.
- **Files**: `src/pages/settings/account/whatsapp-numbers.jsx` (new), `src/services/whatsapp-accounts.js` (new)
- **Acceptance**: user can see, add (via QR or copy-link to a bot message), and remove numbers; UI prevents going over 3.

---

# Wave 18 — Pricing model exploration (DONE)

The `pricing/` Python folder explores Flat / Per-Tx / Wallet / Freemium+Wallet / Tiered / Hybrid models against seven customer profiles (Side Hustle ZA, Small Bistro ZA, Busy NG, Multi-Loc ZA, Chain KE, US Ghost Kitchen, India Dark Store). Costs grounded in published rates (Meta WhatsApp BCAPI, Anthropic Sonnet 4.5, Twilio, Fly, R2).

**Locked model:** Tiered + Wallet (Anthropic-style). Free / Starter $39/loc / Growth $249/loc / Scale $799/loc, per-location pricing, hard-capped Free, wallet for overage. Profitable at 100 tenants with ≥10% paying conversion. 90-day inactivity auto-pause protects against zombie loss.

Run `python3 pricing/scenarios.py` to reproduce the comparison.

---

# Wave 19 — Wallet + quotas + multi-LLM provider abstraction

**Why now**: every customer-facing feature (chat, WhatsApp outbound, bulk imports) meters against the wallet/quota system. Without this, we can't ship Wave 20 (customer chat) or Wave 21 (owner WhatsApp). All `sonnet`, 8 parallel where dependencies allow.

**Migration numbers owned**: none (wallet + LLM tracking + quotas all ship in consolidated migrations 008 and 013). New migration 015 added for `llm_model_pricing` and `llm_providers` registry.

### T19.1 — Wallet domain logic (sonnet)
`internal/wallet/` package implementing:
- `Debit(ctx, orgID, kind, amountCents, refType, refID, idempotencyKey) error` — writes append-only `wallet_transactions` row, updates `org_wallets.balance_cents` atomically (single UPDATE with RETURNING), returns `ErrInsufficientFunds` if balance would go negative AND tenant is on Free tier (paid tiers can carry small negative balance for current period).
- `Credit(ctx, orgID, amountCents, kind, refID, idempotencyKey) error` — topup or refund.
- `GetBalance(ctx, orgID) (cents int64, currency string, error)`.
- `ListTransactions(ctx, orgID, since, limit) ([]Transaction, error)` — paginated.
- Idempotency-key enforcement via the existing `idempotency_keys` table.
- **Daily drain ceiling**: SUM of debits in last 24h > max($200, 50% of starting balance) requires re-PIN (returns a structured error the handler converts to 402 Payment Required + actor-overlay challenge).
- **Push + email on every $20+ debit** (writes to `notification_queue`, processed by Wave 21 owner-notification worker).
- **Files**: `backend/internal/wallet/{service,store,store_test}.go` (new)
- **Acceptance**: parallel debits don't double-spend (verified by race test); idempotent retries return the same result; drain ceiling triggers correctly.

### T19.2 — Wallet topup flow + payment-provider integration (sonnet)
`internal/handlers/wallet/` HTTP handlers + the topup state machine:
- `POST /wallet/topup` — initiates topup. Body: `{amount_cents, currency_code}`. Resolves tenant's payment provider (Wave 8 BYO keys or platform fallback), calls `Provider.InitCheckout`, returns hosted-payment URL.
- `POST /wallet/topup/:id/confirm` — internal, called from payment webhook on success. Credits wallet, marks topup `succeeded`.
- `POST /wallet/topup/:id/cancel` — failure/cancel path.
- `GET /wallet/balance`, `GET /wallet/transactions`.
- **Files**: `backend/internal/handlers/wallet/{handler,store}.go` (new), `backend/internal/payments/webhook_dispatch.go` (wire topup confirmation)
- **Acceptance**: end-to-end: tenant tops up $50 via Paystack sandbox → webhook fires → balance reflects + `wallet_transactions` row.

### T19.3 — Quota tracking + enforcement middleware (sonnet)
`internal/quota/` package:
- `quotas` table stores per-(org, location, resource_kind, period_start) limit and used.
- Resource kinds: `orders`, `whatsapp_outbound`, `llm_messages_customer`, `llm_messages_owner`, `bulk_imports`, `marketing_broadcasts`.
- Period: monthly, aligned to billing anniversary per org (UTC date of org creation).
- `CheckAndIncrement(ctx, orgID, locID, kind, units) (decision Decision, err error)`:
  - If under quota AND tier is Free: allow, increment, return `Decision{allowed: true, reason: 'free_quota'}`.
  - If under quota AND tier is paid: allow, increment, no charge (within-tier).
  - If over quota AND tier is paid: increment quota_usage, ALSO debit wallet at the tier's per-unit overage rate. Return `Decision{allowed: true, reason: 'wallet_overage', debited_cents: X}`.
  - If over quota AND tier is Free: return `Decision{allowed: false, reason: 'free_hard_cap', upgrade_url: ...}`.
- HTTP middleware `RequireQuota(kind, unitsFunc)` wraps handlers. Failure → 402 with structured response containing tier info + upgrade URL.
- **Files**: `backend/internal/quota/{service,store,middleware}.go` (new)
- **Acceptance**: free-tier exceeds cap returns 402; paid tier exceeds included quota debits wallet + writes audit; concurrent increments don't lose counts.

### T19.3b — Wallet auto-refill cron + saved payment method (sonnet)
**Critical**: this is how the platform gets paid. The auto-refill cron is the heartbeat of the wallet model.

Schema additions (fold into Wave 0 / 008):
- `org_wallets`: add `auto_refill_enabled bool default true`, `auto_refill_threshold_cents bigint default 500` ($5), `auto_refill_target_cents bigint default 5000` ($50), `saved_payment_method_id text` (provider's token), `saved_provider_code text`.
- `wallet_topup_attempts` (id, org_id, requested_amount_cents, status enum `'pending|succeeded|failed_retryable|failed_permanent'`, provider_response_jsonb, attempted_at, completed_at, error_message).

Job `internal/jobs/wallet_refill/`:
- Runs every 15 minutes.
- For each org with `auto_refill_enabled=true AND balance < threshold AND no pending topup_attempt in last 24h`: queue a topup.
- For each queued topup: call `Provider.ChargeSaved(amount_to_refill_to_target)` against the saved payment method. On success → credit wallet + mark succeeded. On retryable failure (network, 5xx) → retry after 1h, max 3 retries. On permanent failure (card declined, expired) → mark `failed_permanent`, enter dunning ladder (email + WhatsApp + dashboard banner).

Dunning ladder (driven by this job):
- Day 1 fail: email + WhatsApp "Your card was declined. Please update payment method."
- Day 3: dashboard banner appears.
- Day 7: service degrades to free-tier behavior (LLM/WhatsApp/SMS disabled, POS still works).
- Day 14: auto-pause (joins the 90-day inactivity timer).

Settings UI at `/settings/billing/auto-refill` to toggle, set threshold/target, update saved payment method.
- **Files**: `backend/internal/jobs/wallet_refill/{runner,dunning}.go` (new), `backend/internal/wallet/refill.go` (new), `src/pages/settings/billing/auto-refill.jsx` (new)
- **Acceptance**: wallet below $5 → cron runs → card charged to top up to $50 → balance reflects + audit row; failed card → dunning ladder fires in order.

### T19.4 — 90-day inactivity auto-pause job (sonnet)
`internal/jobs/inactivity/` runner that nightly scans:
- Day 30 since `last_order_at` AND free tier → enqueue warning email + WhatsApp message via metering.
- Day 60 → set `organizations.banner_message` to a warning string the dashboard reads.
- Day 75 → write a `pause_scheduled_at` timestamp.
- Day 90 → set `organizations.status = 'paused'`. Marketplace surface returns "temporarily closed" for that store's slug; POS denies all mutating endpoints (read-only); chatbot replies politely that the store is paused.
- Day 180 → soft-delete (`deleted_at = now()`, 30-day recoverable).
- Day 210 → hard-delete.
- Reactivation: any wallet topup OR tier upgrade clears `status` back to `active` and resets the inactivity clock.
- **Files**: `backend/internal/jobs/inactivity/runner.go` (new), schema additions to `organizations` (`status enum`, `last_active_at`, `pause_scheduled_at`, `deleted_at`) folded into consolidated migration 002.
- **Acceptance**: simulated timeline runs the full state machine; paused org's slug returns the closed page; reactivation clears status.

### T19.5 — Anti-abuse guardrails (sonnet)
A bag of small but vital protections — each one a single small handler/middleware:
- **Signup fingerprinting**: a new `signup_fingerprints` table (ip, user_agent_hash, payment_instrument_hash, created_at). Second free-org creation from the same fingerprint cluster within 30 days returns a structured "verify with $1 wallet top-up" challenge.
- **Anonymous WhatsApp rate-limit**: unbound numbers (no `whatsapp_accounts` row) get 5 LLM-driven responses, then the bot only sends the link-binding nudge until they bind (Wave 17 flow).
- **LLM conversation cap**: middleware tracks turns per conversation_id; max 50 turns + max 10 sequential tool calls without a user message between. Breach → reset conversation, audit row, return a "let's start fresh" message.
- **Per-turn token budget**: hard caps `max_tokens` for input (5k) and output (1k). Exceeds → truncate input from middle, log a metric.
- **Bulk-import gate**: imports producing >100 items require explicit owner approval (a confirmation endpoint) before commit.
- **Marketing-category gate**: WhatsApp marketing-category sends disabled by default; per-location boolean `marketing_enabled` in settings; broadcast size capped at 1000 recipients per send.
- **No-show tracking**: `customers.no_show_count` increments on uncollected/refused-delivery orders; >3 in 90 days → soft-block (require pre-payment).
- **Files**: `backend/internal/abuse/*.go` (new package), schema additions to consolidated migrations as relevant.
- **Acceptance**: each guardrail covered by a unit test demonstrating both the allow-path and the deny-path.

### T19.6 — LLM provider abstraction + dynamic model discovery (sonnet)
`internal/llm/` package implements the provider interface and the runtime registry:

```go
type Provider interface {
    Code() string                           // "anthropic", "openai", "gemini", "moonshot"
    ListModels(ctx) ([]ModelInfo, error)    // dynamic — calls GET /v1/models
    Chat(ctx, ChatRequest) (ChatResponse, error)
    SupportsVision() bool
    SupportsToolUse() bool
}
```

Adapter packages: `internal/llm/anthropic/`, `internal/llm/openai/`, `internal/llm/gemini/`, `internal/llm/moonshot/`.

**Boot-time discovery**:
1. Read `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MOONSHOT_API_KEY` from env.
2. For each present, instantiate the provider and call `ListModels`. Skip provider on any failure (log warning, don't crash).
3. Cross-reference returned model IDs with `llm_model_pricing` table (Wave 19.7). Models without pricing data → marked unavailable.
4. Persist the discovered set to `llm_providers_models` (provider_code, model_id, available, capabilities, discovered_at).
5. Refresh every 6 hours via a goroutine.

**Cost-aware router**:
- `router.Pick(taskType, requirements)` returns the cheapest available `(provider, model)` for the task.
- Task types: `customer_chat` (cheapest tool-use model), `owner_chat` (mid-tier tool-use), `bulk_vision` (cheapest vision+tool-use), `embedding` (cheapest embedding model).
- Requirements: `vision`, `tool_use`, `min_context_tokens`, `max_latency_ms`.

**Files**: `backend/internal/llm/{provider,router,registry}.go` (new), `backend/internal/llm/{anthropic,openai,gemini,moonshot}/*.go` (new adapters)

**Acceptance**:
- With only `ANTHROPIC_API_KEY` set, only Anthropic models appear in the registry.
- With all four set but Moonshot's `/v1/models` returning 500, the registry skips Moonshot and logs a warning — boot completes.
- Adding a new model (e.g., Claude releases `claude-5-haiku`) appears in the registry within 6 hours of its launch, provided pricing data exists.
- `router.Pick("customer_chat", {tool_use: true})` returns the cheapest tool-use-capable model across enabled providers.

### T19.7 — LLM pricing sync from LiteLLM (sonnet)
`internal/jobs/llmpricesync/` job. Nightly:
1. Fetch `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`. SHA-256 the body; skip processing if unchanged.
2. Parse into our `llm_model_pricing` schema:
   ```
   provider_code, model_id,
   input_token_usd_per_million,
   output_token_usd_per_million,
   cached_input_token_usd_per_million,  -- where the source has it
   max_context_tokens, max_output_tokens,
   supports_vision, supports_tool_use, supports_function_calling,
   source = 'litellm',
   source_updated_at, fetched_at
   ```
3. UPSERT keyed by `(provider_code, model_id)`. Old rows kept (no DELETE) so a model that disappears from the source doesn't suddenly become unpriced for in-flight requests.
4. On parse failure: fall back to a snapshot at `backend/internal/llm/pricing_fallback.json` (last-known-good, committed to the repo).

Migration 015 adds `llm_model_pricing` and `llm_providers` tables — owned by this wave (the only new migration outside Wave 0).

The Python `pricing/` folder gains a `sync_llm_prices.py` that pulls the same JSON for cost-modeling exploration locally.
- **Files**: `backend/internal/jobs/llmpricesync/runner.go` (new), `backend/internal/llm/pricing_fallback.json` (new), `backend/migrations/015_llm_provider_pricing.sql` (new — the only migration outside Wave 0), `pricing/sync_llm_prices.py` (new), `pricing/llm_models.py` (new)
- **Acceptance**: server boot with no internet still works (uses fallback); first sync populates ~200 model rows; pricing change at Anthropic flows through within 24h; tested by mutating the source JSON in a fixture and re-running the job.

### T19.8 — Wallet + quota UI in settings (sonnet)
`/settings/billing` extended to surface:
- Current wallet balance with currency.
- "Top up $10 / $50 / $200" buttons → hosted-payment redirect.
- Transaction list (last 90 days, paginated).
- Current tier with included quotas and usage bars (filled vs available).
- "Upgrade tier" CTA with the next tier's price and quotas.
- Free-tier inactivity countdown if applicable (e.g., "Auto-pause in 23 days — place an order or top up to keep active").
- LLM provider status: which providers are enabled (✓ Anthropic, ✓ OpenAI, — Gemini disabled, — Moonshot disabled), platform-level (informational, no tenant config required).
- **Files**: `src/pages/settings/billing/{wallet,quotas,llm-providers}.jsx` (new), `src/services/billing.js` (new)
- **Acceptance**: free user sees inactivity countdown; paid user sees usage bars + upgrade CTA; topup flow demonstrably works against Paystack sandbox.

---

# Wave 20 — Customer chat assistant

**Why now**: builds on the Wave 19 LLM + wallet + quota infrastructure. Customer chat surfaces on web (marketplace + per-store subdomain) and via WhatsApp. All `sonnet`, 5 parallel.

**Migration numbers owned**: none (`llm_messages`, `llm_tool_executions` ship in consolidated migration 013).

### T20.1 — Tool registry for customer chat (sonnet)
`internal/llm/tools/customer/` package — registers the tools available to customer-facing chat:
- `get_user_location({})` — returns the latest known location from session or asks the client to share.
- `search_stores({q?, lat?, lng?, radius_km?, city?})` — proxies to Wave 7 marketplace search.
- `get_store_menu({slug})` — current menu snapshot via marketplace endpoint.
- `get_item_details({item_id})` — pricing, modifier_groups, modifiers, allergens.
- `add_to_cart({item_id, qty, modifier_ids[]})` — adds to the customer's cart for the implied store.
- `view_cart({})`, `remove_from_cart({item_id})`, `clear_cart({})`.
- `confirm_order({delivery_or_collection, address?})` — places the order, returns the order tracking token.
- `track_order({order_id_or_token})` — proxies to Wave 16 tracking endpoint.
- `view_my_recent_orders({})` — list customer's past 10 orders.

Tools are versioned (v1) and have JSON-schema input definitions. The system prompt is cached.
- **Files**: `backend/internal/llm/tools/customer/*.go` (new)
- **Acceptance**: each tool returns the same shape as its underlying handler; system-prompt token count <2k for caching efficiency.

### T20.2 — Customer chat HTTP endpoint (sonnet)
`POST /api/chat/customer` — accepts `{conversation_id?, message, store_slug?}`, returns the assistant's reply + any tool-call sequence + the updated conversation_id. Stateless on the wire; conversation state lives in `llm_messages` rows.
- Uses `router.Pick("customer_chat", {tool_use: true})` to select the model.
- Records `llm_messages` row per turn + `llm_tool_executions` per tool call with timing and tokens.
- Decrements quota (`CheckAndIncrement("llm_messages_customer", 1)`) before invoking the model; over free quota debits wallet at $0.03/msg.
- Streams via SSE for the web client (`POST /api/chat/customer/stream`).
- **Files**: `backend/internal/handlers/chat/customer.go` (new)
- **Acceptance**: end-to-end conversation works against a seeded store; quota decremented; tokens recorded; messages survive a reconnect.

### T20.3 — Customer chat UI (sonnet)
Web chat panel embedded in `app.beepbite.io` (marketplace) and `mystore.beepbite.io` (per-store). Floating bubble; expands to a side panel. SSE stream rendering. Renders tool-call cards inline ("🔍 Searching stores near you…", "🛒 Added Jollof Rice × 2 to cart").
- **Files**: `src/components/chat/customer-chat-panel.jsx` (new), `src/services/chat.js` (new)
- **Acceptance**: customer types "find me biryani in Durban" → 3 stores listed inline → tap one → menu loads → tap an item → cart updates → tap checkout → flow continues.

### T20.4 — WhatsApp customer chat handoff (sonnet)
The Wave 17 chatbot service hands off the conversation message to the same `POST /api/chat/customer` endpoint after the binding gate is past. The assistant's response is rendered to WhatsApp via the existing whatsapp client.
- **Files**: `backend/internal/chatbot/llm_handoff.go` (new), `backend/internal/chatbot/service.go` (route bound-number messages through LLM)
- **Acceptance**: WhatsApp message → assistant tool-uses search_stores → reply with store buttons → customer picks → menu rendered as a numbered list → order placed.

### T20.5 — Customer-chat smoke + pen-test (sonnet now, opus in Wave 15)
Smoke test for golden path. Add pen-test items to Wave 15 backlog: prompt-injection-via-store-name, tool-result-poisoning, runaway-tool-loop, cost-amplification (force the model to do 100 tool calls in a turn), and cross-customer cart access via guessed conversation IDs.
- **Files**: `backend/cmd/tests/suite_customer_chat.go` (new), Wave 15 spec updates
- **Acceptance**: smoke green; pen-test items filed in Wave 15.

---

# Wave 21 — Manage your store from WhatsApp (owner assistant + bulk imports)

**Why now**: depends on Wave 19 (LLM + wallet) + Wave 17 (WhatsApp binding). The killer feature for owner adoption — they manage everything from their pocket. All `sonnet`, 7 parallel.

**Migration numbers owned**: none (`bulk_imports` and friends in consolidated migration 013).

### T21.1 — Tool registry for owner chat (sonnet)
`internal/llm/tools/owner/`:
- `list_locations({})`, `set_default_location({location_id})`.
- `list_items({location_id?, category_id?, q?})`.
- `get_item({item_id})`.
- `create_item({location_id, name, price_cents, category_id?, description?})`.
- `update_item({item_id, fields})`.
- `set_price({item_id, price_cents})`.
- `eighty_six_item({item_id, until?})`, `un_eighty_six_item({item_id})`.
- `list_categories({location_id})`, `create_category({location_id, name})`.
- `view_today_sales({location_id?})`, `view_kds_status({location_id?})`, `view_low_stock({location_id?})`.
- `view_wallet_balance({})`, `view_quota_usage({})`.
- `invite_driver({email})`, `invite_staff({email, role, capabilities})`.
- `start_bulk_import({location_id, source_type, file_url})` — kicks off T21.4 / T21.5.
- `view_bulk_import({id})`, `approve_bulk_import({id})`, `cancel_bulk_import({id})`.

Every tool requires the actor token (Wave 9) to carry the right capability — `update_item` requires `can_manage_menu` etc. Tools return structured errors the model surfaces to the user politely.
- **Files**: `backend/internal/llm/tools/owner/*.go` (new)
- **Acceptance**: capability gating enforced; missing-capability errors are recoverable (the model can suggest the user upgrade their PIN).

### T21.2 — Direct command shortcuts (sonnet)
A pre-LLM router that catches `/`-prefixed commands and executes them without LLM cost:
- `/86 <item>` — fuzzy-match item name in the current location and 86 it.
- `/price <item> <amount>` — set price.
- `/sales today` — daily summary text.
- `/help` — list commands.
- `/upgrade <tier>` — initiate tier change.

Fuzzy match uses a small in-process search index per location, refreshed on item updates.
- **Files**: `backend/internal/chatbot/direct_commands.go` (new)
- **Acceptance**: commands execute in <200ms with no LLM call; bad arguments return a helpful message; ambiguous matches list options.

### T21.3 — Owner chat HTTP + WhatsApp flow (sonnet)
Mirrors T20.2 but for owner chat: `POST /api/chat/owner`, uses `router.Pick("owner_chat", {tool_use: true})`, decrements `llm_messages_owner` quota at $0.03/msg overage (same as customer). WhatsApp handoff from the chatbot service when the bound number's profile is an org member with `can_manage_menu` or `can_manage_staff` etc.
- **Files**: `backend/internal/handlers/chat/owner.go` (new), `backend/internal/chatbot/owner_handoff.go` (new)
- **Acceptance**: WhatsApp message from an owner number → assistant lists items → owner says "drop jollof to 70" → tool call → audit row → reply confirms.

### T21.4 — Bulk import from PDF / image (vision) (sonnet)
`internal/handlers/imports/pdf.go`. Owner uploads a PDF (or image) to a presigned R2 URL; the handler kicks off a vision pass via `router.Pick("bulk_vision", {vision: true, tool_use: true})`. The model emits a structured list of `{name, price, category?, description?}`. Stored in `bulk_imports.summary_jsonb` as a draft. Status moves `pending → reviewing → committed | canceled`.

Owner-facing approval endpoint: `POST /imports/:id/approve` — runs the draft items through `create_item` in a single transaction. On any error, rolls back, marks `failed`.

Bulk imports debit `bulk_imports` quota and the LLM vision cost (~$0.05/doc) at $0.20/doc retail.
- **Files**: `backend/internal/handlers/imports/{handler,pdf,image,store}.go` (new), `backend/internal/llm/tools/owner/imports.go`
- **Acceptance**: a 30-item PDF menu produces a 30-item draft in under 15s; approval commits all 30 atomically; error in any line rolls back all.

### T21.5 — Bulk import from CSV / XLSX (sonnet)
`internal/handlers/imports/csv.go`, `xlsx.go`. Owner uploads a sheet; parser reads rows with header detection. Required columns: `name`, `price`. Optional: `category`, `description`, `sku`, `dietary_tags`. Errors per row reported as a structured response; owner reviews + commits.

Owner via chat: "import this CSV" → if attached, kicks off; if not, the assistant returns the file-upload URL.
- **Files**: `backend/internal/handlers/imports/csv.go`, `backend/internal/handlers/imports/xlsx.go` (new), `backend/go.mod` (excelize or xuri/excelize/v2)
- **Acceptance**: a 500-row CSV processes correctly; header detection works for snake_case / Title Case / camelCase; bad rows surfaced individually.

### T21.6 — Owner-chat audit + cost ceiling (sonnet)
Every owner tool call writes `audit_log` with `actor_id` = the owner's member_id (via Wave 9 actor-overlay). Same daily-drain ceiling as wallet (T19.1) — bulk imports above $5 of vision cost in a single day require explicit confirmation. The model is told this in the system prompt so it asks first.
- **Files**: `backend/internal/llm/tools/owner/audit.go` (new), `backend/internal/llm/system_prompts/owner.txt` (new)
- **Acceptance**: every test owner-chat session writes the expected audit rows; the cost-ceiling prompt prevents a runaway "import 50 PDFs at once" without confirmation.

### T21.7 — Owner-chat smoke + pen-test (sonnet now, opus in Wave 15)
Smoke for the golden path. Add to Wave 15 backlog: prompt-injection-via-uploaded-PDF, tool-call-against-foreign-org (cross-tenant attempt — should be blocked by RLS even if the model is tricked), capability-escalation (owner without `can_void` tricked into invoking void tool).
- **Files**: `backend/cmd/tests/suite_owner_chat.go` (new), Wave 15 spec updates
- **Acceptance**: smoke green; pen-test items filed.

---

# Wave 22 — Public API + scoped keys + tenant webhooks

**Why now**: restaurants need to integrate Xero / Quickbooks / Mailchimp / custom dashboards. Without an API we're closed. All `sonnet`, 5 parallel.

**Migration numbers owned**: none — `api_keys`, `webhook_endpoints`, `webhook_deliveries` ship in consolidated migrations 002 (auth-adjacent) and 013 (compliance).

### T22.1 — `api_keys` schema + key lifecycle (sonnet)
`api_keys` table: `id, org_id, name, prefix_visible text (first 12 chars), key_hash bytea (bcrypt), scopes text[], expires_at, last_used_at, created_by, revoked_at`. Helper to generate `bb_live_<base32-26chars>` and `bb_test_<base32-26chars>` (Stripe shape). Plaintext shown to creator ONCE then discarded. `internal/apikeys/` package handles create / verify / revoke / list.
- **Files**: `backend/internal/apikeys/{service,store,store_test}.go` (new)
- **Acceptance**: create → returns plaintext + prefix; verify(plaintext) → returns key+scopes if valid; verify after revoke → fails; list shows masked prefix only.

### T22.2 — API key auth middleware + scope gate (sonnet)
HTTP middleware: `Authorization: Bearer bb_live_…` → lookup → set RLS session vars (`app.current_org_id`, `app.current_capabilities` from scope list) → invoke handler. Per-route scope check via decorator `RequireScope("write:menu")`. 401 if missing; 403 if wrong scope. Same data layer as JWT-auth handlers (no parallel API surface).
- **Files**: `backend/internal/apikeys/middleware.go` (new), `backend/cmd/server/main.go` (mount on `/api/v1/*` mux)
- **Acceptance**: `curl -H 'Authorization: Bearer bb_live_…' /api/v1/menu` works; wrong scope → 403; revoked key → 401; cross-tenant access blocked by RLS even with valid key.

### T22.3 — Rate limiting per key (sonnet)
Sliding-window rate limiter keyed on `api_keys.id`. Defaults: 1000 req/min per key (configurable per scope tier in a `api_key_limits` config). 429 with `Retry-After` header. Counts in Redis-or-Postgres (start with Postgres + advisory locks; move to Redis later if needed).
- **Files**: `backend/internal/apikeys/ratelimit.go` (new)
- **Acceptance**: 1001st request inside one minute returns 429 with correct `Retry-After`; counter resets after window.

### T22.4 — Tenant webhook subscriptions + delivery (sonnet)
`webhook_endpoints` (org_id, url, signing_secret, events text[], active, created_at, last_success_at, consecutive_failures). `webhook_deliveries` (id, endpoint_id, event_type, payload_jsonb, attempt_count, status, response_status, response_body_excerpt, delivered_at). Worker dispatches with HMAC-SHA256 `X-BeepBite-Signature: t=…,v1=…` (Stripe shape). Retry on 5xx with exponential backoff up to 5 attempts; auto-disable endpoint after 50 consecutive failures (notify owner).
- Events emitted from existing handlers via a thin `events.Emit(ctx, type, payload)` call: `order.created`, `order.paid`, `order.refunded`, `order.completed`, `item.created`, `item.updated`, `item.deleted`, `staff.invited`, `staff.activated`, `payout.completed`.
- **Files**: `backend/internal/webhooks/{store,dispatcher,emit,worker}.go` (new), call sites in pos / adjustments / inventory / payouts handlers
- **Acceptance**: registered endpoint receives signed POST on each event; replay-attack guard (timestamp tolerance ±5min); failing endpoint backs off and eventually disables.

### T22.5 — API keys + webhooks settings UI (sonnet)
`/settings/api-keys` — list keys with masked prefix + scopes + last-used + revoke button; "Create key" modal shows scope checkboxes grouped by surface (Menu, Orders, Reports, Customers, Staff, Inventory, Webhooks). New key plaintext shown once with copy-to-clipboard + warning. `/settings/webhooks` — list endpoints, add new, see recent deliveries with retry button.
- **Files**: `src/pages/settings/api-keys/*` (new), `src/pages/settings/webhooks/*` (new), `src/services/api-keys.js` (new)
- **Acceptance**: full create / list / revoke flow demonstrable; webhook delivery log shows last 50 attempts with response status.

---

# Wave 23 — Custom domains (CNAME from `www.theirstore.com`)

**Why now**: tenant lock-in. Their domain on their POS. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `custom_domains` table ships in consolidated migration 008 (locations area).

### T23.1 — `custom_domains` schema + verification token (sonnet)
Table per Now-13 spec. Verification token = 32-char base32 random. Helper functions `IssueVerificationToken(locationID, hostname) → token`, `VerifyDNS(token, hostname) → bool` (does live DNS lookup against `_beepbite-verify.<hostname>` TXT records).
- **Files**: schema lives in 008 (Wave 0); Go code at `backend/internal/customdomains/{service,store,dns}.go` (new)
- **Acceptance**: TXT-lookup verification works against real DNS; mismatched token returns false; missing CNAME also fails verification.

### T23.2 — Fly.io cert provisioning integration (sonnet)
After verification succeeds, call Fly's REST API (`POST /v1/apps/<app>/certificates` with `{hostname: "www.theirstore.com"}`). Poll until cert is `ready` (or fail with `dns_validation_failed` etc.). Persist `cert_issued_at`. Auto-revoke when `removed_at` set.
- **Files**: `backend/internal/customdomains/fly_certs.go` (new), env var `FLY_API_TOKEN` required
- **Acceptance**: end-to-end against a Fly staging app; cert issues within 2min; revoke removes it from Fly.

### T23.3 — Host middleware extension (sonnet)
The Wave 7 subdomain middleware learns a third resolution path:
1. If `Host` is `app.beepbite.io` or empty subdomain → marketplace.
2. If `Host` is `<slug>.beepbite.io` (non-reserved) → resolve by slug.
3. **If `Host` doesn't end in `.beepbite.io` → look up `custom_domains.hostname`**. If found and `status='live'`, resolve to that `location_id`. Else 404.

HSTS header on every response. HTTP requests auto-redirect to HTTPS.
- **Files**: `backend/internal/subdomain/middleware.go` (extend)
- **Acceptance**: `curl -H 'Host: www.bistro.example' …` resolves to the right tenant; unknown custom domain returns 404; HTTPS-only enforced.

### T23.4 — Settings UI for custom domains (sonnet)
`/settings/location/:locationId/domain` — text input for hostname, "Verify" button. Shows the two required DNS records with copy-to-clipboard. Real-time status updates (pending → verifying → live → failed). Apex-domain banner ("requires ALIAS support — see docs"). Remove-domain confirmation modal.
- **Files**: `src/pages/settings/location/domain/*` (new)
- **Acceptance**: full flow against staging Fly app; status updates poll every 5s until live or failed.

---

# Wave 24 — Easy wins (10 POS quality-of-life features)

**Why now**: each is ≤1 day. Big collective customer-experience uplift. All `sonnet`, 10 parallel.

**Migration numbers owned**: none — small column additions fold into Wave 0 (or are already supported). One small follow-up migration 016 for `daily_quantity` if not already there.

### T24.1 — Customer note on order (sonnet)
Add `customer_note text` to `orders`. Surface in POS workspace cart panel (single text field), in chatbot ordering flow ("Any notes for the kitchen?"), on KDS ticket card, on printed receipt.
- **Files**: schema in Wave 0 / 007; `src/pages/pos/components/customer-note.jsx` (new), KDS station card update, receipt template
- **Acceptance**: note set in any channel appears identically on KDS + receipt + order detail.

### T24.2 — Auto-gratuity for parties ≥N (sonnet)
Config `locations.auto_gratuity_threshold int`, `locations.auto_gratuity_percent numeric`. On `table_sessions` open with `party_size >= threshold`, the closing flow adds an `order_adjustments` row of type `auto_gratuity` with the percent of subtotal. Owner can disable per-order.
- **Files**: schema in Wave 0 / 009; `backend/internal/handlers/tables/auto_gratuity.go` (new); UI line on tender modal
- **Acceptance**: party of 6 closes a check, sees 18% auto-gratuity line; can remove it; audit row written.

### T24.3 — Receipt reprint from history (sonnet)
`POST /orders/:id/reprint` (capability `can_view_reports`). Re-emits via the same channels (email, WhatsApp) and produces a fresh PDF link.
- **Files**: `backend/internal/handlers/receipts/reprint.go` (new), `src/pages/orders/components/reprint-button.jsx` (new)
- **Acceptance**: any past completed order can be reprinted; audit row written.

### T24.4 — Quick re-order ("the usual?") (sonnet)
Customer chat / chatbot detects intent; offers last-3 orders from `orders` filtered by `customer_id`. One-tap clones items + modifiers into a new cart. Marketplace store page shows "Your last order" widget for returning customers.
- **Files**: `backend/internal/handlers/customers/recent_orders.go` (new), chatbot intent handler, `src/pages/store/components/recent-orders.jsx` (new)
- **Acceptance**: signed-in customer with past orders sees the widget and can clone; new customer sees no widget.

### T24.5 — Customer search by phone (sonnet)
Indexed lookup on `customers.phone_e164` (already exists in schema). POS workspace top-bar gains a search input. Opens customer detail with recent orders + loyalty balance + house account if any.
- **Files**: `backend/internal/handlers/customers/search.go` (new), `src/pages/pos/components/customer-search.jsx` (new)
- **Acceptance**: typing 5+ digits returns matches; tap opens customer card; cross-tenant scoping enforced by RLS.

### T24.6 — Cash-out report at shift close (sonnet)
View / handler joining `cash_drawer_sessions` + `pos_shifts` (Wave 0 ships these tables). Shows: starting float, payments handled by this staff, expected closing total, declared closing total, over/short, tip-out owed.
- **Files**: `backend/internal/handlers/cashdrawer/cash_out_report.go` (new), `src/pages/cash/components/cash-out-modal.jsx` (new)
- **Acceptance**: closing a shift produces a printable cash-out report with all expected numbers.

### T24.7 — Pickup time slots at checkout (sonnet)
`pickup_slots` (location_id, day_of_week, slot_start, slot_end, max_orders). Capacity check on order create with `fulfillment_type='collection' AND pickup_time IS NOT NULL`. Customer checkout shows available slots; full slots disabled. Default slots auto-seeded for new locations.
- **Files**: migration follow-up if needed (else in 008), `backend/internal/handlers/pickup/slots.go` (new), `src/pages/checkout/components/pickup-slot-picker.jsx` (new)
- **Acceptance**: 6 customers booking the same slot — 6th gets a "slot full, pick another" UX; slots roll over hourly.

### T24.8 — Group orders on WhatsApp (sonnet)
Carts can be shared across multiple bound WhatsApp accounts. New `cart_collaborators` (cart_id, profile_id, joined_at). One person initiates with `/group <store_slug>`, gets a shareable link/code other accounts join via. Each adds their own items; one tender at the end (single bill or split).
- **Files**: `backend/internal/handlers/cart/group.go` (new), chatbot integration
- **Acceptance**: 3 WhatsApp numbers contribute to one cart; final bill itemized per person; works with both pay-now and pay-on-delivery.

### T24.9 — Loyalty stamps ("buy 10 get 1 free") (sonnet)
`loyalty_stamp_configs` (location_id, item_id, stamps_required, free_item_id, expires_after_days). Stamp added per qualifying order via `loyalty_transactions` (already shipped). On Nth stamp, customer's next order gets the free item auto-added at checkout.
- **Files**: migration follow-up if needed, `backend/internal/handlers/loyalty/stamps.go` (new), customer chat / receipt surfacing
- **Acceptance**: 10 stamps → 11th order free item auto-added; expired stamps don't count.

### T24.10 — Item daily countdown ("5 left of jollof today") (sonnet)
`items.daily_quantity int NULL` + `items.daily_quantity_remaining int NULL`. Reset nightly at the location's timezone midnight via a cron. Decrement atomically on order create. When 0 → flip `is_86ed=true`. Surfaced in chatbot ("Jollof: 5 left today"), marketplace badge, and KDS ticket.
- **Files**: small migration 016 for the columns if Wave 0 doesn't already have them; `backend/internal/jobs/dailyreset/runner.go` (new); UI badges
- **Acceptance**: setting daily_quantity=10 and ordering 10 → item auto-86'd; nightly reset restores remaining = quantity.

### T24.11 — Order modification before kitchen accept (bonus, sonnet)
Until any `kds_ticket` for the order moves out of `'fired'` status, customer / cashier can edit. Adds new line items, removes existing ones, changes quantities. Triggers re-fanout. After kitchen has started → modification blocked.
- **Files**: `backend/internal/handlers/orders/modify.go` (new), customer chat tool `modify_order`, POS workspace edit-mode UI
- **Acceptance**: editable when all tickets are `fired`; blocked once first ticket transitions to `started`.

---

# Wave 25 — Observability + multi-region deployment

**Why now**: foundational. Production-bound. All `sonnet`, 5 parallel.

**Migration numbers owned**: none.

### T25.1 — Structured JSON logs with request/tenant/actor context (sonnet)
Replace stdlib log with `slog` (or zap). Logger middleware attaches request_id, org_id, actor_id, route to every log line within the request scope. Drop string-template logs in favor of structured fields.
- **Files**: `backend/internal/logger/{logger,middleware}.go` (new); migrate all `log.Printf` call sites to `slog.Info(...)` with fields
- **Acceptance**: every request produces correlated logs; structured fields parsed correctly by the log sink.

### T25.2 — OpenTelemetry traces + metrics (sonnet)
`go.opentelemetry.io/otel` SDK. Auto-instrument HTTP server + pgx driver. Custom spans for KDS fanout, payout job, FX sync, LLM calls. Metrics exporters: Prometheus `/metrics` endpoint for scraping + OTLP push to Honeycomb / Grafana Cloud free tier.
- **Files**: `backend/internal/telemetry/{tracing,metrics}.go` (new), instrumentation in `cmd/server/main.go`
- **Acceptance**: traces visible in Honeycomb showing the full request → DB → response timeline; latency / error-rate metrics scrapable.

### T25.3 — Frontend error tracking + RUM (sonnet)
Sentry SDK (or GlitchTip — self-hosted Sentry-compatible) in the React app. Captures uncaught exceptions, promise rejections, network errors. Real-user-monitoring optional (page-load timing).
- **Files**: `src/lib/sentry.js` (new), `src/App.jsx` (init), `.env.example` (DSN var)
- **Acceptance**: throw in dev — error appears in Sentry within 30s with full source-mapped stack.

### T25.4 — Multi-region Fly deploy (sonnet)
`fly.toml` extended for primary region JNB + secondary IAD + AMS + SIN. Postgres replicated read-only with primary in JNB (Fly Postgres has multi-region support). Read traffic auto-routed by Fly to nearest region; writes go to primary.
- **Files**: `fly.toml`, `backend/cmd/server/db.go` (read replica routing), `docs/deploy.md` (deployment runbook)
- **Acceptance**: deploy to all 4 regions clean; smoke from EU IP hits AMS replica; write goes to JNB primary; failover documented.

### T25.5 — Status page at status.beepbite.io (sonnet)
Self-hosted Cachet or hosted Statuspage. Surfaces per surface: marketplace, POS, KDS, chatbot, payments, custom domains. Auto-degraded status fed by uptime check (UptimeRobot or self-hosted). Public incident timeline.
- **Files**: `status/` (separate Astro / Hugo site) or external config; `docs/incident-runbook.md`
- **Acceptance**: status page live; one synthetic incident published end-to-end; subscriber list works.

---

# Wave 26 — Platform admin tool (internal BeepBite ops)

**Why now**: support team needs this from day one of paying customers. All `sonnet`, 5 parallel.

**Migration numbers owned**: none — `is_platform_admin bool` ships in Wave 0 / 002.

### T26.1 — Admin subdomain + auth gate (sonnet)
`admin.beepbite.io` subdomain reserved. Server routes admin endpoints only when (a) host is the admin subdomain AND (b) caller's `auth_users.is_platform_admin = true`. Every admin action audited with `actor_type='platform_admin'`.
- **Files**: `backend/internal/handlers/admin/handler.go` (new), middleware to gate admin routes
- **Acceptance**: non-admin user gets 404 (not 403, to avoid existence leak); admin user accesses; every action audited.

### T26.2 — Tenant search + detail (sonnet)
Endpoints: `GET /admin/tenants?q=<>` (search by org id / slug / owner email / phone / custom domain) → list. `GET /admin/tenants/:id` → detail (tier, wallet, recent transactions, active alarms, last login, lifecycle state).
- **Files**: `backend/internal/handlers/admin/tenants.go` (new), `src/pages/admin/tenants/*` (new — admin app same React build, route-gated)
- **Acceptance**: search by any of the listed fields works; tenant detail surfaces all the required signals.

### T26.3 — Force actions (sonnet)
Endpoints + UI for: pause / unpause tenant, refund stuck wallet topup, force-revoke API key, override quota for current billing period, send a system-wide announcement (banner on every tenant dashboard until dismissed).
- **Files**: `backend/internal/handlers/admin/actions.go` (new), `src/pages/admin/tenants/actions/*` (new)
- **Acceptance**: pause flips tenant `status='paused'` + audit row + email notification; each force-action has confirmation modal.

### T26.4 — Health & abuse views (sonnet)
- `GET /admin/health/inactivity-warnings` — tenants in 30/60/75 day windows.
- `GET /admin/health/free-tier-funnel` — graduation rates over time.
- `GET /admin/health/churn-signals` — wallet near zero + no recent topup, declining order volume, support tickets.
- `GET /admin/abuse/fingerprint-clusters` — signup-cluster view.
- `GET /admin/abuse/llm-anomalies` — tenants with unusual LLM usage patterns.
- `GET /admin/abuse/marketing-misuse` — high marketing-category send rates.
- **Files**: `backend/internal/handlers/admin/health.go`, `abuse.go` (new), `src/pages/admin/health/*` (new)
- **Acceptance**: each view returns sensible data on a seeded fixture; charts render in the UI.

### T26.5 — Announcement broadcast (sonnet)
`platform_announcements` table. Admin posts; banner appears on every tenant's dashboard until dismissed. Optional severity (info / warning / critical) — critical can't be dismissed (e.g., scheduled maintenance).
- **Files**: schema follow-up if needed, `backend/internal/handlers/admin/announcements.go`, `src/components/announcement-banner.jsx` (new)
- **Acceptance**: post → all tenants see; dismiss persists per user; critical can't be dismissed.

---

# Wave 27 — Receipts (PDF + email + WhatsApp + reprint)

**Why now**: customer + legal expectation. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `receipts` table (id, order_id, fiscal_number, pdf_object_key, emitted_to text[], emitted_at) ships in Wave 0 / 007 (orders area).

### T27.1 — PDF receipt generator (sonnet)
Go PDF generation via `gofpdf` (jung-kurt/gofpdf or signintech/gopdf). Layout: store logo + name + address, fiscal number, itemized lines with modifiers + price, taxes, tip, total, payment method, customer info (if known), QR code linking to order tracking. Saves to R2 with org-scoped key.
- **Files**: `backend/internal/receipts/{generator,template}.go` (new), `backend/internal/storage/r2.go` (new if not present)
- **Acceptance**: PDF generated for a sample order; logo + layout legible; QR scans to the tracking URL.

### T27.2 — Email + WhatsApp delivery (sonnet)
On `orders.status` transition to `paid` (and only once per receipt), enqueue delivery to the customer's email (Resend) and WhatsApp (if number bound). Configurable per location: email yes/no, WA yes/no. Failed deliveries retry up to 3 times.
- **Files**: `backend/internal/receipts/dispatcher.go` (new), event listener in pos charge handler
- **Acceptance**: paid order with email customer gets PDF in inbox within 60s; WA customer gets PDF as document attachment; configurable off.

### T27.3 — Reprint endpoint (sonnet) — covered by T24.3
Cross-reference: T24.3 already handles this. T27 ensures the receipt-side handles re-emission cleanly (doesn't generate a new fiscal number on reprint — same number, fresh PDF).
- **Files**: `backend/internal/receipts/reprint.go`
- **Acceptance**: reprint produces a PDF with the same fiscal number as the original.

### T27.4 — Receipt retention policy (sonnet)
Retention default 7 years (fiscal compliance). Configurable per location for stricter regions. Nightly job moves >7yr receipts to cold-storage R2 class then eventually deletes per policy.
- **Files**: `backend/internal/jobs/receipt_retention/runner.go` (new)
- **Acceptance**: simulated old receipt moves through retention states; audit row written.

---

# Wave 28 — Customer marketplace reviews

**Why now**: discovery + trust. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `marketplace_reviews` ships in Wave 0 / 010 (engagement).

### T28.1 — Review submission endpoint + email/WA prompt (sonnet)
1 hour after `orders.status='delivered'` (or `'collected'`), a job enqueues a review prompt with a one-tap link `app.beepbite.io/review/<order_token>`. The page is JWT-gated to the order's customer. Submission writes `marketplace_reviews` row.
- **Files**: `backend/internal/jobs/review_prompts/runner.go` (new), `backend/internal/handlers/reviews/submit.go` (new), `src/pages/review/[token].jsx` (new)
- **Acceptance**: delivered order produces a prompt within 1h; submitted review visible immediately; can't submit twice for same order.

### T28.2 — Review display on marketplace + store page (sonnet)
Store detail page shows aggregate rating + recent reviews (paginated). Each review: stars, text, photos, customer first-name + last-initial, verified-purchase badge, owner reply (if any).
- **Files**: `backend/internal/handlers/marketplace/reviews.go` (new), `src/pages/store/components/reviews.jsx` (new)
- **Acceptance**: reviews load fast (cached aggregate on `locations.avg_rating`); sort by recent + by rating; load-more pagination.

### T28.3 — Owner reply flow (sonnet)
Owner sees pending reviews in `/reviews`. Reply text saved to `marketplace_reviews.owner_reply`. Reply visible publicly. Wave-4 reply mechanism reused.
- **Files**: `src/pages/reviews/marketplace-reviews-tab.jsx` (new)
- **Acceptance**: owner replies → public review page shows reply; only owner of the location can reply.

### T28.4 — Abuse detection on reviews (sonnet)
Lightweight LLM classifier (using the Wave 19 router) flags reviews with profanity, spam, off-topic content. Flagged reviews hidden pending manual platform-admin review. Owner can flag reviews; platform-admin sees flagged queue.
- **Files**: `backend/internal/jobs/review_moderation/runner.go` (new), `backend/internal/handlers/admin/review_moderation.go` (new)
- **Acceptance**: profane review hidden on submission; clean review live immediately; admin queue functions.

---

# Wave 29 — Hardware integration (ESC/POS printers + scanner + display + scale)

**Why now**: real-world POS needs print. All `sonnet`, 5 parallel.

**Migration numbers owned**: none — `hardware_endpoints` (id, location_id, kind, name, address, port, station_id?, is_default) added as a small follow-up migration 017.

### T29.1 — ESC/POS receipt printer driver (sonnet)
Go-side ESC/POS emitter (raster + text + cut + drawer kick). Network printers (port 9100); USB printers via a small bridge daemon on a tenant device (Tauri or simple Electron app exposing localhost endpoint). Per-location default + per-station overrides.
- **Files**: `backend/internal/hardware/escpos/{emitter,formatter,driver}.go` (new), migration 017
- **Acceptance**: print a receipt + open drawer on a real or emulated ESC/POS printer.

### T29.2 — Kitchen printer routing (sonnet)
On KDS fanout, if station has a printer assigned, also emit a kitchen ticket via ESC/POS in addition to the KDS screen. Configurable per station.
- **Files**: `backend/internal/handlers/kds/printer_routing.go` (new)
- **Acceptance**: order with grill station ticket auto-prints to grill printer + appears on grill KDS screen.

### T29.3 — Barcode scanner support (sonnet)
USB keyboard-emulating scanners work out of the box in browsers (they type the barcode + Enter). POS workspace listens for rapid-typed digits followed by Enter, treats as a barcode lookup against `items.sku`. Adds item to cart on match.
- **Files**: `src/pages/pos/hooks/use-barcode-scanner.js` (new), `backend/internal/handlers/items/by_sku.go` (new)
- **Acceptance**: scanning a barcode-attached item adds it to the cart; unknown SKU shows a not-found toast.

### T29.4 — Customer-facing display (sonnet)
Second window opens on a separate display. Real-time mirror of the active POS workspace cart. Tip selector at end (customer taps tip percent on the display before tender).
- **Files**: `src/pages/customer-display/*` (new), BroadcastChannel API or SSE for state sync
- **Acceptance**: second window opens via "open customer display" button; mirror updates within 300ms of POS action.

### T29.5 — Scale integration via WebSerial (sonnet)
WebSerial API (Chrome) reads from a USB serial scale. Per-item flag `is_weight_priced` + `price_per_unit_weight`. POS prompts for weight → fetched from scale → price computed → added to cart.
- **Files**: `src/pages/pos/hooks/use-scale.js` (new), `src/pages/pos/components/weight-prompt-modal.jsx` (new)
- **Acceptance**: WebSerial connection prompt appears; scale reading captured; price computed correctly.

---

# Wave 30 — Internationalization (i18n) + accessibility

**Why now**: global product. All `sonnet`, 3 parallel.

**Migration numbers owned**: none.

### T30.1 — i18next setup with 9 languages seeded (sonnet)
Install `i18next` + `react-i18next`. Translation files at `src/i18n/{en,af,zu,xh,pt,fr,es,ar,hi}.json`. Wrap every user-facing string. Per-tenant default language on `organizations.default_locale`; per-user override on `profiles.locale`. RTL stylesheet for `ar`.
- **Files**: `package.json`, `src/i18n/*`, every page (string wrap)
- **Acceptance**: switching language updates every visible string; RTL flips layout for Arabic.

### T30.2 — Chat assistant language adaptation (sonnet)
Customer chat detects message language via Claude's natural ability; system prompt instructs reply in detected language. Owner chat respects `profiles.locale`.
- **Files**: `backend/internal/llm/system_prompts/customer.txt` (extend), tests
- **Acceptance**: Portuguese message → Portuguese reply; Hindi message → Hindi reply.

### T30.3 — Accessibility audit + fixes (WCAG 2.1 AA) (sonnet)
Run axe-core + manual screen-reader pass on POS workspace, KDS, customer marketplace, settings. Fix focus order, ARIA labels, color contrast issues. Document remaining gaps.
- **Files**: every UI page touched; `docs/accessibility.md` (new)
- **Acceptance**: axe-core CI check passes with zero violations on the listed pages.

---

# Wave 31 — Backups + DR + GDPR/POPIA data deletion

**Why now**: launch compliance. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — soft-delete + export-request tables fold into Wave 0 / 013.

### T31.1 — Hourly logical dumps to R2 (sonnet)
`internal/jobs/backups/` worker: hourly `pg_dump` (custom format) → R2 with 90-day retention. Daily cross-region replication via R2 copy. WAL-G optional later.
- **Files**: `backend/internal/jobs/backups/runner.go` (new)
- **Acceptance**: hourly dump appears in R2; 90-day eviction works; replication healthy.

### T31.2 — Quarterly restore drill runbook (sonnet)
`docs/dr-runbook.md` documents the procedure to restore latest backup to a staging instance and run a smoke suite. CI job scaffolds the drill quarterly with a calendar reminder.
- **Files**: `docs/dr-runbook.md` (new)
- **Acceptance**: runbook tested once end-to-end; RPO ≤1h and RTO ≤2h confirmed.

### T31.3 — Account self-deletion + tenant data export (sonnet)
- `POST /settings/account/delete` — 30-day soft-delete (`auth_users.scheduled_delete_at`). User can cancel during the 30-day window. After 30 days, hard-delete (cascade with audit log preservation).
- `POST /settings/data-export` — enqueues a job that produces a JSON archive of all org-scoped data within 24h, available as a one-time R2 link emailed to the user.
- **Files**: `backend/internal/handlers/account/{delete,export}.go` (new), `backend/internal/jobs/data_export/runner.go` (new), settings UI
- **Acceptance**: delete soft-deletes; cancel restores; 30-day timer fires hard-delete; export archive contains all expected rows.

### T31.4 — Customer right-to-be-forgotten (sonnet)
Owner triggers per-customer PII purge: name, phone, email, addresses cleared; order rows kept anonymized for accounting (customer_id stays as opaque uuid).
- **Files**: `backend/internal/handlers/customers/forget.go` (new), UI in customer detail
- **Acceptance**: forget purges PII; orders still queryable in reports; audit row preserved.

---

# Wave 32 — Help center + onboarding wizard

**Why now**: pairs with "open in 5 minutes" promise. All `sonnet`, 3 parallel.

**Migration numbers owned**: none.

### T32.1 — `docs.beepbite.io` help center (sonnet)
Static site (Astro) with markdown sources at `docs/help/`. Sections: Getting Started, POS, KDS, Menu, Payments, Staff, Customers, Drivers, Bulk Imports, API, Custom Domains, FAQ. Search via Pagefind (or similar zero-config search). Deploys to Fly or Cloudflare Pages.
- **Files**: `docs/help/*.md` (new), `docs-site/` (Astro project, new)
- **Acceptance**: docs.beepbite.io live; search returns relevant pages; navigation works.

### T32.2 — Onboarding wizard (sonnet)
Replace current minimal popup with a 6-step wizard at `/onboard`. Steps: signup+verify → first store + slug + city → 5 menu items (or PDF import) → invite staff or driver → connect payment provider (or set on-delivery) → ship a test order. Progress saved per step; resumable.
- **Files**: `src/pages/onboard/*` (new — replaces `src/components/setup/onboarding-popup.jsx`), `src/services/onboarding.js` (new)
- **Acceptance**: full flow end-to-end produces a working store on a fresh signup; resumable across sessions.

### T32.3 — Interactive product tour + contextual help (sonnet)
`react-joyride` tour on first POS workspace visit. "?" buttons in every settings page deep-link to the relevant docs.beepbite.io section. Tour skippable, dismissible.
- **Files**: `src/components/tour/*` (new), "?" buttons across settings pages
- **Acceptance**: first-time user sees the tour; subsequent visits don't replay unless triggered manually; deep-links resolve correctly.

---

# Wave 33 — v2 deferred (later)

Tracked but not yet committed to a wave. Pulled in when a triggering condition fires.

| Item | Trigger to pull in |
|---|---|
| Offline Tier 2 — true offline POS (cash mode while network out, conflict resolution on reconnect) | When 3+ paying tenants ask, or first major outage incident |
| Offline Tier 3 — native shell (Tauri / Capacitor) | When a tenant requests a tablet build |
| In-house delivery dispatch (separate driver-app native binary) | When 10+ tenants are using the in-house driver flow |
| Partner delivery integration (Uber Eats / DoorDash) — handlers for the existing schema | When a tenant requests partner integration |
| QR-order-at-table | After dine-in flows are battle-tested |
| Self-serve kiosk mode | After Quick POS kiosk hardens |
| Franchise & multi-location consolidation reporting | When a multi-loc tenant requests |
| Marketing engine (broadcasts, segments, suppression) | After 50+ tenants reach 1k+ customer lists |
| Scheduled / recurring orders (office lunches) | When demand surfaces |
| Accounting integrations (Xero, Quickbooks) | When 5+ tenants ask — likely the Wave 22 API + a 1-week mapping wave each |

---

# Wave 34 — Invoicing (platform → stores, stores → B2B customers, VAT-aware)

**Why now**: Now-26 in roadmap. Both BeepBite-issued (for fees) and tenant-issued (for their corporate clients). Uniform VAT rule. All `sonnet`, 5 parallel.

**Migration numbers owned**: none — `tax_profiles` and `invoices` + `invoice_line_items` fold into Wave 0 (migration 008 covers tenants/tax-adjacent; migration 013 covers compliance/audit-adjacent — invoices live in 008).

### T34.1 — `tax_profiles` + `invoices` schema (folded into Wave 0 / migration 008) (sonnet)
Schema includes:
- `tax_profiles` (org_id PK, legal_name, registered_address text, country text, vat_number text NULL, vat_rate_percent numeric NULL, company_number text NULL, contact_email, contact_phone, billing_email, updated_at).
- `invoices` (id, issuer enum `'platform' | 'tenant'`, issuer_org_id NULL if platform, recipient_org_id NULL, recipient_customer_id NULL, recipient_snapshot_jsonb (legal_name / address / vat_number frozen at issue time), invoice_number text UNIQUE, currency, subtotal_cents, vat_cents, vat_rate_percent, vat_applied bool, total_cents, due_date, status enum `'draft|sent|paid|overdue|cancelled|refunded'`, issued_at, paid_at, pdf_object_key, idempotency_key UNIQUE).
- `invoice_line_items` (invoice_id, sort_order, description, quantity, unit_price_cents, line_total_cents, vat_eligible bool).
- Invoice-number sequencer per `(issuer, country, year)` for legal compliance — reuse the fiscal-receipt sequence pattern from Wave 0 / migration 007.
- **Files**: Wave 0 / `008_payments_generic.sql` (extended)
- **Acceptance**: RLS scopes tenant-issued invoices to their org; platform-issued invoices are visible to the recipient org and service_role; invoice numbers gap-free per series.

### T34.2 — Invoice generator (PDF + VAT logic) (sonnet)
`internal/invoicing/` package. Generator takes an `Invoice` row + line items, renders a clean PDF with:
- Issuer block (legal name, address, VAT number if present, company number if present, logo for tenants).
- Recipient block (from `recipient_snapshot_jsonb`).
- Invoice number, issue date, due date.
- Line items table.
- Subtotal, VAT (only if issuer has `vat_number`), total.
- Payment terms + bank account details (issuer's bank or "Pay via wallet top-up" link for BeepBite-issued).
- Footer with legal text.

**VAT decision logic** (in code, single function `computeVAT(issuer TaxProfile, lineTotalCents int64) (vatCents int64, applied bool)`):
- If `issuer.vat_number IS NULL OR ''` → return 0, false.
- Else → return `lineTotalCents * issuer.vat_rate_percent / 100`, true.
- (Cross-border / reverse-charge nuances deferred.)
- **Files**: `backend/internal/invoicing/{generator,vat,template}.go` (new)
- **Acceptance**: BeepBite-issued invoice without VAT_NUMBER env shows no VAT line; tenant-issued invoice from a VAT-registered tenant shows VAT line; PDF renders cleanly.

### T34.3 — Platform invoice generation (BeepBite → stores) (sonnet)
Monthly job consolidates Wave 10's `subscription_invoices` + Wave 19's wallet-overage line items into a unified `invoices` row issued by BeepBite. Header from env vars (`BEEPBITE_LEGAL_NAME` etc.). VAT applied only if `BEEPBITE_VAT_NUMBER` set. Auto-issues on the org's billing anniversary; due 14 days later. On `paid` transition (paid via wallet top-up or direct payment), updates `paid_at`. Overdue invoices nudge owner via email + dashboard banner.
- **Files**: `backend/internal/jobs/platform_invoicing/runner.go` (new), `backend/internal/handlers/invoices/list.go` (new — for tenant to view BeepBite invoices)
- **Acceptance**: monthly cycle produces an invoice with correct line items, VAT applied iff env var set; tenant sees the invoice in `/settings/billing`; PDF downloadable.

### T34.4 — Tenant-issued invoices (stores → B2B customers) (sonnet)
Tenants invoice house-account customers, catering clients, corporate accounts. Endpoints:
- `POST /invoices` — owner creates a draft (or auto-generated from `house_account_invoices` ledger).
- `PATCH /invoices/:id` — edit lines, due date, recipient.
- `POST /invoices/:id/issue` — finalize + generate PDF + send via email.
- `POST /invoices/:id/mark-paid` — manual reconciliation (when paid by bank transfer).
- `POST /invoices/:id/cancel`.
- `GET /invoices` — list / filter by status / recipient.

UI at `/invoicing` (manager-only by default; configurable per-member via `can_issue_invoices` capability).
- **Files**: `backend/internal/handlers/invoices/{handler,store}.go` (new), `src/pages/invoicing/*` (new)
- **Acceptance**: owner creates invoice for a house account, issues it, customer receives email with PDF, owner marks paid; audit log captures every state change.

### T34.5 — Business-info onboarding + settings (sonnet)
Onboarding wizard (Wave 32) gains a "Business information" step asking for: legal name, registered address, country, VAT number (optional + helper text "Leave blank if you're not VAT-registered"), company number (optional), billing email. Settings page at `/settings/business-info` for later edits. A red banner appears in `/invoicing` if `tax_profiles` row is missing or incomplete.
- **Files**: `src/pages/onboard/steps/business-info.jsx` (new), `src/pages/settings/business-info/*` (new), `backend/internal/handlers/taxprofiles/handler.go` (new)
- **Acceptance**: completing onboarding produces a valid `tax_profiles` row; subsequent edits update it; missing-info banner appears in invoicing UI and disappears once filled.

---

# Wave 35 — Unified workspace: one app, role-aware views

**Why now**: Now-27 in roadmap. Replaces the sprawl of `/pos/workspace` + `/home` + `/q/:slug` + `/kds/:stationId` + `/floor` with one shell. All `sonnet`, 5 parallel. Depends on Wave 9 (capabilities) and Wave 11/12 (POS + KDS features).

**Migration numbers owned**: none — `user_preferences` (profile_id, last_view_pos, last_view_kds, last_location_id, ui_density, theme) lives in consolidated migration 002.

### T35.1 — `/work` shell with role-aware tab visibility (sonnet)
React shell at `/work` with two top tabs: **POS** and **Kitchen**. Tab visibility filtered by the actor's capabilities:
- `can_pos` (or owner / manager) → POS tab visible.
- `can_kitchen` → Kitchen tab visible.
- Both → both tabs (default landing on user's `last_view_pos` or `last_view_kds`, whichever was used last).
- Neither (drivers, admin-only) → redirect to their role's home (`/driver`, `/settings`).
- **Files**: `src/pages/work/{shell,tabs}.jsx` (new), `src/routes.jsx`
- **Acceptance**: kitchen-only staff see only Kitchen tab; POS-only staff see only POS tab; managers see both.

### T35.2 — POS tab view picker + persistence (sonnet)
Within the POS tab, a view picker offers: **Quick** (counter-service) · **Full** (ticket workspace) · **Floor** (table plan with sessions) · **Orders** (queue). Selection persists to `user_preferences.last_view_pos`. The existing `/pos/workspace`, `/q/:slug`, `/floor` routes still work as deep links but render the same component inside the shell (or chrome-less when accessed directly).
- **Files**: `src/pages/work/views/pos/{quick,full,floor,orders}.jsx` (move existing components in), `src/pages/work/components/view-picker.jsx` (new)
- **Acceptance**: switching views inside the tab updates `last_view_pos` server-side; returning to `/work` lands on the last view.

### T35.3 — Kitchen tab view picker + persistence (sonnet)
Within the Kitchen tab, views: **Station** (single station's tickets — picker if user is assigned to multiple) · **Expo** (cross-station expedite) · **Bump-bar** (chrome-less hotkey-driven). Selection persists to `user_preferences.last_view_kds` + `last_station_id`.
- **Files**: `src/pages/work/views/kitchen/{station,expo,bumpbar}.jsx` (move existing in), shared view picker
- **Acceptance**: kitchen staff sees their last station on return; expo screen reachable via dropdown; bump-bar mode hides chrome.

### T35.4 — Deep-link compatibility for dedicated screens (sonnet)
The chrome-less routes `/kds/:stationId`, `/kds/expo`, `/q/:slug` remain working for kitchen TVs and customer kiosks — they render the same components but in chrome-less mode (no top tabs, no nav). Detection via a `?chrome=off` query param or route shape.
- **Files**: `src/pages/kds/*` (refactor to share with new shell views)
- **Acceptance**: kitchen TV navigating to `/kds/:stationId` still gets a chrome-less full-screen ticket grid; same component as `/work` Kitchen tab Station view.

### T35.5 — Single global keyboard shortcuts + search (sonnet)
The unified shell has one global cmd-K (or `/`) search: items by name/SKU, customers by phone/name, orders by number. Global hotkeys: `1` POS tab, `2` Kitchen tab, `cmd-shift-V` cycle views, `cmd-shift-L` switch location.
- **Files**: `src/pages/work/components/global-search.jsx` (new), `src/pages/work/hooks/use-hotkeys.js` (new — shared with KDS hotkeys from Wave 12)
- **Acceptance**: cmd-K opens search, returns top results across items + customers + orders; tab + view hotkeys work; location switcher persists.

---

# Wave 36 — Responsiveness sweep (end-of-roadmap pass)

**Why now**: Now-29 in roadmap. Pre-launch polish. All `sonnet`, parallel by page category.

**Migration numbers owned**: none.

### T36.1 — Responsiveness audit + checklist (sonnet)
For every Now-1 through Now-28 page, run through the checklist:
- iPhone SE 375×667 — content readable, taps land, no horizontal scroll.
- iPhone 13 / Pixel 7 390×844 — primary phone target.
- iPad 768×1024 portrait — primary POS device.
- iPad 1024×768 landscape — primary KDS device.
- Desktop 1280, 1440, 1920 — manager dashboards + reports.

Output `docs/responsiveness-audit.md` with each page rated `pass / fix / rebuild` per form factor, plus screenshots.
- **Files**: `docs/responsiveness-audit.md` (new)
- **Acceptance**: every page in scope has a rating per form factor; failures get a follow-up task in T36.2+.

### T36.2 — Fix POS workspace + KDS for tablet (sonnet)
POS workspace (Now-22 / Wave 11) and KDS (Now-23 / Wave 12) tuned for iPad portrait + landscape. Touch targets ≥44px. Larger fonts on tablet. Swipe-to-bump gesture on KDS tickets. Keypad-style number entry on tender modal.
- **Files**: `src/pages/work/views/pos/*`, `src/pages/work/views/kitchen/*`
- **Acceptance**: 30-minute tablet use without zoom / scroll issues.

### T36.3 — Fix marketplace + customer chat for phone (sonnet)
`/discover`, `/store/:slug`, `/checkout`, customer chat panel — all primarily phone-targeted. Bottom-sheet patterns for cart; sticky checkout footer; full-screen chat on small viewports.
- **Files**: `src/pages/discover/*`, `src/pages/store/*`, `src/pages/checkout/*`, `src/components/chat/customer-chat-panel.jsx`
- **Acceptance**: golden path (search → store → cart → checkout) works in 375px width without horizontal scroll.

### T36.4 — Fix settings + dashboards for phone landscape (sonnet)
Settings pages and manager dashboard often opened on phone for quick checks. Form layouts adapt; data tables become card lists below 768px.
- **Files**: `src/pages/settings/*`, `src/pages/manager/*`, `src/pages/reports/*`
- **Acceptance**: every settings page works one-handed on a 390px phone; reports show as cards on small viewports.

### T36.5 — Staff PIN keypad + driver portal mobile (sonnet)
PIN keypad (`/s/:slug`) must work on the smallest viewport. Driver portal (`/driver`) is mobile-first.
- **Files**: `src/pages/staff-pin/*`, `src/pages/driver/*`
- **Acceptance**: PIN entry works on iPhone SE without virtual keyboard covering input; driver portal map + ticket panel functional on 375px.

### T36.6 — Final CI gate (sonnet)
Add Playwright tests at the listed breakpoints for the top 10 user flows. Failing layout = failing CI.
- **Files**: `tests-e2e/responsive/*` (new), `.github/workflows/test.yml` (extend)
- **Acceptance**: CI runs the 10 flows × 4 form factors; any layout regression blocks the merge.

---

# Wave 37 — WhatsApp multi-number support

**Why now**: Now-29 in roadmap. Single central number doesn't scale globally. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `whatsapp_phone_numbers` folds into Wave 0 / migration 011.

### T37.1 — Schema + routing resolver (sonnet)
`whatsapp_phone_numbers` (id, meta_phone_number_id text UNIQUE, display_phone, country, regions text[], active, configured_at, notes). Inbound webhook handler extracts `entry[].changes[].value.metadata.phone_number_id`, looks it up, and tags the conversation with `country` + `region`. If unknown number → 404 silently logged.
- **Files**: schema in Wave 0 / 011; `backend/internal/chatbot/multi_number_router.go` (new)
- **Acceptance**: webhook from a registered ZA number routes correctly; unknown phone_number_id is silently dropped with a metric increment.

### T37.2 — Outbound number selection (sonnet)
When BeepBite (or any chatbot/assistant) sends a message, pick the right `from_phone_number_id`:
1. The number the customer most recently messaged us from (sticky session).
2. Else, primary number for the customer's country.
3. Else, the global primary.

Stored in `chats.last_inbound_phone_number_id`. Passed to the WhatsApp client per send.
- **Files**: `backend/internal/chatbot/outbound.go` (extend), `backend/internal/integrations/whatsapp/client.go` (multi-number aware)
- **Acceptance**: send a message from a chat that came in on ZA number → outbound goes via ZA number; first-touch to a new customer in NG → outbound uses NG number.

### T37.3 — Admin tool: add/manage WhatsApp numbers (sonnet)
`/admin/whatsapp-numbers` page (platform-admin only, Wave 26). Add a new Meta `phone_number_id`, set country, regions, mark active. Edit / disable. List shows latest-message timestamp per number.
- **Files**: `backend/internal/handlers/admin/whatsapp_numbers.go` (new), `src/pages/admin/whatsapp-numbers/*` (new)
- **Acceptance**: platform admin can add a NG number end-to-end; non-admin gets 404.

### T37.4 — Cross-number isolation tests (sonnet)
Smoke + e2e: messaging the ZA number doesn't surface NG-only stores in store search; webhook spoofing (forged `phone_number_id`) doesn't bleed into a different region's tenant data. Adds to Wave 15 pen-test backlog.
- **Files**: `backend/cmd/tests/suite_whatsapp_multi_number.go` (new), updates to Wave 15 spec
- **Acceptance**: cross-number isolation provably enforced; forge attempt logged + ignored.

---

# Wave 38 — BYO SMTP + central email metering

**Why now**: Now-1 in roadmap (BYO email pattern). All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `email_provider_credentials` folds into Wave 0 / migration 008 (alongside payment credentials).

### T38.1 — Email-provider abstraction (sonnet)
Mirror the payment-provider pattern. Interface:
```go
type EmailProvider interface {
    Code() string                      // "resend", "sendgrid", "mailgun", "ses", "smtp"
    Send(ctx, From, To, Subject, Body, Attachments) (provider_msg_id string, err error)
    VerifyDomain(ctx, domain) (verified bool, dns_records []DNSRecord, err error)
}
```
Adapters: `internal/email/{resend,sendgrid,mailgun,ses,smtp}/`. Registry resolves: per-store credentials if configured, else BeepBite's central Resend account.
- **Files**: `backend/internal/email/*` (new — package + adapters)
- **Acceptance**: send via central Resend works; same call routed through a tenant's Resend key works; smtp adapter sends via plain SMTP.

### T38.2 — Tenant BYO email setup UI (sonnet)
`/settings/location/:id/email` — choose provider, paste API key or SMTP credentials, set default `from` and `reply_to`. Verify domain (SPF/DKIM/DMARC display with copy-to-clipboard).
- **Files**: `src/pages/settings/location/email/*` (new), `backend/internal/handlers/emailproviders/handler.go` (new)
- **Acceptance**: tenant pastes a real Resend key, sends a test email, sees it land; remove key → falls back to central.

### T38.3 — Email metering + quota (sonnet)
Extends Wave 19 quota system with `email_outbound` resource. Free tier: 300 emails/loc/mo, hard cap. Paid tiers: 2k/15k/50k included, $0.002/$0.0015/$0.001 overage. **Skip metering for tenants on BYO** — they pay their provider directly.
- **Files**: `backend/internal/quota/email.go` (new), wire into the email send dispatcher
- **Acceptance**: central-email tenant hits quota → wallet debited (or hard cap if free); BYO tenant unmetered.

### T38.4 — Domain verification helper + onboarding (sonnet)
A small wizard guides tenants through SPF / DKIM / DMARC setup when they BYO. Polls DNS until verified or 24h timeout. Status visible in settings.
- **Files**: `backend/internal/email/domain_verify.go` (new), `src/pages/settings/location/email/verify-modal.jsx` (new)
- **Acceptance**: a tenant adding their own domain sees the three required records; pasting them at their DNS host + clicking verify shows "Verified" within a few minutes.

---

# Wave 39 — Security gaps: 2FA + tenant audit-log + activity alerts

**Why now**: Now-30 in roadmap. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `member_2fa_secrets` and `member_activity_alerts_config` fold into Wave 0 / migration 002.

### T39.1 — TOTP 2FA for member accounts (sonnet)
Standard TOTP (RFC 6238) using `github.com/pquerna/otp`. Enrollment generates a QR code; 8 backup codes shown once. Verify on every login; require 2FA for owner-role members; opt-in for managers. Recovery flow via email + backup codes.
- **Files**: `backend/internal/auth/totp.go` (new), `src/pages/settings/account/2fa/*` (new)
- **Acceptance**: enroll → log out → log in requires TOTP code; backup code single-use; recovery email arrives.

### T39.2 — Tenant audit-log viewer (sonnet)
`/manager/audit` shows the org's own `audit_log` rows. Filters: actor (member / staff / api_key), action, table, date range. Paginated. Capability `can_view_audit_log` (default true for managers / owners).
- **Files**: `src/pages/manager/audit/*` (new), `backend/internal/handlers/audit/list.go` (new)
- **Acceptance**: voiding an order from one device shows up in audit log on another within seconds; RLS prevents seeing another org's rows.

### T39.3 — Suspicious activity alerts (sonnet)
Background job scans recent activity for patterns: ≥10 voids/hour from one staff, ≥3 PIN failures in 5min from one device, wallet drop >50% in 24h, ≥5 refunds/hour. Triggers push (Web Push API) + dashboard banner + audit row. Configurable thresholds per location.
- **Files**: `backend/internal/jobs/security_alerts/runner.go` (new), `src/components/security-banner.jsx` (new)
- **Acceptance**: simulated 10 voids in 5min from one staff fires the alert; thresholds tunable.

### T39.4 — 2FA enforcement smoke + pen-test (sonnet + opus in Wave 15)
Smoke: enroll, verify, login flow. Pen-test queue: TOTP replay protection (single-use within window), backup-code race, downgrade attack (skip 2FA via auth endpoint mismatch), recovery-flow phishing.
- **Files**: `backend/cmd/tests/suite_2fa.go` (new), Wave 15 spec updates
- **Acceptance**: smoke green; pen-test items filed.

---

# Wave 40 — Operational gaps: image uploads, time-clock, WA templates, EOD email

**Why now**: Now-31 in roadmap. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — covered by existing tables in Wave 0.

### T40.1 — Item image upload UX (sonnet)
`/menu` page gains drag-drop image upload. Image processed (resize to 1200x1200, WebP), saved to R2, URL stored in `items.image_url`. Replace + remove flows. Items without images fall back to a category-derived emoji.
- **Files**: `backend/internal/handlers/items/image_upload.go` (new — POST `/items/:id/image`), `src/pages/menu/components/item-image-upload.jsx` (new)
- **Acceptance**: drag-drop a 5MB JPEG → returns optimized 200KB WebP URL; replace works; remove works.

### T40.2 — Time-clock UI completion (sonnet)
`/s/:slug` keypad gains a "Clock in / Clock out" mode (toggle at the top). PIN authenticates → flips `staff_time_entries`. `/staff/manage` adds an "Hours" tab showing current week's clocked hours per staff. Manager edit on time entries with audit attribution.
- **Files**: `backend/internal/handlers/timeclock/handler.go` (new), `src/pages/staff-pin/components/clock-in-toggle.jsx` (new), `src/pages/staff/manage/hours-tab.jsx` (new)
- **Acceptance**: clock in via PIN → time entry row; clock out → entry closed; manager edit writes audit row.

### T40.3 — WhatsApp template pre-approval ops (sonnet)
Operations runbook: submit our launch templates (order confirm, kitchen-ready, on-the-way, delivered, password reset, link-binding nudge, marketing opt-in) for Meta approval per language. Admin tool tracks state per template per number (Wave 37).
- **Files**: `docs/whatsapp-templates.md` (new — list + rationale), `backend/internal/handlers/admin/templates.go` (new — list + status)
- **Acceptance**: template list documented; admin UI shows approval state per number.

### T40.4 — End-of-day owner email (sonnet)
Daily summary email at the location's timezone close (configurable per location, default 11pm local): gross / net / tax / tips / orders count / new customers / top 5 items / over-short on cash drawer. Opt-out toggle.
- **Files**: `backend/internal/jobs/eod_summary/runner.go` (new)
- **Acceptance**: end-of-day owner email lands in inbox with all numbers from the daily reporting views.

---

# Wave 41 — Easy wins extended (10 more POS features)

**Why now**: Now-32 in roadmap. All `sonnet`, 10 parallel — each ≤1 day.

**Migration numbers owned**: small follow-up migration 018 if needed.

### T41.1 — Held tickets (sonnet)
`orders.held bool default false` + `held_at`. POS workspace "Hold" button on a ticket pauses it (doesn't fire kitchen) until unheld.
- **Files**: schema follow-up if needed, POS workspace edit
- **Acceptance**: holding a ticket prevents KDS fanout; releasing fires kitchen normally.

### T41.2 — Tab / open check (sonnet)
A "tab" is an open order across multiple add-events without a table_session. New `tabs` (id, location_id, customer_id?, opened_by, name, status). POS workspace "Open tab" → name it → add items over time → settle at end.
- **Files**: small migration; `backend/internal/handlers/tabs/handler.go` (new); POS UI
- **Acceptance**: open a tab, add 3 items across 30 minutes, settle; one order on tender; tab disappears.

### T41.3 — Daily specials pinned banner (sonnet)
`items.is_daily_special bool` + `daily_special_until timestamptz`. Items so marked show in a pinned banner at top of POS grid AND on customer marketplace store page.
- **Files**: schema; POS UI + marketplace UI
- **Acceptance**: mark "jollof" as daily special until 6pm; pinned at top of POS + marketplace; auto-unpins at 6pm.

### T41.4 — Bar quick-pour mode (sonnet)
A POS view variant: tap a drink → instantly added to cart with no modifier picker (skips even required modifier groups). Per-location toggle in settings.
- **Files**: `src/pages/work/views/pos/quick-pour.jsx` (new variant of Quick POS)
- **Acceptance**: setting on → tapping a drink with required modifier still adds without picker.

### T41.5 — Wait time estimation (sonnet)
Compute estimated wait from current kitchen load: active KDS tickets × avg-prep-time-by-station. Surface on customer marketplace ("12-15 min wait right now"), customer chat, and KDS expo screen.
- **Files**: `backend/internal/handlers/kitchen/wait_time.go` (new); marketplace + chatbot integration
- **Acceptance**: empty kitchen → ~0 min; 10 active tickets → ~20-30 min (heuristic, configurable).

### T41.6 — Quick category 86 (sonnet)
86 entire category at once with one tap. Useful when "breakfast is over" — all breakfast items go 86'd until manually un-86'd or auto-reset at midnight.
- **Files**: `backend/internal/handlers/categories/eighty_six.go` (new); manager dashboard
- **Acceptance**: 86 breakfast → all breakfast items hidden in customer marketplace + chatbot; un-86 restores.

### T41.7 — Dual cash drawer (sonnet)
A POS workspace can have two `cash_drawer_sessions` open simultaneously, each tied to a different staff member. Tender flow asks "which drawer?" when both are open.
- **Files**: schema follow-up if needed; POS workspace UI
- **Acceptance**: open two drawers under two staff PINs; tender splits to selected drawer; EOD close per drawer.

### T41.8 — Print queue retry (sonnet)
ESC/POS sender (Wave 29) wraps in a retry queue. Printer offline → buffer in IndexedDB → retry every 30s × 1h → finally surface "X tickets failed to print" alert in dashboard.
- **Files**: `src/lib/print-queue.js` (new), small backend metric for failed prints
- **Acceptance**: unplug printer → print 3 tickets → reconnect → all 3 print in order.

### T41.9 — Quick coupon generation (sonnet)
From customer detail, "Send coupon" button generates a one-off `coupon_codes` row (e.g., 20% off, expires 7 days) and sends via WhatsApp + email.
- **Files**: `backend/internal/handlers/coupons/quick_send.go` (new); customer detail UI
- **Acceptance**: button generates a unique code, sends it, redeemable once by that customer.

### T41.10 — Customer favorites (sonnet)
Customer marks items as "Favorite" in marketplace / chatbot. Stored on `customer_favorites` (customer_id, item_id, added_at). Surfaced in chat ("usual?") and on store page for that customer.
- **Files**: schema; `backend/internal/handlers/customers/favorites.go` (new); marketplace + chatbot integration
- **Acceptance**: favoriting an item shows up next visit; can unfavorite.

---

# Wave 42 — Legal foundation: ToS / Privacy / Cookie consent / Compliance pack

**Why now**: Now-33 in roadmap. Pre-launch legal scaffolding. All `sonnet`, 4 parallel.

**Migration numbers owned**: none — `tos_acceptances` and `cookie_consents` fold into Wave 0 / migration 013.

### T42.1 — Platform ToS + Privacy Policy pages (sonnet)
Versioned legal docs at `/legal/terms` and `/legal/privacy`. Markdown sources in `docs/legal/`. Every signup records `tos_acceptances` (user_id, version, accepted_at, ip). New version → users prompted to re-accept on next login.
- **Files**: `docs/legal/{terms,privacy}.md` (new — placeholder content to fill with a lawyer's input later), `src/pages/legal/*` (new), `backend/internal/handlers/legal/acceptance.go` (new)
- **Acceptance**: signup records acceptance row; admin view shows acceptance distribution across versions.

### T42.2 — Per-tenant Privacy Policy generator (sonnet)
Template that fills business info (Now-26) into a per-store privacy policy. Owner can edit. Linked from the marketplace store page footer and customer-facing checkout.
- **Files**: `src/pages/settings/legal/*` (new), template at `docs/legal/tenant-privacy-template.md`
- **Acceptance**: editing generates a fresh PDF + public URL `{slug}.beepbite.io/legal/privacy`.

### T42.3 — Cookie consent banner (sonnet)
Klaro (or similar OSS) integrated on `app.beepbite.io` and per-tenant marketplace pages. Granular consent (necessary / analytics / marketing). Consent stored on `cookie_consents` keyed by IP + cookie. Re-prompt on EU detection.
- **Files**: `src/components/cookie-consent.jsx` (new), `src/App.jsx`
- **Acceptance**: EU IP gets banner; selection persists; analytics scripts gated by consent.

### T42.4 — GDPR/POPIA compliance pack (sonnet)
Static + generated docs:
- `docs/sub-processors.md` (maintained list: Meta, Anthropic, OpenAI, Resend, Twilio, Fly, Cloudflare).
- `docs/dpa-template.md` (Data Processing Agreement template auto-generated per tenant).
- `docs/data-residency.md` (where data lives — primary JNB, replicas IAD/AMS/SIN).
- `docs/breach-runbook.md` (72h notification flow).
- **RoPA**: auto-generated from the data model — endpoint `/admin/ropa` produces an inventory of what data we hold, where, who can access it, retention period.
- **Env**: `BEEPBITE_DPO_EMAIL` for the contact.
- **Files**: `docs/{sub-processors,dpa-template,data-residency,breach-runbook}.md` (new), `backend/internal/handlers/admin/ropa.go` (new)
- **Acceptance**: RoPA endpoint returns a structured doc listing every personal-data field with retention policy.

---

# Wave 43 — Native shell (Tauri + Capacitor) — final v1 wave

**Why now**: Now-35 in roadmap. **Do not start until everything is responsive (Wave 36) + stable**. All `sonnet`, phased.

**Migration numbers owned**: none.

### T43.1 — Tauri desktop shell (Mac / Windows / Linux) (sonnet)
`tauri-app/` directory. Wraps the existing React build. Native printing via Tauri's filesystem + raw-printer bridge. Native receipt scanner via Tauri's USB plugin. Auto-update via Tauri's updater. Side-load `.deb` / `.dmg` / `.exe`.
- **Files**: `tauri-app/` (new project)
- **Acceptance**: build produces native installers for all three platforms; printer + scanner work without WebSerial.

### T43.2 — Capacitor iOS + Android shell (sonnet)
`capacitor-app/` directory. Wraps the same React build. Native camera for bulk-import menu photos. Native push notifications (cross-platform). Distributable via TestFlight + Play internal testing first.
- **Files**: `capacitor-app/` (new project)
- **Acceptance**: builds produce signed iOS + Android binaries; camera + push work.

### T43.3 — Offline Tier 2 unlock (sonnet)
With native shell guaranteeing local persistence, enable the real-offline path: orders complete in cash mode while offline; card transactions queue; conflict resolution on reconnect via the existing ULID + idempotency_key infrastructure from Wave 13. KDS local cache so kitchen runs through office WiFi outages.
- **Files**: `tauri-app/src/offline/*`, `capacitor-app/src/offline/*` (new), `backend/internal/sync/conflict_resolution.go` (extend)
- **Acceptance**: 30-minute offline session with 20 orders syncs cleanly on reconnect, no duplicates, no drops.

### T43.4 — App-store distribution + auto-update (sonnet)
Mac App Store + Microsoft Store + F-Droid + Play Store + Apple App Store. Auto-update channels (stable / beta). CI builds + uploads on tagged releases.
- **Files**: `.github/workflows/release-native.yml` (new), store metadata, signing certs (manual ops)
- **Acceptance**: tagged release builds + uploads to all five stores; native installs receive auto-update.

---

# Wave 44 — Deferred follow-ups (drop-in slots)

Empty by design — opus pen-test tasks (Wave 15) file fix-tasks here. The orchestrator drops them into Wave 44 with assigned agents.

---

## Schema follow-ups inherited from prior waves

- [ ] Apply the promotions OR-filter fix to `src/pages/settings/promotions/hooks/use-promotions.js` (Wave 5 leftover — settings management view has the same bug).
- [ ] Remove the dead `src/pages/auth/verify-email.jsx` (no email verification step in the custom Go backend; signup issues a session immediately).
- [ ] `customers.loyalty_points` column is referenced by store-credit handler but not defined in migration 25; add or remove.
- [ ] DB-level triggers on `order_adjustments`/`order_payments`/`refunds` to write `audit_log` automatically (currently application-written; bypassable).
- [ ] Manager-approval enforcement: CHECK or trigger on `order_adjustments` so `approval_status='approved'` requires non-null `approved_by` when the reason `requires_manager_approval=true`.
- [ ] Split `STAFF_JWT_SECRET` from shared JWT secret (blocked on key-rotation tooling).
- [ ] Convert `delivery_zones.polygon` from JSONB to PostGIS `geometry(Polygon, 4326)` once polygon count per location exceeds 50.

---

## How an agent picks up a task

1. Read this file's task block end-to-end (incl. files & acceptance).
2. Read the affected source files.
3. Read [ROADMAP.md](./ROADMAP.md) for context if the task seems ambiguous.
4. Make the change. Run `go build ./...` (backend) or `npm run build` (frontend) before declaring done.
5. Run the acceptance checks listed in the task.
6. Mark the checkbox `[x]` in this file and append a one-line note: `→ commit <sha>` or `→ files changed: ...`.
7. Stop. Do not pick up a different task in the same run unless explicitly instructed.

---

## How a pen-test agent (opus) picks up a task

1. Read the task block.
2. Read the relevant handler / middleware source.
3. **Write the failing test first** that demonstrates the attack succeeding (if it succeeds).
4. If the system defends correctly, the test passes immediately — keep it as a regression guard.
5. If the system leaks, file the fix-task as a new entry in Wave 16 with:
   - `Severity`: critical / high / medium / low
   - `Files affected`: which handler/migration to change
   - `Attack vector`: one-line description
   - `Proposed fix`: one-paragraph description
6. Write the report at `docs/pentest/<topic>.md`.
