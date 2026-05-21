// Package metering records resource consumption for an organisation: it debits
// the org wallet and increments quota_usage in a single atomic transaction.
//
// # Design goals
//
//   - One call from any handler after a metered action completes.
//   - Idempotent: supply an IdempotencyKey and safe retries won't double-debit.
//   - Independently buildable: writes directly to wallet_transactions and
//     quota_usage via pgx; does NOT import internal/wallet or internal/quota.
//
// # Scope
//
// All writes run under db.ServiceRoleScope() so that metering always succeeds
// regardless of the caller's tenant RLS scope.  wallet_transactions and
// quota_usage are system tables whose INSERT policies require service-role.
//
// # Resource → wallet kind mapping
//
//	"orders"             → 'debit_overage'    (order overage)
//	"whatsapp_outbound"  → 'debit_whatsapp'
//	"llm_messages"       → 'debit_llm'
//	"email_outbound"     → 'debit_overage'    (email uses overage bucket)
//	"bulk_imports"       → 'debit_bulk_import'
//	(anything else)      → 'debit_overage'
package metering

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/db"
)

// Resource constants mirror quota.Resource* so callers can use either package.
const (
	ResourceOrders         = "orders"
	ResourceWhatsappOut    = "whatsapp_outbound"
	ResourceLLMMessages    = "llm_messages"
	ResourceEmailOutbound  = "email_outbound"
	ResourceBulkImports    = "bulk_imports"
)

// walletKind maps a resource name to the wallet_txn_kind enum value used in
// the wallet_transactions table.
//
// Mapping rationale:
//
//	orders          → debit_overage       (order-count overages are generic)
//	whatsapp_outbound → debit_whatsapp    (direct channel label)
//	llm_messages    → debit_llm           (direct channel label)
//	email_outbound  → debit_overage       (email shares the overage bucket)
//	bulk_imports    → debit_bulk_import   (direct channel label)
//	<unknown>       → debit_overage       (safe fallback)
func walletKind(resource string) string {
	switch resource {
	case ResourceWhatsappOut:
		return "debit_whatsapp"
	case ResourceLLMMessages:
		return "debit_llm"
	case ResourceBulkImports:
		return "debit_bulk_import"
	default:
		// "orders", "email_outbound", and any future resources fall through to
		// the generic overage bucket.
		return "debit_overage"
	}
}

// currentPeriod returns the first and last calendar day of the current UTC
// month as midnight-UTC time.Time values.
func currentPeriod() (start, end time.Time) {
	now := time.Now().UTC()
	start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	end = time.Date(now.Year(), now.Month()+1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	return start, end
}

// RecordInput holds all parameters for a single metered event.
type RecordInput struct {
	// OrgID is the UUID (string) of the organisation being charged.
	OrgID string
	// LocationID is the UUID (string) of the location the event originated from.
	LocationID string
	// Resource identifies what was consumed. Use the Resource* constants above
	// or matching values from the quota package.
	Resource string
	// Units is the number of resource units consumed (e.g. 1 order, 5 LLM messages).
	Units int64
	// CostCents is the amount to debit in the smallest currency unit (e.g. ZAR
	// cents). Zero means no wallet debit — only quota_usage is updated.
	CostCents int64
	// RefType is the polymorphic reference type stored on the wallet transaction
	// row (e.g. "order", "chat_message"). May be empty when there is no ref.
	RefType string
	// RefID is the UUID of the referenced row. May be empty.
	RefID string
	// IdempotencyKey is a caller-supplied unique key. A second call with the
	// same key will be silently ignored (ON CONFLICT DO NOTHING), so retries
	// are safe and will never double-debit.
	IdempotencyKey string
}

// Meter records metered consumption for an organisation.
type Meter struct {
	pool *pgxpool.Pool
}

// New creates a Meter backed by the given connection pool.
func New(pool *pgxpool.Pool) *Meter {
	return &Meter{pool: pool}
}

// Record atomically:
//  1. UPSERTs quota_usage for the current calendar month, adding in.Units to
//     used_count.
//  2. If in.CostCents > 0, inserts a debit row into wallet_transactions with
//     amount_cents = -in.CostCents. The existing DB trigger
//     (trg_fn_wallet_transaction_balance) updates org_wallets.balance_cents
//     automatically. The insert uses ON CONFLICT (idempotency_key) DO NOTHING
//     so duplicate calls with the same IdempotencyKey are safe.
//
// Both writes run in one transaction under service-role scope so they bypass
// tenant RLS and always succeed regardless of the caller's scope.
func (m *Meter) Record(ctx context.Context, in RecordInput) error {
	periodStart, periodEnd := currentPeriod()

	return db.Scoped(ctx, m.pool, db.ServiceRoleScope(), func(tx pgx.Tx) error {
		// --- Step 1: UPSERT quota_usage ---
		_, err := tx.Exec(ctx, `
INSERT INTO quota_usage (
    organization_id,
    location_id,
    resource,
    period_start,
    period_end,
    used_count,
    included_count
) VALUES ($1, $2, $3, $4, $5, $6, 0)
ON CONFLICT (organization_id, location_id, resource, period_start)
DO UPDATE SET
    used_count = quota_usage.used_count + EXCLUDED.used_count,
    updated_at = now()
`,
			in.OrgID,
			in.LocationID,
			in.Resource,
			periodStart,
			periodEnd,
			in.Units,
		)
		if err != nil {
			return fmt.Errorf("metering: upsert quota_usage: %w", err)
		}

		// --- Step 2: debit wallet (only when there is a cost) ---
		if in.CostCents <= 0 {
			return nil
		}

		kind := walletKind(in.Resource)

		// Build optional nullable args for ref_type/ref_id.
		var refType, refID interface{}
		if in.RefType != "" {
			refType = in.RefType
		}
		if in.RefID != "" {
			refID = in.RefID
		}

		// amount_cents is negative for a debit (the ledger uses signed amounts:
		// positive = credit, negative = debit).
		_, err = tx.Exec(ctx, `
INSERT INTO wallet_transactions (
    org_id,
    kind,
    amount_cents,
    description,
    reference_type,
    reference_id,
    idempotency_key
) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (idempotency_key) DO NOTHING
`,
			in.OrgID,
			kind,
			-in.CostCents,
			fmt.Sprintf("metered %s usage (%d units)", in.Resource, in.Units),
			refType,
			refID,
			in.IdempotencyKey,
		)
		if err != nil {
			return fmt.Errorf("metering: insert wallet_transactions: %w", err)
		}

		return nil
	})
}
