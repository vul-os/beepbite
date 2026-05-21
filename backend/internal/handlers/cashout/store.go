// Package cashout provides the cash-out report endpoint: for a given
// cash_drawer_session, it assembles the full shift reconciliation — opening
// float, cash sales, movements (paid_in / paid_out / no_sale / etc.), the
// expected cash in the drawer, the counted cash (from the close count if
// present), and the variance (over/short). If a pos_shift / staff member is
// linked to the session it is included so the UI can show who holds the
// difference.
package cashout

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ErrSessionNotFound is surfaced when the requested session_id does not exist
// within the caller's org scope.
var ErrSessionNotFound = errors.New("cash drawer session not found")

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

// MovementLine is a single cash_drawer_movements row included in the report.
type MovementLine struct {
	ID           string    `json:"id"`
	MovementType string    `json:"movement_type"`
	AmountCents  int64     `json:"amount_cents"`
	Reason       *string   `json:"reason"`
	PerformedBy  *string   `json:"performed_by"`
	CreatedAt    time.Time `json:"created_at"`
}

// StaffSummary carries the optional staff member linked to the session via
// pos_shifts.
type StaffSummary struct {
	ShiftID    string     `json:"shift_id"`
	StaffID    string     `json:"staff_id"`
	OpenedAt   time.Time  `json:"opened_at"`
	ClosedAt   *time.Time `json:"closed_at"`
	ShiftNotes *string    `json:"shift_notes"`
}

// Report is the full cash-out report returned by GetReport.
//
// Formula:
//
//	expected_cash_cents = opening_float_cents
//	                    + cash_sales_cents           (order_payments, method='cash')
//	                    + movements_net_cents         (SUM of all movement amounts — signed)
//
//	variance_cents      = counted_cash_cents - expected_cash_cents
//	                      (positive = over; negative = short; nil = not yet counted)
type Report struct {
	// Session identification
	SessionID    string     `json:"session_id"`
	CashDrawerID string     `json:"cash_drawer_id"`
	LocationID   string     `json:"location_id"`
	Status       string     `json:"status"`
	OpenedAt     time.Time  `json:"opened_at"`
	ClosedAt     *time.Time `json:"closed_at"`
	IsBlindClose bool       `json:"is_blind_close"`

	// Reconciliation fields (all in cents)
	OpeningFloatCents  int64  `json:"opening_float_cents"`
	CashSalesCents     int64  `json:"cash_sales_cents"`
	MovementsNetCents  int64  `json:"movements_net_cents"`
	ExpectedCashCents  int64  `json:"expected_cash_cents"`
	CountedCashCents   *int64 `json:"counted_cash_cents"`   // nil if no close count yet
	VarianceCents      *int64 `json:"variance_cents"`        // positive=over, negative=short, nil if uncounted
	IsBalanced         bool   `json:"is_balanced"`           // true when variance == 0 or counted > expected

	// Pre-computed server field (set at close time by cashdrawer handler)
	DeclaredClosingCents *int64 `json:"declared_closing_cents"`
	OverShortCents       *int64 `json:"over_short_cents"`

	// Movement detail
	Movements []MovementLine `json:"movements"`

	// Optional staff linkage
	Staff *StaffSummary `json:"staff,omitempty"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store holds the pgxpool used for all database access.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore returns a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// SessionLocationID resolves a session's location_id via the drawer chain.
// Returns ErrSessionNotFound when the session does not exist within the org
// scope.
func (s *Store) SessionLocationID(ctx context.Context, sessionID string) (string, error) {
	var locID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT cd.location_id
			FROM cash_drawer_sessions cds
			JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
			WHERE cds.id = $1
		`, sessionID).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrSessionNotFound
	}
	return locID, err
}

// GetReport assembles the full cash-out report for a session in a single
// database round-trip per logical query (all inside one tx to get a
// consistent snapshot).
func (s *Store) GetReport(ctx context.Context, sessionID string) (*Report, error) {
	var r Report
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// 1. Session header + drawer/location info in one join.
		err := tx.QueryRow(ctx, `
			SELECT cds.id,
			       cds.cash_drawer_id,
			       cd.location_id,
			       cds.status,
			       cds.opened_at,
			       cds.closed_at,
			       cds.is_blind_close,
			       cds.opening_float_cents,
			       cds.declared_closing_cents,
			       cds.over_short_cents
			FROM cash_drawer_sessions cds
			JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
			WHERE cds.id = $1
		`, sessionID).Scan(
			&r.SessionID,
			&r.CashDrawerID,
			&r.LocationID,
			&r.Status,
			&r.OpenedAt,
			&r.ClosedAt,
			&r.IsBlindClose,
			&r.OpeningFloatCents,
			&r.DeclaredClosingCents,
			&r.OverShortCents,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrSessionNotFound
		}
		if err != nil {
			return err
		}

		// 2. Cash sales: sum of order_payments where method='cash', linked via
		//    cash_drawer_session_payments bridge table.
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(op.amount_paid_cents), 0)
			FROM cash_drawer_session_payments cdsp
			JOIN order_payments op ON op.id = cdsp.payment_id
			WHERE cdsp.cash_drawer_session_id = $1
			  AND op.payment_method_code = 'cash'
		`, sessionID).Scan(&r.CashSalesCents); err != nil {
			return err
		}

		// 3. Movements: fetch all rows and compute net in one pass.
		rows, err := tx.Query(ctx, `
			SELECT id, movement_type, amount_cents, reason, performed_by, created_at
			FROM cash_drawer_movements
			WHERE cash_drawer_session_id = $1
			ORDER BY created_at ASC
		`, sessionID)
		if err != nil {
			return err
		}
		defer rows.Close()
		r.Movements = []MovementLine{}
		for rows.Next() {
			var m MovementLine
			if err := rows.Scan(
				&m.ID, &m.MovementType, &m.AmountCents,
				&m.Reason, &m.PerformedBy, &m.CreatedAt,
			); err != nil {
				return err
			}
			r.MovementsNetCents += m.AmountCents
			r.Movements = append(r.Movements, m)
		}
		if err := rows.Err(); err != nil {
			return err
		}

		// 4. Expected cash in drawer.
		//    expected = opening_float + cash_sales + movements_net
		r.ExpectedCashCents = r.OpeningFloatCents + r.CashSalesCents + r.MovementsNetCents

		// 5. Counted cash: most recent 'close' count (nil if session is still open
		//    or no count was recorded).
		var counted *int64
		err = tx.QueryRow(ctx, `
			SELECT total_cents
			FROM cash_drawer_counts
			WHERE cash_drawer_session_id = $1
			  AND count_type = 'close'
			ORDER BY created_at DESC
			LIMIT 1
		`, sessionID).Scan(&counted)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		r.CountedCashCents = counted

		// 6. Variance: counted - expected (nil when not yet counted).
		if counted != nil {
			v := *counted - r.ExpectedCashCents
			r.VarianceCents = &v
			r.IsBalanced = v >= 0
		}

		// 7. Optional staff linkage via pos_shifts.
		var sh StaffSummary
		err = tx.QueryRow(ctx, `
			SELECT id, opened_by, opened_at, closed_at, notes
			FROM pos_shifts
			WHERE cash_drawer_session_id = $1
			ORDER BY opened_at DESC
			LIMIT 1
		`, sessionID).Scan(
			&sh.ShiftID, &sh.StaffID, &sh.OpenedAt, &sh.ClosedAt, &sh.ShiftNotes,
		)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && sh.StaffID != "" {
			r.Staff = &sh
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return &r, nil
}
