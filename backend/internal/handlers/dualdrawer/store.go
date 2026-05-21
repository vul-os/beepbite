// Package dualdrawer provides the Wave-32 "dual cash drawer" feature:
// two cashiers sharing one POS terminal, each with their own drawer session.
//
// Schema approach
// ---------------
// Migration 009 creates cash_drawers (one row per physical drawer per location)
// and cash_drawer_sessions with a partial unique index that enforces at most
// ONE open session per cash_drawer row. To support two cashiers running
// simultaneously we require two physical cash_drawer rows — one per cashier.
// The cashier_label column (added in migration 029) decorates the session with
// the cashier's display name so the terminal can show both drawers side-by-side.
//
// The existing cashdrawer package handles every other lifecycle operation
// (movements, close, reconcile). This package only adds the dual-drawer
// open flow and the location-wide "list open sessions" view.
package dualdrawer

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

var (
	// ErrLabelRequired is returned when the caller omits the cashier_label.
	ErrLabelRequired = errors.New("cashier_label is required")

	// ErrDrawerHasOpen is returned when the target drawer already has an open
	// session (mirrors cashdrawer.ErrDrawerHasOpen — kept local to avoid an
	// import cycle and because the HTTP meaning is the same: 409 Conflict).
	ErrDrawerHasOpen = errors.New("drawer already has an open session")

	// ErrDrawerNotFound is returned when the drawer_id does not exist or is
	// not visible to the current org scope.
	ErrDrawerNotFound = errors.New("cash drawer not found")

	// ErrLocationNotFound is returned when no cash_drawers exist at the given
	// location, or when the location is not in the caller's org scope.
	ErrLocationNotFound = errors.New("location not found or no drawers configured")
)

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

// OpenSession is a subset of cash_drawer_sessions columns surfaced by the
// dual-drawer view.  The full session lifecycle (movements, close, reconcile)
// is handled by the existing /cash-drawers/… endpoints.
type OpenSession struct {
	ID                string     `json:"id"`
	CashDrawerID      string     `json:"cash_drawer_id"`
	DrawerName        string     `json:"drawer_name"`   // cash_drawers.name
	CashierLabel      *string    `json:"cashier_label"` // may be NULL for sessions opened outside this endpoint
	OpenedBy          *string    `json:"opened_by"`
	OpeningFloatCents int64      `json:"opening_float_cents"`
	OpenedAt          time.Time  `json:"opened_at"`
	Status            string     `json:"status"`
	CreatedAt         time.Time  `json:"created_at"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// LocationIDForDrawer returns the location_id for a cash drawer row, or
// ErrDrawerNotFound when no such drawer exists (or is not visible through RLS).
func (s *Store) LocationIDForDrawer(ctx context.Context, drawerID string) (string, error) {
	var locID string
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT location_id FROM cash_drawers WHERE id = $1`,
			drawerID,
		).Scan(&locID)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrDrawerNotFound
	}
	return locID, err
}

// ListOpenSessions returns all cash_drawer_sessions with status='open' for the
// given location_id, joined with the drawer name. Results are ordered by
// opened_at ascending so the earlier cashier appears first in the UI.
func (s *Store) ListOpenSessions(ctx context.Context, locationID string) ([]OpenSession, error) {
	out := []OpenSession{}
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT
    cds.id,
    cds.cash_drawer_id,
    cd.name          AS drawer_name,
    cds.cashier_label,
    cds.opened_by,
    cds.opening_float_cents,
    cds.opened_at,
    cds.status,
    cds.created_at
FROM cash_drawer_sessions cds
JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
WHERE cd.location_id = $1
  AND cds.status = 'open'
ORDER BY cds.opened_at ASC
`, locationID)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var sess OpenSession
			if err := rows.Scan(
				&sess.ID,
				&sess.CashDrawerID,
				&sess.DrawerName,
				&sess.CashierLabel,
				&sess.OpenedBy,
				&sess.OpeningFloatCents,
				&sess.OpenedAt,
				&sess.Status,
				&sess.CreatedAt,
			); err != nil {
				return err
			}
			out = append(out, sess)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// OpenSession opens a new cash_drawer_session on the given drawer with a
// required cashier_label. It inserts the session and the opening count
// atomically inside one transaction.
//
// The database enforces at most one open session per drawer via the partial
// unique index one_open_session_per_drawer; a 23505 violation is translated
// to ErrDrawerHasOpen (→ HTTP 409) so callers know to pick a different drawer.
func (s *Store) OpenSession(
	ctx context.Context,
	drawerID string,
	cashierLabel string,
	openingFloatCents int64,
	openedByStaffID string,
) (*OpenSession, error) {
	if cashierLabel == "" {
		return nil, ErrLabelRequired
	}

	var out OpenSession
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// Insert the session. The unique partial index will reject a second open
		// session on the same drawer with error code 23505.
		err := tx.QueryRow(ctx, `
INSERT INTO cash_drawer_sessions (
    cash_drawer_id,
    cashier_label,
    opened_by,
    opening_float_cents
) VALUES ($1, $2, $3, $4)
RETURNING
    id,
    cash_drawer_id,
    cashier_label,
    opened_by,
    opening_float_cents,
    opened_at,
    status,
    created_at
`,
			drawerID,
			cashierLabel,
			nullStr(openedByStaffID),
			openingFloatCents,
		).Scan(
			&out.ID,
			&out.CashDrawerID,
			&out.CashierLabel,
			&out.OpenedBy,
			&out.OpeningFloatCents,
			&out.OpenedAt,
			&out.Status,
			&out.CreatedAt,
		)
		if err != nil {
			var pg *pgconn.PgError
			if errors.As(err, &pg) && pg.Code == "23505" {
				return ErrDrawerHasOpen
			}
			return err
		}

		// Opening count row so reconciliation has a full float audit trail.
		if _, err := tx.Exec(ctx, `
INSERT INTO cash_drawer_counts (cash_drawer_session_id, count_type, total_cents, counted_by)
VALUES ($1, 'open', $2, $3)
`, out.ID, openingFloatCents, nullStr(openedByStaffID)); err != nil {
			return err
		}

		// Fetch the drawer name so the response is self-contained.
		return tx.QueryRow(ctx,
			`SELECT name FROM cash_drawers WHERE id = $1`, drawerID,
		).Scan(&out.DrawerName)
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// nullStr converts an empty string to a nil interface so it is stored as SQL
// NULL rather than an empty string. Mirrors the helper in the cashdrawer package.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
