-- Migration 033: marketplace_reviews — Wave 28 customer marketplace reviews
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- The internal `reviews` table (010_engagement.sql §20) is for restaurant-
-- internal feedback (staff/owner facing).  `marketplace_reviews` (010 §21) is
-- the customer-facing star-rating system shown on the public store page.
--
-- Migration 010 created the base `marketplace_reviews` table but it predates
-- the full Wave-28 spec.  This migration backfills the missing contract
-- columns, aligns the order_id nullability, adds the (location_id, created_at)
-- performance index, wires a customer self-insert RLS policy, adds a dedicated
-- owner-reply UPDATE policy, and materialises avg_rating / rating_count on
-- locations so the store-list query can sort/display without a live subquery.
--
-- Pre-flight checks (performed before writing this file):
--   • marketplace_reviews EXISTS in 010_engagement.sql (lines 597-621).
--     → All DDL below is purely additive (ADD COLUMN IF NOT EXISTS, CREATE INDEX
--       IF NOT EXISTS, CREATE POLICY IF NOT EXISTS).
--   • locations has NO avg_rating or rating_count columns in any migration
--     001-032.  → ADD COLUMN IF NOT EXISTS is safe.
--   • Org-column convention for engagement-area tables (customers, promotions,
--     gift_cards, loyalty_config, loyalty_transactions, house_accounts,
--     reservations, waitlist, customer_loyalty_stamps, customer_favorite_items)
--     is uniformly `organization_id`.  See wave-28 object summary in 028_*.sql.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  marketplace_reviews — missing contract columns
-- =============================================================================

-- 1a. Direct org anchor.
--     The existing RLS resolves the org via location_id → locations.organization_id
--     (a JOIN-based lookup on every policy check).  Adding organization_id as a
--     denormalised column lets the INSERT / UPDATE policies use a cheap equality
--     check (organization_id = current_org_id()) instead of a subquery, and
--     gives the reviews backend agent a direct FK to filter on.
ALTER TABLE marketplace_reviews
    ADD COLUMN IF NOT EXISTS organization_id uuid
        REFERENCES organizations(id) ON DELETE CASCADE;

-- Back-fill from the location FK for all existing rows so NOT NULL can be set.
UPDATE marketplace_reviews mr
SET    organization_id = l.organization_id
FROM   locations l
WHERE  l.id = mr.location_id
  AND  mr.organization_id IS NULL;

-- Now enforce NOT NULL.  IF NOT EXISTS on ADD COLUMN means the constraint name
-- may already exist if the column was added by another path; guard with a
-- DO block to be safe.
DO $$
BEGIN
    ALTER TABLE marketplace_reviews
        ALTER COLUMN organization_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'marketplace_reviews.organization_id NOT NULL already set or column not present: %', SQLERRM;
END;
$$;

-- 1b. Make order_id nullable (spec: optional FK; one review per order where
--     order_id IS NOT NULL — enforced by partial unique index below).
--     The original 010 definition has order_id NOT NULL with a UNIQUE constraint.
--     We must drop the table-level UNIQUE first, then relax nullability.
ALTER TABLE marketplace_reviews
    DROP CONSTRAINT IF EXISTS marketplace_reviews_order_id_key;

ALTER TABLE marketplace_reviews
    ALTER COLUMN order_id DROP NOT NULL;

-- Partial unique index: one marketplace review per order, only when set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_reviews_order_uq
    ON marketplace_reviews (order_id)
    WHERE order_id IS NOT NULL;

-- 1c. Canonical text body column.
--     The 010 table uses `review_text`; the Wave-28 contract names it `text`.
--     We add `text` as a new column (renaming would break existing code) and
--     keep `review_text` for backward compatibility.  The reviews backend agent
--     should write to `text`; `review_text` is a legacy alias.
ALTER TABLE marketplace_reviews
    ADD COLUMN IF NOT EXISTS text text;

-- =============================================================================
-- §2  marketplace_reviews — additional indexes
-- =============================================================================

-- (location_id, created_at DESC) — primary listing sort for the store-page
-- reviews panel.  The existing idx_marketplace_reviews_location_status covers
-- moderation queries; this covers the chronological feed.
CREATE INDEX IF NOT EXISTS idx_marketplace_reviews_location_created
    ON marketplace_reviews (location_id, created_at DESC);

-- =============================================================================
-- §3  marketplace_reviews — RLS policy additions
-- =============================================================================
-- Existing policies (from 010_engagement.sql §24.22):
--   marketplace_reviews_select_tenant  — org members via location_id subquery
--   marketplace_reviews_select_public  — marketplace_role WHERE status='visible'
--   marketplace_reviews_insert         — org-scoped (location_id subquery) OR service_role
--   marketplace_reviews_update         — org-scoped OR service_role
--   marketplace_reviews_delete         — service_role only
--
-- Gaps filled here:
--   a) customer_self_insert  — the reviewing customer can insert their own review
--      (customer_profile_id = current_user_id() OR is_service_role()).
--   b) owner_reply_update   — org members can set owner_reply / owner_replied_at
--      using the fast organization_id = current_org_id() check now that the
--      column is denormalised.
--
-- Note: policies are created with IF NOT EXISTS (Postgres 15+).  On earlier
-- versions a DO block wraps the CREATE POLICY to swallow duplicate-policy errors.

DO $$
BEGIN
    -- a) Customer self-insert: the customer who placed the order inserts
    --    their own review.  Scoped to their profile_id; service_role bypass
    --    allows the backend to create verified reviews programmatically.
    CREATE POLICY marketplace_reviews_insert_customer
        ON marketplace_reviews
        FOR INSERT
        WITH CHECK (
            customer_profile_id = current_user_id()
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy marketplace_reviews_insert_customer already exists; skipping.';
END;
$$;

DO $$
BEGIN
    -- b) Owner reply update: org members can write the reply fields only.
    --    Uses the direct organization_id column for a cheap equality check.
    --    The existing marketplace_reviews_update policy still covers full-row
    --    updates by org members (e.g., moderation status changes).
    CREATE POLICY marketplace_reviews_owner_reply
        ON marketplace_reviews
        FOR UPDATE
        USING (
            organization_id = current_org_id()
            OR is_service_role()
        )
        WITH CHECK (
            organization_id = current_org_id()
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy marketplace_reviews_owner_reply already exists; skipping.';
END;
$$;

-- =============================================================================
-- §4  locations — materialised rating aggregate columns
-- =============================================================================
-- avg_rating and rating_count are refreshed by the reviews backend agent
-- (or a trigger) each time a marketplace review is approved (status → visible).
-- Storing them on locations avoids a live AVG() subquery on every store-list
-- or store-detail request.

ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS avg_rating   numeric(3,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS rating_count integer       NOT NULL DEFAULT 0;

COMMENT ON COLUMN locations.avg_rating   IS
    'Materialized average star rating from visible marketplace_reviews rows. '
    'Refreshed by the reviews backend agent on each review approval. '
    'Range 0.00–5.00; 0 means no reviews yet.';

COMMENT ON COLUMN locations.rating_count IS
    'Count of visible marketplace_reviews rows contributing to avg_rating. '
    'Refreshed alongside avg_rating.';

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- ORG-COLUMN CHOSEN: organization_id
--   Matches the canonical convention for every engagement-area table:
--   customers, promotions, gift_cards, loyalty_config, loyalty_transactions,
--   house_accounts, reservations, waitlist, customer_loyalty_stamps,
--   customer_favorite_items (see 028_wave32_easy_wins_extended.sql §TABLES
--   INSPECTED).  The single exception is tax_profiles / api_keys which use
--   org_id as a PK alias — not applicable here.
--
-- RLS REASONING
--   Tenant SELECT / INSERT / UPDATE (existing):
--     Resolves the org via `location_id IN (SELECT id FROM locations WHERE
--     organization_id = current_org_id())`.  Works correctly but requires a
--     subquery join on every policy evaluation.
--   Tenant SELECT / UPDATE (new owner_reply policy):
--     Uses the new direct `organization_id = current_org_id()` column for a
--     single equality check — cheaper and symmetric with every other
--     engagement-area table.
--   Public marketplace SELECT (existing):
--     `is_marketplace_role() AND status = 'visible'` — narrow read matching
--     the pattern used by locations, categories, items, menu_schedules
--     (007/004 migrations).  No bare GRANT; access gated solely by the
--     app.is_marketplace_role session variable set by the API gateway before
--     each public-facing request.
--   Customer self-insert (new):
--     `customer_profile_id = current_user_id() OR is_service_role()`.
--     current_user_id() reads app.current_user_id — the profile UUID set from
--     the JWT by the auth middleware.  This lets an authenticated customer
--     submit their own review without needing org membership.  service_role
--     bypass allows server-side verified-purchase creation.
--   No bare GRANT to service_role: all policies include OR is_service_role()
--     consistent with the project-wide pattern established in 001 §4.
--
-- COLUMN CONTRACT (for the reviews backend agent)
--   marketplace_reviews
--     id                  uuid         PK, gen_random_uuid()
--     organization_id     uuid NOT NULL FK → organizations(id) ON DELETE CASCADE  [ADDED §1a]
--     location_id         uuid NOT NULL FK → locations(id)     ON DELETE CASCADE
--     order_id            uuid NULL     FK → orders(id)        — nullable [CHANGED §1b]
--     customer_profile_id uuid NULL     FK → profiles(id)
--     stars               integer NOT NULL CHECK (1..5)
--     text                text NULL     — canonical Wave-28 body column           [ADDED §1c]
--     review_text         text NULL     — legacy alias from 010; keep for compat
--     photos              text[] NOT NULL DEFAULT '{}'
--     verified_purchase   boolean NOT NULL DEFAULT true
--     status              text NOT NULL DEFAULT 'pending'
--                         CHECK (pending | visible | hidden | removed)
--     owner_reply         text NULL
--     owner_replied_at    timestamptz NULL
--     created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
--     updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
--   UNIQUE (order_id) WHERE order_id IS NOT NULL  [REPLACED §1b]
--
--   locations (additions)
--     avg_rating          numeric(3,2) NOT NULL DEFAULT 0                         [ADDED §4]
--     rating_count        integer      NOT NULL DEFAULT 0                         [ADDED §4]
--
-- INDEXES
--   idx_marketplace_reviews_location_created  (location_id, created_at DESC)     [ADDED §2]
--   idx_marketplace_reviews_order_uq          UNIQUE partial (order_id) WHERE NOT NULL [ADDED §1b]
--   [existing] idx_marketplace_reviews_location_status  (location_id, status)
--   [existing] idx_marketplace_reviews_customer         (customer_profile_id) WHERE NOT NULL
-- =============================================================================
