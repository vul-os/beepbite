-- ======================
-- SUBSCRIPTION PLANS + PAYOUT INFRASTRUCTURE
-- Central fee model:
--   - subscription_plans: per-tier monthly fee + transaction fee + payout fee
--   - bank_accounts: merchant banking destinations (encrypted account numbers)
--   - payout_schedules: cadence per org/location (default weekly)
--   - merchant_payouts extended with provider_transfer_id + payout_fee_cents
-- BeepBite's gateway (Paystack/etc.) executes the transfer; see Go-side
-- integration layer for the Transfer API calls.
-- ======================

-- ----------------------
-- 1) subscription_plans — per-tier fee config
-- ----------------------
CREATE TABLE subscription_plans (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    tier_code text NOT NULL UNIQUE CHECK (tier_code IN ('free','starter','growth','pro')),
    display_name text NOT NULL,
    description text,

    -- Subscription fee (what the merchant pays us monthly/annually for the platform).
    monthly_fee_cents bigint NOT NULL DEFAULT 0 CHECK (monthly_fee_cents >= 0),
    annual_fee_cents bigint NOT NULL DEFAULT 0 CHECK (annual_fee_cents >= 0),

    -- Transaction fee — BeepBite's cut on every successful online payment.
    -- Total cost to merchant per txn = (transaction_fee_percentage × amount) + transaction_fee_fixed_cents
    -- This is ON TOP OF the gateway's own processing fee (which is already tracked in payment_fees).
    transaction_fee_percentage decimal(6,3) NOT NULL DEFAULT 0 CHECK (transaction_fee_percentage >= 0),
    transaction_fee_fixed_cents bigint NOT NULL DEFAULT 0 CHECK (transaction_fee_fixed_cents >= 0),

    -- Payout fee — charged per payout (weekly) in addition to any provider transfer fee.
    payout_fee_percentage decimal(6,3) NOT NULL DEFAULT 0 CHECK (payout_fee_percentage >= 0),
    payout_fee_fixed_cents bigint NOT NULL DEFAULT 0 CHECK (payout_fee_fixed_cents >= 0),

    -- Caps / features
    max_locations int,                          -- NULL = unlimited
    max_staff int,                              -- NULL = unlimited
    max_orders_per_month int,                   -- NULL = unlimited; soft cap for metering
    features jsonb NOT NULL DEFAULT '{}'::jsonb,-- flags: {"kds":true,"multi_location":false,...}

    is_active boolean NOT NULL DEFAULT true,
    sort_order int NOT NULL DEFAULT 0,

    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_subscription_plans_active ON subscription_plans(is_active);

CREATE TRIGGER trg_subscription_plans_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- Seed the four tiers. These are starting points tuned to the ZA market
-- (rands converted to cents: R1 = 100 cents). Operators can edit post-deploy.
INSERT INTO subscription_plans (
    tier_code, display_name, description,
    monthly_fee_cents, annual_fee_cents,
    transaction_fee_percentage, transaction_fee_fixed_cents,
    payout_fee_percentage, payout_fee_fixed_cents,
    sort_order
) VALUES
    ('free',    'Free',    'Offline payments only (cash, card in person, COD). No online gateway.',
        0,        0,        3.500, 200, 0.000, 500,  0),
    ('starter', 'Starter', 'Small restaurants: online payments + single location.',
        29900,    323000,   2.900, 150, 0.000, 500,  1),
    ('growth',  'Growth',  'Multi-location with lower transaction fees and free payouts.',
        79900,    862000,   2.500, 100, 0.000,   0,  2),
    ('pro',     'Pro',     'High-volume chains: lowest transaction fees, free payouts, unlimited.',
        199900,  2159000,   2.000,  50, 0.000,   0,  3)
ON CONFLICT (tier_code) DO NOTHING;

-- ----------------------
-- 2) bank_accounts — merchant payout destinations
-- Per-organization (common for chains) with an optional location_id override
-- for franchisees that bank separately.
-- ----------------------
CREATE TABLE bank_accounts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- Optional: specific to one location. NULL = covers all locations under the org.
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE,
    region_id uuid NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,

    account_holder_name text NOT NULL,
    bank_name text NOT NULL,
    bank_code text,                  -- SWIFT / sort code / SA universal branch code / BVN etc.

    -- Stored encrypted by the Go backend (same AES-GCM key used elsewhere).
    account_number_ciphertext text NOT NULL,
    account_number_last4 text NOT NULL,          -- plaintext last 4 for display

    account_type text CHECK (account_type IN ('cheque','savings','business','other')) DEFAULT 'cheque',
    currency text NOT NULL,                      -- must match region.currency; enforce in app layer

    -- Provider-specific recipient id (e.g. Paystack's `recipient_code`) — created once per
    -- bank account via the provider's API so transfers can reference it later.
    provider text CHECK (provider IN ('paystack','stripe','yoco','zapper')),
    provider_recipient_id text,

    verified_at timestamptz,                     -- set after provider confirms the recipient
    is_default boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    notes text,

    created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_bank_accounts_org ON bank_accounts(organization_id);
CREATE INDEX idx_bank_accounts_location ON bank_accounts(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX idx_bank_accounts_provider_recipient ON bank_accounts(provider, provider_recipient_id) WHERE provider_recipient_id IS NOT NULL;

-- Only one default per (org, location). Handle NULL location with a partial index.
CREATE UNIQUE INDEX one_default_bank_per_org
    ON bank_accounts(organization_id) WHERE location_id IS NULL AND is_default = true;
CREATE UNIQUE INDEX one_default_bank_per_location
    ON bank_accounts(location_id) WHERE location_id IS NOT NULL AND is_default = true;

CREATE TRIGGER trg_bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ----------------------
-- 3) payout_schedules — cadence per org/location
-- ----------------------
CREATE TABLE payout_schedules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE,     -- NULL = org-wide

    cadence text NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('daily','weekly','biweekly','monthly','manual')),
    -- For weekly: 1=Mon..7=Sun per ISO
    day_of_week int CHECK (day_of_week BETWEEN 1 AND 7),
    -- For monthly: 1..28 (avoid month-end issues)
    day_of_month int CHECK (day_of_month BETWEEN 1 AND 28),
    -- Hour of day when the payout job should run (UTC).
    run_at_hour int NOT NULL DEFAULT 2 CHECK (run_at_hour BETWEEN 0 AND 23),

    minimum_payout_cents bigint NOT NULL DEFAULT 0 CHECK (minimum_payout_cents >= 0),
    hold_period_hours int NOT NULL DEFAULT 24,   -- don't pay out orders younger than this (refund window)
    is_active boolean NOT NULL DEFAULT true,

    last_run_at timestamptz,
    next_run_at timestamptz,

    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX idx_payout_schedules_next_run ON payout_schedules(next_run_at) WHERE is_active = true;
CREATE UNIQUE INDEX one_schedule_per_org_when_no_location
    ON payout_schedules(organization_id) WHERE location_id IS NULL;
CREATE UNIQUE INDEX one_schedule_per_location
    ON payout_schedules(location_id) WHERE location_id IS NOT NULL;

CREATE TRIGGER trg_payout_schedules_updated_at
    BEFORE UPDATE ON payout_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ----------------------
-- 4) Extend merchant_payouts for provider transfer tracking + tier-based fees
-- ----------------------
ALTER TABLE merchant_payouts
    ADD COLUMN bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
    ADD COLUMN subscription_plan_id uuid REFERENCES subscription_plans(id) ON DELETE SET NULL,
    ADD COLUMN payout_fee_cents bigint NOT NULL DEFAULT 0,               -- BeepBite's payout fee (per tier)
    ADD COLUMN provider text CHECK (provider IN ('paystack','stripe','yoco','zapper','manual')),
    ADD COLUMN provider_transfer_id text,
    ADD COLUMN provider_transfer_status text,
    ADD COLUMN provider_transfer_error text,
    ADD COLUMN initiated_at timestamptz,
    ADD COLUMN completed_at timestamptz,
    ADD COLUMN failed_at timestamptz,
    ADD COLUMN reversed_at timestamptz,
    ADD COLUMN notes_ext text;

CREATE INDEX idx_merchant_payouts_provider_transfer
    ON merchant_payouts(provider, provider_transfer_id)
    WHERE provider_transfer_id IS NOT NULL;
CREATE INDEX idx_merchant_payouts_bank_account
    ON merchant_payouts(bank_account_id)
    WHERE bank_account_id IS NOT NULL;

-- Widen the payout_status CHECK to include the new provider lifecycle states.
-- Existing rows use 'pending' / 'processing' / 'paid' / 'failed' — keep all of those
-- and add 'initiated', 'completed', 'reversed', 'cancelled'.
ALTER TABLE merchant_payouts DROP CONSTRAINT IF EXISTS merchant_payouts_payout_status_check;
ALTER TABLE merchant_payouts ADD CONSTRAINT merchant_payouts_payout_status_check
    CHECK (payout_status IN ('pending','initiated','processing','completed','failed','reversed','paid','cancelled'));

-- ----------------------
-- 5) Wire organizations.subscription_tier to the seeded plans.
-- Seed rows are already inserted above (step 1) so this FK is satisfied for
-- existing orgs defaulted to 'free'.
-- ----------------------
ALTER TABLE organizations
    ADD CONSTRAINT fk_organizations_subscription_tier
    FOREIGN KEY (subscription_tier) REFERENCES subscription_plans(tier_code) ON UPDATE CASCADE ON DELETE RESTRICT;
