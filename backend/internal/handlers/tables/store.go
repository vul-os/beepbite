package tables

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors surfaced to the HTTP layer.
var (
	ErrSessionNotFound    = errors.New("table session not found")
	ErrSessionNotOpen     = errors.New("table session is not open")
	ErrTableHasOpenSession = errors.New("table already has an open session")
	ErrSeatNotFound       = errors.New("seat not found")
	ErrDuplicateSeat      = errors.New("seat number already exists in this session")
	ErrDuplicateSplitLabel = errors.New("split label already exists for this session")
)

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// nullStr converts an empty string to SQL NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullInt converts 0 to SQL NULL for optional integer fields.
func nullInt(i int) any {
	if i == 0 {
		return nil
	}
	return i
}

const sessionCols = `id, table_id, location_id, opened_by, party_size, status,
	opened_at, closed_at, transferred_to_session_id, notes, created_at, updated_at`

func scanSession(row pgx.Row, s *TableSession) error {
	return row.Scan(
		&s.ID, &s.TableID, &s.LocationID, &s.OpenedBy, &s.PartySize, &s.Status,
		&s.OpenedAt, &s.ClosedAt, &s.TransferredToSessionID, &s.Notes, &s.CreatedAt, &s.UpdatedAt,
	)
}

const seatCols = `id, table_session_id, seat_number, guest_name, created_at, updated_at`

func scanSeat(row pgx.Row, s *Seat) error {
	return row.Scan(&s.ID, &s.TableSessionID, &s.SeatNumber, &s.GuestName, &s.CreatedAt, &s.UpdatedAt)
}

// isPgUniqueViolation returns true when err is a Postgres unique-violation (23505).
func isPgUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// -------------------------------------------------------------------
// Session operations
// -------------------------------------------------------------------

// OpenSession inserts a new table_session. The partial unique index
// one_open_session_per_table enforces at most one open session per table;
// a 23505 unique violation is translated to ErrTableHasOpenSession (→ 409).
func (s *Store) OpenSession(
	ctx context.Context,
	tableID, locationID, openedBy string,
	partySize int,
	notes string,
) (*TableSession, error) {
	var out TableSession
	err := scanSession(s.pool.QueryRow(ctx, `
INSERT INTO table_sessions (table_id, location_id, opened_by, party_size, notes)
VALUES ($1, $2, $3, $4, $5)
RETURNING `+sessionCols,
		tableID, locationID, nullStr(openedBy), partySize, nullStr(notes),
	), &out)
	if err != nil {
		if isPgUniqueViolation(err) {
			return nil, ErrTableHasOpenSession
		}
		return nil, err
	}
	return &out, nil
}

// GetSession fetches a single session by ID.
func (s *Store) GetSession(ctx context.Context, sessionID string) (*TableSession, error) {
	var out TableSession
	err := scanSession(s.pool.QueryRow(ctx,
		`SELECT `+sessionCols+` FROM table_sessions WHERE id = $1`, sessionID,
	), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// GetSessionDetail fetches the session, its seats, and linked orders.
func (s *Store) GetSessionDetail(ctx context.Context, sessionID string) (*SessionDetail, error) {
	sess, err := s.GetSession(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	seats, err := s.ListSeats(ctx, sessionID)
	if err != nil {
		return nil, err
	}

	rows, err := s.pool.Query(ctx, `
SELECT id, order_type, status, course_number, created_at
FROM orders
WHERE table_session_id = $1
ORDER BY created_at ASC`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	orders := []Order{}
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.OrderType, &o.Status, &o.CourseNumber, &o.CreatedAt); err != nil {
			return nil, err
		}
		orders = append(orders, o)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &SessionDetail{TableSession: *sess, Seats: seats, Orders: orders}, nil
}

// CloseSession sets closed_at + status='closed' in a single transaction.
// Returns ErrSessionNotFound / ErrSessionNotOpen on mismatches.
func (s *Store) CloseSession(
	ctx context.Context,
	sessionID string,
	partySize int,
	notes string,
) (*TableSession, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var status string
	err = tx.QueryRow(ctx,
		`SELECT status FROM table_sessions WHERE id = $1 FOR UPDATE`, sessionID,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != "open" {
		return nil, ErrSessionNotOpen
	}

	var out TableSession
	err = scanSession(tx.QueryRow(ctx, `
UPDATE table_sessions
SET status     = 'closed',
    closed_at  = timezone('utc'::text, now()),
    party_size = CASE WHEN $2::int > 0 THEN $2::int ELSE party_size END,
    notes      = COALESCE(NULLIF($3, ''), notes),
    updated_at = timezone('utc'::text, now())
WHERE id = $1
RETURNING `+sessionCols,
		sessionID, partySize, notes,
	), &out)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

// TransferSession closes the current session (status='transferred') and opens a
// new one on toTableID. Both writes happen in a single transaction.
// Returns the new session.
func (s *Store) TransferSession(
	ctx context.Context,
	sessionID, toTableID, openedBy string,
	partySize int,
	notes string,
) (*TableSession, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Lock and validate source session.
	var srcStatus string
	var srcLocationID string
	var srcPartySize int
	err = tx.QueryRow(ctx,
		`SELECT status, location_id, party_size FROM table_sessions WHERE id = $1 FOR UPDATE`, sessionID,
	).Scan(&srcStatus, &srcLocationID, &srcPartySize)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	if srcStatus != "open" {
		return nil, ErrSessionNotOpen
	}

	// Use source party_size if caller didn't supply one.
	if partySize <= 0 {
		partySize = srcPartySize
	}

	// Open new session on target table (may fail with unique violation).
	var newSess TableSession
	err = scanSession(tx.QueryRow(ctx, `
INSERT INTO table_sessions (table_id, location_id, opened_by, party_size, notes)
VALUES ($1, $2, $3, $4, $5)
RETURNING `+sessionCols,
		toTableID, srcLocationID, nullStr(openedBy), partySize, nullStr(notes),
	), &newSess)
	if err != nil {
		if isPgUniqueViolation(err) {
			return nil, ErrTableHasOpenSession
		}
		return nil, err
	}

	// Mark source session as transferred and point to the new session.
	if _, err := tx.Exec(ctx, `
UPDATE table_sessions
SET status                    = 'transferred',
    transferred_to_session_id = $2,
    updated_at                = timezone('utc'::text, now())
WHERE id = $1`, sessionID, newSess.ID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &newSess, nil
}

// SplitCheck creates check_splits + check_split_items rows in one transaction.
func (s *Store) SplitCheck(
	ctx context.Context,
	sessionID, createdBy string,
	splits []splitSpec,
) (*SplitCheckResult, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Ensure session exists and is open.
	var status string
	err = tx.QueryRow(ctx,
		`SELECT status FROM table_sessions WHERE id = $1 FOR UPDATE`, sessionID,
	).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	if status != "open" {
		return nil, ErrSessionNotOpen
	}

	result := &SplitCheckResult{
		Splits: []CheckSplit{},
		Items:  []CheckSplitItem{},
	}

	for _, sp := range splits {
		var cs CheckSplit
		err = tx.QueryRow(ctx, `
INSERT INTO check_splits (table_session_id, split_label, created_by)
VALUES ($1, $2, $3)
RETURNING id, table_session_id, split_label, created_by, created_at, updated_at`,
			sessionID, sp.Label, nullStr(createdBy),
		).Scan(&cs.ID, &cs.TableSessionID, &cs.SplitLabel, &cs.CreatedBy, &cs.CreatedAt, &cs.UpdatedAt)
		if err != nil {
			if isPgUniqueViolation(err) {
				return nil, ErrDuplicateSplitLabel
			}
			return nil, err
		}
		result.Splits = append(result.Splits, cs)

		for _, item := range sp.Items {
			var csi CheckSplitItem
			err = tx.QueryRow(ctx, `
INSERT INTO check_split_items (check_split_id, order_item_id, quantity)
VALUES ($1, $2, $3)
RETURNING id, check_split_id, order_item_id, quantity`,
				cs.ID, item.OrderItemID, item.Quantity,
			).Scan(&csi.ID, &csi.CheckSplitID, &csi.OrderItemID, &csi.Quantity)
			if err != nil {
				return nil, err
			}
			result.Items = append(result.Items, csi)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

// -------------------------------------------------------------------
// Seat operations
// -------------------------------------------------------------------

// CreateSeat inserts a seat row. Returns ErrDuplicateSeat on unique violation.
func (s *Store) CreateSeat(
	ctx context.Context,
	sessionID string,
	seatNumber int,
	guestName string,
) (*Seat, error) {
	var out Seat
	err := scanSeat(s.pool.QueryRow(ctx, `
INSERT INTO seats (table_session_id, seat_number, guest_name)
VALUES ($1, $2, $3)
RETURNING `+seatCols,
		sessionID, seatNumber, nullStr(guestName),
	), &out)
	if err != nil {
		if isPgUniqueViolation(err) {
			return nil, ErrDuplicateSeat
		}
		return nil, err
	}
	return &out, nil
}

// ListSeats returns all seats for a session ordered by seat_number.
func (s *Store) ListSeats(ctx context.Context, sessionID string) ([]Seat, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+seatCols+` FROM seats WHERE table_session_id = $1 ORDER BY seat_number ASC`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Seat{}
	for rows.Next() {
		var seat Seat
		if err := scanSeat(rows, &seat); err != nil {
			return nil, err
		}
		out = append(out, seat)
	}
	return out, rows.Err()
}

// UpdateSeat renames/renumbers a seat. Returns ErrSeatNotFound when the
// seat_id doesn't exist.
func (s *Store) UpdateSeat(
	ctx context.Context,
	seatID string,
	seatNumber int,
	guestName string,
) (*Seat, error) {
	var out Seat
	err := scanSeat(s.pool.QueryRow(ctx, `
UPDATE seats
SET seat_number = CASE WHEN $2::int > 0 THEN $2::int ELSE seat_number END,
    guest_name  = CASE WHEN $3::text IS NOT NULL THEN $3::text ELSE guest_name END,
    updated_at  = timezone('utc'::text, now())
WHERE id = $1
RETURNING `+seatCols,
		seatID, nullInt(seatNumber), nullStr(guestName),
	), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSeatNotFound
	}
	if err != nil {
		if isPgUniqueViolation(err) {
			return nil, ErrDuplicateSeat
		}
		return nil, err
	}
	return &out, nil
}

// DeleteSeat removes a seat. Returns ErrSeatNotFound when nothing was deleted.
func (s *Store) DeleteSeat(ctx context.Context, seatID string) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM seats WHERE id = $1`, seatID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrSeatNotFound
	}
	return nil
}
