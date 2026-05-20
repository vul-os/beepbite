-- Migration 016: RLS bootstrap fixes.
--
-- Wave 0 enabled FORCE ROW LEVEL SECURITY on every tenant-scoped table.
-- This made the system safe by default but blocked first-org onboarding:
-- a fresh signup has no organization_members row, so current_org_id() is
-- NULL and every USING/WITH CHECK clause that depends on it evaluates to
-- false. The onboarding flow (POST /data/organizations) was rejected with
-- "new row violates row-level security policy".
--
-- This migration adds policies that allow a freshly-authenticated user to:
--   1. SELECT their own profile row.
--   2. SELECT organizations they have a membership in (via EXISTS).
--   3. INSERT a brand-new organization (any authenticated user).
--   4. INSERT an organization_members row for themselves (self-onboarding).
--
-- It also adds a trigger that, when a user creates a new organization,
-- automatically inserts an organization_members row making them the owner
-- with the full default capability set.

BEGIN;

-- ---------------------------------------------------------------------------
-- profiles: ensure self-read works
-- ---------------------------------------------------------------------------
-- (Existing policy already allows id = current_user_id(); no change here,
-- but documenting that the data handler must set app.current_user_id.)

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organizations_select ON organizations;
CREATE POLICY organizations_select ON organizations FOR SELECT
    USING (
        id = current_org_id()
        OR is_service_role()
        OR EXISTS (
            SELECT 1 FROM organization_members
            WHERE organization_id = organizations.id
              AND profile_id = current_user_id()
        )
    );

DROP POLICY IF EXISTS organizations_insert ON organizations;
CREATE POLICY organizations_insert ON organizations FOR INSERT
    WITH CHECK (
        is_service_role()
        OR current_user_id() IS NOT NULL
    );

-- ---------------------------------------------------------------------------
-- organization_members: allow user to read & write their own membership row
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organization_members_select ON organization_members;
CREATE POLICY organization_members_select ON organization_members FOR SELECT
    USING (
        is_service_role()
        OR profile_id = current_user_id()
        OR organization_id = current_org_id()
    );

DROP POLICY IF EXISTS organization_members_insert ON organization_members;
CREATE POLICY organization_members_insert ON organization_members FOR INSERT
    WITH CHECK (
        is_service_role()
        OR (
            profile_id = current_user_id()
            AND (
                organization_id = current_org_id()
                OR EXISTS (
                    SELECT 1 FROM organizations
                    WHERE id = organization_id
                      AND NOT EXISTS (
                          SELECT 1 FROM organization_members om2
                          WHERE om2.organization_id = organization_id
                      )
                )
            )
        )
    );

-- ---------------------------------------------------------------------------
-- Trigger: when a user inserts a new organization, auto-create the
-- organization_members owner row with the default capability set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_owner_member_on_new_org()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    creator uuid;
BEGIN
    creator := current_user_id();

    -- Skip when the insert is from service_role or system jobs (no current user).
    IF creator IS NULL THEN
        RETURN NEW;
    END IF;

    -- Skip if a membership already exists (idempotency on re-inserts).
    IF EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = NEW.id AND profile_id = creator
    ) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.organization_members (
        organization_id, profile_id, role, capabilities
    ) VALUES (
        NEW.id,
        creator,
        'owner',
        jsonb_build_object(
            'can_pos',                 true,
            'can_kitchen',             true,
            'can_void',                true,
            'can_comp',                true,
            'can_refund',              true,
            'can_settle',              true,
            'can_view_reports',        true,
            'can_manage_payroll',      true,
            'can_manage_bank',         true,
            'can_manage_inventory',    true,
            'can_view_inventory',      true,
            'can_manage_promotions',   true,
            'can_manage_menu',         true,
            'can_drive',               false
        )
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_owner_member ON organizations;
CREATE TRIGGER trg_auto_owner_member
    AFTER INSERT ON organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_owner_member_on_new_org();

-- ---------------------------------------------------------------------------
-- Notes:
-- (1) RequireOrgScope middleware now passes fresh users (no memberships)
--     through with an empty scope that still sets app.current_user_id, so
--     these policies can read it.
-- (2) The data handler (handlers/data) was refactored in this wave to wrap
--     every query in db.Scoped(ctx, pool, scope, fn) so session vars are
--     set per request. Without that refactor, these policies are inert.
-- ---------------------------------------------------------------------------

COMMIT;
