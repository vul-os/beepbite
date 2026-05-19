-- =============================================================
-- BeepBite Seed for the FIRST org/location already in the DB.
-- Targets the lone signed-up user — does NOT create auth_users/profiles/
-- organizations/locations/members (those came from signup + triggers).
-- Safe to re-run: every INSERT is idempotent via ON CONFLICT or
-- WHERE NOT EXISTS.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Capture the target location_id once and reuse it everywhere.
SELECT id AS loc_id FROM locations ORDER BY created_at LIMIT 1 \gset

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
-- =============================================================
INSERT INTO customers (whatsapp_number, first_name, last_name, email) VALUES
    ('+27711234501', 'Thabo',    'Mbeki',     'thabo.mbeki@example.co.za'),
    ('+27721234502', 'Naledi',   'Pandor',    'naledi.pandor@example.co.za'),
    ('+27731234503', 'Sipho',    'Maseko',    'sipho.maseko@example.co.za'),
    ('+27741234504', 'Lerato',   'Khumalo',   'lerato.khumalo@example.co.za'),
    ('+27751234505', 'Kgomotso', 'Mathabane', 'kgomotso.mathabane@example.co.za')
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
    (:'loc_id', 'Bongani', 'Dlamini', 'bongani.dlamini@allsion.test', '+27711000001',
     'bongani', crypt('Manager@2024', gen_salt('bf', 10)), crypt('1234', gen_salt('bf', 10)),
     'manager', true, '2025-01-15', 'EMP-001'),
    (:'loc_id', 'Zanele',  'Mokoena', 'zanele.mokoena@allsion.test',  '+27721000002',
     'zanele',  crypt('Cashier@2024', gen_salt('bf', 10)), crypt('2345', gen_salt('bf', 10)),
     'cashier', true, '2025-03-20', 'EMP-002'),
    (:'loc_id', 'Lungelo', 'Nkosi',   'lungelo.nkosi@allsion.test',   '+27731000003',
     'lungelo', crypt('Kitchen@2024', gen_salt('bf', 10)), crypt('3456', gen_salt('bf', 10)),
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
    v_cust_thabo     uuid;
    v_cust_naledi    uuid;
    v_cust_sipho     uuid;
    v_cust_lerato    uuid;
    v_cust_kgomotso  uuid;

    v_classic uuid; v_bacon uuid; v_veggie uuid; v_chicken uuid;
    v_fries uuid; v_onion uuid; v_sweetpot uuid;
    v_coke uuid; v_sprite uuid; v_water uuid;
    v_brownie uuid; v_icecream uuid;

    v_order_id   uuid;
    v_subtotal   numeric(10,2);
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
    SELECT id INTO v_loc FROM locations ORDER BY created_at LIMIT 1;

    SELECT id INTO v_cust_thabo    FROM customers WHERE whatsapp_number = '+27711234501';
    SELECT id INTO v_cust_naledi   FROM customers WHERE whatsapp_number = '+27721234502';
    SELECT id INTO v_cust_sipho    FROM customers WHERE whatsapp_number = '+27731234503';
    SELECT id INTO v_cust_lerato   FROM customers WHERE whatsapp_number = '+27741234504';
    SELECT id INTO v_cust_kgomotso FROM customers WHERE whatsapp_number = '+27751234505';

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

        INSERT INTO orders (
            location_id, customer_id, order_number, order_type, status,
            created_at, updated_at
        ) VALUES (
            v_loc,
            CASE (i % 5)
                WHEN 0 THEN v_cust_thabo
                WHEN 1 THEN v_cust_naledi
                WHEN 2 THEN v_cust_sipho
                WHEN 3 THEN v_cust_lerato
                ELSE        v_cust_kgomotso
            END,
            v_order_num, type_arr[i], status_arr[i],
            v_created_at, v_created_at
        )
        RETURNING id INTO v_order_id;

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

        v_del_fee := CASE WHEN type_arr[i] = 'delivery' THEN 25.00 ELSE 0.00 END;
        v_total   := v_subtotal + v_del_fee;

        INSERT INTO order_financial_details (
            order_id, subtotal, delivery_fee, total_amount,
            tax_rate, tax_amount, tax_inclusive,
            payment_status, payment_method,
            created_at, updated_at
        ) VALUES (
            v_order_id, v_subtotal, v_del_fee, v_total,
            15.00, round(v_total * 15 / 115, 2), true,
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
                 THEN '123 Long Street, Cape Town, 8001'
                 ELSE NULL END,
            CASE WHEN type_arr[i] = 'delivery' THEN -33.9249 ELSE NULL END,
            CASE WHEN type_arr[i] = 'delivery' THEN  18.4241 ELSE NULL END,
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
        'Best burger in Cape Town, will order again!',
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
-- =============================================================
SELECT
    (SELECT count(*) FROM categories WHERE location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1)) AS categories,
    (SELECT count(*) FROM items      WHERE location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1)) AS items,
    (SELECT count(*) FROM customers WHERE whatsapp_number LIKE '+27%1234%')                                       AS customers,
    (SELECT count(*) FROM staff      WHERE location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1)) AS staff,
    (SELECT count(*) FROM orders     WHERE location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1)) AS orders,
    (SELECT count(*) FROM reviews r JOIN orders o ON o.id = r.order_id
        WHERE o.location_id = (SELECT id FROM locations ORDER BY created_at LIMIT 1))                              AS reviews;
