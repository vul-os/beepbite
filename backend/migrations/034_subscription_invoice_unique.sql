-- Migration 034: subscription_invoice_unique — dedup guard for subscription_invoices
-- ---------------------------------------------------------------------------------
-- Context
-- -------
-- insertInvoice uses ON CONFLICT DO NOTHING to prevent duplicate monthly invoices
-- for the same org + billing period.  However, ON CONFLICT DO NOTHING requires a
-- matching unique constraint; without one the clause silently does nothing and
-- every INSERT succeeds — allowing duplicate (org_id, period_start) rows whenever
-- the NOT EXISTS guard in loadOrgsNeedingInvoice races across concurrent runs.
--
-- Pre-flight check (performed before writing this file):
--   SELECT org_id, period_start, count(*)
--   FROM subscription_invoices
--   GROUP BY 1, 2
--   HAVING count(*) > 1;
--   → (0 rows)  — no existing duplicates; constraint can be added cleanly.
-- ---------------------------------------------------------------------------------

-- =============================================================================
-- §1  Add UNIQUE constraint on (org_id, period_start)
-- =============================================================================
-- ADD CONSTRAINT IF NOT EXISTS is NOT valid PostgreSQL syntax for constraints,
-- so we guard with a DO block that swallows the duplicate_object error — the
-- same pattern used by migrations 033 and others in this repo.

DO $$
BEGIN
    ALTER TABLE subscription_invoices
        ADD CONSTRAINT uq_subscription_invoices_org_period
        UNIQUE (org_id, period_start);
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'constraint uq_subscription_invoices_org_period already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLE MODIFIED: subscription_invoices
--
-- CONSTRAINT ADDED:
--   uq_subscription_invoices_org_period  UNIQUE (org_id, period_start)
--     Ensures at most one invoice per organisation per billing month.
--     Backs the ON CONFLICT (org_id, period_start) DO NOTHING clause in
--     insertInvoice so that concurrent job runs are safely idempotent.
--
-- NO DATA CHANGES: pre-flight query confirmed zero duplicate rows.
-- NO RLS CHANGES:  existing policies on subscription_invoices are unchanged.
-- NO INDEX CHANGES: Postgres automatically creates a unique index to enforce
--   the constraint; no manual CREATE INDEX is needed.
--
-- IDEMPOTENCY: wrapped in DO $$ … EXCEPTION WHEN duplicate_object … END $$
--   so re-running the migration on an already-migrated database is safe.
-- =============================================================================
