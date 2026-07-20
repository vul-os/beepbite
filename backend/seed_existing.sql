-- =============================================================
-- BeepBite Seed for the FIRST org/location already in the DB.
-- Targets the lone signed-up user — does NOT create auth_users/profiles/
-- organizations/locations/members (those came from signup + triggers).
-- Safe to re-run: every INSERT is idempotent via ON CONFLICT or
-- WHERE NOT EXISTS.
-- =============================================================
--
-- LOCALE IS CONFIGURATION, NOT A CONSTANT
-- ---------------------------------------
-- This file used to hardcode one country: +27 phone numbers, .co.za email
-- addresses, a Cape Town street, and a 15%-inclusive VAT spelled out as
-- `total * 15 / 115`. Replacing that with a different country's constants
-- would be the same bug wearing a different flag, so the locale is now a set
-- of psql variables whose defaults are deliberately fictional. They match
-- backend/internal/seedlocale exactly, so the SQL and Go seeding paths cannot
-- disagree about what an unconfigured demo database looks like.
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
-- XTS and 999 are the load-bearing ones. Both are reserved by their standards
-- precisely so test data is recognisable as test data: an XTS amount cannot be
-- mistaken for real takings, and a +999 number cannot be dialled — which
-- matters because demo data ends up in staging environments wired to live
-- WhatsApp credentials, where a seeded number belonging to a real person
-- receives real messages about an order that does not exist.
--
-- Override from the command line, e.g.
--   psql -v seed_currency=JPY -v seed_decimals=0 -v seed_country=JP \
--        -v seed_phone_cc=81 -f seed_existing.sql
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
-- psql substitutes :vars while lexing, before the server sees the text, and it
-- deliberately does not look inside dollar-quoted strings — their contents are
-- opaque to it. A :'seed_currency' written inside a `DO $do$ ... $do$` body
-- would therefore reach PL/pgSQL verbatim and fail to parse. Custom GUCs
-- bridge that gap: set here in plain top-level SQL where interpolation works,
-- read inside the DO blocks with current_setting(), which is ordinary runtime
-- SQL and needs no interpolation.
--
-- is_local = false so they survive the whole psql session, not one transaction.
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
-- Every currency column is a foreign key to currencies(code), and the default
-- XTS is deliberately not one of the currencies migration 056 ships — that is
-- what a reserved code is for. It has to be registered before anything priced
-- in it is inserted. This also lets an operator seed in a currency the
-- migrations do not carry without editing a migration to do it.
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

-- Capture the target location_id once and reuse it everywhere.
SELECT id AS loc_id FROM locations ORDER BY created_at LIMIT 1 \gset

-- -------------------------------------------------------------
-- STEP 0b: Apply the configured locale to that location and its org.
--
-- The location came from signup, and migration 056 dropped DEFAULT 'ZAR' from
-- locations.currency_code and organizations.default_currency_code — so it now
-- has NO currency at all rather than the wrong one. The seed has to say which
-- currency it means before it writes orders denominated in it.
--
-- The SET list is assembled from the columns that actually exist, because
-- these columns arrived across several migrations and a database at an earlier
-- revision should set fewer of them rather than fail the whole seed.
-- -------------------------------------------------------------
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
    SELECT id, organization_id INTO v_loc_id, v_org_id
    FROM   locations ORDER BY created_at LIMIT 1;

    IF v_loc_id IS NULL THEN
        RAISE EXCEPTION 'No locations exist — run signup (or seed.sql) first';
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
-- STEP 1: Categories (4)
-- =============================================================
INSERT INTO categories (location_id, name, description, sort_order, is_active) VALUES
    (:'loc_id', 'Burgers',  'Flame-grilled burgers',         1, true),
    (:'loc_id', 'Sides',    'Great sides to go with meals',  2, true),
    (:'loc_id', 'Drinks',   'Cold beverages',                 3, true),
    (:'loc_id', 'Desserts', 'Sweet treats',                   4, true)
ON CONFLICT (location_id, name) DO UPDATE
    SET sort_order = EXCLUDED.sort_order,
        updated_at = timezone('utc'::text, now());

-- =============================================================
-- STEP 2: Items (12) — JOIN to categories by name
-- =============================================================
INSERT INTO items (location_id, category_id, name, description, price, is_active, sort_order)
SELECT :'loc_id', c.id, v.name, v.description, v.price, true, v.sort_order
FROM (VALUES
    ('Burgers',  'Classic Burger',     '100% beef patty, lettuce, tomato, pickles',     59.99::numeric, 1),
    ('Burgers',  'Bacon Cheeseburger', 'Beef patty, crispy bacon, cheddar, BBQ sauce',  74.99,          2),
    ('Burgers',  'Veggie Burger',      'Lentil patty, avocado, sprouts, aioli',         54.99,          3),
    ('Burgers',  'Chicken Burger',     'Grilled chicken breast, coleslaw, mayo',        62.99,          4),
    ('Sides',    'Fries',              'Crispy golden fries with seasoning',            24.99,          1),
    ('Sides',    'Onion Rings',        'Beer-battered onion rings',                     29.99,          2),
    ('Sides',    'Sweet Potato Fries', 'Oven-baked sweet potato fries',                 29.99,          3),
    ('Drinks',   'Coke',               'Ice-cold Coca-Cola 330ml',                      15.00,          1),
    ('Drinks',   'Sprite',             'Sparkling lemon-lime 330ml',                    15.00,          2),
    ('Drinks',   'Bottled Water',      'Still mineral water 500ml',                     12.00,          3),
    ('Desserts', 'Chocolate Brownie',  'Warm fudge brownie with vanilla ice cream',     35.00,          1),
    ('Desserts', 'Ice Cream',          'Two scoops of vanilla or chocolate ice cream',  29.00,          2)
) v(cat, name, description, price, sort_order)
JOIN categories c ON c.location_id = :'loc_id' AND c.name = v.cat
WHERE NOT EXISTS (
    SELECT 1 FROM items i WHERE i.location_id = :'loc_id' AND i.name = v.name
);

-- =============================================================
-- STEP 3: Customers (5) — global, UNIQUE(whatsapp_number)
--
-- Numbers are +<dial code>5550<6 digits>. With the default dial code 999
-- (ITU-reserved, assigned to no country) they are unroutable by construction,
-- so seed data cannot text a stranger. The 5550 prefix keeps them looking
-- synthetic even when an operator overrides the dial code to a live country —
-- though at that point they are only conventionally unassigned, which is a
-- reason to leave the default alone unless they genuinely need to be dialled.
--
-- These are the same five identities seed.sql creates, on the same numbers, so
-- the two scripts converge on one set of demo customers instead of doubling
-- them.
-- =============================================================
INSERT INTO customers (whatsapp_number, first_name, last_name, email) VALUES
    ('+' || :'seed_phone_cc' || '5550000001', 'Alex',  'Example', 'alex.example@'  || :'seed_email_domain'),
    ('+' || :'seed_phone_cc' || '5550000002', 'Blair', 'Example', 'blair.example@' || :'seed_email_domain'),
    ('+' || :'seed_phone_cc' || '5550000003', 'Casey', 'Example', 'casey.example@' || :'seed_email_domain'),
    ('+' || :'seed_phone_cc' || '5550000004', 'Devon', 'Example', 'devon.example@' || :'seed_email_domain'),
    ('+' || :'seed_phone_cc' || '5550000005', 'Emery', 'Example', 'emery.example@' || :'seed_email_domain')
ON CONFLICT (whatsapp_number) DO UPDATE
    SET first_name = EXCLUDED.first_name,
        last_name  = EXCLUDED.last_name,
        updated_at = timezone('utc'::text, now());

-- =============================================================
-- STEP 4: Staff (3) — UNIQUE(email), partial unique on (loc, lower(username))
-- =============================================================
INSERT INTO staff (
    location_id, first_name, last_name, email, phone,
    username, password_hash, pin_hash, role, is_active,
    hire_date, employee_id
) VALUES
    (:'loc_id', 'Morgan', 'Example',
     'morgan.example@' || :'seed_email_domain', '+' || :'seed_phone_cc' || '5550000101',
     'morgan', crypt('Manager@2024', gen_salt('bf', 10)), crypt('1234', gen_salt('bf', 10)),
     'manager', true, '2025-01-15', 'EMP-001'),
    (:'loc_id', 'Riley',  'Example',
     'riley.example@'  || :'seed_email_domain', '+' || :'seed_phone_cc' || '5550000102',
     'riley',  crypt('Cashier@2024', gen_salt('bf', 10)), crypt('2345', gen_salt('bf', 10)),
     'cashier', true, '2025-03-20', 'EMP-002'),
    (:'loc_id', 'Sam',    'Example',
     'sam.example@'    || :'seed_email_domain', '+' || :'seed_phone_cc' || '5550000103',
     'sam',    crypt('Kitchen@2024', gen_salt('bf', 10)), crypt('3456', gen_salt('bf', 10)),
     'kitchen', true, '2025-06-01', 'EMP-003')
ON CONFLICT (email) DO UPDATE
    SET role       = EXCLUDED.role,
        is_active  = true,
        updated_at = timezone('utc'::text, now());

-- =============================================================
-- STEP 5: 15 Orders spread over the last 30 days, with line items,
-- financials, and details. DO block — needs loops + variable lookup.
-- =============================================================
DO $do$
DECLARE
    v_loc            uuid;
    v_org            uuid;
    v_has_org_col    boolean;

    -- Locale, read from the session settings hoisted at the top of this file.
    -- psql does not substitute :vars inside a dollar-quoted body, so every
    -- configured value has to arrive through current_setting() instead.
    v_currency       text    := current_setting('beepbite.seed_currency');
    v_decimals       integer := current_setting('beepbite.seed_decimals')::integer;
    v_tax_rate       numeric := current_setting('beepbite.seed_tax_rate')::numeric;
    v_tax_inclusive  boolean := current_setting('beepbite.seed_tax_inclusive')::boolean;
    v_phone_cc       text    := current_setting('beepbite.seed_phone_cc');

    v_cust_1         uuid;
    v_cust_2         uuid;
    v_cust_3         uuid;
    v_cust_4         uuid;
    v_cust_5         uuid;

    v_classic uuid; v_bacon uuid; v_veggie uuid; v_chicken uuid;
    v_fries uuid; v_onion uuid; v_sweetpot uuid;
    v_coke uuid; v_sprite uuid; v_water uuid;
    v_brownie uuid; v_icecream uuid;

    v_order_id   uuid;
    v_subtotal   numeric(10,2);
    v_net        numeric(10,2);
    v_tax_amount numeric(10,2);
    v_total      numeric(10,2);
    v_del_fee    numeric(10,2);
    v_order_num  text;
    v_created_at timestamptz;

    type_arr   text[]    := ARRAY['delivery','pickup','dine_in','delivery','pickup',
                                   'dine_in','delivery','pickup','delivery','dine_in',
                                   'delivery','pickup','dine_in','delivery','pickup'];
    status_arr text[]    := ARRAY['delivered','completed','delivered','cancelled','delivered',
                                   'completed','pending','delivered','completed','cancelled',
                                   'delivered','completed','delivered','pending','completed'];
    day_off    integer[] := ARRAY[29,27,25,23,21,19,17,15,13,11,9,7,5,3,1];
    i          integer;
BEGIN
    SELECT id, organization_id INTO v_loc, v_org
    FROM   locations ORDER BY created_at LIMIT 1;

    -- Look the customers up by the same constructed numbers STEP 3 inserted.
    -- Built from the configured dial code, not literals: otherwise these
    -- silently return NULL and every seeded order loses its customer.
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

    SELECT id INTO v_classic   FROM items WHERE location_id = v_loc AND name = 'Classic Burger';
    SELECT id INTO v_bacon     FROM items WHERE location_id = v_loc AND name = 'Bacon Cheeseburger';
    SELECT id INTO v_veggie    FROM items WHERE location_id = v_loc AND name = 'Veggie Burger';
    SELECT id INTO v_chicken   FROM items WHERE location_id = v_loc AND name = 'Chicken Burger';
    SELECT id INTO v_fries     FROM items WHERE location_id = v_loc AND name = 'Fries';
    SELECT id INTO v_onion     FROM items WHERE location_id = v_loc AND name = 'Onion Rings';
    SELECT id INTO v_sweetpot  FROM items WHERE location_id = v_loc AND name = 'Sweet Potato Fries';
    SELECT id INTO v_coke      FROM items WHERE location_id = v_loc AND name = 'Coke';
    SELECT id INTO v_sprite    FROM items WHERE location_id = v_loc AND name = 'Sprite';
    SELECT id INTO v_water     FROM items WHERE location_id = v_loc AND name = 'Bottled Water';
    SELECT id INTO v_brownie   FROM items WHERE location_id = v_loc AND name = 'Chocolate Brownie';
    SELECT id INTO v_icecream  FROM items WHERE location_id = v_loc AND name = 'Ice Cream';

    FOR i IN 1..15 LOOP
        v_order_num  := 'BB-SEED-' || lpad(i::text, 4, '0');
        v_created_at := timezone('utc'::text, now()) - (day_off[i] || ' days')::interval;

        -- Idempotent: skip if already inserted
        IF EXISTS (
            SELECT 1 FROM orders
            WHERE location_id = v_loc AND order_number = v_order_num
        ) THEN
            CONTINUE;
        END IF;

        -- currency_code is listed EXPLICITLY. It used to be omitted and pick up
        -- DEFAULT 'ZAR'; migration 056 dropped that default, so an omitted
        -- column now writes NULL and every seeded order becomes an order in no
        -- currency at all — which reads as "free" to anything that COALESCEs.
        IF v_has_org_col THEN
            INSERT INTO orders (
                location_id, organization_id, customer_id, order_number,
                order_type, status, currency_code,
                created_at, updated_at
            ) VALUES (
                v_loc, v_org,
                CASE (i % 5)
                    WHEN 0 THEN v_cust_1
                    WHEN 1 THEN v_cust_2
                    WHEN 2 THEN v_cust_3
                    WHEN 3 THEN v_cust_4
                    ELSE        v_cust_5
                END,
                v_order_num, type_arr[i], status_arr[i], v_currency,
                v_created_at, v_created_at
            )
            RETURNING id INTO v_order_id;
        ELSE
            INSERT INTO orders (
                location_id, customer_id, order_number,
                order_type, status, currency_code,
                created_at, updated_at
            ) VALUES (
                v_loc,
                CASE (i % 5)
                    WHEN 0 THEN v_cust_1
                    WHEN 1 THEN v_cust_2
                    WHEN 2 THEN v_cust_3
                    WHEN 3 THEN v_cust_4
                    ELSE        v_cust_5
                END,
                v_order_num, type_arr[i], status_arr[i], v_currency,
                v_created_at, v_created_at
            )
            RETURNING id INTO v_order_id;
        END IF;

        IF i % 3 = 0 THEN
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at) VALUES
                (v_order_id, v_classic, 2, 59.99, 119.98, v_created_at),
                (v_order_id, v_fries,   2, 24.99,  49.98, v_created_at),
                (v_order_id, v_coke,    2, 15.00,  30.00, v_created_at);
            v_subtotal := 199.96;
        ELSIF i % 3 = 1 THEN
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at) VALUES
                (v_order_id, v_bacon,   1, 74.99, 74.99, v_created_at),
                (v_order_id, v_onion,   1, 29.99, 29.99, v_created_at),
                (v_order_id, v_sprite,  1, 15.00, 15.00, v_created_at),
                (v_order_id, v_brownie, 1, 35.00, 35.00, v_created_at);
            v_subtotal := 154.98;
        ELSE
            INSERT INTO order_items (order_id, item_id, quantity, unit_price, total_price, created_at) VALUES
                (v_order_id, CASE WHEN i % 2 = 0 THEN v_veggie ELSE v_chicken END, 1,
                             CASE WHEN i % 2 = 0 THEN 54.99 ELSE 62.99 END,
                             CASE WHEN i % 2 = 0 THEN 54.99 ELSE 62.99 END, v_created_at),
                (v_order_id, v_sweetpot, 1, 29.99, 29.99, v_created_at),
                (v_order_id, v_water,    1, 12.00, 12.00, v_created_at),
                (v_order_id, v_icecream, 1, 29.00, 29.00, v_created_at);
            v_subtotal := CASE WHEN i % 2 = 0 THEN 125.98 ELSE 133.98 END;
        END IF;

        -- 25 major units of the configured currency for delivery, 0 otherwise.
        -- Like every amount in this file it is authored in major units, so it
        -- means 25 of whatever seed_currency is — not a fixed sum of anyone's
        -- money.
        v_del_fee := CASE WHEN type_arr[i] = 'delivery' THEN 25.00 ELSE 0.00 END;
        v_net     := v_subtotal + v_del_fee;

        -- Tax, computed for BOTH conventions rather than assuming one.
        --
        -- The old code wrote `round(v_total * 15 / 115, 2)`, which hardcoded
        -- the rate AND the inclusive convention in one unexplained expression.
        -- The general forms are:
        --   inclusive — the price already contains the tax, so back it out:
        --               tax = total * rate / (100 + rate)
        --   exclusive — the tax is added at the register:
        --               tax = net * rate / 100, and the customer pays net + tax
        -- The same menu and rate produce different totals under the two, which
        -- is why the convention is a setting and not a display preference.
        IF v_tax_inclusive THEN
            v_total      := v_net;
            v_tax_amount := round(v_net * v_tax_rate / (100 + v_tax_rate), v_decimals);
        ELSE
            v_tax_amount := round(v_net * v_tax_rate / 100, v_decimals);
            v_total      := v_net + v_tax_amount;
        END IF;

        INSERT INTO order_financial_details (
            order_id, subtotal, delivery_fee, total_amount,
            tax_rate, tax_amount, tax_inclusive,
            payment_status, payment_method,
            created_at, updated_at
        ) VALUES (
            v_order_id, v_subtotal, v_del_fee, v_total,
            v_tax_rate, v_tax_amount, v_tax_inclusive,
            CASE WHEN status_arr[i] IN ('delivered','completed') THEN 'paid' ELSE 'pending' END,
            'cash',
            v_created_at, v_created_at
        );

        INSERT INTO order_details (
            order_id, delivery_address,
            delivery_latitude, delivery_longitude,
            estimated_prep_time,
            created_at, updated_at
        ) VALUES (
            v_order_id,
            CASE WHEN type_arr[i] = 'delivery'
                 THEN '2 Example Avenue, Example City'
                 ELSE NULL END,
            -- 0,0 is in the Gulf of Guinea: nothing is there, which is what an
            -- unconfigured demo address should look like on a map.
            CASE WHEN type_arr[i] = 'delivery' THEN 0.0000000 ELSE NULL END,
            CASE WHEN type_arr[i] = 'delivery' THEN 0.0000000 ELSE NULL END,
            25, v_created_at, v_created_at
        );
    END LOOP;
END
$do$;

-- =============================================================
-- STEP 6: Reviews (5) on the earliest delivered/completed orders
-- =============================================================
DO $do$
DECLARE
    v_loc       uuid;
    v_order_id  uuid;
    v_nums      text[]    := ARRAY['BB-SEED-0001','BB-SEED-0002','BB-SEED-0003','BB-SEED-0005','BB-SEED-0006'];
    v_ratings   integer[] := ARRAY[8, 9, 7, 10, 6];
    v_comments  text[]    := ARRAY[
        'Great burgers, fast delivery!',
        'Absolutely loved the bacon cheeseburger.',
        'Good food but fries were a bit cold.',
        'Best burger in town, will order again!',
        'Nice place, the veggie burger was surprisingly good.'
    ];
    i           integer;
BEGIN
    SELECT id INTO v_loc FROM locations ORDER BY created_at LIMIT 1;

    FOR i IN 1..5 LOOP
        SELECT id INTO v_order_id
        FROM orders
        WHERE location_id = v_loc AND order_number = v_nums[i];

        IF v_order_id IS NOT NULL THEN
            INSERT INTO reviews (order_id, rating, comment)
            VALUES (v_order_id, v_ratings[i], v_comments[i])
            ON CONFLICT (order_id) DO NOTHING;
        END IF;
    END LOOP;
END
$do$;

-- =============================================================
-- Summary
--
-- The customers predicate is built from the configured dial code. It used to
-- read LIKE '+27%1234%', which meant that as soon as the dial code changed the
-- check matched nothing and reported a cheerful 0 — a verification step that
-- signals success by finding nothing is worse than no verification at all,
-- because it looks like it ran.
-- =============================================================
SELECT
    (SELECT count(*) FROM categories WHERE location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1)) AS categories,
    (SELECT count(*) FROM items      WHERE location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1)) AS items,
    (SELECT count(*) FROM customers WHERE whatsapp_number LIKE '+' || :'seed_phone_cc' || '5550%')                AS customers,
    (SELECT count(*) FROM staff      WHERE location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1)) AS staff,
    (SELECT count(*) FROM orders     WHERE location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1)) AS orders,
    (SELECT count(*) FROM reviews r JOIN orders o ON o.id = r.order_id
        WHERE o.location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1))                              AS reviews,
    -- Surface the locale the run actually used, so a demo database can never
    -- leave you guessing which currency its numbers are in.
    :'seed_currency'                                                                                              AS currency,
    :'seed_country'                                                                                               AS country,
    :seed_tax_rate                                                                                                AS tax_rate,
    :seed_tax_inclusive                                                                                           AS tax_inclusive;
