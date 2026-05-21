// Package marketplace provides public (no-auth) store-directory endpoints.
//
// All queries run under db.MarketplaceScope() so the six app.* session
// variables are set inside each transaction and Postgres RLS policies
// restrict every row to is_marketplace_visible=true locations only.
//
// Tables with marketplace_role SELECT policies (from consolidated migrations):
//   - locations        (007_payments_generic)
//   - categories       (007_payments_generic, deferred from 004)
//   - items            (007_payments_generic, deferred from 004)
//   - marketplace_reviews (010_engagement)
package marketplace

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a slug does not match any marketplace-visible
// store, or when a store has no publicly visible data.
var ErrNotFound = errors.New("store not found")

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

// StoreListItem is the DTO returned in GET /stores list responses.
type StoreListItem struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Slug        *string  `json:"slug"`
	City        *string  `json:"city"`
	Country     *string  `json:"country"`
	Address     *string  `json:"address"`
	Description *string  `json:"description"`
	AvgRating   *float64 `json:"avg_rating"` // NULL when no visible reviews exist
}

// StoreProfile is the DTO returned in GET /stores/:slug responses.
type StoreProfile struct {
	ID                 string      `json:"id"`
	Name               string      `json:"name"`
	Slug               *string     `json:"slug"`
	City               *string     `json:"city"`
	Country            *string     `json:"country"`
	Address            *string     `json:"address"`
	Description        *string     `json:"description"`
	OffersDelivery     bool        `json:"offers_delivery"`
	OffersCollection   bool        `json:"offers_collection"`
	EstimatedPrepTime  int         `json:"estimated_prep_time_minutes"`
	CurrencyCode       *string     `json:"currency_code"`
	AvgRating          *float64    `json:"avg_rating"`
	ReviewCount        int         `json:"review_count"`
	Categories         []Category  `json:"categories"`
}

// Category is a menu section returned in the store profile.
type Category struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	SortOrder   int     `json:"sort_order"`
	Items       []Item  `json:"items"`
}

// Item is an orderable menu item returned in the store profile.
type Item struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Description      *string  `json:"description"`
	Price            string   `json:"price"` // decimal string to avoid float noise
	ImageURL         *string  `json:"image_url"`
	PreparationTime  int      `json:"preparation_time_minutes"`
	Calories         *int     `json:"calories"`
	SpiceLevel       *int     `json:"spice_level"`
	SortOrder        int      `json:"sort_order"`
	// RemainingToday is NULL when daily_quantity is not set (unlimited).
	// When set, it is GREATEST(daily_quantity - today's sold count, 0).
	// A value of 0 means sold out for the day.
	RemainingToday   *int     `json:"remaining_today"`
}

// ListParams collects the query-string parameters for GET /stores.
type ListParams struct {
	Q        string  // name/slug substring match
	City     string
	Country  string
	Lat      *float64 // geo-search centre
	Lng      *float64
	RadiusKM *float64 // default 10 km when lat/lng provided
	Limit    int      // default 20, max 100
	Offset   int
}

// ---------------------------------------------------------------------------
// Store (DB access layer)
// ---------------------------------------------------------------------------

// Store holds the connection pool for marketplace queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// ListStores returns paginated marketplace-visible stores matching params.
// The query runs on the provided pgx.Tx which must already have the
// marketplace session variables set (via db.Scoped).
func (s *Store) ListStores(ctx context.Context, tx pgx.Tx, p ListParams) ([]StoreListItem, error) {
	// Base query: join locations + optional avg_rating from marketplace_reviews.
	// The WHERE clause is redundant with RLS but adds clarity and index hints.
	const baseSQL = `
		SELECT
			l.id,
			l.name,
			l.slug,
			l.city,
			l.country,
			l.address,
			l.description,
			ROUND(AVG(mr.stars)::numeric, 2) AS avg_rating
		FROM locations l
		LEFT JOIN marketplace_reviews mr
			ON mr.location_id = l.id
			AND mr.status = 'visible'
		WHERE l.is_marketplace_visible = true
		  AND l.is_active = true
		  AND ($1 = '' OR l.name ILIKE '%' || $1 || '%' OR l.slug ILIKE '%' || $1 || '%')
		  AND ($2 = '' OR lower(l.city)    = lower($2))
		  AND ($3 = '' OR lower(l.country) = lower($3))
		  AND (
		      $4::float8 IS NULL OR $5::float8 IS NULL OR $6::float8 IS NULL
		      OR l.latitude IS NULL OR l.longitude IS NULL
		      OR (
		          -- Haversine great-circle distance in km (no earthdistance ext).
		          6371 * acos(
		              least(1, greatest(-1,
		                  cos(radians($4::float8)) * cos(radians(l.latitude::float8))
		                  * cos(radians(l.longitude::float8) - radians($5::float8))
		                  + sin(radians($4::float8)) * sin(radians(l.latitude::float8))
		              ))
		          ) <= $6::float8
		      )
		  )
		GROUP BY l.id
		ORDER BY l.name
		LIMIT $7 OFFSET $8
	`

	var lat, lng, radius interface{}
	if p.Lat != nil && p.Lng != nil {
		lat = *p.Lat
		lng = *p.Lng
		r := 10.0
		if p.RadiusKM != nil {
			r = *p.RadiusKM
		}
		radius = r
	}

	rows, err := tx.Query(ctx, baseSQL,
		p.Q, p.City, p.Country,
		lat, lng, radius,
		p.Limit, p.Offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []StoreListItem
	for rows.Next() {
		var item StoreListItem
		if err := rows.Scan(
			&item.ID, &item.Name, &item.Slug, &item.City, &item.Country,
			&item.Address, &item.Description, &item.AvgRating,
		); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// GetStoreBySlug returns the store profile and currently-available menu
// snapshot for the given slug.
// Returns ErrNotFound when no marketplace-visible store has that slug.
func (s *Store) GetStoreBySlug(ctx context.Context, tx pgx.Tx, slug string) (*StoreProfile, error) {
	const locSQL = `
		SELECT
			l.id,
			l.name,
			l.slug,
			l.city,
			l.country,
			l.address,
			l.description,
			l.offers_delivery,
			l.offers_collection,
			l.estimated_prep_time,
			l.currency_code,
			ROUND(AVG(mr.stars)::numeric, 2) AS avg_rating,
			COUNT(mr.id)                     AS review_count
		FROM locations l
		LEFT JOIN marketplace_reviews mr
			ON mr.location_id = l.id
			AND mr.status = 'visible'
		WHERE l.is_marketplace_visible = true
		  AND l.is_active = true
		  AND l.slug = $1
		GROUP BY l.id
	`

	var p StoreProfile
	err := tx.QueryRow(ctx, locSQL, slug).Scan(
		&p.ID, &p.Name, &p.Slug, &p.City, &p.Country,
		&p.Address, &p.Description,
		&p.OffersDelivery, &p.OffersCollection, &p.EstimatedPrepTime,
		&p.CurrencyCode, &p.AvgRating, &p.ReviewCount,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}

	// Fetch active categories for this location.
	const catSQL = `
		SELECT id, name, description, sort_order
		FROM categories
		WHERE location_id = $1
		  AND is_active = true
		ORDER BY sort_order, name
	`
	catRows, err := tx.Query(ctx, catSQL, p.ID)
	if err != nil {
		return nil, err
	}
	defer catRows.Close()

	catMap := map[string]*Category{}
	var catOrder []string
	for catRows.Next() {
		var c Category
		if err := catRows.Scan(&c.ID, &c.Name, &c.Description, &c.SortOrder); err != nil {
			return nil, err
		}
		c.Items = []Item{}
		catMap[c.ID] = &c
		catOrder = append(catOrder, c.ID)
	}
	if err := catRows.Err(); err != nil {
		return nil, err
	}

	// Fetch available items: must be active, not 86ed, and within availability
	// window (available_from <= now AND (available_until IS NULL OR available_until > now)).
	// remaining_today is computed from the daily countdown columns added in migration 026:
	//   NULL when daily_quantity is NULL (unlimited), otherwise
	//   GREATEST(daily_quantity - (sold today), 0).
	const itemSQL = `
		SELECT
			i.id,
			i.category_id,
			i.name,
			i.description,
			i.price::text,
			i.image_url,
			i.preparation_time,
			i.calories,
			i.spice_level,
			i.sort_order,
			CASE
				WHEN i.daily_quantity IS NULL THEN NULL
				ELSE GREATEST(
					i.daily_quantity - CASE
						WHEN i.daily_counter_date = CURRENT_DATE THEN COALESCE(i.daily_sold_count, 0)
						ELSE 0
					END,
					0
				)
			END AS remaining_today
		FROM items i
		WHERE i.location_id = $1
		  AND i.is_active   = true
		  AND i.is_86ed     = false
		  AND (i.available_from IS NULL OR i.available_from <= now())
		  AND (i.available_until IS NULL OR i.available_until > now())
		ORDER BY i.sort_order, i.name
	`
	itemRows, err := tx.Query(ctx, itemSQL, p.ID)
	if err != nil {
		return nil, err
	}
	defer itemRows.Close()

	for itemRows.Next() {
		var it Item
		var catID string
		if err := itemRows.Scan(
			&it.ID, &catID, &it.Name, &it.Description, &it.Price,
			&it.ImageURL, &it.PreparationTime, &it.Calories, &it.SpiceLevel, &it.SortOrder,
			&it.RemainingToday,
		); err != nil {
			return nil, err
		}
		if cat, ok := catMap[catID]; ok {
			cat.Items = append(cat.Items, it)
		}
	}
	if err := itemRows.Err(); err != nil {
		return nil, err
	}

	// Build ordered slice, omitting empty categories (no available items).
	for _, id := range catOrder {
		c := catMap[id]
		if len(c.Items) > 0 {
			p.Categories = append(p.Categories, *c)
		}
	}
	if p.Categories == nil {
		p.Categories = []Category{}
	}

	return &p, nil
}
