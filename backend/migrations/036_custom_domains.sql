-- Migration 036: custom_domains — Wave 23 / Now-13 + T7.6 subdomain gap
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- Enables merchants to attach custom hostnames (e.g. order.mybakery.com) to
-- a BeepBite location, and resolves both slug-based subdomains
-- (<slug>.beepbite.io) and custom domains via a chi middleware.
--
-- Pre-flight checks (performed before writing this file):
--   • locations.slug exists (007_payments_generic.sql line 201, index line 243).
--   • locations.organization_id exists (base schema).
--   • No custom_domains table in migrations 001–035.
--   • Migration 033 is the most recent style reference for DO blocks.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  custom_domains — core table
-- =============================================================================

CREATE TABLE IF NOT EXISTS custom_domains (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id         uuid         NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    hostname            text         NOT NULL UNIQUE,
    status              text         NOT NULL DEFAULT 'pending'
                                     CHECK (status IN (
                                         'pending', 'verifying', 'verified',
                                         'cert_issuing', 'live', 'failed'
                                     )),
    verification_token  text         NOT NULL DEFAULT encode(gen_random_bytes(20), 'hex'),
    verified_at         timestamptz,
    cert_issued_at      timestamptz,
    removed_at          timestamptz,
    created_at          timestamptz  NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE custom_domains IS
    'Custom hostnames attached to BeepBite locations. '
    'verification_token is used for DNS TXT record proof-of-ownership. '
    'status lifecycle: pending → verifying → verified → cert_issuing → live. '
    'removed_at marks soft-deleted rows; hard-delete is performed by a batch job.';

-- Performance: host-resolve middleware does per-request lookups by hostname.
CREATE INDEX IF NOT EXISTS idx_custom_domains_hostname
    ON custom_domains (hostname)
    WHERE removed_at IS NULL;

-- Per-location listing (settings UI).
CREATE INDEX IF NOT EXISTS idx_custom_domains_location
    ON custom_domains (location_id, created_at DESC)
    WHERE removed_at IS NULL;

-- =============================================================================
-- §2  RLS
-- =============================================================================

ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;

-- Org members of the location's org may SELECT their domains.
DO $$
BEGIN
    CREATE POLICY custom_domains_select_tenant
        ON custom_domains
        FOR SELECT
        USING (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy custom_domains_select_tenant already exists; skipping.';
END;
$$;

-- Org members may INSERT domains for their own locations.
DO $$
BEGIN
    CREATE POLICY custom_domains_insert_tenant
        ON custom_domains
        FOR INSERT
        WITH CHECK (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy custom_domains_insert_tenant already exists; skipping.';
END;
$$;

-- Org members may UPDATE (e.g. trigger verify); service_role handles status
-- transitions from the verification job.
DO $$
BEGIN
    CREATE POLICY custom_domains_update_tenant
        ON custom_domains
        FOR UPDATE
        USING (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        )
        WITH CHECK (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy custom_domains_update_tenant already exists; skipping.';
END;
$$;

-- Soft-delete via UPDATE (removed_at); hard-delete only via service_role.
DO $$
BEGIN
    CREATE POLICY custom_domains_delete_service_role
        ON custom_domains
        FOR DELETE
        USING (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy custom_domains_delete_service_role already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLE: custom_domains
--   id                  uuid         PK, gen_random_uuid()
--   location_id         uuid NOT NULL FK → locations(id) ON DELETE CASCADE
--   hostname            text NOT NULL UNIQUE
--   status              text NOT NULL DEFAULT 'pending'
--                       CHECK (pending|verifying|verified|cert_issuing|live|failed)
--   verification_token  text NOT NULL DEFAULT encode(gen_random_bytes(20),'hex')
--   verified_at         timestamptz NULL
--   cert_issued_at      timestamptz NULL
--   removed_at          timestamptz NULL  (soft-delete)
--   created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
--
-- INDEXES
--   idx_custom_domains_hostname  (hostname) WHERE removed_at IS NULL
--   idx_custom_domains_location  (location_id, created_at DESC) WHERE removed_at IS NULL
--
-- RLS
--   custom_domains_select_tenant    SELECT  — location in caller's org OR service_role
--   custom_domains_insert_tenant    INSERT  — location in caller's org OR service_role
--   custom_domains_update_tenant    UPDATE  — location in caller's org OR service_role
--   custom_domains_delete_service_role DELETE — service_role only
--
-- ORG-COLUMN CONVENTION
--   Resolved via `location_id IN (SELECT id FROM locations WHERE
--   organization_id = current_org_id())` — consistent with the existing RLS
--   pattern used for marketplace_reviews (migration 033 §3) and other tables
--   that hang off locations rather than directly off organizations.
-- =============================================================================
