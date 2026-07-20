package main

import (
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/beepbite/backend/internal/money"
)

// seedMenu builds the full menu + KDS setup for The Copper Table: categories,
// items, modifiers, allergens/dietary tags, courses, lunch/dinner menu
// schedules, and kitchen stations + routing.
func seedMenu(s *seeder, c *Ctx) error {
	// -------------------------------------------------------------------
	// Idempotency: if categories already exist for this location, load
	// existing categories/items/stations into Ctx and return.
	// -------------------------------------------------------------------
	var existing int
	if err := s.tx(func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `SELECT count(*) FROM categories WHERE location_id=$1`, c.LocID).Scan(&existing)
	}); err != nil {
		return fmt.Errorf("seedMenu: count categories: %w", err)
	}
	if existing > 0 {
		if err := s.tx(func(tx pgx.Tx) error {
			rows, err := tx.Query(s.ctx, `SELECT id, name FROM categories WHERE location_id=$1`, c.LocID)
			if err != nil {
				return fmt.Errorf("load categories: %w", err)
			}
			for rows.Next() {
				var id, name string
				if err := rows.Scan(&id, &name); err != nil {
					rows.Close()
					return err
				}
				c.Categories[name] = id
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}

			// price is read as text and parsed with money.Parse rather than
			// scanned into a float64 and multiplied by 100: the old form both
			// routed money through a float and assumed a 2-decimal currency, so
			// re-running the seeder against a JPY or KWD location would have
			// loaded prices off by a factor of 100 or 1000.
			rows, err = tx.Query(s.ctx, `SELECT id, name, price::text FROM items WHERE location_id=$1`, c.LocID)
			if err != nil {
				return fmt.Errorf("load items: %w", err)
			}
			for rows.Next() {
				var id, name, price string
				if err := rows.Scan(&id, &name, &price); err != nil {
					rows.Close()
					return err
				}
				minor, err := money.Parse(price, s.cfg.Decimals)
				if err != nil {
					rows.Close()
					return fmt.Errorf("parse price %q for item %s: %w", price, name, err)
				}
				c.Items[name] = id
				c.ItemPrice[name] = minor
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}

			rows, err = tx.Query(s.ctx, `SELECT id, name FROM kitchen_stations WHERE location_id=$1`, c.LocID)
			if err != nil {
				return fmt.Errorf("load kitchen_stations: %w", err)
			}
			for rows.Next() {
				var id, name string
				if err := rows.Scan(&id, &name); err != nil {
					rows.Close()
					return err
				}
				c.Stations[name] = id
			}
			rows.Close()
			return rows.Err()
		}); err != nil {
			return fmt.Errorf("seedMenu: load existing: %w", err)
		}
		log.Printf("  menu: already seeded (%d categories, %d items, %d stations) — skipping",
			len(c.Categories), len(c.Items), len(c.Stations))
		return nil
	}

	// -------------------------------------------------------------------
	// Local types describing the menu content.
	// -------------------------------------------------------------------
	type itemSpec struct {
		name string
		desc string
		// price is authored in the 2-decimal reference scale that
		// seedlocale.Price rescales to the configured currency's exponent —
		// 14500 reads as "one hundred and forty-five", which becomes ¥145 under
		// JPY and KD 14.500 under KWD. It is never a float and is never divided
		// by a literal 100.
		price     int64
		prepMin   int
		calories  int
		trackInv  bool
		stock     int
		allergens []string // allergen codes
		dietary   []string // dietary tag codes
		modGroup  string   // "", "cook_temp", "addons", "milk"
		schedules []string // "lunch", "dinner" — empty = always on menu
	}

	categoryOrder := []string{
		"Starters", "Salads", "Mains", "From the Grill", "Sides",
		"Desserts", "Cocktails", "Wine", "Soft Drinks", "Hot Drinks",
	}
	categoryDesc := map[string]string{
		"Starters":       "Small plates to start the evening.",
		"Salads":         "Fresh, seasonal salads — light or hearty.",
		"Mains":          "Bistro classics, plated for the table.",
		"From the Grill": "Steaks, chops & grill-fired favourites.",
		"Sides":          "Shareable sides for the table.",
		"Desserts":       "Sweet finishes, made in-house.",
		"Cocktails":      "Craft cocktails from the copper bar.",
		"Wine":           "By the glass — estate selections.",
		"Soft Drinks":    "Cold drinks, juices & mixers.",
		"Hot Drinks":     "Coffee, tea & after-dinner warmers.",
	}

	menuByCategory := map[string][]itemSpec{
		"Starters": {
			{name: "Chargrilled Octopus", desc: "Smoked paprika, crispy potato, salsa verde.", price: 14500, prepMin: 18, calories: 320, allergens: []string{"shellfish"}, schedules: []string{"dinner"}},
			{name: "Beef Carpaccio", desc: "Shaved parmesan, wild rocket, truffle oil, lemon.", price: 13500, prepMin: 15, calories: 280, allergens: []string{"dairy"}, schedules: []string{"dinner"}},
			{name: "Crispy Pork Belly Bites", desc: "Apple slaw, wholegrain mustard jus.", price: 11000, prepMin: 15, calories: 380},
			{name: "Harbour Mussels", desc: "White wine, garlic, cream, toasted ciabatta.", price: 12000, prepMin: 15, calories: 420, allergens: []string{"shellfish", "dairy", "gluten"}},
			{name: "Duck Liver Parfait", desc: "Fig preserve, toasted brioche, pickled shallot.", price: 12500, prepMin: 12, calories: 410, allergens: []string{"dairy", "gluten", "eggs"}},
			{name: "Halloumi & Beetroot Stack", desc: "Candied walnuts, rocket, honey drizzle.", price: 9500, prepMin: 12, calories: 360, allergens: []string{"dairy", "tree_nuts"}, dietary: []string{"vegetarian"}, schedules: []string{"lunch"}},
		},
		"Salads": {
			{name: "Roasted Butternut & Feta Salad", desc: "Toasted seeds, wild rocket, aged balsamic.", price: 9500, prepMin: 10, calories: 340, allergens: []string{"dairy", "sesame"}, dietary: []string{"vegetarian", "gluten_free"}, schedules: []string{"lunch"}},
			{name: "Grilled Chicken Caesar", desc: "Cos lettuce, parmesan, anchovy dressing, croutons.", price: 11000, prepMin: 12, calories: 480, allergens: []string{"dairy", "fish", "gluten", "eggs"}, modGroup: "addons", schedules: []string{"lunch"}},
			{name: "Herbed Lamb Salad", desc: "Rosemary lamb loin, feta, mint, pomegranate.", price: 15000, prepMin: 15, calories: 520, allergens: []string{"dairy"}, dietary: []string{"gluten_free"}},
			{name: "Heirloom Tomato & Burrata", desc: "Basil oil, aged balsamic, sourdough crisp.", price: 12500, prepMin: 10, calories: 390, allergens: []string{"dairy", "gluten"}, dietary: []string{"vegetarian"}},
			{name: "Quinoa & Roast Vegetable Bowl", desc: "Tahini dressing, toasted pumpkin seeds.", price: 10500, prepMin: 10, calories: 410, allergens: []string{"sesame"}, dietary: []string{"vegan", "vegetarian", "gluten_free"}, schedules: []string{"lunch"}},
		},
		"Mains": {
			{name: "Pan-Seared Line Fish", desc: "Saffron beurre blanc, crushed baby potatoes, wilted greens.", price: 21500, prepMin: 22, calories: 610, allergens: []string{"fish", "dairy"}, dietary: []string{"gluten_free"}, schedules: []string{"dinner"}},
			{name: "Venison Loin", desc: "Juniper jus, sweet potato puree, tenderstem broccoli.", price: 25500, prepMin: 22, calories: 640, allergens: []string{"dairy"}, dietary: []string{"gluten_free"}, schedules: []string{"dinner"}},
			{name: "Chicken Schnitzel", desc: "Lemon butter, capers, hand-cut chips.", price: 14500, prepMin: 20, calories: 780, allergens: []string{"gluten", "dairy", "eggs"}, modGroup: "addons", schedules: []string{"lunch"}},
			{name: "Butter Chicken Curry", desc: "Basmati rice, garlic naan, coriander.", price: 15500, prepMin: 20, calories: 720, allergens: []string{"dairy", "gluten"}, dietary: []string{"spicy"}},
			{name: "Wild Mushroom & Truffle Risotto", desc: "Parmesan, white wine, chive oil.", price: 14500, prepMin: 20, calories: 610, allergens: []string{"dairy"}, dietary: []string{"vegetarian", "gluten_free"}},
			{name: "Slow-Braised Lamb Shank", desc: "Red wine jus, roasted garlic mash.", price: 22500, prepMin: 25, calories: 780, allergens: []string{"dairy"}, dietary: []string{"gluten_free"}, schedules: []string{"dinner"}},
			{name: "Beer-Battered Fish & Chips", desc: "Tartare sauce, mushy peas, lemon.", price: 13500, prepMin: 18, calories: 820, allergens: []string{"fish", "gluten", "eggs"}, modGroup: "addons", schedules: []string{"lunch"}},
		},
		"From the Grill": {
			{name: "300g Rump Steak", desc: "Choice of sauce, hand-cut chips.", price: 19500, prepMin: 22, calories: 720, trackInv: true, stock: 40, dietary: []string{"gluten_free"}, modGroup: "cook_temp", schedules: []string{"dinner"}},
			{name: "250g Fillet Steak", desc: "Peppercorn or mushroom sauce, chips.", price: 28500, prepMin: 22, calories: 650, trackInv: true, stock: 28, dietary: []string{"gluten_free"}, modGroup: "cook_temp", schedules: []string{"dinner"}},
			{name: "Ribeye 400g", desc: "Bone marrow butter, triple-cooked chips.", price: 33500, prepMin: 25, calories: 890, trackInv: true, stock: 22, dietary: []string{"gluten_free"}, modGroup: "cook_temp", schedules: []string{"dinner"}},
			{name: "T-Bone 500g", desc: "Chimichurri, grilled tomato.", price: 35500, prepMin: 28, calories: 920, trackInv: true, stock: 16, dietary: []string{"gluten_free"}, modGroup: "cook_temp", schedules: []string{"dinner"}},
			{name: "Lamb Chops", desc: "Rosemary & garlic, mint jus.", price: 24500, prepMin: 22, calories: 680, trackInv: true, stock: 24, dietary: []string{"gluten_free"}, modGroup: "cook_temp", schedules: []string{"dinner"}},
			{name: "Farmhouse Sausage Grill Plate", desc: "Coiled farmhouse sausage, tomato relish, soft polenta.", price: 14500, prepMin: 18, calories: 760, trackInv: true, stock: 35, modGroup: "addons"},
		},
		"Sides": {
			{name: "Truffle Parmesan Fries", desc: "Rosemary salt, aioli.", price: 5500, prepMin: 10, calories: 420, allergens: []string{"dairy", "eggs"}, dietary: []string{"vegetarian"}},
			{name: "Creamed Spinach", desc: "Nutmeg, cream, parmesan.", price: 4500, prepMin: 8, calories: 260, allergens: []string{"dairy"}, dietary: []string{"vegetarian", "gluten_free"}},
			{name: "Sweet Potato Mash", desc: "Butter, cinnamon.", price: 4500, prepMin: 8, calories: 220, allergens: []string{"dairy"}, dietary: []string{"vegetarian", "gluten_free"}},
			{name: "Grilled Broccolini", desc: "Chilli, garlic, lemon.", price: 5000, prepMin: 8, calories: 140, dietary: []string{"vegan", "vegetarian", "gluten_free", "spicy"}},
			{name: "Onion Rings", desc: "Buttermilk batter, smoked paprika mayo.", price: 4800, prepMin: 10, calories: 380, allergens: []string{"gluten", "dairy", "eggs"}, dietary: []string{"vegetarian"}},
			{name: "Garlic Butter Mushrooms", desc: "Thyme, parmesan.", price: 5200, prepMin: 10, calories: 210, allergens: []string{"dairy"}, dietary: []string{"vegetarian", "gluten_free"}},
		},
		"Desserts": {
			{name: "Warm Caramel Sponge", desc: "Warm sponge, vanilla custard.", price: 7500, prepMin: 12, calories: 480, allergens: []string{"gluten", "dairy", "eggs"}, dietary: []string{"vegetarian"}},
			{name: "Chocolate Fondant", desc: "Salted caramel ice cream.", price: 8500, prepMin: 15, calories: 520, allergens: []string{"gluten", "dairy", "eggs"}, dietary: []string{"vegetarian"}},
			{name: "Crème Brûlée", desc: "Madagascan vanilla, burnt sugar.", price: 7000, prepMin: 10, calories: 460, allergens: []string{"dairy", "eggs"}, dietary: []string{"vegetarian", "gluten_free"}},
			{name: "Baked Cheesecake", desc: "Berry compote, shortbread crumb.", price: 7500, prepMin: 10, calories: 510, allergens: []string{"gluten", "dairy", "eggs"}, dietary: []string{"vegetarian"}},
			{name: "Cinnamon Custard Tart", desc: "Baked custard, cinnamon dusting.", price: 6500, prepMin: 10, calories: 390, allergens: []string{"gluten", "dairy", "eggs"}, dietary: []string{"vegetarian"}},
			{name: "Affogato", desc: "Vanilla gelato, double espresso, amaretti.", price: 5500, prepMin: 6, calories: 220, allergens: []string{"dairy", "gluten", "tree_nuts"}, dietary: []string{"vegetarian"}},
		},
		"Cocktails": {
			{name: "Copper Old Fashioned", desc: "Bourbon, bitters, orange twist.", price: 11000, prepMin: 5, calories: 210},
			{name: "Harbour Sundowner", desc: "Gin, Aperol, grapefruit, soda.", price: 10500, prepMin: 5, calories: 190},
			{name: "Espresso Martini", desc: "Vodka, espresso, coffee liqueur.", price: 11500, prepMin: 5, calories: 220},
			{name: "Gin & Elderflower Spritz", desc: "Dry gin, elderflower, prosecco, soda.", price: 10000, prepMin: 5, calories: 180},
			{name: "Spiced Ginger Mule", desc: "Spiced rum, ginger beer, lime.", price: 10500, prepMin: 5, calories: 200, dietary: []string{"spicy"}},
			{name: "Whisky Sour", desc: "Bourbon, lemon, sugar, egg white.", price: 11000, prepMin: 5, calories: 210, allergens: []string{"eggs"}},
		},
		"Wine": {
			{name: "Sauvignon Blanc, Harbour Valley", desc: "Crisp, tropical, citrus finish.", price: 6500, prepMin: 3, calories: 120},
			{name: "Chenin Blanc, Old Town Ridge", desc: "Stone fruit, honeyed.", price: 6000, prepMin: 3, calories: 120},
			{name: "Chardonnay, Riverside Estate", desc: "Oak-aged, buttery.", price: 7500, prepMin: 3, calories: 130},
			{name: "Merlot, Hillside Estate", desc: "Smoky, dark berry.", price: 7000, prepMin: 3, calories: 130},
			{name: "Cabernet Sauvignon, Hillside Estate", desc: "Full-bodied, blackcurrant.", price: 7500, prepMin: 3, calories: 135},
		},
		"Soft Drinks": {
			{name: "Coca-Cola 300ml", desc: "Chilled, served over ice.", price: 2800, prepMin: 2, calories: 140},
			{name: "Sparkling Water 500ml", desc: "", price: 3200, prepMin: 2, calories: 0},
			{name: "Still Water 500ml", desc: "", price: 2800, prepMin: 2, calories: 0},
			{name: "Fresh Orange Juice", desc: "Freshly squeezed.", price: 3800, prepMin: 3, calories: 160},
			{name: "Ginger Beer", desc: "House-brewed, spicy ginger.", price: 3200, prepMin: 2, calories: 150},
		},
		"Hot Drinks": {
			{name: "Cappuccino", desc: "Double shot, steamed milk.", price: 3200, prepMin: 4, calories: 90, allergens: []string{"dairy"}, modGroup: "milk"},
			{name: "Flat White", desc: "Double shot, micro-foam.", price: 3200, prepMin: 4, calories: 100, allergens: []string{"dairy"}, modGroup: "milk"},
			{name: "Americano", desc: "Double shot, hot water.", price: 2800, prepMin: 3, calories: 5},
			{name: "Red Bush Tea", desc: "Caffeine-free herbal infusion.", price: 2800, prepMin: 3, calories: 0, dietary: []string{"vegan", "gluten_free"}},
			{name: "Hot Chocolate", desc: "Steamed milk, real chocolate.", price: 3800, prepMin: 4, calories: 210, allergens: []string{"dairy"}, modGroup: "milk"},
			{name: "Espresso", desc: "Double shot.", price: 2400, prepMin: 2, calories: 5},
		},
	}

	type insertedItem struct {
		id   string
		spec itemSpec
	}
	var allItems []insertedItem

	// -------------------------------------------------------------------
	// Categories.
	// -------------------------------------------------------------------
	if err := s.tx(func(tx pgx.Tx) error {
		for i, name := range categoryOrder {
			var id string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO categories (location_id, organization_id, name, description, sort_order, is_active)
				VALUES ($1,$2,$3,$4,$5,true) RETURNING id
			`, c.LocID, c.OrgID, name, categoryDesc[name], i).Scan(&id); err != nil {
				return fmt.Errorf("insert category %s: %w", name, err)
			}
			c.Categories[name] = id
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedMenu: categories: %w", err)
	}

	// -------------------------------------------------------------------
	// Items.
	// -------------------------------------------------------------------
	if err := s.tx(func(tx pgx.Tx) error {
		for _, catName := range categoryOrder {
			catID := c.Categories[catName]
			for i, it := range menuByCategory[catName] {
				// Rescale the authored price into the configured currency's
				// minor units once, then derive everything from that integer.
				priceMinor := s.cfg.Price(it.price)
				// Food cost is modelled at 35% of menu price. DivRound keeps it
				// integer and rounds the way the tax engine and cash drawer do.
				costMinor := money.DivRound(priceMinor*35, 100)

				var id string
				if err := tx.QueryRow(s.ctx, `
					INSERT INTO items (
						location_id, category_id, name, description, price, cost_price,
						preparation_time, calories, sort_order, is_active, track_inventory, current_stock
					) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11) RETURNING id
				`, c.LocID, catID, it.name, it.desc,
					// items.price and cost_price are numeric MAJOR units, so the
					// minor-unit integer is rendered at the currency's own scale.
					money.Decimal(priceMinor, s.cfg.Decimals), money.Decimal(costMinor, s.cfg.Decimals),
					it.prepMin, it.calories, i, it.trackInv, it.stock).Scan(&id); err != nil {
					return fmt.Errorf("insert item %s: %w", it.name, err)
				}
				c.Items[it.name] = id
				c.ItemPrice[it.name] = priceMinor
				allItems = append(allItems, insertedItem{id: id, spec: it})
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedMenu: items: %w", err)
	}

	// -------------------------------------------------------------------
	// Modifier groups + modifiers.
	// -------------------------------------------------------------------
	// delta is authored in the same 2-decimal reference scale as item prices and
	// rescaled at insert time; modifiers.price_delta_cents is minor units.
	type modOption struct {
		name      string
		delta     int64
		isDefault bool
	}
	cookTempOptions := []modOption{
		{"Rare", 0, false},
		{"Medium-rare", 0, true},
		{"Medium", 0, false},
		{"Well-done", 0, false},
	}
	addonsOptions := []modOption{
		{"Extra cheese", 1500, false},
		{"Bacon", 2500, false},
		{"Fried egg", 1200, false},
		{"Avo", 2000, false},
	}
	milkOptions := []modOption{
		{"Full cream", 0, true},
		{"Low fat", 0, false},
		{"Oat milk", 1000, false},
		{"Almond milk", 1000, false},
		{"Soy milk", 1000, false},
	}

	if err := s.tx(func(tx pgx.Tx) error {
		for _, it := range allItems {
			var groupName string
			var minSel, maxSel int
			var required bool
			var options []modOption
			switch it.spec.modGroup {
			case "cook_temp":
				groupName, minSel, maxSel, required, options = "Cook Temperature", 1, 1, true, cookTempOptions
			case "addons":
				groupName, minSel, maxSel, required, options = "Add-ons", 0, 4, false, addonsOptions
			case "milk":
				groupName, minSel, maxSel, required, options = "Milk", 1, 1, true, milkOptions
			default:
				continue
			}

			var groupID string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO modifier_groups (item_id, name, min_select, max_select, is_required, sort_order)
				VALUES ($1,$2,$3,$4,$5,0) RETURNING id
			`, it.id, groupName, minSel, maxSel, required).Scan(&groupID); err != nil {
				return fmt.Errorf("insert modifier_group %s for %s: %w", groupName, it.spec.name, err)
			}
			for j, opt := range options {
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO modifiers (modifier_group_id, name, price_delta_cents, is_default, is_active, sort_order)
					VALUES ($1,$2,$3,$4,true,$5)
				`, groupID, opt.name, s.cfg.Price(opt.delta), opt.isDefault, j); err != nil {
					return fmt.Errorf("insert modifier %s: %w", opt.name, err)
				}
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedMenu: modifiers: %w", err)
	}

	// -------------------------------------------------------------------
	// Allergens + dietary tags (org-scoped) + item links.
	// -------------------------------------------------------------------
	allergenDefs := []struct{ code, label, icon string }{
		{"gluten", "Gluten", "🌾"},
		{"dairy", "Dairy", "🥛"},
		{"eggs", "Eggs", "🥚"},
		{"tree_nuts", "Tree Nuts", "🌰"},
		{"peanuts", "Peanuts", "🥜"},
		{"shellfish", "Shellfish", "🦐"},
		{"fish", "Fish", "🐟"},
		{"soy", "Soy", "🫘"},
		{"sesame", "Sesame", "🧂"},
	}
	dietaryDefs := []struct{ code, label, icon string }{
		{"vegetarian", "Vegetarian", "🥦"},
		{"vegan", "Vegan", "🌱"},
		{"halal", "Halal", "☪"},
		{"gluten_free", "Gluten-Free", "🚫"},
		{"spicy", "Spicy", "🌶"},
	}

	allergenIDs := map[string]string{}
	dietaryIDs := map[string]string{}

	if err := s.tx(func(tx pgx.Tx) error {
		for i, a := range allergenDefs {
			var id string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO allergens (organization_id, code, label, icon, sort_order)
				VALUES ($1,$2,$3,$4,$5)
				ON CONFLICT (organization_id, code) DO UPDATE SET label=EXCLUDED.label, icon=EXCLUDED.icon
				RETURNING id
			`, c.OrgID, a.code, a.label, a.icon, i).Scan(&id); err != nil {
				return fmt.Errorf("upsert allergen %s: %w", a.code, err)
			}
			allergenIDs[a.code] = id
		}
		for i, d := range dietaryDefs {
			var id string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO dietary_tags (organization_id, code, label, icon, sort_order, is_customer_facing)
				VALUES ($1,$2,$3,$4,$5,true)
				ON CONFLICT (organization_id, code) DO UPDATE SET label=EXCLUDED.label, icon=EXCLUDED.icon
				RETURNING id
			`, c.OrgID, d.code, d.label, d.icon, i).Scan(&id); err != nil {
				return fmt.Errorf("upsert dietary_tag %s: %w", d.code, err)
			}
			dietaryIDs[d.code] = id
		}

		for _, it := range allItems {
			for _, code := range it.spec.allergens {
				aid, ok := allergenIDs[code]
				if !ok {
					continue
				}
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO item_allergens (item_id, allergen_id) VALUES ($1,$2)
					ON CONFLICT (item_id, allergen_id) DO NOTHING
				`, it.id, aid); err != nil {
					return fmt.Errorf("link allergen %s to %s: %w", code, it.spec.name, err)
				}
			}
			for _, code := range it.spec.dietary {
				did, ok := dietaryIDs[code]
				if !ok {
					continue
				}
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO item_dietary_tags (item_id, dietary_tag_id) VALUES ($1,$2)
					ON CONFLICT (item_id, dietary_tag_id) DO NOTHING
				`, it.id, did); err != nil {
					return fmt.Errorf("link dietary tag %s to %s: %w", code, it.spec.name, err)
				}
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedMenu: allergens/dietary: %w", err)
	}

	// -------------------------------------------------------------------
	// Courses (location-scoped).
	// -------------------------------------------------------------------
	if err := s.tx(func(tx pgx.Tx) error {
		courses := []struct {
			name string
			sort int
		}{
			{"Starters", 0},
			{"Mains", 1},
			{"Dessert", 2},
		}
		for _, co := range courses {
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO courses (location_id, name, sort_order, is_active)
				VALUES ($1,$2,$3,true)
				ON CONFLICT (location_id, name) DO NOTHING
			`, c.LocID, co.name, co.sort); err != nil {
				return fmt.Errorf("insert course %s: %w", co.name, err)
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedMenu: courses: %w", err)
	}

	// -------------------------------------------------------------------
	// Menu schedules (Lunch/Dinner) + slots + item links.
	// -------------------------------------------------------------------
	tod := func(h, m int) pgtype.Time {
		return pgtype.Time{Microseconds: int64(h*3600+m*60) * 1_000_000, Valid: true}
	}
	scheduleIDs := map[string]string{}
	if err := s.tx(func(tx pgx.Tx) error {
		schedules := []struct {
			name, code     string
			startH, startM int
			endH, endM     int
		}{
			{"Lunch", "lunch", 11, 30, 15, 0},
			{"Dinner", "dinner", 17, 30, 22, 30},
		}
		for _, sch := range schedules {
			var id string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO menu_schedules (location_id, name, code, is_active)
				VALUES ($1,$2,$3,true) RETURNING id
			`, c.LocID, sch.name, sch.code).Scan(&id); err != nil {
				return fmt.Errorf("insert menu_schedule %s: %w", sch.name, err)
			}
			scheduleIDs[sch.code] = id
			for dow := 1; dow <= 7; dow++ {
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO menu_schedule_slots (menu_schedule_id, day_of_week, start_time, end_time)
					VALUES ($1,$2,$3,$4)
				`, id, dow, tod(sch.startH, sch.startM), tod(sch.endH, sch.endM)); err != nil {
					return fmt.Errorf("insert menu_schedule_slot %s dow=%d: %w", sch.name, dow, err)
				}
			}
		}

		for _, it := range allItems {
			for _, code := range it.spec.schedules {
				sid, ok := scheduleIDs[code]
				if !ok {
					continue
				}
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO item_menu_schedules (item_id, menu_schedule_id) VALUES ($1,$2)
					ON CONFLICT (item_id, menu_schedule_id) DO NOTHING
				`, it.id, sid); err != nil {
					return fmt.Errorf("link schedule %s to %s: %w", code, it.spec.name, err)
				}
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedMenu: menu schedules: %w", err)
	}

	// -------------------------------------------------------------------
	// Kitchen stations + routing.
	// -------------------------------------------------------------------
	if err := s.tx(func(tx pgx.Tx) error {
		// Load whatever stations already exist for this location (the
		// "Kitchen" stub is auto-created by a trigger on location insert).
		type stub struct{ id, name string }
		var existingStations []stub
		rows, err := tx.Query(s.ctx, `SELECT id, name FROM kitchen_stations WHERE location_id=$1`, c.LocID)
		if err != nil {
			return fmt.Errorf("load kitchen_stations: %w", err)
		}
		for rows.Next() {
			var st stub
			if err := rows.Scan(&st.id, &st.name); err != nil {
				rows.Close()
				return err
			}
			existingStations = append(existingStations, st)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(existingStations) == 1 && existingStations[0].name == "Kitchen" {
			if _, err := tx.Exec(s.ctx, `DELETE FROM kitchen_stations WHERE id=$1`, existingStations[0].id); err != nil {
				return fmt.Errorf("delete stub Kitchen station: %w", err)
			}
		}

		stations := []struct {
			name        string
			stationType string
			sort        int
		}{
			{"Grill", "prep", 0},
			{"Hot Kitchen", "prep", 1},
			{"Larder", "prep", 2},
			{"Bar", "bar", 3},
			{"Pass", "expo", 4},
		}
		for _, st := range stations {
			var id string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO kitchen_stations (location_id, name, station_type, sort_order, is_active)
				VALUES ($1,$2,$3,$4,true)
				ON CONFLICT (location_id, name) DO UPDATE SET station_type=EXCLUDED.station_type, sort_order=EXCLUDED.sort_order
				RETURNING id
			`, c.LocID, st.name, st.stationType, st.sort).Scan(&id); err != nil {
				return fmt.Errorf("insert kitchen_station %s: %w", st.name, err)
			}
			c.Stations[st.name] = id
		}

		// Category -> primary station routing.
		categoryStation := map[string]string{
			"Starters":       "Larder",
			"Salads":         "Larder",
			"Mains":          "Hot Kitchen",
			"From the Grill": "Grill",
			"Sides":          "Hot Kitchen",
			"Desserts":       "Larder",
			"Cocktails":      "Bar",
			"Wine":           "Bar",
			"Soft Drinks":    "Bar",
			"Hot Drinks":     "Bar",
		}
		for catName, stationName := range categoryStation {
			catID, ok := c.Categories[catName]
			if !ok {
				continue
			}
			stationID, ok := c.Stations[stationName]
			if !ok {
				continue
			}
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO category_station_routing (category_id, station_id, is_primary)
				VALUES ($1,$2,true)
				ON CONFLICT (category_id, station_id) DO UPDATE SET is_primary=true
			`, catID, stationID); err != nil {
				return fmt.Errorf("category_station_routing %s -> %s: %w", catName, stationName, err)
			}

			// Route every item in this category to the station via a
			// single INSERT ... SELECT.
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO item_station_routing (item_id, station_id, is_primary)
				SELECT id, $1, true FROM items WHERE category_id = $2
				ON CONFLICT (item_id, station_id) DO NOTHING
			`, stationID, catID); err != nil {
				return fmt.Errorf("item_station_routing for category %s: %w", catName, err)
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedMenu: kitchen stations: %w", err)
	}

	log.Printf("  menu: %d categories, %d items, %d stations, %d allergens, %d dietary tags, %d menu schedules",
		len(c.Categories), len(c.Items), len(c.Stations), len(allergenIDs), len(dietaryIDs), len(scheduleIDs))
	return nil
}
