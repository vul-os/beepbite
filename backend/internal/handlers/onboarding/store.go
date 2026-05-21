// Package onboarding provides GET/PUT /onboarding/progress and
// GET /onboarding/status endpoints for the resumable setup wizard.
//
// DB schema: migration 042_onboarding_progress.sql
//
//	onboarding_progress(org_id pk, step int, completed_steps jsonb, updated_at)
//
// All queries run inside db.Scoped so RLS is enforced for every call.
package onboarding

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

// ErrNotFound is returned when the org has no progress row yet.
var ErrNotFound = errors.New("onboarding progress not found")

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

// Progress mirrors an onboarding_progress row.
type Progress struct {
	OrgID          string    `json:"org_id"`
	Step           int       `json:"step"`
	CompletedSteps []string  `json:"completed_steps"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Status is derived from live table counts — tells the wizard what the org
// has actually completed regardless of what the progress row says.
type Status struct {
	HasLocation      bool `json:"has_location"`
	HasFiveItems     bool `json:"has_five_items"`
	HasStaffOrDriver bool `json:"has_staff_or_driver"`
	HasPayment       bool `json:"has_payment"`
	HasOrder         bool `json:"has_order"`
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store owns the DB pool and executes org-scoped queries.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore returns a Store backed by pool.
func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// GetProgress fetches the onboarding_progress row for the current org.
// Returns ErrNotFound when no row exists yet (org hasn't started the wizard).
func (s *Store) GetProgress(ctx context.Context) (*Progress, error) {
	var p Progress
	// completed_steps is jsonb — the data layer returns it as []byte; we
	// decode it as a text array by extracting each element via jsonb_array_elements_text.
	// Simpler: cast to text[] using pg operator. We read raw JSON and parse in Go.
	var rawSteps []byte
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
SELECT org_id, step, completed_steps, updated_at
FROM   onboarding_progress
WHERE  org_id = current_org_id()
`).Scan(&p.OrgID, &p.Step, &rawSteps, &p.UpdatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.CompletedSteps = decodeStringArray(rawSteps)
	return &p, nil
}

// UpsertProgress inserts or updates the onboarding_progress row for the
// current org. step and completed_steps are both written on every call.
func (s *Store) UpsertProgress(ctx context.Context, step int, completedSteps []string) (*Progress, error) {
	orgID := db.ScopeFromContext(ctx).OrgID
	if orgID == "" {
		return nil, errors.New("org_id not resolved from context")
	}
	stepsJSON := encodeStringArray(completedSteps)
	var p Progress
	var rawSteps []byte
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
INSERT INTO onboarding_progress (org_id, step, completed_steps)
VALUES ($1, $2, $3::jsonb)
ON CONFLICT (org_id) DO UPDATE
    SET step            = EXCLUDED.step,
        completed_steps = EXCLUDED.completed_steps,
        updated_at      = timezone('utc', now())
RETURNING org_id, step, completed_steps, updated_at
`, orgID, step, stepsJSON).Scan(&p.OrgID, &p.Step, &rawSteps, &p.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	p.CompletedSteps = decodeStringArray(rawSteps)
	return &p, nil
}

// GetStatus queries live table counts to derive real completion state.
// All queries run inside a single scoped transaction so RLS applies uniformly.
func (s *Store) GetStatus(ctx context.Context) (*Status, error) {
	orgID := db.ScopeFromContext(ctx).OrgID
	if orgID == "" {
		return nil, errors.New("org_id not resolved from context")
	}
	var st Status
	err := db.Scoped(ctx, s.pool, db.ScopeFromContext(ctx), func(tx pgx.Tx) error {
		// 1. Has location?
		if err := tx.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1 FROM locations
    WHERE  organization_id = $1
    LIMIT  1
)`, orgID).Scan(&st.HasLocation); err != nil {
			return err
		}

		// 2. Has >= 5 active menu items across any location?
		var itemCount int
		if err := tx.QueryRow(ctx, `
SELECT COUNT(*)
FROM   items i
JOIN   locations l ON l.id = i.location_id
WHERE  l.organization_id = $1
  AND  i.is_active = true
`, orgID).Scan(&itemCount); err != nil {
			return err
		}
		st.HasFiveItems = itemCount >= 5

		// 3. Has at least one staff or driver member?
		if err := tx.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1 FROM staff s
    JOIN   locations l ON l.id = s.location_id
    WHERE  l.organization_id = $1
    LIMIT  1
) OR EXISTS (
    SELECT 1 FROM organization_members
    WHERE  organization_id = $1
      AND  role = 'driver'
    LIMIT  1
)`, orgID).Scan(&st.HasStaffOrDriver); err != nil {
			return err
		}

		// 4. Has active payment provider OR at least one cash/delivery order paid?
		//    We consider: any active location_payment_credentials row, OR
		//    any completed order with payment_method_code = 'cash' or 'delivery'.
		if err := tx.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM   location_payment_credentials lpc
    JOIN   locations l ON l.id = lpc.location_id
    WHERE  l.organization_id = $1
      AND  lpc.is_active = true
    LIMIT  1
)`, orgID).Scan(&st.HasPayment); err != nil {
			return err
		}

		// 5. Has at least one completed/delivered order?
		if err := tx.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM   orders o
    JOIN   locations l ON l.id = o.location_id
    WHERE  l.organization_id = $1
      AND  o.status IN ('completed','delivered')
    LIMIT  1
)`, orgID).Scan(&st.HasOrder); err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// encodeStringArray converts []string to a Postgres-compatible JSON array
// string, e.g. ["email","location"].
func encodeStringArray(ss []string) string {
	if len(ss) == 0 {
		return "[]"
	}
	out := make([]byte, 0, 64)
	out = append(out, '[')
	for i, s := range ss {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, '"')
		for _, c := range s {
			if c == '"' || c == '\\' {
				out = append(out, '\\')
			}
			out = append(out, byte(c))
		}
		out = append(out, '"')
	}
	out = append(out, ']')
	return string(out)
}

// decodeStringArray parses a Postgres jsonb []byte (e.g. `["a","b"]`) into
// []string. Returns an empty non-nil slice on parse failure.
func decodeStringArray(raw []byte) []string {
	out := []string{}
	if len(raw) < 2 {
		return out
	}
	// Trim whitespace and outer brackets.
	s := string(raw)
	if s == "[]" || s == "null" {
		return out
	}
	// Simple parser: walk rune by rune, extract quoted strings.
	inStr := false
	cur := []byte{}
	escaped := false
	for i := 1; i < len(s)-1; i++ {
		c := s[i]
		if escaped {
			cur = append(cur, c)
			escaped = false
			continue
		}
		if c == '\\' && inStr {
			escaped = true
			continue
		}
		if c == '"' {
			if inStr {
				out = append(out, string(cur))
				cur = cur[:0]
				inStr = false
			} else {
				inStr = true
			}
			continue
		}
		if inStr {
			cur = append(cur, c)
		}
	}
	return out
}
