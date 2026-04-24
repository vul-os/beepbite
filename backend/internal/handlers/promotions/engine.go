// Package promotions implements the promotion matching & discount
// computation engine for BeepBite's POS backend. See Engine.Apply.
package promotions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Engine is the entry point for promotion matching and persistence.
type Engine struct {
	pool *pgxpool.Pool
}

func NewEngine(pool *pgxpool.Pool) *Engine {
	return &Engine{pool: pool}
}

// ---------- Public DTOs ----------

type ApplyResult struct {
	Redemptions        []RedemptionOut `json:"redemptions"`
	TotalDiscountCents int64           `json:"total_discount_cents"`
}

type RedemptionOut struct {
	PromotionID      string            `json:"promotion_id"`
	PromotionName    string            `json:"promotion_name"`
	CouponCodeID     *string           `json:"coupon_code_id,omitempty"`
	DiscountCents    int64             `json:"discount_cents"`
	LineAttributions []LineAttribution `json:"line_attributions"`
}

type LineAttribution struct {
	OrderItemID   string `json:"order_item_id"`
	DiscountCents int64  `json:"discount_cents"`
}

// ---------- Internal structs (engine data model in cents) ----------

type orderCtx struct {
	OrderID        string
	LocationID     string
	OrganizationID string
	CustomerID     *string
	Items          []orderLine
	SubtotalCents  int64
	// HasDelivery is used by free_delivery — derived from order_type.
	HasDelivery bool
}

type orderLine struct {
	OrderItemID    string
	ItemID         string
	CategoryID     string
	Quantity       int64
	UnitPriceCents int64
	TotalCents     int64 // already quantity * unit_price
}

type promoCandidate struct {
	ID                     string
	Name                   string
	PromoType              string
	Scope                  string
	PercentOff             *float64
	FixedOffCents          *int64
	HappyHourPriceCents    *int64
	BogoBuyQty             int
	BogoGetQty             int
	BogoGetDiscountPercent float64
	FreeItemID             *string
	MinSpendCents          int64
	MaxDiscountCents       *int64
	Stackable              bool
	RequiresCouponCode     bool
	ActiveFrom             *time.Time
	ActiveUntil            *time.Time
	Dayparts               []daypart
	CustomerSegment        string
	UsageLimitTotal        *int
	UsageLimitPerCustomer  *int
	Priority               int

	// Eligible target sets (loaded separately)
	TargetItemIDs      map[string]struct{}
	TargetCategoryIDs  map[string]struct{}

	// Optional: coupon that unlocked this promo (if requires_coupon_code).
	CouponCodeID *string
}

type daypart struct {
	Day   string // "mon","tue",...
	From  string // "HH:MM"
	Until string // "HH:MM"
}

type plannedRedemption struct {
	Promo            *promoCandidate
	DiscountCents    int64
	LineAttributions []LineAttribution
}

// ---------- Apply: top-level orchestration ----------

// Apply loads order + candidates, runs match(), and persists in one tx.
func (e *Engine) Apply(ctx context.Context, orderID string, couponCodes []string) (*ApplyResult, error) {
	oc, err := e.loadOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}

	cands, err := e.loadCandidates(ctx, oc, couponCodes)
	if err != nil {
		return nil, err
	}

	plan, err := e.match(ctx, oc, cands)
	if err != nil {
		return nil, err
	}

	res, err := e.persist(ctx, oc, plan)
	if err != nil {
		return nil, err
	}
	return res, nil
}

// ---------- Loaders ----------

func (e *Engine) loadOrder(ctx context.Context, orderID string) (*orderCtx, error) {
	var oc orderCtx
	oc.OrderID = orderID
	var orderType string
	// customer_id is nullable in practice even though schema says NOT NULL
	// (older orders / staff-entered orders may lack one).
	var custID *string
	if err := e.pool.QueryRow(ctx, `
SELECT o.location_id::text, l.organization_id::text, o.customer_id::text, o.order_type
FROM orders o
JOIN locations l ON l.id = o.location_id
WHERE o.id = $1
`, orderID).Scan(&oc.LocationID, &oc.OrganizationID, &custID, &orderType); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNoOrder
		}
		return nil, fmt.Errorf("load order: %w", err)
	}
	oc.CustomerID = custID
	oc.HasDelivery = orderType == "delivery"

	rows, err := e.pool.Query(ctx, `
SELECT oi.id::text,
       oi.item_id::text,
       i.category_id::text,
       oi.quantity,
       oi.unit_price::text,
       oi.total_price::text
FROM order_items oi
JOIN items i ON i.id = oi.item_id
WHERE oi.order_id = $1
`, orderID)
	if err != nil {
		return nil, fmt.Errorf("load order_items: %w", err)
	}
	defer rows.Close()

	var subtotal int64
	for rows.Next() {
		var l orderLine
		var qty int
		var unitPriceStr, totalStr string
		if err := rows.Scan(&l.OrderItemID, &l.ItemID, &l.CategoryID, &qty, &unitPriceStr, &totalStr); err != nil {
			return nil, err
		}
		l.Quantity = int64(qty)
		l.UnitPriceCents = decimalStrToCents(unitPriceStr)
		l.TotalCents = decimalStrToCents(totalStr)
		subtotal += l.TotalCents
		oc.Items = append(oc.Items, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	oc.SubtotalCents = subtotal
	return &oc, nil
}

// loadCandidates returns active promos for the org/location plus any
// coupon-gated promos unlocked by the provided codes.
func (e *Engine) loadCandidates(ctx context.Context, oc *orderCtx, couponCodes []string) ([]*promoCandidate, error) {
	// Auto-applied promos (requires_coupon_code = false).
	autoRows, err := e.pool.Query(ctx, `
SELECT id::text, name, promo_type, scope,
       percent_off::text,
       fixed_off_cents, happy_hour_price_cents,
       COALESCE(bogo_buy_qty,1), COALESCE(bogo_get_qty,1),
       COALESCE(bogo_get_discount_percent,100)::text,
       free_item_id::text,
       COALESCE(min_spend_cents,0), max_discount_cents,
       stackable, requires_coupon_code,
       active_from, active_until,
       dayparts, customer_segment,
       usage_limit_total, usage_limit_per_customer,
       priority
FROM promotions
WHERE is_active = true
  AND requires_coupon_code = false
  AND organization_id = $1
  AND (location_id IS NULL OR location_id = $2)
  AND (active_from IS NULL OR active_from <= now())
  AND (active_until IS NULL OR active_until >= now())
`, oc.OrganizationID, oc.LocationID)
	if err != nil {
		return nil, fmt.Errorf("load auto promos: %w", err)
	}
	defer autoRows.Close()

	var cands []*promoCandidate
	for autoRows.Next() {
		c, err := scanCandidate(autoRows)
		if err != nil {
			return nil, err
		}
		cands = append(cands, c)
	}
	if err := autoRows.Err(); err != nil {
		return nil, err
	}

	// Coupon-gated promos.
	if len(couponCodes) > 0 {
		lower := make([]string, 0, len(couponCodes))
		for _, c := range couponCodes {
			s := strings.TrimSpace(strings.ToLower(c))
			if s != "" {
				lower = append(lower, s)
			}
		}
		if len(lower) > 0 {
			// customer_id may be nil; use $3 for that (a NULL match allows
			// codes assigned_to_customer_id IS NULL only).
			var custArg any
			if oc.CustomerID != nil {
				custArg = *oc.CustomerID
			} else {
				custArg = nil
			}
			cRows, err := e.pool.Query(ctx, `
SELECT p.id::text, p.name, p.promo_type, p.scope,
       p.percent_off::text,
       p.fixed_off_cents, p.happy_hour_price_cents,
       COALESCE(p.bogo_buy_qty,1), COALESCE(p.bogo_get_qty,1),
       COALESCE(p.bogo_get_discount_percent,100)::text,
       p.free_item_id::text,
       COALESCE(p.min_spend_cents,0), p.max_discount_cents,
       p.stackable, p.requires_coupon_code,
       p.active_from, p.active_until,
       p.dayparts, p.customer_segment,
       p.usage_limit_total, p.usage_limit_per_customer,
       p.priority,
       cc.id::text
FROM promotions p
JOIN coupon_codes cc ON cc.promotion_id = p.id
WHERE p.is_active = true
  AND p.requires_coupon_code = true
  AND p.organization_id = $1
  AND (p.location_id IS NULL OR p.location_id = $2)
  AND (p.active_from IS NULL OR p.active_from <= now())
  AND (p.active_until IS NULL OR p.active_until >= now())
  AND cc.is_active = true
  AND (cc.active_from IS NULL OR cc.active_from <= now())
  AND (cc.active_until IS NULL OR cc.active_until >= now())
  AND cc.used_count < COALESCE(cc.max_uses, 1)
  AND (cc.assigned_to_customer_id IS NULL OR cc.assigned_to_customer_id = $3)
  AND lower(cc.code) = ANY($4)
`, oc.OrganizationID, oc.LocationID, custArg, lower)
			if err != nil {
				return nil, fmt.Errorf("load coupon promos: %w", err)
			}
			defer cRows.Close()
			for cRows.Next() {
				c, err := scanCandidateWithCoupon(cRows)
				if err != nil {
					return nil, err
				}
				cands = append(cands, c)
			}
			if err := cRows.Err(); err != nil {
				return nil, err
			}
		}
	}

	// Load targets for each promo.
	for _, c := range cands {
		if c.Scope == "item" {
			c.TargetItemIDs = make(map[string]struct{})
			rows, err := e.pool.Query(ctx, `SELECT item_id::text FROM promotion_target_items WHERE promotion_id = $1`, c.ID)
			if err != nil {
				return nil, err
			}
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					rows.Close()
					return nil, err
				}
				c.TargetItemIDs[id] = struct{}{}
			}
			rows.Close()
		}
		if c.Scope == "category" {
			c.TargetCategoryIDs = make(map[string]struct{})
			rows, err := e.pool.Query(ctx, `SELECT category_id::text FROM promotion_target_categories WHERE promotion_id = $1`, c.ID)
			if err != nil {
				return nil, err
			}
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					rows.Close()
					return nil, err
				}
				c.TargetCategoryIDs[id] = struct{}{}
			}
			rows.Close()
		}
		// BOGO also uses target_items when scope='item'.
		if c.PromoType == "bogo" && c.TargetItemIDs == nil {
			c.TargetItemIDs = make(map[string]struct{})
			rows, err := e.pool.Query(ctx, `SELECT item_id::text FROM promotion_target_items WHERE promotion_id = $1`, c.ID)
			if err != nil {
				return nil, err
			}
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					rows.Close()
					return nil, err
				}
				c.TargetItemIDs[id] = struct{}{}
			}
			rows.Close()
		}
	}
	return cands, nil
}

// scanCandidate reads an auto-applied promo row (no coupon_code_id).
func scanCandidate(r pgx.Rows) (*promoCandidate, error) {
	c := &promoCandidate{}
	var percentOffStr string
	var fixedOffCents, happyHourCents *int64
	var bogoDiscPercentStr string
	var freeItemID *string
	var maxDiscount *int64
	var activeFrom, activeUntil *time.Time
	var daypartsRaw []byte
	var usageTotal, usagePer *int
	if err := r.Scan(
		&c.ID, &c.Name, &c.PromoType, &c.Scope,
		&percentOffStr,
		&fixedOffCents, &happyHourCents,
		&c.BogoBuyQty, &c.BogoGetQty,
		&bogoDiscPercentStr,
		&freeItemID,
		&c.MinSpendCents, &maxDiscount,
		&c.Stackable, &c.RequiresCouponCode,
		&activeFrom, &activeUntil,
		&daypartsRaw, &c.CustomerSegment,
		&usageTotal, &usagePer,
		&c.Priority,
	); err != nil {
		return nil, err
	}
	return finalizeCandidate(c, percentOffStr, fixedOffCents, happyHourCents, bogoDiscPercentStr, freeItemID, maxDiscount, activeFrom, activeUntil, daypartsRaw, usageTotal, usagePer, nil)
}

func scanCandidateWithCoupon(r pgx.Rows) (*promoCandidate, error) {
	c := &promoCandidate{}
	var percentOffStr string
	var fixedOffCents, happyHourCents *int64
	var bogoDiscPercentStr string
	var freeItemID *string
	var maxDiscount *int64
	var activeFrom, activeUntil *time.Time
	var daypartsRaw []byte
	var usageTotal, usagePer *int
	var couponID string
	if err := r.Scan(
		&c.ID, &c.Name, &c.PromoType, &c.Scope,
		&percentOffStr,
		&fixedOffCents, &happyHourCents,
		&c.BogoBuyQty, &c.BogoGetQty,
		&bogoDiscPercentStr,
		&freeItemID,
		&c.MinSpendCents, &maxDiscount,
		&c.Stackable, &c.RequiresCouponCode,
		&activeFrom, &activeUntil,
		&daypartsRaw, &c.CustomerSegment,
		&usageTotal, &usagePer,
		&c.Priority,
		&couponID,
	); err != nil {
		return nil, err
	}
	cid := couponID
	return finalizeCandidate(c, percentOffStr, fixedOffCents, happyHourCents, bogoDiscPercentStr, freeItemID, maxDiscount, activeFrom, activeUntil, daypartsRaw, usageTotal, usagePer, &cid)
}

func finalizeCandidate(
	c *promoCandidate,
	percentOffStr string,
	fixedOffCents, happyHourCents *int64,
	bogoDiscPercentStr string,
	freeItemID *string,
	maxDiscount *int64,
	activeFrom, activeUntil *time.Time,
	daypartsRaw []byte,
	usageTotal, usagePer *int,
	couponID *string,
) (*promoCandidate, error) {
	if percentOffStr != "" {
		if f, err := strconv.ParseFloat(percentOffStr, 64); err == nil {
			c.PercentOff = &f
		}
	}
	c.FixedOffCents = fixedOffCents
	c.HappyHourPriceCents = happyHourCents
	if bogoDiscPercentStr != "" {
		if f, err := strconv.ParseFloat(bogoDiscPercentStr, 64); err == nil {
			c.BogoGetDiscountPercent = f
		} else {
			c.BogoGetDiscountPercent = 100
		}
	} else {
		c.BogoGetDiscountPercent = 100
	}
	c.FreeItemID = freeItemID
	c.MaxDiscountCents = maxDiscount
	c.ActiveFrom = activeFrom
	c.ActiveUntil = activeUntil
	if len(daypartsRaw) > 0 && string(daypartsRaw) != "null" {
		var parts []daypart
		if err := json.Unmarshal(daypartsRaw, &parts); err == nil {
			c.Dayparts = parts
		}
	}
	c.UsageLimitTotal = usageTotal
	c.UsageLimitPerCustomer = usagePer
	c.CouponCodeID = couponID
	return c, nil
}

// ---------- Matching ----------

func (e *Engine) match(ctx context.Context, oc *orderCtx, cands []*promoCandidate) ([]plannedRedemption, error) {
	var planned []plannedRedemption

	for _, c := range cands {
		ok, err := e.isEligible(ctx, oc, c)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		disc, attrs := computeDiscount(oc, c)
		if disc <= 0 && c.PromoType != "free_delivery" {
			continue
		}
		planned = append(planned, plannedRedemption{
			Promo:            c,
			DiscountCents:    disc,
			LineAttributions: attrs,
		})
	}

	// Stacking: stackable first (DESC so true>false), then priority DESC, then
	// biggest discount DESC. Apply all stackables; only the first non-stackable.
	sort.Slice(planned, func(i, j int) bool {
		a, b := planned[i], planned[j]
		if a.Promo.Stackable != b.Promo.Stackable {
			return a.Promo.Stackable && !b.Promo.Stackable
		}
		if a.Promo.Priority != b.Promo.Priority {
			return a.Promo.Priority > b.Promo.Priority
		}
		return a.DiscountCents > b.DiscountCents
	})

	final := make([]plannedRedemption, 0, len(planned))
	nonStackableTaken := false
	for _, p := range planned {
		if !p.Promo.Stackable {
			if nonStackableTaken {
				continue
			}
			nonStackableTaken = true
		}
		final = append(final, p)
	}
	return final, nil
}

// isEligible runs all the non-compute checks: daypart, min spend, segment,
// usage caps, and per-order idempotency.
func (e *Engine) isEligible(ctx context.Context, oc *orderCtx, c *promoCandidate) (bool, error) {
	// Daypart check.
	// TODO: use the location's timezone; currently UTC-only.
	if len(c.Dayparts) > 0 && !matchesDaypart(c.Dayparts, time.Now().UTC()) {
		return false, nil
	}

	if oc.SubtotalCents < c.MinSpendCents {
		return false, nil
	}

	// Customer segment.
	if c.CustomerSegment != "" && c.CustomerSegment != "all" {
		// TODO: query customer stats to evaluate 'first_time','vip','lapsed'.
		// For now, only allow non-'all' promos if the unlock happened via a
		// coupon explicitly assigned to this customer (checked via CouponCodeID).
		if c.CouponCodeID == nil {
			return false, nil
		}
	}

	// Per-order idempotency.
	var n int
	if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM promotion_redemptions WHERE promotion_id = $1 AND order_id = $2`, c.ID, oc.OrderID).Scan(&n); err != nil {
		return false, err
	}
	if n >= 1 {
		return false, nil
	}

	if c.UsageLimitTotal != nil {
		var t int
		if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM promotion_redemptions WHERE promotion_id = $1`, c.ID).Scan(&t); err != nil {
			return false, err
		}
		if t >= *c.UsageLimitTotal {
			return false, nil
		}
	}
	if c.UsageLimitPerCustomer != nil && oc.CustomerID != nil {
		var t int
		if err := e.pool.QueryRow(ctx, `SELECT count(*) FROM promotion_redemptions WHERE promotion_id = $1 AND customer_id = $2`, c.ID, *oc.CustomerID).Scan(&t); err != nil {
			return false, err
		}
		if t >= *c.UsageLimitPerCustomer {
			return false, nil
		}
	}
	return true, nil
}

func matchesDaypart(parts []daypart, now time.Time) bool {
	dowMap := [...]string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
	today := dowMap[int(now.Weekday())]
	nowMins := now.Hour()*60 + now.Minute()
	for _, p := range parts {
		if !strings.EqualFold(p.Day, today) {
			continue
		}
		fromM, ok1 := parseHM(p.From)
		untilM, ok2 := parseHM(p.Until)
		if !ok1 || !ok2 {
			continue
		}
		if nowMins >= fromM && nowMins <= untilM {
			return true
		}
	}
	return false
}

func parseHM(s string) (int, bool) {
	parts := strings.SplitN(s, ":", 2)
	if len(parts) != 2 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil {
		return 0, false
	}
	return h*60 + m, true
}

// ---------- Computation ----------

// computeDiscount returns the discount in cents and per-line attribution.
func computeDiscount(oc *orderCtx, c *promoCandidate) (int64, []LineAttribution) {
	switch c.PromoType {
	case "percent_off":
		return computePercentOff(oc, c)
	case "fixed_off":
		return computeFixedOff(oc, c)
	case "happy_hour_price":
		return computeHappyHour(oc, c)
	case "bogo":
		return computeBogo(oc, c)
	case "free_item":
		return computeFreeItem(oc, c)
	case "free_delivery":
		// TODO: integrate delivery_fee_cents from order_financial_details.
		// We record a zero-cent redemption only when the order is delivery.
		if oc.HasDelivery {
			return 0, nil
		}
		return -1, nil // negative to signal "not applicable"
	}
	return 0, nil
}

func eligibleLines(oc *orderCtx, c *promoCandidate) []orderLine {
	switch c.Scope {
	case "order", "delivery":
		return oc.Items
	case "item":
		var out []orderLine
		for _, l := range oc.Items {
			if _, ok := c.TargetItemIDs[l.ItemID]; ok {
				out = append(out, l)
			}
		}
		return out
	case "category":
		var out []orderLine
		for _, l := range oc.Items {
			if _, ok := c.TargetCategoryIDs[l.CategoryID]; ok {
				out = append(out, l)
			}
		}
		return out
	}
	return oc.Items
}

func sumLines(lines []orderLine) int64 {
	var s int64
	for _, l := range lines {
		s += l.TotalCents
	}
	return s
}

// proRataSpread distributes a total discount across lines proportional to
// line totals, fixing rounding drift on the last line.
func proRataSpread(lines []orderLine, totalDiscount int64) []LineAttribution {
	if totalDiscount <= 0 || len(lines) == 0 {
		return nil
	}
	base := sumLines(lines)
	if base <= 0 {
		return nil
	}
	out := make([]LineAttribution, 0, len(lines))
	var allocated int64
	for i, l := range lines {
		var share int64
		if i == len(lines)-1 {
			share = totalDiscount - allocated
		} else {
			share = int64(math.Round(float64(totalDiscount) * float64(l.TotalCents) / float64(base)))
			if share > totalDiscount-allocated {
				share = totalDiscount - allocated
			}
			allocated += share
		}
		if share > 0 {
			out = append(out, LineAttribution{OrderItemID: l.OrderItemID, DiscountCents: share})
		}
	}
	return out
}

func computePercentOff(oc *orderCtx, c *promoCandidate) (int64, []LineAttribution) {
	if c.PercentOff == nil {
		return 0, nil
	}
	lines := eligibleLines(oc, c)
	base := sumLines(lines)
	if base <= 0 {
		return 0, nil
	}
	disc := int64(math.Round(float64(base) * *c.PercentOff / 100))
	if c.MaxDiscountCents != nil && disc > *c.MaxDiscountCents {
		disc = *c.MaxDiscountCents
	}
	return disc, proRataSpread(lines, disc)
}

func computeFixedOff(oc *orderCtx, c *promoCandidate) (int64, []LineAttribution) {
	if c.FixedOffCents == nil {
		return 0, nil
	}
	lines := eligibleLines(oc, c)
	base := sumLines(lines)
	if base <= 0 {
		return 0, nil
	}
	disc := *c.FixedOffCents
	if disc > base {
		disc = base
	}
	if c.MaxDiscountCents != nil && disc > *c.MaxDiscountCents {
		disc = *c.MaxDiscountCents
	}
	return disc, proRataSpread(lines, disc)
}

func computeHappyHour(oc *orderCtx, c *promoCandidate) (int64, []LineAttribution) {
	if c.HappyHourPriceCents == nil {
		return 0, nil
	}
	lines := eligibleLines(oc, c)
	var total int64
	attrs := make([]LineAttribution, 0, len(lines))
	for _, l := range lines {
		diff := l.UnitPriceCents - *c.HappyHourPriceCents
		if diff <= 0 {
			continue
		}
		lineDisc := diff * l.Quantity
		total += lineDisc
		attrs = append(attrs, LineAttribution{OrderItemID: l.OrderItemID, DiscountCents: lineDisc})
	}
	if c.MaxDiscountCents != nil && total > *c.MaxDiscountCents {
		// scale attributions down proportionally
		cap := *c.MaxDiscountCents
		attrs = scaleAttributions(attrs, total, cap)
		total = cap
	}
	return total, attrs
}

func scaleAttributions(attrs []LineAttribution, oldTotal, newTotal int64) []LineAttribution {
	if oldTotal <= 0 {
		return nil
	}
	out := make([]LineAttribution, 0, len(attrs))
	var allocated int64
	for i, a := range attrs {
		var share int64
		if i == len(attrs)-1 {
			share = newTotal - allocated
		} else {
			share = int64(math.Round(float64(a.DiscountCents) * float64(newTotal) / float64(oldTotal)))
			allocated += share
		}
		if share > 0 {
			out = append(out, LineAttribution{OrderItemID: a.OrderItemID, DiscountCents: share})
		}
	}
	return out
}

// computeBogo: simplest pairing — find the cheapest eligible unit and
// discount bogo_get_qty of them at bogo_get_discount_percent.
// TODO: proper BOGO would require a buy-N-get-M matrix across all eligible
// units with correct quantity accounting; this takes the single cheapest line.
func computeBogo(oc *orderCtx, c *promoCandidate) (int64, []LineAttribution) {
	lines := eligibleLines(oc, c)
	if len(lines) == 0 {
		return 0, nil
	}
	// Total eligible qty must exceed buy_qty for a "get" to apply.
	var totalQty int64
	for _, l := range lines {
		totalQty += l.Quantity
	}
	if totalQty <= int64(c.BogoBuyQty) {
		return 0, nil
	}
	// Pick cheapest line as the "get" line.
	cheapest := lines[0]
	for _, l := range lines[1:] {
		if l.UnitPriceCents < cheapest.UnitPriceCents {
			cheapest = l
		}
	}
	getQty := int64(c.BogoGetQty)
	if getQty > cheapest.Quantity {
		getQty = cheapest.Quantity
	}
	discPerUnit := int64(math.Round(float64(cheapest.UnitPriceCents) * c.BogoGetDiscountPercent / 100))
	total := discPerUnit * getQty
	if c.MaxDiscountCents != nil && total > *c.MaxDiscountCents {
		total = *c.MaxDiscountCents
	}
	return total, []LineAttribution{{OrderItemID: cheapest.OrderItemID, DiscountCents: total}}
}

func computeFreeItem(oc *orderCtx, c *promoCandidate) (int64, []LineAttribution) {
	if c.FreeItemID == nil {
		return 0, nil
	}
	for _, l := range oc.Items {
		if l.ItemID == *c.FreeItemID {
			return l.TotalCents, []LineAttribution{{OrderItemID: l.OrderItemID, DiscountCents: l.TotalCents}}
		}
	}
	return 0, nil
}

// ---------- Helpers ----------

// decimalStrToCents converts a decimal(10,2) string like "12.34" or "12"
// to an int64 cent value. Invalid input returns 0.
func decimalStrToCents(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return int64(math.Round(f * 100))
}

// errNoOrder is returned when an order id can't be loaded. Kept exported-lite
// for handler mapping.
var errNoOrder = errors.New("order not found")
