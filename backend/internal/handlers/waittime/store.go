package waittime

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrLocationNotFound is returned when the location does not exist or is not
// visible to the current org scope.
var ErrLocationNotFound = errors.New("location not found")

// LoadData holds everything the estimator needs, fetched in one query.
type LoadData struct {
	// AvgPrepMinutes is the operator-configured baseline from locations.avg_prep_minutes.
	AvgPrepMinutes int
	// ActiveTickets is the count of kds_tickets with status 'fired' or 'in_progress'
	// that belong to this location.
	ActiveTickets int
	// ActiveItems is the sum of kds_ticket_items.quantity across those tickets.
	// Uses COALESCE so an empty kitchen returns 0 rather than NULL.
	ActiveItems float64
	// StationCount is the number of active kitchen stations at the location.
	// Used to spread item load evenly across parallel prep lines.
	StationCount int
}

// Store wraps the connection pool for wait-time queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// FetchLoadData returns kitchen-load metrics for locationID.
// The query runs inside a single org-scoped transaction so all three counts
// are consistent and RLS prevents cross-tenant leaks.
//
// Returns ErrLocationNotFound when the location row does not exist or is not
// visible to the current org scope (RLS yields zero rows).
func (s *Store) FetchLoadData(ctx context.Context, locationID string) (*LoadData, error) {
	var out LoadData
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// 1. Verify location exists in this org's scope and read baseline.
		err := tx.QueryRow(ctx, `
			SELECT avg_prep_minutes
			FROM   locations
			WHERE  id = $1
		`, locationID).Scan(&out.AvgPrepMinutes)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLocationNotFound
		}
		if err != nil {
			return err
		}

		// 2. Count active tickets + sum their items in one pass.
		//    kds_tickets → kitchen_stations → locations ensures we only look at
		//    tickets belonging to this location; the station JOIN also gives us
		//    the station count in the same query.
		//
		//    Active statuses per migration 008: 'fired' (sent, not yet started)
		//    and 'in_progress' (cook has claimed it).  'ready', 'bumped',
		//    'recalled', and 'cancelled' are excluded — they are no longer
		//    consuming kitchen capacity.
		err = tx.QueryRow(ctx, `
			SELECT
			    COUNT(DISTINCT kt.id)                       AS active_tickets,
			    COALESCE(SUM(kti.quantity), 0)              AS active_items,
			    COUNT(DISTINCT ks.id) FILTER (WHERE ks.is_active) AS station_count
			FROM kitchen_stations ks
			JOIN kds_tickets kt
			    ON  kt.station_id = ks.id
			    AND kt.status IN ('fired', 'in_progress')
			LEFT JOIN kds_ticket_items kti
			    ON  kti.ticket_id = kt.id
			    AND kti.item_status NOT IN ('bumped', 'voided', '86ed')
			WHERE ks.location_id = $1
		`, locationID).Scan(&out.ActiveTickets, &out.ActiveItems, &out.StationCount)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}
