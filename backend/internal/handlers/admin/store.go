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
	ID               string     `json:"id"`
	Name             string     `json:"name"`
	SubscriptionTier string     `json:"subscription_tier"`
	IsActive         bool       `json:"is_active"`
	PausedAt         *time.Time `json:"paused_at"`
	BalanceCents     *int64     `json:"balance_cents"`
	CurrencyCode     *string    `json:"currency_code"`
	CreatedAt        time.Time  `json:"created_at"`
}

// TenantDetail is returned by GET /admin/tenants/{org_id}.
type TenantDetail struct {
	TenantSummary
	Wallet             *WalletInfo         `json:"wallet"`
	RecentTransactions []WalletTransaction `json:"recent_transactions"`
	Alarms             []string            `json:"alarms"`
}

// WalletInfo is the org_wallets row for a tenant.
type WalletInfo struct {
	BalanceCents      int64  `json:"balance_cents"`
	HoldCents         int64  `json:"hold_cents"`
	CurrencyCode      string `json:"currency_code"`
	AutoRefillEnabled bool   `json:"auto_refill_enabled"`
}

// WalletTransaction is a recent wallet_transactions ledger entry.
type WalletTransaction struct {
	ID                string    `json:"id"`
	Kind              string    `json:"kind"`
	AmountCents       int64     `json:"amount_cents"`
	BalanceAfterCents *int64    `json:"balance_after_cents"`
	Description       *string   `json:"description"`
	ReferenceType     *string   `json:"reference_type"`
	CreatedAt         time.Time `json:"created_at"`
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
SELECT o.id, o.name, o.subscription_tier, o.is_active, o.paused_at, o.created_at,
       ow.balance_cents, ow.currency_code
FROM organizations o
LEFT JOIN org_wallets ow ON ow.org_id = o.id
ORDER BY o.created_at DESC
LIMIT 50
`)
		} else {
			pattern := "%" + q + "%"
			rows, err = tx.Query(ctx, `
SELECT DISTINCT o.id, o.name, o.subscription_tier, o.is_active, o.paused_at, o.created_at,
       ow.balance_cents, ow.currency_code
FROM organizations o
LEFT JOIN org_wallets ow ON ow.org_id = o.id
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
				&t.ID, &t.Name, &t.SubscriptionTier, &t.IsActive, &t.PausedAt, &t.CreatedAt,
				&t.BalanceCents, &t.CurrencyCode,
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

// GetTenantDetail returns the full admin detail view for one org: org row,
// wallet, 20 most recent wallet transactions, and computed alarms.
func (s *Store) GetTenantDetail(ctx context.Context, orgID string) (*TenantDetail, error) {
	var detail TenantDetail
	err := db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Org row
		err := tx.QueryRow(ctx, `
SELECT id, name, subscription_tier, is_active, paused_at, created_at
FROM organizations WHERE id = $1
`, orgID).Scan(
			&detail.ID, &detail.Name, &detail.SubscriptionTier,
			&detail.IsActive, &detail.PausedAt, &detail.CreatedAt,
		)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrOrgNotFound
		}
		if err != nil {
			return err
		}

		// Wallet (optional — not every org has a wallet row yet)
		var w WalletInfo
		werr := tx.QueryRow(ctx, `
SELECT balance_cents, hold_cents, currency_code, auto_refill_enabled
FROM org_wallets WHERE org_id = $1
`, orgID).Scan(&w.BalanceCents, &w.HoldCents, &w.CurrencyCode, &w.AutoRefillEnabled)
		if werr == nil {
			detail.Wallet = &w
		} else if !errors.Is(werr, pgx.ErrNoRows) {
			return werr
		}

		// Recent wallet transactions (newest first, cap at 20)
		txRows, err := tx.Query(ctx, `
SELECT id, kind, amount_cents, balance_after_cents, description, reference_type, created_at
FROM wallet_transactions
WHERE org_id = $1
ORDER BY created_at DESC
LIMIT 20
`, orgID)
		if err != nil {
			return err
		}
		defer txRows.Close()
		for txRows.Next() {
			var wt WalletTransaction
			if err := txRows.Scan(
				&wt.ID, &wt.Kind, &wt.AmountCents, &wt.BalanceAfterCents,
				&wt.Description, &wt.ReferenceType, &wt.CreatedAt,
			); err != nil {
				return err
			}
			detail.RecentTransactions = append(detail.RecentTransactions, wt)
		}
		if err := txRows.Err(); err != nil {
			return err
		}

		// Compute alarms
		var alarms []string
		if detail.Wallet != nil && detail.Wallet.BalanceCents <= 0 {
			alarms = append(alarms, "low_wallet")
		}
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
		if detail.RecentTransactions == nil {
			detail.RecentTransactions = []WalletTransaction{}
		}
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
// QuotaOverride
// ---------------------------------------------------------------------------

// QuotaOverrideReq is the body accepted by POST /admin/tenants/{org_id}/quota-override.
type QuotaOverrideReq struct {
	Resource      string `json:"resource"`
	IncludedCount int64  `json:"included_count"`
}

// QuotaOverride upserts quota_usage.included_count for the current billing
// period (org-wide, location_id NULL) and audits the action.
func (s *Store) QuotaOverride(ctx context.Context, adminUserID, orgID string, req QuotaOverrideReq) error {
	return db.Scoped(ctx, s.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// Verify the org exists before touching quota_usage.
		var exists bool
		if err := tx.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1)`, orgID,
		).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrOrgNotFound
		}

		start, end := currentPeriod()
		// location_id = NULL → org-wide quota row.
		// PostgreSQL UNIQUE constraints treat two NULLs as distinct, so
		// ON CONFLICT (organization_id, location_id, resource, period_start)
		// would never match a NULL location_id row. We use an explicit UPDATE
		// then conditional INSERT (a manual upsert) instead.
		res, err := tx.Exec(ctx, `
UPDATE quota_usage
SET included_count = $1,
    updated_at     = now()
WHERE organization_id = $2
  AND location_id IS NULL
  AND resource     = $3
  AND period_start = $4
`, req.IncludedCount, orgID, req.Resource, start)
		if err != nil {
			return err
		}
		if res.RowsAffected() == 0 {
			// No existing row for this period — insert a fresh one.
			if _, err = tx.Exec(ctx, `
INSERT INTO quota_usage (
    organization_id, location_id, resource,
    period_start, period_end,
    used_count, included_count
) VALUES ($1, NULL, $2, $3, $4, 0, $5)
`, orgID, req.Resource, start, end, req.IncludedCount); err != nil {
				return err
			}
		}

		return logAdminAction(ctx, tx, adminUserID, "quota_override", "organization", orgID, map[string]any{
			"resource":       req.Resource,
			"included_count": req.IncludedCount,
			"period_start":   start,
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
func currentPeriod() (start, end time.Time) {
	now := time.Now().UTC()
	start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	end = time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	return start, end
}
