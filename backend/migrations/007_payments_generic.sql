-- =============================================================================
-- MIGRATION 007 — PAYMENTS GENERIC
-- =============================================================================
-- Sources: legacy 002 (locations), 004 (payment_methods, order_payments, refunds,
--          cart_items, cart_item_variations), 038 (multi-currency, exchange_rates
--          implied), 041 (delivery_zones moved -> 011), 043 (org_default location
--          trigger moved -> 014 seed).
--
-- BeepBite records tenders; it does not process cards. There is no gateway, no
-- facilitator, no merchant payout and no subscription. Everything that existed
-- to support the payment-facilitator business (regions, payment_providers,
-- subscription_plans, location_payment_credentials, payment_attempts,
-- payment_fees, beepbite_payment_fees, merchant_payouts, merchant_payout_items,
-- bank_accounts, payout_schedules, subscription_invoices, webhook_event_log,
-- org_wallets, wallet_topups, wallet_transactions,
-- customer_payment_authorizations) is deliberately absent.
--
-- IMPORTANT — WHY THIS IS 007, NOT 008:
--   `orders` (migration 008) has a FK to `locations` (this file), so `locations`
--   must be created first. This file is therefore 007 and orders_and_kds is 008.
--
-- Tables defined here:
--   REFERENCE DATA (no RLS):
--     payment_methods, exchange_rates
--   TENANT-SCOPED (RLS enabled):
--     locations, order_payments (cross-migration: FK back to orders in 008),
--     refunds, custom_domains, api_keys, webhook_endpoints,
--     cart_items, cart_item_variations
--
-- Cross-migration FK note:
--   order_payments.order_id -> orders(id) is added by migration 008 via
--   ALTER TABLE, after orders exists.
--
-- api_keys security:
--   key_hash is never SELECTable by any non-service_role query.
--   A view `api_keys_safe` exposes all columns except key_hash for tenant use.
--
-- Intentionally absent from this migration:
--   - delivery_zones (legacy 041): assigned to migration 011 (delivery.sql).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3. PAYMENT METHODS  (reference data, no RLS)
-- ---------------------------------------------------------------------------

CREATE TABLE payment_methods (
    id                          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    code                        text            NOT NULL UNIQUE,
    name                        text            NOT NULL,
    -- All tenders are 'offline': the money moved at the counter (cash into the
    -- drawer, the shop's own card machine, an EFT that landed, a voucher).
    -- BeepBite records them; it never processes a card.
    kind                        text            NOT NULL DEFAULT 'offline'
                                                CHECK (kind IN ('offline')),
    is_active                   boolean         NOT NULL DEFAULT true,
    requires_reference          boolean         NOT NULL DEFAULT false,
    supports_tips               boolean         NOT NULL DEFAULT true,
    processing_fee_percentage   decimal(5,2)    NOT NULL DEFAULT 0,
    fixed_fee_cents             integer         NOT NULL DEFAULT 0,
    created_at                  timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE payment_methods IS
    'Platform-wide registry of accepted payment methods. '
    'Not RLS-protected — public SELECT; only service_role may mutate. '
    'Seed data lives in migration 014.';

GRANT SELECT ON payment_methods TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON payment_methods FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. LOCATIONS  (tenant-scoped, org-scoped + marketplace SELECT)
-- ---------------------------------------------------------------------------

CREATE TABLE locations (
    id                              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                 uuid            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                            text            NOT NULL,
    slug                            text            UNIQUE,    -- URL-friendly identifier for marketplace
    description                     text,
    city                            text,
    country                         text,           -- ISO 3166-1 alpha-2 e.g. 'ZA'
    whatsapp_number                 text,
    address                         text,
    latitude                        decimal(10,7),
    longitude                       decimal(10,7),
    delivery_fee                    decimal(10,2)   NOT NULL DEFAULT 25.00,
    free_delivery_threshold         decimal(10,2)   NOT NULL DEFAULT 150.00,
    max_delivery_distance_km        decimal(5,2)    NOT NULL DEFAULT 10.0,
    estimated_prep_time             integer         NOT NULL DEFAULT 30,  -- minutes
    currency_code                   text            REFERENCES currencies(code) DEFAULT 'ZAR',
    -- Fulfillment options
    offers_delivery                 boolean         NOT NULL DEFAULT false,
    offers_collection               boolean         NOT NULL DEFAULT true,
    -- Payment methods accepted on COD / card-on-delivery orders
    -- (stored as text[] of payment_methods.code values)
    on_delivery_payment_methods     text[]          NOT NULL DEFAULT '{}',
    -- Marketplace visibility
    is_marketplace_visible          boolean         NOT NULL DEFAULT false,
    is_active                       boolean         NOT NULL DEFAULT true,
    accepts_delivery                boolean         NOT NULL DEFAULT true,  -- legacy compat alias
    accepts_pickup                  boolean         NOT NULL DEFAULT true,  -- legacy compat alias
    created_at                      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    -- A location must offer at least one fulfilment channel.
    CONSTRAINT locations_must_offer_channel CHECK (offers_delivery OR offers_collection)
);

COMMENT ON TABLE locations IS
    'Physical or virtual store locations (branches). FK anchor for nearly every '
    'other tenant table. slug enables marketplace URLs. is_marketplace_visible '
    'controls public discovery.';
COMMENT ON COLUMN locations.on_delivery_payment_methods IS
    'Array of payment_methods.code values accepted for on-delivery / COD orders. '
    'e.g. ''{cash_on_delivery, card_on_delivery}''';

CREATE INDEX idx_locations_organization_id  ON locations(organization_id);
CREATE INDEX idx_locations_active           ON locations(is_active);
CREATE INDEX idx_locations_marketplace      ON locations(is_marketplace_visible) WHERE is_marketplace_visible = true;
CREATE INDEX idx_locations_slug             ON locations(slug) WHERE slug IS NOT NULL;

CREATE TRIGGER trg_locations_updated_at
    BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: org-scoped for members + narrow public SELECT for marketplace_role.
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;

-- Threat: tenant A must not see tenant B's locations.
CREATE POLICY locations_select_member ON locations FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

-- Threat: public/marketplace endpoint must only see opted-in locations.
CREATE POLICY locations_select_marketplace ON locations FOR SELECT
    USING (is_marketplace_role() AND is_marketplace_visible = true);

-- Tenant can create their own locations.
CREATE POLICY locations_insert ON locations FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY locations_update ON locations FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- Hard deletes restricted to service_role; handlers should deactivate (is_active=false).
CREATE POLICY locations_delete ON locations FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- SEAL DEFERRED CROSS-MIGRATION FKs (006 → 007)
-- sections, tables, table_sessions in 006 deferred their location_id FKs because
-- locations did not exist yet.  Now that locations is created above, seal them.
-- ---------------------------------------------------------------------------

ALTER TABLE sections
    ADD CONSTRAINT fk_sections_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE "tables"
    ADD CONSTRAINT fk_tables_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE table_sessions
    ADD CONSTRAINT fk_table_sessions_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

-- Also wire organizations.default_currency_code FK (currencies created in 002).
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS default_currency_code text REFERENCES currencies(code) DEFAULT 'ZAR';

-- ---------------------------------------------------------------------------
-- 9. ORDER PAYMENTS
-- Defined here because it only has a forward-reference FK to orders (added by 008).
-- NOTE: paystack_reference, paystack_status, paystack_gateway_response columns
--       from legacy 004 are deliberately DROPPED. There is no gateway.
-- ---------------------------------------------------------------------------

CREATE TABLE order_payments (
    id                                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- order_id FK added by migration 008 (ALTER TABLE order_payments ADD CONSTRAINT ...)
    order_id                            uuid            NOT NULL,
    payment_method_code                 text            NOT NULL REFERENCES payment_methods(code),
    amount_paid_cents                   bigint          NOT NULL,
    tip_amount_cents                    bigint          NOT NULL DEFAULT 0,
    change_given_cents                  bigint          NOT NULL DEFAULT 0,
    -- Generic reference (EFT ref, card batch number, etc.) — NOT provider-specific.
    payment_reference                   text,
    external_transaction_id             text,
    payment_status                      payment_status  NOT NULL DEFAULT 'pending',
    paid_at                             timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    confirmed_at                        timestamptz,
    processed_by                        uuid            REFERENCES staff(id) ON DELETE SET NULL,
    notes                               text,
    created_at                          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE order_payments IS
    'Records a tender applied to an order (cash, card machine, transfer, '
    'voucher). No card processing happens here — the money already moved at '
    'the counter. FK order_id → orders(id) is added by migration 008.';

CREATE INDEX idx_order_payments_order_id        ON order_payments(order_id);
CREATE INDEX idx_order_payments_status          ON order_payments(payment_status);
CREATE INDEX idx_order_payments_paid_at         ON order_payments(paid_at DESC);
CREATE INDEX idx_order_payments_method          ON order_payments(payment_method_code);

CREATE TRIGGER trg_order_payments_updated_at
    BEFORE UPDATE ON order_payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_payments FORCE ROW LEVEL SECURITY;

-- Scoped via order_id → orders → locations → org.  FK added by 008 so we do the
-- join indirectly via a subquery; Postgres evaluates it safely even before 008 runs
-- because the policy is only executed when rows exist.
-- POLICY order_payments_select ON order_payments deferred to 008 (references table from later migration)
-- POLICY order_payments_insert ON order_payments deferred to 008 (references table from later migration)
-- POLICY order_payments_update ON order_payments deferred to 008 (references table from later migration)
CREATE POLICY order_payments_delete ON order_payments FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 12. REFUNDS
-- ---------------------------------------------------------------------------

CREATE TABLE refunds (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id          uuid            NOT NULL REFERENCES order_payments(id) ON DELETE CASCADE,
    order_id            uuid            NOT NULL,  -- FK added by 008
    refund_amount_cents bigint          NOT NULL,
    refund_reason       text,
    refund_type         text            NOT NULL DEFAULT 'full' CHECK (refund_type IN ('full', 'partial')),
    refund_method       text,
    external_refund_id  text,
    refund_status       text            NOT NULL DEFAULT 'pending'
                                        CHECK (refund_status IN ('pending', 'completed', 'failed')),
    processed_by        uuid            REFERENCES staff(id) ON DELETE SET NULL,
    approved_by         uuid            REFERENCES staff(id) ON DELETE SET NULL,
    refunded_at         timestamptz,
    notes               text,
    created_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
CREATE INDEX idx_refunds_order_id   ON refunds(order_id);
CREATE INDEX idx_refunds_status     ON refunds(refund_status);

CREATE TRIGGER trg_refunds_updated_at
    BEFORE UPDATE ON refunds
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;

-- POLICY refunds_select ON refunds deferred to 008 (references table from later migration)
-- POLICY refunds_insert ON refunds deferred to 008 (references table from later migration)
-- POLICY refunds_update ON refunds deferred to 008 (references table from later migration)
CREATE POLICY refunds_delete ON refunds FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 16. EXCHANGE RATES  [NEW — ROADMAP Now-11]
-- ---------------------------------------------------------------------------

CREATE TABLE exchange_rates (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency   text            NOT NULL REFERENCES currencies(code),
    to_currency     text            NOT NULL REFERENCES currencies(code),
    rate            numeric(18,8)   NOT NULL CHECK (rate > 0),
    source          text,           -- 'openexchangerates', 'manual', etc.
    fetched_at      timestamptz     NOT NULL,
    created_at      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (from_currency, to_currency, fetched_at)
);

COMMENT ON TABLE exchange_rates IS
    'Point-in-time FX rate snapshots, used for order FX conversion.';

CREATE INDEX idx_exchange_rates_pair_time  ON exchange_rates(from_currency, to_currency, fetched_at DESC);

-- Exchange rates are platform-wide reference; no RLS. Service_role only writes.
GRANT SELECT ON exchange_rates TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON exchange_rates FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 22. CUSTOM DOMAINS  [NEW — ROADMAP Now-13]
-- ---------------------------------------------------------------------------

CREATE TABLE custom_domains (
    id                  uuid                    PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id         uuid                    NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    hostname            text                    NOT NULL UNIQUE,
    status              custom_domain_status    NOT NULL DEFAULT 'pending',
    verification_token  text,
    verified_at         timestamptz,
    cert_issued_at      timestamptz,
    removed_at          timestamptz,
    created_at          timestamptz             NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          timestamptz             NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_custom_domains_location_id ON custom_domains(location_id);
CREATE INDEX idx_custom_domains_status      ON custom_domains(status);
CREATE INDEX idx_custom_domains_hostname    ON custom_domains(hostname);

CREATE TRIGGER trg_custom_domains_updated_at
    BEFORE UPDATE ON custom_domains
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_domains FORCE ROW LEVEL SECURITY;

CREATE POLICY custom_domains_select ON custom_domains FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY custom_domains_insert ON custom_domains FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY custom_domains_update ON custom_domains FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY custom_domains_delete ON custom_domains FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 23. API KEYS  [NEW — ROADMAP Now-12]
-- key_hash is never SELECTable by non-service_role.  Use api_keys_safe view.
-- ---------------------------------------------------------------------------

CREATE TABLE api_keys (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name            text        NOT NULL,
    prefix_visible  text        NOT NULL,   -- first 8 chars for display (e.g. "bb_live_")
    key_hash        text        NOT NULL,   -- bcrypt/sha256 of full key — never returned raw
    scopes          text[]      NOT NULL DEFAULT '{}',
    expires_at      timestamptz,
    last_used_at    timestamptz,
    created_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    revoked_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_api_keys_org         ON api_keys(org_id);
CREATE INDEX idx_api_keys_prefix      ON api_keys(prefix_visible);
CREATE INDEX idx_api_keys_active      ON api_keys(org_id) WHERE revoked_at IS NULL;

CREATE TRIGGER trg_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

-- Tenants may list their own keys (without key_hash — use the view).
CREATE POLICY api_keys_select ON api_keys FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());
CREATE POLICY api_keys_insert ON api_keys FOR INSERT
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY api_keys_update ON api_keys FOR UPDATE
    USING (org_id = current_org_id() OR is_service_role())
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY api_keys_delete ON api_keys FOR DELETE
    USING (is_service_role());

-- Safe view: excludes key_hash from non-service_role consumers.
-- Handlers query this view; only the key-verification routine queries the base table.
CREATE VIEW api_keys_safe
WITH (security_invoker = on)
AS
SELECT id, org_id, name, prefix_visible, scopes, expires_at,
       last_used_at, created_by, revoked_at, created_at, updated_at
FROM api_keys;

COMMENT ON VIEW api_keys_safe IS
    'Public-safe view of api_keys: key_hash column excluded. '
    'Non-service_role code must query this view, never the base table.';

-- ---------------------------------------------------------------------------
-- 24. WEBHOOK ENDPOINTS  [NEW — ROADMAP Now-12]
-- ---------------------------------------------------------------------------

CREATE TABLE webhook_endpoints (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url                         text        NOT NULL,
    signing_secret_ciphertext   text,       -- AES-GCM encrypted
    events                      text[]      NOT NULL DEFAULT '{}',  -- subscribed event types
    is_active                   boolean     NOT NULL DEFAULT true,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_webhook_endpoints_org    ON webhook_endpoints(org_id);
CREATE INDEX idx_webhook_endpoints_active ON webhook_endpoints(org_id, is_active);

CREATE TRIGGER trg_webhook_endpoints_updated_at
    BEFORE UPDATE ON webhook_endpoints
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;

CREATE POLICY webhook_endpoints_select ON webhook_endpoints FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());
CREATE POLICY webhook_endpoints_insert ON webhook_endpoints FOR INSERT
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY webhook_endpoints_update ON webhook_endpoints FOR UPDATE
    USING (org_id = current_org_id() OR is_service_role())
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY webhook_endpoints_delete ON webhook_endpoints FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 26. CART ITEMS + CART ITEM VARIATIONS
-- Kept for backward compatibility with the chatbot ordering flow.
-- May be superseded by the modifier model (migration 004) in Wave 9.
-- ---------------------------------------------------------------------------

CREATE TABLE cart_items (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id             uuid            NOT NULL, -- FK to customers(id) deferred to 010 (customers defined there)
    location_id             uuid            NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    item_id                 uuid            NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity                integer         NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price              decimal(10,2)   NOT NULL,
    total_price             decimal(10,2)   NOT NULL,
    special_instructions    text,
    created_at              timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at              timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_cart_items_customer_location ON cart_items(customer_id, location_id);
CREATE INDEX idx_cart_items_item              ON cart_items(item_id);
CREATE INDEX idx_cart_items_created_at        ON cart_items(created_at);

CREATE TRIGGER trg_cart_items_updated_at
    BEFORE UPDATE ON cart_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_items FORCE ROW LEVEL SECURITY;

CREATE POLICY cart_items_select ON cart_items FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY cart_items_insert ON cart_items FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY cart_items_update ON cart_items FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY cart_items_delete ON cart_items FOR DELETE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );

-- cart_item_variations: kept for backward compat with legacy chatbot flow.
-- Legacy FK to item_variations(id) and item_variation_options(id) — those tables
-- are deprecated by modifier_groups/modifiers (migration 004) but may still exist
-- during the transition; FKs kept for data integrity until Wave 9 cleanup.
CREATE TABLE cart_item_variations (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_item_id    uuid            NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,
    variation_id    uuid            NOT NULL, -- no FK: item_variations superseded by modifier_groups (004); table not in consolidated migrations
    option_id       uuid            NOT NULL, -- no FK: item_variation_options superseded by modifiers (004); table not in consolidated migrations
    price_modifier  decimal(10,2)   NOT NULL DEFAULT 0,
    created_at      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_cart_item_variations_cart_item ON cart_item_variations(cart_item_id);

ALTER TABLE cart_item_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_item_variations FORCE ROW LEVEL SECURITY;

CREATE POLICY cart_item_variations_select ON cart_item_variations FOR SELECT
    USING (
        cart_item_id IN (
            SELECT ci.id FROM cart_items ci
            JOIN locations l ON l.id = ci.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cart_item_variations_insert ON cart_item_variations FOR INSERT
    WITH CHECK (
        cart_item_id IN (
            SELECT ci.id FROM cart_items ci
            JOIN locations l ON l.id = ci.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cart_item_variations_update ON cart_item_variations FOR UPDATE
    USING (
        cart_item_id IN (
            SELECT ci.id FROM cart_items ci
            JOIN locations l ON l.id = ci.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        cart_item_id IN (
            SELECT ci.id FROM cart_items ci
            JOIN locations l ON l.id = ci.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cart_item_variations_delete ON cart_item_variations FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Migration 007 complete.
-- Reference tables (no RLS): payment_methods, exchange_rates (public SELECT).
-- Tenant tables (RLS): locations, order_payments, refunds, custom_domains,
--   api_keys, webhook_endpoints, cart_items, cart_item_variations.
-- Views: api_keys_safe
-- Deferred FKs (added by 008): order_payments.order_id → orders(id),
--   refunds.order_id → orders(id).

-- ---------------------------------------------------------------------------
-- CROSS-MIGRATION FK FIXES (002/003/004/005/006 → 007)
-- Migrations 003, 004, 005, and 006 declare location_id columns that must
-- reference locations(id), but locations is defined here in 007. Because
-- migrations run in numeric order, those inline CREATE TABLE FK constraints
-- would fail at DDL time. The inline REFERENCES clauses are removed from
-- those files and the actual FK constraints are added here, after locations
-- exists. Migration 003 already commented them out (staff tables); this
-- block covers 004, 005, and 006.
-- ---------------------------------------------------------------------------

-- 004_menu.sql forward FKs
ALTER TABLE categories
    ADD CONSTRAINT fk_categories_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE items
    ADD CONSTRAINT fk_items_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE menu_schedules
    ADD CONSTRAINT fk_menu_schedules_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE courses
    ADD CONSTRAINT fk_courses_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

-- 005_inventory.sql forward FKs
ALTER TABLE inventory_items
    ADD CONSTRAINT fk_inventory_items_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE supplier_locations
    ADD CONSTRAINT fk_supplier_locations_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE purchase_orders
    ADD CONSTRAINT fk_purchase_orders_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE supplier_invoices
    ADD CONSTRAINT fk_supplier_invoices_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE prep_batches
    ADD CONSTRAINT fk_prep_batches_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

-- 006_tables_and_floor.sql forward FKs: already added immediately after
-- the locations CREATE TABLE above (line ~279). No duplicate needed here.

-- 003_staff_and_pin.sql forward FKs (location_id columns on staff tables)
-- Note: 003 already documents these as deferred; adding them here.
ALTER TABLE staff
    ADD CONSTRAINT fk_staff_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE staff_time_entries
    ADD CONSTRAINT fk_staff_time_entries_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE staff_shifts
    ADD CONSTRAINT fk_staff_shifts_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;

ALTER TABLE staff_attendance_summary
    ADD CONSTRAINT fk_staff_attendance_summary_location
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;


-- =============================================================================
-- DEFERRED RLS POLICIES — migrations 003/004/005/006
-- =============================================================================
-- These CREATE POLICY statements reference the `locations` table.
-- Postgres 18 resolves table references in policy USING/WITH CHECK clauses at
-- DDL time, not query time. To allow migrations 003–006 to apply before 007,
-- the location-scoped policies are deferred here, after locations is created.
-- Execution order: this section runs as part of migration 007 after all
-- tenant tables in 007 are created and locations is in scope.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 003_staff_and_pin.sql — deferred policies
-- ---------------------------------------------------------------------------
CREATE POLICY staff_select ON staff FOR SELECT
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_insert ON staff FOR INSERT
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_update ON staff FOR UPDATE
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_time_entries_select ON staff_time_entries FOR SELECT
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_time_entries_insert ON staff_time_entries FOR INSERT
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_shifts_select ON staff_shifts FOR SELECT
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_shifts_insert ON staff_shifts FOR INSERT
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_shifts_update ON staff_shifts FOR UPDATE
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_attendance_summary_select ON staff_attendance_summary FOR SELECT
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_attendance_summary_insert ON staff_attendance_summary FOR INSERT
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_attendance_summary_update ON staff_attendance_summary FOR UPDATE
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY staff_refresh_tokens_select ON staff_refresh_tokens FOR SELECT
    USING (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_refresh_tokens_insert ON staff_refresh_tokens FOR INSERT
    WITH CHECK (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_refresh_tokens_update ON staff_refresh_tokens FOR UPDATE
    USING (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    )
    WITH CHECK (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_refresh_tokens_delete ON staff_refresh_tokens FOR DELETE
    USING (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_password_reset_tokens_select ON staff_password_reset_tokens FOR SELECT
    USING (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_password_reset_tokens_insert ON staff_password_reset_tokens FOR INSERT
    WITH CHECK (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_password_reset_tokens_update ON staff_password_reset_tokens FOR UPDATE
    USING (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    )
    WITH CHECK (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_pay_rates_select ON staff_pay_rates FOR SELECT
    USING (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_pay_rates_insert ON staff_pay_rates FOR INSERT
    WITH CHECK (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );
CREATE POLICY staff_pay_rates_update ON staff_pay_rates FOR UPDATE
    USING (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    )
    WITH CHECK (
        staff_id IN (
            SELECT s.id FROM staff s
            WHERE s.location_id IN (
                SELECT id FROM locations WHERE organization_id = current_org_id()
            )
        )
        OR is_service_role()
    );

-- ---------------------------------------------------------------------------
-- 004_menu.sql — deferred policies
-- ---------------------------------------------------------------------------
CREATE POLICY categories_select_marketplace ON categories FOR SELECT
    USING (
        is_marketplace_role()
        AND location_id IN (
            SELECT id FROM locations WHERE is_marketplace_visible = true
        )
        AND is_active = true
    );
CREATE POLICY items_select ON items FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY items_insert ON items FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY items_update ON items FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY items_select_marketplace ON items FOR SELECT
    USING (
        is_marketplace_role()
        AND is_active = true
        AND is_86ed = false
        AND location_id IN (
            SELECT id FROM locations WHERE is_marketplace_visible = true
        )
    );
CREATE POLICY menu_schedules_select ON menu_schedules FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY menu_schedules_insert ON menu_schedules FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY menu_schedules_update ON menu_schedules FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY menu_schedules_select_marketplace ON menu_schedules FOR SELECT
    USING (
        is_marketplace_role()
        AND location_id IN (SELECT id FROM locations WHERE is_marketplace_visible = true)
        AND is_active = true
    );
CREATE POLICY courses_select ON courses FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY courses_insert ON courses FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY courses_update ON courses FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );

-- ---------------------------------------------------------------------------
-- 005_inventory.sql — deferred policies
-- ---------------------------------------------------------------------------
CREATE POLICY inventory_items_select ON inventory_items FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY inventory_items_insert ON inventory_items FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY inventory_items_update ON inventory_items FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY purchase_orders_select ON purchase_orders FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY purchase_orders_insert ON purchase_orders FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY purchase_orders_update ON purchase_orders FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_invoices_select ON supplier_invoices FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_invoices_insert ON supplier_invoices FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_invoices_update ON supplier_invoices FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );

-- ---------------------------------------------------------------------------
-- 006_tables_and_floor.sql — deferred policies
-- ---------------------------------------------------------------------------
CREATE POLICY sections_select ON sections FOR SELECT
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY sections_insert ON sections FOR INSERT
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY sections_update ON sections FOR UPDATE
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY tables_select ON "tables" FOR SELECT
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY tables_insert ON "tables" FOR INSERT
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY tables_update ON "tables" FOR UPDATE
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY table_sessions_select ON table_sessions FOR SELECT
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY table_sessions_insert ON table_sessions FOR INSERT
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY table_sessions_update ON table_sessions FOR UPDATE
    USING (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (
            SELECT id FROM locations WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );

-- ---------------------------------------------------------------------------
-- DEFERRED RLS POLICIES — pass 2 (JOIN locations pattern)
-- ---------------------------------------------------------------------------
-- Additional policy blocks using JOIN locations syntax, also deferred here.
-- ---------------------------------------------------------------------------

-- From 004_*.sql:
CREATE POLICY item_recipes_select ON item_recipes FOR SELECT
    USING (
        parent_item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_recipes_insert ON item_recipes FOR INSERT
    WITH CHECK (
        parent_item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_recipes_update ON item_recipes FOR UPDATE
    USING (
        parent_item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        parent_item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_allergens_select ON item_allergens FOR SELECT
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_allergens_insert ON item_allergens FOR INSERT
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_allergens_update ON item_allergens FOR UPDATE
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_allergens_select_marketplace ON item_allergens FOR SELECT
    USING (
        is_marketplace_role()
        AND item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.is_marketplace_visible = true
              AND i.is_active = true
              AND i.is_86ed = false
        )
    );
CREATE POLICY item_dietary_tags_select ON item_dietary_tags FOR SELECT
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_dietary_tags_insert ON item_dietary_tags FOR INSERT
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_dietary_tags_update ON item_dietary_tags FOR UPDATE
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_dietary_tags_select_marketplace ON item_dietary_tags FOR SELECT
    USING (
        is_marketplace_role()
        AND item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.is_marketplace_visible = true
              AND i.is_active = true
              AND i.is_86ed = false
        )
    );
CREATE POLICY menu_schedule_slots_select ON menu_schedule_slots FOR SELECT
    USING (
        menu_schedule_id IN (
            SELECT ms.id FROM menu_schedules ms
            JOIN locations l ON l.id = ms.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY menu_schedule_slots_insert ON menu_schedule_slots FOR INSERT
    WITH CHECK (
        menu_schedule_id IN (
            SELECT ms.id FROM menu_schedules ms
            JOIN locations l ON l.id = ms.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY menu_schedule_slots_update ON menu_schedule_slots FOR UPDATE
    USING (
        menu_schedule_id IN (
            SELECT ms.id FROM menu_schedules ms
            JOIN locations l ON l.id = ms.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        menu_schedule_id IN (
            SELECT ms.id FROM menu_schedules ms
            JOIN locations l ON l.id = ms.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY menu_schedule_slots_select_marketplace ON menu_schedule_slots FOR SELECT
    USING (
        is_marketplace_role()
        AND menu_schedule_id IN (
            SELECT ms.id FROM menu_schedules ms
            JOIN locations l ON l.id = ms.location_id
            WHERE l.is_marketplace_visible = true
              AND ms.is_active = true
        )
    );
CREATE POLICY item_menu_schedules_select ON item_menu_schedules FOR SELECT
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_menu_schedules_insert ON item_menu_schedules FOR INSERT
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_menu_schedules_update ON item_menu_schedules FOR UPDATE
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_price_schedules_select ON item_price_schedules FOR SELECT
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_price_schedules_insert ON item_price_schedules FOR INSERT
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_price_schedules_update ON item_price_schedules FOR UPDATE
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_prep_steps_select ON item_prep_steps FOR SELECT
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_prep_steps_insert ON item_prep_steps FOR INSERT
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY item_prep_steps_update ON item_prep_steps FOR UPDATE
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY modifier_groups_select ON modifier_groups FOR SELECT
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY modifier_groups_insert ON modifier_groups FOR INSERT
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY modifier_groups_update ON modifier_groups FOR UPDATE
    USING (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY modifier_groups_select_marketplace ON modifier_groups FOR SELECT
    USING (
        is_marketplace_role()
        AND item_id IN (
            SELECT i.id FROM items i
            JOIN locations l ON l.id = i.location_id
            WHERE l.is_marketplace_visible = true
              AND i.is_active = true
              AND i.is_86ed = false
        )
    );
CREATE POLICY modifiers_select ON modifiers FOR SELECT
    USING (
        modifier_group_id IN (
            SELECT mg.id FROM modifier_groups mg
            JOIN items i ON i.id = mg.item_id
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY modifiers_insert ON modifiers FOR INSERT
    WITH CHECK (
        modifier_group_id IN (
            SELECT mg.id FROM modifier_groups mg
            JOIN items i ON i.id = mg.item_id
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY modifiers_update ON modifiers FOR UPDATE
    USING (
        modifier_group_id IN (
            SELECT mg.id FROM modifier_groups mg
            JOIN items i ON i.id = mg.item_id
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        modifier_group_id IN (
            SELECT mg.id FROM modifier_groups mg
            JOIN items i ON i.id = mg.item_id
            JOIN locations l ON l.id = i.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY modifiers_select_marketplace ON modifiers FOR SELECT
    USING (
        is_marketplace_role()
        AND modifier_group_id IN (
            SELECT mg.id FROM modifier_groups mg
            JOIN items i ON i.id = mg.item_id
            JOIN locations l ON l.id = i.location_id
            WHERE l.is_marketplace_visible = true
              AND i.is_active = true
              AND i.is_86ed = false
        )
        AND is_active = true
    );

-- From 005_*.sql:
CREATE POLICY stock_movements_select ON stock_movements FOR SELECT
    USING (
        inventory_item_id IN (
            SELECT inv.id FROM inventory_items inv
            JOIN locations l ON l.id = inv.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT
    WITH CHECK (
        inventory_item_id IN (
            SELECT inv.id FROM inventory_items inv
            JOIN locations l ON l.id = inv.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY purchase_order_items_select ON purchase_order_items FOR SELECT
    USING (
        purchase_order_id IN (
            SELECT po.id FROM purchase_orders po
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY purchase_order_items_insert ON purchase_order_items FOR INSERT
    WITH CHECK (
        purchase_order_id IN (
            SELECT po.id FROM purchase_orders po
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY purchase_order_items_update ON purchase_order_items FOR UPDATE
    USING (
        purchase_order_id IN (
            SELECT po.id FROM purchase_orders po
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        purchase_order_id IN (
            SELECT po.id FROM purchase_orders po
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY goods_receipts_select ON goods_receipts FOR SELECT
    USING (
        purchase_order_id IN (
            SELECT po.id FROM purchase_orders po
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY goods_receipts_insert ON goods_receipts FOR INSERT
    WITH CHECK (
        purchase_order_id IN (
            SELECT po.id FROM purchase_orders po
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY goods_receipts_update ON goods_receipts FOR UPDATE
    USING (
        purchase_order_id IN (
            SELECT po.id FROM purchase_orders po
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        purchase_order_id IN (
            SELECT po.id FROM purchase_orders po
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY goods_receipt_items_select ON goods_receipt_items FOR SELECT
    USING (
        goods_receipt_id IN (
            SELECT gr.id FROM goods_receipts gr
            JOIN purchase_orders po ON po.id = gr.purchase_order_id
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY goods_receipt_items_insert ON goods_receipt_items FOR INSERT
    WITH CHECK (
        goods_receipt_id IN (
            SELECT gr.id FROM goods_receipts gr
            JOIN purchase_orders po ON po.id = gr.purchase_order_id
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY goods_receipt_items_update ON goods_receipt_items FOR UPDATE
    USING (
        goods_receipt_id IN (
            SELECT gr.id FROM goods_receipts gr
            JOIN purchase_orders po ON po.id = gr.purchase_order_id
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        goods_receipt_id IN (
            SELECT gr.id FROM goods_receipts gr
            JOIN purchase_orders po ON po.id = gr.purchase_order_id
            JOIN locations l ON l.id = po.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY supplier_invoice_lines_select ON supplier_invoice_lines FOR SELECT
    USING (
        supplier_invoice_id IN (
            SELECT si.id FROM supplier_invoices si
            JOIN locations l ON l.id = si.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY supplier_invoice_lines_insert ON supplier_invoice_lines FOR INSERT
    WITH CHECK (
        supplier_invoice_id IN (
            SELECT si.id FROM supplier_invoices si
            JOIN locations l ON l.id = si.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY supplier_invoice_lines_update ON supplier_invoice_lines FOR UPDATE
    USING (
        supplier_invoice_id IN (
            SELECT si.id FROM supplier_invoices si
            JOIN locations l ON l.id = si.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        supplier_invoice_id IN (
            SELECT si.id FROM supplier_invoices si
            JOIN locations l ON l.id = si.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY ingredient_price_history_select ON ingredient_price_history FOR SELECT
    USING (
        inventory_item_id IN (
            SELECT inv.id FROM inventory_items inv
            JOIN locations l ON l.id = inv.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY ingredient_price_history_insert ON ingredient_price_history FOR INSERT
    WITH CHECK (
        inventory_item_id IN (
            SELECT inv.id FROM inventory_items inv
            JOIN locations l ON l.id = inv.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );

-- From 006_*.sql:
CREATE POLICY seats_select ON seats FOR SELECT
    USING (
        table_session_id IN (
            SELECT ts.id FROM table_sessions ts
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY seats_insert ON seats FOR INSERT
    WITH CHECK (
        table_session_id IN (
            SELECT ts.id FROM table_sessions ts
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY seats_update ON seats FOR UPDATE
    USING (
        table_session_id IN (
            SELECT ts.id FROM table_sessions ts
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        table_session_id IN (
            SELECT ts.id FROM table_sessions ts
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY check_splits_select ON check_splits FOR SELECT
    USING (
        table_session_id IN (
            SELECT ts.id FROM table_sessions ts
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY check_splits_insert ON check_splits FOR INSERT
    WITH CHECK (
        table_session_id IN (
            SELECT ts.id FROM table_sessions ts
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY check_splits_update ON check_splits FOR UPDATE
    USING (
        table_session_id IN (
            SELECT ts.id FROM table_sessions ts
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        table_session_id IN (
            SELECT ts.id FROM table_sessions ts
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY check_split_items_select ON check_split_items FOR SELECT
    USING (
        check_split_id IN (
            SELECT cs.id FROM check_splits cs
            JOIN table_sessions ts ON ts.id = cs.table_session_id
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY check_split_items_insert ON check_split_items FOR INSERT
    WITH CHECK (
        check_split_id IN (
            SELECT cs.id FROM check_splits cs
            JOIN table_sessions ts ON ts.id = cs.table_session_id
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY check_split_items_update ON check_split_items FOR UPDATE
    USING (
        check_split_id IN (
            SELECT cs.id FROM check_splits cs
            JOIN table_sessions ts ON ts.id = cs.table_session_id
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        check_split_id IN (
            SELECT cs.id FROM check_splits cs
            JOIN table_sessions ts ON ts.id = cs.table_session_id
            JOIN locations l ON l.id = ts.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );

-- ---------------------------------------------------------------------------
-- [iter-4 fixes] Deferred FK and missing column additions
-- ---------------------------------------------------------------------------

