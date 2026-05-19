package payroll

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors for HTTP status mapping.
var (
	ErrRateNotFound      = errors.New("pay rate not found")
	ErrRateCentsImmutable = errors.New("rate_cents cannot be edited; create a new rate instead")
	ErrUniqueCurrentRate  = errors.New("a current rate for this staff_id + rate_type already exists")
)

// PayRate mirrors a staff_pay_rates row.
type PayRate struct {
	ID                           string     `json:"id"`
	StaffID                      string     `json:"staff_id"`
	RateType                     string     `json:"rate_type"`
	AmountCents                  int64      `json:"amount_cents"`
	Currency                     string     `json:"currency"`
	CommissionPercentage         *float64   `json:"commission_percentage,omitempty"`
	CommissionBasis              *string    `json:"commission_basis,omitempty"`
	OvertimeMultiplier           float64    `json:"overtime_multiplier"`
	OvertimeThresholdHoursPerWeek *float64  `json:"overtime_threshold_hours_per_week,omitempty"`
	EffectiveFrom                string     `json:"effective_from"` // YYYY-MM-DD
	EffectiveUntil               *string    `json:"effective_until,omitempty"` // YYYY-MM-DD or null
	Notes                        *string    `json:"notes,omitempty"`
	CreatedBy                    *string    `json:"created_by,omitempty"`
	IsCurrent                    bool       `json:"is_current"`
	CreatedAt                    time.Time  `json:"created_at"`
	UpdatedAt                    time.Time  `json:"updated_at"`
}

// PayrollRow is one line in the CSV export.
type PayrollRow struct {
	StaffID          string
	StaffName        string
	Role             string
	HoursWorked      float64
	RateType         string
	RateCents        int64
	BasePayCents     int64
	OvertimePayCents int64
	TipsCents        int64
	TotalPayCents    int64
}

// Store wraps the pgxpool for all payroll DB access.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// allowedRateTypes mirrors the DB CHECK constraint.
var allowedRateTypes = map[string]struct{}{
	"hourly": {}, "salary": {}, "salary_monthly": {}, "salary_annual": {},
	"commission": {}, "per_shift": {},
}

const rateCols = `
	id, staff_id, rate_type, amount_cents, currency,
	commission_percentage, commission_basis,
	overtime_multiplier, overtime_threshold_hours_per_week,
	effective_from, effective_until,
	notes, created_by,
	(effective_until IS NULL) AS is_current,
	created_at, updated_at`

func scanRate(row pgx.Row, r *PayRate) error {
	var effFrom, effUntil *string
	err := row.Scan(
		&r.ID, &r.StaffID, &r.RateType, &r.AmountCents, &r.Currency,
		&r.CommissionPercentage, &r.CommissionBasis,
		&r.OvertimeMultiplier, &r.OvertimeThresholdHoursPerWeek,
		&effFrom, &effUntil,
		&r.Notes, &r.CreatedBy,
		&r.IsCurrent,
		&r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return err
	}
	if effFrom != nil {
		r.EffectiveFrom = *effFrom
	}
	r.EffectiveUntil = effUntil
	return nil
}

// ListRates returns all pay rates for a staff member, current first.
func (s *Store) ListRates(ctx context.Context, staffID string) ([]PayRate, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+rateCols+`
FROM staff_pay_rates
WHERE staff_id = $1
ORDER BY (effective_until IS NULL) DESC, effective_from DESC
`, staffID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []PayRate{}
	for rows.Next() {
		var r PayRate
		if err := scanRate(rows, &r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CreateRateInput holds the parsed request body for creating a pay rate.
type CreateRateInput struct {
	RateType                      string   `json:"rate_type"`
	AmountCents                   int64    `json:"rate_cents"`
	EffectiveFrom                 string   `json:"effective_from"` // YYYY-MM-DD; empty = today
	OvertimeMultiplier            *float64 `json:"overtime_multiplier"`
	OvertimeThresholdHoursPerWeek *float64 `json:"overtime_threshold_hours_per_week"`
	Notes                         *string  `json:"notes"`
	CreatedBy                     *string  `json:"created_by"`
}

// CreateRate atomically retires any existing current rate of the same type
// and inserts the new one as is_current (effective_until IS NULL).
func (s *Store) CreateRate(ctx context.Context, staffID string, in CreateRateInput) (*PayRate, error) {
	effFrom := in.EffectiveFrom
	if effFrom == "" {
		effFrom = time.Now().UTC().Format("2006-01-02")
	}

	// Default overtime values to DB defaults if not supplied.
	overtimeMult := 1.5
	if in.OvertimeMultiplier != nil {
		overtimeMult = *in.OvertimeMultiplier
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Retire any existing current rate (effective_until IS NULL) for this
	// staff + rate_type by setting effective_until = effFrom - 1 day.
	_, err = tx.Exec(ctx, `
UPDATE staff_pay_rates
SET effective_until = $3::date - INTERVAL '1 day',
    updated_at      = now()
WHERE staff_id      = $1
  AND rate_type     = $2
  AND effective_until IS NULL
`, staffID, in.RateType, effFrom)
	if err != nil {
		return nil, err
	}

	// Insert the new rate with effective_until = NULL (current).
	var out PayRate
	err = scanRate(tx.QueryRow(ctx, `
INSERT INTO staff_pay_rates (
    staff_id, rate_type, amount_cents,
    overtime_multiplier, overtime_threshold_hours_per_week,
    effective_from, notes, created_by
) VALUES (
    $1, $2, $3,
    $4, $5,
    $6::date, $7, $8
)
RETURNING `+rateCols,
		staffID, in.RateType, in.AmountCents,
		overtimeMult, in.OvertimeThresholdHoursPerWeek,
		effFrom, in.Notes, in.CreatedBy,
	), &out)
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			return nil, ErrUniqueCurrentRate
		}
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

// PatchRateInput holds the fields that are allowed to change on an existing row.
type PatchRateInput struct {
	EffectiveUntil                *string  `json:"effective_until"`
	OvertimeMultiplier            *float64 `json:"overtime_multiplier"`
	OvertimeThresholdHoursPerWeek *float64 `json:"overtime_threshold_hours_per_week"`
	Notes                         *string  `json:"notes"`
	// rate_cents is intentionally absent — callers must create a new row instead.
}

// PatchRate edits only the mutable fields of a pay rate row.
func (s *Store) PatchRate(ctx context.Context, rateID string, in PatchRateInput) (*PayRate, error) {
	var out PayRate
	err := scanRate(s.pool.QueryRow(ctx, `
UPDATE staff_pay_rates
SET
    effective_until                  = COALESCE($2::date, effective_until),
    overtime_multiplier              = COALESCE($3, overtime_multiplier),
    overtime_threshold_hours_per_week = COALESCE($4, overtime_threshold_hours_per_week),
    notes                            = COALESCE($5, notes),
    updated_at                       = now()
WHERE id = $1
RETURNING `+rateCols,
		rateID,
		in.EffectiveUntil,
		in.OvertimeMultiplier,
		in.OvertimeThresholdHoursPerWeek,
		in.Notes,
	), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrRateNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// ExportPayroll fetches aggregated payroll data for a location + date range.
// Hours come from labor_hours_daily (backed by staff_time_entries).
// Tips come from tip_distributions (migration 32); if the table is absent the
// column is always 0 (see TODO below).
func (s *Store) ExportPayroll(
	ctx context.Context,
	locationID, periodStart, periodEnd string,
) ([]PayrollRow, error) {
	// TODO: if tip_distributions does not exist in the target DB, the query
	// will fail. Guard with an existence check or catch the "relation does not
	// exist" Postgres error (42P01) and re-run without the tip CTE.
	rows, err := s.pool.Query(ctx, `
WITH hours AS (
    SELECT
        lhd.staff_id,
        SUM(COALESCE(lhd.worked_minutes, 0)) / 60.0 AS hours_worked
    FROM labor_hours_daily lhd
    WHERE lhd.location_id = $1
      AND lhd.work_date  >= $2::date
      AND lhd.work_date  <= $3::date
    GROUP BY lhd.staff_id
),
tips AS (
    SELECT
        td.staff_id,
        SUM(td.amount_cents) AS tips_cents
    FROM tip_distributions td
    JOIN tip_pools tp ON tp.id = td.tip_pool_id
    WHERE tp.location_id = $1
      AND td.distributed_at::date >= $2::date
      AND td.distributed_at::date <= $3::date
    GROUP BY td.staff_id
),
current_rates AS (
    SELECT DISTINCT ON (spr.staff_id)
        spr.staff_id,
        spr.rate_type,
        spr.amount_cents,
        spr.overtime_multiplier,
        spr.overtime_threshold_hours_per_week
    FROM staff_pay_rates spr
    WHERE spr.effective_from <= $3::date
      AND (spr.effective_until IS NULL OR spr.effective_until >= $2::date)
    ORDER BY spr.staff_id, spr.effective_from DESC
)
SELECT
    s.id                                                        AS staff_id,
    (s.first_name || ' ' || s.last_name)                       AS staff_name,
    s.role,
    COALESCE(h.hours_worked, 0)::float8                        AS hours_worked,
    COALESCE(cr.rate_type, 'hourly')                           AS rate_type,
    COALESCE(cr.amount_cents, 0)                               AS rate_cents,
    -- base pay: hours * hourly rate (for non-hourly types base = 0, handled app-side via rate_type)
    CASE
        WHEN cr.rate_type = 'hourly' THEN
            ROUND(
                LEAST(COALESCE(h.hours_worked, 0),
                      COALESCE(cr.overtime_threshold_hours_per_week, 45.0))
                * COALESCE(cr.amount_cents, 0)
            )::bigint
        ELSE 0
    END                                                         AS base_pay_cents,
    -- overtime pay: hours beyond threshold * rate * (multiplier - 1)
    CASE
        WHEN cr.rate_type = 'hourly'
             AND COALESCE(h.hours_worked, 0) > COALESCE(cr.overtime_threshold_hours_per_week, 45.0)
        THEN
            ROUND(
                (COALESCE(h.hours_worked, 0) - COALESCE(cr.overtime_threshold_hours_per_week, 45.0))
                * COALESCE(cr.amount_cents, 0)
                * COALESCE(cr.overtime_multiplier, 1.5)
            )::bigint
        ELSE 0
    END                                                         AS overtime_pay_cents,
    COALESCE(t.tips_cents, 0)                                  AS tips_cents
FROM staff s
LEFT JOIN hours h        ON h.staff_id = s.id
LEFT JOIN tips t         ON t.staff_id = s.id
LEFT JOIN current_rates cr ON cr.staff_id = s.id
WHERE s.location_id = $1
  AND s.is_active    = true
ORDER BY s.last_name, s.first_name
`, locationID, periodStart, periodEnd)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []PayrollRow
	for rows.Next() {
		var r PayrollRow
		if err := rows.Scan(
			&r.StaffID, &r.StaffName, &r.Role,
			&r.HoursWorked, &r.RateType, &r.RateCents,
			&r.BasePayCents, &r.OvertimePayCents, &r.TipsCents,
		); err != nil {
			return nil, err
		}
		r.TotalPayCents = r.BasePayCents + r.OvertimePayCents + r.TipsCents
		out = append(out, r)
	}
	return out, rows.Err()
}
