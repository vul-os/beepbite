-- ======================
-- SCHEMA FIXES
-- 1. Add 'refund' to order_adjustments.adjustment_type CHECK constraint.
-- 2. Add 'grn' to stock_movements.movement_type CHECK constraint.
-- 3. Add updated_at triggers for migration 16, 17, and 25 tables.
--    NOTE: customers.loyalty_points already existed in migration 2 (integer DEFAULT 0).
--    NOTE: All triggers for migrations 16, 17, and 25 were already applied in
--          migration 29 (20240101000029_retro_updated_at_and_pay_rates.sql).
--          The DROP/CREATE blocks below are fully idempotent re-runs of those
--          same triggers so that migration 31 is self-contained.
-- ======================


-- ======================
-- 1. ADD 'refund' TO order_adjustments.adjustment_type
-- Original CHECK (from migration 18): ('void', 'comp', 'price_override', 'manager_discount')
-- New CHECK: ('void', 'comp', 'price_override', 'manager_discount', 'refund')
-- ======================

ALTER TABLE order_adjustments
    DROP CONSTRAINT IF EXISTS order_adjustments_adjustment_type_check;

ALTER TABLE order_adjustments
    ADD CONSTRAINT order_adjustments_adjustment_type_check
    CHECK (adjustment_type IN ('void', 'comp', 'price_override', 'manager_discount', 'refund'));

-- ======================
-- 2. ADD 'grn' TO stock_movements.movement_type
-- Original CHECK (from migration 2): ('purchase', 'sale', 'waste', 'adjustment')
-- New CHECK: ('purchase', 'sale', 'waste', 'adjustment', 'grn')
-- ======================

ALTER TABLE stock_movements
    DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_movement_type_check
    CHECK (movement_type IN ('purchase', 'sale', 'waste', 'adjustment', 'grn'));

-- ======================
-- 3. UPDATED_AT TRIGGERS FOR MIGRATION 16, 17, AND 25 TABLES
-- Trigger function: set_updated_at_now() (defined in migration 15).
-- Migration 29 already attached these triggers; the DROP/CREATE pattern
-- below is idempotent so re-running this migration is safe.
--
-- Tables WITHOUT updated_at (skipped):
--   migration 16: check_split_items (no updated_at column)
--   migration 25: gift_card_transactions, store_credit_transactions,
--                 house_account_charges, loyalty_transactions (all append-only)
-- ======================

-- -- Migration 16: dine-in tables. --
DROP TRIGGER IF EXISTS trg_sections_updated_at ON sections;
CREATE TRIGGER trg_sections_updated_at
    BEFORE UPDATE ON sections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_tables_updated_at ON "tables";
CREATE TRIGGER trg_tables_updated_at
    BEFORE UPDATE ON "tables"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_table_sessions_updated_at ON table_sessions;
CREATE TRIGGER trg_table_sessions_updated_at
    BEFORE UPDATE ON table_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_seats_updated_at ON seats;
CREATE TRIGGER trg_seats_updated_at
    BEFORE UPDATE ON seats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_check_splits_updated_at ON check_splits;
CREATE TRIGGER trg_check_splits_updated_at
    BEFORE UPDATE ON check_splits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- -- Migration 17: KDS. --
DROP TRIGGER IF EXISTS trg_kitchen_stations_updated_at ON kitchen_stations;
CREATE TRIGGER trg_kitchen_stations_updated_at
    BEFORE UPDATE ON kitchen_stations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_kds_tickets_updated_at ON kds_tickets;
CREATE TRIGGER trg_kds_tickets_updated_at
    BEFORE UPDATE ON kds_tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_kds_ticket_items_updated_at ON kds_ticket_items;
CREATE TRIGGER trg_kds_ticket_items_updated_at
    BEFORE UPDATE ON kds_ticket_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- -- Migration 25: gift cards / store credit / house accounts / loyalty. --
DROP TRIGGER IF EXISTS trg_gift_cards_updated_at ON gift_cards;
CREATE TRIGGER trg_gift_cards_updated_at
    BEFORE UPDATE ON gift_cards
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_store_credits_updated_at ON store_credits;
CREATE TRIGGER trg_store_credits_updated_at
    BEFORE UPDATE ON store_credits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_house_accounts_updated_at ON house_accounts;
CREATE TRIGGER trg_house_accounts_updated_at
    BEFORE UPDATE ON house_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_house_account_invoices_updated_at ON house_account_invoices;
CREATE TRIGGER trg_house_account_invoices_updated_at
    BEFORE UPDATE ON house_account_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_loyalty_config_updated_at ON loyalty_config;
CREATE TRIGGER trg_loyalty_config_updated_at
    BEFORE UPDATE ON loyalty_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

