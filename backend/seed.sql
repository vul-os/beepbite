-- =============================================================
-- BeepBite Seed File
-- Test user: owner@example.com  /  ChangeMe123!
-- Safe to re-run (idempotent).
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
    SET    name       = 'Allsion Burgwrs',
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
    SET    name       = 'Allsion Burgwrs',
           address    = '123 Main Street, Cape Town, South Africa',
           latitude   = -33.9249000,
           longitude  = 18.4241000,
           region_id  = (SELECT id FROM regions WHERE code = 'ZA'),
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
-- =============================================================
cust_thabo AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+27711234501', 'Thabo', 'Mbeki', 'thabo.mbeki@example.co.za')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),
cust_naledi AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+27721234502', 'Naledi', 'Pandor', 'naledi.pandor@example.co.za')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),
cust_sipho AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+27731234503', 'Sipho', 'Khumalo', 'sipho.khumalo@example.co.za')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),
cust_lerato AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+27741234504', 'Lerato', 'Ndlovu', 'lerato.ndlovu@example.co.za')
    ON CONFLICT (whatsapp_number) DO UPDATE SET first_name = EXCLUDED.first_name
    RETURNING id
),
cust_kgomotso AS (
    INSERT INTO customers (whatsapp_number, first_name, last_name, email)
    VALUES ('+27751234505', 'Kgomotso', 'Tlou', 'kgomotso.tlou@example.co.za')
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
        'Bongani', 'Dlamini', 'bongani.dlamini@allsionburgwrs.co.za', '+27711000001',
        'bongani',
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
        'Zanele', 'Mokoena', 'zanele.mokoena@allsionburgwrs.co.za', '+27721000002',
        'zanele',
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
        'Lungelo', 'Nkosi', 'lungelo.nkosi@allsionburgwrs.co.za', '+27731000003',
        'lungelo',
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
-- STEP 10: Orders + order_details + order_financial_details + order_items
-- We need to resolve item/customer/location IDs here.
-- Use a helper function approach: build orders in a separate CTE block.
-- =============================================================

DO $$
DECLARE
    v_location_id      uuid;
    v_region_id        uuid;

    -- Customers
    v_cust_thabo       uuid;
    v_cust_naledi      uuid;
    v_cust_sipho       uuid;
    v_cust_lerato      uuid;
    v_cust_kgomotso    uuid;

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
    SELECT l.id INTO v_location_id
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

    -- Resolve customers
    SELECT id INTO v_cust_thabo    FROM customers WHERE whatsapp_number = '+27711234501';
    SELECT id INTO v_cust_naledi   FROM customers WHERE whatsapp_number = '+27721234502';
    SELECT id INTO v_cust_sipho    FROM customers WHERE whatsapp_number = '+27731234503';
    SELECT id INTO v_cust_lerato   FROM customers WHERE whatsapp_number = '+27741234504';
    SELECT id INTO v_cust_kgomotso FROM customers WHERE whatsapp_number = '+27751234505';

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

        -- Insert base order
        INSERT INTO orders (
            location_id, customer_id, order_number, order_type, status,
            created_at, updated_at
        )
        VALUES (
            v_location_id,
            CASE (i % 5)
                WHEN 0 THEN v_cust_thabo
                WHEN 1 THEN v_cust_naledi
                WHEN 2 THEN v_cust_sipho
                WHEN 3 THEN v_cust_lerato
                ELSE        v_cust_kgomotso
            END,
            v_order_number,
            type_arr[i],
            status_arr[i],
            v_created_at,
            v_created_at
        )
        RETURNING id INTO v_order_id;

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

        -- Delivery fee: R25 for delivery orders, R0 for dine_in/pickup
        v_del_fee := CASE WHEN type_arr[i] = 'delivery' THEN 25.00 ELSE 0.00 END;
        v_total   := v_subtotal + v_del_fee;

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
            15.00,
            round(v_total * 15 / 115, 2),  -- VAT inclusive
            true,
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
                 THEN '123 Example Street, Cape Town, 8001'
                 ELSE NULL END,
            CASE WHEN type_arr[i] = 'delivery' THEN -33.9300000 ELSE NULL END,
            CASE WHEN type_arr[i] = 'delivery' THEN  18.4200000 ELSE NULL END,
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
        'Best burger in Cape Town, will order again!',
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
-- =============================================================
SELECT
    (SELECT count(*) FROM auth_users     WHERE email = 'owner@example.com') AS users,
    (SELECT count(*) FROM profiles       WHERE email = 'owner@example.com') AS profiles,
    (SELECT count(*) FROM organizations  WHERE name  = 'Allsion Burgwrs')         AS orgs,
    (SELECT count(*) FROM locations      WHERE name  = 'Allsion Burgwrs')         AS locations,
    (SELECT count(*) FROM organization_members om
        JOIN profiles p ON p.id = om.profile_id
        WHERE p.email = 'owner@example.com')                                AS org_members,
    (SELECT count(*) FROM categories c
        JOIN locations l ON l.id = c.location_id
        WHERE l.name = 'Allsion Burgwrs')                                         AS categories,
    (SELECT count(*) FROM items it
        JOIN locations l ON l.id = it.location_id
        WHERE l.name = 'Allsion Burgwrs')                                         AS items,
    (SELECT count(*) FROM customers
        WHERE whatsapp_number LIKE '+27%1234%')                                   AS customers,
    (SELECT count(*) FROM staff s
        JOIN locations l ON l.id = s.location_id
        WHERE l.name = 'Allsion Burgwrs')                                         AS staff,
    (SELECT count(*) FROM orders o
        JOIN locations l ON l.id = o.location_id
        WHERE l.name = 'Allsion Burgwrs')                                         AS orders,
    (SELECT count(*) FROM reviews r
        JOIN orders o ON o.id = r.order_id
        JOIN locations l ON l.id = o.location_id
        WHERE l.name = 'Allsion Burgwrs')                                         AS reviews;
