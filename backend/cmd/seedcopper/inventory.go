package main

import (
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
)

// seedInventory builds the supply-chain and back-of-house operations data for
// The Copper Table: suppliers, raw-ingredient inventory (with a handful of
// items dipped below their reorder point), a purchase-order lifecycle with
// goods receipts, stock movement history, delivery zones and tip pools.
func seedInventory(s *seeder, c *Ctx) error {
	// Idempotency: if suppliers already exist for this org, this section has
	// already run — skip entirely.
	var existing int
	if err := s.pool.QueryRow(s.ctx, `SELECT count(*) FROM suppliers WHERE organization_id=$1`, c.OrgID).Scan(&existing); err != nil {
		return fmt.Errorf("seedInventory: count suppliers: %w", err)
	}
	if existing > 0 {
		log.Printf("  inventory: already seeded — skipping")
		return nil
	}

	// Pick a profile to attribute purchasing/recording actions to, alternating
	// between the two owners for a bit of realism.
	buyer1, buyer2 := c.OwnerProfileID, c.YourProfileID
	if buyer2 == "" {
		buyer2 = buyer1
	}

	// Pick a staff.id (POS staff, not a profile) for goods_receipts.received_by —
	// prefer a manager/kitchen role, fall back to whatever staff exists, else NULL.
	var receivedByStaff any
	for _, want := range []string{"manager", "kitchen", "admin"} {
		for _, st := range c.Staff {
			if st.Role == want {
				receivedByStaff = st.ID
				break
			}
		}
		if receivedByStaff != nil {
			break
		}
	}
	if receivedByStaff == nil && len(c.Staff) > 0 {
		receivedByStaff = c.Staff[0].ID
	}

	// -------------------------------------------------------------------
	// 1. Suppliers + primary contacts.
	// -------------------------------------------------------------------
	// Suppliers are fictional businesses in the seeded Example City. Company
	// suffixes are left generic — "(Pty) Ltd" is a South African/Australian
	// form, "Inc" a US one, and picking either would re-anchor the demo to a
	// jurisdiction. Websites and emails use the RFC 2606 reserved domain, so
	// nothing here resolves to a real company.
	type supplierSpec struct {
		name, display, taxID     string
		termsDays                int
		contactName, contactRole string
		contactLocal             string // local-part of the seeded address
		phoneSeq                 int
	}
	suppliers := []supplierSpec{
		{
			name: "Harbour Fresh Produce", display: "Harbour Fresh Produce",
			taxID: "4230192837", termsDays: 14,
			contactName: "Sipho Nkosi", contactRole: "Sales Rep",
			contactLocal: "sipho.harbourfresh", phoneSeq: supplierPhoneSeq + 0,
		},
		{
			name: "Uplands Meat Co", display: "Uplands Meat Company",
			taxID: "4239817264", termsDays: 30,
			contactName: "Deon Fischer", contactRole: "Account Manager",
			contactLocal: "deon.uplandsmeat", phoneSeq: supplierPhoneSeq + 1,
		},
		{
			name: "Blue Bay Seafood", display: "Blue Bay Seafood Suppliers",
			taxID: "4231772940", termsDays: 7,
			contactName: "Faith Adams", contactRole: "Sales Coordinator",
			contactLocal: "faith.bluebayseafood", phoneSeq: supplierPhoneSeq + 2,
		},
		{
			name: "Old Town Beverages", display: "Old Town Beverage Distributors",
			taxID: "4238190456", termsDays: 30,
			contactName: "Ryan Solomons", contactRole: "Key Account Manager",
			contactLocal: "ryan.oldtownbeverages", phoneSeq: supplierPhoneSeq + 3,
		},
		{
			name: "Riverside Dry Goods", display: "Riverside Dry Goods",
			taxID: "4237654123", termsDays: 45,
			contactName: "Naledi Khumalo", contactRole: "Sales Rep",
			contactLocal: "naledi.riversidedrygoods", phoneSeq: supplierPhoneSeq + 4,
		},
	}
	supplierID := map[string]string{}

	// -------------------------------------------------------------------
	// 2. Inventory items — ~22 raw ingredients, ~5 deliberately below
	//    minimum_stock to drive low-stock alerts.
	// -------------------------------------------------------------------
	// costPerUnit is authored in the 2-decimal reference scale (28500 = "two
	// hundred and eighty-five") and rescaled per currency, like every other
	// seeded amount. Stock quantities stay float64: they are kilograms and
	// litres, not money, and fractional stock is real.
	type itemSpec struct {
		name, unit             string
		currentStock, minStock float64
		costPerUnit            int64
	}
	items := []itemSpec{
		{"Beef Fillet", "kg", 8, 10, 28500}, // low
		{"White Fish (Fresh)", "kg", 15, 8, 9550},
		{"Chicken Breast", "kg", 22, 12, 7800},
		{"Potatoes", "kg", 60, 30, 1250},
		{"Onions", "kg", 45, 20, 975},
		{"Tomatoes", "kg", 5, 15, 2200}, // low
		{"Lettuce", "each", 18, 10, 1400},
		{"Olive Oil", "L", 12, 6, 8900},
		{"Butter", "kg", 9, 8, 10500},
		{"Flour", "kg", 40, 20, 1850},
		{"Sugar", "kg", 25, 15, 2100},
		{"Coffee Beans", "kg", 3, 6, 21000}, // low
		{"Milk", "L", 30, 20, 1950},
		{"Cream", "L", 6, 10, 5500},                            // low
		{"Red Wine (Cabernet Sauvignon)", "case", 4, 6, 72000}, // low
		{"Craft Beer", "case", 10, 5, 38000},
		{"Tonic Water", "case", 14, 8, 16500},
		{"Gin (London Dry)", "each", 9, 4, 24500},
		{"Lemons", "kg", 11, 5, 2800},
		{"Garlic", "kg", 7, 4, 6500},
		{"Parmesan", "kg", 4, 3, 31000},
		{"Sourdough", "each", 20, 10, 3200},
	}
	itemID := map[string]string{}

	if err := s.tx(func(tx pgx.Tx) error {
		for _, sup := range suppliers {
			var id string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO suppliers (organization_id, name, display_name, tax_id, payment_terms_days, default_currency, website, is_active)
				VALUES ($1,$2,$3,$4,$5,$7,$6,true)
				RETURNING id
			`, c.OrgID, sup.name, sup.display, sup.taxID, sup.termsDays,
				"https://"+seedlocale.EmailDomain, s.cfg.Currency).Scan(&id); err != nil {
				return fmt.Errorf("insert supplier %q: %w", sup.name, err)
			}
			supplierID[sup.name] = id

			if _, err := tx.Exec(s.ctx, `
				INSERT INTO supplier_contacts (supplier_id, name, role, email, phone, is_primary)
				VALUES ($1,$2,$3,$4,$5,true)
			`, id, sup.contactName, sup.contactRole, s.cfg.Email(sup.contactLocal), s.cfg.Phone(sup.phoneSeq)); err != nil {
				return fmt.Errorf("insert supplier contact %q: %w", sup.contactName, err)
			}
		}

		for _, it := range items {
			var id string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO inventory_items (location_id, name, unit, current_stock, minimum_stock, cost_per_unit)
				VALUES ($1,$2,$3,$4,$5,$6)
				RETURNING id
				// cost_per_unit is numeric MAJOR units.
			`, c.LocID, it.name, it.unit, it.currentStock, it.minStock,
				money.Decimal(s.cfg.Price(it.costPerUnit), s.cfg.Decimals)).Scan(&id); err != nil {
				return fmt.Errorf("insert inventory item %q: %w", it.name, err)
			}
			itemID[it.name] = id
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedInventory: suppliers/items: %w", err)
	}

	// -------------------------------------------------------------------
	// 3. Purchase orders + line items + goods receipts.
	// -------------------------------------------------------------------
	type poLine struct {
		item           string
		qty            float64
		unit           string
		unitPriceCents int64
		receivedQty    float64
	}
	type poSpec struct {
		poNumber       string
		supplier       string
		status         string
		orderedDaysAgo int // 0 = not yet ordered (draft)
		expectDaysAgo  int // relative to c.Now, negative = future
		shippingCents  int64
		lines          []poLine
		receiptNumber  string
		receiptDaysAgo int
		deliveryNote   string
		buyer          string // "1" or "2" to alternate owners
	}
	pos := []poSpec{
		{
			poNumber: "PO-1001", supplier: "Cape Fresh Produce", status: "received",
			orderedDaysAgo: 10, expectDaysAgo: 8, shippingCents: 5000,
			lines: []poLine{
				{"Potatoes", 50, "kg", 1250, 50},
				{"Onions", 40, "kg", 975, 40},
				{"Tomatoes", 25, "kg", 2200, 25},
				{"Lemons", 15, "kg", 2800, 15},
			},
			receiptNumber: "GR-1001-1", receiptDaysAgo: 8, deliveryNote: "DN-88213", buyer: "1",
		},
		{
			poNumber: "PO-1002", supplier: "Karoo Meat Co", status: "received",
			orderedDaysAgo: 9, expectDaysAgo: 7, shippingCents: 0,
			lines: []poLine{
				{"Beef Fillet", 20, "kg", 28500, 20},
				{"Chicken Breast", 30, "kg", 7800, 30},
			},
			receiptNumber: "GR-1002-1", receiptDaysAgo: 7, deliveryNote: "DN-44120", buyer: "2",
		},
		{
			poNumber: "PO-1003", supplier: "Two Oceans Seafood", status: "partially_received",
			orderedDaysAgo: 5, expectDaysAgo: 3, shippingCents: 2500,
			lines: []poLine{
				{"Hake (Fresh)", 40, "kg", 9550, 25},
				{"Lemons", 10, "kg", 2800, 10},
			},
			receiptNumber: "GR-1003-1", receiptDaysAgo: 3, deliveryNote: "DN-99304", buyer: "1",
		},
		{
			poNumber: "PO-1004", supplier: "Woodstock Beverages", status: "sent",
			orderedDaysAgo: 2, expectDaysAgo: -3, shippingCents: 7500,
			lines: []poLine{
				{"Red Wine (Cabernet Sauvignon)", 6, "case", 72000, 0},
				{"Craft Beer", 10, "case", 38000, 0},
				{"Tonic Water", 8, "case", 16500, 0},
				{"Gin (Cape Town Dry)", 12, "each", 24500, 0},
			},
			buyer: "2",
		},
		{
			poNumber: "PO-1005", supplier: "Table Bay Dry Goods", status: "draft",
			orderedDaysAgo: 0, expectDaysAgo: -7, shippingCents: 0,
			lines: []poLine{
				{"Flour", 25, "kg", 1850, 0},
				{"Sugar", 20, "kg", 2100, 0},
				{"Coffee Beans", 10, "kg", 21000, 0},
			},
			buyer: "1",
		},
		{
			poNumber: "PO-1006", supplier: "Cape Fresh Produce", status: "cancelled",
			orderedDaysAgo: 15, expectDaysAgo: 13, shippingCents: 0,
			lines: []poLine{
				{"Lettuce", 20, "each", 1400, 0},
				{"Garlic", 8, "kg", 6500, 0},
			},
			buyer: "2",
		},
	}

	if err := s.tx(func(tx pgx.Tx) error {
		for _, po := range pos {
			var subtotal int64
			for _, ln := range po.lines {
				subtotal += int64(ln.qty) * s.cfg.Price(ln.unitPriceCents)
			}
			shippingCents := s.cfg.Price(po.shippingCents)
			// A supplier quotes goods net of tax and adds it as its own line —
			// the trade-invoicing convention, which is exclusive whatever
			// convention the restaurant uses for its own menu prices. So the
			// rate comes from configuration but the convention does not:
			// tax.Add, not cfg.TaxOn.
			taxed := tax.Add(subtotal, s.cfg.Tax.Rate)
			taxCents := taxed.Tax
			totalCents := taxed.Gross + shippingCents

			buyer := buyer1
			if po.buyer == "2" {
				buyer = buyer2
			}

			var orderedAt any
			if po.orderedDaysAgo > 0 || po.status != "draft" {
				orderedAt = c.Now.AddDate(0, 0, -po.orderedDaysAgo)
			} // else leave nil — draft PO not yet placed with the supplier.

			expectedDelivery := c.Now.AddDate(0, 0, -po.expectDaysAgo).Format("2006-01-02")

			var poID string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO purchase_orders (
					location_id, supplier_id, po_number, status, ordered_by, ordered_at,
					expected_delivery_date, currency, subtotal_cents, tax_cents, shipping_cents, total_cents
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$12,$8,$9,$10,$11)
				RETURNING id
			`, c.LocID, supplierID[po.supplier], po.poNumber, po.status, buyer, orderedAt,
				expectedDelivery, subtotal, taxCents, shippingCents, totalCents,
				s.cfg.Currency).Scan(&poID); err != nil {
				return fmt.Errorf("insert PO %q: %w", po.poNumber, err)
			}

			for _, ln := range po.lines {
				unitPrice := s.cfg.Price(ln.unitPriceCents)
				lineTotal := int64(ln.qty) * unitPrice
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO purchase_order_items (
						purchase_order_id, inventory_item_id, ordered_quantity, ordered_unit,
						ordered_unit_price_cents, received_quantity, line_total_cents
					) VALUES ($1,$2,$3,$4,$5,$6,$7)
				`, poID, itemID[ln.item], ln.qty, ln.unit, unitPrice, ln.receivedQty, lineTotal); err != nil {
					return fmt.Errorf("insert PO line %q/%q: %w", po.poNumber, ln.item, err)
				}
			}

			if po.receiptNumber != "" {
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO goods_receipts (purchase_order_id, receipt_number, received_by, received_at, delivery_note_number)
					VALUES ($1,$2,$3,$4,$5)
				`, poID, po.receiptNumber, receivedByStaff, c.Now.AddDate(0, 0, -po.receiptDaysAgo), po.deliveryNote); err != nil {
					return fmt.Errorf("insert goods receipt %q: %w", po.receiptNumber, err)
				}
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedInventory: purchase orders: %w", err)
	}

	// -------------------------------------------------------------------
	// 4. Stock movements.
	// -------------------------------------------------------------------
	type movementSpec struct {
		item         string
		movementType string
		qty          float64
		unitCost     float64
		wasteReason  string // only for movementType == "waste"
		daysAgo      int
		notes        string
	}
	movements := []movementSpec{
		{"Potatoes", "purchase", 50, 12.50, "", 8, "PO-1001 receipt"},
		{"Onions", "purchase", 40, 9.75, "", 8, "PO-1001 receipt"},
		{"Tomatoes", "purchase", 25, 22.00, "", 8, "PO-1001 receipt"},
		{"Beef Fillet", "purchase", 20, 285.00, "", 7, "PO-1002 receipt"},
		{"Chicken Breast", "purchase", 30, 78.00, "", 7, "PO-1002 receipt"},
		{"Hake (Fresh)", "grn", 25, 95.50, "", 3, "PO-1003 partial receipt"},
		{"Beef Fillet", "sale", 12, 285.00, "", 4, "dinner service consumption"},
		{"Chicken Breast", "sale", 18, 78.00, "", 3, "dinner service consumption"},
		{"Hake (Fresh)", "sale", 10, 95.50, "", 2, "lunch service consumption"},
		{"Coffee Beans", "sale", 4, 210.00, "", 1, "espresso bar consumption"},
		{"Tomatoes", "waste", 3, 22.00, "spoilage", 2, "overripe, discarded"},
		{"Cream", "waste", 2, 55.00, "spillage", 5, "knocked over in prep"},
		{"Lettuce", "waste", 2, 14.00, "prep_loss", 3, "trim loss"},
		{"Milk", "waste", 3, 19.50, "expired", 6, "past use-by date"},
		{"Parmesan", "adjustment", 1, 310.00, "", 1, "cycle count correction"},
		{"Garlic", "adjustment", 2, 65.00, "", 1, "cycle count correction"},
	}

	if err := s.tx(func(tx pgx.Tx) error {
		for _, m := range movements {
			var waste any
			if m.wasteReason != "" {
				waste = m.wasteReason
			}
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO stock_movements (inventory_item_id, movement_type, quantity, unit_cost, waste_reason, notes, recorded_by, created_at)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			`, itemID[m.item], m.movementType, m.qty, m.unitCost, waste, m.notes, buyer1, c.Now.AddDate(0, 0, -m.daysAgo)); err != nil {
				return fmt.Errorf("insert stock movement %q/%q: %w", m.item, m.movementType, err)
			}
		}
		return nil
	}); err != nil {
		return fmt.Errorf("seedInventory: stock movements: %w", err)
	}

	// -------------------------------------------------------------------
	// 5. Delivery zones, tip pools, bank account.
	// -------------------------------------------------------------------
	type zoneSpec struct {
		name                    string
		polygon                 string
		feeCents, minOrderCents int64
		etaMinutes, priority    int
	}
	zones := []zoneSpec{
		{
			name:     "Sea Point & Green Point",
			polygon:  `{"type":"Polygon","coordinates":[[[18.38,-33.91],[18.40,-33.91],[18.40,-33.93],[18.38,-33.93],[18.38,-33.91]]]}`,
			feeCents: 3500, minOrderCents: 15000, etaMinutes: 35, priority: 1,
		},
		{
			name:     "Camps Bay & Bantry Bay",
			polygon:  `{"type":"Polygon","coordinates":[[[18.36,-33.93],[18.39,-33.93],[18.39,-33.96],[18.36,-33.96],[18.36,-33.93]]]}`,
			feeCents: 5500, minOrderCents: 20000, etaMinutes: 45, priority: 2,
		},
		{
			name:     "City Bowl",
			polygon:  `{"type":"Polygon","coordinates":[[[18.40,-33.91],[18.43,-33.91],[18.43,-33.94],[18.40,-33.94],[18.40,-33.91]]]}`,
			feeCents: 4500, minOrderCents: 18000, etaMinutes: 40, priority: 3,
		},
	}

	type poolSpec struct {
		name     string
		ruleType string
		daysAgo  int
	}
	pools := []poolSpec{
		{"Front of House Pool", "equal_split", 1},
		{"Kitchen Pool", "hours_weighted", 1},
	}

	if err := s.tx(func(tx pgx.Tx) error {
		for _, z := range zones {
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO delivery_zones (organization_id, location_id, name, polygon, delivery_fee_cents, min_order_cents, estimated_eta_minutes, is_active, priority)
				VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,true,$8)
			`, c.OrgID, c.LocID, z.name, z.polygon, z.feeCents, z.minOrderCents, z.etaMinutes, z.priority); err != nil {
				return fmt.Errorf("insert delivery zone %q: %w", z.name, err)
			}
		}

		for _, p := range pools {
			shiftDate := c.Now.AddDate(0, 0, -p.daysAgo).Format("2006-01-02")
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO tip_pools (organization_id, location_id, name, rule_type, config, shift_date, is_active)
				VALUES ($1,$2,$3,$4,'{}'::jsonb,$5,true)
			`, c.OrgID, c.LocID, p.name, p.ruleType, shiftDate); err != nil {
				return fmt.Errorf("insert tip pool %q: %w", p.name, err)
			}
		}

		return nil
	}); err != nil {
		return fmt.Errorf("seedInventory: delivery/tips: %w", err)
	}

	var lowStock int
	for _, it := range items {
		if it.currentStock < it.minStock {
			lowStock++
		}
	}

	log.Printf("  inventory: %d suppliers, %d items (%d below minimum), %d POs, %d stock movements, %d delivery zones, %d tip pools",
		len(suppliers), len(items), lowStock, len(pos), len(movements), len(zones), len(pools))
	return nil
}
