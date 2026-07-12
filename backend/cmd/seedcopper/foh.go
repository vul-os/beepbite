package main

import (
	"fmt"
	"log"
	"math"
	"math/rand"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// seedFOH populates front-of-house data for The Copper Table: customers,
// customer addresses, reservations, waitlist entries and marketplace reviews.
func seedFOH(s *seeder, c *Ctx) error {
	// Idempotency: if customers already exist for this org, load them into
	// c.Customers (later sections may need them) and skip the rest.
	var existing int
	if err := s.pool.QueryRow(s.ctx, `SELECT count(*) FROM customers WHERE organization_id=$1`, c.OrgID).Scan(&existing); err != nil {
		return fmt.Errorf("foh: count customers: %w", err)
	}
	if existing > 0 {
		rows, err := s.pool.Query(s.ctx, `
			SELECT id, first_name, last_name, whatsapp_number, email
			FROM customers WHERE organization_id=$1 ORDER BY created_at`, c.OrgID)
		if err != nil {
			return fmt.Errorf("foh: load existing customers: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var ref CustomerRef
			var first, last, phone, email *string
			if err := rows.Scan(&ref.ID, &first, &last, &phone, &email); err != nil {
				return fmt.Errorf("foh: scan existing customer: %w", err)
			}
			if first != nil {
				ref.First = *first
			}
			if last != nil {
				ref.Last = *last
			}
			if phone != nil {
				ref.Phone = *phone
			}
			if email != nil {
				ref.Email = *email
			}
			ref.Name = strings.TrimSpace(ref.First + " " + ref.Last)
			c.Customers = append(c.Customers, ref)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("foh: iterate existing customers: %w", err)
		}
		log.Printf("  foh: customers already seeded (%d) — skipping", existing)
		return nil
	}

	rng := rand.New(rand.NewSource(20260709))

	nCustomers, err := seedCustomers(s, c, rng)
	if err != nil {
		return fmt.Errorf("foh: customers: %w", err)
	}
	nAddresses, err := seedCustomerAddresses(s, c, rng)
	if err != nil {
		return fmt.Errorf("foh: addresses: %w", err)
	}
	nReservations, err := seedReservations(s, c, rng)
	if err != nil {
		return fmt.Errorf("foh: reservations: %w", err)
	}
	nWaitlist, err := seedWaitlist(s, c, rng)
	if err != nil {
		return fmt.Errorf("foh: waitlist: %w", err)
	}
	nReviews, err := seedMarketplaceReviews(s, c, rng)
	if err != nil {
		return fmt.Errorf("foh: reviews: %w", err)
	}

	log.Printf("  foh: %d customers, %d addresses, %d reservations, %d waitlist, %d reviews",
		nCustomers, nAddresses, nReservations, nWaitlist, nReviews)
	return nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func timePtr(t time.Time) *time.Time { return &t }

func randRange(rng *rand.Rand, min, max int) int {
	if max <= min {
		return min
	}
	return min + rng.Intn(max-min+1)
}

func round2(f float64) float64 {
	return math.Round(f*100) / 100
}

// ---------------------------------------------------------------------------
// customers
// ---------------------------------------------------------------------------

var fohFirstNames = []string{
	"Thabo", "Nomsa", "Sipho", "Lindiwe", "Priya", "Aisha", "Marco", "Pieter",
	"Lunga", "Zanele", "Kagiso", "Naledi", "Werner", "Chantal", "Farai", "Amahle",
	"Riaan", "Bongani", "Yusuf", "Fatima", "Johan", "Karabo", "Mpho", "Tumi",
	"Ashwin", "Ronel", "Zola", "Michael", "Sarah", "David", "Nokuthula", "Andile",
	"Bianca", "Wandile", "Candice", "Ruvimbo",
}

var fohLastNames = []string{
	"Dlamini", "Nkosi", "Van der Merwe", "Botha", "Patel", "Ferreira", "Mbeki",
	"Khumalo", "Adams", "Pillay", "Naidoo", "Smith", "Abrahams", "Petersen",
	"Mahlangu", "Steyn", "Govender", "Sithole", "Daniels", "Julies", "Mokoena",
	"Human", "Kruger", "Booysen", "September", "Fortuin", "Ngcobo", "Willemse",
}

var fohEmailDomains = []string{"gmail.com", "gmail.com", "gmail.com", "outlook.com", "outlook.com", "icloud.com", "webmail.co.za", "yahoo.com"}

var fohPhonePrefixes = []string{"82", "83", "84", "71", "72", "73", "76", "78", "79", "81", "61", "63", "64", "65"}

func seedCustomers(s *seeder, c *Ctx, rng *rand.Rand) (int, error) {
	type tierPlan struct {
		tier                 string
		minOrders, maxOrders int
		minSpent, maxSpent   float64
	}
	plans := map[string]tierPlan{
		"platinum": {"platinum", 45, 70, 18000, 35000},
		"gold":     {"gold", 20, 40, 7000, 15000},
		"silver":   {"silver", 8, 18, 2000, 6000},
		"bronze":   {"bronze", 0, 8, 0, 2200},
	}

	// 3 platinum, 5 gold, 8 silver, 14 bronze = 30 customers.
	var tierOrder []string
	for i := 0; i < 3; i++ {
		tierOrder = append(tierOrder, "platinum")
	}
	for i := 0; i < 5; i++ {
		tierOrder = append(tierOrder, "gold")
	}
	for i := 0; i < 8; i++ {
		tierOrder = append(tierOrder, "silver")
	}
	for i := 0; i < 14; i++ {
		tierOrder = append(tierOrder, "bronze")
	}
	rng.Shuffle(len(tierOrder), func(i, j int) { tierOrder[i], tierOrder[j] = tierOrder[j], tierOrder[i] })

	firstPerm := rng.Perm(len(fohFirstNames))

	type row struct {
		first, last, phone, email, tier string
		totalOrders                     int
		totalSpent                      float64
		loyaltyPoints                   int
		lastOrderAt                     *time.Time
		lastSeenAt                      *time.Time
	}
	rows := make([]row, 0, 30)

	for i := 0; i < 30; i++ {
		first := fohFirstNames[firstPerm[i%len(firstPerm)]]
		last := fohLastNames[rng.Intn(len(fohLastNames))]

		prefix := fohPhonePrefixes[i%len(fohPhonePrefixes)]
		suffix := 1000000 + i*3011
		phone := fmt.Sprintf("+27%s%07d", prefix, suffix%10000000)

		domain := fohEmailDomains[rng.Intn(len(fohEmailDomains))]
		email := fmt.Sprintf("%s.%s%d@%s", strings.ToLower(first), strings.ToLower(strings.ReplaceAll(last, " ", "")), i, domain)

		plan := plans[tierOrder[i]]
		totalOrders := randRange(rng, plan.minOrders, plan.maxOrders)
		totalSpent := round2(plan.minSpent + rng.Float64()*(plan.maxSpent-plan.minSpent))
		loyaltyPoints := int(totalSpent/10) + randRange(rng, 0, 50)

		var lastOrderAt, lastSeenAt *time.Time
		if totalOrders > 0 {
			maxDaysAgo := 90
			switch tierOrder[i] {
			case "platinum":
				maxDaysAgo = 14
			case "gold":
				maxDaysAgo = 30
			case "silver":
				maxDaysAgo = 60
			}
			daysAgo := randRange(rng, 1, maxDaysAgo)
			ordered := c.Now.Add(-time.Duration(daysAgo) * 24 * time.Hour)
			lastOrderAt = timePtr(ordered)
			seen := ordered.Add(time.Duration(randRange(rng, 0, 5)) * 24 * time.Hour)
			if seen.After(c.Now) {
				seen = c.Now.Add(-time.Duration(randRange(rng, 0, 6)) * time.Hour)
			}
			lastSeenAt = timePtr(seen)
		} else {
			seenDaysAgo := randRange(rng, 1, 30)
			lastSeenAt = timePtr(c.Now.Add(-time.Duration(seenDaysAgo) * 24 * time.Hour))
		}

		rows = append(rows, row{
			first: first, last: last, phone: phone, email: email, tier: tierOrder[i],
			totalOrders: totalOrders, totalSpent: totalSpent, loyaltyPoints: loyaltyPoints,
			lastOrderAt: lastOrderAt, lastSeenAt: lastSeenAt,
		})
	}

	if err := s.tx(func(tx pgx.Tx) error {
		for _, r := range rows {
			var id string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO customers (
					organization_id, whatsapp_number, first_name, last_name, email,
					total_orders, total_spent, loyalty_points, loyalty_tier,
					last_order_at, last_seen_at
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
				RETURNING id
			`, c.OrgID, r.phone, r.first, r.last, r.email,
				r.totalOrders, r.totalSpent, r.loyaltyPoints, r.tier,
				r.lastOrderAt, r.lastSeenAt).Scan(&id); err != nil {
				return fmt.Errorf("insert customer %s %s: %w", r.first, r.last, err)
			}
			c.Customers = append(c.Customers, CustomerRef{
				ID: id, Name: r.first + " " + r.last, First: r.first, Last: r.last,
				Phone: r.phone, Email: r.email,
			})
		}
		return nil
	}); err != nil {
		return 0, err
	}
	return len(c.Customers), nil
}

// ---------------------------------------------------------------------------
// customer addresses
// ---------------------------------------------------------------------------

type fohAddress struct {
	line1, city, postalCode string
	lat, lng                float64
}

var fohAddresses = []fohAddress{
	{"12 Regent Road", "Sea Point, Cape Town", "8005", -33.9169, 18.3856},
	{"45 Beach Road", "Sea Point, Cape Town", "8005", -33.9139, 18.3796},
	{"8 Main Road", "Green Point, Cape Town", "8051", -33.9067, 18.4102},
	{"22 Ocean View Drive", "Green Point, Cape Town", "8051", -33.9058, 18.4022},
	{"5 Victoria Road", "Camps Bay, Cape Town", "8040", -33.9508, 18.3775},
	{"17 Geneva Drive", "Camps Bay, Cape Town", "8040", -33.9522, 18.3801},
	{"3 High Level Road", "Sea Point, Cape Town", "8005", -33.9186, 18.3839},
	{"9 Portswood Road", "Green Point, Cape Town", "8051", -33.9037, 18.4192},
	{"31 The Rocks", "Camps Bay, Cape Town", "8040", -33.9553, 18.3789},
	{"14 Main Road", "Sea Point, Cape Town", "8005", -33.9156, 18.3811},
	{"27 Kloof Road", "Sea Point, Cape Town", "8005", -33.9201, 18.3822},
	{"6 Somerset Road", "Green Point, Cape Town", "8051", -33.9101, 18.4145},
}

func seedCustomerAddresses(s *seeder, c *Ctx, rng *rand.Rand) (int, error) {
	if len(c.Customers) == 0 {
		return 0, nil
	}
	n := len(c.Customers)
	if n > 10 {
		n = 10
	}
	addrIdx := 0
	count := 0
	if err := s.tx(func(tx pgx.Tx) error {
		for i := 0; i < n; i++ {
			cust := c.Customers[i]
			numAddrs := 1
			if i < 2 {
				numAddrs = 2 // a couple of customers have a home + work address
			}
			for a := 0; a < numAddrs; a++ {
				addr := fohAddresses[addrIdx%len(fohAddresses)]
				addrIdx++
				isDefault := a == 0
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO customer_addresses (
						customer_id, address_line_1, city, postal_code,
						latitude, longitude, is_default
					) VALUES ($1,$2,$3,$4,$5,$6,$7)
				`, cust.ID, addr.line1, addr.city, addr.postalCode, addr.lat, addr.lng, isDefault); err != nil {
					return fmt.Errorf("insert address for %s: %w", cust.Name, err)
				}
				count++
			}
		}
		return nil
	}); err != nil {
		return 0, err
	}
	return count, nil
}

// ---------------------------------------------------------------------------
// reservations
// ---------------------------------------------------------------------------

var fohSpecialRequests = []string{
	"Window table please, celebrating an anniversary.",
	"Birthday dinner — could you bring a candle with dessert?",
	"Wheelchair access needed for one guest.",
	"Allergic to shellfish — please flag on the ticket.",
	"Quiet table away from the bar if possible.",
	"High chair needed for a toddler.",
}

func seedReservations(s *seeder, c *Ctx, rng *rand.Rand) (int, error) {
	type resv struct {
		status                               string
		daysOffset                           int // negative = past, positive = future
		hour, minute                         int
		partySize, durationMinutes           int
		withCustomer, withTable, withRequest bool
		withConfirmation                     bool
	}

	plan := []resv{
		// past — completed (6)
		{"completed", -28, 19, 0, 4, 90, true, true, false, true},
		{"completed", -21, 12, 30, 2, 90, false, false, true, true},
		{"completed", -17, 19, 30, 6, 120, true, true, false, true},
		{"completed", -10, 18, 0, 2, 90, true, false, false, true},
		{"completed", -6, 20, 0, 8, 150, false, true, true, true},
		{"completed", -3, 13, 0, 3, 90, true, false, false, true},
		// past — no_show (2)
		{"no_show", -15, 19, 0, 2, 90, false, false, false, true},
		{"no_show", -5, 20, 30, 4, 90, true, false, false, false},
		// past — cancelled (3)
		{"cancelled", -24, 18, 30, 5, 120, false, false, false, false},
		{"cancelled", -12, 19, 0, 2, 90, true, false, false, true},
		{"cancelled", -2, 20, 0, 3, 90, false, false, false, false},
		// today — seated (1)
		{"seated", 0, 12, 0, 4, 90, true, true, false, true},
		// upcoming — confirmed (5)
		{"confirmed", 1, 19, 0, 2, 90, true, true, false, true},
		{"confirmed", 2, 20, 0, 6, 120, false, true, true, true},
		{"confirmed", 4, 13, 30, 4, 90, true, false, false, true},
		{"confirmed", 6, 19, 30, 10, 150, false, true, true, true},
		{"confirmed", 9, 18, 0, 2, 90, true, false, false, true},
		// upcoming — pending (5)
		{"pending", 1, 18, 0, 3, 90, false, false, false, false},
		{"pending", 3, 19, 0, 2, 90, true, false, true, false},
		{"pending", 8, 20, 0, 5, 120, false, true, false, false},
		{"pending", 12, 19, 30, 4, 90, true, false, false, false},
		{"pending", 21, 12, 30, 2, 90, false, false, false, false},
	}

	standaloneNames := []string{
		"Ellen de Wet", "Jaco van Wyk", "Buhle Zulu", "Reza Karim", "Simone Adriaanse",
		"Grant O'Connell", "Nandi Mahlangu", "Devon Ryklief", "Kholiwe Ntuli", "Peter Langley",
	}

	count := 0
	if err := s.tx(func(tx pgx.Tx) error {
		custIdx := 0
		for i, r := range plan {
			reservationAt := time.Date(c.Now.Year(), c.Now.Month(), c.Now.Day(), r.hour, r.minute, 0, 0, time.UTC).
				AddDate(0, 0, r.daysOffset)

			var customerID *string
			var custName, custPhone, custEmail string
			if r.withCustomer && len(c.Customers) > 0 {
				cust := c.Customers[custIdx%len(c.Customers)]
				custIdx++
				customerID = &cust.ID
				custName, custPhone, custEmail = cust.Name, cust.Phone, cust.Email
			} else {
				custName = standaloneNames[i%len(standaloneNames)]
				custPhone = fmt.Sprintf("+27%02d%07d", 60+i%20, 2000000+i*777)
			}

			var tableID, sectionID *string
			if r.withTable && len(c.Tables) > 0 {
				tbl := c.Tables[i%len(c.Tables)]
				tableID = &tbl.ID
				if sid, ok := c.Sections[tbl.Section]; ok {
					sectionID = &sid
				}
			}

			var specialRequest *string
			if r.withRequest {
				specialRequest = strPtr(fohSpecialRequests[i%len(fohSpecialRequests)])
			}

			var confirmationSentAt *time.Time
			if r.withConfirmation {
				confirmationSentAt = timePtr(reservationAt.Add(-24 * time.Hour))
			}

			if _, err := tx.Exec(s.ctx, `
				INSERT INTO reservations (
					organization_id, location_id, customer_id, customer_name, customer_phone, customer_email,
					party_size, reservation_at, duration_minutes, table_id, section_id, status,
					special_requests, confirmation_sent_at
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
			`, c.OrgID, c.LocID, customerID, custName, strPtr(custPhone), strPtr(custEmail),
				r.partySize, reservationAt, r.durationMinutes, tableID, sectionID, r.status,
				specialRequest, confirmationSentAt); err != nil {
				return fmt.Errorf("insert reservation %d (%s): %w", i, r.status, err)
			}
			count++
		}
		return nil
	}); err != nil {
		return 0, err
	}
	return count, nil
}

// ---------------------------------------------------------------------------
// waitlist
// ---------------------------------------------------------------------------

func seedWaitlist(s *seeder, c *Ctx, rng *rand.Rand) (int, error) {
	activeNames := []string{"Reagan Fisher", "Zinhle Cele", "Werner du Toit", "Aaliyah Isaacs"}
	historicalNames := []string{"Craig Barnard", "Thandeka Msomi"}

	count := 0
	if err := s.tx(func(tx pgx.Tx) error {
		for i, name := range activeNames {
			addedAt := c.Now.Add(-time.Duration(randRange(rng, 5, 40)) * time.Minute)
			party := randRange(rng, 2, 6)
			wait := randRange(rng, 10, 40)
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO waitlist (
					organization_id, location_id, customer_name, customer_phone,
					party_size, quoted_wait_minutes, added_at
				) VALUES ($1,$2,$3,$4,$5,$6,$7)
			`, c.OrgID, c.LocID, name, fmt.Sprintf("+27%02d%07d", 70+i, 3000000+i*991),
				party, wait, addedAt); err != nil {
				return fmt.Errorf("insert waitlist active %s: %w", name, err)
			}
			count++
		}
		for i, name := range historicalNames {
			daysAgo := randRange(rng, 1, 6)
			addedAt := c.Now.Add(-time.Duration(daysAgo) * 24 * time.Hour).Add(-time.Duration(randRange(rng, 0, 90)) * time.Minute)
			wait := randRange(rng, 15, 45)
			seatedAt := addedAt.Add(time.Duration(wait) * time.Minute)
			party := randRange(rng, 2, 8)
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO waitlist (
					organization_id, location_id, customer_name, customer_phone,
					party_size, quoted_wait_minutes, added_at, seated_at
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			`, c.OrgID, c.LocID, name, fmt.Sprintf("+27%02d%07d", 75+i, 4000000+i*811),
				party, wait, addedAt, seatedAt); err != nil {
				return fmt.Errorf("insert waitlist historical %s: %w", name, err)
			}
			count++
		}
		return nil
	}); err != nil {
		return 0, err
	}
	return count, nil
}

// ---------------------------------------------------------------------------
// marketplace reviews
// ---------------------------------------------------------------------------

var fohReviews5 = []string{
	"Absolutely loved the Karoo lamb shank — falling off the bone and full of flavour. The copper-topped bar makes for a beautiful backdrop too.",
	"Best meal we've had in Sea Point in years. The springbok carpaccio was outstanding and the sunset view over the promenade sealed the deal.",
	"Chef Marco's tasting menu is a must. Every course was thoughtfully plated and the wine pairing suggestions were spot on.",
	"The Cape Malay curry reminded me of my grandmother's cooking. Warm, generous portions, and the staff made us feel like regulars.",
	"Booked for our anniversary and they went above and beyond — a candle on the malva pudding and a genuinely warm team.",
	"West Coast mussels in that white wine broth are unreal. Will be back for the biltong-crusted fillet next time.",
	"Craft G&Ts at the bar while we waited for our table, then a flawless dinner service. Highly recommend the bobotie spring rolls.",
	"Perfect spot for a celebration — the team decorated our table without us even asking after I mentioned it was a birthday.",
	"Consistently excellent. We've been three times now and the quality never dips.",
	"The service was warm without being intrusive, and the food arrived exactly when they said it would.",
	"Gorgeous room, gorgeous plates, gorgeous view. Worth every rand.",
	"Our waiter recommended the springbok loin and it was the best dish on the table by far.",
}

var fohReviews4 = []string{
	"Really solid meal overall — the malva pudding is a must-order for dessert. Only knock is the wait for our table despite a booking.",
	"Great food and atmosphere. Got a little loud once the bar filled up around 8pm but the cocktails made up for it.",
	"Loved the bobotie spring rolls starter. Mains were good though the fillet was slightly over for our liking.",
	"Lovely evening on the promenade side. Service was attentive, just a touch slow getting the bill at the end.",
	"The Cape Malay curry was fantastic. Would've given five stars but parking nearby is a mission on weekends.",
	"Great value for a Sea Point spot with this view. Kids menu was a nice touch for our little one.",
	"Good wine list, friendly staff, tasty food. Nothing groundbreaking but a very reliable choice for date night.",
	"The mussels and the craft cocktails were the highlights. Would go back for the bar alone.",
	"Enjoyed our meal — the springbok carpaccio stood out. Room was busy so a bit noisy for conversation.",
	"Solid Sunday lunch. The staff were lovely with our extended family and the lamb shank was a hit with everyone.",
	"Really good spot for a business lunch — quick, professional service and a quiet corner table when we asked.",
}

var fohReviews3 = []string{
	"Food was good but service was noticeably slow on a busy Friday night — waited almost 20 minutes just to order.",
	"Decent meal, nothing special. The malva pudding saved the evening after a fairly average main course.",
	"Nice setting but a bit pricey for the portion sizes. Would come back for drinks and starters only.",
	"Mixed experience — starters were excellent, but our mains arrived lukewarm.",
}

var fohReviews2 = []string{
	"Table was ready 40 minutes after our booking time with no update from staff. Food, once it arrived, was fine.",
	"Ordered the fillet medium and it came out well done twice. Manager did offer a replacement dessert though.",
}

var fohReviews1 = []string{
	"Very disappointed — booked two weeks ahead for a birthday and still waited over an hour to be seated with no apology.",
}

var fohOwnerReplies = []string{
	"Thank you so much for the kind words — we're thrilled you enjoyed the evening and hope to welcome you back soon! – The Copper Table team",
	"This means the world to us. We'll pass your compliments on to Chef Marco and the kitchen team. – Nomsa, General Manager",
	"So glad the anniversary dinner was special for you both — thank you for celebrating with us! – The Copper Table team",
	"We appreciate you flagging the wait time and we're sorry it fell short on the night — we've since adjusted our table pacing on busy evenings. Please reach out directly next time so we can make it right. – Nomsa, General Manager",
	"Thank you for the honest feedback on the mains — we've spoken to the kitchen team about ticket timing. We'd love another chance to host you. – The Copper Table team",
	"We're sorry your booking wasn't honoured on time — that's not the standard we hold ourselves to. Please contact us directly so we can make this right. – Nomsa, General Manager",
}

func seedMarketplaceReviews(s *seeder, c *Ctx, rng *rand.Rand) (int, error) {
	// weighted toward 4-5 stars: 1x1, 2x2, 4x3, 11x4, 12x5 = 30
	starPlan := []int{}
	for i := 0; i < 1; i++ {
		starPlan = append(starPlan, 1)
	}
	for i := 0; i < 2; i++ {
		starPlan = append(starPlan, 2)
	}
	for i := 0; i < 4; i++ {
		starPlan = append(starPlan, 3)
	}
	for i := 0; i < 11; i++ {
		starPlan = append(starPlan, 4)
	}
	for i := 0; i < 12; i++ {
		starPlan = append(starPlan, 5)
	}
	rng.Shuffle(len(starPlan), func(i, j int) { starPlan[i], starPlan[j] = starPlan[j], starPlan[i] })

	// pick 6 indices to receive an owner reply — spread across ratings, mostly
	// positive with a couple of service-recovery replies on lower stars.
	replyIdx := map[int]bool{}
	for len(replyIdx) < 6 {
		replyIdx[rng.Intn(len(starPlan))] = true
	}

	count := 0
	if err := s.tx(func(tx pgx.Tx) error {
		for i, stars := range starPlan {
			var pool []string
			switch stars {
			case 5:
				pool = fohReviews5
			case 4:
				pool = fohReviews4
			case 3:
				pool = fohReviews3
			case 2:
				pool = fohReviews2
			default:
				pool = fohReviews1
			}
			text := pool[rng.Intn(len(pool))]

			daysAgo := randRange(rng, 1, 180)
			createdAt := c.Now.Add(-time.Duration(daysAgo) * 24 * time.Hour).
				Add(-time.Duration(rng.Intn(24)) * time.Hour)

			var ownerReply *string
			var ownerRepliedAt *time.Time
			if replyIdx[i] {
				ownerReply = strPtr(fohOwnerReplies[rng.Intn(len(fohOwnerReplies))])
				replyAt := createdAt.Add(time.Duration(randRange(rng, 1, 4)) * 24 * time.Hour)
				if replyAt.After(c.Now) {
					replyAt = c.Now.Add(-time.Duration(rng.Intn(6)) * time.Hour)
				}
				ownerRepliedAt = timePtr(replyAt)
			}

			if _, err := tx.Exec(s.ctx, `
				INSERT INTO marketplace_reviews (
					organization_id, location_id, stars, review_text, text,
					verified_purchase, status, owner_reply, owner_replied_at, created_at
				) VALUES ($1,$2,$3,$4,$5,true,'visible',$6,$7,$8)
			`, c.OrgID, c.LocID, stars, text, text, ownerReply, ownerRepliedAt, createdAt); err != nil {
				return fmt.Errorf("insert review %d: %w", i, err)
			}
			count++
		}
		return nil
	}); err != nil {
		return 0, err
	}
	return count, nil
}
