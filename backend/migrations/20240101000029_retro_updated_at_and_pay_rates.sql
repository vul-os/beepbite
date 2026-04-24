-- ======================
-- RETROACTIVE updated_at TRIGGER ATTACHMENTS + STAFF PAY RATES
-- 1. Retroactively attach set_updated_at_now() to every table from migrations
--    16-25 that has updated_at but no trigger (earlier migrations left TODOs
--    because the helper was defined in migration 15 but not yet usable when
--    those migrations were being planned).
-- 2. staff_pay_rates: effective-dated rates unlocking labor $ reporting.
--
-- NOTE: approval-enforcement trigger and auto-86 trigger live in the
-- sibling migration 20240101000028_triggers_and_report_views.sql and are
-- NOT duplicated here.
-- ======================


-- ======================
-- 1. RETROACTIVE updated_at TRIGGER ATTACHMENTS
-- Every table below has an updated_at column but no trigger wiring it to
-- set_updated_at_now() (defined in migration 15). We attach them in one
-- hygiene pass. DROP TRIGGER IF EXISTS + CREATE makes re-runs idempotent.
-- ======================

-- -- From migration 2 (staff — predates the helper by a mile). --
DROP TRIGGER IF EXISTS trg_staff_updated_at ON staff;
CREATE TRIGGER trg_staff_updated_at
    BEFORE UPDATE ON staff
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

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

-- skipped item_station_routing: no updated_at
-- skipped kds_ticket_events: append-only, no updated_at

-- -- Migration 18: cash drawer + adjustments. --
DROP TRIGGER IF EXISTS trg_cash_drawers_updated_at ON cash_drawers;
CREATE TRIGGER trg_cash_drawers_updated_at
    BEFORE UPDATE ON cash_drawers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_cash_drawer_sessions_updated_at ON cash_drawer_sessions;
CREATE TRIGGER trg_cash_drawer_sessions_updated_at
    BEFORE UPDATE ON cash_drawer_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_adjustment_reasons_updated_at ON adjustment_reasons;
CREATE TRIGGER trg_adjustment_reasons_updated_at
    BEFORE UPDATE ON adjustment_reasons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- skipped order_adjustments: no updated_at (append-only audit row)
-- skipped cash_drawer_movements / cash_drawer_counts / cash_drawer_session_payments: append-only

-- -- Migration 19: promotions + coupons. --
DROP TRIGGER IF EXISTS trg_promotions_updated_at ON promotions;
CREATE TRIGGER trg_promotions_updated_at
    BEFORE UPDATE ON promotions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_coupon_codes_updated_at ON coupon_codes;
CREATE TRIGGER trg_coupon_codes_updated_at
    BEFORE UPDATE ON coupon_codes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- -- Migration 20: suppliers + purchasing. --
DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers;
CREATE TRIGGER trg_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_supplier_contacts_updated_at ON supplier_contacts;
CREATE TRIGGER trg_supplier_contacts_updated_at
    BEFORE UPDATE ON supplier_contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_supplier_locations_updated_at ON supplier_locations;
CREATE TRIGGER trg_supplier_locations_updated_at
    BEFORE UPDATE ON supplier_locations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_supplier_inventory_items_updated_at ON supplier_inventory_items;
CREATE TRIGGER trg_supplier_inventory_items_updated_at
    BEFORE UPDATE ON supplier_inventory_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_purchase_order_items_updated_at ON purchase_order_items;
CREATE TRIGGER trg_purchase_order_items_updated_at
    BEFORE UPDATE ON purchase_order_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_supplier_invoices_updated_at ON supplier_invoices;
CREATE TRIGGER trg_supplier_invoices_updated_at
    BEFORE UPDATE ON supplier_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- -- Migration 24: menu extensions. --
DROP TRIGGER IF EXISTS trg_allergens_updated_at ON allergens;
CREATE TRIGGER trg_allergens_updated_at
    BEFORE UPDATE ON allergens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_dietary_tags_updated_at ON dietary_tags;
CREATE TRIGGER trg_dietary_tags_updated_at
    BEFORE UPDATE ON dietary_tags
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_menu_schedules_updated_at ON menu_schedules;
CREATE TRIGGER trg_menu_schedules_updated_at
    BEFORE UPDATE ON menu_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_item_price_schedules_updated_at ON item_price_schedules;
CREATE TRIGGER trg_item_price_schedules_updated_at
    BEFORE UPDATE ON item_price_schedules
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

DROP TRIGGER IF EXISTS trg_house_account_members_updated_at ON house_account_members;
CREATE TRIGGER trg_house_account_members_updated_at
    BEFORE UPDATE ON house_account_members
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_house_account_invoices_updated_at ON house_account_invoices;
CREATE TRIGGER trg_house_account_invoices_updated_at
    BEFORE UPDATE ON house_account_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_loyalty_config_updated_at ON loyalty_config;
CREATE TRIGGER trg_loyalty_config_updated_at
    BEFORE UPDATE ON loyalty_config
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();


-- ======================
-- 2. staff_pay_rates
-- Effective-dated hourly/salary/commission rates. The labor_hours_daily
-- view already exists; these rates let us multiply hours * rate to get
-- labor cost in money for reporting.
--
-- Only one "current" rate (effective_until IS NULL) may exist per
-- (staff_id, rate_type). To end a rate, set effective_until to the last
-- day it applied and insert a new row with effective_from the next day.
-- ======================

CREATE TABLE staff_pay_rates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    rate_type text NOT NULL CHECK (rate_type IN ('hourly','salary_monthly','salary_annual','commission','per_shift')),
    -- All amounts in cents for consistency with payments.
    amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
    currency text NOT NULL DEFAULT 'ZAR',

    -- Commission-specific (only meaningful when rate_type='commission').
    commission_percentage decimal(6,3) CHECK (commission_percentage IS NULL OR commission_percentage >= 0),
    commission_basis text CHECK (commission_basis IN ('sales','orders','tips') OR commission_basis IS NULL),

    -- Overtime multipliers
    overtime_multiplier decimal(4,2) NOT NULL DEFAULT 1.5 CHECK (overtime_multiplier >= 1),
    overtime_threshold_hours_per_week decimal(5,2) DEFAULT 45,  -- SA BCEA default

    effective_from date NOT NULL,
    effective_until date,            -- NULL = current; only one rate active at a time per staff+rate_type

    notes text,
    created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

    CHECK (effective_until IS NULL OR effective_until >= effective_from)
);

CREATE INDEX idx_staff_pay_rates_staff ON staff_pay_rates(staff_id);
CREATE INDEX idx_staff_pay_rates_effective ON staff_pay_rates(staff_id, effective_from DESC);
-- Only one "current" rate (effective_until IS NULL) per (staff_id, rate_type).
CREATE UNIQUE INDEX one_current_rate_per_staff_and_type
    ON staff_pay_rates(staff_id, rate_type) WHERE effective_until IS NULL;

DROP TRIGGER IF EXISTS trg_staff_pay_rates_updated_at ON staff_pay_rates;
CREATE TRIGGER trg_staff_pay_rates_updated_at
    BEFORE UPDATE ON staff_pay_rates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();
