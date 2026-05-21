-- Migration 039: data_rights — Wave 31 GDPR/data-rights surface
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- Implements the GDPR/data-rights feature set:
--   §1  organizations: soft-delete columns (deleted_at, scheduled_purge_at)
--   §2  data_export_jobs: table for async JSON archive requests
--   §3  customers: pii_purged_at column for right-to-be-forgotten
--   §4  RLS policies for data_export_jobs
--
-- Style per migrations/033_marketplace_reviews.sql — additive DDL only,
-- IF NOT EXISTS guards throughout, DO $$ blocks for policy creation.
--
-- Pre-flight checks (read-only):
--   • organizations has NO deleted_at or scheduled_purge_at in migrations 001-038.
--     → ADD COLUMN IF NOT EXISTS is safe.
--   • customers has NO pii_purged_at in any prior migration.
--     → ADD COLUMN IF NOT EXISTS is safe.
--   • data_export_jobs does not exist.
--     → CREATE TABLE IF NOT EXISTS is safe.
--   • Org-column convention for engagement tables: organization_id.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  organizations — soft-delete columns
-- =============================================================================

-- deleted_at: set to now() when an owner initiates account deletion.
-- NULL means the org is active; non-NULL means it is soft-deleted.
-- Reversible within the grace window (scheduled_purge_at - now() > 0).
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- scheduled_purge_at: set to deleted_at + 30 days at deletion time.
-- The softdelete background job hard-deletes orgs where this < now().
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS scheduled_purge_at timestamptz;

COMMENT ON COLUMN organizations.deleted_at IS
    'Timestamp of soft-delete initiation. NULL = active. '
    'Set to now() by DELETE /settings/account. Reversible via restore endpoint '
    'while scheduled_purge_at > now().';

COMMENT ON COLUMN organizations.scheduled_purge_at IS
    'When the org is scheduled for hard-delete (deleted_at + 30 days). '
    'The softdelete job checks scheduled_purge_at < now() nightly.';

-- =============================================================================
-- §2  data_export_jobs — async JSON archive requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS data_export_jobs (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
    storage_key     text,       -- R2/object-store key for the completed archive
    requested_by    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    completed_at    timestamptz
);

COMMENT ON TABLE data_export_jobs IS
    'One row per data-export request. The handler inserts a row and '
    'returns a storage_key link when the archive is ready. '
    'Status lifecycle: pending → processing → complete | failed.';

COMMENT ON COLUMN data_export_jobs.storage_key IS
    'Object-store key (Fly/R2 path) for the JSON archive. '
    'Populated when status = ''complete''.';

-- Performance: callers poll by org + status
CREATE INDEX IF NOT EXISTS idx_data_export_jobs_org_status
    ON data_export_jobs (org_id, status);

-- =============================================================================
-- §3  customers — right-to-be-forgotten column
-- =============================================================================

-- pii_purged_at: set when POST /customers/{id}/forget executes.
-- PII fields (first_name, last_name, email, whatsapp_number, notes) are
-- NULLed/redacted; order rows are kept anonymised; this timestamp records when.
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS pii_purged_at timestamptz;

COMMENT ON COLUMN customers.pii_purged_at IS
    'Timestamp when right-to-be-forgotten was applied. '
    'PII columns (first_name, last_name, email, whatsapp_number, notes) are '
    'set to NULL. Order rows are retained anonymised.';

-- =============================================================================
-- §4  RLS — data_export_jobs
-- =============================================================================

-- Enable RLS on the new table.
ALTER TABLE data_export_jobs ENABLE ROW LEVEL SECURITY;

-- SELECT: org members may see their own org's export jobs.
DO $$
BEGIN
    CREATE POLICY data_export_jobs_select_tenant
        ON data_export_jobs
        FOR SELECT
        USING (
            org_id = current_org_id()
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy data_export_jobs_select_tenant already exists; skipping.';
END;
$$;

-- INSERT: org members (owner-gated at handler layer) or service_role.
DO $$
BEGIN
    CREATE POLICY data_export_jobs_insert_tenant
        ON data_export_jobs
        FOR INSERT
        WITH CHECK (
            org_id = current_org_id()
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy data_export_jobs_insert_tenant already exists; skipping.';
END;
$$;

-- UPDATE: service_role only (the handler/job updates status and storage_key).
DO $$
BEGIN
    CREATE POLICY data_export_jobs_update_service
        ON data_export_jobs
        FOR UPDATE
        USING (is_service_role())
        WITH CHECK (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy data_export_jobs_update_service already exists; skipping.';
END;
$$;

-- DELETE: service_role only (cleanup after purge window).
DO $$
BEGIN
    CREATE POLICY data_export_jobs_delete_service
        ON data_export_jobs
        FOR DELETE
        USING (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy data_export_jobs_delete_service already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- COLUMN CONTRACT
--   organizations (additions)
--     deleted_at           timestamptz NULL  — soft-delete timestamp  [§1]
--     scheduled_purge_at   timestamptz NULL  — hard-delete deadline   [§1]
--
--   data_export_jobs (new table)
--     id                   uuid PK gen_random_uuid()
--     org_id               uuid NOT NULL FK → organizations(id) ON DELETE CASCADE
--     status               text NOT NULL DEFAULT 'pending'
--                          CHECK (pending | processing | complete | failed)
--     storage_key          text NULL  — object-store key when complete
--     requested_by         uuid NULL  FK → profiles(id) ON DELETE SET NULL
--     created_at           timestamptz NOT NULL DEFAULT utc now()
--     completed_at         timestamptz NULL
--   INDEX: idx_data_export_jobs_org_status (org_id, status)
--
--   customers (additions)
--     pii_purged_at        timestamptz NULL  — forget timestamp       [§3]
--
-- RLS REASONING (data_export_jobs)
--   Tenant SELECT/INSERT: org_id = current_org_id() OR is_service_role().
--     current_org_id() reads app.current_org_id set by auth middleware.
--   UPDATE/DELETE: service_role only — handlers use db.WithTxServiceRole to
--     update status/storage_key; no tenant should be able to self-approve.
--   No bare GRANT to service_role: all policies use OR is_service_role()
--   consistent with project-wide pattern from migration 001.
-- =============================================================================
