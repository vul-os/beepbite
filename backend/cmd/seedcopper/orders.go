package main

import (
	"fmt"
	"log"
	"math/rand"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Weighted sampling tables — realistic lunch/dinner peaks + weekend loading.
// ---------------------------------------------------------------------------

// ordersHourWeights defines relative order probability per hour of day
// (index = hour 0-23). Peaks at lunch (12-14) and dinner (18-21).
var ordersHourWeights = [24]int{
	0, 0, 0, 0, 0, 0, // 00-05 closed
	1, 2, 3, // 06-08 early morning trickle
	5, 8, // 09-10 mid-morning
	18, 24, 26, 20, // 11-14 lunch peak
	12, 10, // 15-16 afternoon lull
	14, 22, 28, 26, // 17-20 dinner peak
	18, 9, 3, // 21-23 wind-down
}

// ordersDayWeights defines relative order probability per weekday.
// Go time.Weekday: Sunday=0, Monday=1, ..., Saturday=6. Weekends busiest.
var ordersDayWeights = [7]int{
	16, // Sunday
	9,  // Monday
	9,  // Tuesday
	11, // Wednesday
	13, // Thursday
	20, // Friday
	22, // Saturday
}

var (
	ordersHourCDF [24]int
	ordersDayCDF  [7]int
)

func init() {
	sum := 0
	for i, w := range ordersHourWeights {
		sum += w
		ordersHourCDF[i] = sum
	}
	sum = 0
	for i, w := range ordersDayWeights {
		sum += w
		ordersDayCDF[i] = sum
	}
}

// pickWeightedOrders returns an index in [0, len(cdf)) sampled proportionally
// to the cumulative weight table cdf.
func pickWeightedOrders(rng *rand.Rand, cdf []int) int {
	total := cdf[len(cdf)-1]
	r := rng.Intn(total) + 1
	for i, v := range cdf {
		if r <= v {
			return i
		}
	}
	return len(cdf) - 1
}

// fulfillmentChoice pairs the fulfillment_type enum with the order_type text
// column plus a relative weight — a full-service bistro skews toward dine-in.
type fulfillmentChoice struct {
	fulfillment string
	orderType   string
	weight      int
}

var ordersFulfillmentChoices = []fulfillmentChoice{
	{"dine_in", "dine_in", 45},
	{"collection", "pickup", 35},
	{"delivery", "delivery", 20},
}

var ordersFulfillmentCDF []int

func init() {
	sum := 0
	for _, f := range ordersFulfillmentChoices {
		sum += f.weight
		ordersFulfillmentCDF = append(ordersFulfillmentCDF, sum)
	}
}

func pickFulfillment(rng *rand.Rand) fulfillmentChoice {
	idx := pickWeightedOrders(rng, ordersFulfillmentCDF)
	return ordersFulfillmentChoices[idx]
}

// ---------------------------------------------------------------------------
// seedOrders: ~1500 completed orders over the last 365 days + cash drawer.
// ---------------------------------------------------------------------------

// seedOrders generates a realistic order history for The Copper Table:
// lunch/dinner peaks, weekend weighting, a mild upward trend so older days
// are lighter than recent ones, and matching order_items/order_payments
// rows. It then seeds a "Front Register" cash drawer with a handful of
// closed sessions plus one currently-open session.
//
// Idempotency: skip order generation if the org already has >=100 orders;
// skip cash drawer creation if a drawer already exists for the location.
func seedOrders(s *seeder, c *Ctx) error {
	if err := seedOrderHistory(s, c); err != nil {
		return fmt.Errorf("seedOrders: %w", err)
	}
	if err := seedCashDrawer(s, c); err != nil {
		return fmt.Errorf("seedOrders: cash drawer: %w", err)
	}
	return nil
}

func seedOrderHistory(s *seeder, c *Ctx) error {
	var existing int
	if err := s.pool.QueryRow(s.ctx,
		`SELECT count(*) FROM orders WHERE organization_id=$1`, c.OrgID).Scan(&existing); err != nil {
		return fmt.Errorf("count orders: %w", err)
	}
	if existing >= 100 {
		log.Printf("  orders: %d already present, skipping order history", existing)
		return nil
	}

	if len(c.Items) == 0 {
		return fmt.Errorf("no menu items in Ctx — seedMenu must run before seedOrders")
	}

	// Deterministic item name list (map iteration order is random in Go).
	itemNames := make([]string, 0, len(c.Items))
	for name := range c.Items {
		itemNames = append(itemNames, name)
	}
	sort.Strings(itemNames)

	rng := rand.New(rand.NewSource(20260709))

	today := time.Date(c.Now.Year(), c.Now.Month(), c.Now.Day(), 0, 0, 0, 0, time.UTC)

	const targetOrders = 1500
	const days = 365

	// dayOrderCounts[i] = number of orders to place i days ago (0 = today).
	// Mild upward trend: oldest days get 0.6x base, newest days get 1.4x base.
	dayOrderCounts := make([]int, days)
	floatTotal := 0.0
	for i := 0; i < days; i++ {
		trendFactor := 1.4 - 0.8*float64(i)/float64(days-1)
		dayDate := today.AddDate(0, 0, -i)
		dow := int(dayDate.Weekday())
		floatTotal += float64(ordersDayWeights[dow]) * trendFactor
	}
	scale := float64(targetOrders) / floatTotal

	for i := 0; i < days; i++ {
		dayDate := today.AddDate(0, 0, -i)
		dow := int(dayDate.Weekday())
		trendFactor := 1.4 - 0.8*float64(i)/float64(days-1)
		expected := float64(ordersDayWeights[dow]) * trendFactor * scale
		base := int(expected)
		if rng.Float64() < expected-float64(base) {
			base++
		}
		dayOrderCounts[i] = base
	}

	const batchDays = 50
	created := 0
	orderSeq := existing // continue numbering after any pre-existing orders

	for batchStart := 0; batchStart < days; batchStart += batchDays {
		batchEnd := batchStart + batchDays
		if batchEnd > days {
			batchEnd = days
		}

		err := s.tx(func(tx pgx.Tx) error {
			for dayIdx := batchStart; dayIdx < batchEnd; dayIdx++ {
				nOrders := dayOrderCounts[dayIdx]
				if nOrders == 0 {
					continue
				}
				dayDate := today.AddDate(0, 0, -dayIdx)

				for k := 0; k < nOrders; k++ {
					orderSeq++
					if err := insertOneOrder(s, tx, c, rng, itemNames, dayDate, orderSeq); err != nil {
						return err
					}
					created++
				}
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("order batch starting day %d: %w", batchStart, err)
		}
		log.Printf("  orders batch days %d-%d: %d inserted so far", batchStart, batchEnd-1, created)
	}

	log.Printf("  orders: created %d orders (order history)", created)
	return nil
}

// insertOneOrder builds and inserts a single order + its line items + its
// payment, all within the caller's transaction.
func insertOneOrder(s *seeder, tx pgx.Tx, c *Ctx, rng *rand.Rand, itemNames []string, dayDate time.Time, orderSeq int) error {
	hour := pickWeightedOrders(rng, ordersHourCDF[:])
	minute := rng.Intn(60)
	second := rng.Intn(60)
	orderAt := time.Date(dayDate.Year(), dayDate.Month(), dayDate.Day(), hour, minute, second, 0, time.UTC)

	fc := pickFulfillment(rng)

	// Customer assignment: ~70% of orders have a known customer.
	var customerID *string
	if len(c.Customers) > 0 && rng.Float64() < 0.70 {
		cust := c.Customers[rng.Intn(len(c.Customers))]
		id := cust.ID
		customerID = &id
	}

	// Pick 1-5 distinct line items, quantities 1-3.
	numItems := 1 + rng.Intn(5)
	if numItems > len(itemNames) {
		numItems = len(itemNames)
	}
	perm := rng.Perm(len(itemNames))
	selected := perm[:numItems]

	type lineItem struct {
		itemID   string
		qty      int64
		unitCent int64
	}
	var lines []lineItem
	var subtotalCents int64
	for _, idx := range selected {
		name := itemNames[idx]
		itemID, ok := c.Items[name]
		if !ok {
			continue
		}
		unitCent := c.ItemPrice[name]
		if unitCent <= 0 {
			continue
		}
		qty := int64(1 + rng.Intn(3))
		subtotalCents += unitCent * qty
		lines = append(lines, lineItem{itemID, qty, unitCent})
	}
	if len(lines) == 0 {
		return nil
	}

	var deliveryFeeCents int64
	if fc.fulfillment == "delivery" {
		deliveryFeeCents = 3500
	}

	var gratuityCents int64
	if fc.fulfillment == "dine_in" && rng.Float64() < 0.55 {
		pct := 0.10 + rng.Float64()*0.05 // 10-15%
		gratuityCents = int64(float64(subtotalCents) * pct)
	}

	var discountCents int64
	if rng.Float64() < 0.05 {
		pct := 0.05 + rng.Float64()*0.10 // 5-15%
		discountCents = int64(float64(subtotalCents) * pct)
	}

	totalCents := subtotalCents + deliveryFeeCents + gratuityCents - discountCents
	if totalCents < 0 {
		totalCents = 0
	}

	// VAT-inclusive tax component (tax_rate=15%, tax_inclusive=true).
	taxCents := int64(float64(totalCents) * 15.0 / 115.0)

	orderNum := fmt.Sprintf("CT-%05d", orderSeq)

	var orderID string
	err := tx.QueryRow(s.ctx, `
		INSERT INTO orders (
			location_id, organization_id, order_number,
			status, fulfillment_type, order_type,
			subtotal_cents, delivery_fee_cents, discount_cents, tax_cents, gratuity_cents, total_cents,
			tax_rate, tax_inclusive, currency_code,
			customer_id,
			created_at, updated_at
		) VALUES (
			$1,$2,$3,
			'completed',$4,$5,
			$6,$7,$8,$9,$10,$11,
			15.00,true,'ZAR',
			$12,
			$13,$13
		) RETURNING id
	`, c.LocID, c.OrgID, orderNum,
		fc.fulfillment, fc.orderType,
		subtotalCents, deliveryFeeCents, discountCents, taxCents, gratuityCents, totalCents,
		customerID,
		orderAt,
	).Scan(&orderID)
	if err != nil {
		return fmt.Errorf("order %s: %w", orderNum, err)
	}

	for _, line := range lines {
		lineTotal := line.unitCent * line.qty
		if _, err := tx.Exec(s.ctx, `
			INSERT INTO order_items (order_id, item_id, quantity, unit_price_cents, total_price_cents)
			VALUES ($1,$2,$3,$4,$5)
		`, orderID, line.itemID, line.qty, line.unitCent, lineTotal); err != nil {
			return fmt.Errorf("order item for %s: %w", orderNum, err)
		}
	}

	payCode := pickPaymentMethod(rng, fc.fulfillment)
	if _, err := tx.Exec(s.ctx, `
		INSERT INTO order_payments (
			order_id, payment_method_code,
			amount_paid_cents, tip_amount_cents, payment_status, paid_at
		) VALUES ($1,$2,$3,$4,'completed',$5)
	`, orderID, payCode, totalCents, gratuityCents, orderAt); err != nil {
		return fmt.Errorf("order payment for %s: %w", orderNum, err)
	}

	return nil
}

// pickPaymentMethod chooses a payment_methods.code plausible for the
// fulfillment type. Delivery orders skew toward card-on-delivery; other
// orders alternate cash/card-in-person.
func pickPaymentMethod(rng *rand.Rand, fulfillment string) string {
	if fulfillment == "delivery" {
		if rng.Float64() < 0.65 {
			return "card_on_delivery"
		}
		return "cash"
	}
	if rng.Float64() < 0.5 {
		return "cash"
	}
	return "card_in_person"
}

// ---------------------------------------------------------------------------
// Cash drawer: one register, a few closed sessions + one open session.
// ---------------------------------------------------------------------------

func seedCashDrawer(s *seeder, c *Ctx) error {
	var existing int
	if err := s.pool.QueryRow(s.ctx,
		`SELECT count(*) FROM cash_drawers WHERE location_id=$1`, c.LocID).Scan(&existing); err != nil {
		return fmt.Errorf("count cash_drawers: %w", err)
	}
	if existing > 0 {
		log.Printf("  cash drawer: already exists, skipping")
		return nil
	}

	rng := rand.New(rand.NewSource(20260710))

	return s.tx(func(tx pgx.Tx) error {
		var drawerID string
		if err := tx.QueryRow(s.ctx, `
			INSERT INTO cash_drawers (location_id, name, is_active)
			VALUES ($1,'Front Register',true)
			RETURNING id
		`, c.LocID).Scan(&drawerID); err != nil {
			return fmt.Errorf("insert cash_drawer: %w", err)
		}

		// cash_drawer_sessions.opened_by / closed_by reference staff(id), not
		// profiles — pick a cashier/manager from the seeded roster.
		var openedBy *string
		for _, st := range c.Staff {
			if st.Role == "cashier" || st.Role == "manager" {
				id := st.ID
				openedBy = &id
				break
			}
		}
		if openedBy == nil && len(c.Staff) > 0 {
			id := c.Staff[0].ID
			openedBy = &id
		}

		// A few closed sessions over the last several days.
		daysAgo := []int{4, 3, 1}
		for _, d := range daysAgo {
			day := c.Now.AddDate(0, 0, -d)
			day = time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
			openedAt := day.Add(8 * time.Hour)
			closedAt := day.Add(22 * time.Hour)

			openingFloat := int64(100000)
			salesCents := int64(18000 + rng.Intn(30000))
			expectedClosing := openingFloat + salesCents
			overShort := int64(rng.Intn(1500)) - 700 // small over/short variance
			declaredClosing := expectedClosing + overShort

			if _, err := tx.Exec(s.ctx, `
				INSERT INTO cash_drawer_sessions (
					cash_drawer_id, opened_by, closed_by,
					opening_float_cents, declared_closing_cents, expected_closing_cents, over_short_cents,
					status, opened_at, closed_at, cashier_label
				) VALUES (
					$1,$2,$2,
					$3,$4,$5,$6,
					'closed',$7,$8,'Front Register'
				)
			`, drawerID, openedBy,
				openingFloat, declaredClosing, expectedClosing, overShort,
				openedAt, closedAt,
			); err != nil {
				return fmt.Errorf("insert closed cash_drawer_session (%d days ago): %w", d, err)
			}
		}

		// One currently-open session for today.
		openedAt := c.Now.Add(-3 * time.Hour)
		if _, err := tx.Exec(s.ctx, `
			INSERT INTO cash_drawer_sessions (
				cash_drawer_id, opened_by,
				opening_float_cents,
				status, opened_at, cashier_label
			) VALUES (
				$1,$2,
				100000,
				'open',$3,'Front Register'
			)
		`, drawerID, openedBy, openedAt); err != nil {
			return fmt.Errorf("insert open cash_drawer_session: %w", err)
		}

		log.Printf("  cash drawer: created Front Register (3 closed sessions + 1 open)")
		return nil
	})
}
