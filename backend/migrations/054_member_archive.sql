-- Migration 054: add soft-archive columns to organization_members.
--
-- The Team / Members management UI (src/pages/members) has full archive and
-- restore flows that write `archived_at` / `archived_by`, and lists members
-- filtered by `archived_at IS NULL` (active) vs `IS NOT NULL` (archived). Those
-- columns were never added to the schema, so every Members page load failed
-- (SELECT including archived_at → 400) and archive/restore were no-ops.
--
-- archived_at is a nullable timestamp (NULL = active). archived_by records the
-- profile that performed the archive, for the audit trail; nullable and set
-- NULL on restore.

ALTER TABLE organization_members
    ADD COLUMN IF NOT EXISTS archived_at timestamptz,
    ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Partial index to keep the default "active members" listing fast.
CREATE INDEX IF NOT EXISTS idx_org_members_active
    ON organization_members (organization_id)
    WHERE archived_at IS NULL;
