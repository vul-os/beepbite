// Package quickcoupon implements one-tap coupon generation from a customer
// detail view. It reuses the existing promotions + coupon_codes tables
// (migration 010) without modifying the promotions package.
package quickcoupon

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrDuplicateCode is returned when the randomly generated code collides with
// an existing one (extremely unlikely; the caller retries once).
var ErrDuplicateCode = errors.New("duplicate coupon code; retry")

// QuickCoupon is the response shape for both POST and GET.
type QuickCoupon struct {
	ID             string     `json:"id"`
	PromotionID    string     `json:"promotion_id"`
	Code           string     `json:"code"`
	PercentOff     *float64   `json:"percent_off"`
	FixedOffCents  *int64     `json:"fixed_off_cents"`
	CustomerID     *string    `json:"customer_id"`
	ExpiresAt      *time.Time `json:"expires_at"`
	IsActive       bool       `json:"is_active"`
	CreatedAt      time.Time  `json:"created_at"`
}

// CreateParams holds validated input for creating a quick coupon.
type CreateParams struct {
	OrgID          string
	CustomerID     *string
	PercentOff     *float64
	FixedOffCents  *int64
	ExpiresInDays  *int
	CreatedBy      *string
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// generateCode returns a code like SAVE<6 random uppercase letters/digits>.
func generateCode() string {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = charset[rand.Intn(len(charset))]
	}
	return "SAVE" + string(b)
}

// Create inserts a promotion row (promo_type=percent_off|fixed_off, scope=order,
// requires_coupon_code=true) and a linked coupon_codes row in a single
// transaction.
func (s *Store) Create(ctx context.Context, p CreateParams) (*QuickCoupon, error) {
	// Try up to 3 times to avoid the (astronomically unlikely) collision.
	for attempt := 0; attempt < 3; attempt++ {
		out, err := s.insertOnce(ctx, p)
		if errors.Is(err, ErrDuplicateCode) {
			continue
		}
		return out, err
	}
	return nil, fmt.Errorf("could not generate unique coupon code after 3 attempts")
}

func (s *Store) insertOnce(ctx context.Context, p CreateParams) (*QuickCoupon, error) {
	code := generateCode()

	// Determine promo_type and discount field.
	promoType := "percent_off"
	if p.FixedOffCents != nil {
		promoType = "fixed_off"
	}

	var expiresAt *time.Time
	if p.ExpiresInDays != nil && *p.ExpiresInDays > 0 {
		t := time.Now().UTC().Add(time.Duration(*p.ExpiresInDays) * 24 * time.Hour)
		expiresAt = &t
	}

	name := fmt.Sprintf("Quick Coupon %s", code)

	var out QuickCoupon
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// 1. Insert the promotion row.
		var promoID string
		err := tx.QueryRow(ctx, `
INSERT INTO promotions (
	organization_id,
	name,
	promo_type,
	scope,
	percent_off,
	fixed_off_cents,
	requires_coupon_code,
	active_from,
	active_until,
	is_active,
	priority,
	created_by
) VALUES (
	$1, $2, $3, 'order', $4, $5, true, now(), $6, true, 0, $7
)
RETURNING id`,
			p.OrgID,
			name,
			promoType,
			nullFloat64(p.PercentOff),
			nullInt64(p.FixedOffCents),
			nullTime(expiresAt),
			nullStr(derefStr(p.CreatedBy)),
		).Scan(&promoID)
		if err != nil {
			return fmt.Errorf("insert promotion: %w", err)
		}

		// 2. Insert the coupon_codes row.
		err = tx.QueryRow(ctx, `
INSERT INTO coupon_codes (
	promotion_id,
	code,
	max_uses,
	assigned_to_customer_id,
	active_from,
	active_until,
	is_active
) VALUES (
	$1, $2, 1, $3, now(), $4, true
)
RETURNING id, promotion_id, code, is_active, active_until, created_at`,
			promoID,
			code,
			nullStr(derefStr(p.CustomerID)),
			nullTime(expiresAt),
		).Scan(
			&out.ID,
			&out.PromotionID,
			&out.Code,
			&out.IsActive,
			&out.ExpiresAt,
			&out.CreatedAt,
		)
		if err != nil {
			// Postgres unique-violation on coupon_codes_code_lower_idx → retry.
			if pgErrCode(err) == "23505" {
				return ErrDuplicateCode
			}
			return fmt.Errorf("insert coupon_code: %w", err)
		}

		out.PercentOff = p.PercentOff
		out.FixedOffCents = p.FixedOffCents
		if p.CustomerID != nil {
			c := *p.CustomerID
			out.CustomerID = &c
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// List returns quick coupons for the org, optionally filtered by customer.
// "Quick" coupons are identified by their name prefix "Quick Coupon ".
func (s *Store) List(ctx context.Context, orgID string, customerID *string) ([]QuickCoupon, error) {
	out := []QuickCoupon{}

	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var args []any
		q := `
SELECT
	cc.id,
	cc.promotion_id,
	cc.code,
	p.percent_off,
	p.fixed_off_cents,
	cc.assigned_to_customer_id,
	cc.active_until,
	cc.is_active,
	cc.created_at
FROM coupon_codes cc
JOIN promotions p ON p.id = cc.promotion_id
WHERE p.organization_id = $1
  AND p.name LIKE 'Quick Coupon %'
`
		args = append(args, orgID)

		if customerID != nil {
			args = append(args, *customerID)
			q += fmt.Sprintf(" AND cc.assigned_to_customer_id = $%d", len(args))
		}
		q += " ORDER BY cc.created_at DESC LIMIT 100"

		rows, err := tx.Query(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var qc QuickCoupon
			if err := rows.Scan(
				&qc.ID,
				&qc.PromotionID,
				&qc.Code,
				&qc.PercentOff,
				&qc.FixedOffCents,
				&qc.CustomerID,
				&qc.ExpiresAt,
				&qc.IsActive,
				&qc.CreatedAt,
			); err != nil {
				return err
			}
			out = append(out, qc)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullFloat64(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func nullInt64(i *int64) any {
	if i == nil {
		return nil
	}
	return *i
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// pgErrCode extracts the Postgres error code from an error if it is a
// *pgconn.PgError, without importing pgconn directly here (duck typing via
// interface).
func pgErrCode(err error) string {
	type coder interface{ SQLState() string }
	var c coder
	if errors.As(err, &c) {
		return c.SQLState()
	}
	return ""
}
