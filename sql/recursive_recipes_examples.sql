-- RECURSIVE RECIPES USAGE EXAMPLES
-- Demonstrates how to use the recursive recipe system

-- ======================
-- EXAMPLE 1: PIZZA RECIPE HIERARCHY
-- ======================

-- Level 2 Items (Base ingredients)
-- These would typically be created first

-- Level 1 Items (Components/Sub-recipes)
-- CREATE Pizza Base, Cheese Mix, Supreme Topping Mix

-- Level 0 Items (Final products)
-- CREATE Supreme Pizza

-- Example query to add recipe relationships:
/*
-- Add Pizza Base components
INSERT INTO item_recipes (parent_item_id, child_item_id, quantity_needed, unit, cost_per_unit)
VALUES 
    ((SELECT id FROM items WHERE name = 'Pizza Base'), (SELECT id FROM items WHERE name = 'Flour'), 0.250, 'kg', 12.00),
    ((SELECT id FROM items WHERE name = 'Pizza Base'), (SELECT id FROM items WHERE name = 'Yeast'), 0.010, 'kg', 200.00),
    ((SELECT id FROM items WHERE name = 'Pizza Base'), (SELECT id FROM items WHERE name = 'Water'), 0.150, 'liter', 3.33);

-- Add Cheese Mix components  
INSERT INTO item_recipes (parent_item_id, child_item_id, quantity_needed, unit, cost_per_unit)
VALUES
    ((SELECT id FROM items WHERE name = 'Cheese Mix'), (SELECT id FROM items WHERE name = 'Mozzarella'), 0.150, 'kg', 120.00),
    ((SELECT id FROM items WHERE name = 'Cheese Mix'), (SELECT id FROM items WHERE name = 'Cheddar'), 0.050, 'kg', 240.00);

-- Add Supreme Pizza components (uses sub-recipes)
INSERT INTO item_recipes (parent_item_id, child_item_id, quantity_needed, unit, cost_per_unit)
VALUES
    ((SELECT id FROM items WHERE name = 'Supreme Pizza'), (SELECT id FROM items WHERE name = 'Pizza Base'), 1, 'piece', 15.00),
    ((SELECT id FROM items WHERE name = 'Supreme Pizza'), (SELECT id FROM items WHERE name = 'Cheese Mix'), 1, 'portion', 25.00),
    ((SELECT id FROM items WHERE name = 'Supreme Pizza'), (SELECT id FROM items WHERE name = 'Supreme Topping Mix'), 1, 'portion', 30.00);
*/

-- ======================
-- USEFUL QUERIES
-- ======================

-- 1. Get complete recipe breakdown for an item
-- SELECT * FROM get_item_components('pizza-uuid-here');

-- 2. Calculate recipe depth
-- SELECT name, calculate_recipe_depth(id) as depth FROM items WHERE name = 'Supreme Pizza';

-- 3. Get total recipe cost
-- SELECT name, calculate_recipe_cost(id) as total_cost FROM items WHERE name = 'Supreme Pizza';

-- 4. View all recipes with their complexity
-- SELECT * FROM recipe_summary WHERE recipe_type = 'recipe';

-- 5. Find items with cost mismatches
-- SELECT * FROM recipe_summary WHERE cost_status = 'Cost mismatch';

-- 6. Update metadata for all items (run after bulk changes)
-- SELECT update_recipe_metadata(id) FROM items WHERE recipe_type IN ('recipe', 'component');

-- ======================
-- EXAMPLE 2: COCKTAIL RECIPE
-- ======================

-- Example for a more complex beverage recipe:
/*
-- Level 2: Base ingredients (spirits, mixers)
-- Vodka, Cranberry Juice, Lime Juice, Simple Syrup

-- Level 1: Component mixes
-- Cosmopolitan Mix = Vodka + Cranberry + Lime + Simple Syrup

-- Level 0: Final cocktail
-- Premium Cosmopolitan = Cosmopolitan Mix + Garnish + Premium Glass
*/

-- ======================
-- BATCH OPERATIONS
-- ======================

-- Update all recipe metadata (useful after importing recipes)
/*
DO $$
DECLARE
    item_record RECORD;
BEGIN
    FOR item_record IN SELECT id FROM items WHERE recipe_type IN ('recipe', 'component') LOOP
        PERFORM update_recipe_metadata(item_record.id);
    END LOOP;
END $$;
*/

-- Find and fix orphaned recipe levels
/*
UPDATE item_recipes 
SET recipe_level = 1 
WHERE recipe_level IS NULL OR recipe_level = 0;
*/

-- ======================
-- REPORTING QUERIES
-- ======================

-- Most complex recipes (by depth)
/*
SELECT 
    name,
    recipe_complexity,
    max_recipe_level,
    total_components,
    price as selling_price,
    calculate_recipe_cost(id) as cost_price,
    price - calculate_recipe_cost(id) as profit_margin
FROM items 
WHERE recipe_type = 'recipe'
ORDER BY max_recipe_level DESC, total_components DESC
LIMIT 10;
*/

-- Items used in the most recipes (popular ingredients)
/*
SELECT 
    i.name as ingredient_name,
    COUNT(ir.parent_item_id) as used_in_recipes,
    AVG(ir.quantity_needed) as avg_quantity_used,
    i.current_stock,
    CASE 
        WHEN i.current_stock < i.low_stock_threshold THEN 'LOW STOCK'
        ELSE 'OK'
    END as stock_status
FROM items i
JOIN item_recipes ir ON i.id = ir.child_item_id
GROUP BY i.id, i.name, i.current_stock, i.low_stock_threshold
ORDER BY used_in_recipes DESC;
*/

-- Cost variance analysis
/*
SELECT 
    name,
    cost_price as manual_cost,
    calculate_recipe_cost(id) as calculated_cost,
    ABS(cost_price - calculate_recipe_cost(id)) as variance,
    ROUND(((calculate_recipe_cost(id) - cost_price) / cost_price * 100), 2) as variance_percentage
FROM items 
WHERE recipe_type = 'recipe' 
  AND cost_price > 0
  AND ABS(cost_price - calculate_recipe_cost(id)) > 1.00
ORDER BY variance DESC;
*/ 