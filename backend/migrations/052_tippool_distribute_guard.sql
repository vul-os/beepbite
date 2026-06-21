-- =============================================================================
-- MIGRATION 052 — TIP-POOL DOUBLE-DISTRIBUTION GUARD
-- =============================================================================
-- Fixes two data-integrity holes in the tip-pool feature (migration 012):
--
--  1. Double-distribution: POST /tip-pools/{id}/distribute had no idempotency
--     guard — calling it twice (or concurrently) paid staff twice. Fixed by:
--       a. Adding distributed_at to tip_pools so the application can stamp the
--          pool after the first successful distribution.
--       b. The application now takes a FOR UPDATE lock on the pool row, checks
--          distributed_at IS NULL, runs the inserts, then stamps distributed_at
--          — all in one transaction.
--
--  2. Contribution replay: tip_pool_contributions had no UNIQUE constraint on
--     order_payment_id, so the same payment could be inserted multiple times,
--     inflating the pool. Fixed by adding a partial unique index (WHERE NOT NULL
--     because order_payment_id is nullable).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add distributed_at to tip_pools
-- ---------------------------------------------------------------------------

ALTER TABLE tip_pools
    ADD COLUMN distributed_at timestamptz;

COMMENT ON COLUMN tip_pools.distributed_at IS
    'Set to the UTC timestamp when DistributePool successfully ran for this '
    'pool. NULL means the pool has not been distributed yet. Once set, any '
    'further distribute attempts are rejected with HTTP 409.';

-- Optional supporting index: quickly find undistributed active pools.
CREATE INDEX idx_tip_pools_undistributed
    ON tip_pools(organization_id, location_id)
    WHERE distributed_at IS NULL AND is_active = true;

-- ---------------------------------------------------------------------------
-- 2. Partial UNIQUE index on tip_pool_contributions(order_payment_id)
-- ---------------------------------------------------------------------------
-- order_payment_id is nullable (manual cash tips have no payment ID), so the
-- uniqueness constraint only applies to non-NULL values.

CREATE UNIQUE INDEX idx_tip_contributions_payment_unique
    ON tip_pool_contributions(order_payment_id)
    WHERE order_payment_id IS NOT NULL;

COMMENT ON INDEX idx_tip_contributions_payment_unique IS
    'Prevents the same order_payment from contributing to any tip pool more '
    'than once. The application maps a 23505 violation on this index to a '
    'no-op (idempotent success) so re-delivery of the same webhook is safe.';

-- ---------------------------------------------------------------------------
-- DONE — Migration 052
-- ---------------------------------------------------------------------------
