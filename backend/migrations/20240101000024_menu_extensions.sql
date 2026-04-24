-- ======================
-- MENU EXTENSIONS
-- Allergens, dietary tags, daypart scheduling, happy-hour prices,
-- 86-list / temporary availability, nutrition, imagery.
-- Layered on top of the `items` table from 20240101000002_init_schema.sql.
-- ======================

-- TODO: attach updated_at trigger once set_updated_at() helper exists

-- ======================
-- ALLERGENS
-- ======================

-- Master list of allergens, scoped per organization so each org can localize labels.
-- Seed codes include: 'gluten', 'dairy', 'nuts', 'shellfish', 'sesame', 'egg',
-- 'soy', 'fish', 'celery', 'mustard', 'sulphites'.
CREATE TABLE allergens (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code text NOT NULL, -- e.g., 'gluten', 'dairy', 'nuts'
    label text NOT NULL, -- display name
    icon text, -- optional icon identifier (emoji or URL)
    sort_order integer DEFAULT 0,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id, code)
);

-- Many-to-many: items ↔ allergens
CREATE TABLE item_allergens (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    allergen_id uuid REFERENCES allergens(id) ON DELETE CASCADE NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(item_id, allergen_id)
);

-- ======================
-- DIETARY TAGS
-- ======================

-- Master list of dietary tags per organization.
-- Common codes: 'vegan', 'vegetarian', 'halal', 'kosher', 'gluten_free',
-- 'low_carb', 'spicy', 'signature'.
CREATE TABLE dietary_tags (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    icon text,
    sort_order integer DEFAULT 0,
    is_customer_facing boolean NOT NULL DEFAULT true, -- staff-only tags (e.g. 'contains_leftover') won't show on customer menu
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id, code)
);

-- Many-to-many: items ↔ dietary tags
CREATE TABLE item_dietary_tags (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    dietary_tag_id uuid REFERENCES dietary_tags(id) ON DELETE CASCADE NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(item_id, dietary_tag_id)
);

-- ======================
-- MENU SCHEDULES (DAYPARTS)
-- ======================

-- Named dayparts: breakfast, lunch, dinner, happy_hour, etc.
CREATE TABLE menu_schedules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL, -- e.g., "Breakfast"
    code text NOT NULL, -- e.g., "breakfast" (slug)
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(location_id, code)
);

-- Time windows per day of week for when a schedule is active.
-- day_of_week follows ISO: 1=Monday ... 7=Sunday.
-- NOTE: if end_time < start_time, the window rolls past midnight into the next day.
CREATE TABLE menu_schedule_slots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    menu_schedule_id uuid REFERENCES menu_schedules(id) ON DELETE CASCADE NOT NULL,
    day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Monday ... 7=Sunday (ISO)
    start_time time NOT NULL,
    end_time time NOT NULL, -- if end_time < start_time it rolls past midnight
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Which items belong to which daypart menu. Items not in any schedule = available always.
CREATE TABLE item_menu_schedules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    menu_schedule_id uuid REFERENCES menu_schedules(id) ON DELETE CASCADE NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(item_id, menu_schedule_id)
);

-- Override item.price during a schedule window (happy-hour pricing).
CREATE TABLE item_price_schedules (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    menu_schedule_id uuid REFERENCES menu_schedules(id) ON DELETE CASCADE NOT NULL,
    price decimal(10,2) NOT NULL CHECK (price >= 0),
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(item_id, menu_schedule_id)
);

-- ======================
-- ALTER: ITEMS — AVAILABILITY, NUTRITION, IMAGERY
-- ======================

-- If set and in future, item appears on menu but isn't orderable yet.
ALTER TABLE items ADD COLUMN available_from timestamptz;

-- 86-list: if set and < now() the item is temporarily unavailable.
-- NULL = always available (subject to is_active / menu_schedules).
ALTER TABLE items ADD COLUMN available_until timestamptz;

-- Convenience flag set when linked inventory hits 0 or staff manually 86-s;
-- paired with available_until for auto-unban.
ALTER TABLE items ADD COLUMN is_86ed boolean NOT NULL DEFAULT false;

-- Opt-in: if true, a trigger/job flips is_86ed when linked item_recipes ingredients hit 0 stock.
ALTER TABLE items ADD COLUMN auto_86_when_inventory_empty boolean NOT NULL DEFAULT false;

-- Nutrition fields — nullable int means "unknown".
ALTER TABLE items ADD COLUMN calories integer;
ALTER TABLE items ADD COLUMN kilojoules integer;
ALTER TABLE items ADD COLUMN spice_level integer CHECK (spice_level BETWEEN 0 AND 5);

-- Imagery and customer-facing copy.
ALTER TABLE items ADD COLUMN image_url text;
ALTER TABLE items ADD COLUMN short_description text; -- customer-facing blurb; existing `description` stays as the long version

-- ======================
-- ALTER: INVENTORY_ITEMS — OPTIONAL ITEM LINK
-- ======================

-- Optional link from raw ingredient back to a sellable item
-- (for sellable raw ingredients, e.g. a bottled drink sold as-is).
-- Used by auto_86 logic. Nullable.
ALTER TABLE inventory_items ADD COLUMN link_to_item_id uuid REFERENCES items(id) ON DELETE SET NULL;

-- ======================
-- INDEXES
-- ======================

CREATE INDEX idx_allergens_organization_id ON allergens(organization_id);

CREATE INDEX idx_item_allergens_item_id ON item_allergens(item_id);
CREATE INDEX idx_item_allergens_allergen_id ON item_allergens(allergen_id);

CREATE INDEX idx_dietary_tags_organization_id ON dietary_tags(organization_id);

CREATE INDEX idx_item_dietary_tags_item_id ON item_dietary_tags(item_id);
CREATE INDEX idx_item_dietary_tags_dietary_tag_id ON item_dietary_tags(dietary_tag_id);

CREATE INDEX idx_menu_schedules_location_id ON menu_schedules(location_id);

CREATE INDEX idx_menu_schedule_slots_schedule_day ON menu_schedule_slots(menu_schedule_id, day_of_week);

CREATE INDEX idx_item_menu_schedules_item_id ON item_menu_schedules(item_id);
CREATE INDEX idx_item_menu_schedules_menu_schedule_id ON item_menu_schedules(menu_schedule_id);

CREATE INDEX idx_item_price_schedules_item_id ON item_price_schedules(item_id);
CREATE INDEX idx_item_price_schedules_menu_schedule_id ON item_price_schedules(menu_schedule_id);

-- Fast lookup for "what's 86-ed right now"
CREATE INDEX idx_items_is_86ed ON items(is_86ed) WHERE is_86ed = true;

-- Supports availability-window queries
CREATE INDEX idx_items_available_until ON items(available_until) WHERE available_until IS NOT NULL;

-- Most common menu-display filter
CREATE INDEX idx_items_location_active_86ed ON items(location_id, is_active, is_86ed);
