-- Migration 056: make country, currency, tax, timezone and locale configuration
-- rather than schema constants.
--
-- BeepBite was built for one country and the schema said so out loud: every
-- currency column defaulted to 'ZAR', orders.tax_rate defaulted to 15.00 (South
-- African VAT), delivery_fee defaulted to 25.00 and free_delivery_threshold to
-- 150.00 (rand amounts, meaningless in yen or dollars), and there was no column
-- anywhere for a location's timezone or locale.
--
-- Two changes, in opposite directions:
--
--   1. ADD the settings that were missing. A location now carries its own IANA
--      timezone, BCP-47 locale, tax rate, tax-inclusive flag, tax label and
--      phone dial code. These are what internal/locations resolves and what
--      internal/{money,tax,bizday} consume.
--
--   2. REMOVE the country-specific defaults. Not by replacing them with a
--      different country's — a DEFAULT 'USD'/8.875%/exclusive schema is the same
--      bug wearing a different flag — but with genuinely neutral values: no
--      currency assumed, no tax assumed, UTC, no locale.
--
-- EXISTING ROWS ARE NOT REWRITTEN. Every currency_code already set to 'ZAR'
-- stays 'ZAR'; every order keeps the tax_rate it was charged at. Changing a
-- DEFAULT in Postgres affects only future inserts, and historical takings must
-- never be restated by a deployment. Existing locations get timezone 'UTC',
-- which is exactly the boundary the code used before this migration — so day
-- boundaries do not shift under anyone's feet on upgrade.

-- ---------------------------------------------------------------------------
-- 1. New per-location settings
-- ---------------------------------------------------------------------------

ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS timezone           text          NOT NULL DEFAULT 'UTC',
    ADD COLUMN IF NOT EXISTS locale             text,
    ADD COLUMN IF NOT EXISTS tax_rate           decimal(5,2)  NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS tax_inclusive      boolean       NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS tax_label          text,
    ADD COLUMN IF NOT EXISTS phone_country_code text;

COMMENT ON COLUMN locations.timezone IS
    'IANA timezone name, e.g. ''Europe/Lisbon'', ''America/New_York''. Defines '
    'the trading day: order-number counter resets, cash-drawer close, shift '
    'reports and "today''s sales" are all computed as local calendar days in '
    'this zone (internal/bizday). Timestamps remain stored in UTC — only the '
    'boundaries are local. Defaults to UTC, which is both neutral and the '
    'behaviour that predated this column.';

COMMENT ON COLUMN locations.locale IS
    'BCP-47 locale, e.g. ''pt-PT'', ''ja-JP''. Controls presentation only: '
    'number grouping, decimal separator, currency symbol placement and date '
    'format. It never changes an amount and never changes which currency an '
    'amount is in. NULL means CLDR root formatting, which belongs to no country '
    '— a neutral fallback rather than someone else''s convention.';

COMMENT ON COLUMN locations.tax_rate IS
    'Effective sales-tax rate as a percentage, e.g. 15.00 (ZA VAT), 23.00 (PT), '
    '8.88 (NYC), 0.00 (tax-exempt or not yet configured). Zero is the default '
    'because inventing a tax rate for an operator is worse than charging none: '
    'one is a visible gap, the other is a silent overcharge. The tax_rates '
    'table remains the source for locations needing multiple named rates.';

COMMENT ON COLUMN locations.tax_inclusive IS
    'Whether menu/item prices ALREADY CONTAIN the tax. true is the VAT/GST '
    'convention (ZA, EU, UK, AU, JP): the shelf price is the price and the '
    'receipt shows how much of it was tax. false is the US/CA sales-tax '
    'convention: tax is added at the register. This is a genuine country '
    'difference, not a display preference — the same price and rate produce '
    'different totals — so it must be set per location, and is snapshotted onto '
    'each order so a later settings change cannot restate past sales.';

COMMENT ON COLUMN locations.tax_label IS
    'What the receipt calls the tax: ''VAT'', ''GST'', ''Sales Tax'', '
    '''Consumption Tax''. NULL falls back to the generic ''Tax''. Printing '
    '''VAT'' on a US receipt is a factual error, so this is not cosmetic.';

COMMENT ON COLUMN locations.phone_country_code IS
    'E.164 country calling code WITHOUT the plus, e.g. ''27'', ''1'', ''351''. '
    'Used to promote a locally-typed customer number (''082 123 4567'') to '
    'E.164 before it is stored or handed to WhatsApp, so the same person is not '
    'created twice under two spellings. NULL means numbers must already be '
    'E.164 — no country is guessed.';

-- Timezone shape only. Postgres forbids subqueries in CHECK constraints, so the
-- authoritative "is this a real zone?" test cannot live here — it is done in Go
-- by bizday.ZoneStrict against the tzdata the server actually uses, which is
-- the set that matters anyway. This constraint just stops obvious garbage
-- ('SAST', '+02:00', free text) reaching the column.
ALTER TABLE locations
    DROP CONSTRAINT IF EXISTS locations_timezone_shape;
ALTER TABLE locations
    ADD CONSTRAINT locations_timezone_shape
    CHECK (timezone = 'UTC' OR timezone ~ '^[A-Za-z_]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?$');

ALTER TABLE locations
    DROP CONSTRAINT IF EXISTS locations_tax_rate_range;
ALTER TABLE locations
    ADD CONSTRAINT locations_tax_rate_range
    CHECK (tax_rate >= 0 AND tax_rate <= 100);

-- Dial codes are 1–4 digits, no plus, no spaces.
ALTER TABLE locations
    DROP CONSTRAINT IF EXISTS locations_phone_country_code_format;
ALTER TABLE locations
    ADD CONSTRAINT locations_phone_country_code_format
    CHECK (phone_country_code IS NULL OR phone_country_code ~ '^[0-9]{1,4}$');

-- ---------------------------------------------------------------------------
-- 2. Drop the ZAR currency defaults
-- ---------------------------------------------------------------------------
-- A currency default is never right for a second country, and a wrong one is
-- worse than none: a row inserted without an explicit currency silently becomes
-- rand-denominated and every downstream total is misread. With no default the
-- column is NULL, which callers already handle (COALESCE chains throughout the
-- handlers) and which reads unambiguously as "not configured".

ALTER TABLE organizations ALTER COLUMN default_currency_code DROP DEFAULT;
ALTER TABLE locations     ALTER COLUMN currency_code         DROP DEFAULT;
ALTER TABLE orders        ALTER COLUMN currency_code         DROP DEFAULT;

-- The satellite tables carry the same 'ZAR' default. These columns are NOT NULL
-- with a char_length = 3 CHECK, so there is no neutral placeholder value to put
-- there — and inventing one ('XXX') would just move the guess.
--
-- Dropping the default instead makes the column REQUIRED at insert time. That
-- is the point: every one of these rows belongs to a location whose currency is
-- already known, so the writer should say which currency it means rather than
-- inherit a country. Any INSERT that omitted it now fails loudly at the boundary
-- instead of quietly denominating a Tokyo supplier invoice in rand.
ALTER TABLE staff_pay_rates    ALTER COLUMN currency         DROP DEFAULT;
ALTER TABLE suppliers          ALTER COLUMN default_currency DROP DEFAULT;
ALTER TABLE purchase_orders    ALTER COLUMN currency         DROP DEFAULT;
ALTER TABLE supplier_invoices  ALTER COLUMN currency         DROP DEFAULT;
ALTER TABLE gift_cards         ALTER COLUMN currency         DROP DEFAULT;
ALTER TABLE store_credits      ALTER COLUMN currency         DROP DEFAULT;
ALTER TABLE house_accounts     ALTER COLUMN currency         DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. Drop the South African VAT default on orders
-- ---------------------------------------------------------------------------
-- orders.tax_rate defaulted to 15.00 and tax_inclusive to true — i.e. any order
-- written without explicit tax fields was charged South African VAT. The rate
-- now defaults to 0 and the writing code resolves the location's configured
-- rate; tax_inclusive keeps its true default only so that existing inclusive
-- deployments are unaffected, and is always written explicitly from the
-- location setting by internal/handlers.

ALTER TABLE orders ALTER COLUMN tax_rate SET DEFAULT 0.00;

COMMENT ON COLUMN orders.tax_rate IS
    'The rate this order was actually taxed at, snapshotted from the location at '
    'order time. Never recomputed — a rate change must not restate past sales.';
COMMENT ON COLUMN orders.tax_inclusive IS
    'Whether this order''s line prices already contained the tax, snapshotted '
    'from locations.tax_inclusive at order time.';

-- tax_rates.is_inclusive carried the same assumption in its comment.
COMMENT ON COLUMN tax_rates.is_inclusive IS
    'true = prices already include this tax (the VAT/GST convention used in ZA, '
    'the EU, the UK, AU and JP). false = tax is added at the register (the US/CA '
    'sales-tax convention). Set from the location''s configuration, not assumed.';

-- ---------------------------------------------------------------------------
-- 4. Drop the rand-denominated numeric defaults
-- ---------------------------------------------------------------------------
-- 25.00 and 150.00 are not neutral numbers. As a delivery fee they are ~R25
-- (about $1.40) — but the same literal in a JPY location means ¥25, and in a
-- KWD location it means about $80. A money default that is only sane in one
-- currency has to be zero.
--
-- auto_gratuity_percent defaulted to 18.00, a US tipping norm that was never
-- right for the South African deployment either — and mandatory service charges
-- are illegal or unusual in several jurisdictions. It defaults off (0) and the
-- operator opts in.

ALTER TABLE locations ALTER COLUMN delivery_fee            SET DEFAULT 0.00;
ALTER TABLE locations ALTER COLUMN free_delivery_threshold SET DEFAULT 0.00;
ALTER TABLE locations ALTER COLUMN auto_gratuity_percent   SET DEFAULT 0.00;

COMMENT ON COLUMN locations.delivery_fee IS
    'Delivery fee in MAJOR units of the location''s currency_code. Defaults to '
    '0: any non-zero default is a fixed number of rand/dollars/yen and is wrong '
    'in every currency but the one it was written for.';

-- ---------------------------------------------------------------------------
-- 5. Country becomes meaningful
-- ---------------------------------------------------------------------------
-- The column existed and was documented as ISO 3166-1 alpha-2 but accepted any
-- text. It is the anchor for defaulting a new location's timezone, currency,
-- locale and dial code in the UI, so it needs to actually be a country code.

ALTER TABLE locations
    DROP CONSTRAINT IF EXISTS locations_country_iso3166;
ALTER TABLE locations
    ADD CONSTRAINT locations_country_iso3166
    CHECK (country IS NULL OR country ~ '^[A-Z]{2}$');

COMMENT ON COLUMN locations.country IS
    'ISO 3166-1 alpha-2, uppercase. Not itself used for money or time — those '
    'come from currency_code and timezone — but it is what the onboarding UI '
    'uses to suggest sensible values for them.';

-- ---------------------------------------------------------------------------
-- 6. Widen the currency reference data
-- ---------------------------------------------------------------------------
-- The seeded set was USD, ZAR, NGN, KES, GHS, EUR, GBP, INR — eight currencies,
-- every one of them with decimal_digits = 2. That made decimal_digits look
-- handled while encoding no information, and left the /100-is-a-bug claim
-- untestable against real data.
--
-- Adding currencies with 0 and 3 decimals makes the exponent load-bearing:
-- JPY 1000 is ¥1,000 and KWD 1000 is KD 1.000, and any code path that still
-- divides by 100 now produces a visibly wrong number instead of a coincidentally
-- right one.

INSERT INTO currencies (code, name, symbol, decimal_digits, is_active) VALUES
    ('JPY', 'Japanese Yen',            '¥',   0, true),
    ('KRW', 'South Korean Won',        '₩',   0, true),
    ('ISK', 'Icelandic Króna',         'kr',  0, true),
    ('CLP', 'Chilean Peso',            '$',   0, true),
    ('VND', 'Vietnamese Dong',         '₫',   0, true),
    ('UGX', 'Ugandan Shilling',        'USh', 0, true),
    ('RWF', 'Rwandan Franc',           'FRw', 0, true),
    ('XOF', 'West African CFA Franc',  'CFA', 0, true),
    ('XAF', 'Central African CFA Franc','FCFA',0, true),
    ('KWD', 'Kuwaiti Dinar',           'د.ك', 3, true),
    ('BHD', 'Bahraini Dinar',          '.د.ب',3, true),
    ('OMR', 'Omani Rial',              'ر.ع.',3, true),
    ('JOD', 'Jordanian Dinar',         'د.ا', 3, true),
    ('TND', 'Tunisian Dinar',          'د.ت', 3, true),
    ('AUD', 'Australian Dollar',       '$',   2, true),
    ('CAD', 'Canadian Dollar',         '$',   2, true),
    ('NZD', 'New Zealand Dollar',      '$',   2, true),
    ('CHF', 'Swiss Franc',             'CHF', 2, true),
    ('SEK', 'Swedish Krona',           'kr',  2, true),
    ('NOK', 'Norwegian Krone',         'kr',  2, true),
    ('DKK', 'Danish Krone',            'kr',  2, true),
    ('PLN', 'Polish Złoty',            'zł',  2, true),
    ('CZK', 'Czech Koruna',            'Kč',  2, true),
    ('BRL', 'Brazilian Real',          'R$',  2, true),
    ('MXN', 'Mexican Peso',            '$',   2, true),
    ('ARS', 'Argentine Peso',          '$',   2, true),
    ('SGD', 'Singapore Dollar',        '$',   2, true),
    ('HKD', 'Hong Kong Dollar',        'HK$', 2, true),
    ('MYR', 'Malaysian Ringgit',       'RM',  2, true),
    ('THB', 'Thai Baht',               '฿',   2, true),
    ('IDR', 'Indonesian Rupiah',       'Rp',  2, true),
    ('PHP', 'Philippine Peso',         '₱',   2, true),
    ('AED', 'UAE Dirham',              'د.إ', 2, true),
    ('SAR', 'Saudi Riyal',             'ر.س', 2, true),
    ('ILS', 'Israeli New Shekel',      '₪',   2, true),
    ('TRY', 'Turkish Lira',            '₺',   2, true),
    ('EGP', 'Egyptian Pound',          'E£',  2, true),
    ('MAD', 'Moroccan Dirham',         'د.م.',2, true),
    ('TZS', 'Tanzanian Shilling',      'TSh', 2, true),
    ('ZMW', 'Zambian Kwacha',          'ZK',  2, true),
    ('BWP', 'Botswana Pula',           'P',   2, true),
    ('NAD', 'Namibian Dollar',         '$',   2, true),
    ('MUR', 'Mauritian Rupee',         '₨',   2, true),
    ('PKR', 'Pakistani Rupee',         '₨',   2, true),
    ('BDT', 'Bangladeshi Taka',        '৳',   2, true),
    ('LKR', 'Sri Lankan Rupee',        'Rs',  2, true),
    ('CNY', 'Chinese Yuan',            '¥',   2, true),
    ('RUB', 'Russian Ruble',           '₽',   2, true),
    ('UAH', 'Ukrainian Hryvnia',       '₴',   2, true),
    ('RON', 'Romanian Leu',            'lei', 2, true),
    ('HUF', 'Hungarian Forint',        'Ft',  2, true),
    ('COP', 'Colombian Peso',          '$',   2, true),
    ('PEN', 'Peruvian Sol',            'S/',  2, true)
ON CONFLICT (code) DO NOTHING;

COMMENT ON COLUMN currencies.decimal_digits IS
    'ISO 4217 minor-unit exponent: 2 for most, 0 for JPY/KRW/ISK/CLP/VND/XOF, '
    '3 for the Gulf dinars (KWD/BHD/OMR/JOD/TND). This is the ONLY correct '
    'source for the amount↔minor-unit conversion. A literal /100 in application '
    'code is a bug: it renders ¥1000 as ¥10 and KD 1.000 as KD 10.00.';
