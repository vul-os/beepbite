-- =============================================================================
-- MIGRATION 026 — WAVE 24 "EASY WINS" POS FEATURES
-- =============================================================================
-- Purpose: adds schema for six Wave 24 easy-win POS features.
-- All objects use ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
-- No bare GRANT … TO service_role — service_role coverage is provided by the
-- ALTER DEFAULT PRIVILEGES block in 001_extensions_and_helpers.sql (line 351).
-- Each new table has org-scoped RLS via is_service_role() as established in
-- 001 and followed by all migrations 002–025.
--
-- PRE-MIGRATION EXISTENCE AUDIT:
--   items                   — EXISTS (004_menu.sql §2)
--   locations               — EXISTS (007_payments_generic.sql §5)
--   orders                  — EXISTS (008_orders_and_kds.sql §2)
--     orders.notes          — EXISTS (008 line 160)
--     orders.kitchen_notes  — EXISTS (008 line 161)
--   customers               — EXISTS (010_engagement.sql §1)
--     customers.whatsapp_number          — EXISTS (010 line 41)
--     idx_customers_whatsapp (bare col)  — EXISTS (010 line 65)
--   loyalty_config          — EXISTS (010_engagement.sql §16)
--   loyalty_transactions    — EXISTS (010_engagement.sql §17)
--   customer_loyalty_stamps — MISSING → CREATED HERE
--
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. ITEMS — Daily countdown ("N left today")
-- ---------------------------------------------------------------------------
-- daily_quantity   : owner sets max units available for the current calendar day.
--                    NULL = unlimited (no countdown shown).
-- daily_sold_count : incremented by the POS handler each time this item is sold.
--                    Reset to 0 when daily_counter_date advances to a new day.
-- daily_counter_date: the calendar date daily_sold_count applies to.
--                    Allows the reset-on-new-day logic to be purely SQL/atomic.
--
-- RLS: inherited from existing items policies (004 + 007 deferred).
--   All existing items policies scope via location_id → locations.organization_id.
--   These new columns carry no independent RLS requirement.
-- ---------------------------------------------------------------------------

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS daily_quantity    integer,                          -- NULL = unlimited
    ADD COLUMN IF NOT EXISTS daily_sold_count  integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS daily_counter_date date;                            -- NULL until first sale of the day

COMMENT ON COLUMN items.daily_quantity IS
    'Maximum units of this item available in a single calendar day. '
    'NULL = unlimited (no countdown displayed to guests). '
    'Wave 24 "N left today" feature.';
COMMENT ON COLUMN items.daily_sold_count IS
    'Units sold today (resets to 0 when daily_counter_date advances). '
    'Incremented atomically by the POS charge handler. '
    'Wave 24 "N left today" feature.';
COMMENT ON COLUMN items.daily_counter_date IS
    'Calendar date (location-local) that daily_sold_count applies to. '
    'POS handler: if daily_counter_date < today, reset daily_sold_count = 0 '
    'and set daily_counter_date = today before incrementing. '
    'Wave 24 "N left today" feature.';


-- ---------------------------------------------------------------------------
-- 2. LOCATIONS — Auto-gratuity for large parties
-- ---------------------------------------------------------------------------
-- auto_gratuity_enabled    : when true, gratuity is appended automatically.
-- auto_gratuity_percent    : the percentage added (e.g. 18.00 = 18 %).
-- auto_gratuity_min_party  : minimum party_size that triggers auto-gratuity.
--                            The POS handler compares order.party_size (or table
--                            session guest count) against this threshold.
--
-- RLS: inherited from existing locations policies (007).
--   All writes are org-scoped; no separate policy needed for these columns.
-- ---------------------------------------------------------------------------

ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS auto_gratuity_enabled     boolean      NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS auto_gratuity_percent     numeric(5,2) NOT NULL DEFAULT 18.00,
    ADD COLUMN IF NOT EXISTS auto_gratuity_min_party   integer      NOT NULL DEFAULT 6;

COMMENT ON COLUMN locations.auto_gratuity_enabled IS
    'When true the POS appends gratuity automatically for large parties. '
    'Wave 24 auto-gratuity feature.';
COMMENT ON COLUMN locations.auto_gratuity_percent IS
    'Percentage of order subtotal added as auto-gratuity (e.g. 18.00 = 18 %). '
    'Only applied when auto_gratuity_enabled = true AND party size >= auto_gratuity_min_party.';
COMMENT ON COLUMN locations.auto_gratuity_min_party IS
    'Minimum party / guest count that triggers auto-gratuity. '
    'Default 6 (industry standard). Wave 24 auto-gratuity feature.';


-- ---------------------------------------------------------------------------
-- 3. LOCATIONS — Pickup time slots
-- ---------------------------------------------------------------------------
-- pickup_slot_capacity : max concurrent orders allowed per slot (0 = unlimited/disabled).
-- pickup_slot_minutes  : slot granularity in minutes (e.g. 15 = 15-min slots:
--                        12:00, 12:15, 12:30 …).  Ignored when capacity = 0.
--
-- RLS: same as §2 above — inherited from locations org-scoped policies.
-- ---------------------------------------------------------------------------

ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS pickup_slot_capacity  integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pickup_slot_minutes   integer NOT NULL DEFAULT 15;

COMMENT ON COLUMN locations.pickup_slot_capacity IS
    'Maximum number of pickup orders accepted per time slot. '
    '0 = feature disabled (unlimited / no slot enforcement). '
    'Wave 24 pickup-slot feature.';
COMMENT ON COLUMN locations.pickup_slot_minutes IS
    'Slot duration in minutes (e.g. 15 produces slots at :00, :15, :30, :45). '
    'Ignored when pickup_slot_capacity = 0. Wave 24 pickup-slot feature.';


-- ---------------------------------------------------------------------------
-- 4. ORDERS — Customer-facing note
-- ---------------------------------------------------------------------------
-- AUDIT: orders.notes (line 160) and orders.kitchen_notes (line 161) already exist.
--   orders.notes     → generic internal note field (can hold any staff note).
--   orders.kitchen_notes → dedicated to kitchen / KDS display.
--
-- Decision: add customer_note as a distinct column.
--   Rationale: "notes" is already used internally (staff editable), while
--   customer_note is set by the customer at checkout and must survive without
--   staff overwriting it. Keeping them separate also allows the API to expose
--   customer_note to marketplace-facing endpoints without exposing internal notes.
-- ---------------------------------------------------------------------------

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_note text,
    -- Auto-gratuity amount added for large parties (POS handler, Wave 24).
    ADD COLUMN IF NOT EXISTS gratuity_cents bigint NOT NULL DEFAULT 0,
    -- Scheduled pickup time, for pickup time-slot capacity counting (Wave 24).
    ADD COLUMN IF NOT EXISTS pickup_at timestamptz;

COMMENT ON COLUMN orders.customer_note IS
    'Customer-supplied note entered at checkout (e.g. "extra napkins please"). '
    'Distinct from orders.notes (internal staff note) and orders.kitchen_notes '
    '(KDS-facing). Set once at order creation; not editable by staff. '
    'Wave 24 easy-wins feature.';


-- ---------------------------------------------------------------------------
-- 5. LOYALTY CONFIG — Stamp-card columns ("buy N get 1 free")
-- ---------------------------------------------------------------------------
-- AUDIT: loyalty_config already has points-based fields (010 §16).
--   stamps_enabled    : opt-in flag; false by default so existing orgs are unaffected.
--   stamps_required   : how many qualifying purchases earn the free item.
--   stamp_item_id     : nullable FK to items(id) — the qualifying item that
--                       earns a stamp (NULL = any item earns a stamp).
--
-- RLS: inherited from existing loyalty_config policies (010 §24.16).
-- ---------------------------------------------------------------------------

ALTER TABLE loyalty_config
    ADD COLUMN IF NOT EXISTS stamps_enabled   boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS stamps_required  integer NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS stamp_item_id    uuid    REFERENCES items(id) ON DELETE SET NULL;

COMMENT ON COLUMN loyalty_config.stamps_enabled IS
    'When true the org uses stamp-card loyalty in addition to (or instead of) points. '
    'Wave 24 stamp-card feature.';
COMMENT ON COLUMN loyalty_config.stamps_required IS
    'Number of qualifying purchases needed to earn one free item. '
    'Default 10 ("buy 10 get 1 free"). Only relevant when stamps_enabled = true.';
COMMENT ON COLUMN loyalty_config.stamp_item_id IS
    'FK to items(id): the specific item that earns a stamp per purchase. '
    'NULL = any item purchase earns a stamp. '
    'ON DELETE SET NULL so deleting the qualifying item gracefully reverts to "any item".';


-- ---------------------------------------------------------------------------
-- 6. CUSTOMER LOYALTY STAMPS — Per-customer stamp counter
-- ---------------------------------------------------------------------------
-- One row per (organization, customer, location) triplet.
-- stamps : current stamp balance toward the next free item.
--          The POS handler increments this on qualifying purchases and resets
--          to 0 (or to stamps - stamps_required) when a redemption fires.
-- updated_at : bumped on every increment so recency can be checked.
--
-- RLS: org-scoped, same pattern as loyalty_config (010).
--   SELECT / INSERT / UPDATE: organization_id = current_org_id() OR is_service_role().
--   DELETE: is_service_role() only (ledger-style; corrections via service_role).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_loyalty_stamps (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    customer_id     uuid        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    location_id     uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    stamps          integer     NOT NULL DEFAULT 0 CHECK (stamps >= 0),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (organization_id, customer_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_loyalty_stamps_org_customer
    ON customer_loyalty_stamps(organization_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_loyalty_stamps_customer
    ON customer_loyalty_stamps(customer_id);

DROP TRIGGER IF EXISTS trg_customer_loyalty_stamps_updated_at ON customer_loyalty_stamps;
CREATE TRIGGER trg_customer_loyalty_stamps_updated_at
    BEFORE UPDATE ON customer_loyalty_stamps
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE customer_loyalty_stamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_loyalty_stamps FORCE ROW LEVEL SECURITY;

-- SELECT: org members see their own org's stamp rows; service_role sees all.
-- Threat: cross-tenant read of another org's customer stamp balances.
CREATE POLICY customer_loyalty_stamps_select ON customer_loyalty_stamps FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

-- INSERT: org members can create rows for their own org.
-- Threat: inserting a stamp row under a different org's ID.
CREATE POLICY customer_loyalty_stamps_insert ON customer_loyalty_stamps FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- UPDATE: org members can increment/reset their own org's stamp rows.
-- Threat: modifying another org's customer stamp balances.
CREATE POLICY customer_loyalty_stamps_update ON customer_loyalty_stamps FOR UPDATE
    USING  (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- DELETE: service_role only — stamp rows are ledger-adjacent; hard deletes
-- are administrative corrections only (e.g. fraud remediation).
CREATE POLICY customer_loyalty_stamps_delete ON customer_loyalty_stamps FOR DELETE
    USING (is_service_role());

COMMENT ON TABLE customer_loyalty_stamps IS
    'Per-customer stamp balance toward the next free item under the stamp-card '
    'loyalty programme. One row per (organization, customer, location). '
    'stamps is incremented by the POS handler on qualifying purchases and reset '
    'when a redemption fires. RLS: org-scoped (organization_id = current_org_id()). '
    'Wave 24 stamp-card feature.';

COMMENT ON COLUMN customer_loyalty_stamps.stamps IS
    'Current stamp count. POS handler resets to (stamps - stamps_required) on '
    'redemption so any overshoot carries forward correctly.';


-- ---------------------------------------------------------------------------
-- 7. CUSTOMERS — Fast phone-search index
-- ---------------------------------------------------------------------------
-- AUDIT: idx_customers_whatsapp already exists on customers(whatsapp_number)
--   (010_engagement.sql line 65) — a bare column B-tree index.
--
-- The existing index covers exact-match lookups (WHERE whatsapp_number = $1).
-- Phone-search at the POS typically uses prefix matching or case-folded lookup.
-- We add a lower()-expression index so the handler can do:
--   WHERE lower(whatsapp_number) = lower($1)
-- without a sequential scan.  CREATE INDEX IF NOT EXISTS is idempotent.
--
-- NOTE: customers has no separate "phone" column — whatsapp_number is the
-- sole phone field (confirmed in 010_engagement.sql §1).
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_customers_whatsapp_lower
    ON customers (lower(whatsapp_number));

COMMENT ON INDEX idx_customers_whatsapp_lower IS
    'Case-insensitive prefix/exact search on customers.whatsapp_number for the '
    'POS "find customer by phone" flow. Complements idx_customers_whatsapp (010) '
    'which is a plain B-tree on the raw value. Wave 24 easy-wins feature.';


-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- OBJECT                             TYPE           RLS / NOTES
-- ---------------------------------- -------------- ------------------------------------------------
-- items.daily_quantity               ADD COLUMN     Nullable integer. NULL = unlimited.
-- items.daily_sold_count             ADD COLUMN     NOT NULL DEFAULT 0. Incremented by POS handler.
-- items.daily_counter_date           ADD COLUMN     Nullable date. Used to auto-reset sold_count.
-- locations.auto_gratuity_enabled    ADD COLUMN     NOT NULL DEFAULT false.
-- locations.auto_gratuity_percent    ADD COLUMN     NOT NULL DEFAULT 18.00, numeric(5,2).
-- locations.auto_gratuity_min_party  ADD COLUMN     NOT NULL DEFAULT 6.
-- locations.pickup_slot_capacity     ADD COLUMN     NOT NULL DEFAULT 0 (0 = disabled).
-- locations.pickup_slot_minutes      ADD COLUMN     NOT NULL DEFAULT 15.
-- orders.customer_note               ADD COLUMN     Nullable text. Customer-set at checkout.
-- loyalty_config.stamps_enabled      ADD COLUMN     NOT NULL DEFAULT false.
-- loyalty_config.stamps_required     ADD COLUMN     NOT NULL DEFAULT 10.
-- loyalty_config.stamp_item_id       ADD COLUMN     Nullable uuid FK → items(id) ON DELETE SET NULL.
-- customer_loyalty_stamps            CREATE TABLE   Org-scoped RLS (4 policies).
--   .id                              uuid PK
--   .organization_id                 uuid NOT NULL FK → organizations
--   .customer_id                     uuid NOT NULL FK → customers
--   .location_id                     uuid NOT NULL FK → locations
--   .stamps                          integer NOT NULL DEFAULT 0 CHECK >= 0
--   .updated_at                      timestamptz NOT NULL, auto-updated via trigger
--   UNIQUE (organization_id, customer_id, location_id)
-- idx_customer_loyalty_stamps_org_customer  INDEX  (organization_id, customer_id)
-- idx_customer_loyalty_stamps_customer      INDEX  (customer_id)
-- idx_customers_whatsapp_lower       CREATE INDEX   lower(whatsapp_number) expression index.
--
-- FOUND EXISTING — SKIPPED:
--   orders.notes          — already exists (008 line 160); used for internal staff notes.
--   orders.kitchen_notes  — already exists (008 line 161); used for KDS display.
--   customers.whatsapp_number      — column exists (010 line 41).
--   idx_customers_whatsapp         — plain B-tree index on raw whatsapp_number (010 line 65).
--   loyalty_config (points fields) — points_per_currency_unit, min_redemption_points, etc.
--                                    (010 §16); stamp columns are additive.
--   loyalty_transactions           — points-ledger table (010 §17); stamp
--                                    redemptions are tracked in customer_loyalty_stamps
--                                    directly; no new transaction table needed for stamps.
--
-- RLS REASONING:
--   customer_loyalty_stamps: org-scoped (organization_id = current_org_id() OR is_service_role()).
--     Mirrors the pattern used by loyalty_config (010 §24.16) and store_credits (010 §24.11).
--     DELETE restricted to service_role because stamp rows are a quasi-ledger that should
--     only be hard-deleted by administrators (fraud remediation, GDPR erasure via service_role).
--   All ALTER TABLE … ADD COLUMN operations inherit existing RLS from 004, 007, 008, 010
--   without modification — no new policies needed for the new columns.
--
-- =============================================================================
