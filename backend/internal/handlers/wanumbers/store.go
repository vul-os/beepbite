// Package wanumbers provides the platform-admin CRUD surface for the
// whatsapp_phone_numbers registry.  All queries run under db.ServiceRoleScope
// — the table is platform-owned with no tenant RLS; the HTTP handlers are
// gated by admin.RequirePlatformAdmin.
package wanumbers

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

// ErrNotFound is returned when the requested number row does not exist.
var ErrNotFound = errors.New("whatsapp number not found")

// ErrDuplicatePhoneNumberID is returned when a CREATE conflicts on the
// meta_phone_number_id UNIQUE constraint.
var ErrDuplicatePhoneNumberID = errors.New("meta_phone_number_id already registered")

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

// NumberRow is the full DB row returned to the caller.
type NumberRow struct {
	ID                string    `json:"id"`
	MetaPhoneNumberID string    `json:"meta_phone_number_id"`
	DisplayPhone      string    `json:"display_phone"`
	Country           string    `json:"country"`
	Regions           []string  `json:"regions"`
	Active            bool      `json:"active"`
	ConfiguredAt      time.Time `json:"configured_at"`
}

// CreateReq is the body for POST /admin/wa-numbers.
type CreateReq struct {
	MetaPhoneNumberID string   `json:"meta_phone_number_id"`
	DisplayPhone      string   `json:"display_phone"`
	Country           string   `json:"country"`
	Regions           []string `json:"regions"`
}

// UpdateReq is the body for PATCH /admin/wa-numbers/{id}.
// Only non-zero fields are applied.
type UpdateReq struct {
	DisplayPhone *string   `json:"display_phone"`
	Country      *string   `json:"country"`
	Regions      *[]string `json:"regions"`
	Active       *bool     `json:"active"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store is the data-access layer for the wanumbers handlers.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore returns a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

// List returns all whatsapp_phone_numbers rows ordered by configured_at ASC.
// activeOnly=true filters to active=true rows only.
func (s *Store) List(ctx context.Context, activeOnly bool) ([]NumberRow, error) {
	var out []NumberRow

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		q := `
SELECT id, meta_phone_number_id, display_phone, country, regions, active, configured_at
FROM   whatsapp_phone_numbers
`
		if activeOnly {
			q += "WHERE active = true\n"
		}
		q += "ORDER BY configured_at ASC"

		rows, err := tx.Query(ctx, q)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var n NumberRow
			if err := rows.Scan(
				&n.ID,
				&n.MetaPhoneNumberID,
				&n.DisplayPhone,
				&n.Country,
				&n.Regions,
				&n.Active,
				&n.ConfiguredAt,
			); err != nil {
				return err
			}
			out = append(out, n)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []NumberRow{}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

// Get returns a single row by id (UUID string).
func (s *Store) Get(ctx context.Context, id string) (*NumberRow, error) {
	var n NumberRow
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT id, meta_phone_number_id, display_phone, country, regions, active, configured_at
FROM   whatsapp_phone_numbers
WHERE  id = $1
`, id).Scan(
			&n.ID,
			&n.MetaPhoneNumberID,
			&n.DisplayPhone,
			&n.Country,
			&n.Regions,
			&n.Active,
			&n.ConfiguredAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

// Create inserts a new number row.  Returns ErrDuplicatePhoneNumberID on
// UNIQUE constraint violation.
func (s *Store) Create(ctx context.Context, req CreateReq) (*NumberRow, error) {
	if req.Regions == nil {
		req.Regions = []string{}
	}
	var n NumberRow
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO whatsapp_phone_numbers
    (meta_phone_number_id, display_phone, country, regions)
VALUES ($1, $2, $3, $4)
RETURNING id, meta_phone_number_id, display_phone, country, regions, active, configured_at
`, req.MetaPhoneNumberID, req.DisplayPhone, req.Country, req.Regions).Scan(
			&n.ID,
			&n.MetaPhoneNumberID,
			&n.DisplayPhone,
			&n.Country,
			&n.Regions,
			&n.Active,
			&n.ConfiguredAt,
		)
	})
	if err != nil {
		var pgErr *pgconn.PgError
		// 23505 = unique_violation
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrDuplicatePhoneNumberID
		}
		return nil, err
	}
	return &n, nil
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

// Update applies a partial update to the row identified by id.  At least one
// field in req must be non-nil, otherwise the call is a no-op (returns the
// current row unchanged).
func (s *Store) Update(ctx context.Context, id string, req UpdateReq) (*NumberRow, error) {
	// Build a minimal UPDATE only for the supplied fields.
	type kv struct {
		col string
		val any
	}
	var sets []kv
	if req.DisplayPhone != nil {
		sets = append(sets, kv{"display_phone", *req.DisplayPhone})
	}
	if req.Country != nil {
		sets = append(sets, kv{"country", *req.Country})
	}
	if req.Regions != nil {
		r := *req.Regions
		if r == nil {
			r = []string{}
		}
		sets = append(sets, kv{"regions", r})
	}
	if req.Active != nil {
		sets = append(sets, kv{"active", *req.Active})
	}

	if len(sets) == 0 {
		// Nothing to update — return the current row.
		return s.Get(ctx, id)
	}

	// Construct "col = $N" fragments.
	args := make([]any, 0, len(sets)+1)
	setClauses := ""
	for i, kv := range sets {
		if i > 0 {
			setClauses += ", "
		}
		args = append(args, kv.val)
		setClauses += kv.col + " = $" + itoa(i+1)
	}
	args = append(args, id)
	idParam := "$" + itoa(len(sets)+1)

	var n NumberRow
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
UPDATE whatsapp_phone_numbers
SET    `+setClauses+`
WHERE  id = `+idParam+`
RETURNING id, meta_phone_number_id, display_phone, country, regions, active, configured_at
`, args...).Scan(
			&n.ID,
			&n.MetaPhoneNumberID,
			&n.DisplayPhone,
			&n.Country,
			&n.Regions,
			&n.Active,
			&n.ConfiguredAt,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// ---------------------------------------------------------------------------
// Deactivate
// ---------------------------------------------------------------------------

// Deactivate sets active = false for the row identified by id.
// It is a soft-delete: the row is retained for audit / history purposes.
func (s *Store) Deactivate(ctx context.Context, id string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		res, err := tx.Exec(ctx, `
UPDATE whatsapp_phone_numbers
SET    active = false
WHERE  id = $1
`, id)
		if err != nil {
			return err
		}
		if res.RowsAffected() == 0 {
			return ErrNotFound
		}
		return nil
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// itoa is a minimal int-to-string helper to avoid importing strconv.
func itoa(n int) string {
	const digits = "0123456789"
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = digits[n%10]
		n /= 10
	}
	return string(buf[pos:])
}
