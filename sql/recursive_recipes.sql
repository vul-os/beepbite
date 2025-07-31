-- RECURSIVE RECIPES AND ITEM DEPENDENCIES
-- Adds support for items that can be made from other items (sub-recipes)
-- with level tracking for recipe depth

-- ======================
-- RECURSIVE ITEM RELATIONSHIPS
-- ======================

-- Item recipes table - allows items to be made from other items
CREATE TABLE item_recipes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    parent_item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL, -- The item being made
    child_item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,  -- The ingredient item
    quantity_needed decimal(10,3) NOT NULL, -- Amount of child item needed
    unit text, -- Unit of measurement (pieces, grams, ml, etc.)
    recipe_level integer DEFAULT 1, -- Depth level in the recipe tree
    cost_per_unit decimal(10,2), -- Cost of this ingredient at time of recipe creation
    notes text, -- Special preparation notes
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Prevent circular dependencies
    CHECK (parent_item_id != child_item_id),
    UNIQUE(parent_item_id, child_item_id)
);

-- Add indexes for performance
CREATE INDEX idx_item_recipes_parent ON item_recipes(parent_item_id);
CREATE INDEX idx_item_recipes_child ON item_recipes(child_item_id);
CREATE INDEX idx_item_recipes_level ON item_recipes(recipe_level);

-- ======================
-- ALTER EXISTING TABLES
-- ======================

-- Add recipe-related fields to items table
ALTER TABLE items ADD COLUMN IF NOT EXISTS recipe_type text DEFAULT 'simple' CHECK (recipe_type IN ('simple', 'recipe', 'component'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_recipe_level integer DEFAULT 0; -- Maximum depth of this item's recipe tree
ALTER TABLE items ADD COLUMN IF NOT EXISTS total_components integer DEFAULT 0; -- Total number of sub-components
ALTER TABLE items ADD COLUMN IF NOT EXISTS recipe_complexity text DEFAULT 'simple' CHECK (recipe_complexity IN ('simple', 'moderate', 'complex'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS auto_calculate_cost boolean DEFAULT false; -- Whether to auto-calculate cost from sub-items

-- Add comments for clarity
COMMENT ON COLUMN items.recipe_type IS 'simple: no sub-items, recipe: made from other items, component: used in other recipes';
COMMENT ON COLUMN items.max_recipe_level IS 'Maximum depth of recipe tree for this item';
COMMENT ON COLUMN items.total_components IS 'Total number of sub-components in complete recipe tree';
COMMENT ON COLUMN items.recipe_complexity IS 'Complexity based on recipe depth and component count';

-- ======================
-- RECURSIVE FUNCTIONS
-- ======================

-- Function to calculate recipe depth for an item
CREATE OR REPLACE FUNCTION calculate_recipe_depth(item_uuid uuid)
RETURNS integer AS $$
DECLARE
    max_depth integer := 0;
    current_depth integer;
BEGIN
    -- Base case: if item has no sub-items, depth is 0
    IF NOT EXISTS (SELECT 1 FROM item_recipes WHERE parent_item_id = item_uuid) THEN
        RETURN 0;
    END IF;
    
    -- Recursive case: find maximum depth of all sub-items + 1
    SELECT COALESCE(MAX(calculate_recipe_depth(child_item_id)), 0) + 1
    INTO current_depth
    FROM item_recipes 
    WHERE parent_item_id = item_uuid;
    
    RETURN COALESCE(current_depth, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to get all components of an item (recursive)
CREATE OR REPLACE FUNCTION get_item_components(item_uuid uuid, current_level integer DEFAULT 1)
RETURNS TABLE (
    component_item_id uuid,
    component_name text,
    total_quantity decimal(10,3),
    unit text,
    level_depth integer,
    cost_contribution decimal(10,2)
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE item_tree AS (
        -- Base case: direct children
        SELECT 
            ir.child_item_id,
            i.name,
            ir.quantity_needed,
            ir.unit,
            current_level as depth,
            (ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0)) as cost
        FROM item_recipes ir
        JOIN items i ON ir.child_item_id = i.id
        WHERE ir.parent_item_id = item_uuid
        
        UNION ALL
        
        -- Recursive case: children of children
        SELECT 
            ir.child_item_id,
            i.name,
            it.total_quantity * ir.quantity_needed,
            ir.unit,
            it.depth + 1,
            (it.total_quantity * ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0))
        FROM item_tree it
        JOIN item_recipes ir ON it.component_item_id = ir.parent_item_id
        JOIN items i ON ir.child_item_id = i.id
        WHERE it.depth < 10 -- Prevent infinite recursion
    )
    SELECT * FROM item_tree ORDER BY depth, component_name;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate total recipe cost
CREATE OR REPLACE FUNCTION calculate_recipe_cost(item_uuid uuid)
RETURNS decimal(10,2) AS $$
DECLARE
    total_cost decimal(10,2) := 0;
BEGIN
    -- Sum up all component costs
    SELECT COALESCE(SUM(cost_contribution), 0)
    INTO total_cost
    FROM get_item_components(item_uuid);
    
    RETURN total_cost;
END;
$$ LANGUAGE plpgsql;

-- Function to update recipe metadata for an item
CREATE OR REPLACE FUNCTION update_recipe_metadata(item_uuid uuid)
RETURNS void AS $$
DECLARE
    depth integer;
    component_count integer;
    complexity text;
    calculated_cost decimal(10,2);
BEGIN
    -- Calculate depth
    depth := calculate_recipe_depth(item_uuid);
    
    -- Count total components
    SELECT COUNT(*)
    INTO component_count
    FROM get_item_components(item_uuid);
    
    -- Determine complexity
    IF depth = 0 THEN
        complexity := 'simple';
    ELSIF depth <= 2 AND component_count <= 5 THEN
        complexity := 'moderate';
    ELSE
        complexity := 'complex';
    END IF;
    
    -- Calculate cost if auto-calculation is enabled
    calculated_cost := calculate_recipe_cost(item_uuid);
    
    -- Update the item
    UPDATE items 
    SET 
        max_recipe_level = depth,
        total_components = component_count,
        recipe_complexity = complexity,
        recipe_type = CASE 
            WHEN depth = 0 THEN 'simple'
            ELSE 'recipe'
        END,
        cost_price = CASE 
            WHEN auto_calculate_cost THEN calculated_cost
            ELSE cost_price
        END,
        updated_at = timezone('utc'::text, now())
    WHERE id = item_uuid;
END;
$$ LANGUAGE plpgsql;

-- ======================
-- TRIGGERS
-- ======================

-- Trigger to update recipe levels when item_recipes changes
CREATE OR REPLACE FUNCTION trigger_update_recipe_metadata()
RETURNS TRIGGER AS $$
BEGIN
    -- Update metadata for affected items
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        PERFORM update_recipe_metadata(NEW.parent_item_id);
        -- Also update any parent items that use this item
        PERFORM update_recipe_metadata(ir.parent_item_id)
        FROM item_recipes ir 
        WHERE ir.child_item_id = NEW.parent_item_id;
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        PERFORM update_recipe_metadata(OLD.parent_item_id);
        -- Also update any parent items that use this item
        PERFORM update_recipe_metadata(ir.parent_item_id)
        FROM item_recipes ir 
        WHERE ir.child_item_id = OLD.parent_item_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_item_recipes_metadata
    AFTER INSERT OR UPDATE OR DELETE ON item_recipes
    FOR EACH ROW EXECUTE FUNCTION trigger_update_recipe_metadata();

-- ======================
-- UTILITY VIEWS
-- ======================

-- View for flat recipe breakdown
CREATE OR REPLACE VIEW recipe_breakdown AS
SELECT 
    p.id as parent_item_id,
    p.name as parent_item_name,
    p.recipe_complexity,
    p.max_recipe_level,
    p.total_components,
    c.component_item_id,
    c.component_name,
    c.total_quantity,
    c.unit,
    c.level_depth,
    c.cost_contribution,
    ROUND((c.cost_contribution / NULLIF(calculate_recipe_cost(p.id), 0)) * 100, 2) as cost_percentage
FROM items p
CROSS JOIN LATERAL get_item_components(p.id) c
WHERE p.recipe_type IN ('recipe', 'component')
ORDER BY p.name, c.level_depth, c.component_name;

-- View for recipe summary
CREATE OR REPLACE VIEW recipe_summary AS
SELECT 
    i.id,
    i.name,
    i.recipe_type,
    i.recipe_complexity,
    i.max_recipe_level,
    i.total_components,
    i.cost_price as listed_cost,
    calculate_recipe_cost(i.id) as calculated_cost,
    ABS(i.cost_price - calculate_recipe_cost(i.id)) as cost_variance,
    i.auto_calculate_cost,
    CASE 
        WHEN i.total_components = 0 THEN 'No recipe'
        WHEN ABS(i.cost_price - calculate_recipe_cost(i.id)) > 0.50 THEN 'Cost mismatch'
        ELSE 'Cost aligned'
    END as cost_status
FROM items i
ORDER BY i.recipe_complexity DESC, i.total_components DESC;

-- ======================
-- CONSTRAINTS
-- ======================

-- Prevent circular dependencies with a more robust check
CREATE OR REPLACE FUNCTION check_circular_dependency(parent_id uuid, child_id uuid)
RETURNS boolean AS $$
DECLARE
    has_cycle boolean := false;
BEGIN
    -- Check if adding this relationship would create a cycle
    -- by seeing if parent_id is already a component of child_id
    SELECT EXISTS (
        SELECT 1 
        FROM get_item_components(child_id) 
        WHERE component_item_id = parent_id
    ) INTO has_cycle;
    
    RETURN NOT has_cycle;
END;
$$ LANGUAGE plpgsql;

-- Add constraint to prevent circular dependencies
ALTER TABLE item_recipes 
ADD CONSTRAINT check_no_circular_deps 
CHECK (check_circular_dependency(parent_item_id, child_item_id));

-- ======================
-- SAMPLE DATA FOR TESTING
-- ======================

-- Note: Uncomment the section below if you want to add sample data for testing

/*
-- Sample items for testing recursive recipes
INSERT INTO items (location_id, category_id, name, description, price, recipe_type, auto_calculate_cost) 
SELECT 
    l.id, 
    c.id, 
    'Pizza Base',
    'Basic pizza dough base',
    15.00,
    'component',
    false
FROM locations l, categories c 
WHERE l.name LIKE '%Pizza%' AND c.name = 'Components'
LIMIT 1;

INSERT INTO items (location_id, category_id, name, description, price, recipe_type, auto_calculate_cost)
SELECT 
    l.id,
    c.id,
    'Supreme Pizza',
    'Pizza with multiple toppings',
    89.00,
    'recipe',
    true
FROM locations l, categories c 
WHERE l.name LIKE '%Pizza%' AND c.name = 'Pizzas'
LIMIT 1;

-- Add recipe relationships
INSERT INTO item_recipes (parent_item_id, child_item_id, quantity_needed, unit, cost_per_unit)
SELECT 
    (SELECT id FROM items WHERE name = 'Supreme Pizza' LIMIT 1),
    (SELECT id FROM items WHERE name = 'Pizza Base' LIMIT 1),
    1,
    'piece',
    15.00;
*/ 