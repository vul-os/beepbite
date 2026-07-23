-- Migration 042: onboarding_progress — Wave 28(help) / Now-28 Help center + onboarding wizard
-- -------------------------------------------------------------------------------------------
-- Context
-- -------
-- Stores per-organisation onboarding wizard state so the wizard is resumable
-- across sessions and devices.  One row per organisation (org_id is the PK).
-- step       — the current (latest-reached) wizard step index (0-based).
-- completed_steps — jsonb array of step keys that have been explicitly marked
--                   complete by the wizard UI, e.g. ["email","location","menu"].
-- updated_at — timestamp of last progress write; updated automatically by
--              trigger.
--
-- Pre-flight checks:
--   • organizations table created in 002_auth_and_tenancy.sql §1.
--   • No existing onboarding_progress table in migrations 001-041.
--   • RLS pattern mirrors migration 033_marketplace_reviews.sql §3 and the
--     standard Wave-28 engagement-area pattern: org-scoped SELECT/INSERT/UPDATE
--     via current_org_id(); service_role bypass via is_service_role().
-- -------------------------------------------------------------------------------------------

-- =============================================================================
-- §1  onboarding_progress table
-- =============================================================================

CREATE TABLE IF NOT EXISTS onboarding_progress (
    org_id          uuid        NOT NULL PRIMARY KEY
                                REFERENCES organizations(id) ON DELETE CASCADE,
    step            integer     NOT NULL DEFAULT 0,
    completed_steps jsonb       NOT NULL DEFAULT '[]'::jsonb,
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE onboarding_progress IS
    'Stores per-organisation onboarding wizard progress. '
    'One row per org. step is the highest wizard step reached (0-based). '
    'completed_steps is a jsonb array of step-key strings explicitly completed. '
    'Written by the onboarding handler; read by the wizard UI to resume.';

COMMENT ON COLUMN onboarding_progress.org_id IS
    'FK to organizations.id. Primary key — one row per organisation.';

COMMENT ON COLUMN onboarding_progress.step IS
    'Highest wizard step index reached by the user (0-based). '
    'Step 0 = verify email, 1 = first store, 2 = menu items, '
    '3 = invite staff/driver, 4 = connect payment, 5 = test order.';

COMMENT ON COLUMN onboarding_progress.completed_steps IS
    'JSON array of step keys that have been fully completed, '
    'e.g. ["email","location","menu","staff","payment","order"]. '
    'The wizard UI updates this on each step completion.';

COMMENT ON COLUMN onboarding_progress.updated_at IS
    'Timestamp of the last progress write. Updated automatically by trigger.';

-- =============================================================================
-- §2  updated_at trigger
-- =============================================================================

-- Reuse the project-wide trigger function set_updated_at_now() created in
-- migration 001_extensions_and_helpers.sql.

CREATE TRIGGER onboarding_progress_updated_at
    BEFORE UPDATE ON onboarding_progress
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- =============================================================================
-- §3  Row-Level Security
-- =============================================================================

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_progress FORCE ROW LEVEL SECURITY;

-- SELECT: org members see only their own row.
DO $$
BEGIN
    CREATE POLICY onboarding_progress_select
        ON onboarding_progress
        FOR SELECT
        USING (
            org_id = current_org_id()
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy onboarding_progress_select already exists; skipping.';
END;
$$;

-- INSERT: org members may insert their own row.
DO $$
BEGIN
    CREATE POLICY onboarding_progress_insert
        ON onboarding_progress
        FOR INSERT
        WITH CHECK (
            org_id = current_org_id()
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy onboarding_progress_insert already exists; skipping.';
END;
$$;

-- UPDATE: org members may update only their own row.
DO $$
BEGIN
    CREATE POLICY onboarding_progress_update
        ON onboarding_progress
        FOR UPDATE
        USING (
            org_id = current_org_id()
            OR is_service_role()
        )
        WITH CHECK (
            org_id = current_org_id()
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy onboarding_progress_update already exists; skipping.';
END;
$$;

-- DELETE: service_role only (no user-facing delete path).
DO $$
BEGIN
    CREATE POLICY onboarding_progress_delete
        ON onboarding_progress
        FOR DELETE
        USING ( is_service_role() );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy onboarding_progress_delete already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLE: onboarding_progress
--   org_id           uuid        PK NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
--   step             integer     NOT NULL DEFAULT 0
--   completed_steps  jsonb       NOT NULL DEFAULT '[]'
--   updated_at       timestamptz NOT NULL DEFAULT timezone('utc', now())
--
-- TRIGGER: onboarding_progress_updated_at — BEFORE UPDATE, calls set_updated_at_now()
--
-- RLS POLICIES (all use current_org_id() / is_service_role() pattern):
--   onboarding_progress_select  — SELECT  USING  (org_id = current_org_id() OR is_service_role())
--   onboarding_progress_insert  — INSERT  CHECK  (org_id = current_org_id() OR is_service_role())
--   onboarding_progress_update  — UPDATE  USING+CHECK same as above
--   onboarding_progress_delete  — DELETE  USING  (is_service_role())
--
-- ORG-COLUMN: org_id (PK, direct equality check — cheapest possible RLS evaluation)
-- =============================================================================
