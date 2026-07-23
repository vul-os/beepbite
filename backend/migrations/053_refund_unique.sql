-- Migration 053: add a unique constraint on refunds.external_refund_id so that
-- duplicate refund webhooks (same provider refund id) are true no-ops via
-- ON CONFLICT (external_refund_id) DO NOTHING.
--
-- external_refund_id is nullable (refunds initiated in-app have no external id),
-- so we use a partial unique index restricted to non-NULL values.  Postgres
-- treats NULLs as distinct, but the partial index makes the intent explicit and
-- avoids accidentally blocking rows that legitimately have no external_refund_id.

-- NOTE: no CONCURRENTLY — the migrate runner wraps each migration in a
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one.
CREATE UNIQUE INDEX IF NOT EXISTS
    idx_refunds_external_refund_id_unique
    ON refunds (external_refund_id)
    WHERE external_refund_id IS NOT NULL;
