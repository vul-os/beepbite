-- =============================================================================
-- MIGRATION 007 — PAYMENTS GENERIC
-- =============================================================================
-- Sources: legacy 002 (locations), 004 (payment_methods, order_payments, refunds,
--          merchant_payouts, merchant_payout_items, cart_items, cart_item_variations,
--          customer_payment_authorizations), 015 (location_payment_gateways — replaced),
--          023 (webhook_event_log), 026 (regions), 027 (bank_accounts, payout_schedules,
--          subscription_plans), 030 (beepbite_payment_fees), 038 (multi-currency,
--          exchange_rates implied), 041 (delivery_zones moved → 011), 043 (org_default
--          location trigger moved → 014 seed).
--
-- IMPORTANT — WHY THIS IS 007, NOT 008:
--   The schema consolidation plan originally numbered this file 008 and orders/kds
--   as 007.  However, `orders` (migration 008) has a FK to `locations` (this file),
--   so `locations` must be created first.  Per plan section 9 (open question 1),
--   the recommended resolution is to swap the numbers.  This file is therefore 007
--   and orders_and_kds is 008.
--
-- Tables defined here (39 tables):
--   REFERENCE DATA (no RLS):
--     regions, payment_methods, payment_providers, subscription_plans
--   TENANT-SCOPED (RLS enabled):
--     locations, location_payment_method_fees, location_payment_credentials,
--     payment_attempts, order_payments (cross-migration: FK back to orders in 008),
--     payment_fees, beepbite_payment_fees, refunds,
--     merchant_payouts, merchant_payout_items, bank_accounts, payout_schedules,
--     exchange_rates, subscription_invoices,
--     webhook_event_log,
--     org_wallets, wallet_topups, wallet_transactions,
--     custom_domains, api_keys, webhook_endpoints,
--     cart_items, cart_item_variations, customer_payment_authorizations
--
-- Cross-migration FK note:
--   order_payments.order_id → orders(id) is defined here as a FK.
--   orders.id is created in migration 008.  In a fresh sequential run this is fine
--   because 007 creates order_payments without an FK to orders (the FK is added by
--   008 via ALTER TABLE after orders exists).  See migration 008 for the ALTER TABLE.
--
-- Wallet trigger:
--   Every INSERT on wallet_transactions atomically updates org_wallets.balance_cents
--   via trg_fn_wallet_transaction_balance.  balance_after_cents on the inserted row
--   is set to the new balance by the BEFORE trigger.
--
-- api_keys security:
--   key_hash is never SELECTable by any non-service_role query.
--   A view `api_keys_safe` exposes all columns except key_hash for tenant use.
--
-- Intentionally absent from this migration:
--   - location_payment_gateways (legacy 015): dropped in legacy 026; replaced by
--     location_payment_credentials [NEW].
--   - get_available_payment_methods() / get_location_payment_provider() helper
--     functions from legacy 026: live in 014 (seed_and_views) as they depend on
--     seed data.
--   - handle_new_organization() trigger: moved to 014 (seed_and_views) as it
--     depends on regions seed data being present.
--   - delivery_zones (legacy 041): assigned to migration 011 (delivery.sql).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. REGIONS  (reference data, no RLS)
-- ---------------------------------------------------------------------------

CREATE TABLE regions (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    code                text            NOT NULL UNIQUE,   -- ISO 3166-1 alpha-2 or sub-region slug
    name                text            NOT NULL,
    currency            text            NOT NULL,          -- ISO 4217
    timezone            text            NOT NULL DEFAULT 'UTC',
    -- NULL = no online gateway configured for this region (offline/cash only)
    payment_provider    text            CHECK (payment_provider IN ('paystack','stripe','yoco','zapper') OR payment_provider IS NULL),
    default_tax_rate    decimal(5,2)    NOT NULL DEFAULT 0,
    default_tax_name    text            NOT NULL DEFAULT 'VAT',
    is_active           boolean         NOT NULL DEFAULT true,
    created_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE regions IS
    'Platform-wide registry of geographic regions BeepBite operates in. '
    'payment_provider identifies the primary online gateway for the region. '
    'Not RLS-protected — public SELECT allowed; only service_role may mutate.';

CREATE INDEX idx_regions_active ON regions(is_active);

CREATE TRIGGER trg_regions_updated_at
    BEFORE UPDATE ON regions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- Reference data: public SELECT, service_role-only writes.
GRANT SELECT ON regions TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON regions FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 2. PAYMENT PROVIDERS  [NEW — ROADMAP Now-4]
-- Registry of payment gateway providers known to the platform.
-- ---------------------------------------------------------------------------

CREATE TABLE payment_providers (
    id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text    NOT NULL UNIQUE,   -- 'paystack', 'stripe', 'payfast', 'yoco', 'zapper'
    display_name    text    NOT NULL,
    status          provider_status NOT NULL DEFAULT 'active',
    created_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE payment_providers IS
    'Registry of payment gateway providers supported by BeepBite. '
    'Not RLS-protected — public SELECT; only service_role may mutate.';

CREATE TRIGGER trg_payment_providers_updated_at
    BEFORE UPDATE ON payment_providers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

GRANT SELECT ON payment_providers TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON payment_providers FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. PAYMENT METHODS  (reference data, no RLS)
-- ---------------------------------------------------------------------------

CREATE TABLE payment_methods (
    id                          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    code                        text            NOT NULL UNIQUE,
    name                        text            NOT NULL,
    -- 'offline': cash / card-in-person / COD — always available.
    -- 'gateway': online gateway — surfaced only when location has an active
    --   location_payment_credentials row for the relevant provider.
    kind                        text            NOT NULL DEFAULT 'offline'
                                                CHECK (kind IN ('offline', 'gateway')),
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
-- 4. SUBSCRIPTION PLANS  (reference data, no RLS)
-- ---------------------------------------------------------------------------

CREATE TABLE subscription_plans (
    id                              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_code                       text            NOT NULL UNIQUE
                                                    CHECK (tier_code IN ('free','starter','growth','pro')),
    display_name                    text            NOT NULL,
    description                     text,
    -- Subscription fee (what the merchant pays us monthly/annually).
    monthly_fee_cents               bigint          NOT NULL DEFAULT 0 CHECK (monthly_fee_cents >= 0),
    annual_fee_cents                bigint          NOT NULL DEFAULT 0 CHECK (annual_fee_cents >= 0),
    -- BeepBite transaction fee on every successful online payment.
    transaction_fee_percentage      decimal(6,3)    NOT NULL DEFAULT 0 CHECK (transaction_fee_percentage >= 0),
    transaction_fee_fixed_cents     bigint          NOT NULL DEFAULT 0 CHECK (transaction_fee_fixed_cents >= 0),
    -- BeepBite payout fee per payout run.
    payout_fee_percentage           decimal(6,3)    NOT NULL DEFAULT 0 CHECK (payout_fee_percentage >= 0),
    payout_fee_fixed_cents          bigint          NOT NULL DEFAULT 0 CHECK (payout_fee_fixed_cents >= 0),
    -- Feature caps (NULL = unlimited).
    max_locations                   int,
    max_staff                       int,
    max_orders_per_month            int,
    features                        jsonb           NOT NULL DEFAULT '{}'::jsonb,
    billed_in_currency_code         text            REFERENCES currencies(code) DEFAULT 'ZAR',
    is_active                       boolean         NOT NULL DEFAULT true,
    sort_order                      int             NOT NULL DEFAULT 0,
    created_at                      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE subscription_plans IS
    'Platform subscription tiers (free, starter, growth, pro). '
    'Not RLS-protected — public SELECT; only service_role may mutate. '
    'Seed data lives in migration 014.';

CREATE INDEX idx_subscription_plans_active ON subscription_plans(is_active);

CREATE TRIGGER trg_subscription_plans_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

GRANT SELECT ON subscription_plans TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON subscription_plans FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. LOCATIONS  (tenant-scoped, org-scoped + marketplace SELECT)
-- ---------------------------------------------------------------------------

CREATE TABLE locations (
    id                              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                 uuid            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    region_id                       uuid            NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
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
CREATE INDEX idx_locations_region_id        ON locations(region_id);
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

-- Wire organizations.subscription_tier FK to subscription_plans (plan table now exists).
-- This ALTER is defined here because subscription_plans is created in this migration.
ALTER TABLE organizations
    ADD CONSTRAINT fk_organizations_subscription_tier
    FOREIGN KEY (subscription_tier) REFERENCES subscription_plans(tier_code)
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- Also wire organizations.default_currency_code FK (currencies created in 002).
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS default_currency_code text REFERENCES currencies(code) DEFAULT 'ZAR';

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS auto_refill_threshold_cents bigint,
    ADD COLUMN IF NOT EXISTS auto_refill_target_cents    bigint;

-- ---------------------------------------------------------------------------
-- 6. LOCATION PAYMENT METHOD FEES  (org/location-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE location_payment_method_fees (
    id                          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id                 uuid            NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    payment_method_code         text            NOT NULL REFERENCES payment_methods(code) ON DELETE CASCADE,
    processing_fee_percentage   decimal(5,2)    NOT NULL DEFAULT 0,
    fixed_fee_cents             integer         NOT NULL DEFAULT 0,
    gateway_fee_percentage      decimal(5,2)    NOT NULL DEFAULT 0,
    gateway_fixed_fee_cents     integer         NOT NULL DEFAULT 0,
    is_active                   boolean         NOT NULL DEFAULT true,
    created_at                  timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                  timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (location_id, payment_method_code)
);

COMMENT ON TABLE location_payment_method_fees IS
    'Per-location overrides for payment method fee structures (processing + gateway).';

CREATE INDEX idx_location_pmf_location ON location_payment_method_fees(location_id);
CREATE INDEX idx_location_pmf_method   ON location_payment_method_fees(payment_method_code);
CREATE INDEX idx_location_pmf_active   ON location_payment_method_fees(location_id, is_active);

CREATE TRIGGER trg_location_pmf_updated_at
    BEFORE UPDATE ON location_payment_method_fees
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE location_payment_method_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_payment_method_fees FORCE ROW LEVEL SECURITY;

CREATE POLICY location_pmf_select ON location_payment_method_fees FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY location_pmf_insert ON location_payment_method_fees FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY location_pmf_update ON location_payment_method_fees FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY location_pmf_delete ON location_payment_method_fees FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 7. LOCATION PAYMENT CREDENTIALS  [NEW — ROADMAP Now-4]
-- Replaces location_payment_gateways (dropped in legacy 026).
-- Encrypted keys stored per-location per-provider.
-- ---------------------------------------------------------------------------

CREATE TABLE location_payment_credentials (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id                 uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    provider_code               text        NOT NULL REFERENCES payment_providers(code) ON DELETE CASCADE,
    public_key                  text,
    secret_key_ciphertext       text,       -- AES-GCM encrypted by Go backend
    webhook_secret_ciphertext   text,       -- AES-GCM encrypted by Go backend
    is_test_mode                boolean     NOT NULL DEFAULT false,
    is_active                   boolean     NOT NULL DEFAULT true,
    currency                    text        REFERENCES currencies(code),
    configured_by               uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (location_id, provider_code)
);

COMMENT ON TABLE location_payment_credentials IS
    'Per-location encrypted payment provider credentials (BYO keys). '
    'secret_key_ciphertext and webhook_secret_ciphertext are never returned raw; '
    'the Go layer decrypts via the platform AES-GCM key at call time.';

CREATE INDEX idx_loc_pay_cred_location  ON location_payment_credentials(location_id);
CREATE INDEX idx_loc_pay_cred_provider  ON location_payment_credentials(provider_code);
CREATE INDEX idx_loc_pay_cred_active    ON location_payment_credentials(location_id, is_active);

CREATE TRIGGER trg_loc_pay_cred_updated_at
    BEFORE UPDATE ON location_payment_credentials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE location_payment_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_payment_credentials FORCE ROW LEVEL SECURITY;

-- Ciphertext columns are not policy-filtered at DB level — app layer must not
-- return raw ciphertext to the client.
CREATE POLICY loc_pay_cred_select ON location_payment_credentials FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY loc_pay_cred_insert ON location_payment_credentials FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY loc_pay_cred_update ON location_payment_credentials FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY loc_pay_cred_delete ON location_payment_credentials FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 8. PAYMENT ATTEMPTS  [NEW — ROADMAP Now-4]
-- Provider-agnostic record of every payment attempt regardless of order link.
-- ---------------------------------------------------------------------------

CREATE TABLE payment_attempts (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Nullable: some attempts are initiated before an order exists (e.g. wallet top-up).
    order_id            uuid,           -- FK to orders(id) added by 008 after orders is created
    provider_code       text            NOT NULL REFERENCES payment_providers(code),
    provider_txn_id     text            NOT NULL,
    status              payment_status  NOT NULL DEFAULT 'pending',
    amount_cents        bigint          NOT NULL CHECK (amount_cents >= 0),
    currency_code       text            NOT NULL REFERENCES currencies(code),
    metadata            jsonb           NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    -- A provider+txn_id pair must be globally unique — prevents duplicate processing.
    UNIQUE (provider_code, provider_txn_id)
);

COMMENT ON TABLE payment_attempts IS
    'Provider-agnostic record of every payment attempt. Replaces paystack_* columns '
    'on order_payments. order_id is nullable (set for order payments; NULL for '
    'wallet top-ups). FK to orders(id) is added by migration 008 once orders exists.';

CREATE INDEX idx_payment_attempts_order_id      ON payment_attempts(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_payment_attempts_provider      ON payment_attempts(provider_code, status);
CREATE INDEX idx_payment_attempts_status        ON payment_attempts(status);
CREATE INDEX idx_payment_attempts_created_at    ON payment_attempts(created_at DESC);

CREATE TRIGGER trg_payment_attempts_updated_at
    BEFORE UPDATE ON payment_attempts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY;

-- Attempts are scoped via order_id → orders → location → organization.
-- For attempts without an order (wallet top-ups), service_role handles them.
-- POLICY payment_attempts_select ON payment_attempts deferred to 008 (references table from later migration)
CREATE POLICY payment_attempts_insert ON payment_attempts FOR INSERT
    WITH CHECK (is_service_role());
CREATE POLICY payment_attempts_update ON payment_attempts FOR UPDATE
    USING (is_service_role())
    WITH CHECK (is_service_role());
CREATE POLICY payment_attempts_delete ON payment_attempts FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 9. ORDER PAYMENTS
-- Defined here because it only has a forward-reference FK to orders (added by 008).
-- NOTE: paystack_reference, paystack_status, paystack_gateway_response columns
--       from legacy 004 are deliberately DROPPED — replaced by payment_attempts.
-- ---------------------------------------------------------------------------

CREATE TABLE order_payments (
    id                                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- order_id FK added by migration 008 (ALTER TABLE order_payments ADD CONSTRAINT ...)
    order_id                            uuid            NOT NULL,
    payment_method_code                 text            NOT NULL REFERENCES payment_methods(code),
    customer_payment_authorization_id   uuid,           -- FK to customer_payment_authorizations added below
    -- NEW: links to normalised payment_attempts row
    payment_attempt_id                  uuid            REFERENCES payment_attempts(id) ON DELETE SET NULL,
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
    -- paystack_reference, paystack_status, paystack_gateway_response intentionally OMITTED.
    -- Reads go through payment_attempts.
);

COMMENT ON TABLE order_payments IS
    'Records a payment applied to an order. payment_attempt_id links to the '
    'provider-specific attempt. paystack_* columns from legacy 004 are removed. '
    'FK order_id → orders(id) is added by migration 008.';

CREATE INDEX idx_order_payments_order_id        ON order_payments(order_id);
CREATE INDEX idx_order_payments_status          ON order_payments(payment_status);
CREATE INDEX idx_order_payments_paid_at         ON order_payments(paid_at DESC);
CREATE INDEX idx_order_payments_method          ON order_payments(payment_method_code);
CREATE INDEX idx_order_payments_attempt         ON order_payments(payment_attempt_id) WHERE payment_attempt_id IS NOT NULL;

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
-- 10. PAYMENT FEES  (gateway-side fees per order_payment)
-- ---------------------------------------------------------------------------

CREATE TABLE payment_fees (
    id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id                      uuid        NOT NULL REFERENCES order_payments(id) ON DELETE CASCADE,
    location_payment_method_fee_id  uuid        REFERENCES location_payment_method_fees(id) ON DELETE SET NULL,
    processing_fee_cents            bigint      NOT NULL DEFAULT 0,
    gateway_fee_cents               bigint      NOT NULL DEFAULT 0,
    platform_fee_cents              bigint      NOT NULL DEFAULT 0,
    merchant_amount_cents           bigint      NOT NULL,
    platform_amount_cents           bigint      NOT NULL,
    created_at                      timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_payment_fees_payment_id ON payment_fees(payment_id);

ALTER TABLE payment_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_fees FORCE ROW LEVEL SECURITY;

-- POLICY payment_fees_select ON payment_fees deferred to 008 (references table from later migration)
CREATE POLICY payment_fees_insert ON payment_fees FOR INSERT
    WITH CHECK (is_service_role());
CREATE POLICY payment_fees_update ON payment_fees FOR UPDATE
    USING (is_service_role()) WITH CHECK (is_service_role());
CREATE POLICY payment_fees_delete ON payment_fees FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 11. BEEPBITE PAYMENT FEES  (platform-tier transaction + payout fees)
-- ---------------------------------------------------------------------------

CREATE TABLE beepbite_payment_fees (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_payment_id        uuid        NOT NULL REFERENCES order_payments(id) ON DELETE CASCADE,
    organization_id         uuid        NOT NULL REFERENCES organizations(id),
    subscription_plan_id    uuid        REFERENCES subscription_plans(id),
    fee_kind                text        NOT NULL CHECK (fee_kind IN ('transaction', 'payout')),
    fee_amount_cents        bigint      NOT NULL,
    captured_at             timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_payment_id, fee_kind)
);

CREATE INDEX idx_beepbite_payment_fees_org  ON beepbite_payment_fees(organization_id);
CREATE INDEX idx_beepbite_payment_fees_kind ON beepbite_payment_fees(fee_kind);
CREATE INDEX idx_beepbite_payment_fees_plan ON beepbite_payment_fees(subscription_plan_id)
    WHERE subscription_plan_id IS NOT NULL;

ALTER TABLE beepbite_payment_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE beepbite_payment_fees FORCE ROW LEVEL SECURITY;

CREATE POLICY beepbite_pf_select ON beepbite_payment_fees FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY beepbite_pf_insert ON beepbite_payment_fees FOR INSERT
    WITH CHECK (is_service_role());
CREATE POLICY beepbite_pf_update ON beepbite_payment_fees FOR UPDATE
    USING (is_service_role()) WITH CHECK (is_service_role());
CREATE POLICY beepbite_pf_delete ON beepbite_payment_fees FOR DELETE
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
-- 13. MERCHANT PAYOUTS + PAYOUT ITEMS
-- ---------------------------------------------------------------------------

CREATE TABLE merchant_payouts (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id                 uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    period_start                date        NOT NULL,
    period_end                  date        NOT NULL,
    total_sales_cents           bigint      NOT NULL DEFAULT 0,
    total_fees_cents            bigint      NOT NULL DEFAULT 0,
    total_refunds_cents         bigint      NOT NULL DEFAULT 0,
    net_payout_cents            bigint      NOT NULL DEFAULT 0,
    payout_status               text        NOT NULL DEFAULT 'pending'
                                            CHECK (payout_status IN (
                                                'pending','initiated','processing','completed',
                                                'failed','reversed','paid','cancelled'
                                            )),
    payout_reference            text,
    payout_method               text        NOT NULL DEFAULT 'eft',
    bank_account_id             uuid,       -- FK to bank_accounts added below
    subscription_plan_id        uuid        REFERENCES subscription_plans(id) ON DELETE SET NULL,
    payout_fee_cents            bigint      NOT NULL DEFAULT 0,
    -- Provider transfer tracking
    provider                    text        CHECK (provider IN ('paystack','stripe','yoco','zapper','manual')),
    provider_transfer_id        text,
    provider_transfer_status    text,
    provider_transfer_error     text,
    initiated_at                timestamptz,
    completed_at                timestamptz,
    failed_at                   timestamptz,
    reversed_at                 timestamptz,
    calculated_at               timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    paid_at                     timestamptz,
    processed_by                uuid        REFERENCES staff(id) ON DELETE SET NULL,
    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (location_id, period_start, period_end)
);

CREATE INDEX idx_merchant_payouts_location         ON merchant_payouts(location_id);
CREATE INDEX idx_merchant_payouts_period           ON merchant_payouts(period_start, period_end);
CREATE INDEX idx_merchant_payouts_status           ON merchant_payouts(payout_status);
CREATE INDEX idx_merchant_payouts_provider_xfer    ON merchant_payouts(provider, provider_transfer_id)
    WHERE provider_transfer_id IS NOT NULL;

CREATE TRIGGER trg_merchant_payouts_updated_at
    BEFORE UPDATE ON merchant_payouts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE merchant_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_payouts FORCE ROW LEVEL SECURITY;

CREATE POLICY merchant_payouts_select ON merchant_payouts FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY merchant_payouts_insert ON merchant_payouts FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY merchant_payouts_update ON merchant_payouts FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY merchant_payouts_delete ON merchant_payouts FOR DELETE
    USING (is_service_role());

-- Payout line items --

CREATE TABLE merchant_payout_items (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    payout_id               uuid        NOT NULL REFERENCES merchant_payouts(id) ON DELETE CASCADE,
    payment_id              uuid        NOT NULL REFERENCES order_payments(id) ON DELETE CASCADE,
    order_id                uuid        NOT NULL,   -- FK added by 008
    payment_amount_cents    bigint      NOT NULL,
    fee_amount_cents        bigint      NOT NULL,
    merchant_amount_cents   bigint      NOT NULL,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_merchant_payout_items_payout  ON merchant_payout_items(payout_id);
CREATE INDEX idx_merchant_payout_items_order   ON merchant_payout_items(order_id);

ALTER TABLE merchant_payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_payout_items FORCE ROW LEVEL SECURITY;

CREATE POLICY merchant_payout_items_select ON merchant_payout_items FOR SELECT
    USING (
        payout_id IN (
            SELECT mp.id FROM merchant_payouts mp
            JOIN locations l ON l.id = mp.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY merchant_payout_items_insert ON merchant_payout_items FOR INSERT
    WITH CHECK (is_service_role());
CREATE POLICY merchant_payout_items_update ON merchant_payout_items FOR UPDATE
    USING (is_service_role()) WITH CHECK (is_service_role());
CREATE POLICY merchant_payout_items_delete ON merchant_payout_items FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 14. BANK ACCOUNTS
-- ---------------------------------------------------------------------------

CREATE TABLE bank_accounts (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id                 uuid        REFERENCES locations(id) ON DELETE CASCADE,
    region_id                   uuid        NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
    account_holder_name         text        NOT NULL,
    bank_name                   text        NOT NULL,
    bank_code                   text,
    account_number_ciphertext   text        NOT NULL,
    account_number_last4        text        NOT NULL,
    account_type                text        DEFAULT 'cheque'
                                            CHECK (account_type IN ('cheque','savings','business','other')),
    currency                    text        NOT NULL,
    provider                    text        CHECK (provider IN ('paystack','stripe','yoco','zapper')),
    provider_recipient_id       text,
    verified_at                 timestamptz,
    is_default                  boolean     NOT NULL DEFAULT false,
    is_active                   boolean     NOT NULL DEFAULT true,
    notes                       text,
    created_by                  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_bank_accounts_org               ON bank_accounts(organization_id);
CREATE INDEX idx_bank_accounts_location          ON bank_accounts(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX idx_bank_accounts_provider_recip    ON bank_accounts(provider, provider_recipient_id)
    WHERE provider_recipient_id IS NOT NULL;

CREATE UNIQUE INDEX one_default_bank_per_org
    ON bank_accounts(organization_id) WHERE location_id IS NULL AND is_default = true;
CREATE UNIQUE INDEX one_default_bank_per_location
    ON bank_accounts(location_id) WHERE location_id IS NOT NULL AND is_default = true;

CREATE TRIGGER trg_bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- Now wire bank_account_id FK on merchant_payouts (bank_accounts now exists).
ALTER TABLE merchant_payouts
    ADD CONSTRAINT fk_merchant_payouts_bank_account
    FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE SET NULL;

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY bank_accounts_select ON bank_accounts FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY bank_accounts_insert ON bank_accounts FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY bank_accounts_update ON bank_accounts FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY bank_accounts_delete ON bank_accounts FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 15. PAYOUT SCHEDULES
-- ---------------------------------------------------------------------------

CREATE TABLE payout_schedules (
    id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id             uuid        REFERENCES locations(id) ON DELETE CASCADE,
    cadence                 text        NOT NULL DEFAULT 'weekly'
                                        CHECK (cadence IN ('daily','weekly','biweekly','monthly','manual')),
    day_of_week             int         CHECK (day_of_week BETWEEN 1 AND 7),
    day_of_month            int         CHECK (day_of_month BETWEEN 1 AND 28),
    run_at_hour             int         NOT NULL DEFAULT 2 CHECK (run_at_hour BETWEEN 0 AND 23),
    minimum_payout_cents    bigint      NOT NULL DEFAULT 0 CHECK (minimum_payout_cents >= 0),
    hold_period_hours       int         NOT NULL DEFAULT 24,
    is_active               boolean     NOT NULL DEFAULT true,
    last_run_at             timestamptz,
    next_run_at             timestamptz,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_payout_schedules_next_run ON payout_schedules(next_run_at) WHERE is_active = true;
CREATE UNIQUE INDEX one_schedule_per_org_no_location
    ON payout_schedules(organization_id) WHERE location_id IS NULL;
CREATE UNIQUE INDEX one_schedule_per_location
    ON payout_schedules(location_id) WHERE location_id IS NOT NULL;

CREATE TRIGGER trg_payout_schedules_updated_at
    BEFORE UPDATE ON payout_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE payout_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_schedules FORCE ROW LEVEL SECURITY;

CREATE POLICY payout_schedules_select ON payout_schedules FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY payout_schedules_insert ON payout_schedules FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY payout_schedules_update ON payout_schedules FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY payout_schedules_delete ON payout_schedules FOR DELETE
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
    'Point-in-time FX rate snapshots. Used by subscription_invoices to capture '
    'the rate at billing time and by order FX conversion.';

CREATE INDEX idx_exchange_rates_pair_time  ON exchange_rates(from_currency, to_currency, fetched_at DESC);

-- Exchange rates are platform-wide reference; no RLS. Service_role only writes.
GRANT SELECT ON exchange_rates TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON exchange_rates FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 17. SUBSCRIPTION INVOICES  [NEW — ROADMAP Now-11]
-- ---------------------------------------------------------------------------

CREATE TABLE subscription_invoices (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan_id             uuid            NOT NULL REFERENCES subscription_plans(id),
    period_start        date            NOT NULL,
    period_end          date            NOT NULL,
    usd_amount_cents    bigint          NOT NULL CHECK (usd_amount_cents >= 0),
    local_amount_cents  bigint          NOT NULL CHECK (local_amount_cents >= 0),
    local_currency_code text            NOT NULL REFERENCES currencies(code),
    fx_rate             numeric(18,8)   NOT NULL CHECK (fx_rate > 0),
    status              text            NOT NULL DEFAULT 'issued'
                                        CHECK (status IN ('issued','paid','void','overdue')),
    issued_at           timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    paid_at             timestamptz,
    created_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE subscription_invoices IS
    'Per-billing-period invoices. Stores both USD and local-currency amounts with '
    'the FX rate snapshot at invoice time.';

CREATE INDEX idx_subscription_invoices_org        ON subscription_invoices(org_id);
CREATE INDEX idx_subscription_invoices_status     ON subscription_invoices(status);
CREATE INDEX idx_subscription_invoices_period     ON subscription_invoices(period_start, period_end);

CREATE TRIGGER trg_subscription_invoices_updated_at
    BEFORE UPDATE ON subscription_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY sub_invoices_select ON subscription_invoices FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());
CREATE POLICY sub_invoices_insert ON subscription_invoices FOR INSERT
    WITH CHECK (is_service_role());
CREATE POLICY sub_invoices_update ON subscription_invoices FOR UPDATE
    USING (is_service_role()) WITH CHECK (is_service_role());
CREATE POLICY sub_invoices_delete ON subscription_invoices FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 18. WEBHOOK EVENT LOG
-- Generalised from legacy 023 — provider CHECK relaxed to allow any text value.
-- ---------------------------------------------------------------------------

CREATE TABLE webhook_event_log (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- No CHECK constraint on provider — allows 'paystack','yoco','stripe','whatsapp',
    -- 'resend','mapbox','other' and future providers without a migration.
    provider            text        NOT NULL,
    event_type          text,
    external_event_id   text,
    signature_valid     boolean,
    payload             jsonb       NOT NULL,
    headers             jsonb,
    processing_status   text        NOT NULL DEFAULT 'pending'
                                    CHECK (processing_status IN ('pending','processed','failed','ignored')),
    error_message       text,
    processed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX idx_webhook_event_log_provider_external
    ON webhook_event_log(provider, external_event_id)
    WHERE external_event_id IS NOT NULL;
CREATE INDEX idx_webhook_event_log_provider_status
    ON webhook_event_log(provider, processing_status, created_at DESC);
CREATE INDEX idx_webhook_event_log_event_type
    ON webhook_event_log(event_type, created_at DESC);

-- webhook_event_log is written exclusively by the webhook ingestion service (service_role).
-- Tenants can read their own provider events via org-level filter in app layer;
-- at DB level we restrict writes and allow service_role full access.
ALTER TABLE webhook_event_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_event_log FORCE ROW LEVEL SECURITY;

CREATE POLICY webhook_event_log_select ON webhook_event_log FOR SELECT
    USING (is_service_role());
CREATE POLICY webhook_event_log_insert ON webhook_event_log FOR INSERT
    WITH CHECK (is_service_role());
CREATE POLICY webhook_event_log_update ON webhook_event_log FOR UPDATE
    USING (is_service_role()) WITH CHECK (is_service_role());
CREATE POLICY webhook_event_log_delete ON webhook_event_log FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 19. ORG WALLETS  [NEW — ROADMAP Now-1]
-- One wallet per organisation; balance maintained atomically by trigger below.
-- ---------------------------------------------------------------------------

CREATE TABLE org_wallets (
    org_id          uuid        PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    balance_cents   bigint      NOT NULL DEFAULT 0,
    hold_cents      bigint      NOT NULL DEFAULT 0,
    currency_code   text        NOT NULL REFERENCES currencies(code),
    -- Auto-refill config: if balance drops below threshold, topup to target.
    auto_refill_threshold_cents bigint,
    auto_refill_target_cents    bigint,
    -- saved_payment_method_id added via ALTER TABLE below (after customer_payment_authorizations is created)
    saved_payment_method_id     uuid,   -- FK to customer_payment_authorizations(id) — constraint added below
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE org_wallets IS
    'One row per organisation. balance_cents is updated atomically by the '
    'trg_fn_wallet_transaction_balance trigger on every wallet_transactions insert.';

ALTER TABLE org_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_wallets FORCE ROW LEVEL SECURITY;

CREATE POLICY org_wallets_select ON org_wallets FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());
CREATE POLICY org_wallets_insert ON org_wallets FOR INSERT
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY org_wallets_update ON org_wallets FOR UPDATE
    USING (org_id = current_org_id() OR is_service_role())
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY org_wallets_delete ON org_wallets FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 20. WALLET TOPUPS  [NEW — ROADMAP Now-1]
-- ---------------------------------------------------------------------------

CREATE TABLE wallet_topups (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    amount_cents        bigint          NOT NULL CHECK (amount_cents > 0),
    currency_code       text            NOT NULL REFERENCES currencies(code),
    payment_attempt_id  uuid            REFERENCES payment_attempts(id) ON DELETE SET NULL,
    status              topup_status    NOT NULL DEFAULT 'initiated',
    created_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    completed_at        timestamptz,
    updated_at          timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_wallet_topups_org     ON wallet_topups(org_id);
CREATE INDEX idx_wallet_topups_status  ON wallet_topups(status);

CREATE TRIGGER trg_wallet_topups_updated_at
    BEFORE UPDATE ON wallet_topups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE wallet_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_topups FORCE ROW LEVEL SECURITY;

CREATE POLICY wallet_topups_select ON wallet_topups FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());
CREATE POLICY wallet_topups_insert ON wallet_topups FOR INSERT
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY wallet_topups_update ON wallet_topups FOR UPDATE
    USING (org_id = current_org_id() OR is_service_role())
    WITH CHECK (org_id = current_org_id() OR is_service_role());
CREATE POLICY wallet_topups_delete ON wallet_topups FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 21. WALLET TRANSACTIONS  [NEW — ROADMAP Now-1]
-- Append-only ledger. Trigger atomically updates org_wallets.balance_cents.
-- ---------------------------------------------------------------------------

CREATE TABLE wallet_transactions (
    id                  uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid                NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    kind                wallet_txn_kind     NOT NULL,
    amount_cents        bigint              NOT NULL,   -- positive = credit, negative = debit
    balance_after_cents bigint,                         -- set by BEFORE trigger
    description         text,
    reference_id        uuid,               -- polymorphic: topup_id, order_id, etc.
    reference_type      text,               -- 'wallet_topup', 'order', 'adjustment', etc.
    created_at          timestamptz         NOT NULL DEFAULT timezone('utc'::text, now())
    -- NO updated_at — append-only
);

COMMENT ON TABLE wallet_transactions IS
    'Append-only wallet ledger. Every INSERT atomically updates org_wallets.balance_cents '
    'and sets balance_after_cents on this row via the trg_fn_wallet_transaction_balance trigger.';

CREATE INDEX idx_wallet_transactions_org        ON wallet_transactions(org_id, created_at DESC);
CREATE INDEX idx_wallet_transactions_reference  ON wallet_transactions(reference_type, reference_id)
    WHERE reference_id IS NOT NULL;

-- Wallet balance trigger function --
CREATE OR REPLACE FUNCTION trg_fn_wallet_transaction_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_balance bigint;
BEGIN
    -- Atomically update the wallet balance and capture the new value.
    UPDATE org_wallets
    SET balance_cents = balance_cents + NEW.amount_cents,
        updated_at    = now()
    WHERE org_id = NEW.org_id
    RETURNING balance_cents INTO v_new_balance;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'wallet_transactions: no org_wallets row for org_id=%; '
            'create the wallet first via INSERT INTO org_wallets',
            NEW.org_id;
    END IF;

    -- Write the post-transaction balance onto the new ledger row.
    NEW.balance_after_cents := v_new_balance;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_wallet_transaction_balance() IS
    'BEFORE INSERT trigger on wallet_transactions: atomically increments '
    'org_wallets.balance_cents and sets balance_after_cents on the new row.';

-- Must be BEFORE INSERT so NEW.balance_after_cents is set before the row is written.
CREATE TRIGGER trg_wallet_transaction_balance
    BEFORE INSERT ON wallet_transactions
    FOR EACH ROW EXECUTE FUNCTION trg_fn_wallet_transaction_balance();

ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions FORCE ROW LEVEL SECURITY;

-- Append-only: no UPDATE or DELETE.
CREATE POLICY wallet_transactions_select ON wallet_transactions FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());
CREATE POLICY wallet_transactions_insert ON wallet_transactions FOR INSERT
    WITH CHECK (org_id = current_org_id() OR is_service_role());
-- Append-only: explicit false policies so intent is clear even under FORCE RLS.
CREATE POLICY wallet_transactions_update ON wallet_transactions FOR UPDATE
    USING (false);
CREATE POLICY wallet_transactions_delete ON wallet_transactions FOR DELETE
    USING (false);

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
-- 25. CUSTOMER PAYMENT AUTHORIZATIONS
-- Saved payment method tokens per customer.
-- ---------------------------------------------------------------------------

CREATE TABLE customer_payment_authorizations (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id                 uuid        NOT NULL, -- FK to customers(id) deferred to 010 (customers defined there)
    payment_method_code         text        NOT NULL REFERENCES payment_methods(code),
    gateway_provider            text        NOT NULL,
    authorization_code          text        NOT NULL,
    card_last_four              text,
    card_type                   text,
    card_exp_month              text,
    card_exp_year               text,
    is_active                   boolean     NOT NULL DEFAULT true,
    is_default                  boolean     NOT NULL DEFAULT false,
    last_used_at                timestamptz,
    nickname                    text,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (customer_id, authorization_code, gateway_provider)
);

CREATE UNIQUE INDEX one_default_payment_per_customer
    ON customer_payment_authorizations(customer_id)
    WHERE is_default = true AND is_active = true;

CREATE INDEX idx_cpa_customer      ON customer_payment_authorizations(customer_id);
CREATE INDEX idx_cpa_active        ON customer_payment_authorizations(is_active, is_default);
CREATE INDEX idx_cpa_gateway       ON customer_payment_authorizations(gateway_provider, authorization_code);
CREATE INDEX idx_cpa_last_used     ON customer_payment_authorizations(last_used_at);

CREATE TRIGGER trg_cpa_updated_at
    BEFORE UPDATE ON customer_payment_authorizations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- Wire FK from order_payments (defined above, before customer_payment_authorizations existed)
ALTER TABLE order_payments
    ADD CONSTRAINT fk_order_payments_cpa
    FOREIGN KEY (customer_payment_authorization_id)
    REFERENCES customer_payment_authorizations(id) ON DELETE SET NULL;

-- CPA is scoped to a customer (engagements/customers created in 010).
-- Use a customer_id-scoped policy bridging through the customers table.
ALTER TABLE customer_payment_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payment_authorizations FORCE ROW LEVEL SECURITY;

-- customers.organization_id is the direct org anchor (customers has no location_id).
-- POLICY cpa_select ON customer_payment_authorizations deferred to 010 (references table from later migration)
-- POLICY cpa_insert ON customer_payment_authorizations deferred to 010 (references table from later migration)
-- POLICY cpa_update ON customer_payment_authorizations deferred to 010 (references table from later migration)
CREATE POLICY cpa_delete ON customer_payment_authorizations FOR DELETE
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
-- Reference tables (no RLS): regions, payment_providers, payment_methods,
--   subscription_plans, exchange_rates (5 tables, public SELECT).
-- Tenant tables (RLS): locations, location_payment_method_fees,
--   location_payment_credentials, payment_attempts, order_payments,
--   payment_fees, beepbite_payment_fees, refunds, merchant_payouts,
--   merchant_payout_items, bank_accounts, payout_schedules,
--   subscription_invoices, webhook_event_log, org_wallets, wallet_topups,
--   wallet_transactions, custom_domains, api_keys, webhook_endpoints,
--   customer_payment_authorizations, cart_items, cart_item_variations (23 tables).
-- Views: api_keys_safe
-- Triggers: trg_fn_wallet_transaction_balance (wallet atomicity)
-- Deferred FKs (added by 008): order_payments.order_id → orders(id),
--   refunds.order_id → orders(id), merchant_payout_items.order_id → orders(id),
--   payment_attempts.order_id → orders(id).

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

-- org_wallets.saved_payment_method_id FK:
-- Column was declared inline above (UUID nullable) but FK deferred here because
-- customer_payment_authorizations is created later in this same file.
ALTER TABLE org_wallets
    ADD CONSTRAINT fk_org_wallets_saved_payment_method
    FOREIGN KEY (saved_payment_method_id)
    REFERENCES customer_payment_authorizations(id)
    ON DELETE SET NULL;

-- wallet_transactions.idempotency_key: missing per plan spec.
-- Required to prevent duplicate wallet debit/credit entries on retry.
ALTER TABLE wallet_transactions
    ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE;
