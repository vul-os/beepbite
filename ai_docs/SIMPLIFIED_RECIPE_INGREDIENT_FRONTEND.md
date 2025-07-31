# Simplified Recipe Ingredient Frontend Implementation

## What Changed

### Database
- **Added**: `is_recipe_ingredient` boolean field (defaults to `false`)
- **Removed**: The redundant `is_menu_item` field

### Frontend Updates

#### 1. Form Controls
- **Added**: Simple checkbox "Recipe ingredient (can be used in recipes)"
- **Removed**: Redundant "Menu item" checkbox
- **Logic**: Items are menu items based on `recipe_type` ('recipe' and 'simple' types can be sold)

#### 2. Item Filtering
New "Item Usage" filter with options:
- **All Items**: Shows everything
- **Menu Items**: Shows items that can be sold (`recipe_type` = 'recipe' or 'simple')
- **Recipe Ingredients**: Shows items marked with `is_recipe_ingredient = true`

#### 3. Visual Badges
Items display badges to show their usage:
- 🍽️ **Menu Item** (blue): Appears for 'recipe' and 'simple' types
- 🧪 **Ingredient** (green): Appears when `is_recipe_ingredient = true`

#### 4. Recipe Builder Filtering
- **Smart Filtering**: Only shows items where `is_recipe_ingredient = true`
- **Clean Interface**: No more cluttered ingredient lists with menu items

## Item Type Logic

| `recipe_type` | Can be sold? | Default `is_recipe_ingredient` | Example |
|---------------|--------------|-------------------------------|---------|
| **simple** | ✅ Yes | ❌ No (but can be set to Yes) | Flour, Cheese |
| **component** | ❌ No | ✅ Yes | Pizza Base, Sauce Mix |
| **recipe** | ✅ Yes | ❌ No | Final Pizza, Burger |

## How It Works

### Creating Items
1. Choose `recipe_type`:
   - **simple**: Basic ingredients that can be sold individually
   - **component**: Sub-recipes never sold directly
   - **recipe**: Final products always sold

2. Check "Recipe ingredient" if the item can be used in other recipes

### Using Recipe Builder
1. Only items with `is_recipe_ingredient = true` appear in the available items list
2. Clean, focused ingredient selection
3. No confusion between menu items and ingredients

### Customer Menu Display
- Items with `recipe_type = 'recipe'` or `recipe_type = 'simple'` appear on customer menus
- Components (`recipe_type = 'component'`) never appear on customer menus

## Benefits

✅ **Simple Logic**: Just one boolean field to manage  
✅ **Clear Separation**: Menu items vs ingredients are distinct  
✅ **Flexible**: Simple items can be both sold and used as ingredients  
✅ **Clean UI**: Recipe builder only shows relevant ingredients  
✅ **No Redundancy**: Removed the unnecessary `is_menu_item` field  

## Example Usage

### Pizza Restaurant Setup:

```
Flour (simple)
├── recipe_type: 'simple'
├── is_recipe_ingredient: true
└── Appears: On menu + Available as ingredient

Pizza Base (component)  
├── recipe_type: 'component'
├── is_recipe_ingredient: true
└── Appears: Available as ingredient only

Supreme Pizza (recipe)
├── recipe_type: 'recipe'  
├── is_recipe_ingredient: false
└── Appears: On menu only
```

The system now has clear, simple logic: menu items are determined by `recipe_type`, and recipe ingredients are controlled by the single `is_recipe_ingredient` boolean! 🎉 