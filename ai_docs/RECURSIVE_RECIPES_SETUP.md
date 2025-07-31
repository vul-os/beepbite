# Recursive Recipes Setup Guide

## The Issue
You have all the React components for recursive recipes, but the database schema hasn't been applied yet. Your React app is trying to use the `item_recipes` table and functions like `update_recipe_metadata`, but these don't exist in your database.

## Quick Fix (3 Steps)

### Step 1: Apply the Schema
1. Go to your Supabase dashboard
2. Open the SQL Editor
3. Copy and paste the entire contents of `sql/apply_recursive_recipes.sql`
4. Run the script
5. You should see: `Recursive recipes schema applied successfully!`

### Step 2: Test It Works (Optional but Recommended)
1. In the SQL Editor, copy and paste `sql/test_recursive_recipes.sql`
2. Run the script
3. You should see test data and verification that everything works

### Step 3: Use the Recipe Builder
1. Go to your Recipes page (`/recipes`)
2. Create some basic items with `recipe_type = 'simple'` (like "Flour", "Cheese", etc.)
3. Create a component with `recipe_type = 'component'` (like "Pizza Base")
4. Click the "Recipe Builder" button (tree icon) next to the component
5. Add the simple ingredients to build your recipe
6. Save the recipe

## How It Works

### Item Types
- **Simple**: Basic ingredients (flour, cheese, etc.) - no sub-components
- **Component**: Items made from other items, used in recipes (pizza base, sauce mix)
- **Recipe**: Final products made from components and/or simple items (pizzas, burgers)

### Recursive System
The system supports unlimited nesting:
```
Supreme Pizza (recipe)
├── Pizza Base (component)
│   ├── Flour (simple)
│   ├── Yeast (simple)
│   └── Water (simple)
├── Cheese Mix (component)
│   ├── Mozzarella (simple)
│   └── Cheddar (simple)
└── Pepperoni (simple)
```

### Automatic Features
- **Cost Calculation**: Automatically calculates cost from sub-components
- **Complexity Detection**: Simple/Moderate/Complex based on depth and component count
- **Level Tracking**: Tracks how deep the recipe tree goes
- **Circular Dependency Prevention**: Prevents items from including themselves

## Using the Recipe Builder

### Creating a Basic Recipe
1. Create your base ingredients first (mark as `simple`)
2. Create your final product (mark as `recipe` or `component`)
3. Open Recipe Builder for the final product
4. From the "Available Items" list, click on ingredients to add them
5. Set quantities and units for each component
6. Click "Save Recipe"

### Auto-Calculate Cost
- Set `auto_calculate_cost = true` on recipe items
- The system will automatically calculate cost from sub-components
- Cost updates automatically when component costs change

### Recipe Breakdown
- Use the "Recipe Breakdown" tab to see the complete tree structure
- Shows all levels of recursion with costs and quantities
- Great for understanding complex recipes

## Troubleshooting

### "Table item_recipes doesn't exist"
- You haven't run the schema migration yet
- Run `sql/apply_recursive_recipes.sql` in Supabase SQL Editor

### "Function update_recipe_metadata doesn't exist"
- Same issue - run the schema migration script

### Recipe Builder shows empty list
- Make sure you have items with different recipe types
- Simple items can be added to recipes
- Recipes can't include themselves

### Costs not calculating
- Check that `auto_calculate_cost` is enabled
- Ensure sub-components have valid `cost_price`
- Run `update_recipe_metadata(item_id)` manually if needed

## Next Steps
Once you have the basic system working:
1. Create your ingredient catalog (simple items)
2. Build components from ingredients
3. Create final products from components
4. Use the breakdown view to analyze cost structures
5. Enable auto-cost calculation for automatic updates

The system now provides full recursive recipe functionality with automatic cost calculation and complexity tracking! 