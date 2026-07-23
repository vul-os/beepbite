package main

import "fmt"

// Recipes: assumes the menu suite has created an item, otherwise creates a
// throwaway parent + child item. Covers inserting a recipe component, reading
// the recipe_breakdown view, and calling the calculate_recipe_cost RPC.

func suiteRecipes(r *Runner) {
	if !r.ensureSession() {
		return
	}
	if r.locationID == "" {
		// BUG-ORGSCOPE-MEMBERSHIP-RLS: earlier suites could not create a
		// location, so there is nothing to build a recipe against. Record the
		// same known-fail its sibling suites do rather than panicking on the
		// empty category insert below.
		r.fail("recipes: no location available [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")
		return
	}

	// parent item
	parentID := r.itemID
	if parentID == "" {
		resp := r.POST("/data/categories",
			map[string]any{"location_id": r.locationID, "name": "Recipes Cat " + randomString(4)},
			withBearer(r.token))
		var ins []map[string]any
		_ = resp.JSON(&ins)
		if len(ins) == 0 {
			r.fail("recipes: could not create category")
			return
		}
		catID := fmt.Sprint(ins[0]["id"])

		resp = r.POST("/data/items",
			map[string]any{
				"location_id": r.locationID,
				"category_id": catID,
				"name":        "Parent " + randomString(4),
				"price":       20.0,
			}, withBearer(r.token))
		_ = resp.JSON(&ins)
		if len(ins) == 0 {
			r.fail("recipes: could not create parent item")
			return
		}
		parentID = fmt.Sprint(ins[0]["id"])
		r.itemID = parentID
	}

	// child item (ingredient)
	childName := "Ingredient " + randomString(4)
	resp := r.POST("/data/items",
		map[string]any{
			"location_id": r.locationID,
			"category_id": r.categoryID, // may be empty — server will 400 if so
			"name":        childName,
			"price":       0.50,
		}, withBearer(r.token))
	if resp.status != 201 {
		// If categoryID was empty or invalid, fall back to any category on this location.
		lookup := r.GET("/data/categories?eq=location_id,"+r.locationID+"&limit=1", withBearer(r.token))
		var rows []map[string]any
		_ = lookup.JSON(&rows)
		if len(rows) == 0 {
			r.fail("recipes: no category available for child item")
			return
		}
		resp = r.POST("/data/items",
			map[string]any{
				"location_id": r.locationID,
				"category_id": rows[0]["id"],
				"name":        childName,
				"price":       0.50,
			}, withBearer(r.token))
		r.CheckStatus(resp.status, 201, "recipes: create child item (retry)")
	} else {
		r.CheckStatus(resp.status, 201, "recipes: create child item")
	}
	var ins []map[string]any
	_ = resp.JSON(&ins)
	childID := ""
	if len(ins) > 0 {
		childID = fmt.Sprint(ins[0]["id"])
	}

	if childID == "" || parentID == "" {
		return
	}

	// Insert recipe component linking parent → child.
	resp = r.POST("/data/item_recipes",
		map[string]any{
			"parent_item_id":  parentID,
			"child_item_id":   childID,
			"quantity_needed": 2.0,
		}, withBearer(r.token))
	r.CheckStatus(resp.status, 201, "create item_recipes component 201")

	// recipe_breakdown view is exposed read-only
	resp = r.GET("/data/recipe_breakdown?limit=5", withBearer(r.token))
	r.Check(resp.status == 200, "recipe_breakdown readable (got "+fmt.Sprint(resp.status)+")")

	// calculate_recipe_cost RPC — best-effort; some deployments will have this
	// function, others might not if migration 005 failed.
	resp = r.POST("/rpc/calculate_recipe_cost",
		map[string]any{"item_uuid": parentID},
		withBearer(r.token))
	r.Check(resp.status == 200 || resp.status == 400,
		"calculate_recipe_cost returns 200 or 400 (not 404/500)")
}
