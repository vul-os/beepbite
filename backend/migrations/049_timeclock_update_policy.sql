-- =============================================================================
-- 049_timeclock_update_policy.sql — fix staff_time_entries UPDATE RLS
-- =============================================================================
--
-- The staff_time_entries UPDATE policy (migration 003) was created as
-- `USING (false)` — a hard literal that blocks ALL updates, even from a
-- service-role-elevated transaction (FORCE RLS applies to the owner, and the
-- literal never consults is_service_role()). So timeclock EditEntry — which
-- elevates via db.WithTxServiceRole expecting the policy to allow service-role
-- writes — always updated 0 rows and returned ErrEntryNotFound. Manager
-- time-entry edits were impossible. Surfaced by the DB-backed integration test.
--
-- Align it with the DELETE policy's intent: only service-role may UPDATE
-- (managers go through EditEntry's service-role elevation; direct tenant
-- UPDATEs remain blocked).
DROP POLICY IF EXISTS staff_time_entries_update ON staff_time_entries;
CREATE POLICY staff_time_entries_update ON staff_time_entries
    FOR UPDATE
    USING (is_service_role())
    WITH CHECK (is_service_role());
