-- SIMPLIFIED MENU VS RECIPE ITEMS FIX
-- Remove redundant is_menu_item field and use recipe_type logic instead

-- Only add the recipe ingredient field (this is the important distinction)
ALTER TABLE items ADD COLUMN IF NOT EXISTS is_recipe_ingredient boolean DEFAULT false;
