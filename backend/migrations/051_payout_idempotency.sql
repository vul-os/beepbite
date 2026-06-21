-- Migration 051: Payout idempotency hardening
--
-- Adds a partial UNIQUE index on merchant_payouts(provider_transfer_id) so that
-- a Paystack transfer_code can only ever be recorded once.  The index is partial
-- (WHERE provider_transfer_id IS NOT NULL) so that multiple rows can coexist in
-- 'initiated' state before a transfer code is assigned.
--
-- This is a belt-and-suspenders guard: the primary idempotency layer is the
-- existing UNIQUE (location_id, period_start, period_end) constraint combined
-- with ON CONFLICT upsert logic in the payout runner, the stable payout_reference
-- passed to Paystack, and the pg_try_advisory_lock in RunOnce.  This index
-- ensures that even if two concurrent processes somehow both complete a Paystack
-- transfer, only one transfer_code can be written to the DB.

CREATE UNIQUE INDEX IF NOT EXISTS uidx_merchant_payouts_provider_transfer_id
    ON merchant_payouts (provider_transfer_id)
    WHERE provider_transfer_id IS NOT NULL;

-- Also add an index on payout_reference for fast reconciliation lookups.
CREATE INDEX IF NOT EXISTS idx_merchant_payouts_payout_reference
    ON merchant_payouts (payout_reference)
    WHERE payout_reference IS NOT NULL;
