-- Migration 029: Make customer_loyalty_stamps.location_id nullable
-- so that org-wide stamp balances (location_id IS NULL) are supported.
--
-- Problem: migration 026 defined location_id as NOT NULL, but the
-- loyaltystamps store inserts NULL for location_id (org-wide balance
-- design).  This caused a not-null violation (500) on every stamp accrual.
--
-- Changes:
--   1. Drop the existing UNIQUE constraint (which also blocks ALTER COLUMN).
--   2. Drop NOT NULL on location_id.
--   3. Add a partial unique index for the org-wide case  (location_id IS NULL).
--   4. Add a partial unique index for the location-scoped case (location_id IS NOT NULL).

-- Step 1: drop the auto-named unique constraint created in migration 026.
ALTER TABLE customer_loyalty_stamps
    DROP CONSTRAINT IF EXISTS customer_loyalty_stamps_organization_id_customer_id_location_id_key;

-- Step 2: allow NULL in location_id.
ALTER TABLE customer_loyalty_stamps
    ALTER COLUMN location_id DROP NOT NULL;

-- Step 3: org-wide unique index — NULLs are distinct in a plain unique index,
-- so we use a partial index to enforce one row per (org, customer) where
-- location_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_stamps_org_customer_uq
    ON customer_loyalty_stamps (organization_id, customer_id)
    WHERE location_id IS NULL;

-- Step 4: location-scoped unique index — covers rows where location_id IS NOT NULL,
-- mirroring the original constraint for any future location-scoped usage.
CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_stamps_org_customer_location_uq
    ON customer_loyalty_stamps (organization_id, customer_id, location_id)
    WHERE location_id IS NOT NULL;
