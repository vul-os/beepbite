-- Migration 017: fix the onboarding RLS dead-end.
--
-- Root cause: the auto_owner_member_on_new_org() trigger from migration 016
-- runs SECURITY DEFINER as the function owner (the beepbite migration role,
-- which does NOT bypass RLS). The trigger's INSERT into organization_members
-- evaluates against organization_members_insert WITH CHECK. The original
-- conditional bootstrap branch contained a correlated subquery whose
-- unqualified `organization_id` reference resolved to the inner table's
-- own column (`om2.organization_id = om2.organization_id`), producing
-- unintended behaviour. The trigger's INSERT failed, the failure was
-- surfaced as "organizations" RLS violation because the error context was
-- swallowed by the data handler's error envelope.
--
-- Fix:
--   (a) Drop the auto-owner trigger. The frontend onboarding flow already
--       does both inserts (organizations + organization_members) as two
--       separate REST calls, so the trigger is redundant — its only job
--       was a defensive backup.
--   (b) Rewrite organization_members_insert policy with an UNAMBIGUOUS
--       bootstrap check: "user can insert their own membership row if
--       they have no existing membership in the target org yet." Uses
--       a clearly-named `existing` alias to avoid the column-resolution
--       ambiguity bug from migration 016.

BEGIN;

-- ---------------------------------------------------------------------------
-- (a) Remove the auto-owner trigger.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_auto_owner_member ON organizations;
DROP FUNCTION IF EXISTS public.auto_owner_member_on_new_org();

-- ---------------------------------------------------------------------------
-- (b) Replace organization_members_insert policy with an unambiguous check.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS organization_members_insert ON organization_members;
CREATE POLICY organization_members_insert ON organization_members FOR INSERT
    WITH CHECK (
        is_service_role()
        OR (
            profile_id = current_user_id()
            AND (
                -- Existing-org case: caller is already a member of this org.
                organization_id = current_org_id()
                -- Bootstrap case: caller has no membership in this org yet,
                -- and is adding themselves (profile_id = current_user_id() above).
                OR NOT EXISTS (
                    SELECT 1 FROM organization_members AS existing
                    WHERE existing.profile_id = current_user_id()
                      AND existing.organization_id = organization_members.organization_id
                )
            )
        )
    );

COMMIT;
