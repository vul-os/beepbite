// Package pickupslots contains the database access layer for the pickup-slot
// feature. It reads slot configuration from the locations table (added in
// migration 026) and counts existing bookings against orders.pickup_at.
//
// FLAG: orders.pickup_at (timestamptz) does not yet exist in the schema.
// CountOrdersInSlot returns 0 until that column is added and orders are
// persisted with a chosen pickup time. The query is written ready-to-use
// so that adding the column is all that is needed to activate counts.
package pickupslots

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrLocationNotFound is returned when the requested location row is absent.
var ErrLocationNotFound = errors.New("location not found")

// LocationSlotConfig holds the pickup configuration columns from locations.
type LocationSlotConfig struct {
	PickupSlotCapacity int // 0 = unlimited
	PickupSlotMinutes  int // slot granularity; defaults to 15 if 0
}

// Store wraps a pgxpool for pickup-slot queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore creates a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// GetSlotConfig fetches pickup_slot_capacity and pickup_slot_minutes for the
// given location. Returns ErrLocationNotFound when the row doesn't exist.
func (s *Store) GetSlotConfig(ctx context.Context, locationID string) (LocationSlotConfig, error) {
	var cfg LocationSlotConfig
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT COALESCE(pickup_slot_capacity, 0),
       COALESCE(pickup_slot_minutes,  15)
FROM   locations
WHERE  id = $1
`, locationID).Scan(&cfg.PickupSlotCapacity, &cfg.PickupSlotMinutes)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return cfg, ErrLocationNotFound
	}
	return cfg, err
}

// CountOrdersInSlot returns how many orders have a pickup_at timestamp that
// falls within [slotStart, slotStart+slotMinutes).
//
// FLAG: orders.pickup_at does not yet exist. This query will fail at runtime
// until the column is added. Until then, the handler catches the error and
// substitutes 0, so slots always appear available.
func (s *Store) CountOrdersInSlot(ctx context.Context, locationID, slotStart string, slotMinutes int) (int, error) {
	var count int
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT COUNT(*)
FROM   orders
WHERE  location_id = $1
  AND  pickup_at >= $2::timestamptz
  AND  pickup_at <  $2::timestamptz + ($3 * interval '1 minute')
`, locationID, slotStart, slotMinutes).Scan(&count)
	})
	return count, err
}
