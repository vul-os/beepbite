package main

import (
	"fmt"
	"log"
	"math/rand"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/money"
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

// ---------------------------------------------------------------------------
// customers
// ---------------------------------------------------------------------------

// Person names are the one thing here that cannot be made country-neutral,
// because no name is: every name belongs to some language and some place. So
// rather than swap one country's name list for another's — which would just
// re-anchor the demo somewhere else — the pool is deliberately broad, drawing
// from many regions at once. seedlocale offers no knob for this, and inventing
// one would imply the product can pick culturally correct names per country,
// which it cannot.
var fohFirstNames = []string{
	"Thabo", "Nomsa", "Sipho", "Lindiwe", "Priya", "Aisha", "Marco", "Pieter",
	"Lunga", "Zanele", "Kagiso", "Naledi", "Werner", "Chantal", "Farai", "Amahle",
	"Riaan", "Bongani", "Yusuf", "Fatima", "Johan", "Karabo", "Mpho", "Tumi",
	"Ashwin", "Ronel", "Zola", "Michael", "Sarah", "David", "Nokuthula", "Andile",
	"Bianca", "Wandile", "Candice", "Ruvimbo", "Mateus", "Ingrid", "Hiroshi",
	"Elena", "Omar", "Sofia", "Niamh", "Kenji", "Lucia", "Anders", "Leilani",
	"Tomasz", "Amara", "Rafael", "Mei", "Idris", "Freya", "Santiago", "Anjali",
}

var fohLastNames = []string{
	"Dlamini", "Nkosi", "Van der Merwe", "Botha", "Patel", "Ferreira", "Mbeki",
	"Khumalo", "Adams", "Pillay", "Naidoo", "Smith", "Abrahams", "Petersen",
	"Mahlangu", "Steyn", "Govender", "Sithole", "Daniels", "Julies", "Mokoena",
	"Human", "Kruger", "Booysen", "September", "Fortuin", "Ngcobo", "Willemse",
	"Okafor", "Tanaka", "Rossi", "Nowak", "Silva", "Haddad", "Lindqvist",
	"O'Sullivan", "Mendoza", "Fischer", "Sharma", "Duarte", "Karlsson", "Rahman",
}

// Customer contact details are synthetic by construction: every address is in
// the RFC 2606 reserved domain example.com (which can never be registered) and
// every number is built from the configured dial code with a reserved
// subscriber prefix.
//
// The previous version drew from real consumer mail providers and real +27
// mobile prefixes, which meant a staging environment wired to live WhatsApp or
// SMTP credentials could message an actual stranger about an order that never
// existed. Unroutable-by-construction is the only version of that which is safe.

func seedCustomers(s *seeder, c *Ctx, rng *rand.Rand) (int, error) {
	// minSpent/maxSpent are authored in the 2-decimal reference scale (1800000 =
	// "eighteen thousand") and rescaled by cfg.Price, so a platinum customer in
	// a JPY location has spent ¥18,000 rather than ¥1,800,000.
	type tierPlan struct {
		tier                 string
		minOrders, maxOrders int
		minSpent, maxSpent   int64
	}
	plans := map[string]tierPlan{
		"platinum": {"platinum", 45, 70, 1800000, 3500000},
		"gold":     {"gold", 20, 40, 700000, 1500000},
		"silver":   {"silver", 8, 18, 200000, 600000},
		"bronze":   {"bronze", 0, 8, 0, 220000},
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
		totalSpentMinor                 int64 // minor units of the configured currency
		loyaltyPoints                   int
		lastOrderAt                     *time.Time
		lastSeenAt                      *time.Time
	}
	rows := make([]row, 0, 30)

	for i := 0; i < 30; i++ {
		first := fohFirstNames[firstPerm[i%len(firstPerm)]]
		last := fohLastNames[rng.Intn(len(fohLastNames))]

		// Customer phone seeds start at 1000 so they cannot collide with the
		// location, staff, supplier or house-account numbers, which are
		// allocated from lower blocks.
		phone := s.cfg.Phone(fohCustomerPhoneSeq + i)
		email := s.cfg.Email(fmt.Sprintf("%s.%s%d", first, strings.ReplaceAll(last, " ", ""), i))

		plan := plans[tierOrder[i]]
		totalOrders := randRange(rng, plan.minOrders, plan.maxOrders)
		// Spend is chosen as an integer in the reference scale and only then
		// rescaled — the float never touches the money value itself.
		spanUnits := plan.maxSpent - plan.minSpent
		spentRef := plan.minSpent
		if spanUnits > 0 {
			spentRef += rng.Int63n(spanUnits + 1)
		}
		totalSpentMinor := s.cfg.Price(spentRef)
		// One loyalty point per 10 major units spent. Scale(decimals) is the
		// number of minor units in one major unit — never a literal 100.
		perPoint := 10 * money.Scale(s.cfg.Decimals)
		loyaltyPoints := int(totalSpentMinor/perPoint) + randRange(rng, 0, 50)

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
			totalOrders: totalOrders, totalSpentMinor: totalSpentMinor, loyaltyPoints: loyaltyPoints,
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
			// customers.total_spent is numeric MAJOR units, so the minor-unit
			// integer is rendered at the currency's own scale.
			`, c.OrgID, r.phone, r.first, r.last, r.email,
				r.totalOrders, money.Decimal(r.totalSpentMinor, s.cfg.Decimals), r.loyaltyPoints, r.tier,
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

// Delivery addresses in the fictional Example City, clustered in small offsets
// around Null Island (0, 0) so they fall inside the seeded delivery zones.
//
// Real coordinates would put real buildings into every developer's database and
// would anchor the demo to one country's geography — and a delivery zone drawn
// around a real neighbourhood implies the product knows something about that
// neighbourhood that it does not.
var fohAddresses = []fohAddress{
	{"12 Example Road", "Harbour Quarter, Example City", "00100", 0.010, 0.010},
	{"45 Sample Street", "Harbour Quarter, Example City", "00100", 0.012, 0.014},
	{"8 Placeholder Way", "Old Town, Example City", "00200", 0.030, 0.012},
	{"22 Specimen Drive", "Old Town, Example City", "00200", 0.034, 0.016},
	{"5 Demo Avenue", "Riverside, Example City", "00300", 0.011, 0.032},
	{"17 Fixture Lane", "Riverside, Example City", "00300", 0.015, 0.035},
	{"3 Example Terrace", "Harbour Quarter, Example City", "00100", 0.014, 0.011},
	{"9 Sample Crescent", "Old Town, Example City", "00200", 0.032, 0.019},
	{"31 Placeholder Row", "Riverside, Example City", "00300", 0.018, 0.033},
	{"14 Specimen Road", "Harbour Quarter, Example City", "00100", 0.016, 0.013},
	{"27 Demo Close", "Harbour Quarter, Example City", "00100", 0.013, 0.017},
	{"6 Fixture Street", "Old Town, Example City", "00200", 0.031, 0.014},
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
				custPhone = s.cfg.Phone(reservationPhoneSeq + i)
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
			`, c.OrgID, c.LocID, name, s.cfg.Phone(waitlistPhoneSeq+i),
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
			`, c.OrgID, c.LocID, name, s.cfg.Phone(waitlistPhoneSeq+500+i),
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

// Review copy references only the seeded menu and the fictional Example City.
//
// The original corpus name-checked Sea Point, the Karoo, Cape Malay curry and
// "worth every rand" — which meant the demo's *prose* re-asserted a country
// even after the currency column stopped doing so. Money is never written as a
// symbol or an amount in review text; a hardcoded "R350" would be wrong the
// moment SEED_CURRENCY changed, and there is no reason for a review to quote a
// price at all.
var fohReviews5 = []string{
	"Absolutely loved the slow-braised lamb shank — falling off the bone and full of flavour. The copper-topped bar makes for a beautiful backdrop too.",
	"Best meal we've had in the Harbour Quarter in years. The beef carpaccio was outstanding and the sunset view over the waterfront sealed the deal.",
	"Chef Marco's tasting menu is a must. Every course was thoughtfully plated and the wine pairing suggestions were spot on.",
	"The butter chicken curry reminded me of my grandmother's cooking. Warm, generous portions, and the staff made us feel like regulars.",
	"Booked for our anniversary and they went above and beyond — a candle on the warm caramel sponge and a genuinely warm team.",
	"The harbour mussels in that white wine broth are unreal. Will be back for the fillet steak next time.",
	"Craft cocktails at the bar while we waited for our table, then a flawless dinner service. Highly recommend the crispy pork belly bites.",
	"Perfect spot for a celebration — the team decorated our table without us even asking after I mentioned it was a birthday.",
	"Consistently excellent. We've been three times now and the quality never dips.",
	"The service was warm without being intrusive, and the food arrived exactly when they said it would.",
	"Gorgeous room, gorgeous plates, gorgeous view. Worth every bit of it.",
	"Our waiter recommended the venison loin and it was the best dish on the table by far.",
}

var fohReviews4 = []string{
	"Really solid meal overall — the warm caramel sponge is a must-order for dessert. Only knock is the wait for our table despite a booking.",
	"Great food and atmosphere. Got a little loud once the bar filled up around 8pm but the cocktails made up for it.",
	"Loved the duck liver parfait starter. Mains were good though the fillet was slightly over for our liking.",
	"Lovely evening on the waterfront side. Service was attentive, just a touch slow getting the bill at the end.",
	"The butter chicken curry was fantastic. Would've given five stars but parking nearby is a mission on weekends.",
	"Great value for a Harbour Quarter spot with this view. The kids menu was a nice touch for our little one.",
	"Good wine list, friendly staff, tasty food. Nothing groundbreaking but a very reliable choice for date night.",
	"The mussels and the craft cocktails were the highlights. Would go back for the bar alone.",
	"Enjoyed our meal — the beef carpaccio stood out. Room was busy so a bit noisy for conversation.",
	"Solid Sunday lunch. The staff were lovely with our extended family and the lamb shank was a hit with everyone.",
	"Really good spot for a business lunch — quick, professional service and a quiet corner table when we asked.",
}

var fohReviews3 = []string{
	"Food was good but service was noticeably slow on a busy Friday night — waited almost 20 minutes just to order.",
	"Decent meal, nothing special. The warm caramel sponge saved the evening after a fairly average main course.",
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
