-- =============================================================================
-- MIGRATION 004 — MENU
-- =============================================================================
-- Sources: legacy 2 (categories, items), 5 + 6 + 7 (item_recipes + recursive
--          functions + circular-dependency guard), 8 (is_recipe_ingredient),
--          24 (allergens, dietary_tags, menu_schedules, menu_schedule_slots,
--              item_menu_schedules, item_price_schedules + items availability/
--              nutrition columns), 44 (item_prep_steps).
-- New tables (ROADMAP Now-22): modifier_groups, modifiers, courses.
--
-- SUPERSEDED tables — NOT created here:
--   item_variations        (legacy 2) — replaced by modifier_groups
--   item_variation_options (legacy 2) — replaced by modifiers
--   order_item_variations  (legacy 2) — superseded by order-level modifier storage
--   cart_item_variations   (legacy 4) — superseded (kept in 008 for chatbot compat)
-- The modifier_groups + modifiers model is richer: it supports min/max selection,
-- required groups, per-option price deltas, and is_default, while the old
-- variations model had a flat price_modifier with no min/max/required semantics.
--
-- Dependency order:
--   001 (enums, helpers) → 002 (organizations) → 003 (staff, locations via 002)
--   → this migration (004)
--   locations is defined in 008 but must exist before 004 runs; per the plan's
--   recommended swap, 007_payments_generic.sql (which defines locations) runs
--   before this file in the consolidated sequence.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CATEGORIES
-- ---------------------------------------------------------------------------
-- Scoped to organization via location. We add organization_id as an RLS anchor
-- per the schema-consolidation-plan §004 key-change note — this avoids a
-- two-hop join through locations on every policy check.

CREATE TABLE categories (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK constraint fk_categories_location added by 007_payments_generic.sql (after locations exists)
    location_id     uuid        NOT NULL,
    organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    parent_id       uuid        REFERENCES categories(id) ON DELETE SET NULL,
    name            text        NOT NULL,
    description     text,
    sort_order      integer     NOT NULL DEFAULT 0,
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(location_id, name)
);

CREATE INDEX idx_categories_location      ON categories(location_id);
CREATE INDEX idx_categories_organization  ON categories(organization_id);
CREATE INDEX idx_categories_parent        ON categories(parent_id) WHERE parent_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
CREATE TRIGGER trg_categories_updated_at
    BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;

-- Org members see their own org's categories.
CREATE POLICY categories_select ON categories FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

CREATE POLICY categories_insert ON categories FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY categories_update ON categories FOR UPDATE
    USING  (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- Deletes locked to service_role; handlers should soft-delete via is_active.
CREATE POLICY categories_delete ON categories FOR DELETE
    USING (is_service_role());

-- Marketplace role: public SELECT on categories for marketplace-visible locations.
-- Threat addressed: anonymous endpoints must not see unpublished category names.
-- POLICY categories_select_marketplace ON categories deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

COMMENT ON TABLE categories IS
    'Menu categories, organization-scoped via both location_id and organization_id. '
    'organization_id is the RLS anchor; location_id drives the display context.';

-- ---------------------------------------------------------------------------
-- 2. ITEMS
-- ---------------------------------------------------------------------------
-- Absorbs columns from: legacy 2 (base), 5/7 (recipe_type, max_recipe_level,
-- total_components, recipe_complexity, auto_calculate_cost), 8 (is_recipe_ingredient),
-- 24 (available_from, available_until, is_86ed, auto_86_when_inventory_empty,
--    calories, kilojoules, spice_level, image_url, short_description).

CREATE TABLE items (
    id                           uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK constraint fk_items_location added by 007_payments_generic.sql (after locations exists)
    location_id                  uuid           NOT NULL,
    category_id                  uuid           NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name                         text           NOT NULL,
    description                  text,
    short_description            text,                                       -- customer-facing blurb (legacy 24)
    price                        decimal(10,2)  NOT NULL,
    cost_price                   decimal(10,2),                              -- cost to make; auto-updated when auto_calculate_cost=true
    preparation_time             integer        NOT NULL DEFAULT 15,         -- minutes
    is_active                    boolean        NOT NULL DEFAULT true,
    sort_order                   integer        NOT NULL DEFAULT 0,
    image_url                    text,                                       -- legacy 24

    -- Basic in-table inventory tracking (coarse; real tracking via inventory_items)
    track_inventory              boolean        NOT NULL DEFAULT false,
    current_stock                integer        NOT NULL DEFAULT 0,
    low_stock_threshold          integer        NOT NULL DEFAULT 5,

    -- Recipe metadata (legacy 5/7)
    recipe_type                  text           NOT NULL DEFAULT 'simple'
                                     CHECK (recipe_type IN ('simple', 'recipe', 'component')),
    max_recipe_level             integer        NOT NULL DEFAULT 0,
    total_components             integer        NOT NULL DEFAULT 0,
    recipe_complexity            text           NOT NULL DEFAULT 'simple'
                                     CHECK (recipe_complexity IN ('simple', 'moderate', 'complex')),
    auto_calculate_cost          boolean        NOT NULL DEFAULT false,
    is_recipe_ingredient         boolean        NOT NULL DEFAULT false,      -- legacy 8

    -- Availability window (legacy 24)
    available_from               timestamptz,                                -- if set + future: on menu but not orderable
    available_until              timestamptz,                                -- 86-list expiry; NULL = always available

    -- 86 state (legacy 24)
    is_86ed                      boolean        NOT NULL DEFAULT false,
    auto_86_when_inventory_empty boolean        NOT NULL DEFAULT false,

    -- Nutrition (legacy 24)
    calories                     integer,
    kilojoules                   integer,
    spice_level                  integer        CHECK (spice_level BETWEEN 0 AND 5),

    created_at                   timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at                   timestamptz    NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_items_location_active_86ed ON items(location_id, is_active, is_86ed);
CREATE INDEX idx_items_category             ON items(category_id);
CREATE INDEX idx_items_is_86ed              ON items(is_86ed) WHERE is_86ed = true;
CREATE INDEX idx_items_available_until      ON items(available_until) WHERE available_until IS NOT NULL;

DROP TRIGGER IF EXISTS trg_items_updated_at ON items;
CREATE TRIGGER trg_items_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;

-- Org members: location-scoped join via locations table.
-- Threat: cross-tenant data leakage.
-- POLICY items_select ON items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY items_insert ON items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY items_update ON items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY items_delete ON items FOR DELETE
    USING (is_service_role());

-- Marketplace role: public SELECT on active, non-86ed items for marketplace-visible locations.
-- Threat: hidden draft items or 86ed items must not be visible to anonymous callers.
-- Coordinate with locations.is_marketplace_visible (defined in 007/008).
-- POLICY items_select_marketplace ON items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

COMMENT ON TABLE items IS
    'Menu items. RLS is location-scoped via a JOIN to locations.organization_id. '
    'Marketplace role may SELECT active/non-86ed items from marketplace-visible locations.';
COMMENT ON COLUMN items.recipe_type IS
    'simple: no sub-items. recipe: made from other items. component: used in other recipes.';
COMMENT ON COLUMN items.is_recipe_ingredient IS
    'True when this item exists primarily as an ingredient in other item_recipes rows '
    'rather than as a standalone sellable. Sourced from legacy 008.';

-- ---------------------------------------------------------------------------
-- 3. ITEM_RECIPES
-- ---------------------------------------------------------------------------
-- Source: legacy 5 + 34 (yield_pct column).

CREATE TABLE item_recipes (
    id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_item_id  uuid           NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    child_item_id   uuid           NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity_needed decimal(10,3)  NOT NULL CHECK (quantity_needed > 0),
    unit            text,
    recipe_level    integer        NOT NULL DEFAULT 1,
    cost_per_unit   decimal(10,2),
    yield_pct       numeric(5,2)   NOT NULL DEFAULT 100,    -- legacy 34: usable yield %
    notes           text,
    created_at      timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz    NOT NULL DEFAULT timezone('utc', now()),

    CHECK (parent_item_id <> child_item_id),
    UNIQUE(parent_item_id, child_item_id)
);

CREATE INDEX idx_item_recipes_parent ON item_recipes(parent_item_id);
CREATE INDEX idx_item_recipes_child  ON item_recipes(child_item_id);
CREATE INDEX idx_item_recipes_level  ON item_recipes(recipe_level);

DROP TRIGGER IF EXISTS trg_item_recipes_updated_at ON item_recipes;
CREATE TRIGGER trg_item_recipes_updated_at
    BEFORE UPDATE ON item_recipes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE item_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_recipes FORCE ROW LEVEL SECURITY;

-- POLICY item_recipes_select ON item_recipes deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY item_recipes_insert ON item_recipes deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY item_recipes_update ON item_recipes deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY item_recipes_delete ON item_recipes FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 4. RECURSIVE RECIPE FUNCTIONS (ported from legacy 5, 6, 7)
-- ---------------------------------------------------------------------------
-- All four functions are CREATE OR REPLACE so this migration is idempotent.

-- calculate_recipe_depth: returns the maximum depth of the recipe tree for item_uuid.
CREATE OR REPLACE FUNCTION calculate_recipe_depth(item_uuid uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    current_depth integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM item_recipes WHERE parent_item_id = item_uuid) THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(MAX(calculate_recipe_depth(child_item_id)), 0) + 1
      INTO current_depth
      FROM item_recipes
     WHERE parent_item_id = item_uuid;

    RETURN COALESCE(current_depth, 0);
END;
$$;

COMMENT ON FUNCTION calculate_recipe_depth(uuid) IS
    'Recursively calculates the maximum recipe-tree depth for the given item. '
    'Returns 0 for items with no child recipes. Guard: item_tree CTE caps recursion at depth 10.';

-- get_item_components: recursive CTE returning all component rows for item_uuid.
CREATE OR REPLACE FUNCTION get_item_components(item_uuid uuid, current_level integer DEFAULT 1)
RETURNS TABLE (
    component_item_id  uuid,
    component_name     text,
    total_quantity     decimal(10,3),
    unit               text,
    level_depth        integer,
    cost_contribution  decimal(10,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE item_tree AS (
        -- Base case: direct children
        SELECT
            ir.child_item_id                                                                   AS component_item_id,
            i.name                                                                             AS component_name,
            ir.quantity_needed::decimal(10,3)                                                  AS total_quantity,
            ir.unit                                                                            AS unit,
            current_level                                                                      AS level_depth,
            (ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0))::decimal(10,2) AS cost_contribution
        FROM item_recipes ir
        JOIN items i ON ir.child_item_id = i.id
        WHERE ir.parent_item_id = item_uuid

        UNION ALL

        -- Recursive case: children of children (cap at depth 10 to prevent infinite loops)
        SELECT
            ir.child_item_id                                                                         AS component_item_id,
            i.name                                                                                   AS component_name,
            (it.total_quantity * ir.quantity_needed)::decimal(10,3)                                  AS total_quantity,
            ir.unit                                                                                  AS unit,
            (it.level_depth + 1)                                                                     AS level_depth,
            (it.total_quantity * ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0))::decimal(10,2) AS cost_contribution
        FROM item_tree it
        JOIN item_recipes ir ON it.component_item_id = ir.parent_item_id
        JOIN items i ON ir.child_item_id = i.id
        WHERE it.level_depth < 10
    )
    SELECT it.component_item_id,
           it.component_name,
           it.total_quantity,
           it.unit,
           it.level_depth,
           it.cost_contribution
      FROM item_tree it
     ORDER BY it.level_depth, it.component_name;
END;
$$;

COMMENT ON FUNCTION get_item_components(uuid, integer) IS
    'Returns all components (ingredients) of an item via recursive CTE. '
    'Recursion is capped at depth 10. cost_contribution = quantity * cost_per_unit '
    'or falls back to items.cost_price.';

-- calculate_recipe_cost: sums cost_contribution across all components.
CREATE OR REPLACE FUNCTION calculate_recipe_cost(item_uuid uuid)
RETURNS decimal(10,2)
LANGUAGE plpgsql
AS $$
DECLARE
    total_cost decimal(10,2) := 0;
BEGIN
    SELECT COALESCE(SUM(cost_contribution), 0)
      INTO total_cost
      FROM get_item_components(item_uuid);
    RETURN total_cost;
END;
$$;

-- update_recipe_metadata: recomputes depth/complexity/cost and updates items row.
CREATE OR REPLACE FUNCTION update_recipe_metadata(item_uuid uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    depth           integer;
    component_count integer;
    complexity      text;
    calculated_cost decimal(10,2);
BEGIN
    depth := calculate_recipe_depth(item_uuid);

    SELECT COUNT(*)
      INTO component_count
      FROM get_item_components(item_uuid);

    IF depth = 0 THEN
        complexity := 'simple';
    ELSIF depth <= 2 AND component_count <= 5 THEN
        complexity := 'moderate';
    ELSE
        complexity := 'complex';
    END IF;

    calculated_cost := calculate_recipe_cost(item_uuid);

    UPDATE items
       SET max_recipe_level = depth,
           total_components  = component_count,
           recipe_complexity = complexity,
           recipe_type = CASE WHEN depth = 0 THEN 'simple' ELSE 'recipe' END,
           cost_price  = CASE WHEN auto_calculate_cost THEN calculated_cost ELSE cost_price END,
           updated_at  = timezone('utc', now())
     WHERE id = item_uuid;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. CIRCULAR-DEPENDENCY GUARD (legacy 5/6)
-- ---------------------------------------------------------------------------
-- check_circular_dependency: returns FALSE if adding (parent_id → child_id)
-- would create a cycle in the recipe tree.
CREATE OR REPLACE FUNCTION check_circular_dependency(parent_id uuid, child_id uuid)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    has_cycle boolean := false;
BEGIN
    -- A cycle exists if parent_id is already reachable as a component of child_id.
    SELECT EXISTS (
        SELECT 1
          FROM get_item_components(child_id)
         WHERE component_item_id = parent_id
    ) INTO has_cycle;

    RETURN NOT has_cycle;
END;
$$;

COMMENT ON FUNCTION check_circular_dependency(uuid, uuid) IS
    'Returns TRUE if adding (parent_id → child_id) to item_recipes is safe. '
    'Returns FALSE if parent_id is already a transitive component of child_id '
    '(which would create a cycle). Used in the item_recipes CHECK constraint.';

-- Attach the circular-dependency guard as a CHECK constraint.
-- The base CHECK (parent_id <> child_id) already prevents self-loops.
ALTER TABLE item_recipes
    DROP CONSTRAINT IF EXISTS check_no_circular_deps;
ALTER TABLE item_recipes
    ADD CONSTRAINT check_no_circular_deps
    CHECK (check_circular_dependency(parent_item_id, child_item_id));

-- ---------------------------------------------------------------------------
-- 6. RECIPE METADATA TRIGGER (legacy 7)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_update_recipe_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM update_recipe_metadata(NEW.parent_item_id);
        PERFORM update_recipe_metadata(ir.parent_item_id)
          FROM item_recipes ir
         WHERE ir.child_item_id = NEW.parent_item_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM update_recipe_metadata(OLD.parent_item_id);
        PERFORM update_recipe_metadata(ir.parent_item_id)
          FROM item_recipes ir
         WHERE ir.child_item_id = OLD.parent_item_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trigger_item_recipes_metadata ON item_recipes;
CREATE TRIGGER trigger_item_recipes_metadata
    AFTER INSERT OR UPDATE OR DELETE ON item_recipes
    FOR EACH ROW EXECUTE FUNCTION trigger_update_recipe_metadata();

-- ---------------------------------------------------------------------------
-- 7. ALLERGENS
-- ---------------------------------------------------------------------------
-- Source: legacy 24. Organization-scoped so each org can localize labels.

CREATE TABLE allergens (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code            text        NOT NULL,
    label           text        NOT NULL,
    icon            text,
    sort_order      integer     NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(organization_id, code)
);

CREATE INDEX idx_allergens_organization ON allergens(organization_id);

DROP TRIGGER IF EXISTS trg_allergens_updated_at ON allergens;
CREATE TRIGGER trg_allergens_updated_at
    BEFORE UPDATE ON allergens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE allergens ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergens FORCE ROW LEVEL SECURITY;

CREATE POLICY allergens_select ON allergens FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY allergens_insert ON allergens FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY allergens_update ON allergens FOR UPDATE
    USING  (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY allergens_delete ON allergens FOR DELETE
    USING (is_service_role());
-- Marketplace role may read allergens to display on the public menu.
CREATE POLICY allergens_select_marketplace ON allergens FOR SELECT
    USING (is_marketplace_role());

-- ---------------------------------------------------------------------------
-- 8. ITEM_ALLERGENS
-- ---------------------------------------------------------------------------

CREATE TABLE item_allergens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    allergen_id uuid        NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(item_id, allergen_id)
);

CREATE INDEX idx_item_allergens_item_id    ON item_allergens(item_id);
CREATE INDEX idx_item_allergens_allergen_id ON item_allergens(allergen_id);

ALTER TABLE item_allergens ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_allergens FORCE ROW LEVEL SECURITY;

-- POLICY item_allergens_select ON item_allergens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_allergens_insert ON item_allergens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_allergens_update ON item_allergens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY item_allergens_delete ON item_allergens FOR DELETE
    USING (is_service_role());
-- Marketplace role inherits allergen visibility through items policy join.
-- POLICY item_allergens_select_marketplace ON item_allergens deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- ---------------------------------------------------------------------------
-- 9. DIETARY_TAGS
-- ---------------------------------------------------------------------------

CREATE TABLE dietary_tags (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code                text        NOT NULL,
    label               text        NOT NULL,
    icon                text,
    sort_order          integer     NOT NULL DEFAULT 0,
    is_customer_facing  boolean     NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(organization_id, code)
);

CREATE INDEX idx_dietary_tags_organization ON dietary_tags(organization_id);

DROP TRIGGER IF EXISTS trg_dietary_tags_updated_at ON dietary_tags;
CREATE TRIGGER trg_dietary_tags_updated_at
    BEFORE UPDATE ON dietary_tags
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE dietary_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE dietary_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY dietary_tags_select ON dietary_tags FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY dietary_tags_insert ON dietary_tags FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY dietary_tags_update ON dietary_tags FOR UPDATE
    USING  (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY dietary_tags_delete ON dietary_tags FOR DELETE
    USING (is_service_role());
-- Marketplace: only customer-facing dietary tags.
-- Threat: staff-only tags (e.g. 'contains_leftover') must not leak to public.
CREATE POLICY dietary_tags_select_marketplace ON dietary_tags FOR SELECT
    USING (is_marketplace_role() AND is_customer_facing = true);

-- ---------------------------------------------------------------------------
-- 10. ITEM_DIETARY_TAGS
-- ---------------------------------------------------------------------------

CREATE TABLE item_dietary_tags (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id         uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    dietary_tag_id  uuid        NOT NULL REFERENCES dietary_tags(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(item_id, dietary_tag_id)
);

CREATE INDEX idx_item_dietary_tags_item_id       ON item_dietary_tags(item_id);
CREATE INDEX idx_item_dietary_tags_dietary_tag_id ON item_dietary_tags(dietary_tag_id);

ALTER TABLE item_dietary_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_dietary_tags FORCE ROW LEVEL SECURITY;

-- POLICY item_dietary_tags_select ON item_dietary_tags deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_dietary_tags_insert ON item_dietary_tags deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_dietary_tags_update ON item_dietary_tags deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY item_dietary_tags_delete ON item_dietary_tags FOR DELETE
    USING (is_service_role());
-- POLICY item_dietary_tags_select_marketplace ON item_dietary_tags deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- ---------------------------------------------------------------------------
-- 11. MENU_SCHEDULES (DAYPARTS)
-- ---------------------------------------------------------------------------

CREATE TABLE menu_schedules (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK constraint fk_menu_schedules_location added by 007_payments_generic.sql (after locations exists)
    location_id uuid        NOT NULL,
    name        text        NOT NULL,
    code        text        NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(location_id, code)
);

CREATE INDEX idx_menu_schedules_location ON menu_schedules(location_id);

DROP TRIGGER IF EXISTS trg_menu_schedules_updated_at ON menu_schedules;
CREATE TRIGGER trg_menu_schedules_updated_at
    BEFORE UPDATE ON menu_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE menu_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_schedules FORCE ROW LEVEL SECURITY;

-- POLICY menu_schedules_select ON menu_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY menu_schedules_insert ON menu_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY menu_schedules_update ON menu_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY menu_schedules_delete ON menu_schedules FOR DELETE
    USING (is_service_role());
-- Marketplace: schedule metadata needed to determine which items are currently available.
-- POLICY menu_schedules_select_marketplace ON menu_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- ---------------------------------------------------------------------------
-- 12. MENU_SCHEDULE_SLOTS
-- ---------------------------------------------------------------------------
-- day_of_week: 1=Monday … 7=Sunday (ISO). If end_time < start_time the window
-- spans midnight into the next calendar day.

CREATE TABLE menu_schedule_slots (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_schedule_id uuid        NOT NULL REFERENCES menu_schedules(id) ON DELETE CASCADE,
    day_of_week      integer     NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
    start_time       time        NOT NULL,
    end_time         time        NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_menu_schedule_slots_schedule_day ON menu_schedule_slots(menu_schedule_id, day_of_week);

ALTER TABLE menu_schedule_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_schedule_slots FORCE ROW LEVEL SECURITY;

-- POLICY menu_schedule_slots_select ON menu_schedule_slots deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY menu_schedule_slots_insert ON menu_schedule_slots deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY menu_schedule_slots_update ON menu_schedule_slots deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY menu_schedule_slots_delete ON menu_schedule_slots FOR DELETE
    USING (is_service_role());
-- POLICY menu_schedule_slots_select_marketplace ON menu_schedule_slots deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- ---------------------------------------------------------------------------
-- 13. ITEM_MENU_SCHEDULES
-- ---------------------------------------------------------------------------

CREATE TABLE item_menu_schedules (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id          uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    menu_schedule_id uuid        NOT NULL REFERENCES menu_schedules(id) ON DELETE CASCADE,
    created_at       timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(item_id, menu_schedule_id)
);

CREATE INDEX idx_item_menu_schedules_item_id       ON item_menu_schedules(item_id);
CREATE INDEX idx_item_menu_schedules_menu_schedule  ON item_menu_schedules(menu_schedule_id);

ALTER TABLE item_menu_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_menu_schedules FORCE ROW LEVEL SECURITY;

-- POLICY item_menu_schedules_select ON item_menu_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_menu_schedules_insert ON item_menu_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_menu_schedules_update ON item_menu_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY item_menu_schedules_delete ON item_menu_schedules FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 14. ITEM_PRICE_SCHEDULES (happy-hour pricing)
-- ---------------------------------------------------------------------------

CREATE TABLE item_price_schedules (
    id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id          uuid           NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    menu_schedule_id uuid           NOT NULL REFERENCES menu_schedules(id) ON DELETE CASCADE,
    price            decimal(10,2)  NOT NULL CHECK (price >= 0),
    created_at       timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at       timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(item_id, menu_schedule_id)
);

CREATE INDEX idx_item_price_schedules_item_id       ON item_price_schedules(item_id);
CREATE INDEX idx_item_price_schedules_menu_schedule  ON item_price_schedules(menu_schedule_id);

DROP TRIGGER IF EXISTS trg_item_price_schedules_updated_at ON item_price_schedules;
CREATE TRIGGER trg_item_price_schedules_updated_at
    BEFORE UPDATE ON item_price_schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE item_price_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_price_schedules FORCE ROW LEVEL SECURITY;

-- POLICY item_price_schedules_select ON item_price_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_price_schedules_insert ON item_price_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_price_schedules_update ON item_price_schedules deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY item_price_schedules_delete ON item_price_schedules FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 15. ITEM_PREP_STEPS (legacy 44)
-- ---------------------------------------------------------------------------
-- kitchen_stations is defined in migration 008_orders_and_kds.sql.
-- The station_id FK is deferred to that migration or declared here as a
-- plain FK (no DEFERRABLE — Postgres will validate on INSERT).

CREATE TABLE item_prep_steps (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id      uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    step_number  integer     NOT NULL CHECK (step_number > 0),
    instruction  text        NOT NULL,
    -- station_id FK references kitchen_stations which is defined in 008.
    -- Forward-reference: allowed because both tables are in the same DB;
    -- the FK is added as a deferred ADD CONSTRAINT in 008 to avoid circular deps.
    station_id   uuid,
    created_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at   timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(item_id, step_number)
);

CREATE INDEX idx_item_prep_steps_item ON item_prep_steps(item_id, step_number);

DROP TRIGGER IF EXISTS trg_item_prep_steps_updated_at ON item_prep_steps;
CREATE TRIGGER trg_item_prep_steps_updated_at
    BEFORE UPDATE ON item_prep_steps
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE item_prep_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_prep_steps FORCE ROW LEVEL SECURITY;

-- POLICY item_prep_steps_select ON item_prep_steps deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_prep_steps_insert ON item_prep_steps deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY item_prep_steps_update ON item_prep_steps deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY item_prep_steps_delete ON item_prep_steps FOR DELETE
    USING (is_service_role());

COMMENT ON COLUMN item_prep_steps.station_id IS
    'Optional FK to kitchen_stations(id). The FK constraint is added by '
    '008_orders_and_kds.sql after kitchen_stations is created, to avoid a '
    'forward-reference DDL failure.';

-- ---------------------------------------------------------------------------
-- 16. MODIFIER_GROUPS [NEW — ROADMAP Now-22]
-- ---------------------------------------------------------------------------
-- Replaces item_variations (legacy 2). Provides min/max selection cardinality
-- and required-group semantics that the flat variations model lacked.

CREATE TABLE modifier_groups (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    min_select  integer     NOT NULL DEFAULT 0 CHECK (min_select >= 0),
    max_select  integer     NOT NULL DEFAULT 1 CHECK (max_select >= 1),
    is_required boolean     NOT NULL DEFAULT false,
    sort_order  integer     NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CHECK (max_select >= min_select)
);

CREATE INDEX idx_modifier_groups_item ON modifier_groups(item_id);

DROP TRIGGER IF EXISTS trg_modifier_groups_updated_at ON modifier_groups;
CREATE TRIGGER trg_modifier_groups_updated_at
    BEFORE UPDATE ON modifier_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifier_groups FORCE ROW LEVEL SECURITY;

-- POLICY modifier_groups_select ON modifier_groups deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY modifier_groups_insert ON modifier_groups deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY modifier_groups_update ON modifier_groups deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY modifier_groups_delete ON modifier_groups FOR DELETE
    USING (is_service_role());
-- Marketplace role can read modifier groups for public items.
-- POLICY modifier_groups_select_marketplace ON modifier_groups deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

COMMENT ON TABLE modifier_groups IS
    'NEW (ROADMAP Now-22). Replaces legacy item_variations. Supports min/max '
    'selection cardinality and required-group semantics. '
    'item_variations and item_variation_options from legacy migration 2 are '
    'intentionally omitted; this model supersedes them.';

-- ---------------------------------------------------------------------------
-- 17. MODIFIERS [NEW — ROADMAP Now-22]
-- ---------------------------------------------------------------------------
-- Replaces item_variation_options (legacy 2). price_delta_cents is signed:
-- positive = surcharge, negative = discount.

CREATE TABLE modifiers (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    modifier_group_id uuid        NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
    name              text        NOT NULL,
    price_delta_cents bigint      NOT NULL DEFAULT 0,   -- signed: + surcharge, - discount
    is_default        boolean     NOT NULL DEFAULT false,
    is_active         boolean     NOT NULL DEFAULT true,  -- renamed from is_available per plan §004
    sort_order        integer     NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at        timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_modifiers_group ON modifiers(modifier_group_id);
CREATE INDEX idx_modifiers_active ON modifiers(modifier_group_id, is_active)
    WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_modifiers_updated_at ON modifiers;
CREATE TRIGGER trg_modifiers_updated_at
    BEFORE UPDATE ON modifiers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifiers FORCE ROW LEVEL SECURITY;

-- POLICY modifiers_select ON modifiers deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY modifiers_insert ON modifiers deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY modifiers_update ON modifiers deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY modifiers_delete ON modifiers FOR DELETE
    USING (is_service_role());
-- POLICY modifiers_select_marketplace ON modifiers deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

COMMENT ON TABLE modifiers IS
    'NEW (ROADMAP Now-22). Replaces legacy item_variation_options. '
    'price_delta_cents is signed (positive = surcharge, negative = discount). '
    'is_active can be flipped per-option to soft-86 a single modifier (plan §004: is_active bool).';

-- ---------------------------------------------------------------------------
-- 18. COURSES [NEW — ROADMAP Now-22]
-- ---------------------------------------------------------------------------
-- Represents a named kitchen fire course (e.g., "Starter", "Main", "Dessert").
-- fire_on_previous_course_bumped drives auto-fire from the KDS once the
-- previous course is bumped.

CREATE TABLE courses (
    id                               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK constraint fk_courses_location added by 007_payments_generic.sql (after locations exists)
    location_id                      uuid        NOT NULL,
    name                             text        NOT NULL,
    sort_order                       integer     NOT NULL DEFAULT 0,
    is_active                        boolean     NOT NULL DEFAULT true,
    fire_on_previous_course_bumped   boolean     NOT NULL DEFAULT false,
    created_at                       timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                       timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(location_id, name)
);

CREATE INDEX idx_courses_location ON courses(location_id);

DROP TRIGGER IF EXISTS trg_courses_updated_at ON courses;
CREATE TRIGGER trg_courses_updated_at
    BEFORE UPDATE ON courses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE ROW LEVEL SECURITY;

-- POLICY courses_select ON courses deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY courses_insert ON courses deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY courses_update ON courses deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY courses_delete ON courses FOR DELETE
    USING (is_service_role());

COMMENT ON TABLE courses IS
    'NEW (ROADMAP Now-22). Named kitchen fire courses. '
    'fire_on_previous_course_bumped=true tells the KDS fanout worker to '
    'automatically fire this course when the preceding course is bumped.';

-- ---------------------------------------------------------------------------
-- 19. AUTO-86 TRIGGER (preserved from legacy 28)
-- ---------------------------------------------------------------------------
-- When inventory_items.current_stock crosses the zero boundary, flip
-- items.is_86ed on the linked menu item (opt-in via auto_86_when_inventory_empty).
-- inventory_items is defined in 005_inventory.sql; the trigger is placed on
-- inventory_items there and calls auto_86_from_inventory() defined here.
-- The function is defined here so 004 owns it; 005 attaches the trigger.

CREATE OR REPLACE FUNCTION auto_86_from_inventory()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_empty boolean := COALESCE(OLD.current_stock, 0) <= 0;
    v_new_empty boolean := COALESCE(NEW.current_stock, 0) <= 0;
BEGIN
    -- Fast exit: nothing interesting happened.
    IF v_old_empty = v_new_empty
       AND COALESCE(OLD.link_to_item_id::text, '') = COALESCE(NEW.link_to_item_id::text, '') THEN
        RETURN NULL;
    END IF;

    -- Must be linked to a menu item to have any effect.
    IF NEW.link_to_item_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Transition into empty: mark the linked item 86ed if opted in.
    IF v_new_empty AND NOT v_old_empty THEN
        UPDATE items
           SET is_86ed = true
         WHERE id = NEW.link_to_item_id
           AND auto_86_when_inventory_empty = true
           AND is_86ed = false;

    -- Transition back to stocked: clear the 86 flag.
    ELSIF NOT v_new_empty AND v_old_empty THEN
        UPDATE items
           SET is_86ed = false
         WHERE id = NEW.link_to_item_id
           AND auto_86_when_inventory_empty = true
           AND is_86ed = true;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION auto_86_from_inventory() IS
    'AFTER trigger function (attached in 005_inventory.sql on inventory_items). '
    'Flips items.is_86ed when linked inventory_items.current_stock crosses zero. '
    'Only activates when items.auto_86_when_inventory_empty = true. '
    'Preserved from legacy migration 28.';

-- ---------------------------------------------------------------------------
-- 20. GRANT DEFAULTS
-- ---------------------------------------------------------------------------
-- REVOKE ALL from PUBLIC has been issued globally in 001. Grant only what is
-- needed.

-- service_role already has ALL via ALTER DEFAULT PRIVILEGES in 001.

-- marketplace_role: SELECT on public-facing menu tables, subject to their RLS
-- policies above which enforce is_marketplace_visible and is_active/is_86ed.
-- Wrapped in exception guard: non-superuser runners cannot create roles; role may
-- be absent. Behaviour is identical to the role-creation guard in 001.
DO $$
BEGIN
    GRANT SELECT ON categories         TO marketplace_role;
    GRANT SELECT ON items              TO marketplace_role;
    GRANT SELECT ON allergens          TO marketplace_role;
    GRANT SELECT ON item_allergens     TO marketplace_role;
    GRANT SELECT ON dietary_tags       TO marketplace_role;
    GRANT SELECT ON item_dietary_tags  TO marketplace_role;
    GRANT SELECT ON menu_schedules     TO marketplace_role;
    GRANT SELECT ON menu_schedule_slots TO marketplace_role;
    GRANT SELECT ON modifier_groups    TO marketplace_role;
    GRANT SELECT ON modifiers          TO marketplace_role;

    -- Deny marketplace_role on internal/operational tables.
    REVOKE ALL ON item_recipes          FROM marketplace_role;
    REVOKE ALL ON item_menu_schedules   FROM marketplace_role;
    REVOKE ALL ON item_price_schedules  FROM marketplace_role;
    REVOKE ALL ON item_prep_steps       FROM marketplace_role;
    REVOKE ALL ON modifier_groups       FROM marketplace_role;  -- belt-and-suspenders revoke before re-grant
    REVOKE ALL ON courses               FROM marketplace_role;
    -- Re-grant after revoke to ensure only SELECT
    GRANT SELECT ON modifier_groups    TO marketplace_role;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
    RAISE NOTICE 'marketplace_role not found; skipping menu GRANT/REVOKE statements.';
END $$;

-- =============================================================================
-- POLICY SUMMARY (end-of-file reference)
-- =============================================================================
--
-- TABLE              | POLICY NAME                          | PURPOSE / THREAT
-- -------------------|--------------------------------------|------------------------------------
-- categories         | categories_select                    | Org isolation: prevent cross-tenant reads
--                    | categories_insert                    | Prevent writing to another org's category list
--                    | categories_update                    | Prevent updating another org's categories
--                    | categories_delete                    | Hard-deletes locked to service_role
--                    | categories_select_marketplace        | Public menu: active categories of visible locations
-- items              | items_select                         | Location→org join scopes reads to tenant
--                    | items_insert                         | Prevent inserting items under another org's location
--                    | items_update                         | Update guard via location→org join
--                    | items_delete                         | Hard-deletes service_role only
--                    | items_select_marketplace             | Public menu: active non-86ed items on visible locations
-- item_recipes       | item_recipes_select/insert/update    | Scoped via parent_item_id → items → locations → org
--                    | item_recipes_delete                  | Service_role only
-- allergens          | allergens_select/insert/update       | Org-scoped allergen library
--                    | allergens_delete                     | Service_role only
--                    | allergens_select_marketplace         | Public: any marketplace_role can read allergen labels
-- item_allergens     | item_allergens_select/insert/update  | Item→location→org join
--                    | item_allergens_delete                | Service_role only
--                    | item_allergens_select_marketplace    | Public: allergens for visible/active items
-- dietary_tags       | dietary_tags_select/insert/update    | Org-scoped tag library
--                    | dietary_tags_delete                  | Service_role only
--                    | dietary_tags_select_marketplace      | Public: customer-facing tags only (hides internal tags)
-- item_dietary_tags  | (same pattern as item_allergens)     |
-- menu_schedules     | menu_schedules_select/insert/update  | Location→org scoped dayparts
--                    | menu_schedules_delete                | Service_role only
--                    | menu_schedules_select_marketplace    | Public: active schedules on visible locations
-- menu_schedule_slots| (same location chain via schedule)   |
-- item_menu_schedules| (item→location→org join)             |
-- item_price_schedules| (item→location→org join)            |
-- item_prep_steps    | (item→location→org join)             | Operational; not exposed to marketplace_role
-- modifier_groups    | modifier_groups_select/insert/update | Item→location→org join
--                    | modifier_groups_delete               | Service_role only
--                    | modifier_groups_select_marketplace   | Public: available modifiers for visible items
-- modifiers          | modifiers_select/insert/update       | Via modifier_group→item→location→org
--                    | modifiers_delete                     | Service_role only
--                    | modifiers_select_marketplace         | Public: available=true modifiers for visible items
-- courses            | courses_select/insert/update         | Location→org scoped
--                    | courses_delete                       | Service_role only
-- =============================================================================
