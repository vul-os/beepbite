package main

import "fmt"

// Menu CRUD: categories → items → variations → options. Reuses the runner's
// session + location; leaves the created category_id and item_id on the
// runner so the orders/recipes suites can chain off them.

func suiteMenu(r *Runner) {
	if !r.ensureSession() {
		return
	}

	// Create category
	catName := "Test Cat " + randomString(6)
	resp := r.POST("/data/categories",
		map[string]any{"location_id": r.locationID, "name": catName, "sort_order": 1},
		withBearer(r.token))
	r.CheckStatus(resp.status, 201, "create category 201")
	var inserted []map[string]any
	_ = resp.JSON(&inserted)
	if len(inserted) == 0 {
		r.fail("create category returned empty")
		return
	}
	r.categoryID = fmt.Sprint(inserted[0]["id"])

	// List by location
	resp = r.GET("/data/categories?eq=location_id,"+r.locationID, withBearer(r.token))
	r.CheckStatus(resp.status, 200, "list categories 200")
	var rows []map[string]any
	_ = resp.JSON(&rows)
	r.Check(len(rows) >= 1, "listed category includes ours")

	// Update category
	resp = r.PATCH("/data/categories?eq=id,"+r.categoryID,
		map[string]any{"description": "updated"},
		withBearer(r.token))
	r.CheckStatus(resp.status, 200, "update category 200")

	// Create item
	itemName := "Test Item " + randomString(6)
	resp = r.POST("/data/items",
		map[string]any{
			"location_id": r.locationID,
			"category_id": r.categoryID,
			"name":        itemName,
			"price":       12.5,
		},
		withBearer(r.token))
	r.CheckStatus(resp.status, 201, "create item 201")
	_ = resp.JSON(&inserted)
	if len(inserted) == 0 {
		r.fail("create item returned empty")
		return
	}
	r.itemID = fmt.Sprint(inserted[0]["id"])

	// Embedded-join-ish: just grab by id
	resp = r.GET("/data/items?eq=id,"+r.itemID+"&single=true", withBearer(r.token))
	r.CheckStatus(resp.status, 200, "fetch item single 200")

	// Create variation + option
	resp = r.POST("/data/item_variations",
		map[string]any{"item_id": r.itemID, "name": "Size", "is_required": true},
		withBearer(r.token))
	r.CheckStatus(resp.status, 201, "create variation 201")
	_ = resp.JSON(&inserted)
	varID := ""
	if len(inserted) > 0 {
		varID = fmt.Sprint(inserted[0]["id"])
	}

	if varID != "" {
		resp = r.POST("/data/item_variation_options",
			map[string]any{"variation_id": varID, "name": "Large", "price_modifier": 3.0, "is_default": true},
			withBearer(r.token))
		r.CheckStatus(resp.status, 201, "create variation option 201")
	}

	// Deactivate (don't delete — orders suite may still use it)
	resp = r.PATCH("/data/items?eq=id,"+r.itemID,
		map[string]any{"is_active": true}, // keep active on purpose
		withBearer(r.token))
	r.CheckStatus(resp.status, 200, "set item active 200")
}
