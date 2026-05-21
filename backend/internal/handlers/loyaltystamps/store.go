package loyaltystamps

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors surfaced to the HTTP layer for status-code mapping.
var (
	ErrConfigNotFound   = errors.New("loyalty stamp config not found for org")
	ErrCustomerNotFound = errors.New("customer not found")
)

// ---------------------------------------------------------------------------
// Model types
// ---------------------------------------------------------------------------

// Config mirrors the stamp columns on loyalty_config.
type Config struct {
	OrgID          string  `json:"organization_id"`
	StampsEnabled  bool    `json:"stamps_enabled"`
	StampsRequired int     `json:"stamps_required"`
	StampItemID    *string `json:"stamp_item_id"` // nil = any item qualifies
	UpdatedAt      time.Time `json:"updated_at"`
}

// CustomerStamps mirrors a customer_loyalty_stamps row plus derived fields.
type CustomerStamps struct {
	CustomerID     string    `json:"customer_id"`
	OrgID          string    `json:"organization_id"`
	LocationID     *string   `json:"location_id"`
	Stamps         int       `json:"stamps"`
	StampsRequired int       `json:"stamps_required"`
	StampsUntilFree int      `json:"stamps_until_free"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// AccrueResult is the payload returned by AccrueStamp.
type AccrueResult struct {
	CustomerStamps
	RewardEarned bool `json:"reward_earned"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

// GetConfig reads the stamp columns from loyalty_config for the request's org.
// If no row exists yet it returns ErrConfigNotFound.
func (s *Store) GetConfig(ctx context.Context) (*Config, error) {
	var cfg Config
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT organization_id,
			       stamps_enabled,
			       stamps_required,
			       stamp_item_id::text,
			       updated_at
			  FROM loyalty_config
			 WHERE organization_id = current_org_id()
		`).Scan(
			&cfg.OrgID,
			&cfg.StampsEnabled,
			&cfg.StampsRequired,
			&cfg.StampItemID,
			&cfg.UpdatedAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConfigNotFound
	}
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// UpsertConfig writes stamp settings into loyalty_config, creating the row if
// it does not exist yet.  Only the three stamp columns are touched; all other
// loyalty_config fields keep their existing values.
func (s *Store) UpsertConfig(ctx context.Context, enabled bool, required int, itemID *string) (*Config, error) {
	var cfg Config
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO loyalty_config (organization_id, stamps_enabled, stamps_required, stamp_item_id)
			VALUES (current_org_id(), $1, $2, $3::uuid)
			ON CONFLICT (organization_id) DO UPDATE
			   SET stamps_enabled  = EXCLUDED.stamps_enabled,
			       stamps_required = EXCLUDED.stamps_required,
			       stamp_item_id   = EXCLUDED.stamp_item_id,
			       updated_at      = timezone('utc', now())
			RETURNING organization_id, stamps_enabled, stamps_required,
			          stamp_item_id::text, updated_at
		`, enabled, required, nullStr(itemID)).Scan(
			&cfg.OrgID,
			&cfg.StampsEnabled,
			&cfg.StampsRequired,
			&cfg.StampItemID,
			&cfg.UpdatedAt,
		)
	})
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}

// ---------------------------------------------------------------------------
// Customer stamp helpers
// ---------------------------------------------------------------------------

// GetCustomerStamps reads (or initialises) the stamp counter for a customer.
// It also reads stamps_required from loyalty_config so the caller has everything
// in one response.
func (s *Store) GetCustomerStamps(ctx context.Context, customerID string) (*CustomerStamps, error) {
	var out CustomerStamps
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Verify the customer belongs to this org (RLS enforces it, but we want
		// an explicit 404 instead of a 500).
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM customers WHERE id = $1::uuid AND organization_id = current_org_id())`,
			customerID,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrCustomerNotFound
		}

		// Read stamp config for stamps_required.
		var stampsRequired int
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(stamps_required, 10) FROM loyalty_config WHERE organization_id = current_org_id()`,
		).Scan(&stampsRequired); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if stampsRequired == 0 {
			stampsRequired = 10
		}

		// Read or zero-fill the counter row.
		var stamps int
		var locID *string
		var updatedAt time.Time
		err := tx.QueryRow(ctx, `
			SELECT stamps, location_id::text, updated_at
			  FROM customer_loyalty_stamps
			 WHERE organization_id = current_org_id()
			   AND customer_id = $1::uuid
			   AND location_id IS NULL
			 LIMIT 1
		`, customerID).Scan(&stamps, &locID, &updatedAt)
		if errors.Is(err, pgx.ErrNoRows) {
			// No row yet — report 0 stamps without inserting.
			updatedAt = time.Now().UTC()
		} else if err != nil {
			return err
		}

		until := stampsRequired - stamps
		if until < 0 {
			until = 0
		}
		out = CustomerStamps{
			CustomerID:      customerID,
			OrgID:           "", // filled below from scope
			LocationID:      locID,
			Stamps:          stamps,
			StampsRequired:  stampsRequired,
			StampsUntilFree: until,
			UpdatedAt:       updatedAt,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Populate OrgID from the db.Scope that RequireOrgScope injected.
	out.OrgID = db.ScopeFromContext(ctx).OrgID
	return &out, nil
}

// AccrueStamp adds `count` stamps to the customer's running total.
// When the total reaches or exceeds stamps_required the counter resets to 0
// and RewardEarned is set to true in the returned result.
// Idempotency-key handling is left to the caller layer (optional header).
func (s *Store) AccrueStamp(ctx context.Context, customerID string, count int) (*AccrueResult, error) {
	var out AccrueResult
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Verify customer belongs to org.
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM customers WHERE id = $1::uuid AND organization_id = current_org_id())`,
			customerID,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrCustomerNotFound
		}

		// Read stamps_required from config; default 10 if config row absent.
		var stampsRequired int
		if err := tx.QueryRow(ctx,
			`SELECT COALESCE(stamps_required, 10) FROM loyalty_config WHERE organization_id = current_org_id()`,
		).Scan(&stampsRequired); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if stampsRequired == 0 {
			stampsRequired = 10
		}

		// Upsert the counter row, atomically incrementing by `count`.
		var newStamps int
		var updatedAt time.Time
		if err := tx.QueryRow(ctx, `
			INSERT INTO customer_loyalty_stamps
			            (organization_id, customer_id, location_id, stamps)
			VALUES      (current_org_id(), $1::uuid, NULL, $2)
			ON CONFLICT (organization_id, customer_id, location_id)
			DO UPDATE SET stamps     = customer_loyalty_stamps.stamps + EXCLUDED.stamps,
			              updated_at = timezone('utc', now())
			RETURNING stamps, updated_at
		`, customerID, count).Scan(&newStamps, &updatedAt); err != nil {
			return err
		}

		rewardEarned := false
		if newStamps >= stampsRequired {
			// Reset counter to 0, signal reward.
			if _, err := tx.Exec(ctx, `
				UPDATE customer_loyalty_stamps
				   SET stamps     = 0,
				       updated_at = timezone('utc', now())
				 WHERE organization_id = current_org_id()
				   AND customer_id     = $1::uuid
				   AND location_id IS NULL
			`, customerID); err != nil {
				return err
			}
			newStamps = 0
			rewardEarned = true
			updatedAt = time.Now().UTC()
		}

		until := stampsRequired - newStamps
		if until < 0 {
			until = 0
		}
		out = AccrueResult{
			CustomerStamps: CustomerStamps{
				CustomerID:      customerID,
				OrgID:           db.ScopeFromContext(ctx).OrgID,
				Stamps:          newStamps,
				StampsRequired:  stampsRequired,
				StampsUntilFree: until,
				UpdatedAt:       updatedAt,
			},
			RewardEarned: rewardEarned,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// nullStr converts a *string to nil when the pointer is nil or points to "".
// Used to send NULL to Postgres for nullable UUID text columns.
func nullStr(sp *string) any {
	if sp == nil || *sp == "" {
		return nil
	}
	return *sp
}
