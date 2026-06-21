// Package deliveryzones exposes delivery zone CRUD and point-in-polygon lookup.
package deliveryzones

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrZoneNotFound = errors.New("delivery zone not found")

// Zone mirrors a delivery_zones row.
type Zone struct {
	ID                  string    `json:"id"`
	OrganizationID      string    `json:"organization_id"`
	LocationID          string    `json:"location_id"`
	Name                string    `json:"name"`
	Polygon             any       `json:"polygon"` // raw JSON so the client gets the GeoJSON object
	DeliveryFeeCents    int64     `json:"delivery_fee_cents"`
	MinOrderCents       int64     `json:"min_order_cents"`
	EstimatedETAMinutes int       `json:"estimated_eta_minutes"`
	IsActive            bool      `json:"is_active"`
	Priority            int       `json:"priority"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`

	// polygon stored as raw bytes for scanning; marshalled back to any for JSON.
	polygonRaw []byte
}

// LookupResult is what POST /delivery-zones/lookup returns on a hit.
type LookupResult struct {
	Zone
	DeliveryFeeCents    int64 `json:"delivery_fee_cents"`
	EstimatedETAMinutes int   `json:"estimated_eta_minutes"`
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const zoneCols = `id, organization_id, location_id, name, polygon,
	delivery_fee_cents, min_order_cents, estimated_eta_minutes,
	is_active, priority, created_at, updated_at`

func scanZone(row pgx.Row, z *Zone) error {
	return row.Scan(
		&z.ID, &z.OrganizationID, &z.LocationID, &z.Name, &z.polygonRaw,
		&z.DeliveryFeeCents, &z.MinOrderCents, &z.EstimatedETAMinutes,
		&z.IsActive, &z.Priority, &z.CreatedAt, &z.UpdatedAt,
	)
}

// hydratePolygon unmarshals the raw JSONB bytes into Zone.Polygon so the JSON
// encoder sends an object, not a base64 string.
func hydratePolygon(z *Zone) {
	if len(z.polygonRaw) == 0 {
		return
	}
	var v any
	if err := json.Unmarshal(z.polygonRaw, &v); err == nil {
		z.Polygon = v
	} else {
		z.Polygon = string(z.polygonRaw)
	}
}

func (s *Store) Create(ctx context.Context, z Zone) (*Zone, error) {
	polygonJSON, err := json.Marshal(z.Polygon)
	if err != nil {
		return nil, err
	}
	var out Zone
	err = scanZone(s.pool.QueryRow(ctx, `
INSERT INTO delivery_zones
  (organization_id, location_id, name, polygon,
   delivery_fee_cents, min_order_cents, estimated_eta_minutes,
   is_active, priority)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING `+zoneCols,
		z.OrganizationID, z.LocationID, z.Name, polygonJSON,
		z.DeliveryFeeCents, z.MinOrderCents, z.EstimatedETAMinutes,
		z.IsActive, z.Priority,
	), &out)
	if err != nil {
		return nil, err
	}
	hydratePolygon(&out)
	return &out, nil
}

func (s *Store) Get(ctx context.Context, id string) (*Zone, error) {
	var out Zone
	err := scanZone(s.pool.QueryRow(ctx,
		`SELECT `+zoneCols+` FROM delivery_zones WHERE id = $1`, id), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrZoneNotFound
	}
	if err != nil {
		return nil, err
	}
	hydratePolygon(&out)
	return &out, nil
}

func (s *Store) List(ctx context.Context, locationID string) ([]Zone, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+zoneCols+` FROM delivery_zones WHERE location_id = $1
		 ORDER BY priority DESC, created_at ASC`, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Zone{}
	for rows.Next() {
		var z Zone
		if err := scanZone(rows, &z); err != nil {
			return nil, err
		}
		hydratePolygon(&z)
		out = append(out, z)
	}
	return out, rows.Err()
}

// UpdateFields is the set of fields the PATCH handler may change.
type UpdateFields struct {
	Name                *string `json:"name"`
	Polygon             any     `json:"polygon"`
	DeliveryFeeCents    *int64  `json:"delivery_fee_cents"`
	MinOrderCents       *int64  `json:"min_order_cents"`
	EstimatedETAMinutes *int    `json:"estimated_eta_minutes"`
	IsActive            *bool   `json:"is_active"`
	Priority            *int    `json:"priority"`
}

func (s *Store) Update(ctx context.Context, id string, u UpdateFields) (*Zone, error) {
	// Fetch current, apply deltas, write back.
	cur, err := s.Get(ctx, id)
	if err != nil {
		return nil, err
	}

	if u.Name != nil {
		cur.Name = *u.Name
	}
	if u.Polygon != nil {
		cur.Polygon = u.Polygon
	}
	if u.DeliveryFeeCents != nil {
		cur.DeliveryFeeCents = *u.DeliveryFeeCents
	}
	if u.MinOrderCents != nil {
		cur.MinOrderCents = *u.MinOrderCents
	}
	if u.EstimatedETAMinutes != nil {
		cur.EstimatedETAMinutes = *u.EstimatedETAMinutes
	}
	if u.IsActive != nil {
		cur.IsActive = *u.IsActive
	}
	if u.Priority != nil {
		cur.Priority = *u.Priority
	}

	polygonJSON, err := json.Marshal(cur.Polygon)
	if err != nil {
		return nil, err
	}

	var out Zone
	err = scanZone(s.pool.QueryRow(ctx, `
UPDATE delivery_zones
SET name = $2, polygon = $3, delivery_fee_cents = $4, min_order_cents = $5,
    estimated_eta_minutes = $6, is_active = $7, priority = $8, updated_at = now()
WHERE id = $1
RETURNING `+zoneCols,
		id, cur.Name, polygonJSON, cur.DeliveryFeeCents, cur.MinOrderCents,
		cur.EstimatedETAMinutes, cur.IsActive, cur.Priority,
	), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrZoneNotFound
	}
	if err != nil {
		return nil, err
	}
	hydratePolygon(&out)
	return &out, nil
}

// SoftDelete sets is_active = false (delivery zones are never hard-deleted).
func (s *Store) SoftDelete(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx,
		`UPDATE delivery_zones SET is_active = false, updated_at = now() WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrZoneNotFound
	}
	return nil
}

// Lookup returns the highest-priority active zone that contains (lng, lat) for
// the given location, or ErrZoneNotFound when no zone matches.
func (s *Store) Lookup(ctx context.Context, locationID string, lng, lat float64) (*Zone, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+zoneCols+`
		 FROM delivery_zones
		 WHERE location_id = $1 AND is_active = true
		 ORDER BY priority DESC`, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var z Zone
		if err := scanZone(rows, &z); err != nil {
			return nil, err
		}
		var poly GeoPolygon
		if err := json.Unmarshal(z.polygonRaw, &poly); err != nil {
			// skip malformed polygon
			continue
		}
		if containsPoint(poly, lng, lat) {
			hydratePolygon(&z)
			return &z, nil
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return nil, ErrZoneNotFound
}
