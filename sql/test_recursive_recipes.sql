-- TEST RECURSIVE RECIPES FUNCTIONALITY
-- This script creates sample data to test the recursive recipe system
-- Run this AFTER applying the recursive recipes schema

-- First, let's create some basic ingredients (simple items)
-- Note: You'll need to replace the location_id and category_id with your actual values

-- Get your location and category IDs (adjust as needed)
-- You can find these by running: SELECT id, name FROM locations; and SELECT id, name FROM categories;

DO $$
DECLARE
    test_location_id uuid;
    test_category_id uuid;
    flour_id uuid;
    yeast_id uuid;
    cheese_id uuid;
    base_id uuid;
    pizza_id uuid;
BEGIN
    -- Get first available location and category
    SELECT id INTO test_location_id FROM locations LIMIT 1;
    SELECT id INTO test_category_id FROM categories LIMIT 1;
    
    -- Skip if no location/category found
    IF test_location_id IS NULL OR test_category_id IS NULL THEN
        RAISE NOTICE 'No location or category found. Please create a location and category first.';
        RETURN;
    END IF;
    
    -- Create basic ingredients (Level 2 - base ingredients)
    INSERT INTO items (location_id, category_id, name, description, price, cost_price, recipe_type)
    VALUES 
        (test_location_id, test_category_id, 'Test Flour', 'Basic flour for testing', 2.50, 2.00, 'simple'),
        (test_location_id, test_category_id, 'Test Yeast', 'Yeast for testing', 15.00, 12.00, 'simple'),
        (test_location_id, test_category_id, 'Test Cheese', 'Cheese for testing', 45.00, 40.00, 'simple')
    ON CONFLICT (location_id, name) DO NOTHING
    RETURNING id;
    
    -- Get the IDs of our test ingredients
    SELECT id INTO flour_id FROM items WHERE name = 'Test Flour' AND location_id = test_location_id;
    SELECT id INTO yeast_id FROM items WHERE name = 'Test Yeast' AND location_id = test_location_id;
    SELECT id INTO cheese_id FROM items WHERE name = 'Test Cheese' AND location_id = test_location_id;
    
    -- Create a component (Level 1 - made from ingredients)
    INSERT INTO items (location_id, category_id, name, description, price, cost_price, recipe_type, auto_calculate_cost)
    VALUES (test_location_id, test_category_id, 'Test Pizza Base', 'Pizza base for testing', 15.00, 0, 'component', true)
    ON CONFLICT (location_id, name) DO NOTHING;
    
    SELECT id INTO base_id FROM items WHERE name = 'Test Pizza Base' AND location_id = test_location_id;
    
    -- Create a final product (Level 0 - made from components)
    INSERT INTO items (location_id, category_id, name, description, price, cost_price, recipe_type, auto_calculate_cost)
    VALUES (test_location_id, test_category_id, 'Test Supreme Pizza', 'Supreme pizza for testing', 85.00, 0, 'recipe', true)
    ON CONFLICT (location_id, name) DO NOTHING;
    
    SELECT id INTO pizza_id FROM items WHERE name = 'Test Supreme Pizza' AND location_id = test_location_id;
    
    -- Create recipe relationships
    -- Pizza Base recipe (uses basic ingredients)
    INSERT INTO item_recipes (parent_item_id, child_item_id, quantity_needed, unit, cost_per_unit)
    VALUES 
        (base_id, flour_id, 0.250, 'kg', 2.00),
        (base_id, yeast_id, 0.010, 'kg', 12.00)
    ON CONFLICT (parent_item_id, child_item_id) DO NOTHING;
    
    -- Supreme Pizza recipe (uses components and ingredients)
    INSERT INTO item_recipes (parent_item_id, child_item_id, quantity_needed, unit, cost_per_unit)
    VALUES 
        (pizza_id, base_id, 1, 'piece', 15.00),
        (pizza_id, cheese_id, 0.150, 'kg', 40.00)
    ON CONFLICT (parent_item_id, child_item_id) DO NOTHING;
    
    -- Update recipe metadata for all items
    PERFORM update_recipe_metadata(base_id);
    PERFORM update_recipe_metadata(pizza_id);
    
    RAISE NOTICE 'Test data created successfully!';
    RAISE NOTICE 'Pizza Base ID: %', base_id;
    RAISE NOTICE 'Supreme Pizza ID: %', pizza_id;
END $$;

-- Test queries to verify everything is working

-- 1. Check recipe metadata
SELECT 
    name,
    recipe_type,
    recipe_complexity,
    max_recipe_level,
    total_components,
    cost_price,
    auto_calculate_cost
FROM items 
WHERE name LIKE 'Test %'
ORDER BY recipe_type, name;

-- 2. Test recursive component breakdown
SELECT 
    parent_item_name,
    component_name,
    total_quantity,
    unit,
    level_depth,
    cost_contribution
FROM recipe_breakdown
WHERE parent_item_name LIKE 'Test %'
ORDER BY parent_item_name, level_depth, component_name;

-- 3. Test cost calculation
SELECT 
    name,
    cost_price as listed_cost,
    calculate_recipe_cost(id) as calculated_cost,
    ABS(cost_price - calculate_recipe_cost(id)) as variance
FROM items 
WHERE name LIKE 'Test %' AND recipe_type != 'simple'
ORDER BY name;

-- 4. Test the functions directly
SELECT 
    'Test Supreme Pizza' as item,
    calculate_recipe_depth((SELECT id FROM items WHERE name = 'Test Supreme Pizza' LIMIT 1)) as recipe_depth;

-- Success message
SELECT 'Recursive recipes test completed! Check the results above.' as test_status; 