package cashdrawer

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors bubbled up to the HTTP layer for status-code mapping.
var (
	ErrSessionNotFound = errors.New("cash drawer session not found")
	ErrSessionNotOpen  = errors.New("cash drawer session is not open")
	ErrDrawerHasOpen   = errors.New("drawer already has an open session")
)

// Session mirrors a cash_drawer_sessions row. Nullable DB columns become
// pointers so JSON emits `null` rather than zero values.
type Session struct {
	ID                   string     `json:"id"`
	CashDrawerID         string     `json:"cash_drawer_id"`
	OpenedBy             *string    `json:"opened_by"`
	ClosedBy             *string    `json:"closed_by"`
	OpeningFloatCents    int64      `json:"opening_float_cents"`
	DeclaredClosingCents *int64     `json:"declared_closing_cents"`
	ExpectedClosingCents *int64     `json:"expected_closing_cents"`
	OverShortCents       *int64     `json:"over_short_cents"`
	IsBlindClose         bool       `json:"is_blind_close"`
	Status               string     `json:"status"`
	OpenedAt             time.Time  `json:"opened_at"`
	ClosedAt             *time.Time `json:"closed_at"`
	Notes                *string    `json:"notes"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
}

// SessionDetail is what GET /sessions/{id} returns — same as Session plus a
// movements count so the UI can avoid a second round trip for the summary.
type SessionDetail struct {
	Session
	MovementsCount int64 `json:"movements_count"`
}

type Movement struct {
	ID                  string    `json:"id"`
	CashDrawerSessionID string    `json:"cash_drawer_session_id"`
	MovementType        string    `json:"movement_type"`
	AmountCents         int64     `json:"amount_cents"`
	Reason              *string   `json:"reason"`
	ReferenceType       *string   `json:"reference_type"`
	ReferenceID         *string   `json:"reference_id"`
	PerformedBy         *string   `json:"performed_by"`
	ApprovedBy          *string   `json:"approved_by"`
	CreatedAt           time.Time `json:"created_at"`
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const sessionCols = `id, cash_drawer_id, opened_by, closed_by,
	opening_float_cents, declared_closing_cents, expected_closing_cents, over_short_cents,
	is_blind_close, status, opened_at, closed_at, notes, created_at, updated_at`

func scanSession(row pgx.Row, s *Session) error {
	return row.Scan(
		&s.ID, &s.CashDrawerID, &s.OpenedBy, &s.ClosedBy,
		&s.OpeningFloatCents, &s.DeclaredClosingCents, &s.ExpectedClosingCents, &s.OverShortCents,
		&s.IsBlindClose, &s.Status, &s.OpenedAt, &s.ClosedAt, &s.Notes, &s.CreatedAt, &s.UpdatedAt,
	)
}

// OpenSession inserts the session and its opening count in a single tx. The
// partial unique index `one_open_session_per_drawer` guarantees at most one
// open session per drawer; we translate the 23505 unique-violation into
// ErrDrawerHasOpen so the handler returns 409.
func (s *Store) OpenSession(
	ctx context.Context,
	drawerID string,
	openingFloatCents int64,
	openedBy string,
	isBlindClose bool,
	denominationsJSON []byte,
) (*Session, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var out Session
	err = scanSession(tx.QueryRow(ctx, `
INSERT INTO cash_drawer_sessions (cash_drawer_id, opened_by, opening_float_cents, is_blind_close)
VALUES ($1, $2, $3, $4)
RETURNING `+sessionCols, drawerID, nullStr(openedBy), openingFloatCents, isBlindClose), &out)
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			return nil, ErrDrawerHasOpen
		}
		return nil, err
	}

	// Opening count row mirrors the float so reconciliation has a full audit
	// trail from open→close.
	if _, err := tx.Exec(ctx, `
INSERT INTO cash_drawer_counts (cash_drawer_session_id, count_type, total_cents, denominations, counted_by)
VALUES ($1, 'open', $2, $3, $4)
`, out.ID, openingFloatCents, nullBytes(denominationsJSON), nullStr(openedBy)); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) GetSession(ctx context.Context, sessionID string) (*Session, error) {
	var out Session
	err := scanSession(s.pool.QueryRow(ctx,
		`SELECT `+sessionCols+` FROM cash_drawer_sessions WHERE id = $1`, sessionID), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) GetSessionDetail(ctx context.Context, sessionID string) (*SessionDetail, error) {
	sess, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}
	var count int64
	if err := s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM cash_drawer_movements WHERE cash_drawer_session_id = $1`,
		sessionID).Scan(&count); err != nil {
		return nil, err
	}
	return &SessionDetail{Session: *sess, MovementsCount: count}, nil
}

// ListSessions returns up to 50 sessions for a drawer, newest first. An empty
// status string means "any status".
func (s *Store) ListSessions(ctx context.Context, drawerID, status string) ([]Session, error) {
	sb := &strings.Builder{}
	sb.WriteString("SELECT ")
	sb.WriteString(sessionCols)
	sb.WriteString(" FROM cash_drawer_sessions WHERE cash_drawer_id = $1")
	args := []any{drawerID}
	if status != "" {
		sb.WriteString(" AND status = $2")
		args = append(args, status)
	}
	sb.WriteString(" ORDER BY opened_at DESC LIMIT 50")

	rows, err := s.pool.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Session{}
	for rows.Next() {
		var sess Session
		if err := scanSession(rows, &sess); err != nil {
			return nil, err
		}
		out = append(out, sess)
	}
	return out, rows.Err()
}

// InsertMovement records a cash movement against an OPEN session. The session
// check is done inside the same tx to avoid the race where a session closes
// between our SELECT and INSERT.
func (s *Store) InsertMovement(
	ctx context.Context,
	sessionID, movementType string,
	amountCents int64,
	reason, referenceType, performedBy, approvedBy, referenceID string,
) (*Movement, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx,
		`SELECT status FROM cash_drawer_sessions WHERE id = $1 FOR UPDATE`, sessionID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != "open" {
		return nil, ErrSessionNotOpen
	}

	var m Movement
	err = tx.QueryRow(ctx, `
INSERT INTO cash_drawer_movements (
	cash_drawer_session_id, movement_type, amount_cents, reason,
	reference_type, reference_id, performed_by, approved_by
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, cash_drawer_session_id, movement_type, amount_cents, reason,
	reference_type, reference_id, performed_by, approved_by, created_at
`, sessionID, movementType, amountCents,
		nullStr(reason), nullStr(referenceType), nullStr(referenceID),
		nullStr(performedBy), nullStr(approvedBy),
	).Scan(
		&m.ID, &m.CashDrawerSessionID, &m.MovementType, &m.AmountCents, &m.Reason,
		&m.ReferenceType, &m.ReferenceID, &m.PerformedBy, &m.ApprovedBy, &m.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &m, nil
}

// CloseSession computes expected_closing_cents and applies all close-time
// side effects in one tx. The reconciliation formula is:
//
//	expected = opening_float_cents
//	         + SUM(cash order_payments linked via cash_drawer_session_payments)
//	         + SUM(cash_drawer_movements.amount_cents)   -- signed
//
// over_short = declared - expected.
func (s *Store) CloseSession(
	ctx context.Context,
	sessionID, closedBy string,
	declaredClosingCents int64,
	denominationsJSON []byte,
	notes string,
) (*Session, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var status string
	var openingFloat int64
	err = tx.QueryRow(ctx,
		`SELECT status, opening_float_cents FROM cash_drawer_sessions WHERE id = $1 FOR UPDATE`,
		sessionID).Scan(&status, &openingFloat)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != "open" {
		return nil, ErrSessionNotOpen
	}

	var cashSales int64
	if err := tx.QueryRow(ctx, `
SELECT COALESCE(SUM(op.amount_cents), 0)
FROM cash_drawer_session_payments cdsp
JOIN order_payments op ON op.id = cdsp.payment_id
JOIN payment_methods pm ON pm.id = op.payment_method_id
WHERE cdsp.cash_drawer_session_id = $1 AND pm.code = 'cash'
`, sessionID).Scan(&cashSales); err != nil {
		return nil, err
	}

	var movementsSum int64
	if err := tx.QueryRow(ctx, `
SELECT COALESCE(SUM(amount_cents), 0)
FROM cash_drawer_movements
WHERE cash_drawer_session_id = $1
`, sessionID).Scan(&movementsSum); err != nil {
		return nil, err
	}

	expected := openingFloat + cashSales + movementsSum
	overShort := declaredClosingCents - expected

	var out Session
	// COALESCE on notes preserves whatever was already there when the caller
	// passes an empty string.
	err = scanSession(tx.QueryRow(ctx, `
UPDATE cash_drawer_sessions
SET declared_closing_cents = $2,
    expected_closing_cents = $3,
    over_short_cents       = $4,
    closed_by              = $5,
    closed_at              = now(),
    status                 = 'closed',
    notes                  = COALESCE(NULLIF($6, ''), notes),
    updated_at             = now()
WHERE id = $1
RETURNING `+sessionCols,
		sessionID, declaredClosingCents, expected, overShort, nullStr(closedBy), notes), &out)
	if err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO cash_drawer_counts (cash_drawer_session_id, count_type, total_cents, denominations, counted_by)
VALUES ($1, 'close', $2, $3, $4)
`, sessionID, declaredClosingCents, nullBytes(denominationsJSON), nullStr(closedBy)); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

// nullStr lets optional string fields arrive as real SQL NULL, not ''.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullBytes keeps jsonb columns NULL when the caller didn't send one.
func nullBytes(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}
