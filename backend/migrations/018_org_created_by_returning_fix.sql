-- Migration 018: fix INSERT ... RETURNING on organizations under RLS.
--
-- ACTUAL root cause of the onboarding "violates row-level security policy"
-- error (the prior 016/017 attempts addressed adjacent symptoms):
--
-- The generic data handler runs `INSERT INTO organizations (...) RETURNING *`.
-- Under RLS, the RETURNING clause requires the inserted row to be visible
-- per the table's SELECT policy. A freshly-signed-up user is not yet a member
-- of the org they're creating, and current_org_id() is NULL, so
-- organizations_select rejects the new row and Postgres raises
-- "new row violates row-level security policy for table organizations" —
-- even though the INSERT WITH CHECK passed.
--
-- Fix: stamp every organization with created_by = current_user_id() at insert
-- time (via column DEFAULT), and let organizations_select (and the membership
-- bootstrap) recognise the creator. Now INSERT ... RETURNING works for the
-- creator, and the frontend can read back the new org id to create the owner
-- membership row.

BEGIN;

-- ---------------------------------------------------------------------------
-- created_by column, defaulted to the acting user at insert time.
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT current_user_id();

CREATE INDEX IF NOT EXISTS idx_organizations_created_by ON organizations (created_by);

-- ---------------------------------------------------------------------------
-- SELECT: creator can always read their own org (covers INSERT...RETURNING),
-- plus members and service role.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_select ON organizations;
CREATE POLICY organizations_select ON organizations FOR SELECT
    USING (
        id = current_org_id()
        OR is_service_role()
        OR created_by = current_user_id()
        OR EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_id = organizations.id
              AND profile_id = current_user_id()
        )
    );

-- ---------------------------------------------------------------------------
-- INSERT: any authenticated user can create an org (created_by stamps them).
-- (Re-assert the relaxed policy in case a prior debug session altered it.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_insert ON organizations;
CREATE POLICY organizations_insert ON organizations FOR INSERT
    WITH CHECK (is_service_role() OR current_user_id() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- UPDATE: creator OR member-org OR service.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_update ON organizations;
CREATE POLICY organizations_update ON organizations FOR UPDATE
    USING (id = current_org_id() OR created_by = current_user_id() OR is_service_role())
    WITH CHECK (id = current_org_id() OR created_by = current_user_id() OR is_service_role());

COMMIT;
