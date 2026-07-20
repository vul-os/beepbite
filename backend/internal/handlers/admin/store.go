package admin

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

// Store is the data-access layer for the platform-admin handlers.
// All queries use db.ServiceRoleScope so they span every tenant.
type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

// TenantSummary is the row returned by GET /admin/tenants.
type TenantSummary struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	IsActive  bool       `json:"is_active"`
	PausedAt  *time.Time `json:"paused_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// TenantDetail is returned by GET /admin/tenants/{org_id}.
type TenantDetail struct {
	TenantSummary
	Alarms []string `json:"alarms"`
}

// ---------------------------------------------------------------------------
// Sentinel errors
// ---------------------------------------------------------------------------

var ErrOrgNotFound = errors.New("organisation not found")

// ---------------------------------------------------------------------------
// SearchTenants
// ---------------------------------------------------------------------------

// SearchTenants returns up to 50 tenants whose id, name, owner email, or phone
// contains the query string (case-insensitive). An empty q returns the 50 most
// recently created orgs. Results include wallet balance when a wallet row exists.
func (s *Store) SearchTenants(ctx context.Context, q string) ([]TenantSummary, error) {
	var out []TenantSummary

	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		var (
			rows pgx.Rows
			err  error
		)
		if q == "" {
			rows, err = tx.Query(ctx, `
SELECT o.id, o.name, o.is_active, o.paused_at, o.created_at
FROM organizations o
ORDER BY o.created_at DESC
LIMIT 50
`)
		} else {
			pattern := "%" + q + "%"
			rows, err = tx.Query(ctx, `
SELECT DISTINCT o.id, o.name, o.is_active, o.paused_at, o.created_at
FROM organizations o
LEFT JOIN organization_members om ON om.organization_id = o.id
LEFT JOIN auth_users au ON au.id = om.profile_id
WHERE o.id::text ILIKE $1
   OR o.name     ILIKE $1
   OR au.email   ILIKE $1
ORDER BY o.created_at DESC
LIMIT 50
`, pattern)
		}
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			var t TenantSummary
			if err := rows.Scan(
				&t.ID, &t.Name, &t.IsActive, &t.PausedAt, &t.CreatedAt,
			); err != nil {
				return err
			}
			out = append(out, t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []TenantSummary{}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// GetTenantDetail
// ---------------------------------------------------------------------------

// GetTenantDetail returns the full admin detail view for one org: the org row
// plus computed alarms.
func (s *Store) GetTenantDetail(ctx context.Context, orgID string) (*TenantDetail, error) {
	var detail TenantDetail
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Org row
		err := tx.QueryRow(ctx, `
SELECT id, name, is_active, paused_at, created_at
FROM organizations WHERE id = $1
`, orgID).Scan(
			&detail.ID, &detail.Name,
			&detail.IsActive, &detail.PausedAt, &detail.CreatedAt,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrgNotFound
		}
		if err != nil {
			return err
		}

		// Compute alarms
		var alarms []string
		if detail.PausedAt != nil {
			alarms = append(alarms, "paused")
		}
		if !detail.IsActive {
			alarms = append(alarms, "inactive")
		}
		if alarms == nil {
			alarms = []string{}
		}
		detail.Alarms = alarms
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &detail, nil
}

// ---------------------------------------------------------------------------
// PauseTenant / UnpauseTenant
// ---------------------------------------------------------------------------

// PauseTenant sets organizations.paused_at = now() and organizations.is_active = false,
// then writes an audit row to platform_admin_actions.
func (s *Store) PauseTenant(ctx context.Context, adminUserID, orgID string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		res, err := tx.Exec(ctx, `
UPDATE organizations
SET paused_at  = now(),
    is_active  = false,
    updated_at = now()
WHERE id = $1
`, orgID)
		if err != nil {
			return err
		}
		if res.RowsAffected() == 0 {
			return ErrOrgNotFound
		}
		return logAdminAction(ctx, tx, adminUserID, "pause_tenant", "organization", orgID, map[string]any{
			"action": "paused",
		})
	})
}

// UnpauseTenant clears paused_at and sets is_active = true, then audits.
func (s *Store) UnpauseTenant(ctx context.Context, adminUserID, orgID string) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		res, err := tx.Exec(ctx, `
UPDATE organizations
SET paused_at  = NULL,
    is_active  = true,
    updated_at = now()
WHERE id = $1
`, orgID)
		if err != nil {
			return err
		}
		if res.RowsAffected() == 0 {
			return ErrOrgNotFound
		}
		return logAdminAction(ctx, tx, adminUserID, "unpause_tenant", "organization", orgID, map[string]any{
			"action": "unpaused",
		})
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// logAdminAction inserts a platform_admin_actions audit row.
// Called inside an already-open service-role transaction.
func logAdminAction(
	ctx context.Context,
	tx pgx.Tx,
	adminUserID, action, targetType, targetID string,
	details map[string]any,
) error {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		detailsJSON = []byte("{}")
	}
	_, err = tx.Exec(ctx, `
INSERT INTO platform_admin_actions
    (admin_user_id, action, target_type, target_id, details)
VALUES ($1, $2, $3, $4, $5)
`, adminUserID, action, targetType, targetID, detailsJSON)
	return err
}

// currentPeriod returns the first and last calendar day of the current UTC
// month. Mirrors the logic in internal/quota/quota.go to stay consistent
// without introducing a cross-package dependency.
//
// This one stays in UTC on purpose. It is a platform-admin billing period
// spanning every tenant at once, and those tenants sit in different timezones —
// there is no single local midnight that could be correct for all of them, and
// a billing month must be the same interval for everyone or two tenants'
// invoices cover overlapping time. Per-location day boundaries (the ones that
// have to match a cash drawer) are computed with internal/bizday against
// locations.timezone instead.
func currentPeriod() (start, end time.Time) {
	now := time.Now().UTC()
	start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	end = time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	return start, end
}
