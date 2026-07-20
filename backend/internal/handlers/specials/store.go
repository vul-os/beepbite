package specials

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrItemNotFound is returned when an item_id does not exist in the org's
// locations, or when the item belongs to a location the caller cannot access.
var ErrItemNotFound = errors.New("item not found")

// Special is the shape returned by GET /specials.
// price is the item's base price in cents (derived from items.price * 100,
// rounded to bigint). special_price_cents is NULL when the owner set no
// promotional price.
type Special struct {
	ID                string     `json:"id"`
	Name              string     `json:"name"`
	LocationID        string     `json:"location_id"`
	PriceCents        int64      `json:"price_cents"`
	SpecialPriceCents *int64     `json:"special_price_cents"`
	SpecialDate       *time.Time `json:"special_date"`
	ImageURL          *string    `json:"image_url"`
}

// Store wraps the pgxpool and provides data access for the specials feature.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ListTodaysSpecials returns all items in the org (filtered by location_id
// when non-empty) where is_daily_special = true AND (special_date IS NULL OR
// special_date is today at that item's own location). Results are ordered by
// item name.
//
// "Today" is resolved per row, in the timezone of the location the item belongs
// to, by joining locations. CURRENT_DATE — what this used to compare against —
// is the Postgres *session* timezone, which is a property of the database
// server and of no restaurant at all. On a UTC server that made a Los Angeles
// store's Tuesday specials appear on the menu from 16:00 Monday and vanish at
// 16:00 Tuesday, mid-service. Resolving per row also means one query stays
// correct for an org whose locations span several zones.
func (s *Store) ListTodaysSpecials(ctx context.Context, locationID string) ([]Special, error) {
	out := []Special{}

	query := `
SELECT i.id,
       i.name,
       i.location_id,
       ROUND(i.price * 100)::bigint      AS price_cents,
       i.special_price_cents,
       i.special_date,
       i.image_url
  FROM items i
  LEFT JOIN locations l ON l.id = i.location_id
 WHERE i.is_daily_special = true
   AND (i.special_date IS NULL
        OR i.special_date = (now() AT TIME ZONE COALESCE(l.timezone, 'UTC'))::date)
   AND i.is_active = true
   AND i.is_86ed  = false
`
	args := []any{}
	if locationID != "" {
		query += " AND i.location_id = $1"
		args = append(args, locationID)
	}
	query += " ORDER BY i.name"

	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var sp Special
			if err := rows.Scan(
				&sp.ID, &sp.Name, &sp.LocationID, &sp.PriceCents,
				&sp.SpecialPriceCents, &sp.SpecialDate, &sp.ImageURL,
			); err != nil {
				return err
			}
			out = append(out, sp)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// SetSpecial toggles an item's daily-special flags. It verifies the item
// belongs to a location in the caller's org (via RLS + the explicit
// location_id return) before applying the update.
//
// Returns ErrItemNotFound when no row is visible under the current scope.
func (s *Store) SetSpecial(ctx context.Context, itemID string, req SetSpecialReq) (string, error) {
	var locationID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
UPDATE items
   SET is_daily_special    = $2,
       special_price_cents = $3,
       special_date        = $4,
       updated_at          = now()
 WHERE id = $1
RETURNING location_id
`, itemID, req.IsDailySpecial, req.SpecialPriceCents, req.SpecialDate).Scan(&locationID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrItemNotFound
	}
	if err != nil {
		return "", err
	}
	return locationID, nil
}

// SetSpecialReq is the parsed body for PUT /items/{item_id}/special.
type SetSpecialReq struct {
	IsDailySpecial    bool       `json:"is_daily_special"`
	SpecialPriceCents *int64     `json:"special_price_cents"`
	SpecialDate       *time.Time `json:"special_date"`
}
