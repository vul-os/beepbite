package reservations

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrReservationNotFound = errors.New("reservation not found")
	ErrWaitlistNotFound    = errors.New("waitlist entry not found")
)

// Reservation mirrors a reservations row.
type Reservation struct {
	ID                 string     `json:"id"`
	OrganizationID     string     `json:"organization_id"`
	LocationID         string     `json:"location_id"`
	CustomerID         *string    `json:"customer_id"`
	CustomerName       string     `json:"customer_name"`
	CustomerPhone      *string    `json:"customer_phone"`
	CustomerEmail      *string    `json:"customer_email"`
	PartySize          int        `json:"party_size"`
	ReservationAt      time.Time  `json:"reservation_at"`
	DurationMinutes    int        `json:"duration_minutes"`
	TableID            *string    `json:"table_id"`
	SectionID          *string    `json:"section_id"`
	Status             string     `json:"status"`
	SpecialRequests    *string    `json:"special_requests"`
	ConfirmationSentAt *time.Time `json:"confirmation_sent_at"`
	CreatedByStaffID   *string    `json:"created_by_staff_id"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

// WaitlistEntry mirrors a waitlist row.
type WaitlistEntry struct {
	ID                string     `json:"id"`
	OrganizationID    string     `json:"organization_id"`
	LocationID        string     `json:"location_id"`
	CustomerName      string     `json:"customer_name"`
	CustomerPhone     *string    `json:"customer_phone"`
	PartySize         int        `json:"party_size"`
	QuotedWaitMinutes *int       `json:"quoted_wait_minutes"`
	AddedAt           time.Time  `json:"added_at"`
	SeatedAt          *time.Time `json:"seated_at"`
	RemovedAt         *time.Time `json:"removed_at"`
	RemovalReason     *string    `json:"removal_reason"`
	Notes             *string    `json:"notes"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

const resCols = `id, organization_id, location_id, customer_id,
	customer_name, customer_phone, customer_email,
	party_size, reservation_at, duration_minutes,
	table_id, section_id, status, special_requests,
	confirmation_sent_at, created_by_staff_id, created_at, updated_at`

func scanReservation(row pgx.Row, r *Reservation) error {
	return row.Scan(
		&r.ID, &r.OrganizationID, &r.LocationID, &r.CustomerID,
		&r.CustomerName, &r.CustomerPhone, &r.CustomerEmail,
		&r.PartySize, &r.ReservationAt, &r.DurationMinutes,
		&r.TableID, &r.SectionID, &r.Status, &r.SpecialRequests,
		&r.ConfirmationSentAt, &r.CreatedByStaffID, &r.CreatedAt, &r.UpdatedAt,
	)
}

const wlCols = `id, organization_id, location_id, customer_name, customer_phone,
	party_size, quoted_wait_minutes, added_at, seated_at, removed_at,
	removal_reason, notes, created_at, updated_at`

func scanWaitlist(row pgx.Row, w *WaitlistEntry) error {
	return row.Scan(
		&w.ID, &w.OrganizationID, &w.LocationID, &w.CustomerName, &w.CustomerPhone,
		&w.PartySize, &w.QuotedWaitMinutes, &w.AddedAt, &w.SeatedAt, &w.RemovedAt,
		&w.RemovalReason, &w.Notes, &w.CreatedAt, &w.UpdatedAt,
	)
}

// nullStr converts empty string to nil so optional columns are stored as NULL.
func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// nullInt converts zero to nil for optional int fields.
func nullInt(n int) any {
	if n == 0 {
		return nil
	}
	return n
}

// --- Reservations ---

func (s *Store) CreateReservation(ctx context.Context, r *Reservation) (*Reservation, error) {
	var out Reservation
	err := scanReservation(s.pool.QueryRow(ctx, `
INSERT INTO reservations (
	organization_id, location_id, customer_id, customer_name, customer_phone,
	customer_email, party_size, reservation_at, duration_minutes,
	table_id, section_id, status, special_requests, created_by_staff_id
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
RETURNING `+resCols,
		r.OrganizationID, r.LocationID, r.CustomerID, r.CustomerName, r.CustomerPhone,
		r.CustomerEmail, r.PartySize, r.ReservationAt, r.DurationMinutes,
		r.TableID, r.SectionID, r.Status, r.SpecialRequests, r.CreatedByStaffID,
	), &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) ListReservations(ctx context.Context, locationID, date string) ([]Reservation, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+resCols+`
FROM reservations
WHERE location_id = $1
  AND reservation_at::date = $2::date
ORDER BY reservation_at ASC
`, locationID, date)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Reservation{}
	for rows.Next() {
		var r Reservation
		if err := scanReservation(rows, &r); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) GetReservation(ctx context.Context, id string) (*Reservation, error) {
	var out Reservation
	err := scanReservation(s.pool.QueryRow(ctx,
		`SELECT `+resCols+` FROM reservations WHERE id = $1`, id), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrReservationNotFound
	}
	return &out, err
}

func (s *Store) UpdateReservation(ctx context.Context, id string, fields map[string]any) (*Reservation, error) {
	// Build SET clause dynamically from the provided fields map.
	// Allowed updatable columns (guards against arbitrary injection via field names).
	allowed := map[string]bool{
		"status": true, "table_id": true, "section_id": true,
		"customer_name": true, "customer_phone": true, "customer_email": true,
		"party_size": true, "reservation_at": true, "duration_minutes": true,
		"special_requests": true,
	}

	setClauses := []string{}
	args := []any{}
	i := 1
	for col, val := range fields {
		if !allowed[col] {
			continue
		}
		setClauses = append(setClauses, col+" = $"+itoa(i+1))
		args = append(args, val)
		i++
	}
	if len(setClauses) == 0 {
		return s.GetReservation(ctx, id)
	}

	args = append([]any{id}, args...)
	query := "UPDATE reservations SET " + joinStr(setClauses, ", ") + ", updated_at = now() WHERE id = $1 RETURNING " + resCols

	var out Reservation
	err := scanReservation(s.pool.QueryRow(ctx, query, args...), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrReservationNotFound
	}
	return &out, err
}

func (s *Store) ConfirmReservation(ctx context.Context, id string) (*Reservation, error) {
	var out Reservation
	err := scanReservation(s.pool.QueryRow(ctx, `
UPDATE reservations
SET status = 'confirmed', confirmation_sent_at = now(), updated_at = now()
WHERE id = $1
RETURNING `+resCols, id), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrReservationNotFound
	}
	return &out, err
}

// SeatReservation marks a reservation as seated and opens a table_sessions row
// (if a table_id is set on the reservation).
func (s *Store) SeatReservation(ctx context.Context, id, staffID string) (*Reservation, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var out Reservation
	err = scanReservation(tx.QueryRow(ctx, `
UPDATE reservations
SET status = 'seated', updated_at = now()
WHERE id = $1
RETURNING `+resCols, id), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrReservationNotFound
	}
	if err != nil {
		return nil, err
	}

	// Open a table session if the reservation has a table assigned.
	if out.TableID != nil {
		if _, err := tx.Exec(ctx, `
INSERT INTO table_sessions (table_id, location_id, opened_by, party_size, status)
VALUES ($1, $2, $3, $4, 'open')
ON CONFLICT DO NOTHING
`, *out.TableID, out.LocationID, nullStr(staffID), out.PartySize); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) CancelReservation(ctx context.Context, id string) (*Reservation, error) {
	var out Reservation
	err := scanReservation(s.pool.QueryRow(ctx, `
UPDATE reservations
SET status = 'cancelled', updated_at = now()
WHERE id = $1
RETURNING `+resCols, id), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrReservationNotFound
	}
	return &out, err
}

// --- Waitlist ---

func (s *Store) AddToWaitlist(ctx context.Context, w *WaitlistEntry) (*WaitlistEntry, error) {
	var out WaitlistEntry
	err := scanWaitlist(s.pool.QueryRow(ctx, `
INSERT INTO waitlist (
	organization_id, location_id, customer_name, customer_phone,
	party_size, quoted_wait_minutes, notes
) VALUES ($1,$2,$3,$4,$5,$6,$7)
RETURNING `+wlCols,
		w.OrganizationID, w.LocationID, w.CustomerName, w.CustomerPhone,
		w.PartySize, w.QuotedWaitMinutes, w.Notes,
	), &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Store) ListActiveWaitlist(ctx context.Context, locationID string) ([]WaitlistEntry, error) {
	rows, err := s.pool.Query(ctx, `
SELECT `+wlCols+`
FROM waitlist
WHERE location_id = $1
  AND seated_at IS NULL
  AND removed_at IS NULL
ORDER BY added_at ASC
`, locationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WaitlistEntry{}
	for rows.Next() {
		var w WaitlistEntry
		if err := scanWaitlist(rows, &w); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func (s *Store) SeatWaitlistEntry(ctx context.Context, id string) (*WaitlistEntry, error) {
	var out WaitlistEntry
	err := scanWaitlist(s.pool.QueryRow(ctx, `
UPDATE waitlist
SET seated_at = now(), removal_reason = 'seated', updated_at = now()
WHERE id = $1
RETURNING `+wlCols, id), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrWaitlistNotFound
	}
	return &out, err
}

func (s *Store) RemoveWaitlistEntry(ctx context.Context, id, reason string) (*WaitlistEntry, error) {
	var out WaitlistEntry
	err := scanWaitlist(s.pool.QueryRow(ctx, `
UPDATE waitlist
SET removed_at = now(), removal_reason = $2, updated_at = now()
WHERE id = $1
RETURNING `+wlCols, id, nullStr(reason)), &out)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrWaitlistNotFound
	}
	return &out, err
}

// --- small helpers to avoid importing fmt/strconv ---

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := make([]byte, 0, 10)
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	return string(buf)
}

func joinStr(ss []string, sep string) string {
	out := ""
	for i, s := range ss {
		if i > 0 {
			out += sep
		}
		out += s
	}
	return out
}

// keep nullInt accessible to handler (suppress unused warning)
var _ = nullInt
