
-- ======================
-- MULTI-CURRENCY SUPPORT
-- Additive only — no existing columns renamed or retyped.
-- Default currency is ZAR for all existing rows.
--
-- NOTE: regions.currency (TEXT, ISO 4217) already exists from migration 26.
-- The new currencies table uses `code` as PK (same ISO 4217 values) rather
-- than duplicating the column, so there is no name collision. The regions
-- table retains its own denormalised `currency` text column for fast lookup;
-- it can be FK'd to currencies.code in a future migration if desired.
-- ======================

-- 1) Currencies reference table.
CREATE TABLE currencies (
  code            TEXT        PRIMARY KEY,           -- ISO 4217 3-letter code
  name            TEXT        NOT NULL,
  symbol          TEXT        NOT NULL,
  decimal_digits  INT         NOT NULL DEFAULT 2,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) Seed the six launch currencies. ZAR is the existing default.
INSERT INTO currencies (code, name, symbol) VALUES
  ('ZAR', 'South African Rand',  'R'),
  ('USD', 'US Dollar',           '$'),
  ('EUR', 'Euro',                '€'),
  ('GBP', 'British Pound',       '£'),
  ('NGN', 'Nigerian Naira',      '₦'),
  ('KES', 'Kenyan Shilling',     'KSh')
ON CONFLICT (code) DO NOTHING;

-- 3) Organizations get a default currency (ZAR for existing rows).
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_currency_code TEXT
    REFERENCES currencies(code)
    DEFAULT 'ZAR';

COMMENT ON COLUMN organizations.default_currency_code IS
  'Default ISO-4217 currency code for new orders. ZAR for existing orgs.';

-- 4) Orders carry the currency in effect at write time + an FX rate snapshot.
--    fx_rate_to_zar lets historical orders keep their original valuation even
--    if the org later changes its default currency.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS currency_code    TEXT           REFERENCES currencies(code) DEFAULT 'ZAR',
  ADD COLUMN IF NOT EXISTS fx_rate_to_zar  NUMERIC(18, 8) DEFAULT 1;

COMMENT ON COLUMN orders.currency_code IS
  'ISO-4217 currency in which this order was placed.';
COMMENT ON COLUMN orders.fx_rate_to_zar IS
  'Multiplier to convert this order''s amount_cents into ZAR-cents. 1 for ZAR-native orders.';

-- 5) Subscription plans carry a currency for the monthly fee.
ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS billed_in_currency_code TEXT
    REFERENCES currencies(code)
    DEFAULT 'ZAR';

COMMENT ON COLUMN subscription_plans.billed_in_currency_code IS
  'ISO-4217 currency in which the subscription fee is billed. ZAR for existing plans.';

