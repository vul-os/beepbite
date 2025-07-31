# Menu Items vs Recipe Items - Complete Solution

## The Problem You Identified
You correctly pointed out that there's a fundamental difference between:
- **Menu Items**: Things customers can order (pizzas, burgers, etc.)
- **Recipe Items**: Ingredients/components used to make menu items (flour, cheese, pizza bases, etc.)

The original system mixed these together, causing confusion in the UI and making it hard to manage properly.

## The Solution

### 1. Database Changes
I added two new boolean fields to the `items` table:

```sql
-- New fields in items table
is_menu_item boolean DEFAULT true          -- Can customers order this?
is_recipe_ingredient boolean DEFAULT false  -- Can this be used in recipes?
```

### 2. Item Categories
Now items can be categorized as:

| Category | `is_menu_item` | `is_recipe_ingredient` | Example |
|----------|----------------|------------------------|---------|
| **Menu Only** | ✅ true | ❌ false | Final products that aren't used in other recipes |
| **Ingredient Only** | ❌ false | ✅ true | Basic ingredients like flour, spices |
| **Both** | ✅ true | ✅ true | Items that can be ordered AND used in recipes (pizza base sold separately) |
| **Neither** | ❌ false | ❌ false | Inactive or deprecated items |

### 3. Automatic Categorization
The migration script automatically sets these fields based on existing `recipe_type`:

```sql
-- Simple items (flour, cheese) → Usually ingredients, sometimes menu items
-- Components (pizza base) → Usually ingredients only, not sold directly  
-- Recipes (final pizzas) → Menu items, typically not used as ingredients
```

### 4. UI Improvements

#### New Filter
Added an "Item Usage" filter with options:
- **All Items**: Shows everything
- **Menu Items**: Only items customers can order
- **Recipe Ingredients**: Only items that can be used in recipes

#### Visual Indicators
Items now show badges indicating their usage:
- 🍽️ **Menu Item** (blue badge): Customers can order this
- 🧪 **Ingredient** (green badge): Can be used in recipes

#### Recipe Builder Filtering
The Recipe Builder now only shows items marked as `is_recipe_ingredient = true`, preventing menu-only items from cluttering the ingredient list.

#### Form Controls
When creating/editing items, you now have checkboxes for:
- ☑️ "Menu item (customers can order)"
- ☑️ "Recipe ingredient (can be used in recipes)"

### 5. Database Views
Created helpful views for different use cases:

```sql
-- Only items that appear on customer menus
SELECT * FROM menu_items;

-- Only items that can be used as ingredients
SELECT * FROM recipe_ingredients;

-- Items that are both (can be ordered AND used in recipes)
SELECT * FROM menu_and_recipe_items;
```

## How to Apply This Solution

### Step 1: Run the Database Migration
Copy and paste `sql/fix_menu_vs_recipe_items.sql` into your Supabase SQL Editor and run it.

### Step 2: Categorize Your Items
The script will automatically categorize existing items, but you can fine-tune using:

```sql
-- Mark flour as ingredient only
SELECT categorize_item_usage(
    (SELECT id FROM items WHERE name ILIKE '%flour%' LIMIT 1),
    false,  -- not a menu item
    true    -- is recipe ingredient
);

-- Mark pizza as both menu item and ingredient
SELECT categorize_item_usage(
    (SELECT id FROM items WHERE name ILIKE '%pizza%' LIMIT 1),
    true,   -- is menu item  
    true    -- can also be used as ingredient
);
```

### Step 3: Use the New UI
1. Go to your Recipes page
2. Use the new "Item Usage" filter to see different categories
3. Notice the blue "Menu Item" and green "Ingredient" badges
4. When creating items, set the appropriate checkboxes
5. In Recipe Builder, you'll only see actual ingredients

## Benefits

✅ **Clear Separation**: Menu items and recipe ingredients are now distinct
✅ **Flexible**: Items can be both menu items AND ingredients if needed  
✅ **Better UX**: Recipe builder only shows relevant ingredients
✅ **Menu Management**: Easy to see what customers can actually order
✅ **Inventory**: Track ingredients separately from final products
✅ **Reporting**: Generate separate reports for menu vs ingredient costs

## Example Workflow

### Traditional Pizza Restaurant Setup:

1. **Basic Ingredients** (Recipe Ingredient Only):
   - Flour, Yeast, Tomatoes, Mozzarella Cheese, Pepperoni
   - `is_menu_item: false`, `is_recipe_ingredient: true`

2. **Components** (Recipe Ingredient Only):
   - Pizza Base, Tomato Sauce, Cheese Mix
   - `is_menu_item: false`, `is_recipe_ingredient: true`

3. **Final Products** (Menu Item Only):
   - Margherita Pizza, Pepperoni Pizza, Supreme Pizza
   - `is_menu_item: true`, `is_recipe_ingredient: false`

4. **Hybrid Items** (Both):
   - Garlic Bread (sold separately BUT also used in combo meals)
   - `is_menu_item: true`, `is_recipe_ingredient: true`

This creates a clean separation where customers only see menu items, but staff can build recipes using the appropriate ingredients! 🎉 