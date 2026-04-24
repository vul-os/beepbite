# BeepBite — Competitive-Gap Roadmap

Gaps identified vs Toast / Square for Restaurants / Lightspeed / TouchBistro / Lavu. Ordered by impact. Check items as they land.

## Shipped migrations
| # | File | Summary |
|---|---|---|
| 15 | `byo_payment_gateways.sql` | (superseded by 26) subscription_tier column kept, BYO table dropped |
| 16 | `tables_dine_in.sql` | sections, "tables", table_sessions, seats, check_splits, dine_in order_type, course firing |
| 17 | `kds.sql` | kitchen_stations, item_station_routing, kds_tickets/items/events |
| 18 | `cash_drawer_and_adjustments.sql` | drawers/sessions/movements/counts, adjustment_reasons, order_adjustments |
| 19 | `promotions_and_coupons.sql` | promotions, coupon_codes, redemptions, order_item_discounts |
| 20 | `suppliers_and_purchasing.sql` | suppliers, POs, GRNs, supplier_invoices (3-way match), ingredient_price_history |
| 21 | `staff_auth.sql` | username/password/PIN on staff, staff_refresh_tokens, staff_password_reset_tokens, lockout |
| 22 | `reporting_views.sql` | 6 reporting views + refresh_reporting_views() |
| 23 | `audit_log_and_idempotency.sql` | audit_log, idempotency_keys, webhook_event_log |
| 24 | `menu_extensions.sql` | allergens, dietary_tags, menu_schedules, happy-hour prices, 86-list, nutrition |
| 25 | `gift_cards_store_credit.sql` | gift_cards, store_credits, house_accounts, loyalty_config + 4 ledger tables |
| 26 | `regions_and_central_gateways.sql` | drop BYO, add regions, rewrite gateway lookup |
| 27 | `subscription_plans_and_payouts.sql` | subscription_plans, bank_accounts, payout_schedules, merchant_payouts ext |
| 28 | `triggers_and_report_views.sql` | approval trigger, auto-86 trigger, kds_expo_view, cash_drawer_eod_report |
| 29 | `retro_updated_at_and_pay_rates.sql` | 31 retro updated_at triggers, staff_pay_rates |

---

## Tier 1 — Table stakes for "restaurant POS"
Without these we're a delivery app, not a POS.

### Central payment gateways + tier-based fees + weekly payouts
Pivoted away from BYO. BeepBite runs one central gateway per region; credentials live in env vars (`PAYSTACK_ZA_SECRET_KEY`, etc). Merchants pay a per-tier transaction fee on every payment and a per-tier payout fee when we settle (weekly cadence).
- [x] Drop `location_payment_gateways` + BYO SQL functions — migration 26
- [x] `regions` table (code, name, currency, timezone, payment_provider, tax defaults) — migration 26
- [x] `locations.region_id` FK + backfilled to ZA — migration 26
- [x] Seed South Africa / ZAR / Paystack / VAT 15% — migration 26
- [x] `get_available_payment_methods(location_id)` + `get_location_payment_provider(location_id)` helpers — migration 26
- [x] `subscription_plans` (monthly fee + transaction fee % + fixed + payout fee % + fixed + feature flags) + 4 seeded tiers — migration 27
- [x] FK `organizations.subscription_tier` → `subscription_plans.tier_code` — migration 27
- [x] `bank_accounts` (per-org, optional per-location, encrypted account number, provider recipient id) — migration 27
- [x] `payout_schedules` (weekly default, cadence/day/hour, min payout, hold period) — migration 27
- [x] `merchant_payouts` extended with bank_account_id, subscription_plan_id, payout_fee_cents, provider, provider_transfer_id/status — migration 27
- [x] Go refactor: removed `paymentgateways` handler; paystack + stripe managers load creds from env by region — `ForRegion`, `ForLocation(ctx, pool, location_id)`, `ErrWrongProvider`
- [ ] **Bank account setup handler**: encrypt account number (AES-GCM via `PAYMENT_KEY_ENCRYPTION_SECRET`), call Paystack `POST /transferrecipient` on save, persist `provider_recipient_id`
- [ ] **Per-payment fee capture**: on each successful `order_payments`, write BeepBite's transaction fee (tier % + fixed) to `payment_fees` (new attribution row or extend existing schema)
- [ ] **Weekly payout job**: scheduled worker scans orders since last payout respecting `payout_schedules.hold_period_hours`, creates `merchant_payouts`, calls Paystack `POST /transfer` with `provider_recipient_id`, stores `provider_transfer_id`, deducts tier payout fee
- [ ] **Transfer webhook**: `transfer.success` / `transfer.failed` / `transfer.reversed` → update `merchant_payouts.provider_transfer_status` + audit_log
- [ ] **Payout reconciliation**: cron to sweep stale `initiated` payouts against Paystack `GET /transfer/:id`
- [ ] Frontend: bank account setup wizard + payout history/receipt
- [ ] Frontend: subscription plan picker + billing dashboard (monthly fee collection TBD)
- [ ] Split `STAFF_JWT_SECRET` from shared email-auth secret (blocked on key-rotation tooling)

### Staff auth (username/password for day-to-day users)
Members (email-based auth_users + organization_members) stay as-is for management.
Day-to-day POS users (cashiers, kitchen) get a separate login path with username + password.
- [x] `staff.username` + `staff.password_hash` (unique per-location, case-insensitive) — migration 21
- [x] `staff.pin_hash` for fast-PIN register sign-in — migration 21
- [x] `staff.failed_login_attempts` + `locked_until` for brute-force mitigation — migration 21
- [x] `staff_refresh_tokens` + `staff_password_reset_tokens` tables — migration 21
- [x] Go `internal/staffauth` package: login / refresh / logout / me — mounted under `/auth/staff/*`
- [x] Lockout after 5 failed attempts (15 min), single-statement to avoid races
- [x] JWT audience `"staff"` distinct from email auth, shared secret (TODO: split)
- [x] Set-password endpoint — `POST /auth/staff/set-password`, revokes all refresh tokens on success
- [x] PIN login endpoint — `POST /auth/staff/pin-login`, shares lockout counter with password login
- [ ] Frontend POS login screen

### Tables, dine-in & floor plan
- [x] `tables`, `sections` (floor areas), `table_sessions` (a party occupying a table), `seats` (per-diner tickets) — migration 16
- [x] Extend `orders.order_type` with `dine_in`; link order → table_session — migration 16
- [x] Split check (check_splits + check_split_items) & transfer check (table_sessions.transferred_to_session_id) — migration 16
- [x] Course firing (appetizer → main → dessert) on orders + order_items — migration 16
- [ ] Handlers: `POST /tables/{id}/open-session`, `/close-session`, `/transfer`, `/split-check` + seat CRUD
- [ ] Frontend: floor plan editor (position tables via pos_x/pos_y)
- [ ] Frontend: floor view with live status (occupied/reserved/available) + tap-to-open-session
- [ ] Frontend: split-check modal (by seat, even split, custom split)
- [ ] QR-code order-at-table flow (later)

### Kitchen Display System (KDS)
- [x] `kitchen_stations` (grill, fry, salad, bar, expo) — migration 17
- [x] `item_station_routing` — which station prepares which item — migration 17
- [x] `kds_tickets` + `kds_ticket_items` + `kds_ticket_events` (fired / bumped / recalled / re-fired) — migration 17
- [x] Per-station item status separate from overall order status — migration 17
- [x] Expo screen view (all tickets for an order grouped) — `kds_expo_view` — migration 28
- [ ] Order-create hook: on new order_items, fan out to kds_tickets per routed station
- [ ] Handlers: bump / recall / re-fire / priority-rush + event log writes
- [ ] Real-time stream for station screens (SSE is simplest; websocket later)
- [ ] Frontend: per-station display (bump button, elapsed-since-fired timer, color-by-age)
- [ ] Frontend: expo screen (grouped by order, highlights waiting-on-other-station)

### Cash management
- [x] `cash_drawers` (physical drawer per location) — migration 18
- [x] `cash_drawer_sessions` (opening float, closing count, blind/declared, over/short) — migration 18
- [x] `cash_drawer_movements` (paid-in, paid-out, petty-cash, tip-out, no-sale, drop, pickup) — migration 18
- [x] `cash_drawer_counts` per-denomination close count — migration 18
- [x] End-of-day report: expected vs counted per payment method — `cash_drawer_eod_report` view — migration 28
- [x] Handlers to open/close session + record movements — `internal/handlers/cashdrawer`, mounted at `/cash-drawers/*`

### Voids, comps, manager overrides
- [x] `order_adjustments` (void / comp / discount / price-override) with reason codes — migration 18
- [x] `adjustment_reasons` configurable per location — migration 18
- [x] Manager approval audit fields (applied_by, approved_by, approval_status) — migration 18
- [x] Separate void (pre-payment) from refund (post-payment) — schema-wise — migration 18
- [x] Approval-required enforcement trigger — `trg_order_adjustments_approval` — migration 28
- [ ] Go handlers: `POST /orders/{id}/void`, `POST /orders/{id}/comp`, `POST /orders/{id}/price-override` — must write audit_log + block double-voids
- [ ] PIN-gated manager approval flow (reuse `staff.pin_hash` to confirm)
- [ ] Frontend: adjustment modal with reason-code picker + manager PIN challenge

### Discounts / promos / coupon engine
- [x] `promotions` (name, type, active window, dayparts, min-spend, stackable, priority) — migration 19
- [x] Rule types: percent_off, fixed_off, bogo, free_item, happy_hour_price, free_delivery — migration 19
- [x] Scope: order-level, item-level, category-level, delivery, customer-segment — migration 19
- [x] `coupon_codes` (case-insensitive, per-customer assignment, usage limits) — migration 19
- [x] `promotion_redemptions` audit + `order_item_discounts` line-level attribution — migration 19
- [x] Apply-promotion engine in Go (match rules, compute discount, write attribution rows) — `internal/handlers/promotions`, `POST /orders/{order_id}/apply-promotions`
- [ ] Frontend UI to configure promotions

### Tip pooling & distribution
- [ ] `tip_pools` (per-location, per-shift, rule config)
- [ ] `tip_distributions` (who got what, payroll-exportable)

---

## Tier 2 — Profitability & reporting (currently claimed, thinly built)

### Suppliers, purchasing & ingredient price history
- [x] `suppliers` + `supplier_contacts` + `supplier_locations` — migration 20
- [x] `supplier_inventory_items` (supplier catalog, pack sizes, preferred supplier) — migration 20
- [x] `purchase_orders` + `purchase_order_items` (ordered vs received) — migration 20
- [x] `goods_receipts` + `goods_receipt_items` (multi-shipment receipts) — migration 20
- [x] `supplier_invoices` + `supplier_invoice_lines` (3-way match: PO ↔ GRN ↔ invoice) — migration 20
- [x] `ingredient_price_history` (auto-recordable on PO receipt) — migration 20
- [ ] GRN-receive handler: on goods_receipt_items INSERT, bump `inventory_items.current_stock` + `cost_per_unit` + write `ingredient_price_history` row + `stock_movements` entry
- [ ] 3-way-match variance detector (PO → GRN → supplier_invoice) — flag price/qty variance, set `supplier_invoices.match_status`
- [ ] Low-stock auto-PO suggestions (when `current_stock` < `minimum_stock`, draft a PO with the preferred supplier)
- [ ] Recipe cost recompute job triggered by new ingredient_price_history (recursive via `item_recipes`)
- [ ] Frontend: supplier / PO / GRN management UI
- [ ] Frontend: supplier invoice upload + 3-way match review

### Waste & prep
- [ ] Extend `stock_movements` with `waste_reason` (spoilage/spillage/theft/staff-meal/prep-loss)
- [ ] `prep_batches` (produced 20L of soup today — deducts raw + adds prep-item stock)
- [ ] Recipe yield % / conversion loss on `item_recipes`
- [ ] Waste cost report by station/day

### Reporting views & materialized views
- [x] `daily_sales_summary` (gross, net, tax, tips, by payment method, by order type) — migration 22
- [x] `hourly_sales_heatmap` (covers × revenue × avg-ticket per hour, trailing 90d) — migration 22
- [x] `menu_engineering` view (stars/plowhorses/puzzles/dogs by margin × velocity, 30d) — migration 22
- [x] `labor_hours_daily` (labor hours only; $ pending staff_pay_rates) — migration 22
- [x] `theoretical_vs_actual_cogs` (recipe cost × sold vs stock drawdown, 30d) — migration 22
- [x] `revenue_by_payment_method` (per-method gross/fees/net/tips, daily) — migration 22
- [x] `refresh_reporting_views()` stable no-op for future matviews — migration 22
- [ ] Rewire frontend dashboard (currently calls deleted `get_analytics_*` RPCs)

### Staff pay & labor cost
- [x] `staff_pay_rates` (hourly / salary / commission / per_shift / salary_monthly / salary_annual, effective-dated, only one "current" rate per staff+rate_type) — migration 29
- [x] Overtime fields on pay rates (multiplier + per-week threshold, 45h SA BCEA default) — migration 29
- [ ] Labor-cost-in-money view (join `labor_hours_daily` × `staff_pay_rates` — straightforward follow-up view)
- [ ] Sales-per-labor-hour metric (view)
- [ ] Payroll export (CSV per pay period)

---

## Tier 3 — Ordering, CRM, engagement

### Reservations / waitlist / pre-orders
- [ ] `reservations` + availability windows
- [ ] `waitlist` (walk-ins)
- [ ] Scheduled pickup / scheduled delivery slots

### Gift cards, store credit, house accounts
- [x] `gift_cards` (physical + digital, balance ledger, expiry, PIN) — migration 25
- [x] `gift_card_transactions` append-only ledger — migration 25
- [x] `store_credits` + ledger (refund-to-credit option) — migration 25
- [x] `house_accounts` + `house_account_members` + `house_account_charges` + `house_account_invoices` (monthly invoicing, net-terms) — migration 25
- [x] `loyalty_config` (points-per-currency rate, min redemption, expiry months) — migration 25
- [x] `loyalty_transactions` earn/burn ledger (fills the gap vs bare `customers.loyalty_points`) — migration 25
- [x] Seeded `payment_methods` rows for gift_card / store_credit / house_account / loyalty_points — migration 25
- [ ] Gift card handlers: `POST /gift-cards/issue`, `/redeem`, `/reload`, `/refund`, `GET /gift-cards/lookup` — balance enforcement (can't go negative) must live in Go, not raw REST
- [ ] Store credit handlers: `/grant`, `/redeem`, `/refund-to-credit` (refund flow hooks into existing refunds table)
- [ ] House account handlers: assign order charge, generate monthly invoice, record payment against invoice
- [ ] Loyalty handlers: earn-on-order, redeem-as-tender (bounded by `loyalty_config.max_redemption_pct_of_order`), expire job
- [ ] Frontend: gift-card lookup + issue flow; store-credit balance on customer profile; house-account invoice list

### Customer segments & marketing
- [ ] `customer_segments` (lapsed, VIP, birthday-month, first-time)
- [ ] `marketing_campaigns` (WhatsApp broadcast templates, email blasts)
- [ ] Suppression list + consent tracking

### Menu scheduling & availability
- [x] `menu_schedules` + `menu_schedule_slots` (breakfast/lunch/dinner dayparts, ISO day-of-week × time windows) — migration 24
- [x] `item_menu_schedules` (which items appear on which daypart menu) — migration 24
- [x] `item_price_schedules` (happy-hour pricing per item × schedule) — migration 24
- [x] 86-list: `items.available_from` / `available_until` / `is_86ed` / `auto_86_when_inventory_empty` — migration 24
- [x] `inventory_items.link_to_item_id` so raw stock can flip a sellable item's is_86ed — migration 24
- [x] Allergens + dietary tags: `allergens`, `item_allergens`, `dietary_tags`, `item_dietary_tags` — migration 24
- [x] Nutrition/imagery on items: calories, kilojoules, spice_level, image_url, short_description — migration 24
- [x] Auto-86 trigger — `trg_auto_86_from_inventory` flips `items.is_86ed` when linked `inventory_items.current_stock` crosses 0 — migration 28

### Delivery zones
- [ ] `delivery_zones` (polygon per location) with per-zone fee + ETA
- [ ] Replace blunt `max_delivery_distance_km`

---

## Tier 4 — Compliance, ops, reliability

- [x] `audit_log` — price changes, voids, discounts, refunds, role changes, menu edits (actor polymorphic: member/staff/system/customer/webhook; before/after jsonb) — migration 23
- [x] `idempotency_keys` table — scope+key unique, request_hash collision detection, stuck-lock recovery — migration 23
- [x] `webhook_event_log` — catch-all for WhatsApp/Resend/Mapbox inbound events — migration 23
- [ ] Wire audit_log writes into Go handlers:
  - [ ] item price edits
  - [ ] order voids / comps / price-overrides
  - [ ] refunds
  - [ ] staff role / permissions changes
  - [ ] menu schedule / 86-list mutations
  - [ ] cash drawer close (over/short)
  - [ ] promotion config edits
  - [ ] bank account creation / update
  - [ ] subscription plan rate edits
- [ ] Wire idempotency_keys into:
  - [ ] /order + /order_payments creation (client-supplied `Idempotency-Key` header)
  - [ ] Paystack charge webhook receiver
  - [ ] Paystack transfer webhook receiver
  - [ ] WhatsApp inbound message webhook
  - [ ] Stripe webhook (when used)
- [ ] Fiscal receipt sequencing (per-location, gap-free invoice numbers)
- [ ] Multi-currency support (`currencies`, per-org default, per-txn rate snapshot)
- [ ] Active staff session list + "logout all" (session binding on refresh tokens)
- [ ] PII-access log for customer data
- [ ] Audit log retention policy + archival (table grows fast; plan for partitioning)

---

## Tier 5 — Wedge features

- [ ] Self-serve kiosk mode
- [ ] QR-code order-at-table (pairs with dine-in)
- [ ] Scheduled/recurring orders (office lunches)
- [ ] Online-ordering website (cart already in schema)
- [ ] Franchise royalty calc on top of `merchant_payouts`

---

## Frontend — cross-cutting

Backend has landed far ahead of the UI. Major surfaces the POS will need:
- [ ] POS login screen (staffauth — username or PIN)
- [ ] Analytics dashboard rewire onto migration 22 views
- [ ] Manager dashboard (promotions, menu schedules, allergens/dietary tags, 86-list)
- [ ] Floor plan editor + live floor view (dine-in)
- [ ] KDS per-station screens + expo screen
- [ ] Cash drawer open/close + movements UI
- [ ] Order adjustment modal with manager-PIN challenge
- [ ] Supplier / PO / GRN workflow
- [ ] Supplier invoice upload + 3-way-match review
- [ ] Gift card lookup + issue flow
- [ ] House account invoice list + payment recording
- [ ] Bank account setup wizard + payout history
- [ ] Subscription plan picker + billing dashboard
- [ ] Reservations + waitlist view (once schema lands)
- [ ] Customer segments + campaign composer (once schema lands)
- [ ] Delivery zone editor (polygon drawing on Mapbox, once schema lands)
- [ ] Menu scheduling UI (daypart windows + happy-hour price)
- [ ] Staff management: pay rates (effective-dated), password reset, PIN reset, shift scheduling

---

## Ongoing / Supabase→Go migration cleanup

- [ ] Finish WhatsApp webhook chatbot port (Phase 4d) — `internal/chatbot/` still missing `main_handler`, `main_menu`, `ordering`, `address_management`, `billing_management`, `profile_management` + the `internal/handlers/whatsappwebhook/` adapter
- [ ] Delete `supabase/` directory once the webhook port consumes what's needed; re-run `npm run build` + `go build ./...` to confirm nothing else references it
- [ ] Rewire analytics dashboard to new reporting views (currently calls deleted `get_analytics_*` RPCs — see Tier 2)
- [ ] Reconnect reviews surface against the new schema (`src/services/reviews.js` still calls legacy `get_reviews_*` / `bistro_members`) — or decide to cut the feature
- [ ] Delivery-partner webhook processing end-to-end (Uber Eats / DoorDash status sync)
- [ ] Ingredient cost adjustment UI (once price-history lands)

### Known design debts carried from the migration
- RLS is off; handlers trust the JWT for identity but CRUD scoping relies on the frontend including `organization_id` / `location_id` in filter predicates. Revisit if tighter enforcement is needed.
- Embedded joins in the generic data layer only resolve one level deep (what the app uses). Deeper nesting would require a server-side PostgREST-equivalent.
- JWT access tokens are HS256 with a shared secret across email-auth and staff-auth surfaces (disambiguated by audience claim). Splitting into a dedicated `STAFF_JWT_SECRET` is blocked on key-rotation tooling.
