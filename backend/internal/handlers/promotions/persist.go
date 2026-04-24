package promotions

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// persist writes redemptions + per-line discounts in a single transaction.
// The UNIQUE(promotion_id, order_id) index on promotion_redemptions makes
// Apply idempotent — a retry silently skips already-applied promos.
func (e *Engine) persist(ctx context.Context, oc *orderCtx, plan []plannedRedemption) (*ApplyResult, error) {
	out := &ApplyResult{}
	if len(plan) == 0 {
		return out, nil
	}

	tx, err := e.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	for _, p := range plan {
		// discount_amount_cents must be >= 0 per CHECK constraint;
		// free_delivery can be 0, that's fine.
		disc := p.DiscountCents
		if disc < 0 {
			disc = 0
		}

		var redemptionID string
		err := tx.QueryRow(ctx, `
INSERT INTO promotion_redemptions (promotion_id, coupon_code_id, order_id, customer_id, discount_amount_cents)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (promotion_id, order_id) DO NOTHING
RETURNING id::text
`, p.Promo.ID, p.Promo.CouponCodeID, oc.OrderID, oc.CustomerID, disc).Scan(&redemptionID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// ON CONFLICT DO NOTHING — a redemption already exists.
				continue
			}
			return nil, fmt.Errorf("insert redemption: %w", err)
		}

		for _, la := range p.LineAttributions {
			if la.DiscountCents <= 0 {
				continue
			}
			if _, err := tx.Exec(ctx, `
INSERT INTO order_item_discounts (order_item_id, promotion_redemption_id, discount_amount_cents)
VALUES ($1, $2, $3)
ON CONFLICT (order_item_id, promotion_redemption_id) DO NOTHING
`, la.OrderItemID, redemptionID, la.DiscountCents); err != nil {
				return nil, fmt.Errorf("insert line discount: %w", err)
			}
		}

		if p.Promo.CouponCodeID != nil {
			if _, err := tx.Exec(ctx, `
UPDATE coupon_codes SET used_count = used_count + 1, updated_at = now() WHERE id = $1
`, *p.Promo.CouponCodeID); err != nil {
				return nil, fmt.Errorf("bump coupon used_count: %w", err)
			}
		}

		r := RedemptionOut{
			PromotionID:      p.Promo.ID,
			PromotionName:    p.Promo.Name,
			CouponCodeID:     p.Promo.CouponCodeID,
			DiscountCents:    disc,
			LineAttributions: p.LineAttributions,
		}
		out.Redemptions = append(out.Redemptions, r)
		out.TotalDiscountCents += disc
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}
