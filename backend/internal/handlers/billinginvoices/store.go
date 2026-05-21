// Package billinginvoices exposes subscription_invoices as a read-only REST
// resource scoped to the authenticated organisation.
package billinginvoices

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Store handles all DB access for the billinginvoices handler.
type Store struct {
	pool *pgxpool.Pool
}

// NewStore constructs a Store.
func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// Invoice mirrors the columns we SELECT from subscription_invoices.
// Both USD and local amounts are included together with the FX snapshot.
type Invoice struct {
	ID                string    `json:"id"`
	OrgID             string    `json:"org_id"`
	PlanID            string    `json:"plan_id"`
	PeriodStart       string    `json:"period_start"` // "YYYY-MM-DD"
	PeriodEnd         string    `json:"period_end"`   // "YYYY-MM-DD"
	USDAmountCents    int64     `json:"usd_amount_cents"`
	LocalAmountCents  int64     `json:"local_amount_cents"`
	LocalCurrencyCode string    `json:"local_currency_code"`
	FXRate            float64   `json:"fx_rate"`
	Status            string    `json:"status"`
	IssuedAt          time.Time `json:"issued_at"`
	PaidAt            *time.Time `json:"paid_at"`
	CreatedAt         time.Time `json:"created_at"`
}

// ListInvoices returns all subscription_invoices for the org derived from ctx,
// ordered newest first (by period_start DESC, then created_at DESC).
//
// The query runs inside a db.ScopeFromContext transaction so the RLS policy
// "org_id = current_org_id()" filters to the caller's own org automatically.
func (s *Store) ListInvoices(ctx context.Context) ([]Invoice, error) {
	scope := db.ScopeFromContext(ctx)

	var out []Invoice
	err := db.Scoped(ctx, s.pool, scope, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
SELECT
    id,
    org_id,
    plan_id,
    period_start::text,
    period_end::text,
    usd_amount_cents,
    local_amount_cents,
    local_currency_code,
    fx_rate,
    status,
    issued_at,
    paid_at,
    created_at
FROM subscription_invoices
ORDER BY period_start DESC, created_at DESC
`)
		if err != nil {
			return fmt.Errorf("billinginvoices: query invoices: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var inv Invoice
			if err := rows.Scan(
				&inv.ID,
				&inv.OrgID,
				&inv.PlanID,
				&inv.PeriodStart,
				&inv.PeriodEnd,
				&inv.USDAmountCents,
				&inv.LocalAmountCents,
				&inv.LocalCurrencyCode,
				&inv.FXRate,
				&inv.Status,
				&inv.IssuedAt,
				&inv.PaidAt,
				&inv.CreatedAt,
			); err != nil {
				return fmt.Errorf("billinginvoices: scan invoice row: %w", err)
			}
			out = append(out, inv)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
