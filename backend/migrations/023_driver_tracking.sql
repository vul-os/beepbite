-- =============================================================================
-- MIGRATION 023 — DRIVER / TRACKING SCHEMA GAPS  (Wave 16)
-- =============================================================================
-- Purpose: closes the delta between what Wave 16 driver/tracking code expects
-- and what prior consolidated migrations actually created.
--
-- EXISTENCE AUDIT (run before writing this migration):
--
--   order_tracking_tokens         — EXISTS (008_orders_and_kds.sql §14)
--   pings_visible_to_customer()   — EXISTS (011_delivery.sql §11; full haversine)
--   order_status.out_for_delivery — EXISTS (001_extensions_and_helpers.sql §2)
--   driver_assignment_status enum — EXISTS (001_extensions_and_helpers.sql §2)
--   driver_shift_status enum      — EXISTS (001_extensions_and_helpers.sql §2)
--   driver_assignments            — EXISTS (011_delivery.sql §7)
--   driver_location_pings         — EXISTS (011_delivery.sql §8; partitioned)
--   driver_shifts                 — EXISTS (011_delivery.sql §9)
--   driver_emergency_contacts     — EXISTS (011_delivery.sql §10)
--
--   orders.delivery_address_id    — MISSING.
--       pings_visible_to_customer() (011) joins:
--           orders o JOIN customer_addresses ca ON ca.id = o.delivery_address_id
--       but 008 never added that FK column to orders; it only stored denormalised
--       delivery_address text, delivery_latitude, and delivery_longitude.
--       Without this column the function always returns NULL
--       (no delivery address → no ping visible).
--
-- WHAT THIS MIGRATION CREATES:
--
--   1. orders.delivery_address_id   uuid FK → customer_addresses(id)
--      Allows pings_visible_to_customer() to resolve the delivery address
--      coordinates from the linked customer_addresses row instead of the
--      denormalised decimal columns.  Adding the FK does NOT remove the
--      existing delivery_latitude / delivery_longitude columns (kept for
--      backward compat with chatbot code that reads them inline).
--
--   2. CREATE INDEX idx_orders_delivery_address_id  (sparse; WHERE NOT NULL)
--
-- ROLE SAFETY NOTE:
--   This migration issues NO explicit GRANT ... TO service_role.
--   service_role access to orders (and all tables modified here) is already
--   covered by the ALTER DEFAULT PRIVILEGES in 001 and the OR is_service_role()
--   clause in every existing RLS policy on the orders table.  A bare
--   GRANT ... TO service_role would abort when the role does not exist, which
--   is a known failure mode (see migration 020 comment header).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. orders.delivery_address_id
-- ---------------------------------------------------------------------------
-- Links an order to the specific customer_addresses row the customer chose at
-- checkout.  Nullable: walk-in POS orders and collection orders have no
-- delivery address.  ON DELETE SET NULL: if the customer later deletes their
-- saved address the order record is preserved with the FK cleared (the
-- denormalised text/lat/lng columns remain as the historical snapshot).
--
-- ADD COLUMN IF NOT EXISTS: safe to re-run if a prior aborted attempt left the
-- column in place.
-- ---------------------------------------------------------------------------

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS delivery_address_id uuid
        REFERENCES customer_addresses(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.delivery_address_id IS
    'FK to the customer_addresses row selected at checkout. NULL for walk-in '
    'POS, collection, or dine-in orders. Used by pings_visible_to_customer() '
    '(011_delivery.sql) to resolve the haversine delivery-coordinate check. '
    'The denormalised delivery_latitude / delivery_longitude columns are kept '
    'alongside this FK for backward-compat with chatbot code.';

-- Sparse index: only delivery orders set this column.
CREATE INDEX IF NOT EXISTS idx_orders_delivery_address_id
    ON orders(delivery_address_id)
    WHERE delivery_address_id IS NOT NULL;


-- =============================================================================
-- DONE — Migration 023
-- =============================================================================
--
-- Objects created:
--   COLUMN  orders.delivery_address_id  uuid REFERENCES customer_addresses(id)
--   INDEX   idx_orders_delivery_address_id  (sparse, WHERE delivery_address_id IS NOT NULL)
--
-- Objects found-existing (skipped — no DDL emitted):
--   TABLE   order_tracking_tokens       (008_orders_and_kds.sql §14)
--   FUNCTION pings_visible_to_customer  (011_delivery.sql §11)
--   ENUM VALUE order_status.out_for_delivery (001_extensions_and_helpers.sql §2)
--   ENUM    driver_assignment_status    (001_extensions_and_helpers.sql §2)
--   ENUM    driver_shift_status         (001_extensions_and_helpers.sql §2)
--   TABLE   driver_assignments          (011_delivery.sql §7)
--   TABLE   driver_location_pings       (011_delivery.sql §8)
--   TABLE   driver_shifts               (011_delivery.sql §9)
--   TABLE   driver_emergency_contacts   (011_delivery.sql §10)
--
-- RLS reasoning for delivery_address_id:
--   The column is on the orders table, which already has ENABLE/FORCE ROW
--   LEVEL SECURITY and four policies (select/insert/update/delete) in 008.
--   Adding a column to orders does not alter those policies; the existing
--   orders_select / orders_update policies continue to scope access by
--   organization_id = current_org_id() OR is_service_role().  No new RLS
--   statements are required.
--
-- Assumptions:
--   - customer_addresses exists (created in 010_engagement.sql §2).
--   - The orders table was created in 008_orders_and_kds.sql with
--     delivery_latitude / delivery_longitude inline; those columns are
--     preserved unchanged.
--   - Distance computation in pings_visible_to_customer() reads
--     ca.latitude / ca.longitude from the joined customer_addresses row;
--     the function signature does NOT need to be changed — only the FK column
--     on orders needed to be added so the JOIN finds a row at all.
-- =============================================================================
