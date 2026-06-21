// Package tippools — database access layer for tip pooling.
package tippools

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Sentinel errors for HTTP-layer status-code mapping.
var (
	ErrPoolNotFound       = errors.New("tip pool not found")
	ErrAlreadyDistributed = errors.New("pool has already been distributed")
)

// TipPool mirrors the tip_pools row.
type TipPool struct {
	ID             string         `json:"id"`
	OrganizationID string         `json:"organization_id"`
	LocationID     *string        `json:"location_id"`
	Name           string         `json:"name"`
	RuleType       string         `json:"rule_type"`
	Config         map[string]any `json:"config"`
	ShiftDate      *string        `json:"shift_date"` // "YYYY-MM-DD" or null
	IsActive       bool           `json:"is_active"`
	DistributedAt  *time.Time     `json:"distributed_at"` // non-nil once distributed
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

// Contribution mirrors a tip_pool_contributions row.
type Contribution struct {
	ID             string    `json:"id"`
	TipPoolID      string    `json:"tip_pool_id"`
	OrderPaymentID *string   `json:"order_payment_id"`
	AmountCents    int64     `json:"amount_cents"`
	ContributedAt  time.Time `json:"contributed_at"`
}

// Distribution mirrors a tip_distributions row.
type Distribution struct {
	ID                string     `json:"id"`
	TipPoolID         string     `json:"tip_pool_id"`
	StaffID           string     `json:"staff_id"`
	AmountCents       int64      `json:"amount_cents"`
	HoursWorked       *float64   `json:"hours_worked"`
	WeightPoints      *float64   `json:"weight_points"`
	DistributedAt     time.Time  `json:"distributed_at"`
	PayrollExportedAt *time.Time `json:"payroll_exported_at"`
}

// PoolDetail is what GET /tip-pools/{id} returns.
type PoolDetail struct {
	TipPool
	Contributions []Contribution `json:"contributions"`
	Distributions []Distribution `json:"distributions"`
}

// Store holds a pgxpool and exposes all DB operations for tip pools.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store backed by the given connection pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---- helpers ----------------------------------------------------------------

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullF64(f float64) any {
	if f == 0 {
		return nil
	}
	return f
}

// ---- TipPool CRUD -----------------------------------------------------------

const poolCols = `id, organization_id, location_id, name, rule_type, config,
	shift_date::text, is_active, distributed_at, created_at, updated_at`

func scanPool(row pgx.Row, p *TipPool) error {
	return row.Scan(
		&p.ID, &p.OrganizationID, &p.LocationID, &p.Name, &p.RuleType, &p.Config,
		&p.ShiftDate, &p.IsActive, &p.DistributedAt, &p.CreatedAt, &p.UpdatedAt,
	)
}

// CreatePool inserts a new tip_pool row.
func (s *Store) CreatePool(
	ctx context.Context,
	orgID, locationID, name, ruleType string,
	config map[string]any,
	shiftDate string,
) (*TipPool, error) {
	var out TipPool
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return scanPool(tx.QueryRow(ctx, `
INSERT INTO tip_pools (organization_id, location_id, name, rule_type, config, shift_date)
VALUES ($1, $2, $3, $4, $5, $6::date)
RETURNING `+poolCols,
			orgID, nullStr(locationID), name, ruleType, config, nullStr(shiftDate),
		), &out)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ListPools returns active pools, optionally filtered by location and/or shift
// date (both filters are optional — pass empty strings to omit).
func (s *Store) ListPools(ctx context.Context, locationID, shiftDate string) ([]TipPool, error) {
	q := `SELECT ` + poolCols + ` FROM tip_pools WHERE is_active = true`
	args := []any{}
	if locationID != "" {
		args = append(args, locationID)
		q += ` AND location_id = $` + itoa(len(args))
	}
	if shiftDate != "" {
		args = append(args, shiftDate)
		q += ` AND shift_date = $` + itoa(len(args)) + `::date`
	}
	q += ` ORDER BY created_at DESC LIMIT 100`

	out := []TipPool{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var p TipPool
			if err := scanPool(rows, &p); err != nil {
				return err
			}
			out = append(out, p)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetPool returns one pool by ID, or ErrPoolNotFound.
func (s *Store) GetPool(ctx context.Context, id string) (*TipPool, error) {
	var out TipPool
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return scanPool(tx.QueryRow(ctx,
			`SELECT `+poolCols+` FROM tip_pools WHERE id = $1`, id,
		), &out)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPoolNotFound
	}
	return &out, err
}

// GetPoolDetail returns the pool plus all its contributions and distributions.
func (s *Store) GetPoolDetail(ctx context.Context, id string) (*PoolDetail, error) {
	var out PoolDetail
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		if err := scanPool(tx.QueryRow(ctx,
			`SELECT `+poolCols+` FROM tip_pools WHERE id = $1`, id,
		), &out.TipPool); err != nil {
			return err
		}

		contrib, err := listContributionsTx(ctx, tx, id)
		if err != nil {
			return err
		}
		out.Contributions = contrib

		dist, err := listDistributionsTx(ctx, tx, id)
		if err != nil {
			return err
		}
		out.Distributions = dist
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPoolNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// UpdatePool applies partial updates to name / rule_type / config / is_active.
func (s *Store) UpdatePool(
	ctx context.Context,
	id, name, ruleType string,
	config map[string]any,
	isActive *bool,
) (*TipPool, error) {
	var out TipPool
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return scanPool(tx.QueryRow(ctx, `
UPDATE tip_pools
SET name      = COALESCE(NULLIF($2, ''), name),
    rule_type = COALESCE(NULLIF($3, ''), rule_type),
    config    = CASE WHEN $4::jsonb IS NOT NULL THEN $4 ELSE config END,
    is_active = COALESCE($5, is_active),
    updated_at = now()
WHERE id = $1
RETURNING `+poolCols,
			id, name, ruleType, configArg(config), isActive,
		), &out)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPoolNotFound
	}
	return &out, err
}

// configArg returns nil when config is nil so the CASE expression keeps the
// existing JSONB value rather than writing a SQL NULL.
func configArg(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}

// ---- Contributions ----------------------------------------------------------

func (s *Store) AddContribution(
	ctx context.Context,
	poolID, orderPaymentID string,
	amountCents int64,
) (*Contribution, error) {
	var c Contribution
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
INSERT INTO tip_pool_contributions (tip_pool_id, order_payment_id, amount_cents)
VALUES ($1, $2, $3)
RETURNING id, tip_pool_id, order_payment_id, amount_cents, contributed_at
`, poolID, nullStr(orderPaymentID), amountCents).Scan(
			&c.ID, &c.TipPoolID, &c.OrderPaymentID, &c.AmountCents, &c.ContributedAt,
		)
		if err != nil {
			// 23505 = unique_violation: the same order_payment_id was already
			// recorded for this pool. Treat as a no-op — fetch the existing row
			// so the caller still gets a well-formed response.
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == "23505" {
				return tx.QueryRow(ctx, `
SELECT id, tip_pool_id, order_payment_id, amount_cents, contributed_at
FROM   tip_pool_contributions
WHERE  order_payment_id = $1
`, nullStr(orderPaymentID)).Scan(
					&c.ID, &c.TipPoolID, &c.OrderPaymentID, &c.AmountCents, &c.ContributedAt,
				)
			}
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) listContributions(ctx context.Context, poolID string) ([]Contribution, error) {
	out := []Contribution{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var err error
		out, err = listContributionsTx(ctx, tx, poolID)
		return err
	})
	return out, err
}

func listContributionsTx(ctx context.Context, tx pgx.Tx, poolID string) ([]Contribution, error) {
	rows, err := tx.Query(ctx, `
SELECT id, tip_pool_id, order_payment_id, amount_cents, contributed_at
FROM tip_pool_contributions
WHERE tip_pool_id = $1
ORDER BY contributed_at`, poolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Contribution{}
	for rows.Next() {
		var c Contribution
		if err := rows.Scan(&c.ID, &c.TipPoolID, &c.OrderPaymentID, &c.AmountCents, &c.ContributedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ---- Distributions ----------------------------------------------------------

func (s *Store) listDistributions(ctx context.Context, poolID string) ([]Distribution, error) {
	out := []Distribution{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		var err error
		out, err = listDistributionsTx(ctx, tx, poolID)
		return err
	})
	return out, err
}

func listDistributionsTx(ctx context.Context, tx pgx.Tx, poolID string) ([]Distribution, error) {
	rows, err := tx.Query(ctx, `
SELECT id, tip_pool_id, staff_id, amount_cents, hours_worked, weight_points,
       distributed_at, payroll_exported_at
FROM tip_distributions
WHERE tip_pool_id = $1
ORDER BY distributed_at`, poolID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Distribution{}
	for rows.Next() {
		var d Distribution
		if err := rows.Scan(
			&d.ID, &d.TipPoolID, &d.StaffID, &d.AmountCents, &d.HoursWorked, &d.WeightPoints,
			&d.DistributedAt, &d.PayrollExportedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// DistributePool computes shares via the engine, writes tip_distributions in a
// single transaction, and returns the inserted rows.
// It fetches the staff role for each recipient (needed by role_weighted).
//
// Double-distribution prevention:
//   - The pool row is locked with SELECT … FOR UPDATE at the start of the
//     transaction; concurrent callers block until this transaction commits.
//   - If distributed_at is already set (first call committed) the function
//     returns ErrAlreadyDistributed (HTTP 409) immediately.
//   - On success distributed_at is stamped in the same transaction, so the
//     lock and the stamp are atomic.
func (s *Store) DistributePool(
	ctx context.Context,
	pool *TipPool,
	reqRecipients []RecipientReq,
) ([]Distribution, error) {
	var dists []Distribution
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// --- 1. Lock the pool row and re-read its current state atomically. ---
		// SELECT FOR UPDATE blocks any concurrent DistributePool call until this
		// transaction commits or rolls back, eliminating the TOCTOU race.
		var lockedPool TipPool
		if err := scanPool(tx.QueryRow(ctx,
			`SELECT `+poolCols+` FROM tip_pools WHERE id = $1 FOR UPDATE`,
			pool.ID,
		), &lockedPool); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrPoolNotFound
			}
			return err
		}

		// --- 2. Guard: reject if already distributed or inactive. -----------
		if lockedPool.DistributedAt != nil {
			return ErrAlreadyDistributed
		}
		if !lockedPool.IsActive {
			return errors.New("pool is not active")
		}

		// --- 3. Sum contributions. ------------------------------------------
		var totalCents int64
		if err := tx.QueryRow(ctx, `
SELECT COALESCE(SUM(amount_cents), 0) FROM tip_pool_contributions WHERE tip_pool_id = $1
`, lockedPool.ID).Scan(&totalCents); err != nil {
			return err
		}
		if totalCents == 0 {
			return errors.New("no contributions to distribute")
		}

		// --- 4. Enrich recipients with their role from the staff table. ------
		recipients := make([]Recipient, len(reqRecipients))
		for i, rr := range reqRecipients {
			var role string
			if err := tx.QueryRow(ctx,
				`SELECT role FROM staff WHERE id = $1`, rr.StaffID,
			).Scan(&role); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return errors.New("staff not found: " + rr.StaffID)
				}
				return err
			}
			recipients[i] = Recipient{
				StaffID:     rr.StaffID,
				Role:        role,
				HoursWorked: rr.HoursWorked,
				WeightPts:   rr.WeightPoints,
			}
		}

		// --- 5. Compute shares. ---------------------------------------------
		shares, err := Distribute(lockedPool.RuleType, lockedPool.Config, totalCents, recipients)
		if err != nil {
			return err
		}

		// --- 6. Insert distribution rows. -----------------------------------
		dists = make([]Distribution, 0, len(shares))
		for _, sh := range shares {
			var d Distribution
			if err := tx.QueryRow(ctx, `
INSERT INTO tip_distributions (tip_pool_id, staff_id, amount_cents, hours_worked, weight_points)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, tip_pool_id, staff_id, amount_cents, hours_worked, weight_points,
          distributed_at, payroll_exported_at
`, lockedPool.ID, sh.StaffID, sh.AmountCents, nullF64(sh.HoursWorked), nullF64(sh.WeightPts),
			).Scan(
				&d.ID, &d.TipPoolID, &d.StaffID, &d.AmountCents, &d.HoursWorked, &d.WeightPoints,
				&d.DistributedAt, &d.PayrollExportedAt,
			); err != nil {
				return err
			}
			dists = append(dists, d)
		}

		// --- 7. Stamp the pool as distributed (same transaction). -----------
		// Any concurrent caller that obtained FOR UPDATE after us will see
		// distributed_at IS NOT NULL and be rejected in step 2.
		if _, err := tx.Exec(ctx, `
UPDATE tip_pools SET distributed_at = timezone('utc', now()), updated_at = timezone('utc', now())
WHERE id = $1
`, lockedPool.ID); err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return dists, nil
}

// StaffRole fetches the role column for a staff ID.
func (s *Store) StaffRole(ctx context.Context, staffID string) (string, error) {
	var role string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT role FROM staff WHERE id = $1`, staffID).Scan(&role)
	})
	return role, err
}

// itoa is a tiny int-to-string helper to avoid importing strconv.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[pos:])
}
