# BeepBite — Product Roadmap

> **One platform, two doors in.** A central WhatsApp + web marketplace where customers discover restaurants by slug and order in chat or browser, and a full Point-of-Sale + Kitchen Display system that runs the same restaurants from behind the counter. Restaurants bring their own payment provider keys (Paystack today; Stripe / PayFast next). The platform is priced in USD and settles in local currency via a live FX rate.

This roadmap is the source-of-truth for direction, sequencing, and what's shipped. It is also written to be quotable on the landing page — every "Now" line is a real customer-visible promise.

---

## The product, in one screen

```
              ┌────────────────────────────────────────────────────────┐
              │                BeepBite Marketplace                    │
              │  Central WhatsApp number  +  web at  app.beepbite.io   │
              │   "find me restaurants in Durban that do biryani"      │
              └─────────────────────┬──────────────────────────────────┘
                                    │  slug-routed discovery
                                    ▼
       ┌────────────────────────────────────────────────────────────────┐
       │   Tenant store   /s/myrestaurant-durban                        │
       │                                                                │
       │   ┌────────────────┐   ┌────────────────┐   ┌────────────────┐ │
       │   │   Full POS     │   │   Quick POS    │   │  Kitchen (KDS) │ │
       │   │  (tables,      │   │ (counter-tap)  │   │ (station bump  │ │
       │   │   modifiers,   │   │                │   │  + expo screen)│ │
       │   │   splits)      │   │                │   │                │ │
       │   └───────┬────────┘   └───────┬────────┘   └───────┬────────┘ │
       │           │  staff PIN (4-6 digits) attributes every action    │
       │           ▼          ▼          ▼                              │
       │   ┌────────────────────────────────────────────────────────┐   │
       │   │            Orders · Payments · Audit                   │   │
       │   │   Paystack / Stripe / PayFast (BYO keys per store)     │   │
       │   └────────────────────────────────────────────────────────┘   │
       └────────────────────────────────────────────────────────────────┘
              All surfaces are offline-resilient (Tier 1)
              and progressing toward full offline (Tier 2).
```

---

## Foundation reset — consolidated schema + Row-Level Security

We treat this as a fresh system. Before any new feature lands, we **fold the existing 46 migrations into 13 clean migrations with RLS baked in from the first table**. The motivation is two-fold:

1. **Defense in depth.** Handlers trust JWTs for identity but rely on the frontend to pass `organization_id` in filter predicates. That's a single broken handler away from a cross-tenant data leak (see "What's broken"). RLS makes the database refuse the leak even if every handler above it is wrong.
2. **Comprehensibility.** Forty-six chronological migrations are unreadable. Thirteen domain-scoped migrations — auth & tenancy, menu, inventory, orders & KDS, payments, cash & adjustments, engagement, delivery, shifts & payroll, compliance — let a new contributor learn the schema in an afternoon.

The session-variable contract: every authenticated request sets `app.current_user_id`, `app.current_org_id`, `app.current_capabilities` (jsonb) on the connection via `SET LOCAL`. Policies read those values and gate every row. A `service_role` bypass exists for the migration tool and explicitly-scoped admin scripts. Anonymous connections see nothing on tenant-scoped tables; public marketplace endpoints use a tightly-scoped `marketplace_role` that can SELECT only `is_marketplace_visible=true` rows from a whitelist of tables.

This work happens **first** (Wave 0 in [tasks.md](./docs/internal/tasks.md)) and is driven by **opus** agents in three phases:
- Phase A — one opus designs the consolidation plan and writes the RLS helper functions.
- Phase B — six opus agents in parallel implement the thirteen consolidated migrations with their RLS policies inline.
- Phase C — one opus writes the RLS verification suite (anonymous, member-of-org-A, service-role) that becomes the Wave 0 acceptance gate.

After Wave 0, every subsequent wave's migrations layer on top of the consolidated base — and every new table is RLS-enabled at creation, never after.

## What's shipped (foundation)

The schema is far ahead of the UI by design — get the data model right, layer surfaces on top. The consolidated set in Wave 0 absorbs everything below; the legacy 46-migration history will be archived under `backend/migrations/legacy/` for reference.

| Domain | What's live |
|---|---|
| Tenants & members | Org/location model, org invites, refresh-token JWT, Google OAuth, manager-set-PIN |
| Staff PIN | `staff` table with bcrypt-hashed PINs, 5-strike / 15-min lockout, staff JWT (audience `"staff"`) |
| Menu | Categories (recursive), items, item variations, recipes (recursive cost), schedules / dayparts, happy-hour pricing, allergens, dietary tags, 86-list, auto-86 trigger |
| Orders | Full lifecycle, dine-in via `table_sessions` + `seats`, course firing, split-check, transfer-check |
| KDS | `kitchen_stations`, `item_station_routing`, `kds_tickets` + events log, fan-out queue + worker, SSE broker, expo view |
| Cash | Drawer sessions, denomination counts, blind-close, EOD report view, paid-in/paid-out/no-sale movements |
| Adjustments | Void / comp / price-override / refund with reason codes + manager approval trigger |
| Payments | Region-scoped Paystack + Stripe managers, per-region webhook routes, bank-account encrypt + Paystack transfer-recipient, weekly payout worker, transfer-webhook reconciler |
| Inventory | Suppliers, POs, GRNs, 3-way invoice match, ingredient price history, waste reasons, prep batches, recipe cost runner |
| Reporting | `daily_sales_summary`, `hourly_sales_heatmap`, `menu_engineering`, `labor_hours_daily`, `labor_cost_daily`, `sales_per_labor_hour`, `theoretical_vs_actual_cogs`, `revenue_by_payment_method` |
| Engagement | Promotions + coupons + line-level discounts, gift cards, store credit, house accounts + invoicing, loyalty config + ledger, reservations + waitlist |
| Delivery | Delivery zones with polygon + ray-casting lookup, partner integration schema (Uber Eats / DoorDash / Grubhub / Postmates) — schema only; Go runner pending |
| Compliance | Audit log (polymorphic actor), idempotency keys table, webhook event log, fiscal receipt sequencer (gap-free per location), PII access log, audit retention job |
| Frontend shell | Shadcn/ui + Tailwind + orange brand, 35+ routes, manager dashboard, full menu editor, KDS station + expo, dedicated `/pos/workspace` ticket UI, cash drawer, promotions, payouts, settings |

A full migration index lives in `backend/migrations/`. All 46 migrations apply clean from scratch (`go run ./cmd/migrate --env=local --reset`).

---

## What's broken right now

Surfaced by the May 2026 audit pass. These are the proximal causes of "kitchen backend is broken" and the cross-cutting risks ahead of the marketplace launch.

1. **Cross-tenant exposure on POS/KDS/cash endpoints** — handlers trust client-supplied `location_id` / `station_id` and never cross-check the caller's org membership. Any valid JWT can read or mutate data across organizations if the IDs are guessed. This is the single most important fix before the marketplace exposes the directory publicly. **The Wave 0 RLS consolidation closes this hole at the database layer; Wave 6 closes it at the handler layer (defense in depth).**
2. **KDS fan-out fallback is silent** — `pos/store.go` swallows `fanoutInsideTx` errors with `_ = err` and relies entirely on the `kds_fanout_queue` trigger. If the migration didn't deploy, kitchen sees nothing and no log fires.
3. **Audit actor is always NULL** — auth middleware stores claims under `ctxKey(int)`; `data/audit.go` reads context key `"actor_id"` (string). No row records who.
4. **Tax rate hard-coded at 15%** — `pos/store.go:150` `const taxRate = 15.0`. Zero-VAT regions overcharge.
5. **Hard-coded provider in webhook log + payments columns** — `webhook_event_log.provider` CHECK includes `'paystack'`; `order_payments` still has `paystack_reference`/`paystack_status`/`paystack_gateway_response` columns. Multi-provider needs a generic `payment_attempts` table.
6. **`staff.email UNIQUE NOT NULL` blocks one employee at multiple stores** and prevents the "shared staff account" pattern.
7. **No store slug** — `/s/:slug` cannot resolve; `locations` has no slug column.
8. **No frontend marketplace** — store discovery, customer cart, customer checkout do not exist client-side.
9. **No offline plumbing** — zero service worker, zero IndexedDB, zero mutation queue. A 30-second WhatsApp outage in Durban drops orders.
10. **Test coverage is thin** — two integration `_test.go` files + an HTTP runner that covers ~30% of critical paths. No CI runs Go tests. No pen-testing. No cross-tenant probing.

Each of these has a corresponding task in [tasks.md](./docs/internal/tasks.md).

---

## Now — committed v1 scope

The horizon line: launch the central marketplace, lock the platform against cross-tenant abuse, and ship the breadth of features that competes with Toast / Square / Loyverse on day one. Items are tracked as Now-0 through Now-22 below; each maps to one or more execution waves in [tasks.md](./docs/internal/tasks.md). "Now" doesn't mean "all simultaneously in flight" — it means "committed; in the active backlog." Wave 0 unblocks everything.

### Now-0 — Foundation reset (consolidated migrations + RLS)
Folding the 46 chronological migrations into 13 domain-scoped migrations with Row-Level Security baked in from creation. Opus-driven, three phases (plan → parallel implement → verify). Acceptance gate: a verification suite proves anonymous = no access, member-of-org-A = only org-A rows visible, service-role = full access. Until this lands, every other wave is provisional.

### Now-1 — Billing model + wallet + quotas + multi-LLM provider abstraction
**Priority workstream — everything customer-facing meters against this.**

Tuned model (final): **Free / Starter $39/loc / Growth $249/loc / Scale $799/loc**, with wallet as the universal overage backstop. 90-day inactivity auto-pause on free tier. Profitable at 100 tenants with as little as 10% paying conversion; pure-platform unit margins 53-95% across the paying band. Numbers are grounded in published rates (Meta WhatsApp BCAPI, Anthropic Sonnet 4.5, Twilio, Fly, R2) — see `pricing/` folder.

Implementation:
- **Wallet** per org (USD-denominated balance, currency-converted on top-up via the tenant's payment provider). Append-only `wallet_transactions` ledger, idempotency-keyed.
- **Wallet is the single funding mechanism.** Tier base fees + overages all debit the same wallet. No separate subscription billing — invoices are a *record* of debits, not the payment trigger.
- **Auto-refill** (default ON for paid tiers): tenant saves a payment method (tokenized via their configured provider), sets `auto_refill_threshold` (default $5) and `auto_refill_target` (default $50). Nightly cron charges the saved card to top up when balance dips below threshold. Configurable per org; can be disabled by tenants who prefer manual top-ups.
- **Quotas** per resource (`orders`, `whatsapp_outbound`, `llm_messages`, `email_outbound`, `bulk_imports`) per location per billing period. Free tier enforced as hard cap; paid tiers consume includes-then-overage debited in real-time.
- **Metering middleware** stamps every metered handler call into `wallet_transactions` + `quota_usage`.
- **Dunning ladder** on auto-refill failure: retry in 24h → if still fails, email + WhatsApp + dashboard banner → day 7 degrade (LLM/WhatsApp/SMS disabled, POS keeps working) → day 14 auto-pause → connects to the existing 90-day inactivity cleanup.

**BYO email (SMTP / Resend / SendGrid / Mailgun / SES) — same pattern as BYO payment keys**:
- Default: BeepBite's central Resend account; outbound emails metered against the org's `email_outbound` quota; overage drains wallet at the tier's email rate.
- Optional: tenant pastes their own email-provider keys + sender domain in settings. When configured, their outbound emails go through their provider and DO NOT metric against our quota (they pay the provider directly).
- One unified `email_providers` registry + per-store credentials table, mirroring the payment-provider abstraction from Now-4.

**Multi-LLM provider abstraction** — and this is critical for cost control:
- We support **Anthropic Claude, OpenAI GPT, Google Gemini, Moonshot Kimi** out of the box. Routing per task: customer chat → cheapest capable model (Haiku / GPT-4o-mini / Gemini Flash); owner chat → mid-tier (Sonnet / GPT-4o / Gemini Pro); bulk vision imports → vision-capable best (Sonnet / GPT-4o / Gemini Pro).
- **No provider configured (no API key in env) → that provider is silently disabled.** Models not in our pricing data → also disabled. No manual list maintenance.
- **Dynamic model discovery**: at boot and every 6h, call each enabled provider's `GET /v1/models` (or equivalent) to enumerate currently-supported models. New models the provider releases become available the day they ship.
- **Dynamic pricing sync**: nightly job fetches `model_prices_and_context_window.json` from [BerriAI/litellm on GitHub](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json) — the community-maintained source-of-truth for LLM token costs across every major provider. Stored in `llm_model_pricing` table with `updated_at` and `source`. Pricing changes by Anthropic / OpenAI / Google flow through within 24h. Local fallback snapshot in the repo for offline / rate-limited cases.
- **Cost-aware routing**: at request time, the router picks the cheapest model that has the capabilities the task needs (vision, tool-use, context-length). Tenants see the *same* customer-facing price — our margin compounds.

**Self-protection guardrails (non-negotiable — these stop us being abused):**

| Risk | Defense |
|---|---|
| Zombie free tenants compounding loss | **90-day inactivity auto-pause**. Day 30 warning email/WhatsApp, day 60 dashboard banner, day 75 pause scheduled, day 90 pause executed (read-only, store URL shows "temporarily closed"). Reactivate by upgrading or topping up wallet $5. Day 180 still paused → soft-delete (30-day recoverable) → hard-delete. |
| Free-tier farming (one person creating many free orgs) | One free tier per verified identity. Signup fingerprinting (same IP + device + payment instrument cluster) limited; second free org from same cluster requires wallet top-up. |
| Anonymous WhatsApp scraping our LLM | Hard rate-limit on unbound numbers (Wave 17 link flow): 5 LLM messages then the bot only sends the link-binding nudge. |
| Runaway LLM loop (tool call cycles, prompt injection) | Max 50 turns per conversation; max 10 sequential tool calls without user input; hard token budget per turn (5k input / 1k output). Breach → conversation reset + audit row. |
| Bulk-import cost blast | Vision-call rate limit per tenant per day; uploads above 100 items per single import require human review before committing. |
| Wallet drain attack (compromised owner account spamming) | Daily wallet-drain ceiling (e.g. 50% of balance/24h or $200/24h whichever higher) — beyond that requires re-PIN. Owner gets push + email on every $20+ debit. |
| WhatsApp marketing category abuse (10× cost of utility) | Marketing-category sending disabled by default; owner must explicitly opt in per location. Caps on broadcast size. |
| Customer-side abuse (mass orders, no-shows) | Per-customer order rate limit; no-show tracking on `customers.no_show_count` with auto-block past N strikes. |

Every guardrail is auditable (writes `audit_log`), reversible (manager unlock from `/manager` dashboard), and tested in Wave 15 pen-tests.

### Now-2 — Safety: tenant isolation, audit attribution, KDS resilience
- Shared middleware: `RequireOrgScope` resolves the caller's org from `organization_members`, injects into context, every handler cross-checks `location_id`/`station_id` against it.
- Fix audit actor context key. Every financial mutation writes an `audit_log` row with non-null `actor_id`.
- Explicit `INSERT INTO kds_fanout_queue` in the `pos.CreateOrder` fallback branch. Dead-letter cap on the fan-out runner.

### Now-3 — Marketplace foundations
- `locations.slug` + `city` + `country` (ships in Wave 0 / migration 008). Slug is URL-safe, unique.
- Public endpoint: `GET /stores` (search by slug, name, city, geo radius) — no auth.
- Public endpoint: `GET /stores/:slug` (store profile + menu snapshot).
- Frontend marketplace surfaces: `app.beepbite.io/discover` (central directory), `app.beepbite.io/store/:slug` (menu + cart), `app.beepbite.io/checkout`.
- **Per-store subdomain**: `mystore.beepbite.io` — wildcard DNS at Fly.io, wildcard TLS via `fly certs add '*.beepbite.io'`. Backend middleware extracts subdomain from `Host` header, resolves to `location_id` via slug. Frontend reads `window.location.hostname`, auto-routes the SPA to that store's customer page. Reserved subdomains: `app`, `api`, `www`, `admin`.
- `app.beepbite.io/s/:slug` (or simply `mystore.beepbite.io/s`) is the staff PIN keypad for that store.

### Now-4 — Generic multi-provider payments (BYO keys) + on-delivery fallback
- `payment_providers` registry, `location_payment_credentials` (per-store encrypted keys + webhook secret per provider), `payment_attempts` keyed by provider txn id (ships in Wave 0 / migration 008).
- Go `PaymentProvider` interface; thin adapters wrap Paystack and Stripe. New providers are one map entry.
- Unified webhook: `POST /webhooks/:provider/:location_id` dispatches on provider string.
- Frontend: settings → Payments tab to paste keys, see the auto-generated webhook URL, copy step-by-step provider-dashboard instructions.
- **On-delivery payment fallback**: if a store has not configured any online provider, they must enable at least one of: **cash on delivery** or **card machine on delivery** (the merchant handles their own deliveries; the card machine sits with the driver). Stored as `locations.on_delivery_payment_methods text[]`. Customer checkout offers these options instead of an online-payment redirect; the order is created in `pending_on_delivery` status and marked paid by staff after the handover.

### Now-5 — Staff PIN as actor-overlay (not a parallel session)
- Member JWT logs the device in to a store; PIN identifies the actor for that action.
- New endpoint: `POST /pos/pin-verify` returns a short-lived actor token layered on the member session.
- Middleware `ActorFromContext` reads either the staff JWT (legacy) or the overlay actor.
- Capability flags on `organization_members`: `can_pos`, `can_kitchen`, `can_void`, `can_comp`, `can_settle`, `can_view_reports`. `kitchen` and `pos` added to role CHECK.

### Now-6 — Roles + capabilities, flexible by design
- Generic `staff` role + distinct `kitchen` / `pos` roles + per-member capability overrides. Owners can mint "kitchen person who can also ring up takeout" without inventing new roles.
- Capability check helper in Go; route guards in React.

### Now-7 — Drivers, delivery portal, live tracking
- **Stores opt in to delivery and/or collection.** A store can offer collection only, delivery only, or both. The marketplace surface shows only what's offered.
- **`driver` role + `can_drive` capability.** A store owner invites a driver by email; the driver signs up (Google OAuth or email verify) and the invite auto-accepts on email match — they then have driver-role membership in that org.
- **Central driver portal at `/driver`** — anyone can navigate to it. If signed-in user has no `driver` role anywhere, the page explains: "Ask the restaurant that hired you to invite the email you signed up with." Otherwise it shows the union of active deliveries across every org that has invited them. One driver, many restaurants.
- **Uber Eats-style live updates.** Driver app pings location every 5–10 seconds while a delivery is active; pings stop when delivered or canceled. Driver toggles online/offline.
- **Customer-facing live tracking** at `app.beepbite.io/track/:token` (or `mystore.beepbite.io/track/:token`). The token is order-scoped, short-lived, and tied to the customer's JWT. The page shows store location, customer address, and the driver's marker — but only if **(a)** the driver is currently within ~5 km of the delivery address, **(b)** the order is in `out_for_delivery`, and **(c)** the requestor matches the order's customer. Outside the radius the page shows ETA only, not exact location. Same privacy posture as Uber Eats.
- **Driver privacy.** Location pings retained 7 days, then aggregated. Driver controls visibility per shift; emergency contact + "share trip" with a chosen contact.

### Now-8 — WhatsApp number ↔ email account binding
- Every WhatsApp number that talks to the bot is bound to exactly one BeepBite account (an `auth_users` row). Max **3 numbers per account** — covers personal + work + family lines.
- **First-touch flow**: when the bot receives a message from an unknown number, it replies with a single message: "Welcome — sign in to start ordering: `app.beepbite.io/link-whatsapp/<short-token>`". The token expires in 15 minutes.
- The link lands on a page that requires JWT (Google OAuth or email-verify); after auth, the page asks: "Do you want to add **+27 …** to your BeepBite account?" One tap → bound. The bot is notified and the next inbound message proceeds straight into the menu.
- If the account already has 3 numbers, the page shows a "manage numbers" view first — replace one to add the new one.
- **Why this matters**: orders are tied to real accounts, not anonymous phone numbers; we can show order history; live tracking links require the same JWT to view.

### Now-9 — Customer chat assistant
A general-purpose chat surface for marketplace customers that fronts the same flows the WhatsApp chatbot exposes — plus more. Implemented with Claude (Anthropic API, prompt caching enabled) using **tools**:
- `get_user_location` — read from browser geolocation API or WhatsApp location share.
- `search_stores(q, lat, lng, radius_km)` — public marketplace search.
- `get_store_menu(slug)` — current menu snapshot for the store.
- `get_item_details(item_id)` — pricing, modifiers, allergens.
- `add_to_cart(item_id, qty, modifiers)` — adds to the current customer's cart for that store.
- `view_cart()` / `confirm_order()` — submits.
- `track_order(order_id_or_token)` — returns the same data the `/track/:token` page shows, in chat form.

Surfaces:
- **Web**: chat panel on `app.beepbite.io` + on per-store subdomains. The customer's JWT scopes tool calls.
- **WhatsApp**: same agent, same tool registry, message-passing transport. The first inbound message still goes through the link-token flow (Wave 17) so the LLM has a real account to act on.

Metering: every assistant message increments the org's `llm_messages` quota; tokens-in/tokens-out and total cost recorded in `llm_messages` + `llm_tool_executions` rows.

### Now-10 — Manage your store from WhatsApp (owner assistant)
Restaurant owners run their store from WhatsApp with a chat assistant. Same Claude-API backbone, different tool registry:

**Direct commands** (shortcut path; no LLM needed for clarity):
- `/86 jollof` — flips `is_86ed=true` on the matching item.
- `/price jollof 75` — sets price.
- `/sales today` — replies with `daily_sales_summary` for today.
- `/help` — lists commands.

**LLM tools** (free-form natural-language path):
- `list_items({location_id?, category_id?})`, `create_item`, `update_item`, `delete_item`, `set_price`, `eighty_six_item`, `un_eighty_six_item`.
- `list_categories`, `create_category`.
- `import_menu_from_pdf({file_url, location_id})` — uses Claude vision to extract items + prices from a PDF menu; produces a draft for owner approval before commit.
- `import_menu_from_image({file_url, location_id})` — same for images (photo of a printed menu).
- `import_menu_from_csv({file_url, location_id})` — parses spreadsheet rows into items.
- `import_menu_from_xlsx({file_url, location_id})` — same for Excel.
- `bulk_update_prices({file_url, location_id})` — CSV with `sku, new_price` rows; flips prices in one transaction with audit attribution.
- `view_today_sales({location_id})`, `view_kds_status({location_id})`, `view_low_stock({location_id})`.
- `invite_driver({email})`, `invite_staff({email, role, capabilities})`.

Every tool call is metered, audited, and scoped by RLS via the owner's actor session. Bulk imports go through a draft → review → commit flow (owner can edit before applying).

### Now-11 — USD billing via FX
- Platform prices subscriptions in **USD**; restaurants are charged in their local currency via Paystack using a fresh FX rate.
- New schema: `exchange_rates` table (per currency pair, source, fetched_at) + `subscription_invoices` carry both USD amount and local-currency amount with the rate snapshot.
- Hourly (or 2-hourly) FX fetch from a free-tier provider (selection task in [tasks.md](./docs/internal/tasks.md)).

### Now-12 — Public API + scoped API keys + tenant webhooks
Restaurants want to plug BeepBite into Xero, Quickbooks, Mailchimp, custom dashboards. Without an API we're a closed system.
- `api_keys` table: `id, org_id, name, prefix_visible, key_hash (bcrypt), scopes text[], expires_at, last_used_at, created_by, revoked_at`.
- Key format: `bb_live_<random32>` / `bb_test_<random32>` (Stripe shape). Plaintext shown once at create, never again.
- **Scopes** (granular like GitHub's): `read:menu`, `write:menu`, `read:orders`, `write:orders`, `read:reports`, `read:customers`, `write:webhooks`, `write:items`, `read:staff`, `write:staff`, `read:inventory`, `write:inventory`, etc.
- Authentication middleware: `Authorization: Bearer bb_live_…` → look up key → set `app.current_org_id` + `app.current_capabilities` via Wave 0 RLS contract. Same data layer, no parallel API surface.
- **Rate limiting** per key (1000 req/min default, configurable per tier).
- **Tenant webhook subscriptions**: `webhook_endpoints` (org_id, url, signing_secret, events[], active). Server emits signed POST on `order.created`, `order.paid`, `order.refunded`, `item.created`, `item.updated`, `staff.invited` with `X-BeepBite-Signature: t=…,v1=…` (Stripe-compatible).
- **Audit** — every API call writes `audit_log` with actor_type=`api_key`.
- Settings UI at `/settings/api-keys` — create / list / revoke. Last-used timestamp visible.

### Now-13 — Custom domains (CNAME from `www.theirstore.com`)
Tenants bring their own domain. Like Shopify, Substack, Webflow, Cal.com.
- `custom_domains` table: `id, location_id, hostname, status (pending → verifying → verified → cert_issuing → live → failed), verification_token, verified_at, cert_issued_at, removed_at`.
- **TXT-record verification before activation**: tenant adds `_beepbite-verify.www.theirstore.com TXT <token>` + `www.theirstore.com CNAME mystore.beepbite.io`; clicks "Verify"; we resolve both records.
- **Auto-cert via Fly.io**: backend calls Fly's certs API (`fly certs add www.theirstore.com`); Let's Encrypt issues; we poll until live. 10s–2min typical.
- **Host middleware** extended: `Host` header matches `custom_domains.hostname` → resolves to `location_id`. Reserved subdomains still skip lookup.
- **HTTPS-only + HSTS** mandatory. Cookies are per-host (never `Domain=.beepbite.io`).
- **Apex domains** (`theirstore.com` no www): supported only via DNS providers offering ALIAS/ANAME (Cloudflare, Route 53, Netlify, DNSimple). Documented in the verify UI.
- **Auto-revoke** on tenant churn or custom domain removal.

### Now-14 — Easy wins (10 POS quality-of-life features)
Things competitors ship that we don't — each one ≤1 day of work, big customer-experience uplift:
1. **Customer note on order** ("no onions") — free-text field on every order; visible on KDS ticket and printed receipt.
2. **Auto-gratuity for parties ≥N** — config flag per location; adds 18% as a line item when seated party ≥6.
3. **Receipt reprint** from order history — owner / cashier search past orders and re-emit receipt.
4. **Quick re-order** ("the usual?") — last-3 orders per customer, one-tap to clone into cart.
5. **Customer search by phone** — indexed lookup, opens customer detail with recent orders.
6. **Cash-out report at shift close** — joins cash drawer + member shift; shows what staff member owes the till.
7. **Pickup time slots** at checkout — time-slot capacity per location; smooths kitchen load.
8. **Group order on WhatsApp** — multiple bound numbers contribute to one cart; one bill, split optional.
9. **Loyalty stamps** ("buy 10 get 1 free") — lightweight overlay on `loyalty_transactions`; configurable per item.
10. **Item daily countdown** ("5 left of jollof today") — `daily_quantity` + decrement on order; visible to chatbot and marketplace.
11. (bonus) **Order modification before fire** — customer / cashier can edit order until KDS accepts it.

### Now-15 — Observability + multi-region deploy
Foundational. Without this, we're flying blind in production.
- **Structured JSON logs** with request ID + tenant ID + actor ID stamped on every line. Shipped to a hosted log sink (Better Stack / Axiom / Logtail — pick cheapest with adequate retention).
- **OpenTelemetry traces** on every HTTP request and DB query. Span attributes include tenant ID, actor ID, route. Hosted at Honeycomb free tier or Grafana Cloud free tier.
- **Metrics** (Prometheus / OpenMetrics) — request rate by route, p50/p95/p99 latency, error rate, DB pool saturation, queue depth (KDS fanout, payouts, FX sync, LLM sync), wallet debit rate.
- **Error tracking** (Sentry free tier or GlitchTip self-hosted) — every panic, every 5xx, every unhandled exception in the React frontend.
- **Multi-region Fly deploy** — primary region in JNB (Johannesburg) for ZA latency; replica regions in IAD (US east), AMS (Europe), SIN (Asia). Fly auto-routes by user geo. Postgres replicated read-only with primary in JNB.
- **Status page** at `status.beepbite.io` (Statuspage or self-hosted Cachet) — uptime + ongoing incidents per surface.

### Now-16 — Platform admin tool (internal BeepBite ops)
Internal dashboard at `admin.beepbite.io` (subdomain-gated to BeepBite team members only). Restaurant support, billing exceptions, abuse response.
- **Tenant search**: by org id, slug, owner email, phone, custom domain.
- **Tenant detail**: tier, wallet balance, recent transactions, active alarms (low wallet, inactivity warning, pen-test finding).
- **Force actions**: pause / unpause org, refund stuck wallet topup, reissue API key, override quota for a billing period, send a system-wide announcement.
- **Health views**: tenants in 60-day-warning state, free-tier graduation funnel, churn signals.
- **Abuse response**: signup-fingerprint cluster view, suspicious LLM usage patterns, marketing-broadcast misuse.
- Auth: only BeepBite team members with `is_platform_admin=true` on `auth_users` can access. Every action audited.

### Now-17 — Receipts (PDF + email + WhatsApp + reprint)
Tax-compliant in many regions; expected by customers everywhere.
- Receipt generation as PDF (using a Go PDF library — gofpdf or jung-kurt/gofpdf) with the store's logo, fiscal receipt number (Wave 0 already supports), itemized lines, taxes, tip, total.
- **Delivery channels**: email via Resend, WhatsApp as attachment via Cloud API, download link in customer chat.
- **Customer receives** automatically on order completion (configurable per location: email yes/no, WA yes/no).
- **Staff can re-emit** from order history (Easy Wins #3).
- Receipts stored in R2 with 7-year retention default (configurable per location for legal compliance).

### Now-18 — Customer marketplace reviews
Customer rates and reviews after delivery. Different from current `/reviews` which is restaurant-internal CSAT.
- `marketplace_reviews` table: `order_id, customer_profile_id, location_id, stars (1-5), text, photos[], verified_purchase=true (by definition), created_at`.
- Customer is prompted via WhatsApp / email 1 hour after delivery: "How was your order? Rate 1-5 ★ at <link>".
- Reviews appear on the store's marketplace page and per-store subdomain.
- Aggregate `avg_rating` and `rating_count` materialized on `locations`; refreshed on each new review.
- Owner can reply (already-shipped reply column from Wave 4 reused).
- Abusive review detection via the LLM router (a small classifier prompt; flagged reviews queued for manual review).

### Now-19 — Hardware integration (ESC/POS printers, scanner, customer display)
Real-world POS expectation.
- **ESC/POS receipt printer** driver: USB or network (port 9100). Drive Epson TM-T series, Star, generic ESC/POS. Hardware abstraction layer in Go; per-location configured printer endpoints.
- **Kitchen printer** routing: per-station printer mapping (using the same ESC/POS driver). Item routes to the matching station's printer in addition to the KDS screen.
- **Barcode scanner** support: keyboard-emulating USB scanners (work out of the box in browser); fire a "barcode scanned" event in POS, lookup `items.sku`.
- **Customer-facing display** mode: a second tab opened in a second window shows the line items as the cashier rings them up. Real-time via shared state. Optional tip selector at end.
- **Scale integration** (for weight-priced items): serial-port via WebSerial API in Chrome; price calculation = `weight_g × price_per_g`.

### Now-20 — Internationalization (i18n) + accessibility
Global product, English-only today.
- **i18next** (frontend) — start with English, Afrikaans, Zulu, isiXhosa, Portuguese, French, Spanish, Arabic, Hindi. Per-tenant default language; per-user override.
- **Customer chat assistant** auto-detects message language and replies in kind (passes through Claude system-prompt instruction).
- **WhatsApp templates** translated per region. Multiple templates approved with Meta per language.
- **Accessibility** (WCAG 2.1 AA): keyboard navigation, focus indicators, ARIA labels, screen-reader testing on POS workspace + KDS + customer marketplace.
- **RTL** support for Arabic.

### Now-21 — Backups + disaster recovery + GDPR/POPIA data deletion
Compliance and reliability.
- **Postgres backups** — Fly's managed snapshots (every 12h, 14-day retention) + an hourly logical dump via `pg_dump` to R2 for an additional 90-day retention. WAL-G if we need point-in-time recovery.
- **Quarterly restore drill** — restore the latest backup to a staging instance, run a smoke suite, verify RPO ≤1h and RTO ≤2h. Document the runbook in `docs/internal/dr-runbook.md`.
- **R2 object storage** — versioned + replicated to a second R2 bucket cross-region.
- **GDPR / POPIA data deletion flow**:
  - "Delete my account" button in `/settings/account`. 30-day soft-delete (recoverable), then hard-delete.
  - Tenant data export: `POST /settings/data-export` produces a JSON archive of all org-scoped data (orders, customers, menu, staff, audit log) within 24h, available as a one-time R2 link.
  - Per-customer right-to-be-forgotten: an owner can purge a customer's PII (name, phone, email, addresses) while preserving the anonymized order rows for accounting.
- **Audit-log retention policy** — already partially shipped (Wave 4); confirm 7-year retention for financial mutations.

### Now-22 — POS dual UI hardening (full + quick)
Covered by Wave 11. The data model (modifier_groups, modifiers, courses, tax_rates) ships in Wave 0; this is the UX and handler work on top.
- **Full POS workspace** at `/pos/workspace`: modifier picker on item tap; course assignment + "fire next course"; splits by seat + by custom amount; void / comp / discount inline (not in `/dev/adjustments`); seat assignment; tender split across cash / card / gift / house-account.
- **Quick POS at `/q/:slug`**: chrome-less kiosk mode, counter-service quick-tap, one-tap tender with denomination calc. Same backend as full POS — only UX differs.
- Modifiers and courses inherit the audit log + capability gating from elsewhere.

### Now-23 — KDS hardening
Covered by Wave 12. Two-track work: ship the missing features and fix the audit-surfaced quality problems.
- **Category-level station routing** (currently item-level only); display-group config for which screens show which stations.
- **Bump-bar keyboard hotkeys**: 1-9 to bump Nth ticket, `r` recall, space bump focused, `?` overlay.
- **Fix the N+1 queries** in `GetTicketDetail` and `ListStationTickets` — Q1 audit flagged them at 1+3N and 1+N respectively.
- **Owner station-config UI** at `/settings/kitchen` — drag categories → stations, configure display groups.

### Now-24 — Offline Tier 1 (network resilience)
Covered by Wave 13. Targeting loadshedding + global flaky-network resilience. **Tier 1 buys 30s–2min outage tolerance** without behavioral compromise.
- Service worker (Vite PWA) caches app shell + per-store menu snapshot.
- Client-generated ULID order IDs and line-item IDs (migrations in Wave 0 already accept client IDs).
- `Idempotency-Key` header on every mutating POS endpoint; deduplicated server-side via the existing idempotency_keys table.
- IndexedDB mutation queue with reconnect-and-retry; optimistic UI rolls back on conflict.
- KDS SSE gains a `since_event_id` cursor — reconnecting client replays missed events.
- Tier 2 (real offline POS) is in [Wave 33 / "Later"](./docs/internal/tasks.md).

### Now-25 — Testing infrastructure + pen-test workstream
Covered by Waves 14 and 15. Tests are a roadmap-level commitment, not a chore.
- **Fixtures + ephemeral Postgres** for self-contained `go test`.
- **Smoke suite** (~30s) on every push.
- **E2E suite** (~5min) pre-deploy.
- **Cross-tenant contamination** suite — every authenticated endpoint probed with org-B JWT against org-A resources.
- **Opus-driven pen-tests** weekly: auth, IDOR, injection, brute force, webhook signature replay, refresh-token reuse, idempotency replay, currency manipulation, price tampering, driver-privacy bypass, WhatsApp account hijack.
- CI wires `go test ./...` + `go run ./cmd/tests --all` + frontend Vitest.

### Now-26 — Invoicing (BeepBite → stores, stores → their B2B customers, VAT-aware)
Invoicing is a separate concern from the wallet/receipt path:
- **BeepBite invoices stores** for their subscription / overage charges. Header pulled from env (`BEEPBITE_LEGAL_NAME`, `BEEPBITE_REGISTERED_ADDRESS`, `BEEPBITE_VAT_NUMBER?`, `BEEPBITE_REGISTERED_COUNTRY`, `BEEPBITE_COMPANY_NUMBER`).
- **Stores invoice their B2B customers** (house accounts, corporate clients, catering bookings). Header pulled from the store's `tax_profile` (legal name, registered address, VAT number, contact details).
- **VAT logic** is uniform in both directions: if the issuer has a `vat_number` populated → charge VAT at the issuer's rate, add the VAT line, show the VAT number on the invoice. If the issuer has **no** `vat_number` → no VAT line, no VAT charged. (Cross-border / EU-reverse-charge handling is a later refinement; the simple "have VAT number → charge VAT" rule works in ZA, NG, US sales-tax-exempt small business, India under composition scheme, etc.)
- **One unified `invoices` schema** carries both BeepBite-issued and store-issued invoices (discriminated by `issuer` enum: `'platform' | 'tenant'`). PDF generation reuses the receipt generator's typography.
- **Tenant onboarding** asks for business info up front: legal name, registered address, country, VAT number (optional), company registration number (optional), contact email, contact phone. Stored in `tax_profiles` (1:1 with org). Same form is on `/settings/business-info`.
- **Default behavior when no `tax_profile` exists**: invoices issued without a VAT line; warning banner asks the owner to complete their business info.

### Now-27 — Unified workspace: one app, role-aware views
Replace the scattered `/pos/workspace` + `/home` + `/q/:slug` + `/kds/:stationId` + `/kds/expo` + `/floor` URLs with a single `/work` workspace that has **two top tabs: POS and Kitchen**. Each tab has a view picker:
- **POS tab** views: Quick (counter-service quick-tap) · Full (table-service ticket workspace) · Floor (floor plan with table sessions) · Orders (combined queue, current `/home` orders list).
- **Kitchen tab** views: Station (single station's tickets) · Expo (cross-station expedite screen) · Bump-bar (chrome-less hotkey-driven mode).

Behavior:
- **Role-aware visibility.** Members with only `can_kitchen` capability see only the Kitchen tab. Members with `can_pos` see both. Owners and managers see all.
- **View remembered per user per device.** `user_preferences.last_view_pos` and `last_view_kds` columns (or localStorage with a server-side mirror). Returning to `/work` lands on the last-selected view.
- **Chrome-less deep links survive**: `/kds/expo`, `/kds/:stationId`, `/q/:slug` still work for dedicated screens (kitchen TVs, customer-facing kiosks) — they just render the same view in chrome-less mode.
- **Single navigation shell**, single search bar (customer search, item search), single global keyboard shortcuts. Much simpler than the current sprawl.

### Now-28 — Help center + onboarding wizard
Pairs with "open the till in 5 minutes" landing-page promise.
- **`docs.beepbite.io`** — public help center. Markdown sourced from `docs/help/` in the repo, rendered with a simple SSG (Astro / VitePress). Search + table of contents. Sections: Getting Started, POS, KDS, Menu, Payments, Staff, Customers, Drivers, Bulk Imports, API, Custom Domains, FAQ.
- **In-app onboarding wizard** (`/onboard`) — replaces the current minimal popup. Steps: 1) sign up + verify email, 2) create your first store (slug, city), 3) add 5 menu items (or import a PDF / CSV menu), 4) invite a staff member or driver, 5) connect a payment provider (or set on-delivery), 6) ship a test order to yourself. Progress saved per step; resumable.
- **Interactive product tour** on first POS workspace visit — `react-joyride` or similar. Skippable, never auto-replays.
- **Contextual help** — "?" button in every settings page links to the relevant docs.beepbite.io section.

### Now-29 — WhatsApp multi-number support
A single central number cannot scale globally. Meta allows up to **25 phone numbers per WhatsApp Business Account** (WABA) and up to 1,000 WABA numbers per Meta Business account.
- `whatsapp_phone_numbers` table: `id, meta_phone_number_id (unique), display_phone, country, regions text[], active, configured_at`. Owned by platform — added by BeepBite ops in the admin tool.
- **Inbound routing**: every inbound webhook from Meta includes the destination `phone_number_id`. Resolver looks up which BeepBite number it is and tags the conversation with the relevant `country` + `region`. Marketplace search returns only stores in compatible regions.
- **Outbound choice**: when BeepBite (or a tenant assistant) sends to a customer, we pick the number that the customer most recently messaged us from. Falls back to the country-matching primary number.
- **Templates**: each language × number must be pre-approved with Meta; the admin tool surfaces approval state per template per number.
- **Testing** (Wave 14+15+36): cross-number isolation tests prove a message to the ZA number can't see NG-only stores; pen-tests prove no number-spoofing in webhook handlers.

### Now-30 — Security gaps: 2FA + tenant audit-log access
Hardening pass for owner-side security.
- **TOTP 2FA** for member accounts (Google Authenticator / Authy / 1Password compatible). Mandatory for owners; opt-in for managers; not applicable to staff (PIN flow handles their re-auth).
- **Tenant-facing audit log viewer**: every org sees their own `audit_log` rows in `/manager/audit` — filterable by actor, action, date range. Different from the platform-admin view (Now-16) which sees across orgs.
- **Suspicious-activity alerts**: 10 voids in an hour, 3 failed PIN attempts on the same device, wallet drop >50% in 24h → push notification + dashboard banner to owner. Configurable thresholds.

### Now-31 — Operational gaps from earlier audits
Small but real productivity items.
- **Item image upload UX**: `/menu` page gains drag-drop image upload to R2, with auto-crop preview, replacement, and removal. Single-item; complements Wave 21 bulk imports.
- **Time-clock workflow completion**: staff clock-in/out via PIN keypad (`/s/:slug` adds "Clock in" mode), hours view on `/staff/manage`, manager edit on time entries with audit row. Backend `staff_time_entries` already exists from Wave 0.
- **WhatsApp template pre-approval setup**: ops task — submit our launch template set (order confirmation, kitchen-ready, on-the-way, delivered, password reset, link-binding nudge, marketing-broadcast opt-in) for Meta approval per language, per market. Tracked in admin tool from Now-16.
- **End-of-day owner email**: daily summary emailed to the owner (gross / net / tax / tips / orders / new customers). Configurable on/off.

### Now-32 — Easy wins extended (additional POS features)
Promoting the rest of the easy-wins list. Each is a ≤1-day sonnet task.
- **Held tickets** — pause without firing kitchen (distinct from table_sessions).
- **Tab / open check** — start a tab, add items over time, settle later.
- **Daily specials pinned banner** at top of POS grid + customer marketplace.
- **Bar quick-pour mode** — preset drink button with no modifier picker.
- **Wait time estimation** — system-computed from current kitchen load (active tickets × avg prep time).
- **Quick category 86** — 86 entire category at once (e.g. "no breakfast today").
- **Dual cash drawer** — two cashiers sharing one POS terminal with separate drawers.
- **Print queue retry** — buffer-and-retry when ESC/POS printer offline (resilience for Now-19).
- **Quick coupon generation** — "send 20% off to this customer" from the customer detail page.
- **Customer favorites** — customer-marked re-order items; surfaced in chatbot and marketplace store page.

### Now-33 — Legal foundation: ToS / Privacy / Cookie consent / Compliance pack
Pre-launch legal scaffolding.
- **Platform ToS + Privacy Policy** at `/legal/terms` and `/legal/privacy` — versioned, audit-logged on acceptance (every new signup records the version they accepted).
- **Per-tenant Privacy Policy** generator: from the tenant's business info (Now-26), generate a per-store privacy policy that's linked on their marketplace store page and customer-facing checkout. Editable template.
- **Cookie consent banner** on `app.beepbite.io` and per-tenant marketplace pages — Klaro or similar OSS, EU-compliant, granular consent (necessary / analytics / marketing).
- **GDPR + POPIA compliance pack**: Data Processing Agreement (DPA) template auto-generated for each tenant, DPO contact in env (`BEEPBITE_DPO_EMAIL`), breach-notification flow runbook, data-residency policy doc, sub-processor list (Meta, Anthropic, OpenAI, etc.) maintained in `docs/sub-processors.md`.
- **Records of Processing Activities (RoPA)** auto-generated from the data model — what data we hold, where it lives, who can access it.

### Now-34 — Responsiveness sweep (end-of-roadmap pass)
Final pre-launch pass. Every page we've built tested against:
- **iPhone SE 375×667** (smallest realistic phone) — content readable, taps land, no horizontal scroll.
- **iPhone 13 / Pixel 7 390×844** (standard phone) — POS, customer chat, marketplace optimized.
- **iPad 768×1024 portrait + 1024×768 landscape** — POS workspace + KDS station view shine in this form factor; this is the realistic restaurant POS device.
- **Desktop 1280, 1440, 1920** — manager dashboards, reports, settings.
Touch targets ≥44px; no hover-only affordances on touch surfaces; gestures (swipe-to-bump on KDS); virtual-keyboard handling on the staff PIN keypad.
A page is "done" when it passes axe-core (from Wave 30) **and** the responsiveness checklist on all four form factors. Pages with form-factor-specific overrides (POS workspace tablet vs desktop) document the breakpoint logic in code comments.

### Now-35 — Native shell (Tauri / Capacitor) — final v1 wave
**The very last item before v2.** Everything else must be stable and responsive first. Wraps the React app in a Tauri (desktop / tablet) and Capacitor (iOS / Android) shell with:
- Native printing (avoids the WebSerial / browser-permissions dance).
- Native receipt scanner and camera access (cleaner UX for menu-photo bulk imports).
- Guaranteed local persistence — unlocks **Offline Tier 2** (true offline POS) once Tier 1 is solid.
- Distributable via Mac App Store, Microsoft Store, F-Droid, side-loaded `.deb` / `.apk` for self-managed devices.
- Same React codebase, so feature parity is automatic.

---

## Later (v2 — deferred behind triggers, not committed)

Items below are tracked in [tasks.md Wave 33](./docs/internal/tasks.md). Each gets pulled into a real wave when a specific trigger fires.

| Item | Trigger to pull in |
|---|---|
| **Offline Tier 2** — true offline POS (cash mode while network out + conflict resolution on reconnect) | 3+ paying tenants ask, or first major outage incident |
| **Offline Tier 3** — native shell (Tauri / Capacitor) | Tenant requests a tablet build |
| **In-house delivery dispatch** — separate driver-app binary + map view in manager dashboard | 10+ tenants using the in-house driver flow |
| **Partner delivery integration** — Uber Eats / DoorDash / Grubhub handlers atop the existing schema | A tenant requests partner integration |
| **QR-order-at-table** | After dine-in flows are battle-tested |
| **Self-serve kiosk mode** | After Quick POS kiosk hardens |
| **Franchise + multi-location consolidation reporting** | Multi-loc tenant requests |
| **Marketing engine** — broadcasts, segments, suppression list | After 50+ tenants reach 1k+ customer lists |
| **Scheduled / recurring orders** (office lunches) | When demand surfaces |
| **Accounting integrations** (Xero, Quickbooks via the public API from Now-12) | When 5+ tenants ask — one mapping wave per integration |

---

## How we test — the security & reliability bar

Testing is a roadmap-level commitment, not a chore. Three layers:

### Layer 0 — Feature parity audit (one-off, opus-driven)
Before the testing pyramid runs, we inventory every feature that Toast, Square for Restaurants, Lightspeed K-Series, TouchBistro and Lavu ship — and decide, feature-by-feature, whether to include in v1, defer to v2, or explicitly skip. Output: `docs/feature-parity.md` with a recommendation per feature. The accept-list becomes a checklist on the test pyramid: every accepted feature must have a smoke or e2e scenario.

### Layer 1 — Smoke (fast, on every push)
~30 seconds, hits a live local server. Proves the system boots and the golden paths are alive.

```
Tenant signup → JWT issued
Org + location created by trigger
Create category + item
Create staff + set PIN
Staff PIN login (audience="staff")
POS CreateOrder → KDS ticket created
Idempotent retry → same order, no duplicate
Cash drawer open + close
Unauthed call → 401
```

### Layer 2 — E2E (scenario-based, pre-deploy)
~5 minutes, seeded multi-tenant fixtures. Proves real flows.

```
Onboard tenant: signup → org → location with slug → menu → publish
POS flow:      staff PIN-login → dine-in order → KDS bump → settle cash
Payment flow:  hosted checkout → webhook → order paid → audit row → void → refund row
Chatbot flow:  WhatsApp inbound → store search by slug → cart → order → KDS ticket
Marketplace:   two locations, same city → search returns both → order via slug
Delivery:      polygon zone → in-zone address → fee applied → status to out-for-delivery
```

### Layer 3 — Pen-test + cross-tenant (opus-driven, weekly)
Opus agents target the platform as adversaries. The bar: every probe is either 403, 404, or a hard 400 — never a 200 leak.

```
Cross-tenant contamination:
  org-A bearer → GET org-B location, station, order, staff, drawer, payout, audit row
  org-A bearer → POST order against org-B location_id
  org-A bearer → bump org-B KDS ticket
  org-A bearer → close org-B cash drawer

Auth & session:
  Refresh-token reuse after rotation → all sessions revoked
  Staff JWT used against member-only endpoints
  Member JWT used against staff-only endpoints
  Audience-claim stripping
  Lockout bypass via parallel requests

Payments:
  Webhook signature replay
  Forged webhook from disabled provider
  Currency manipulation in checkout
  Price-tampering by sending lower price in body
  Idempotency-key replay across orders

Marketplace:
  Slug enumeration → store directory leak
  Webhook URL guessing for another store
  IDOR on /stores/:slug/menu by guessing IDs

Injection & abuse:
  SQL injection in filter values (already covered by --pentest, extend)
  XSS in store description / item name (rendered on landing)
  Brute force on 4-digit PIN within a single store
  Rate-limit bypass via header spoofing
```

Pen-test findings file an issue and a fix-task in tasks.md. The bar holds before any marketplace launch.

---

## How we sequence work

- Each **wave** in [tasks.md](./docs/internal/tasks.md) is a parallel-safe batch. Tasks within a wave do not edit the same files.
- Each **task** specifies its target agent: most are **sonnet** (fast, cheap, executes well-scoped change). **Pen-testing tasks are opus** (deeper adversarial reasoning).
- Each task names the files it can edit and the acceptance criteria.
- Migrations are numbered sequentially; a wave that ships migrations declares which numbers it owns to avoid collisions.

---

## What we promise — landing-page copy points

1. **Open the till and the kitchen in five minutes.** Sign up, type your menu, hand a tablet to your cashier and another to your line cook.
2. **Get your own URL.** `mystore.beepbite.io` is yours. Hand it to customers, put it on the receipt, paint it on the window.
3. **Customers find you on WhatsApp.** Search a slug, place an order, pay in chat. Your kitchen sees it instantly.
4. **Bring your own payment keys — or take payment at the door.** Your money lands in your account, not ours. Paystack today, Stripe and PayFast next. No payment account yet? Accept cash or card-machine on delivery and start trading anyway.
5. **Built for loadshedding.** The POS keeps taking orders during network blips. The kitchen keeps cooking. You sync when you're back.
6. **Priced in dollars, charged in your currency.** We price in USD, your local provider converts at a live rate, your invoice shows both. No FX guessing.
7. **Audit every action.** Every void, every comp, every refund records who did it and when. Tied to the staff member by PIN.
8. **The database itself refuses to leak.** Row-Level Security is on by default. Even a buggy handler cannot show one tenant's data to another.
9. **Hire your drivers, not Uber's.** Your drivers sign in to one portal, see every order across every restaurant that invited them. Customers get an Uber-style live link — with the privacy guardrails Uber forgot.
10. **One account, every restaurant, every chat.** Link up to three WhatsApp numbers to your BeepBite account. Order from any restaurant on the marketplace, see your history, track your delivery — all signed in once.
11. **Run the place from WhatsApp.** 86 the jollof, drop the burger price, snap a photo of your handwritten menu and let the assistant import it. Approve the draft, commit. Audit log catches everything.
12. **Free to start, pay as you grow.** Every restaurant gets a free tier. Top up the wallet to handle peak weekends or unlock more assistant minutes. No surprise invoices.

---

## Open questions (tracked, not blockers)

- Will the central WhatsApp number scale to multi-country? May need per-region inbound numbers + a `whatsapp_number_routing` table (already proposed in migration backlog).
- Do we need PostGIS for delivery zones at v1, or is the Go ray-casting enough? (Decision: stay with Go until polygon count > 50 per location.)
- Subscription billing surface: monthly fee collection workflow (separate from per-payment fees) needs design.
- When does the staff PIN UI go native (Tauri/Capacitor)? Trigger: when a tenant asks for a tablet that won't sleep.
