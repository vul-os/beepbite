-- ======================
-- REGIONS + CENTRAL PAYMENT GATEWAYS
-- Replaces the BYO (bring-your-own) model from 20240101000015. Now one
-- central gateway per region; credentials live in env vars keyed by
-- provider+region (e.g. PAYSTACK_ZA_SECRET_KEY). The DB only records which
-- provider covers which region. Tier-based fees land in migration 27.
--
-- Destructive: drops location_payment_gateways (any rows are lost). Pre-prod
-- only — safe while we're still in dev.
--
-- Verified against 20240101000004: payment_methods has a `kind` column with
-- values 'offline'/'gateway'. The rewritten get_available_payment_methods
-- filters on that column directly.
-- ======================

-- 1) Tear down BYO.
-- Keep set_updated_at_now() from migration 15 — it's a generic helper used by
-- later migrations. Keep organizations.subscription_tier — migration 27 uses
-- it for tier-based transaction/payout fees.
DROP FUNCTION IF EXISTS can_configure_payment_gateway(uuid);
DROP FUNCTION IF EXISTS get_available_payment_methods(uuid);
DROP TRIGGER IF EXISTS trg_lpg_updated_at ON location_payment_gateways;
DROP TABLE IF EXISTS location_payment_gateways;

-- 2) Regions registry.
-- Authoritative list of regions we operate in. `payment_provider` names the
-- provider; actual credentials live in env vars keyed as
-- <PROVIDER>_<REGION_CODE>_SECRET_KEY (e.g. PAYSTACK_ZA_SECRET_KEY). NULL
-- provider = no online payments in this region yet (offline/cash only).
CREATE TABLE regions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    code text NOT NULL UNIQUE,            -- ISO 3166-1 alpha-2 typically ('ZA','KE','NG',...) or a sub-region slug
    name text NOT NULL,                   -- display name
    currency text NOT NULL,               -- ISO 4217 ('ZAR','KES','NGN',...)
    timezone text NOT NULL DEFAULT 'UTC',
    -- Payment provider for this region. NULL = we do not yet support online payments here (offline/cash/delivery-on-arrival only).
    payment_provider text CHECK (payment_provider IN ('paystack','stripe','yoco','zapper') OR payment_provider IS NULL),
    -- Default tax rate applied if a location has no explicit tax_rates row.
    default_tax_rate decimal(5,2) NOT NULL DEFAULT 0,
    default_tax_name text NOT NULL DEFAULT 'VAT',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_regions_active ON regions(is_active);

CREATE TRIGGER trg_regions_updated_at
    BEFORE UPDATE ON regions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- 3) Seed the first region.
-- BeepBite is ZA-first (Paystack/Yoco/Zapper are South African). Paystack is
-- our chosen provider for ZA at launch.
INSERT INTO regions (code, name, currency, timezone, payment_provider, default_tax_rate, default_tax_name)
VALUES ('ZA', 'South Africa', 'ZAR', 'Africa/Johannesburg', 'paystack', 15.00, 'VAT')
ON CONFLICT (code) DO NOTHING;

-- 4) Link locations to regions.
ALTER TABLE locations
    ADD COLUMN region_id uuid REFERENCES regions(id) ON DELETE RESTRICT;

-- Backfill: if any locations exist, default them to ZA. Safe because BeepBite is ZA-first.
UPDATE locations SET region_id = (SELECT id FROM regions WHERE code = 'ZA') WHERE region_id IS NULL;

-- Make it NOT NULL once backfilled.
ALTER TABLE locations ALTER COLUMN region_id SET NOT NULL;

CREATE INDEX idx_locations_region ON locations(region_id);

-- 5) Rewritten availability function.
-- Replaces the BYO version. Returns methods available to a location based on:
--   - offline methods: always available (if payment_methods.is_active)
--   - gateway methods: available iff the location's region has a payment_provider
--     AND an is_active payment_methods row exists matching that provider code
--   - no tier check here: tier affects FEES (migration 27), not availability.
CREATE OR REPLACE FUNCTION get_available_payment_methods(p_location_id uuid)
RETURNS TABLE (
    payment_method_code text,
    payment_method_name text,
    kind text,
    requires_reference boolean,
    supports_tips boolean
) AS $$
DECLARE
    v_region_provider text;
BEGIN
    -- Find the provider for this location's region.
    SELECT r.payment_provider INTO v_region_provider
    FROM locations l
    JOIN regions r ON r.id = l.region_id
    WHERE l.id = p_location_id
      AND r.is_active = true;

    -- Offline methods always come through.
    RETURN QUERY
    SELECT pm.code, pm.name, pm.kind,
           pm.requires_reference, pm.supports_tips
    FROM payment_methods pm
    WHERE pm.kind = 'offline'
      AND pm.is_active = true;

    -- Gateway methods only if region has a provider.
    IF v_region_provider IS NOT NULL THEN
        RETURN QUERY
        SELECT pm.code, pm.name, pm.kind,
               pm.requires_reference, pm.supports_tips
        FROM payment_methods pm
        WHERE pm.kind = 'gateway'
          AND pm.is_active = true
          AND pm.code = v_region_provider;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6) Helper: region-aware lookup for the Go code.
-- Given a location, return the region code, currency, and configured provider.
-- The Go layer uses (provider, region_code) to resolve env var names for
-- secret/public/webhook keys.
CREATE OR REPLACE FUNCTION get_location_payment_provider(p_location_id uuid)
RETURNS TABLE (
    region_code text,
    currency text,
    payment_provider text
) AS $$
BEGIN
    RETURN QUERY
    SELECT r.code, r.currency, r.payment_provider
    FROM locations l
    JOIN regions r ON r.id = l.region_id
    WHERE l.id = p_location_id
      AND r.is_active = true;
END;
$$ LANGUAGE plpgsql STABLE;
