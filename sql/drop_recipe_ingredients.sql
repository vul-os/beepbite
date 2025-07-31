-- Remove the simple recipe_ingredients table in favor of the recursive item_recipes system
-- Run this to clean up existing databases that have the old table

DROP TABLE IF EXISTS recipe_ingredients CASCADE;

-- Note: This will remove the simple recipe system. 
-- Use the recursive item_recipes table instead for all recipe functionality. 