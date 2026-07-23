# BeepBite Schema Consolidation Plan

> **Audience**: Phase B and Phase C opus agents. Follow this document as the binding contract when implementing migrations 002–014. Do not deviate without noting a reason in the migration file's header comment.

---

## 1. Migration Inventory — Table Assignments

Every table from the 46 legacy migrations is assigned to exactly one consolidated migration. New tables introduced by the design conversation (ROADMAP.md Now-1 through Now-31) are included and marked `[NEW]`. No table appears twice. No legacy table is orphaned.

### 001 — `extensions_and_helpers.sql` (Phase A)

No tables. Contains: extensions, common enums, RLS helper functions, Postgres roles, REVOKE baseline.

**Enums defined here** (shared across domains; must exist before any domain migration):
- `actor_type`: `'member' | 'staff' | 'system' | 'customer' | 'webhook' | 'api_key'`
- `order_status`: `'pending' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'completed' | 'cancelled' | 'pending_on_delivery'`
- `payment_status`: `'pending' | 'completed' | 'failed' | 'refunded' | 'partially_refunded'`
- `kds_event_type`: `'fired' | 'started' | 'bumped' | 'recalled' | 're_fired' | 'cancelled' | 'priority_changed' | 'rushed' | 'item_86ed' | 'note_added' | 'ready'`
- `fulfillment_type`: `'collection' | 'delivery' | 'dine_in'`
- `provider_status`: `'active' | 'inactive' | 'testing'`
- `wallet_txn_kind`: `'topup' | 'debit_llm' | 'debit_whatsapp' | 'debit_sms' | 'debit_bulk_import' | 'debit_overage' | 'refund' | 'adjustment'`
- `topup_status`: `'initiated' | 'succeeded' | 'failed' | 'refunded'`
- `driver_assignment_status`: `'offered' | 'accepted' | 'picked_up' | 'delivered' | 'canceled'`
- `driver_shift_status`: `'online' | 'paused' | 'offline'`
- `whatsapp_link_intent`: `'bind' | 'order'`
- `custom_domain_status`: `'pending' | 'verifying' | 'verified' | 'cert_issuing' | 'live' | 'failed'`

---

### 002 — `auth_and_tenancy.sql` (Phase B.1)

Sources: legacy 1, 2 (auth/org/profile parts), 13, 14, 38 (currencies), 43.

| Table | Origin |
|---|---|
| `auth_users` | legacy 1 |
| `refresh_tokens` | legacy 1 |
| `password_reset_tokens` | legacy 1 |
| `profiles` | legacy 2 |
| `organizations` | legacy 2 — add `default_currency_code`, `subscription_tier`, `auto_refill_threshold_cents`, `auto_refill_target_cents` |
| `organization_members` | legacy 2 — add `capabilities jsonb DEFAULT '{}'`, extend role CHECK to include `'kitchen' \| 'pos' \| 'driver'` |
| `organization_invites` | legacy 2 — extend role CHECK to match `organization_members` |
| `currencies` | legacy 38 |
| `whatsapp_accounts` [NEW] | ROADMAP Now-8: `(id, profile_id FK, phone_e164 text UNIQUE, verified_at, created_at)` |
| `whatsapp_link_tokens` [NEW] | ROADMAP Now-8: `(token text PK, phone_e164, intent whatsapp_link_intent, profile_id uuid nullable FK, expires_at, used_at)` |

**Key changes vs legacy**:
- `organization_members.role` CHECK: `'owner' | 'manager' | 'staff' | 'admin' | 'kitchen' | 'pos' | 'driver'`
- `organization_members.capabilities jsonb` documented keys: `can_pos`, `can_kitchen`, `can_void`, `can_comp`, `can_settle`, `can_view_reports`, `can_drive`
- `profiles.whatsapp_count int NOT NULL DEFAULT 0` maintained by trigger; CHECK enforces max 3 via `whatsapp_accounts`
- `auth_users.is_platform_admin bool NOT NULL DEFAULT false` (Now-16)

---

### 003 — `staff_and_pin.sql` (Phase B.1)

Sources: legacy 2 (staff, staff_time_entries, staff_shifts, staff_attendance_summary), 21, 29 (staff_pay_rates).

| Table | Origin |
|---|---|
| `staff` | legacy 2 + 21 — **DROP** `email UNIQUE NOT NULL`; add `member_id uuid REFERENCES organization_members(id)`, `display_name text`, `pin_hash text` |
| `staff_time_entries` | legacy 2 |
| `staff_shifts` | legacy 2 |
| `staff_attendance_summary` | legacy 2 |
| `staff_refresh_tokens` | legacy 21 |
| `staff_password_reset_tokens` | legacy 21 |
| `staff_pay_rates` | legacy 29 |

**Critical note**: `staff.email UNIQUE NOT NULL` is dropped here. Several handlers still reference `staff.email` (notably `staffauth/store.go`). Phase B.1 must note this for Wave 6 handler cleanup.

---

### 004 — `menu.sql` (Phase B.2)

Sources: legacy 2 (categories, items, item_variations, item_variation_options), 5 (item_recipes), 8, 9, 24, 44 (item_prep_steps).

| Table | Origin |
|---|---|
| `categories` | legacy 2 — add `organization_id uuid NOT NULL` (RLS anchor; categories are org-scoped via location) |
| `items` | legacy 2 + 8 + 24 — all added columns absorbed |
| `item_recipes` | legacy 5 + 34 (yield_pct) |
| `allergens` | legacy 24 |
| `item_allergens` | legacy 24 |
| `dietary_tags` | legacy 24 |
| `item_dietary_tags` | legacy 24 |
| `menu_schedules` | legacy 24 |
| `menu_schedule_slots` | legacy 24 |
| `item_menu_schedules` | legacy 24 |
| `item_price_schedules` | legacy 24 |
| `item_prep_steps` | legacy 44 |
| `modifier_groups` [NEW] | ROADMAP Now-22: `(id, item_id FK, name, min_select int, max_select int, is_required bool, sort_order)` |
| `modifiers` [NEW] | ROADMAP Now-22: `(id, modifier_group_id FK, name, price_delta_cents bigint, is_default bool, is_active bool, sort_order)` |
| `courses` [NEW] | ROADMAP Now-22: `(id, location_id FK, name, sort_order, is_active)` |

**Note**: `item_variations` and `item_variation_options` from legacy 2 are superseded by `modifier_groups` + `modifiers`. They are omitted from 004 (the new model is cleaner). The legacy tables `order_item_variations` and `cart_item_variations` are similarly superseded by order-level modifier storage. Phase B.2 must add a comment noting the replacement.

**recipe_cost_runs** (legacy 35): assigned to migration 005 (inventory) because it logically tracks the ingredient-price-driven cost runner.

---

### 005 — `inventory.sql` (Phase B.2)

Sources: legacy 2 (inventory_items, stock_movements), 20, 34 (prep_batches), 35.

| Table | Origin |
|---|---|
| `inventory_items` | legacy 2 + 24 (link_to_item_id) + 34 |
| `stock_movements` | legacy 2 + 31 (grn movement_type) + 34 (waste_reason) |
| `suppliers` | legacy 20 |
| `supplier_contacts` | legacy 20 |
| `supplier_locations` | legacy 20 |
| `supplier_inventory_items` | legacy 20 |
| `purchase_orders` | legacy 20 |
| `purchase_order_items` | legacy 20 |
| `goods_receipts` | legacy 20 |
| `goods_receipt_items` | legacy 20 |
| `supplier_invoices` | legacy 20 |
| `supplier_invoice_lines` | legacy 20 |
| `ingredient_price_history` | legacy 20 |
| `prep_batches` | legacy 34 |
| `prep_batch_inputs` | legacy 34 |
| `recipe_cost_runs` | legacy 35 |

---

### 006 — `tables_and_floor.sql` (Phase B.3)

Source: legacy 16.

| Table | Origin |
|---|---|
| `sections` | legacy 16 |
| `tables` | legacy 16 |
| `table_sessions` | legacy 16 |
| `seats` | legacy 16 |
| `check_splits` | legacy 16 |
| `check_split_items` | legacy 16 |

---

### 007 — `orders_and_kds.sql` (Phase B.3)

Sources: legacy 2 (orders, order_items; legacy tables `order_details`, `order_financial_details`, `driver_ratings` are replaced by consolidated columns — see note), 3 (triggers), 17, 28 (kds_expo_view — absorbed as `kds_display_groups`), 36, 40, 45, 46.

| Table | Origin |
|---|---|
| `orders` | legacy 2 + 16 + 38 + 40 + 45 + 46 — add `fulfillment_type fulfillment_type`, `idempotency_key text UNIQUE`, `fiscal_receipt_number`, `fiscal_receipt_assigned_at`, `currency_code`, `fx_rate_to_zar` |
| `order_items` | legacy 2 + 16 — add `idempotency_key text` |
| `order_payments` | legacy 4 — **REMOVE** `paystack_reference`, `paystack_status`, `paystack_gateway_response` (replaced by `payment_attempts` in 008); keep `payment_reference` generic |
| `tax_rates` | legacy 2 |
| `kitchen_stations` | legacy 17 |
| `item_station_routing` | legacy 17 + 46 |
| `category_station_routing` [NEW] | ROADMAP Now-23: `(id, category_id FK, station_id FK, is_primary bool)` |
| `kds_tickets` | legacy 17 |
| `kds_ticket_items` | legacy 17 |
| `kds_ticket_events` | legacy 17 — add `'ready'` to event_type enum (already in enum 001) |
| `kds_fanout_queue` | legacy 36 — add `retry_count int NOT NULL DEFAULT 0`, `state text DEFAULT 'pending' CHECK (state IN ('pending','processing','dead'))` |
| `kds_display_groups` [NEW] | ROADMAP Now-23: `(id, location_id FK, name, station_ids uuid[], sort_order)` |
| `fiscal_sequences` | legacy 40 |
| `order_tracking_tokens` [NEW] | ROADMAP Now-7: `(token text PK, order_id FK, customer_profile_id FK, expires_at, revoked_at)` |

**Legacy tables replaced/dropped in 007**: `order_details`, `order_financial_details`, `driver_ratings`, `driver_earnings`, `delivery_drivers`, `driver_locations` from legacy 2. These were the old simplified delivery driver model; the new `driver_*` tables live in 011. Financial detail columns are folded into `orders` or `order_payments`. Phase B.3 must note these are intentionally absent.

---

### 008 — `payments_generic.sql` (Phase B.4)

Sources: legacy 4 (payment_methods, order_payments, refunds, merchant_payouts, etc.), 15 (location_payment_gateways — replaced), 26, 27, 30, 38 (exchange_rates implied), 41 (delivery_zones moved from here — see 011), 43 (org_default_location trigger).

| Table | Origin |
|---|---|
| `locations` | legacy 2 + 26 + 43 — add `slug text UNIQUE`, `city text`, `country text`, `on_delivery_payment_methods text[] DEFAULT '{}'`, `offers_delivery bool DEFAULT false`, `offers_collection bool DEFAULT true`, `is_marketplace_visible bool DEFAULT false`, `currency_code text REFERENCES currencies(code)`, CHECK (offers_delivery OR offers_collection) |
| `regions` | legacy 26 |
| `payment_methods` | legacy 4 |
| `location_payment_method_fees` | legacy 4 |
| `payment_providers` [NEW] | ROADMAP Now-4: `(id, code text UNIQUE, display_name, is_active bool)` — registry: paystack, stripe, payfast |
| `location_payment_credentials` [NEW] | ROADMAP Now-4: replaces `location_payment_gateways` (legacy 15 dropped in 26); `(id, location_id FK, provider_code FK, public_key, secret_key_ciphertext, webhook_secret_ciphertext, is_test_mode, is_active, currency, configured_by FK)` |
| `payment_attempts` [NEW] | ROADMAP Now-4: `(id, order_id FK nullable, provider_code text, provider_txn_id text, status payment_status, amount_cents bigint, currency_code, metadata jsonb, created_at)` — UNIQUE(provider_code, provider_txn_id) |
| `order_payments` | (defined in 007; extended with `payment_attempt_id FK` in 008 cross-migration FK) |
| `payment_fees` | legacy 4 |
| `beepbite_payment_fees` | legacy 30 |
| `refunds` | legacy 4 |
| `merchant_payouts` | legacy 4 + 27 |
| `merchant_payout_items` | legacy 4 |
| `bank_accounts` | legacy 27 |
| `payout_schedules` | legacy 27 |
| `subscription_plans` | legacy 27 + 38 (billed_in_currency_code) |
| `exchange_rates` [NEW] | ROADMAP Now-11: `(id, from_currency text, to_currency text, rate numeric(18,8), source text, fetched_at timestamptz, created_at)` — UNIQUE(from_currency, to_currency, fetched_at) |
| `subscription_invoices` [NEW] | ROADMAP Now-11: `(id, org_id FK, plan_id FK, period_start date, period_end date, usd_amount_cents bigint, local_amount_cents bigint, local_currency_code, fx_rate numeric(18,8), status, issued_at, paid_at)` |
| `webhook_event_log` | legacy 23 — generalize `provider` CHECK to remove hard-coded list (allow any text) |
| `org_wallets` [NEW] | ROADMAP Now-1: `(org_id uuid PK FK, balance_cents bigint NOT NULL DEFAULT 0, hold_cents bigint NOT NULL DEFAULT 0, currency_code text NOT NULL, updated_at)` |
| `wallet_topups` [NEW] | ROADMAP Now-1: `(id, org_id FK, amount_cents, currency_code, payment_attempt_id FK nullable, status topup_status, created_at, completed_at)` |
| `wallet_transactions` [NEW] | ROADMAP Now-1 — append-only ledger; trigger updates `org_wallets.balance_cents` |
| `custom_domains` [NEW] | ROADMAP Now-13: `(id, location_id FK, hostname text UNIQUE, status custom_domain_status, verification_token, verified_at, cert_issued_at, removed_at)` |
| `api_keys` [NEW] | ROADMAP Now-12: `(id, org_id FK, name, prefix_visible text, key_hash text, scopes text[], expires_at, last_used_at, created_by FK, revoked_at)` |
| `webhook_endpoints` [NEW] | ROADMAP Now-12: `(id, org_id FK, url, signing_secret_ciphertext, events text[], is_active, created_at)` |
| `cart_items` | legacy 4 |
| `cart_item_variations` | legacy 4 — kept for backward compat with chatbot; may be superseded by modifier model |
| `customer_payment_authorizations` | legacy 4 |

---

### 009 — `cash_and_adjustments.sql` (Phase B.4)

Sources: legacy 18, 31 (schema fixes absorbed into table definitions), plus new `pos_shifts`.

| Table | Origin |
|---|---|
| `cash_drawers` | legacy 18 |
| `cash_drawer_sessions` | legacy 18 |
| `cash_drawer_movements` | legacy 18 |
| `cash_drawer_counts` | legacy 18 |
| `cash_drawer_session_payments` | legacy 18 |
| `adjustment_reasons` | legacy 18 |
| `order_adjustments` | legacy 18 + 31 (add `'refund'` to adjustment_type) |
| `pos_shifts` [NEW] | tasks.md 009: `(id, staff_id FK, location_id FK, cash_drawer_session_id FK nullable, started_at, ended_at, status)` |

---

### 010 — `engagement.sql` (Phase B.5)

Sources: legacy 2 (customers, customer_addresses), 4 (cart tables remain in 008), 19, 25, 37, 42.

| Table | Origin |
|---|---|
| `customers` | legacy 2 + 39 (`last_seen_at`) — add `profile_id uuid REFERENCES profiles(id)` (links WhatsApp customer to account) |
| `customer_addresses` | legacy 2 |
| `promotions` | legacy 19 |
| `promotion_target_items` | legacy 19 |
| `promotion_target_categories` | legacy 19 |
| `coupon_codes` | legacy 19 |
| `promotion_redemptions` | legacy 19 |
| `order_item_discounts` | legacy 19 |
| `gift_cards` | legacy 25 |
| `gift_card_transactions` | legacy 25 |
| `store_credits` | legacy 25 |
| `store_credit_transactions` | legacy 25 |
| `house_accounts` | legacy 25 |
| `house_account_members` | legacy 25 |
| `house_account_charges` | legacy 25 |
| `house_account_invoices` | legacy 25 |
| `loyalty_config` | legacy 25 |
| `loyalty_transactions` | legacy 25 |
| `reservations` | legacy 37 |
| `waitlist` | legacy 37 |
| `reviews` | legacy 2 + 42 (reply columns) |
| `marketplace_reviews` [NEW] | ROADMAP Now-18: `(id, order_id FK, customer_profile_id FK, location_id FK, stars int CHECK(1–5), text, photos text[], verified_purchase bool DEFAULT true, created_at)` |
| `tax_profiles` [NEW] | ROADMAP Now-26: `(org_id uuid PK FK, legal_name, registered_address, country, vat_number nullable, company_reg_number nullable, contact_email, contact_phone, updated_at)` |
| `invoices` [NEW] | ROADMAP Now-26: `(id, org_id FK, issuer text CHECK('platform'\|'tenant'), invoice_number, issued_at, due_date, total_cents bigint, currency_code, status, pdf_url, metadata jsonb, created_at)` |

---

### 011 — `delivery.sql` (Phase B.5)

Sources: legacy 12 (delivery_partners), 41 (delivery_zones).

| Table | Origin |
|---|---|
| `delivery_zones` | legacy 41 |
| `delivery_partners` | legacy 12 |
| `delivery_partner_credentials` | legacy 12 |
| `delivery_partner_orders` | legacy 12 |
| `delivery_partner_webhook_events` | legacy 12 |
| `whatsapp_routing` [NEW] | tasks.md 011: `(id, location_id FK, phone_e164 text, is_primary bool, region_code text)` — routes inbound WhatsApp to the right location |
| `driver_assignments` [NEW] | ROADMAP Now-7: see tasks.md T0.B.5 |
| `driver_location_pings` [NEW] | ROADMAP Now-7: partitioned by month; 7-day retention |
| `driver_shifts` [NEW] | ROADMAP Now-7 |
| `driver_emergency_contacts` [NEW] | ROADMAP Now-7 |

---

### 012 — `shifts_payroll_tipping.sql` (Phase B.6)

Sources: legacy 2 (staff_shifts already in 003 — see note), 29, 32, 33.

| Table | Origin |
|---|---|
| `tip_pools` | legacy 32 |
| `tip_pool_contributions` | legacy 32 |
| `tip_distributions` | legacy 32 |
| `payroll_periods` [NEW] | tasks.md 012: `(id, org_id FK, period_start date, period_end date, status, exported_at nullable, created_at)` |

**Note on staff_shifts / staff_time_entries / staff_pay_rates**: these are already in migration 003 (as they are fundamental to the `staff` entity). Migration 012 references them via FK but does not redefine them. The labor cost reporting views belong to migration 014.

---

### 013 — `compliance.sql` (Phase B.6)

Sources: legacy 23, 39.

| Table | Origin |
|---|---|
| `audit_log` | legacy 23 |
| `audit_log_archived` | legacy 39 |
| `idempotency_keys` | legacy 23 |
| `pii_access_log` | legacy 39 |

**Note**: `webhook_event_log` is in migration 008 (payments domain). `audit_log_archived` mirrors `audit_log` schema; the `archive_old_audit_log()` function is defined here.

---

### 014 — `seed_and_views.sql` (Phase C)

No new tables. Contains:
- Seed data: `regions`, `currencies`, `payment_providers`, `payment_methods`, `delivery_partners`, `subscription_plans`
- All reporting views: `daily_sales_summary`, `hourly_sales_heatmap`, `menu_engineering`, `labor_hours_daily`, `labor_cost_daily`, `sales_per_labor_hour`, `theoretical_vs_actual_cogs`, `revenue_by_payment_method`
- All views use `security_invoker = on` (Postgres 15+)
- The `handle_new_organization()` trigger (from legacy 43) is moved here since it depends on `regions` seed data being present
- `kds_expo_view` (from legacy 28)

---

## 2. Session-Variable Contract

Every authenticated request sets these Postgres session-local variables before any SQL executes. They are scoped to the transaction (`set_config(..., true)` = local).

| Variable | Type | Meaning |
|---|---|---|
| `app.current_user_id` | `uuid` | The authenticated `auth_users.id` (member JWT) |
| `app.current_org_id` | `uuid` | The organization the request is scoped to |
| `app.current_capabilities` | `jsonb` | `organization_members.capabilities` for this session |
| `app.current_actor_id` | `uuid` | Staff `id` doing the action on top of the member session (PIN overlay); falls back to `current_user_id` if no actor overlay |
| `app.is_service_role` | `bool` | `'true'` for system-level jobs and migration tool; bypasses RLS |
| `app.is_marketplace_role` | `bool` | `'true'` for anonymous marketplace reads; narrow SELECT grants only |

**Empty / missing values**: All helper functions call `current_setting('app.xxx', true)` with the `missing_ok=true` flag. A missing or empty string returns `NULL`, which causes all RLS policies to evaluate `FALSE` → zero rows visible. This is the safe default.

---

## 3. RLS Helper Functions (defined in migration 001)

```sql
-- Returns the current org UUID, or NULL if not set.
CREATE FUNCTION current_org_id() RETURNS uuid STABLE LEAKPROOF LANGUAGE sql AS $$
  SELECT nullif(current_setting('app.current_org_id', true), '')::uuid
$$;

-- Returns the current user UUID, or NULL.
CREATE FUNCTION current_user_id() RETURNS uuid STABLE LEAKPROOF LANGUAGE sql AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Returns the current actor UUID (staff PIN overlay), falls back to current_user_id.
CREATE FUNCTION current_actor_id() RETURNS uuid STABLE LEAKPROOF LANGUAGE sql AS $$
  SELECT COALESCE(
    nullif(current_setting('app.current_actor_id', true), '')::uuid,
    nullif(current_setting('app.current_user_id', true), '')::uuid
  )
$$;

-- Returns current capabilities as jsonb, or empty object.
CREATE FUNCTION current_capabilities() RETURNS jsonb STABLE LANGUAGE sql AS $$
  SELECT COALESCE(
    nullif(current_setting('app.current_capabilities', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

-- Returns true if the named capability key is truthy in current_capabilities().
CREATE FUNCTION has_capability(cap text) RETURNS bool STABLE LANGUAGE sql AS $$
  SELECT COALESCE((current_capabilities()->>cap)::bool, false)
$$;

-- Returns true when running as service_role (migration tool, admin scripts).
CREATE FUNCTION is_service_role() RETURNS bool STABLE LEAKPROOF LANGUAGE sql AS $$
  SELECT COALESCE(nullif(current_setting('app.is_service_role', true), '')::bool, false)
$$;

-- Returns true when running as marketplace_role (public discovery endpoints).
CREATE FUNCTION is_marketplace_role() RETURNS bool STABLE LEAKPROOF LANGUAGE sql AS $$
  SELECT COALESCE(nullif(current_setting('app.is_marketplace_role', true), '')::bool, false)
$$;
```

---

## 4. RLS Policy Templates

These patterns are copy-pasteable. Every domain migration must use one of these patterns for each table, plus a comment block explaining which threat each policy addresses.

### 4.1 Org-scoped table (e.g. `orders`, `items`, `promotions`)

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

-- Tenant can only see their own org's rows; service bypasses.
CREATE POLICY orders_select ON orders FOR SELECT
  USING (organization_id = current_org_id() OR is_service_role());

-- Tenant can only insert into their own org; service can insert anywhere.
CREATE POLICY orders_insert ON orders FOR INSERT
  WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- Tenant can only update their own rows.
CREATE POLICY orders_update ON orders FOR UPDATE
  USING (organization_id = current_org_id() OR is_service_role())
  WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- Deletes locked to service_role (handlers should soft-delete).
CREATE POLICY orders_delete ON orders FOR DELETE
  USING (is_service_role());
```

**Note for tables without a direct `organization_id` column (e.g. `items` which has `location_id`)**: join through `locations`:

```sql
CREATE POLICY items_select ON items FOR SELECT
  USING (
    location_id IN (
      SELECT id FROM locations WHERE organization_id = current_org_id()
    )
    OR is_service_role()
  );
```

### 4.2 Location-scoped table (e.g. `kds_tickets`, `kitchen_stations`, `cash_drawers`)

```sql
ALTER TABLE kds_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_tickets FORCE ROW LEVEL SECURITY;

CREATE POLICY kds_tickets_select ON kds_tickets FOR SELECT
  USING (
    station_id IN (
      SELECT ks.id FROM kitchen_stations ks
      JOIN locations l ON l.id = ks.location_id
      WHERE l.organization_id = current_org_id()
    )
    OR is_service_role()
  );

CREATE POLICY kds_tickets_insert ON kds_tickets FOR INSERT
  WITH CHECK (
    station_id IN (
      SELECT ks.id FROM kitchen_stations ks
      JOIN locations l ON l.id = ks.location_id
      WHERE l.organization_id = current_org_id()
    )
    OR is_service_role()
  );

CREATE POLICY kds_tickets_update ON kds_tickets FOR UPDATE
  USING (
    station_id IN (
      SELECT ks.id FROM kitchen_stations ks
      JOIN locations l ON l.id = ks.location_id
      WHERE l.organization_id = current_org_id()
    )
    OR is_service_role()
  );

CREATE POLICY kds_tickets_delete ON kds_tickets FOR DELETE
  USING (is_service_role());
```

### 4.3 Member-scoped table (e.g. `refresh_tokens`, `password_reset_tokens`)

```sql
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens FORCE ROW LEVEL SECURITY;

-- User sees only their own tokens.
CREATE POLICY refresh_tokens_select ON refresh_tokens FOR SELECT
  USING (user_id = current_user_id() OR is_service_role());

CREATE POLICY refresh_tokens_insert ON refresh_tokens FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_service_role());

CREATE POLICY refresh_tokens_update ON refresh_tokens FOR UPDATE
  USING (user_id = current_user_id() OR is_service_role());

CREATE POLICY refresh_tokens_delete ON refresh_tokens FOR DELETE
  USING (user_id = current_user_id() OR is_service_role());
```

### 4.4 Public-via-marketplace (e.g. `locations`, `items` on public menu endpoints)

Two policies: one for authenticated tenants (org-scoped) and one for the marketplace role (limited SELECT on visible rows only).

```sql
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;

-- Org members see their own locations.
CREATE POLICY locations_select_member ON locations FOR SELECT
  USING (organization_id = current_org_id() OR is_service_role());

-- Marketplace role can only SELECT marketplace-visible locations.
-- No INSERT/UPDATE/DELETE for marketplace_role ever.
CREATE POLICY locations_select_marketplace ON locations FOR SELECT
  USING (is_marketplace_role() AND is_marketplace_visible = true);

-- Only service_role can insert/update/delete locations (handlers call via service scope or scoped tx).
-- Actually: tenant-scoped inserts are valid; use org-scoped WITH CHECK:
CREATE POLICY locations_insert ON locations FOR INSERT
  WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY locations_update ON locations FOR UPDATE
  USING (organization_id = current_org_id() OR is_service_role())
  WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY locations_delete ON locations FOR DELETE
  USING (is_service_role());
```

### 4.5 Service-only write (e.g. `audit_log` inserts, `idempotency_keys`)

```sql
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Any authenticated session can read their org's audit rows (tenant-facing viewer).
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (organization_id = current_org_id() OR is_service_role());

-- Only service_role writes audit rows — handlers must use service scope for audit inserts.
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
  WITH CHECK (is_service_role());

-- Audit log is append-only. No UPDATE or DELETE by anyone (not even service_role in RLS).
-- Service_role bypasses RLS anyway, but making this explicit documents intent.
CREATE POLICY audit_log_update ON audit_log FOR UPDATE
  USING (false);

CREATE POLICY audit_log_delete ON audit_log FOR DELETE
  USING (false);
```

For `idempotency_keys` (system-level, not org-scoped):

```sql
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

-- Service_role reads/writes; no tenant access.
CREATE POLICY idempotency_keys_all ON idempotency_keys
  USING (is_service_role())
  WITH CHECK (is_service_role());
```

---

## 5. Tables NOT Under RLS

These are global reference data. They are readable by all authenticated connections and writable only by `service_role`. RLS is **not** enabled on them; instead, explicit GRANT controls apply.

| Table | Reason |
|---|---|
| `regions` | Platform-wide list; no tenant data |
| `currencies` | ISO reference; no tenant data |
| `payment_providers` | Registry; no tenant data |
| `payment_methods` | Registry; no tenant data |
| `subscription_plans` | Platform tiers; no tenant data |
| `delivery_partners` | Registry; no tenant data |
| `llm_model_pricing` [NEW] | Platform-wide LLM cost data |
| `llm_providers` [NEW] | Provider registry (Anthropic, OpenAI, etc.) |

Access pattern: `GRANT SELECT ON <table> TO PUBLIC; REVOKE INSERT, UPDATE, DELETE ON <table> FROM PUBLIC;`. Only `service_role` may mutate these via explicit grants.

---

## 6. Go pgxpool Integration Contract

### 6.1 The `Scoped` function

Every handler that touches tenant data must run its DB work through `Scoped`. See `backend/internal/db/scoped.go`.

```go
// Scope holds the per-request session variable values.
type Scope struct {
    UserID        uuid.UUID  // app.current_user_id
    OrgID         uuid.UUID  // app.current_org_id
    Capabilities  []byte     // app.current_capabilities (JSON-encoded)
    ActorID       uuid.UUID  // app.current_actor_id
    IsServiceRole bool       // app.is_service_role
    IsMarketplace bool       // app.is_marketplace_role
}

// Scoped begins a transaction, sets session vars, runs fn, commits on success.
func Scoped(ctx context.Context, pool *pgxpool.Pool, scope Scope, fn func(tx pgx.Tx) error) error
```

**Implementation rules**:
1. `pool.BeginTx(ctx, pgx.TxOptions{})` — begin transaction.
2. `defer tx.Rollback(ctx)` — always rollback on exit unless committed.
3. For each non-nil/non-zero field, execute `SELECT set_config($1, $2, true)` (local-to-transaction). `uuid.Nil` → `''`.
4. Call `fn(tx)`.
5. On success, `tx.Commit(ctx)`.

**All six variables must be set** in every call — even those that are empty string — so there are no ambiguous "variable not set" vs "variable set to empty" states. An unset `app.is_service_role` returns `NULL` which `is_service_role()` coerces to `false`.

### 6.2 Constructors

```go
// ServiceRoleScope returns a Scope that bypasses RLS (for jobs, migrations).
func ServiceRoleScope() Scope { return Scope{IsServiceRole: true} }

// MarketplaceScope returns a Scope for anonymous public marketplace reads.
func MarketplaceScope() Scope { return Scope{IsMarketplace: true} }
```

### 6.3 Context helpers

```go
// ContextWithScope injects a scope into a context (set by auth middleware).
func ContextWithScope(ctx context.Context, s Scope) context.Context

// ScopeFromContext extracts the scope (returns zero Scope if not set).
func ScopeFromContext(ctx context.Context) Scope
```

Auth middleware builds the `Scope` from JWT claims + DB lookup for capabilities and calls `ContextWithScope`. Each handler calls `ScopeFromContext`, then passes it to `Scoped`.

---

## 7. FK Dependency Order (Migration Sequencing)

```
001 (no tables, no FKs)
  └─ 002 auth_users, profiles, organizations, organization_members, currencies
       └─ 003 staff, staff_refresh_tokens (FKs to profiles, organization_members, locations)
       └─ 004 categories, items, modifier_groups (FKs to organizations, locations)
            └─ 005 inventory_items, suppliers (FKs to organizations, locations, items)
       └─ 006 sections, tables, table_sessions (FKs to locations, staff)
            └─ 007 orders, kds_tickets (FKs to locations, customers, staff, tables, sections)
                 └─ 008 locations (must precede 007 logically — see note), payment_providers, wallet
                      └─ 009 cash_drawers (FKs to locations, staff, order_payments)
                      └─ 010 promotions, customers, gift_cards (FKs to organizations, locations, orders)
                      └─ 011 delivery_zones, driver_assignments (FKs to locations, orders, organization_members)
                      └─ 012 tip_pools, payroll_periods (FKs to organizations, locations, staff, order_payments)
                      └─ 013 audit_log, idempotency_keys (FKs to organizations, locations)
  └─ 014 seed data (depends on all tables above being present)
```

**Critical ordering note**: `locations` is defined in migration 008, but `orders` (007) has a FK to `locations`. Phase B must define `locations` before `orders`. The cleanest solution is for Phase B.4 (which owns 008) to coordinate with Phase B.3 (which owns 007) to ensure 008 runs before 007 in the migration sequence — or alternatively, 008 is renumbered to run first. **Recommended resolution**: swap 007 and 008 to become:

- `007_payments_generic.sql` (currently 008) — creates `locations` which everything needs
- `008_orders_and_kds.sql` (currently 007) — creates `orders` which needs `locations`

This swap is a Phase B decision. The plan document will note it as an open judgment call. If Phase B keeps the current numbering, they must define `locations` in a standalone migration or use a forward FK declaration — neither is clean. **Recommended: swap the numbers.**

---

## 8. Legacy Migration Archival

After consolidated migrations 001–014 are implemented and the RLS verification suite passes (T0.C.2), all files matching `backend/migrations/20240101*.sql` move to `backend/migrations/legacy/`. The migration runner (`backend/cmd/migrate/main.go`) is updated to skip any file in a `legacy/` subdirectory. This is T0.C.3.

---

## 9. Open Questions for Phase B Agents

1. **007/008 numbering swap** (high-priority): `locations` is needed by `orders` (FK), `kds_tickets` (via location_id on kitchen_stations), and nearly every other table. If 008 runs after 007, the `orders` table cannot FK to `locations`. Phase B agents should swap the numbers: `007_payments_generic.sql` and `008_orders_and_kds.sql`. The plan document uses the original numbers for clarity; Phase B should implement the swap.

2. **Legacy chatbot tables** (`bots`, `chats`, `messages`, `bot_menu_sessions`, `notifications`): these are in legacy migrations 2, 10, 11 but are not listed in any consolidated migration above. The chatbot is being rewritten (Now-9). Options: (a) include in 011 delivery domain alongside whatsapp_routing; (b) defer to a Wave 9 migration (015). **Recommendation**: defer to Wave 9 (015). Phase B.5 should note that `bots`, `chats`, `messages`, `bot_menu_sessions` are intentionally excluded from Wave 0 consolidation and will be addressed in the chatbot rewrite wave. The legacy tables remain in `legacy/` for reference.

3. **`order_details`, `order_financial_details`**: the legacy simplified order model split these out. The consolidated model folds financial columns into `orders` and `order_payments`. Phase B.3 must ensure all columns referenced by existing Go handlers (`pos/store.go` references `order_financial_details`) are available on `orders` or `order_payments` before the handler is ported.

4. **`staff.email` column**: handlers in `staffauth/store.go` query by `staff.email`. When 003 drops the UNIQUE NOT NULL constraint and removes the column, `staffauth` handlers must be updated (Wave 6 T6.x). Phase B.1 should document this in the migration header.

5. **`llm_model_pricing` and `llm_providers`** tables (Now-1): these are referenced as global reference tables exempt from RLS, but their schema is not detailed in legacy migrations. Phase B can leave them out of Wave 0 (they belong in the Wave 9 billing migration, number 015+). Mark them as TODO in migration 014 seed.
