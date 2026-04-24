-- ======================
-- BYO PAYMENT GATEWAYS
-- Adds subscription tier + per-location gateway credentials.
--
-- Restaurants on any paid tier can plug in their own Paystack or Stripe keys
-- and collect online payments into their own account. Free tier can only
-- accept offline methods (cash, card in person, cash/card on delivery).
-- ======================

-- 1) Subscription tier on the organization.
-- Matches billingmodel/pricing.py. `free` is the default — owners must
-- explicitly upgrade to unlock BYO online payments.
ALTER TABLE organizations
    ADD COLUMN subscription_tier text NOT NULL DEFAULT 'free'
        CHECK (subscription_tier IN ('free', 'starter', 'growth', 'pro'));

CREATE INDEX idx_organizations_tier ON organizations(subscription_tier);

-- 2) Per-location gateway credentials.
-- Secrets are stored encrypted (AES-GCM, key held by the Go backend). The DB
-- never sees plaintext keys; if the DB leaks, the keys are still useless
-- without the server-side PAYMENT_KEY_ENCRYPTION_SECRET.
CREATE TABLE location_payment_gateways (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    provider text NOT NULL CHECK (provider IN ('paystack', 'stripe')),

    -- Public / display fields
    public_key text,              -- safe to expose to frontend (pk_live_…, pk_test_…)

    -- Encrypted secrets (base64(nonce||ciphertext))
    secret_key_ciphertext text NOT NULL,
    webhook_secret_ciphertext text,   -- Paystack: raw secret key doubles as webhook signing key; Stripe: separate whsec_…

    -- Config
    is_test_mode boolean NOT NULL DEFAULT true,  -- are the above test keys or live?
    is_active boolean NOT NULL DEFAULT true,
    currency text NOT NULL DEFAULT 'ZAR',

    -- Audit
    configured_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    last_verified_at timestamptz,

    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,

    UNIQUE(location_id, provider)
);

CREATE INDEX idx_lpg_location ON location_payment_gateways(location_id);
CREATE INDEX idx_lpg_provider ON location_payment_gateways(provider, is_active);

-- 3) Keep updated_at fresh.
CREATE OR REPLACE FUNCTION set_updated_at_now()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lpg_updated_at
    BEFORE UPDATE ON location_payment_gateways
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- 4) Available methods for checkout.
-- Authoritative source for "what can the customer pick?". Combines:
--   - offline methods (always on, subject to payment_methods.is_active)
--   - gateway methods (only if org tier != 'free' AND location has an active
--     gateway config for that provider)
CREATE OR REPLACE FUNCTION get_available_payment_methods(p_location_id uuid)
RETURNS TABLE (
    payment_method_code text,
    payment_method_name text,
    kind text,
    requires_reference boolean,
    supports_tips boolean,
    is_configured boolean,        -- true when a gateway config exists for this location
    is_test_mode boolean          -- NULL for offline methods
) AS $$
DECLARE
    v_tier text;
BEGIN
    SELECT o.subscription_tier INTO v_tier
    FROM locations l
    JOIN organizations o ON o.id = l.organization_id
    WHERE l.id = p_location_id;

    IF v_tier IS NULL THEN
        -- unknown location — return nothing rather than leaking defaults
        RETURN;
    END IF;

    -- Offline methods (always available while the row is active).
    RETURN QUERY
    SELECT pm.code, pm.name, pm.kind,
           pm.requires_reference, pm.supports_tips,
           true AS is_configured,
           NULL::boolean AS is_test_mode
    FROM payment_methods pm
    WHERE pm.kind = 'offline'
      AND pm.is_active = true;

    -- Gateway methods — gated on both tier and a live location config.
    IF v_tier <> 'free' THEN
        RETURN QUERY
        SELECT pm.code, pm.name, pm.kind,
               pm.requires_reference, pm.supports_tips,
               true AS is_configured,
               lpg.is_test_mode
        FROM payment_methods pm
        JOIN location_payment_gateways lpg
            ON lpg.provider = pm.code
           AND lpg.location_id = p_location_id
           AND lpg.is_active = true
        WHERE pm.kind = 'gateway'
          AND pm.is_active = true;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- 5) Convenience: is a location allowed to configure BYO gateways at all?
CREATE OR REPLACE FUNCTION can_configure_payment_gateway(p_location_id uuid)
RETURNS boolean AS $$
DECLARE
    v_tier text;
BEGIN
    SELECT o.subscription_tier INTO v_tier
    FROM locations l
    JOIN organizations o ON o.id = l.organization_id
    WHERE l.id = p_location_id;

    RETURN v_tier IS NOT NULL AND v_tier <> 'free';
END;
$$ LANGUAGE plpgsql STABLE;
