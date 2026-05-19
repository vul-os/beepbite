-- APPLY RECURSIVE RECIPES SCHEMA
-- This script applies the recursive recipe functionality to your existing database
-- Run this in your Supabase SQL Editor

-- First, let's ensure we have the required columns on the items table
ALTER TABLE items ADD COLUMN IF NOT EXISTS recipe_type text DEFAULT 'simple' CHECK (recipe_type IN ('simple', 'recipe', 'component'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_recipe_level integer DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS total_components integer DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS recipe_complexity text DEFAULT 'simple' CHECK (recipe_complexity IN ('simple', 'moderate', 'complex'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS auto_calculate_cost boolean DEFAULT false;

-- Create the item_recipes table if it doesn't exist
CREATE TABLE IF NOT EXISTS item_recipes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    parent_item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    child_item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    quantity_needed decimal(10,3) NOT NULL,
    unit text,
    recipe_level integer DEFAULT 1,
    cost_per_unit decimal(10,2),
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    CHECK (parent_item_id != child_item_id),
    UNIQUE(parent_item_id, child_item_id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_item_recipes_parent ON item_recipes(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_item_recipes_child ON item_recipes(child_item_id);
CREATE INDEX IF NOT EXISTS idx_item_recipes_level ON item_recipes(recipe_level);

-- Create the recursive functions
CREATE OR REPLACE FUNCTION calculate_recipe_depth(item_uuid uuid)
RETURNS integer AS $$
DECLARE
    max_depth integer := 0;
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
$$ LANGUAGE plpgsql;

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
        -- Base case: direct children — all columns explicitly aliased to match
        -- the RETURNS TABLE signature so the recursive case can reference them.
        SELECT
            ir.child_item_id                                                               AS component_item_id,
            i.name                                                                         AS component_name,
            ir.quantity_needed::decimal(10,3)                                              AS total_quantity,
            ir.unit                                                                        AS unit,
            current_level                                                                  AS level_depth,
            (ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0))::decimal(10,2) AS cost_contribution
        FROM item_recipes ir
        JOIN items i ON ir.child_item_id = i.id
        WHERE ir.parent_item_id = item_uuid

        UNION ALL

        -- Recursive case: children of children
        SELECT
            ir.child_item_id                                                               AS component_item_id,
            i.name                                                                         AS component_name,
            (it.total_quantity * ir.quantity_needed)::decimal(10,3)                        AS total_quantity,
            ir.unit                                                                        AS unit,
            (it.level_depth + 1)                                                           AS level_depth,
            (it.total_quantity * ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0))::decimal(10,2) AS cost_contribution
        FROM item_tree it
        JOIN item_recipes ir ON it.component_item_id = ir.parent_item_id
        JOIN items i ON ir.child_item_id = i.id
        WHERE it.level_depth < 10
    )
    SELECT
        it.component_item_id,
        it.component_name,
        it.total_quantity,
        it.unit,
        it.level_depth,
        it.cost_contribution
    FROM item_tree it
    ORDER BY it.level_depth, it.component_name;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION calculate_recipe_cost(item_uuid uuid)
RETURNS decimal(10,2) AS $$
DECLARE
    total_cost decimal(10,2) := 0;
BEGIN
    SELECT COALESCE(SUM(cost_contribution), 0)
    INTO total_cost
    FROM get_item_components(item_uuid);
    
    RETURN total_cost;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_recipe_metadata(item_uuid uuid)
RETURNS void AS $$
DECLARE
    depth integer;
    component_count integer;
    complexity text;
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

-- Create the trigger function
CREATE OR REPLACE FUNCTION trigger_update_recipe_metadata()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
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
$$ LANGUAGE plpgsql;

-- Create the trigger
DROP TRIGGER IF EXISTS trigger_item_recipes_metadata ON item_recipes;
CREATE TRIGGER trigger_item_recipes_metadata
    AFTER INSERT OR UPDATE OR DELETE ON item_recipes
    FOR EACH ROW EXECUTE FUNCTION trigger_update_recipe_metadata();

-- Create the recipe breakdown view
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

-- Success message
SELECT 'Recursive recipes schema applied successfully!' as status; 