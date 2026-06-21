package customersearch

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// CustomerResult is the shape returned by the search endpoint.
// Nullable columns use pointers so JSON emits null rather than zero values.
type CustomerResult struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`  // first_name || ' ' || last_name, or whatsapp_number fallback
	Phone         string     `json:"phone"` // whatsapp_number
	Email         *string    `json:"email"`
	TotalOrders   int        `json:"total_orders"`
	LastOrderDate *time.Time `json:"last_order_date"`
}

// Store holds the connection pool; created by NewStore.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// Search returns up to limit customers for the caller's org whose
// whatsapp_number ILIKE '%q%' OR (first_name || ' ' || last_name) ILIKE '%q%'.
// The query runs inside db.Scoped so Postgres RLS enforces org isolation —
// current_org_id() in the policy matches the scope injected by RequireOrgScope.
func (s *Store) Search(ctx context.Context, q string, limit int) ([]CustomerResult, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	// Trim and build the ILIKE pattern once.
	pattern := "%" + strings.TrimSpace(q) + "%"

	out := []CustomerResult{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT
    id,
    COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), whatsapp_number) AS name,
    whatsapp_number,
    email,
    total_orders,
    last_order_at
FROM customers
WHERE
    (whatsapp_number ILIKE $1 OR
     TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) ILIKE $1)
ORDER BY last_order_at DESC NULLS LAST, created_at DESC
LIMIT $2
`, pattern, limit)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var r CustomerResult
			if err := rows.Scan(
				&r.ID, &r.Name, &r.Phone, &r.Email,
				&r.TotalOrders, &r.LastOrderDate,
			); err != nil {
				return err
			}
			out = append(out, r)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
