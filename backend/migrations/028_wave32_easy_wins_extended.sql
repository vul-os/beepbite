-- =============================================================================
-- MIGRATION 028 — WAVE 32 "EASY WINS EXTENDED"
-- =============================================================================
-- Purpose: adds schema for six Wave 32 easy-win features.
-- All column additions use ADD COLUMN IF NOT EXISTS.
-- New table uses CREATE TABLE IF NOT EXISTS.
-- No bare GRANT … TO service_role — service_role coverage is provided by the
-- ALTER DEFAULT PRIVILEGES block in 001_extensions_and_helpers.sql.
--
-- PRE-MIGRATION EXISTENCE AUDIT (CRITICAL — run before writing each block):
--
--   orders           — EXISTS (008_orders_and_kds.sql §2)
--     orders.organization_id  — EXISTS (008 line 106); org-column = organization_id
--     orders.held_at          — MISSING → CREATED HERE
--     orders.is_open_tab      — MISSING → CREATED HERE
--     orders.tab_name         — MISSING → CREATED HERE
--
--   items            — EXISTS (004_menu.sql §2); RLS via location_id → locations.organization_id
--     items.is_86ed           — EXISTS (004 line 128)
--     items.is_daily_special  — MISSING → CREATED HERE
--     items.special_price_cents — MISSING → CREATED HERE
--     items.special_date      — MISSING → CREATED HERE
--
--   cash_drawers     — EXISTS (009_cash_and_adjustments.sql §1)
--   cash_drawer_sessions — EXISTS (009 §2)
--     cash_drawer_sessions has UNIQUE INDEX one_open_session_per_drawer on
--     (cash_drawer_id) WHERE status='open' — meaning only one open session per
--     physical drawer at a time.  Multiple cashiers running SEPARATE drawers
--     on the same terminal is already supported by creating two cash_drawer rows.
--     We add cashier_label to let the UI distinguish the two sessions.
--     cashier_label   — MISSING → CREATED HERE
--
--   locations        — EXISTS (007_payments_generic.sql §5)
--     locations.estimated_prep_time — EXISTS (007 line 212) — owner-configured
--       baseline delivery/prep time (minutes). Already used by the delivery ETA
--       estimate path.
--     locations.avg_prep_minutes    — MISSING → CREATED HERE (rolling actual
--       average, distinct from the static baseline; used by the wait-time widget).
--     locations.auto_gratuity_enabled, pickup_slot_capacity, etc. — EXISTS (026)
--
--   customers        — EXISTS (010_engagement.sql §1); org-column = organization_id
--   items            — EXISTS (004 §2)
--   organizations    — EXISTS (002)
--   customer_favorite_items — MISSING → CREATED HERE
--
--   Quick coupon / quick category-86:
--     promotions / coupon_codes — EXISTS (010 §3/§5); reused without change.
--     items.is_86ed             — EXISTS (004 line 128); reused without change.
--     categories                — EXISTS (004 §1); reused without change.
--     NO NEW SCHEMA REQUIRED.
--
-- ORG-COLUMN CONVENTION CONFIRMED:
--   orders              → organization_id  (008 line 106)
--   customers           → organization_id  (010 line 39)
--   promotions          → organization_id  (010 line 109)
--   gift_cards          → organization_id  (010 line 253)
--   loyalty_config      → organization_id  (010 line 471)
--   loyalty_transactions → organization_id (010 line 493)
--   house_accounts      → organization_id  (010 line 363)
--   reservations        → organization_id  (010 line 517)
--   waitlist            → organization_id  (010 line 549)
--   categories          → organization_id  (004 line 39)
--   allergens           → organization_id  (004 line 436)
--   items               → via location_id (no direct org column on items)
--   cash_drawers        → via location_id (no direct org column)
--   tax_profiles        → org_id          (010 line 630, PK = org_id)
--   api_keys            → org_id          (007 / 027)
--   webhook_endpoints   → org_id          (007 / 027)
--
--   customer_favorite_items will use organization_id (matches customers / promotions).
--
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. ORDERS — Held tickets
-- ---------------------------------------------------------------------------
-- held_at: when set (NOT NULL), the order is "on hold" and the KDS fanout
-- worker skips it until it is released (held_at set back to NULL).
-- NULL = normal / not held.
--
-- RLS: inherited from existing orders policies (008 §RLS).
--   All orders policies scope via organization_id = current_org_id().
--   No new policy needed.
-- ---------------------------------------------------------------------------

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS held_at timestamptz;

COMMENT ON COLUMN orders.held_at IS
    'Timestamp at which this order was placed on hold (fire-later / held ticket). '
    'NULL = order is NOT held and flows normally through KDS fanout. '
    'When NOT NULL the KDS fanout worker skips this order; the cashier must '
    'explicitly release it (set held_at = NULL) to fire it to the kitchen. '
    'Wave 32 held-ticket feature.';

-- Partial index so the fanout worker can efficiently find all held orders by location.
CREATE INDEX IF NOT EXISTS idx_orders_held
    ON orders (location_id, held_at)
    WHERE held_at IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 2. ORDERS — Open tabs
-- ---------------------------------------------------------------------------
-- is_open_tab: when true the order remains "open" — items can be added over time
--              and the check is settled later (bar tabs, long dine-in tabs).
-- tab_name:    optional human-readable label (e.g. "Table 4 — Smith", "Bar 2").
--
-- A tab order is NOT automatically fanned out to the KDS on each item add;
-- the POS handler decides the fanout timing per business rules.
--
-- RLS: inherited from existing orders policies (008 §RLS).
-- ---------------------------------------------------------------------------

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS is_open_tab boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS tab_name    text;

COMMENT ON COLUMN orders.is_open_tab IS
    'When true this is an open bar/dine-in tab: items are added over time and '
    'the check is settled later. When false (default) the order is a standard '
    'single-shot order. Wave 32 open-tab feature.';
COMMENT ON COLUMN orders.tab_name IS
    'Optional human-readable label for the tab, e.g. "Table 4 – Smith" or '
    '"Bar 2". NULL for non-tab orders. Wave 32 open-tab feature.';

-- Index to let the POS list all open tabs for a location quickly.
CREATE INDEX IF NOT EXISTS idx_orders_open_tab
    ON orders (location_id, is_open_tab)
    WHERE is_open_tab = true;


-- ---------------------------------------------------------------------------
-- 3. ITEMS — Daily specials
-- ---------------------------------------------------------------------------
-- is_daily_special  : when true this item is promoted as a special today.
-- special_price_cents : override price in cents for the special period.
--                      NULL = no price override (display at normal price but
--                      still flagged as a special).
-- special_date      : the calendar date the special applies to.
--                      NULL = "always" or "indefinite" until toggled off.
--
-- RLS: inherited from existing items policies (004 + 007 deferred).
--   Items RLS scopes via location_id → locations.organization_id.
--   No new policy needed.
-- ---------------------------------------------------------------------------

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS is_daily_special     boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS special_price_cents  bigint,
    ADD COLUMN IF NOT EXISTS special_date         date;

COMMENT ON COLUMN items.is_daily_special IS
    'When true this item is the daily special. The POS / marketplace shows it '
    'with a "Special" badge and uses special_price_cents if set. '
    'Wave 32 daily-specials feature.';
COMMENT ON COLUMN items.special_price_cents IS
    'Override price in cents when this item is a daily special. '
    'NULL = use the regular items.price. Wave 32 daily-specials feature.';
COMMENT ON COLUMN items.special_date IS
    'The calendar date this special applies to. NULL = no date restriction '
    '(active until is_daily_special is set back to false). '
    'POS handler should check: is_daily_special AND (special_date IS NULL OR special_date = current_date). '
    'Wave 32 daily-specials feature.';

-- Index for fast "give me today's specials for this location" queries.
CREATE INDEX IF NOT EXISTS idx_items_daily_special
    ON items (location_id, is_daily_special, special_date)
    WHERE is_daily_special = true;


-- ---------------------------------------------------------------------------
-- 4. CASH DRAWER SESSIONS — Cashier label (dual cash drawer support)
-- ---------------------------------------------------------------------------
-- AUDIT: cash_drawer_sessions (009 §2) has:
--   one_open_session_per_drawer: UNIQUE (cash_drawer_id) WHERE status='open'
--   Meaning: one open session per *drawer* at a time.
--
-- Dual-cashier scenario: two cashiers share one terminal but each has their
-- own cash_drawer row (e.g. "Front Register A" and "Front Register B").
-- Each opens their own session → the existing constraint is satisfied.
-- The label on each session helps the UI and reports attribute movements
-- to the right cashier without needing to JOIN to cash_drawers.name every time.
--
-- cashier_label: free-text label set at session open, e.g. "Alice" or "Till 1 – Bob".
--
-- RLS: inherited from existing cash_drawer_sessions policies (009 §9.2).
-- ---------------------------------------------------------------------------

ALTER TABLE cash_drawer_sessions
    ADD COLUMN IF NOT EXISTS cashier_label text;

COMMENT ON COLUMN cash_drawer_sessions.cashier_label IS
    'Optional human-readable label identifying the cashier or terminal context '
    'for this session, e.g. "Alice" or "Till 1 – Bob". '
    'Dual-cashier setup: each cashier has their own cash_drawer row and opens '
    'their own session; this label appears on shift reports and drawer-count '
    'screens so staff can tell the sessions apart at a glance. '
    'NULL for single-cashier locations. Wave 32 dual-cash-drawer feature.';


-- ---------------------------------------------------------------------------
-- 5. LOCATIONS — Wait-time estimation baseline
-- ---------------------------------------------------------------------------
-- AUDIT: locations.estimated_prep_time (007 line 212, DEFAULT 30) is the
--   owner-configured static baseline used by the delivery ETA path.
--   It is NOT the rolling actual average — that is a different concept.
--
-- avg_prep_minutes: rolling average of actual preparation time in minutes,
--   derived from order timing data (e.g. order placed → order marked ready).
--   Used by the wait-time widget to give guests a dynamic estimate.
--   Default 15 as the task specifies; separate from the delivery baseline.
--
-- RLS: inherited from existing locations policies (007 §RLS).
-- ---------------------------------------------------------------------------

ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS avg_prep_minutes integer NOT NULL DEFAULT 15;

COMMENT ON COLUMN locations.avg_prep_minutes IS
    'Rolling average of actual order preparation time in minutes, updated by the '
    'POS/kitchen analytics job. Distinct from locations.estimated_prep_time (007), '
    'which is the owner-configured static delivery-ETA baseline. '
    'avg_prep_minutes drives the customer-facing wait-time widget. '
    'Default 15 (industry baseline). Wave 32 wait-time-estimation feature.';


-- ---------------------------------------------------------------------------
-- 6. CUSTOMER FAVORITE ITEMS  [NEW TABLE]
-- ---------------------------------------------------------------------------
-- One row per (org, customer, item) triplet — a customer's saved favourites.
-- org-column convention: organization_id (matches customers, promotions, etc.)
-- References:
--   organizations(id) ON DELETE CASCADE — org deletion removes all favourites.
--   customers(id)     ON DELETE CASCADE — customer deletion removes their favourites.
--   items(id)         ON DELETE CASCADE — item deletion removes favourites for that item.
--
-- RLS: org-scoped — same policy shape as customers (010 §24.1) and
--   customer_loyalty_stamps (026 §6).
--   SELECT / INSERT / UPDATE: organization_id = current_org_id() OR is_service_role().
--   DELETE: is_service_role() only (prevent casual un-favouriting via direct DB access;
--     handlers do soft-deletes by calling the service_role path).
--
-- NOTE: The task spec says DELETE → is_service_role(). In practice the POS
--   handler will call the API which uses service_role to remove a favourite.
--   This is consistent with how promotions_delete and customers_delete work.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_favorite_items (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id     uuid        NOT NULL REFERENCES customers(id)     ON DELETE CASCADE,
    item_id         uuid        NOT NULL REFERENCES items(id)         ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, customer_id, item_id)
);

COMMENT ON TABLE customer_favorite_items IS
    'A customer''s saved favourite menu items within an organisation. '
    'One row per (organization_id, customer_id, item_id) triplet. '
    'organization_id is the RLS anchor (matches customers, promotions, etc.). '
    'ON DELETE CASCADE on all three FKs ensures no orphaned rows. '
    'Wave 32 customer-favourites feature.';

CREATE INDEX IF NOT EXISTS idx_customer_favorites_org_customer
    ON customer_favorite_items (organization_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_favorites_customer
    ON customer_favorite_items (customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_favorites_item
    ON customer_favorite_items (item_id);

ALTER TABLE customer_favorite_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_favorite_items FORCE ROW LEVEL SECURITY;

-- Org members see their own org's favourite rows; service_role sees all.
-- Threat: cross-tenant read of another org's customer favourite lists.
CREATE POLICY customer_favorite_items_select ON customer_favorite_items FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

-- Org members can record favourites for their own org's customers.
-- Threat: inserting a favourite row under a different org's ID.
CREATE POLICY customer_favorite_items_insert ON customer_favorite_items FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- UPDATE is a no-op semantically (no mutable columns beyond created_at) but
-- permitted for service_role administrative corrections.
CREATE POLICY customer_favorite_items_update ON customer_favorite_items FOR UPDATE
    USING  (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- DELETE: service_role only — removal of a favourite is handled by the API
-- handler via service_role to keep the deletion path auditable.
CREATE POLICY customer_favorite_items_delete ON customer_favorite_items FOR DELETE
    USING (is_service_role());


-- ---------------------------------------------------------------------------
-- 7. QUICK COUPON / QUICK CATEGORY-86 — SCHEMA AUDIT
-- ---------------------------------------------------------------------------
-- CONFIRMED: NO NEW SCHEMA REQUIRED for either feature.
--
-- Quick coupon reuses:
--   promotions       (010 §3) — promotion row with promo_type, active_from/until, etc.
--   coupon_codes     (010 §5) — code, max_uses, assigned_to_customer_id, etc.
--   promotion_redemptions (010 §6) — records each use.
--   The POS handler creates a promotion + coupon_code pair at runtime; no DDL change.
--
-- Quick category-86 reuses:
--   items.is_86ed    (004 line 128) — boolean NOT NULL DEFAULT false.
--   categories       (004 §1)       — category row; is_active can soft-delete a whole cat.
--   The POS handler issues UPDATE items SET is_86ed = true WHERE category_id = $1;
--   or UPDATE categories SET is_active = false WHERE id = $1 for a full category pull.
--   No new columns or tables needed.
-- ---------------------------------------------------------------------------


-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- OBJECT                                 TYPE           RLS / NOTES
-- -------------------------------------- -------------- -----------------------------------------------
-- orders.held_at                         ADD COLUMN     Nullable timestamptz. NULL = not held.
-- orders.is_open_tab                     ADD COLUMN     boolean NOT NULL DEFAULT false.
-- orders.tab_name                        ADD COLUMN     Nullable text.
-- items.is_daily_special                 ADD COLUMN     boolean NOT NULL DEFAULT false.
-- items.special_price_cents              ADD COLUMN     Nullable bigint (cents). NULL = no price override.
-- items.special_date                     ADD COLUMN     Nullable date.
-- cash_drawer_sessions.cashier_label     ADD COLUMN     Nullable text.
-- locations.avg_prep_minutes             ADD COLUMN     integer NOT NULL DEFAULT 15.
-- customer_favorite_items                CREATE TABLE   Org-scoped RLS (4 policies).
--   .id                                  uuid PK        gen_random_uuid()
--   .organization_id                     uuid NOT NULL  FK → organizations ON DELETE CASCADE
--   .customer_id                         uuid NOT NULL  FK → customers      ON DELETE CASCADE
--   .item_id                             uuid NOT NULL  FK → items           ON DELETE CASCADE
--   .created_at                          timestamptz    NOT NULL DEFAULT now()
--   UNIQUE (organization_id, customer_id, item_id)
-- idx_customer_favorites_org_customer    CREATE INDEX   (organization_id, customer_id)
-- idx_customer_favorites_customer        CREATE INDEX   (customer_id)
-- idx_customer_favorites_item            CREATE INDEX   (item_id)
-- idx_orders_held                        CREATE INDEX   Partial: WHERE held_at IS NOT NULL
-- idx_orders_open_tab                    CREATE INDEX   Partial: WHERE is_open_tab = true
-- idx_items_daily_special                CREATE INDEX   Partial: WHERE is_daily_special = true
--
-- FOUND EXISTING — SKIPPED (no DDL emitted):
--   locations.estimated_prep_time  — EXISTS (007 line 212, DEFAULT 30); static owner baseline.
--     avg_prep_minutes is a NEW, distinct column (rolling actual average, DEFAULT 15).
--   items.is_86ed                  — EXISTS (004 line 128); reused by quick category-86.
--   items.daily_quantity/daily_sold_count/daily_counter_date — EXISTS (026 §1); not touched.
--   promotions / coupon_codes      — EXISTS (010 §3/§5); reused by quick coupon.
--   categories                     — EXISTS (004 §1); reused by quick category-86.
--   cash_drawer_sessions one_open_session_per_drawer UNIQUE index — EXISTS (009);
--     dual-cashier is achieved via two separate cash_drawer rows, no index change needed.
--
-- TABLES INSPECTED / ORG-COLUMN CONVENTION:
--   orders              → organization_id  (008_orders_and_kds.sql  line 106)
--   items               → location_id only (004_menu.sql; no direct org col; RLS via JOIN)
--   categories          → organization_id  (004_menu.sql line 39)
--   cash_drawer_sessions → cash_drawer_id → location_id → org (009; no direct org col)
--   locations           → organization_id  (007_payments_generic.sql line 198)
--   customers           → organization_id  (010_engagement.sql line 39)
--   promotions          → organization_id  (010_engagement.sql line 109)
--   coupon_codes        → via promotion_id → organization_id (010 §5)
--   customer_loyalty_stamps → organization_id (026 §6) — pattern source for new table
--   customer_favorite_items → organization_id  (THIS MIGRATION — matches customers/promotions)
--
-- =============================================================================
