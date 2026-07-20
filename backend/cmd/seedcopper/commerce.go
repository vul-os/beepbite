package main

import (
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/beepbite/backend/internal/money"
	"github.com/beepbite/backend/internal/tax"
)

// seedCommerce builds gift cards, house accounts, tenant invoices, promotions
// + coupons, and the loyalty program (config, transactions, stamps) for The
// Copper Table. Idempotent: bails out if gift_cards already exist for c.OrgID.
func seedCommerce(s *seeder, c *Ctx) error {
	var existing int
	if err := s.tx(func(tx pgx.Tx) error {
		return tx.QueryRow(s.ctx, `SELECT count(*) FROM gift_cards WHERE organization_id=$1`, c.OrgID).Scan(&existing)
	}); err != nil {
		return fmt.Errorf("commerce: check existing: %w", err)
	}
	if existing > 0 {
		log.Printf("  commerce: already seeded (%d gift cards), skipping", existing)
		return nil
	}

	nCust := len(c.Customers)
	var staffID *string
	if len(c.Staff) > 0 {
		id := c.Staff[0].ID
		staffID = &id
	}

	// custAt returns a (possibly nil) customer for index i, wrapping around the
	// available pool. Returns nil ref if no customers exist yet (defensive —
	// should not happen once seedFOH has run).
	custAt := func(i int) *CustomerRef {
		if nCust == 0 {
			return nil
		}
		cr := c.Customers[i%nCust]
		return &cr
	}
	nullStr := func(v string) interface{} {
		if v == "" {
			return nil
		}
		return v
	}

	gcCount, err := seedGiftCards(s, c, custAt, nullStr, staffID)
	if err != nil {
		return fmt.Errorf("commerce: gift cards: %w", err)
	}

	haCount, invCount, err := seedHouseAccounts(s, c, custAt)
	if err != nil {
		return fmt.Errorf("commerce: house accounts: %w", err)
	}

	tenantInvCount, err := seedTenantInvoices(s, c, custAt)
	if err != nil {
		return fmt.Errorf("commerce: tenant invoices: %w", err)
	}

	promoCount, couponCount, err := seedPromotions(s, c)
	if err != nil {
		return fmt.Errorf("commerce: promotions: %w", err)
	}

	loyaltyTxCount, stampCount, err := seedLoyalty(s, c, custAt, staffID)
	if err != nil {
		return fmt.Errorf("commerce: loyalty: %w", err)
	}

	log.Printf("  commerce: %d gift cards, %d house accounts (%d ha invoices), %d tenant invoices, %d promotions (%d coupons), %d loyalty txns, %d stamp rows",
		gcCount, haCount, invCount, tenantInvCount, promoCount, couponCount, loyaltyTxCount, stampCount)
	return nil
}

// ---------------------------------------------------------------------------
// Gift cards
// ---------------------------------------------------------------------------

type giftCardSpec struct {
	code     string
	cardType string // digital|physical
	// initial is authored in the 2-decimal reference scale and rescaled by
	// cfg.Price into the configured currency's minor units.
	initial int64
	// currentPct is the remaining balance as a whole percentage. It was a
	// float64 multiplied straight into the balance, which is float money
	// arithmetic; as an integer percent it can be applied with DivRound.
	currentPct  int
	status      string // active|redeemed|expired|disabled
	custIdx     int    // -1 => walk-in (no linked customer)
	walkInName  string
	walkInEmail string
	daysAgo     int // activated_at relative to c.Now
}

func seedGiftCards(s *seeder, c *Ctx, custAt func(int) *CustomerRef, nullStr func(string) interface{}, staffID *string) (int, error) {
	specs := []giftCardSpec{
		{"GC-4F2A91", "digital", 50000, 100, "active", 0, "", "", 40},
		{"GC-7B3D02", "digital", 100000, 40, "active", 1, "", "", 75},
		{"GC-19E6C4", "physical", 25000, 100, "active", 2, "", "", 10},
		{"GC-88AA55", "digital", 75000, 0, "redeemed", 3, "", "", 100},
		{"GC-D02B7E", "physical", 150000, 100, "active", 4, "", "", 5},
		{"GC-3C9F10", "digital", 30000, 50, "active", 5, "", "", 60},
		{"GC-6E1177", "digital", 50000, 100, "active", -1, "Zanele Khumalo", s.cfg.Email("zanele.khumalo"), 20},
		{"GC-A5D390", "physical", 20000, 100, "expired", 6, "", "", 400},
		{"GC-F70C2D", "digital", 40000, 100, "disabled", 7, "", "", 15},
		{"GC-2B8E64", "digital", 100000, 75, "active", 8, "", "", 30},
		{"GC-9D4471", "physical", 60000, 100, "active", -1, "Ryan September", s.cfg.Email("ryan.september"), 8},
		{"GC-C10F98", "digital", 35000, 20, "active", 9, "", "", 90},
	}

	err := s.tx(func(tx pgx.Tx) error {
		for _, sp := range specs {
			activatedAt := c.Now.AddDate(0, 0, -sp.daysAgo)
			expiresAt := activatedAt.AddDate(3, 0, 0)
			initial := s.cfg.Price(sp.initial)
			current := money.DivRound(initial*int64(sp.currentPct), 100)

			var custID interface{}
			issuedName := sp.walkInName
			issuedEmail := sp.walkInEmail
			if sp.custIdx >= 0 {
				if cr := custAt(sp.custIdx); cr != nil {
					custID = cr.ID
					issuedName = cr.Name
					issuedEmail = cr.Email
				}
			}

			var lastRedeemedAt interface{}
			if current < initial {
				lastRedeemedAt = activatedAt.AddDate(0, 0, sp.daysAgo/3+1)
			}

			var gcID string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO gift_cards (
					organization_id, code, card_type, initial_balance_cents, current_balance_cents,
					currency, status, issued_to_customer_id, issued_to_name, issued_to_email,
					issued_by_staff_id, expires_at, activated_at, last_redeemed_at, notes
				) VALUES ($1,$2,$3,$4,$5,$15,$6,$7,$8,$9,$10,$11,$12,$13,$14)
				RETURNING id
			`, c.OrgID, sp.code, sp.cardType, initial, current,
				sp.status, custID, nullStr(issuedName), nullStr(issuedEmail),
				staffID, expiresAt, activatedAt, lastRedeemedAt, "Seed data — The Copper Table",
				s.cfg.Currency,
			).Scan(&gcID); err != nil {
				return fmt.Errorf("insert gift card %s: %w", sp.code, err)
			}

			if _, err := tx.Exec(s.ctx, `
				INSERT INTO gift_card_transactions (gift_card_id, txn_type, amount_cents, balance_after_cents, performed_by_staff_id, notes, created_at)
				VALUES ($1,'issue',$2,$2,$3,'Card issued',$4)
			`, gcID, initial, staffID, activatedAt); err != nil {
				return fmt.Errorf("issue txn %s: %w", sp.code, err)
			}

			if current < initial {
				redeemAt := activatedAt.AddDate(0, 0, sp.daysAgo/3+1)
				redeemedAmt := initial - current
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO gift_card_transactions (gift_card_id, txn_type, amount_cents, balance_after_cents, performed_by_staff_id, notes, created_at)
					VALUES ($1,'redeem',$2,$3,$4,'Redeemed against order',$5)
				`, gcID, redeemedAmt, current, staffID, redeemAt); err != nil {
					return fmt.Errorf("redeem txn %s: %w", sp.code, err)
				}
			}

			if sp.status == "expired" {
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO gift_card_transactions (gift_card_id, txn_type, amount_cents, balance_after_cents, performed_by_staff_id, notes, created_at)
					VALUES ($1,'expire',0,0,$2,'Balance expired',$3)
				`, gcID, staffID, expiresAt); err != nil {
					return fmt.Errorf("expire txn %s: %w", sp.code, err)
				}
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return len(specs), nil
}

// ---------------------------------------------------------------------------
// House accounts
// ---------------------------------------------------------------------------

type houseAccountSpec struct {
	name         string
	contactName  string
	contactLocal string // local-part of the seeded example.com address
	phoneSeq     int    // index into the shared phone allocation (shared.go)
	address      string
	// creditLimit/currentBal are authored in the 2-decimal reference scale.
	creditLimit   int64
	currentBal    int64
	billingCycle  string
	netTermsDays  int
	memberIdxs    []int
	invoiceStatus []string // one entry per invoice to create
}

func seedHouseAccounts(s *seeder, c *Ctx, custAt func(int) *CustomerRef) (int, int, error) {
	// Fictional corporate customers in the seeded Example City, with contact
	// details in the reserved example.com domain and on the configured dial code.
	specs := []houseAccountSpec{
		{
			name: "Harbour Quarter Holdings", contactName: "Michael Arendse",
			contactLocal: "accounts.harbourquarter", phoneSeq: houseAccountPhoneSeq + 0,
			address:     "5th Floor, Example Corporate Park, Harbour Quarter, Example City",
			creditLimit: 5000000, currentBal: 1250000, billingCycle: "monthly", netTermsDays: 30,
			memberIdxs: []int{10, 11}, invoiceStatus: []string{"paid", "sent"},
		},
		{
			name: "Old Town Medical Centre", contactName: "Dr. Fatima Haddad",
			contactLocal: "admin.oldtownmedical", phoneSeq: houseAccountPhoneSeq + 1,
			address:     "18 Sample Street, Old Town, Example City",
			creditLimit: 2000000, currentBal: 350000, billingCycle: "monthly", netTermsDays: 30,
			memberIdxs: []int{12}, invoiceStatus: []string{"overdue"},
		},
		{
			name: "Riverside Property Group", contactName: "James Duarte",
			contactLocal: "finance.riversideproperty", phoneSeq: houseAccountPhoneSeq + 2,
			address:     "2 Demo Avenue, Riverside, Example City",
			creditLimit: 3000000, currentBal: 0, billingCycle: "on_demand", netTermsDays: 14,
			memberIdxs: []int{13, 14}, invoiceStatus: nil,
		},
	}

	haCount, invCount := 0, 0
	err := s.tx(func(tx pgx.Tx) error {
		for i, sp := range specs {
			creditLimit := s.cfg.Price(sp.creditLimit)
			currentBal := s.cfg.Price(sp.currentBal)

			var haID string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO house_accounts (
					organization_id, account_name, contact_name, contact_email, contact_phone,
					billing_address, credit_limit_cents, current_balance_cents, currency,
					billing_cycle, net_terms_days
				) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$11,$9,$10)
				RETURNING id
			`, c.OrgID, sp.name, sp.contactName, s.cfg.Email(sp.contactLocal), s.cfg.Phone(sp.phoneSeq),
				sp.address, creditLimit, currentBal, sp.billingCycle, sp.netTermsDays,
				s.cfg.Currency,
			).Scan(&haID); err != nil {
				return fmt.Errorf("insert house account %s: %w", sp.name, err)
			}
			haCount++

			for _, mi := range sp.memberIdxs {
				cr := custAt(mi)
				if cr == nil {
					continue
				}
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO house_account_members (house_account_id, customer_id, spending_limit_cents)
					VALUES ($1,$2,$3)
					ON CONFLICT (house_account_id, customer_id) DO NOTHING
				`, haID, cr.ID, money.DivRound(creditLimit, int64(len(sp.memberIdxs)))); err != nil {
					return fmt.Errorf("house account member %s: %w", sp.name, err)
				}
			}

			for j, status := range sp.invoiceStatus {
				periodEnd := c.Now.AddDate(0, -1, -j*30)
				periodStart := periodEnd.AddDate(0, -1, 0)
				subtotal := currentBal + s.cfg.Price(int64(j)*40000+60000)
				// House-account statements bill a business for a period of
				// trading and quote a net figure with the tax shown as a
				// separate line — the invoicing convention, which is exclusive
				// regardless of whether the restaurant's own menu prices are
				// tax-inclusive. So this uses tax.Add rather than cfg.TaxOn:
				// the rate is configuration, the convention is the document type.
				taxed := tax.Add(subtotal, s.cfg.Tax.Rate)
				total := taxed.Gross
				dueDate := periodEnd.AddDate(0, 0, sp.netTermsDays)

				var sentAt, paidAt interface{}
				paidAmt := int64(0)
				switch status {
				case "sent":
					sentAt = periodEnd.AddDate(0, 0, 2)
				case "paid":
					sentAt = periodEnd.AddDate(0, 0, 2)
					paidAt = periodEnd.AddDate(0, 0, 10)
					paidAmt = total
				case "overdue":
					sentAt = periodEnd.AddDate(0, 0, 2)
				}

				invNum := fmt.Sprintf("HA-%s-%03d", strings.ToUpper(sp.name[:2]), i*10+j+1)
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO house_account_invoices (
						house_account_id, invoice_number, period_start, period_end,
						subtotal_cents, tax_cents, total_cents, status, due_date,
						sent_at, paid_at, paid_amount_cents
					) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
				`, haID, invNum, periodStart, periodEnd, subtotal, taxed.Tax, total, status, dueDate,
					sentAt, paidAt, paidAmt); err != nil {
					return fmt.Errorf("house account invoice %s: %w", invNum, err)
				}
				invCount++
			}
		}
		return nil
	})
	if err != nil {
		return 0, 0, err
	}
	return haCount, invCount, nil
}

// ---------------------------------------------------------------------------
// Tenant invoices
// ---------------------------------------------------------------------------

func seedTenantInvoices(s *seeder, c *Ctx, custAt func(int) *CustomerRef) (int, error) {
	type invSpec struct {
		num     string
		custIdx int
		// subtotal is authored in the 2-decimal reference scale, net of tax.
		subtotal int64
		status   string
		daysAgo  int
		dueIn    int
	}
	specs := []invSpec{
		{"INV-2026-0001", 0, 180000, "paid", 45, 14},
		{"INV-2026-0002", 1, 95000, "sent", 12, 14},
		{"INV-2026-0003", 2, 220000, "overdue", 40, 14},
		{"INV-2026-0004", 3, 60000, "draft", 1, 14},
	}

	count := 0
	err := s.tx(func(tx pgx.Tx) error {
		for _, sp := range specs {
			cr := custAt(sp.custIdx)
			if cr == nil {
				continue
			}
			issuedAt := c.Now.AddDate(0, 0, -sp.daysAgo)
			dueDate := issuedAt.AddDate(0, 0, sp.dueIn)
			// Like house-account statements, a tenant invoice quotes a net
			// subtotal and adds the tax as its own line, so the exclusive
			// computation is used whatever the retail convention is.
			subtotal := s.cfg.Price(sp.subtotal)
			taxed := tax.Add(subtotal, s.cfg.Tax.Rate)
			total := taxed.Gross

			var paidAt interface{}
			if sp.status == "paid" {
				paidAt = issuedAt.AddDate(0, 0, 7)
			}

			if _, err := tx.Exec(s.ctx, `
				INSERT INTO invoices (
					issuer, issuer_org_id, recipient_customer_id, invoice_number, currency,
					subtotal_cents, vat_cents, vat_rate_percent, vat_applied, total_cents,
					due_date, status, issued_at, paid_at
				) VALUES ('tenant',$1,$2,$3,$11,$4,$5,$12,$13,$6,$7,$8,$9,$10)
			`, c.OrgID, cr.ID, sp.num, subtotal, taxed.Tax, total, dueDate, sp.status, issuedAt, paidAt,
				s.cfg.Currency,
				// vat_applied records whether any tax was actually charged — a
				// tax-exempt or unconfigured locale (rate 0) charges none.
				s.cfg.TaxRatePercent(), s.cfg.TaxRatePercent() > 0); err != nil {
				return fmt.Errorf("insert invoice %s: %w", sp.num, err)
			}
			count++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}

// ---------------------------------------------------------------------------
// Promotions + coupons
// ---------------------------------------------------------------------------

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// findLike returns the id of the first map entry whose lower-cased key
// contains any of substrs, falling back to the first sorted entry.
func findLike(m map[string]string, substrs ...string) (string, string, bool) {
	keys := sortedKeys(m)
	for _, k := range keys {
		lk := strings.ToLower(k)
		for _, sub := range substrs {
			if strings.Contains(lk, sub) {
				return k, m[k], true
			}
		}
	}
	if len(keys) > 0 {
		return keys[0], m[keys[0]], true
	}
	return "", "", false
}

func seedPromotions(s *seeder, c *Ctx) (int, int, error) {
	_, burgerID, haveBurger := findLike(c.Items, "burger")
	_, dessertID, haveDessert := findLike(c.Items, "dessert", "cake", "tart", "ice cream", "malva")
	_, cocktailCatID, haveCocktailCat := findLike(c.Categories, "cocktail", "bar", "drink", "beverage")

	type promoSpec struct {
		name            string
		description     string
		promoType       string
		scope           string
		percentOff      interface{}
		fixedOffCents   interface{}
		hhPriceCents    interface{}
		bogoBuyQty      int
		bogoGetQty      int
		bogoDiscPct     float64
		freeItemID      interface{}
		minSpend        int64 // already in minor units
		maxDiscount     interface{}
		requiresCoupon  bool
		dayparts        interface{}
		fromDaysAgo     int
		untilDaysAhead  int
		usageLimitTotal interface{}
		usagePerCust    int
		priority        int
		targetItemID    string
		targetCatID     string
	}

	// Promotion copy quotes real thresholds, so the amounts are formatted from
	// the same values the columns get rather than typed into the string. The
	// originals read "Free Delivery over R350": a currency symbol and a
	// rand-denominated number welded into a name, which would still say R350
	// after SEED_CURRENCY changed and the threshold column had become 350 yen.
	freeDeliveryOver := s.cfg.Price(35000)
	freeDessertOver := s.cfg.Price(45000)
	midweekOff := s.cfg.Price(5000)
	midweekOver := s.cfg.Price(15000)

	specs := []promoSpec{
		{
			name: "Winter Special 15% Off", description: "15% off your whole order — winter warmer.",
			promoType: "percent_off", scope: "order", percentOff: 15.0,
			minSpend: s.cfg.Price(25000), maxDiscount: s.cfg.Price(20000),
			requiresCoupon: true, fromDaysAgo: 20, untilDaysAhead: 40,
			usageLimitTotal: 500, usagePerCust: 2, priority: 10,
		},
		{
			name: "Happy Hour Cocktails", description: "Discounted cocktail pricing, weekdays 16:00-18:30.",
			promoType: "happy_hour_price", scope: "category", hhPriceCents: s.cfg.Price(6500),
			dayparts:    `{"days":[1,2,3,4,5],"start":"16:00","end":"18:30"}`,
			fromDaysAgo: 60, untilDaysAhead: 180, usagePerCust: 10, priority: 5,
			targetCatID: cocktailCatIDIf(haveCocktailCat, cocktailCatID),
		},
		{
			name: "2-for-1 Burgers", description: "Buy one burger, get one free — Tuesdays.",
			promoType: "bogo", scope: "item", bogoBuyQty: 1, bogoGetQty: 1, bogoDiscPct: 100,
			fromDaysAgo: 30, untilDaysAhead: 90, usagePerCust: 1, priority: 8,
			targetItemID: burgerIDIf(haveBurger, burgerID),
		},
		{
			name:        fmt.Sprintf("Free Delivery over %s", s.cfg.Format(freeDeliveryOver)),
			description: fmt.Sprintf("Free delivery on orders over %s.", s.cfg.Format(freeDeliveryOver)),
			promoType:   "free_delivery", scope: "delivery", minSpend: freeDeliveryOver,
			fromDaysAgo: 90, untilDaysAhead: 365, usagePerCust: 10, priority: 3,
		},
		{
			name:        "Family Feast Free Dessert",
			description: fmt.Sprintf("Free dessert when you spend over %s.", s.cfg.Format(freeDessertOver)),
			promoType:   "free_item", scope: "order", minSpend: freeDessertOver,
			freeItemID:  dessertIDIf(haveDessert, dessertID),
			fromDaysAgo: 15, untilDaysAhead: 45, usagePerCust: 1, priority: 6,
		},
		{
			name: fmt.Sprintf("Midweek %s Off", s.cfg.Format(midweekOff)),
			description: fmt.Sprintf("%s off orders over %s, Wed only.",
				s.cfg.Format(midweekOff), s.cfg.Format(midweekOver)),
			promoType: "fixed_off", scope: "order", fixedOffCents: midweekOff,
			minSpend: midweekOver, requiresCoupon: true,
			fromDaysAgo: 10, untilDaysAhead: 50, usageLimitTotal: 200, usagePerCust: 1, priority: 4,
		},
	}

	promoIDs := make(map[string]string, len(specs))
	err := s.tx(func(tx pgx.Tx) error {
		for _, sp := range specs {
			activeFrom := c.Now.AddDate(0, 0, -sp.fromDaysAgo)
			activeUntil := c.Now.AddDate(0, 0, sp.untilDaysAhead)

			var promoID string
			if err := tx.QueryRow(s.ctx, `
				INSERT INTO promotions (
					organization_id, location_id, name, description, promo_type, scope,
					percent_off, fixed_off_cents, happy_hour_price_cents,
					bogo_buy_qty, bogo_get_qty, bogo_get_discount_percent, free_item_id,
					min_spend_cents, max_discount_cents, stackable, requires_coupon_code,
					active_from, active_until, dayparts, customer_segment,
					usage_limit_total, usage_limit_per_customer, is_active, priority, created_by
				) VALUES (
					$1,$2,$3,$4,$5,$6,
					$7,$8,$9,
					$10,$11,$12,$13,
					$14,$15,false,$16,
					$17,$18,$19::jsonb,'all',
					$20,$21,true,$22,$23
				) RETURNING id
			`, c.OrgID, c.LocID, sp.name, sp.description, sp.promoType, sp.scope,
				sp.percentOff, sp.fixedOffCents, sp.hhPriceCents,
				maxInt(sp.bogoBuyQty, 1), maxInt(sp.bogoGetQty, 1), sp.bogoDiscPct, sp.freeItemID,
				sp.minSpend, sp.maxDiscount, sp.requiresCoupon,
				activeFrom, activeUntil, sp.dayparts,
				sp.usageLimitTotal, sp.usagePerCust, sp.priority, c.OwnerProfileID,
			).Scan(&promoID); err != nil {
				return fmt.Errorf("insert promotion %s: %w", sp.name, err)
			}
			promoIDs[sp.name] = promoID

			if sp.targetItemID != "" {
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO promotion_target_items (promotion_id, item_id) VALUES ($1,$2)
					ON CONFLICT (promotion_id, item_id) DO NOTHING
				`, promoID, sp.targetItemID); err != nil {
					return fmt.Errorf("promotion target item %s: %w", sp.name, err)
				}
			}
			if sp.targetCatID != "" {
				if _, err := tx.Exec(s.ctx, `
					INSERT INTO promotion_target_categories (promotion_id, category_id) VALUES ($1,$2)
					ON CONFLICT (promotion_id, category_id) DO NOTHING
				`, promoID, sp.targetCatID); err != nil {
					return fmt.Errorf("promotion target category %s: %w", sp.name, err)
				}
			}
		}

		// Coupon codes on the two coupon-gated promotions.
		coupons := []struct {
			code      string
			promoName string
			maxUses   int
			used      int
			fromDays  int
			untilDays int
		}{
			{"WELCOME10", "Winter Special 15% Off", 500, 87, 20, 40},
			{"FAMFEAST", "Family Feast Free Dessert", 100, 12, 15, 45},
		}
		for _, cp := range coupons {
			promoID, ok := promoIDs[cp.promoName]
			if !ok {
				continue
			}
			activeFrom := c.Now.AddDate(0, 0, -cp.fromDays)
			activeUntil := c.Now.AddDate(0, 0, cp.untilDays)
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO coupon_codes (promotion_id, code, max_uses, used_count, active_from, active_until)
				VALUES ($1,$2,$3,$4,$5,$6)
			`, promoID, cp.code, cp.maxUses, cp.used, activeFrom, activeUntil); err != nil {
				return fmt.Errorf("coupon code %s: %w", cp.code, err)
			}
		}
		return nil
	})
	if err != nil {
		return 0, 0, err
	}
	return len(specs), 2, nil
}

func maxInt(v, min int) int {
	if v < min {
		return min
	}
	return v
}

func burgerIDIf(have bool, id string) string {
	if have {
		return id
	}
	return ""
}

func dessertIDIf(have bool, id string) interface{} {
	if have {
		return id
	}
	return nil
}

func cocktailCatIDIf(have bool, id string) string {
	if have {
		return id
	}
	return ""
}

// ---------------------------------------------------------------------------
// Loyalty program
// ---------------------------------------------------------------------------

func seedLoyalty(s *seeder, c *Ctx, custAt func(int) *CustomerRef, staffID *string) (int, int, error) {
	txCount, stampCount := 0, 0
	err := s.tx(func(tx pgx.Tx) error {
		if _, err := tx.Exec(s.ctx, `
			INSERT INTO loyalty_config (
				organization_id, points_per_currency_unit, min_redemption_points,
				max_redemption_pct_of_order, points_expiry_months, is_active,
				stamps_enabled, stamps_required
			) VALUES ($1,1.0,100,50,12,true,true,10)
			ON CONFLICT (organization_id) DO NOTHING
		`, c.OrgID); err != nil {
			return fmt.Errorf("loyalty config: %w", err)
		}

		n := 15
		if len(c.Customers) < n {
			n = len(c.Customers)
		}
		for i := 0; i < n; i++ {
			cr := custAt(i)
			if cr == nil {
				continue
			}

			earnPoints := 40 + (i*37)%180
			earnAt := c.Now.AddDate(0, 0, -(10 + i*4))
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO loyalty_transactions (
					customer_id, organization_id, txn_type, points, balance_after,
					performed_by_staff_id, notes, created_at
				) VALUES ($1,$2,'earn',$3,$3,$4,'Points earned on order',$5)
			`, cr.ID, c.OrgID, earnPoints, staffID, earnAt); err != nil {
				return fmt.Errorf("loyalty earn txn: %w", err)
			}
			txCount++

			balance := earnPoints
			if i%3 == 0 {
				redeemPoints := earnPoints / 2
				if redeemPoints > 0 {
					balance -= redeemPoints
					redeemAt := earnAt.AddDate(0, 0, 5)
					if _, err := tx.Exec(s.ctx, `
						INSERT INTO loyalty_transactions (
							customer_id, organization_id, txn_type, points, balance_after,
							performed_by_staff_id, notes, created_at
						) VALUES ($1,$2,'redeem',$3,$4,$5,'Points redeemed for discount',$6)
					`, cr.ID, c.OrgID, redeemPoints, balance, staffID, redeemAt); err != nil {
						return fmt.Errorf("loyalty redeem txn: %w", err)
					}
					txCount++
				}
			}

			stamps := (i * 3) % 10
			if _, err := tx.Exec(s.ctx, `
				INSERT INTO customer_loyalty_stamps (organization_id, customer_id, location_id, stamps, updated_at)
				VALUES ($1,$2,$3,$4,$5)
				ON CONFLICT (organization_id, customer_id, location_id) DO NOTHING
			`, c.OrgID, cr.ID, c.LocID, stamps, c.Now.AddDate(0, 0, -i)); err != nil {
				return fmt.Errorf("loyalty stamps: %w", err)
			}
			stampCount++
		}
		return nil
	})
	if err != nil {
		return 0, 0, err
	}
	return txCount, stampCount, nil
}
