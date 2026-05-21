// Package favorites — store layer for customer favourite items.
// Queries are always org-scoped via db.Scoped so RLS prevents cross-tenant reads.
package favorites

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors surfaced to the HTTP layer for status-code mapping.
var (
	ErrCustomerNotFound = errors.New("customer not found")
	ErrItemNotFound     = errors.New("item not found")
	ErrFavoriteNotFound = errors.New("favorite not found")
)

// FavoriteItem is the shape returned by ListFavorites — the favorite row joined
// with enough item detail to render a quick-add card (name, price, image).
type FavoriteItem struct {
	FavoriteID string     `json:"id"`
	ItemID     string     `json:"item_id"`
	Name       string     `json:"name"`
	PriceCents int64      `json:"price_cents"`
	ImageURL   *string    `json:"image_url"`
	CreatedAt  time.Time  `json:"created_at"`
}

// Store owns the DB pool and executes org-scoped queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore returns a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// CustomerOrgID verifies that the customer exists and belongs to the requesting
// org (enforced by RLS via db.Scoped). Returns ErrCustomerNotFound when absent
// or out of scope.
func (s *Store) CustomerOrgID(ctx context.Context, customerID string) (string, error) {
	var orgID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT organization_id FROM customers WHERE id = $1`, customerID,
		).Scan(&orgID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrCustomerNotFound
	}
	return orgID, err
}

// ListFavorites returns all favourite items for a customer, newest first.
// The join against items pulls name/price/image so callers get a single
// ready-to-render payload.
func (s *Store) ListFavorites(ctx context.Context, customerID string) ([]FavoriteItem, error) {
	out := []FavoriteItem{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT  cf.id,
        cf.item_id,
        i.name,
        ROUND(i.price * 100)::bigint AS price_cents,
        i.image_url,
        cf.created_at
FROM    customer_favorite_items cf
JOIN    items i ON i.id = cf.item_id
WHERE   cf.customer_id = $1
ORDER   BY cf.created_at DESC
`, customerID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var fi FavoriteItem
			if err := rows.Scan(
				&fi.FavoriteID, &fi.ItemID, &fi.Name,
				&fi.PriceCents, &fi.ImageURL, &fi.CreatedAt,
			); err != nil {
				return err
			}
			out = append(out, fi)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// AddFavorite inserts a favorite row for (orgID, customerID, itemID).
// Idempotent: a UNIQUE constraint on (organization_id, customer_id, item_id)
// combined with ON CONFLICT DO NOTHING means repeated calls are safe.
// Returns ErrItemNotFound when the item does not exist in this org's scope.
func (s *Store) AddFavorite(ctx context.Context, orgID, customerID, itemID string) (*FavoriteItem, error) {
	var fi FavoriteItem
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Verify item exists and is visible to this org (RLS on items).
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM items WHERE id = $1)`, itemID,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrItemNotFound
		}

		err := tx.QueryRow(ctx, `
INSERT INTO customer_favorite_items (organization_id, customer_id, item_id)
VALUES ($1, $2, $3)
ON CONFLICT (organization_id, customer_id, item_id) DO NOTHING
RETURNING id, item_id, created_at
`, orgID, customerID, itemID).Scan(&fi.FavoriteID, &fi.ItemID, &fi.CreatedAt)
		if err != nil {
			// ON CONFLICT DO NOTHING returns no rows when a conflict fires.
			if errors.Is(err, pgx.ErrNoRows) {
				// Already exists — fetch the existing row so we return something useful.
				return tx.QueryRow(ctx, `
SELECT id, item_id, created_at
FROM   customer_favorite_items
WHERE  organization_id = $1 AND customer_id = $2 AND item_id = $3
`, orgID, customerID, itemID).Scan(&fi.FavoriteID, &fi.ItemID, &fi.CreatedAt)
			}
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == "23503" {
				// FK violation — item doesn't exist at all.
				return ErrItemNotFound
			}
			return err
		}

		// Enrich with item details.
		return tx.QueryRow(ctx, `
SELECT name, ROUND(price * 100)::bigint, image_url
FROM   items
WHERE  id = $1
`, itemID).Scan(&fi.Name, &fi.PriceCents, &fi.ImageURL)
	})
	if err != nil {
		return nil, err
	}
	return &fi, nil
}

// RemoveFavorite deletes the favourite row. Returns ErrFavoriteNotFound when
// the row does not exist (or already removed).
func (s *Store) RemoveFavorite(ctx context.Context, orgID, customerID, itemID string) error {
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
DELETE FROM customer_favorite_items
WHERE  organization_id = $1
  AND  customer_id     = $2
  AND  item_id         = $3
`, orgID, customerID, itemID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrFavoriteNotFound
		}
		return nil
	})
	return err
}
