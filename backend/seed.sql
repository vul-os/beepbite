-- =============================================================
-- BeepBite Seed File
-- Test user: owner@example.com  /  ChangeMe123!
-- Safe to re-run (idempotent).
-- =============================================================
--
-- LOCALE IS CONFIGURATION, NOT A CONSTANT
-- ---------------------------------------
-- This file used to describe one specific restaurant in one specific country:
-- rand prices, +27 phone numbers, .co.za addresses, a Cape Town street, and a
-- 15%-inclusive VAT written as the literal expression `total * 15 / 115`. That
-- made every seeded database a South African database, and it meant the seed
-- data never exercised a currency with a different exponent or a tax computed
-- the other way round — so the multi-currency code was untested by the very
-- data that existed to test it.
--
-- Moving the restaurant to Chicago would have been the same bug with a
-- different flag. So the locale is now a set of psql variables, and the
-- defaults are deliberately fictional. They mirror backend/internal/seedlocale
-- exactly, so the SQL and Go seeding paths cannot disagree about what an
-- unconfigured demo database looks like.
--
--   seed_country       ZZ      ISO 3166-1 user-assigned code meaning "unknown"
--   seed_currency      XTS     ISO 4217 code reserved for testing; never money
--   seed_decimals      2       minor-unit exponent for the above
--   seed_timezone      UTC     neutral, and what migration 056 defaults to
--   seed_locale        ''      CLDR root formatting, which belongs to no country
--   seed_tax_rate      10.00   a round, invented rate; not any jurisdiction's
--   seed_tax_inclusive true    matches the schema default
--   seed_tax_label     Tax     a generic word, not "VAT" or "Sales Tax"
--   seed_phone_cc      999     E.164 code reserved by the ITU; unroutable
--
-- XTS and 999 are the load-bearing ones. Both are reserved by their respective
-- standards precisely so that test data is recognisable as test data: an XTS
-- amount can never be mistaken for real takings in a screenshot or a support
-- ticket, and a +999 number can never be dialled — which matters because demo
-- data gets loaded into staging environments wired to live WhatsApp
-- credentials, where a seeded number belonging to a real person receives real
-- messages about an order that does not exist. Defaulting to USD and +1 would
-- be indistinguishable from production data.
--
-- Every value is overridable from the command line, e.g.
--   psql -v seed_currency=EUR -v seed_country=PT -v seed_tax_rate=23.00 \
--        -v seed_tax_inclusive=true -v seed_phone_cc=351 -f seed.sql
-- The \if :{?var} guard is what makes -v win: a bare \set would clobber it.
-- =============================================================

\if :{?seed_country}
\else
\set seed_country 'ZZ'
\endif

\if :{?seed_currency}
\else
\set seed_currency 'XTS'
\endif

\if :{?seed_decimals}
\else
\set seed_decimals 2
\endif

\if :{?seed_timezone}
\else
\set seed_timezone 'UTC'
\endif

\if :{?seed_locale}
\else
\set seed_locale ''
\endif

\if :{?seed_tax_rate}
\else
\set seed_tax_rate 10.00
\endif

\if :{?seed_tax_inclusive}
\else
\set seed_tax_inclusive true
\endif

\if :{?seed_tax_label}
\else
\set seed_tax_label 'Tax'
\endif

\if :{?seed_phone_cc}
\else
\set seed_phone_cc '999'
\endif

\if :{?seed_email_domain}
\else
-- RFC 2606 reserves example.com so seeded mail can never leave the building.
\set seed_email_domain 'example.com'
\endif

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------
-- Hoist the psql variables into session settings.
--
-- psql substitutes :vars during lexing, BEFORE the server sees the text — but
-- it does not look inside dollar-quoted strings, because their contents are
-- opaque to it. Every :'seed_currency' written inside a `DO $do$ ... $do$`
-- body would therefore reach PL/pgSQL verbatim and fail to parse. Custom GUCs
-- bridge that gap: set here, in plain top-level SQL where interpolation works,
-- and read inside the DO blocks with current_setting(), which is ordinary
-- runtime SQL and needs no interpolation at all.
--
-- is_local = false so the settings survive for the whole psql session rather
-- than only the enclosing transaction.
-- -------------------------------------------------------------
SELECT set_config('beepbite.seed_country',       :'seed_country',       false),
       set_config('beepbite.seed_currency',      :'seed_currency',      false),
       set_config('beepbite.seed_decimals',      :'seed_decimals',      false),
       set_config('beepbite.seed_timezone',      :'seed_timezone',      false),
       set_config('beepbite.seed_locale',        :'seed_locale',        false),
       set_config('beepbite.seed_tax_rate',      :'seed_tax_rate',      false),
       set_config('beepbite.seed_tax_inclusive', :'seed_tax_inclusive', false),
       set_config('beepbite.seed_tax_label',     :'seed_tax_label',     false),
       set_config('beepbite.seed_phone_cc',      :'seed_phone_cc',      false),
       set_config('beepbite.seed_email_domain',  :'seed_email_domain',  false);

-- -------------------------------------------------------------
-- STEP 0: Make the configured currency exist.
--
-- Every currency column in the schema is a foreign key to currencies(code),
-- and the default XTS is deliberately NOT one of the currencies migration 056
-- ships — that is the point of a reserved code. So it has to be registered
-- before anything priced in it is inserted. This also lets an operator seed in
-- a currency the migrations do not carry without editing a migration to do it.
--
-- Upsert, never overwrite: seeding with -v seed_currency=EUR must not rewrite
-- the real EUR row's name or symbol with a placeholder.
-- -------------------------------------------------------------
INSERT INTO currencies (code, name, symbol, decimal_digits, is_active)
VALUES (
    :'seed_currency',
    CASE WHEN :'seed_currency' = 'XTS' THEN 'Test Currency (placeholder)' ELSE :'seed_currency' END,
    CASE WHEN :'seed_currency' = 'XTS' THEN '¤'                          ELSE :'seed_currency' END,
    :seed_decimals,
    true
)
ON CONFLICT (code) DO UPDATE
    SET decimal_digits = EXCLUDED.decimal_digits,
        is_active      = true;

-- =============================================================
-- STEP 1: Upsert auth_users
-- The on_auth_user_created trigger fires on INSERT and auto-creates
-- a profile, organisation, location and org_member row.  We use
-- ON CONFLICT … DO UPDATE so that RETURNING always gives us the id
-- (whether it was just inserted or already existed).
-- On a re-run the trigger does NOT fire again (trigger is AFTER INSERT
-- only), so no duplicate org/location is created.
-- =============================================================

WITH upsert_user AS (
    INSERT INTO auth_users (email, password_hash, email_verified)
    VALUES (
        'owner@example.com',
        crypt('ChangeMe123!', gen_salt('bf', 10)),
        true
    )
    ON CONFLICT (email) DO UPDATE
        SET email_verified = true,
            updated_at     = timezone('utc'::text, now())
    RETURNING id
),

-- =============================================================
-- STEP 2: Upsert profile (trigger may already have created it)
-- =============================================================
upsert_profile AS (
    INSERT INTO profiles (id, full_name, email, username)
    SELECT id, 'Demo Owner', 'owner@example.com', 'demoowner'
    FROM   upsert_user
    ON CONFLICT (id) DO UPDATE
        SET full_name  = EXCLUDED.full_name,
            updated_at = timezone('utc'::text, now())
    RETURNING id
),

-- =============================================================
-- STEP 3: Upsert organisation
-- Trigger may have created one already — find it via org_members
-- if the INSERT conflicts on name (it might not conflict because the
-- trigger uses a derived name like "Andilemvumvu2's Organization").
-- Strategy: INSERT with a deterministic name collision approach.
-- We identify the org owned by this profile via organization_members,
-- then UPDATE its name/details.  We do this in two parts:
--   a) ensure an org exists (insert or ignore)
--   b) UPDATE name to the canonical value
-- =============================================================

-- Find the org already linked to this profile (created by trigger)
find_org AS (
    SELECT om.organization_id AS id
    FROM   organization_members om
    JOIN   upsert_profile up ON up.id = om.profile_id
    WHERE  om.role = 'owner'
    LIMIT  1
),

-- Rename it to the desired name
rename_org AS (
    UPDATE organizations
    SET    name       = 'Example Restaurant',
           updated_at = timezone('utc'::text, now())
    FROM   find_org
    WHERE  organizations.id = find_org.id
    RETURNING organizations.id
),

org AS (
    SELECT id FROM rename_org
    UNION ALL
    SELECT id FROM find_org
    WHERE  NOT EXISTS (SELECT 1 FROM rename_org)
    LIMIT  1
),

-- =============================================================
-- STEP 4: Upsert location under the org
-- Trigger created one; update it to desired details.
-- =============================================================
find_location AS (
    SELECT l.id
    FROM   locations l
    JOIN   org ON org.id = l.organization_id
    LIMIT  1
),

rename_location AS (
    UPDATE locations
    SET    name       = 'Example Restaurant',
           -- A street that cannot be visited, in a city that does not exist.
           address    = '1 Example Street, Example City',
           -- 0,0 is in the Gulf of Guinea. Nothing is there, which is exactly
           -- what an unconfigured demo location should look like on a map —
           -- unlike a real city centre, which looks like a deployment.
           latitude   = 0.0000000,
           longitude  = 0.0000000,
           -- Drive the region from the configured country, and degrade rather
           -- than fail: a database with no matching regions row (the default
           -- 'ZZ' has none, by design) keeps whatever region it already had
           -- instead of aborting the entire seed.
           region_id  = COALESCE(
                            (SELECT r.id FROM regions r WHERE r.code = :'seed_country'),
                            locations.region_id
                        ),
           updated_at = timezone('utc'::text, now())
    FROM   find_location
    WHERE  locations.id = find_location.id
    RETURNING locations.id
),

location AS (
    SELECT id FROM rename_location
    UNION ALL
    SELECT id FROM find_location
    WHERE  NOT EXISTS (SELECT 1 FROM rename_location)
    LIMIT  1
),

-- =============================================================
-- STEP 5: Ensure organization_members owner row
-- =============================================================
ensure_org_member AS (
    INSERT INTO organization_members (organization_id, profile_id, role)
    SELECT org.id, upsert_profile.id, 'owner'
    FROM   org, upsert_profile
    ON CONFLICT (organization_id, profile_id) DO UPDATE
        SET role       = 'owner',
            updated_at = timezone('utc'::text, now())
    RETURNING id
),

-- =============================================================
-- STEP 6: Categories (4)
-- UNIQUE(location_id, name) — safe to re-run with ON CONFLICT DO NOTHING
-- =============================================================
cat_burgers AS (
    INSERT INTO categories (location_id, name, description, sort_order, is_active)
    SELECT location.id, 'Burgers', 'Flame-grilled burgers', 1, true
    FROM   location
    ON CONFLICT (location_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
    RETURNING id
),
cat_sides AS (
    INSERT INTO categories (location_id, name, description, sort_order, is_active)
    SELECT location.id, 'Sides', 'Great sides to go with your meal', 2, true
    FROM   location
    ON CONFLICT (location_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
    RETURNING id
),
cat_drinks AS (
    INSERT INTO categories (location_id, name, description, sort_order, is_active)
    SELECT location.id, 'Drinks', 'Cold beverages', 3, true
    FROM   location
    ON CONFLICT (location_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
    RETURNING id
),
cat_desserts AS (
    INSERT INTO categories (location_id, name, description, sort_order, is_active)
    SELECT location.id, 'Desserts', 'Sweet treats', 4, true
    FROM   location
    ON CONFLICT (location_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order
    RETURNING id
),

-- =============================================================
-- STEP 7: Items (12)
-- No UNIQUE on items; guard with WHERE NOT EXISTS per item name+location
-- =============================================================
item_classic_burger AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_burgers.id,
           'Classic Burger', '100% beef patty, lettuce, tomato, pickles', 59.99, true, 1
    FROM   location, cat_burgers
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Classic Burger'
    )
    RETURNING id
),
item_bacon_cheese AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_burgers.id,
           'Bacon Cheeseburger', 'Beef patty, crispy bacon, cheddar, BBQ sauce', 74.99, true, 2
    FROM   location, cat_burgers
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Bacon Cheeseburger'
    )
    RETURNING id
),
item_veggie AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_burgers.id,
           'Veggie Burger', 'Lentil patty, avocado, sprouts, aioli', 54.99, true, 3
    FROM   location, cat_burgers
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Veggie Burger'
    )
    RETURNING id
),
item_chicken AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_burgers.id,
           'Chicken Burger', 'Grilled chicken breast, coleslaw, mayo', 62.99, true, 4
    FROM   location, cat_burgers
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Chicken Burger'
    )
    RETURNING id
),
item_fries AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_sides.id,
           'Fries', 'Crispy golden fries with seasoning', 24.99, true, 1
    FROM   location, cat_sides
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Fries'
    )
    RETURNING id
),
item_onion_rings AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_sides.id,
           'Onion Rings', 'Beer-battered onion rings', 29.99, true, 2
    FROM   location, cat_sides
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Onion Rings'
    )
    RETURNING id
),
item_sweet_potato AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_sides.id,
           'Sweet Potato Fries', 'Oven-baked sweet potato fries', 29.99, true, 3
    FROM   location, cat_sides
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Sweet Potato Fries'
    )
    RETURNING id
),
item_coke AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_drinks.id,
           'Coke', 'Ice-cold Coca-Cola 330ml', 15.00, true, 1
    FROM   location, cat_drinks
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Coke'
    )
    RETURNING id
),
item_sprite AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_drinks.id,
           'Sprite', 'Sparkling lemon-lime 330ml', 15.00, true, 2
    FROM   location, cat_drinks
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Sprite'
    )
    RETURNING id
),
item_water AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_drinks.id,
           'Bottled Water', 'Still mineral water 500ml', 12.00, true, 3
    FROM   location, cat_drinks
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Bottled Water'
    )
    RETURNING id
),
item_brownie AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_desserts.id,
           'Chocolate Brownie', 'Warm fudge brownie with vanilla ice cream', 35.00, true, 1
    FROM   location, cat_desserts
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Chocolate Brownie'
    )
    RETURNING id
),
item_ice_cream AS (
    INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
    SELECT location.id, cat_desserts.id,
           'Ice Cream', 'Two scoops of vanilla or chocolate ice cream', 29.00, true, 2
    FROM   location, cat_desserts
    WHERE  NOT EXISTS (
        SELECT 1 FROM items i WHERE i.location_id = location.id AND i.name = 'Ice Cream'
    )
    RETURNING id
),

-- =============================================================
-- STEP 8: Customers (5) — UNIQUE(whatsapp_number)
--
-- Numbers are built as +<dial code>5550<6 digits>. With the default dial code
-- 999 (ITU-reserved, assigned to no country) the result is unroutable by
-- construction, so seed data cannot text a stranger. The 5550 prefix keeps the
-- numbers looking synthetic even when an operator overrides the dial code to a
-- live country — though at that point they are only conventionally unassigned,
-- which is a reason to leave the default alone.
-- =============================================================
cust_1 AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+' || :'seed_phone_cc' || '5550000001', 'Alex', 'Example',
            'alex.example@' || :'seed_email_domain')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),
cust_2 AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+' || :'seed_phone_cc' || '5550000002', 'Blair', 'Example',
            'blair.example@' || :'seed_email_domain')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),
cust_3 AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+' || :'seed_phone_cc' || '5550000003', 'Casey', 'Example',
            'casey.example@' || :'seed_email_domain')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),
cust_4 AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+' || :'seed_phone_cc' || '5550000004', 'Devon', 'Example',
            'devon.example@' || :'seed_email_domain')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),
cust_5 AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+' || :'seed_phone_cc' || '5550000005', 'Emery', 'Example',
            'emery.example@' || :'seed_email_domain')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),

-- =============================================================
-- STEP 9: Staff (3)
-- UNIQUE on email and UNIQUE INDEX on (location_id, lower(username))
-- =============================================================
staff_manager AS (
    INSERT INTO staff (
        location_id, first_name, last_name, email, phone,
        username, password_hash, pin_hash, role, is_active,
        hire_date, employee_id
    )
    SELECT
        location.id,
        'Morgan', 'Example',
        'morgan.example@' || :'seed_email_domain',
        '+' || :'seed_phone_cc' || '5550000101',
        'morgan',
        crypt('Manager@2024', gen_salt('bf', 10)),
        crypt('1234', gen_salt('bf', 10)),
        'manager', true,
        '2023-01-15', 'EMP-001'
    FROM location
    ON CONFLICT (email) DO UPDATE
        SET role       = EXCLUDED.role,
            updated_at = timezone('utc'::text, now())
    RETURNING id
),
staff_cashier AS (
    INSERT INTO staff (
        location_id, first_name, last_name, email, phone,
        username, password_hash, pin_hash, role, is_active,
        hire_date, employee_id
    )
    SELECT
        location.id,
        'Riley', 'Example',
        'riley.example@' || :'seed_email_domain',
        '+' || :'seed_phone_cc' || '5550000102',
        'riley',
        crypt('Cashier@2024', gen_salt('bf', 10)),
        crypt('2345', gen_salt('bf', 10)),
        'cashier', true,
        '2023-03-20', 'EMP-002'
    FROM location
    ON CONFLICT (email) DO UPDATE
        SET role       = EXCLUDED.role,
            updated_at = timezone('utc'::text, now())
    RETURNING id
),
staff_kitchen AS (
    INSERT INTO staff (
        location_id, first_name, last_name, email, phone,
        username, password_hash, pin_hash, role, is_active,
        hire_date, employee_id
    )
    SELECT
        location.id,
        'Sam', 'Example',
        'sam.example@' || :'seed_email_domain',
        '+' || :'seed_phone_cc' || '5550000103',
        'sam',
        crypt('Kitchen@2024', gen_salt('bf', 10)),
        crypt('3456', gen_salt('bf', 10)),
        'kitchen', true,
        '2023-06-01', 'EMP-003'
    FROM location
    ON CONFLICT (email) DO UPDATE
        SET role       = EXCLUDED.role,
            updated_at = timezone('utc'::text, now())
    RETURNING id
)

-- Final SELECT to prevent "WITH" with no final statement error
SELECT
    (SELECT id FROM upsert_user)         AS user_id,
    (SELECT id FROM org)                 AS org_id,
    (SELECT id FROM location)            AS location_id,
    (SELECT id FROM staff_manager)       AS manager_staff_id,
    (SELECT id FROM staff_cashier)       AS cashier_staff_id,
    (SELECT id FROM staff_kitchen)       AS kitchen_staff_id;

-- =============================================================
-- STEP 9b: Apply the configured locale to the org and location.
--
-- Migration 056 dropped DEFAULT 'ZAR' from organizations.default_currency_code
-- and locations.currency_code, and added timezone/locale/tax_rate/
-- tax_inclusive/tax_label/phone_country_code alongside country. A row created
-- by the signup trigger therefore now has NO currency at all — not rand, NULL
-- — so the seed has to say which currency it means.
--
-- The SET list is assembled from the columns that actually exist rather than
-- written out, because these columns arrived across several migrations and a
-- database at an earlier revision must degrade to setting fewer of them rather
-- than failing the whole seed on a missing column.
--
-- Values come from current_setting(), not from :vars: this is a dollar-quoted
-- body, which psql treats as opaque text and does not substitute into.
-- =============================================================
DO $do$
DECLARE
    v_loc_id  uuid;
    v_org_id  uuid;
    v_cols    text[];
    v_vals    text[];
    v_sets    text[] := ARRAY[]::text[];
    v_locale  text   := current_setting('beepbite.seed_locale');
    i         integer;
BEGIN
    SELECT l.id, o.id INTO v_loc_id, v_org_id
    FROM   auth_users au
    JOIN   profiles p ON p.id = au.id
    JOIN   organization_members om ON om.profile_id = p.id AND om.role = 'owner'
    JOIN   organizations o ON o.id = om.organization_id
    JOIN   locations l ON l.organization_id = o.id
    WHERE  au.email = 'owner@example.com'
    LIMIT  1;

    IF v_loc_id IS NULL THEN
        RAISE EXCEPTION 'Could not resolve location for owner@example.com';
    END IF;

    v_cols := ARRAY['currency_code','timezone','locale','tax_rate',
                    'tax_inclusive','tax_label','phone_country_code','country'];
    v_vals := ARRAY[
        quote_literal(current_setting('beepbite.seed_currency')),
        quote_literal(current_setting('beepbite.seed_timezone')),
        -- An empty locale means CLDR root, which the column spells as NULL.
        CASE WHEN v_locale = '' THEN 'NULL' ELSE quote_literal(v_locale) END,
        quote_literal(current_setting('beepbite.seed_tax_rate'))      || '::numeric',
        quote_literal(current_setting('beepbite.seed_tax_inclusive')) || '::boolean',
        quote_literal(current_setting('beepbite.seed_tax_label')),
        quote_literal(current_setting('beepbite.seed_phone_cc')),
        quote_literal(upper(current_setting('beepbite.seed_country')))
    ];

    FOR i IN 1..array_length(v_cols, 1) LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE  table_schema = 'public'
              AND  table_name   = 'locations'
              AND  column_name  = v_cols[i]
        ) THEN
            v_sets := v_sets || (quote_ident(v_cols[i]) || ' = ' || v_vals[i]);
        END IF;
    END LOOP;

    IF array_length(v_sets, 1) > 0 THEN
        EXECUTE 'UPDATE locations SET ' || array_to_string(v_sets, ', ')
             || ' WHERE id = $1'
        USING v_loc_id;
    END IF;

    -- The organisation carries the currency new locations inherit.
    IF v_org_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_schema = 'public'
          AND  table_name   = 'organizations'
          AND  column_name  = 'default_currency_code'
    ) THEN
        EXECUTE 'UPDATE organizations SET default_currency_code = $1 WHERE id = $2'
        USING current_setting('beepbite.seed_currency'), v_org_id;
    END IF;
END
$do$;

-- =============================================================
-- STEP 10: Orders + order_details + order_financial_details + order_items
-- We need to resolve item/customer/location IDs here.
-- Use a helper function approach: build orders in a separate CTE block.
-- =============================================================

DO $$
DECLARE
    v_location_id      uuid;
    v_org_id           uuid;
    v_region_id        uuid;
    v_has_org_col      boolean;

    -- Locale, read from the session settings hoisted at the top of this file.
    -- psql does not substitute :vars inside a dollar-quoted body, so every
    -- configured value has to arrive through current_setting() instead.
    v_currency         text    := current_setting('beepbite.seed_currency');
    v_decimals         integer := current_setting('beepbite.seed_decimals')::integer;
    v_tax_rate         numeric := current_setting('beepbite.seed_tax_rate')::numeric;
    v_tax_inclusive    boolean := current_setting('beepbite.seed_tax_inclusive')::boolean;
    v_phone_cc         text    := current_setting('beepbite.seed_phone_cc');

    -- Customers
    v_cust_1           uuid;
    v_cust_2           uuid;
    v_cust_3           uuid;
    v_cust_4           uuid;
    v_cust_5           uuid;

    -- Items
    v_classic_burger   uuid;
    v_bacon_cheese     uuid;
    v_veggie_burger    uuid;
    v_chicken_burger   uuid;
    v_fries            uuid;
    v_onion_rings      uuid;
    v_sweet_potato     uuid;
    v_coke             uuid;
    v_sprite           uuid;
    v_water            uuid;
    v_brownie          uuid;
    v_ice_cream        uuid;

    -- Temp order vars
    v_order_id         uuid;
    v_subtotal         numeric(10,2);
    v_net              numeric(10,2);
    v_tax_amount       numeric(10,2);
    v_total            numeric(10,2);
    v_del_fee          numeric(10,2);
    v_order_number     text;
    v_created_at       timestamptz;

    -- Order number counter
    v_order_seq        integer := 1;

    -- Helper arrays
    type_arr           text[]  := ARRAY['delivery','pickup','dine_in','delivery','pickup',
                                        'dine_in','delivery','pickup','delivery','dine_in',
                                        'delivery','pickup','dine_in','delivery','pickup'];
    status_arr         text[]  := ARRAY['delivered','completed','delivered','cancelled','delivered',
                                        'completed','pending','delivered','completed','cancelled',
                                        'delivered','completed','delivered','pending','completed'];
    day_offset_arr     integer[] := ARRAY[29,27,25,23,21,19,17,15,13,11,9,7,5,3,1];
    i                  integer;

BEGIN
    -- Resolve location
    SELECT l.id, o.id INTO v_location_id, v_org_id
    FROM   auth_users au
    JOIN   profiles p ON p.id = au.id
    JOIN   organization_members om ON om.profile_id = p.id AND om.role = 'owner'
    JOIN   organizations o ON o.id = om.organization_id
    JOIN   locations l ON l.organization_id = o.id
    WHERE  au.email = 'owner@example.com'
    LIMIT  1;

    IF v_location_id IS NULL THEN
        RAISE EXCEPTION 'Could not resolve location for owner@example.com';
    END IF;

    -- Resolve customers by the same constructed numbers STEP 8 inserted. These
    -- must be built from the configured dial code, not from literals, or the
    -- lookups silently return NULL and every seeded order loses its customer.
    SELECT id INTO v_cust_1 FROM customers WHERE whatsapp_number = '+' || v_phone_cc || '5550000001';
    SELECT id INTO v_cust_2 FROM customers WHERE whatsapp_number = '+' || v_phone_cc || '5550000002';
    SELECT id INTO v_cust_3 FROM customers WHERE whatsapp_number = '+' || v_phone_cc || '5550000003';
    SELECT id INTO v_cust_4 FROM customers WHERE whatsapp_number = '+' || v_phone_cc || '5550000004';
    SELECT id INTO v_cust_5 FROM customers WHERE whatsapp_number = '+' || v_phone_cc || '5550000005';

    -- orders.organization_id is NOT NULL in the consolidated schema but absent
    -- from the legacy one this file also has to run against, so the INSERT is
    -- branched rather than assuming either.
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE  table_schema = 'public'
          AND  table_name   = 'orders'
          AND  column_name  = 'organization_id'
    ) INTO v_has_org_col;

    -- Resolve items by name + location
    SELECT id INTO v_classic_burger  FROM items WHERE location_id = v_location_id AND name = 'Classic Burger';
    SELECT id INTO v_bacon_cheese    FROM items WHERE location_id = v_location_id AND name = 'Bacon Cheeseburger';
    SELECT id INTO v_veggie_burger   FROM items WHERE location_id = v_location_id AND name = 'Veggie Burger';
    SELECT id INTO v_chicken_burger  FROM items WHERE location_id = v_location_id AND name = 'Chicken Burger';
    SELECT id INTO v_fries           FROM items WHERE location_id = v_location_id AND name = 'Fries';
    SELECT id INTO v_onion_rings     FROM items WHERE location_id = v_location_id AND name = 'Onion Rings';
    SELECT id INTO v_sweet_potato    FROM items WHERE location_id = v_location_id AND name = 'Sweet Potato Fries';
    SELECT id INTO v_coke            FROM items WHERE location_id = v_location_id AND name = 'Coke';
    SELECT id INTO v_sprite          FROM items WHERE location_id = v_location_id AND name = 'Sprite';
    SELECT id INTO v_water           FROM items WHERE location_id = v_location_id AND name = 'Bottled Water';
    SELECT id INTO v_brownie         FROM items WHERE location_id = v_location_id AND name = 'Chocolate Brownie';
    SELECT id INTO v_ice_cream       FROM items WHERE location_id = v_location_id AND name = 'Ice Cream';

    -- -------------------------------------------------------
    -- Helper: insert one order + financial record + items
    -- (skip if order_number already exists for that day)
    -- -------------------------------------------------------
    FOR i IN 1..15 LOOP
        v_order_number := 'BB-SEED-' || lpad(i::text, 4, '0');
        v_created_at   := timezone('utc'::text, now()) - (day_offset_arr[i] || ' days')::interval;

        -- Skip if already seeded (idempotency via unique index on location+order_number+day)
        IF EXISTS (
            SELECT 1 FROM orders
            WHERE  location_id   = v_location_id
              AND  order_number  = v_order_number
              AND  date_trunc('day', created_at AT TIME ZONE 'UTC')
                   = date_trunc('day', v_created_at AT TIME ZONE 'UTC')
        ) THEN
            CONTINUE;
        END IF;

        -- Insert base order.
        --
        -- currency_code is listed EXPLICITLY. It used to be omitted and picked
        -- up DEFAULT 'ZAR'; migration 056 dropped that default, so an omitted
        -- column now writes NULL and every seeded order becomes an order in no
        -- currency at all — which reads as "free" to anything that COALESCEs.
        IF v_has_org_col THEN
            INSERT INTO orders (
                location_id, organization_id, customer_id, order_number,
                order_type, status, currency_code,
                created_at, updated_at
            )
            VALUES (
                v_location_id,
                v_org_id,
                CASE (i % 5)
                    WHEN 0 THEN v_cust_1
                    WHEN 1 THEN v_cust_2
                    WHEN 2 THEN v_cust_3
                    WHEN 3 THEN v_cust_4
                    ELSE        v_cust_5
                END,
                v_order_number,
                type_arr[i],
                status_arr[i],
                v_currency,
                v_created_at,
                v_created_at
            )
            RETURNING id INTO v_order_id;
        ELSE
            INSERT INTO orders (
                location_id, customer_id, order_number,
                order_type, status, currency_code,
                created_at, updated_at
            )
            VALUES (
                v_location_id,
                CASE (i % 5)
                    WHEN 0 THEN v_cust_1
                    WHEN 1 THEN v_cust_2
                    WHEN 2 THEN v_cust_3
                    WHEN 3 THEN v_cust_4
                    ELSE        v_cust_5
                END,
                v_order_number,
                type_arr[i],
                status_arr[i],
                v_currency,
                v_created_at,
                v_created_at
            )
            RETURNING id INTO v_order_id;
        END IF;

        -- Insert order items (2-4 items per order, cycling through combos)
        v_subtotal := 0;

        -- Item combo patterns by order index
        IF i % 3 = 0 THEN
            -- Burger + fries + coke
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_classic_burger, 2, 59.99, 119.98, v_created_at);
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_fries,          2, 24.99,  49.98, v_created_at);
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_coke,            2, 15.00,  30.00, v_created_at);
            v_subtotal := 199.96;

        ELSIF i % 3 = 1 THEN
            -- Bacon cheeseburger + onion rings + sprite + brownie
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_bacon_cheese,  1, 74.99, 74.99, v_created_at);
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_onion_rings,   1, 29.99, 29.99, v_created_at);
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_sprite,         1, 15.00, 15.00, v_created_at);
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_brownie,        1, 35.00, 35.00, v_created_at);
            v_subtotal := 154.98;

        ELSE
            -- Veggie / chicken + sweet potato + water
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id,
                CASE WHEN i % 2 = 0 THEN v_veggie_burger ELSE v_chicken_burger END,
                1,
                CASE WHEN i % 2 = 0 THEN 54.99 ELSE 62.99 END,
                CASE WHEN i % 2 = 0 THEN 54.99 ELSE 62.99 END,
                v_created_at);
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_sweet_potato, 1, 29.99, 29.99, v_created_at);
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_water,         1, 12.00, 12.00, v_created_at);
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at)
            VALUES (v_order_id, v_ice_cream,     1, 29.00, 29.00, v_created_at);
            v_subtotal := CASE WHEN i % 2 = 0 THEN 125.98 ELSE 133.98 END;
        END IF;

        -- Delivery fee: 25 major units of the configured currency for delivery
        -- orders, 0 for dine_in/pickup. Like every other amount in this file it
        -- is authored in the currency's major units, so it means 25 of whatever
        -- seed_currency is — not a fixed sum of anyone's money.
        v_del_fee := CASE WHEN type_arr[i] = 'delivery' THEN 25.00 ELSE 0.00 END;
        v_net     := v_subtotal + v_del_fee;

        -- Tax, computed for BOTH conventions rather than assuming one.
        --
        -- The old code wrote `round(v_total * 15 / 115, 2)`, which hardcoded
        -- the rate AND the inclusive convention in a single unexplained
        -- expression. The general forms are:
        --   inclusive — the price already contains the tax, so back it out:
        --               tax = total * rate / (100 + rate)
        --   exclusive — the tax is added at the register:
        --               tax = net * rate / 100, and the customer pays net + tax
        -- These give genuinely different totals for the same menu, which is why
        -- the convention is a setting and not a display preference.
        IF v_tax_inclusive THEN
            v_total      := v_net;
            v_tax_amount := round(v_net * v_tax_rate / (100 + v_tax_rate), v_decimals);
        ELSE
            v_tax_amount := round(v_net * v_tax_rate / 100, v_decimals);
            v_total      := v_net + v_tax_amount;
        END IF;

        -- Financial details
        INSERT INTO order_financial_details (
            order_id, subtotal, delivery_fee, total_amount,
            tax_rate, tax_amount, tax_inclusive,
            payment_status, payment_method,
            created_at, updated_at
        )
        VALUES (
            v_order_id,
            v_subtotal,
            v_del_fee,
            v_total,
            v_tax_rate,
            v_tax_amount,
            v_tax_inclusive,
            CASE WHEN status_arr[i] IN ('delivered','completed') THEN 'paid' ELSE 'pending' END,
            'cash',
            v_created_at,
            v_created_at
        );

        -- Order details (delivery address for delivery orders)
        INSERT INTO order_details (
            order_id, delivery_address,
            delivery_latitude, delivery_longitude,
            estimated_prep_time,
            created_at, updated_at
        )
        VALUES (
            v_order_id,
            CASE WHEN type_arr[i] = 'delivery'
                 THEN '2 Example Avenue, Example City'
                 ELSE NULL END,
            CASE WHEN type_arr[i] = 'delivery' THEN 0.0000000 ELSE NULL END,
            CASE WHEN type_arr[i] = 'delivery' THEN 0.0000000 ELSE NULL END,
            25,
            v_created_at,
            v_created_at
        );

        v_order_seq := v_order_seq + 1;
    END LOOP;

END $$;

-- =============================================================
-- STEP 11: Reviews (5) — one per unique order, rating 1-10
-- =============================================================

DO $$
DECLARE
    v_location_id uuid;
    v_order_ids   uuid[];
    v_order_id    uuid;
    -- Review data: 5 entries for BB-SEED-0001..0005 (delivered/completed)
    v_order_nums  text[]    := ARRAY['BB-SEED-0001','BB-SEED-0002','BB-SEED-0003','BB-SEED-0005','BB-SEED-0006'];
    v_ratings     integer[] := ARRAY[8, 9, 7, 10, 6];
    v_comments    text[]    := ARRAY[
        'Great burgers, fast delivery!',
        'Absolutely loved the bacon cheeseburger.',
        'Good food but fries were a bit cold.',
        'Best burger in town, will order again!',
        'Nice place, the veggie burger was surprisingly good.'
    ];
    i             integer;
BEGIN
    -- Resolve location
    SELECT l.id INTO v_location_id
    FROM   auth_users au
    JOIN   profiles p ON p.id = au.id
    JOIN   organization_members om ON om.profile_id = p.id AND om.role = 'owner'
    JOIN   organizations o ON o.id = om.organization_id
    JOIN   locations l ON l.organization_id = o.id
    WHERE  au.email = 'owner@example.com'
    LIMIT  1;

    -- Insert reviews on the 5 specific seeded order numbers.
    -- ON CONFLICT (order_id) DO NOTHING makes this fully idempotent.
    FOR i IN 1..5 LOOP
        SELECT o.id INTO v_order_id
        FROM   orders o
        WHERE  o.location_id  = v_location_id
          AND  o.order_number = v_order_nums[i];

        IF v_order_id IS NOT NULL THEN
            INSERT INTO reviews (order_id, rating, comment)
            VALUES (v_order_id, v_ratings[i], v_comments[i])
            ON CONFLICT (order_id) DO NOTHING;
        END IF;
    END LOOP;
END $$;

-- =============================================================
-- Verification summary
--
-- The customers predicate is built from the configured dial code. It used to
-- read LIKE '+27%1234%', which meant that the moment the dial code changed the
-- check matched nothing and reported a cheerful 0 — a verification step that
-- signals success by finding nothing is worse than no verification at all,
-- because it looks like it ran.
-- =============================================================
SELECT
    (SELECT count(*) FROM auth_users     WHERE email = 'owner@example.com') AS users,
    (SELECT count(*) FROM profiles       WHERE email = 'owner@example.com') AS profiles,
    (SELECT count(*) FROM organizations  WHERE name  = 'Example Restaurant')      AS orgs,
    (SELECT count(*) FROM locations      WHERE name  = 'Example Restaurant')      AS locations,
    (SELECT count(*) FROM organization_members om
        JOIN profiles p ON p.id = om.profile_id
        WHERE p.email = 'owner@example.com')                                AS org_members,
    (SELECT count(*) FROM categories c
        JOIN locations l ON l.id = c.location_id
        WHERE l.name = 'Example Restaurant')                                      AS categories,
    (SELECT count(*) FROM items it
        JOIN locations l ON l.id = it.location_id
        WHERE l.name = 'Example Restaurant')                                      AS items,
    (SELECT count(*) FROM customers
        WHERE whatsapp_number LIKE '+' || :'seed_phone_cc' || '5550%')            AS customers,
    (SELECT count(*) FROM staff s
        JOIN locations l ON l.id = s.location_id
        WHERE l.name = 'Example Restaurant')                                      AS staff,
    (SELECT count(*) FROM orders o
        JOIN locations l ON l.id = o.location_id
        WHERE l.name = 'Example Restaurant')                                      AS orders,
    (SELECT count(*) FROM reviews r
        JOIN orders o ON o.id = r.order_id
        JOIN locations l ON l.id = o.location_id
        WHERE l.name = 'Example Restaurant')                                      AS reviews,
    -- Surface the locale the run actually used, so a demo database can never
    -- leave you guessing which currency its numbers are in.
    :'seed_currency'                                                              AS currency,
    :'seed_country'                                                               AS country,
    :seed_tax_rate                                                                AS tax_rate,
    :seed_tax_inclusive                                                           AS tax_inclusive;
