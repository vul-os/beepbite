-- Migration 041: user_preferences — Wave 35 unified workspace
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- The unified /work workspace lets staff switch between POS and Kitchen views.
-- This table persists the last view chosen by each user so the workspace
-- re-opens on their preferred view on next login.
--
-- Pre-flight checks (performed before writing this file):
--   • profiles table exists in 002_auth_and_tenancy.sql (lines 199-233).
--     → profile_id PK references profiles(id) is safe.
--   • No user_preferences table exists in migrations 001-040.
--     → CREATE TABLE … IF NOT EXISTS is purely additive.
--   • RLS pattern: owner-profile-only, matching profiles_select policy:
--       USING (profile_id = current_user_id() OR is_service_role())
--     Consistent with every personal-data table in this repo.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  user_preferences table
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
    profile_id      uuid        NOT NULL PRIMARY KEY
                                REFERENCES profiles(id) ON DELETE CASCADE,
    last_view_pos   text,           -- e.g. 'quick' | 'full' | 'floor' | 'orders'
    last_view_kds   text,           -- e.g. 'station' | 'expo' | 'bumpbar'
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE user_preferences IS
    'Per-user workspace view preferences. One row per profile. '
    'Written by PUT /me/preferences; read by GET /me/preferences. '
    'Wave 35 / Now-27 unified workspace.';

COMMENT ON COLUMN user_preferences.last_view_pos IS
    'Last POS sub-view selected: quick | full | floor | orders. '
    'NULL means "not yet set — use default".';

COMMENT ON COLUMN user_preferences.last_view_kds IS
    'Last Kitchen sub-view selected: station | expo | bumpbar. '
    'NULL means "not yet set — use default".';

-- updated_at trigger (set_updated_at_now defined in 001_extensions_and_helpers.sql §4).
CREATE TRIGGER trg_user_preferences_updated_at
    BEFORE UPDATE ON user_preferences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- =============================================================================
-- §2  Row-Level Security
-- =============================================================================

REVOKE ALL ON user_preferences FROM PUBLIC;

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY;

-- Each profile owner sees and writes only their own row.
-- service_role bypass allows background jobs / admin scripts to read/write.

CREATE POLICY user_preferences_select ON user_preferences
    FOR SELECT
    USING (profile_id = current_user_id() OR is_service_role());

CREATE POLICY user_preferences_insert ON user_preferences
    FOR INSERT
    WITH CHECK (profile_id = current_user_id() OR is_service_role());

CREATE POLICY user_preferences_update ON user_preferences
    FOR UPDATE
    USING  (profile_id = current_user_id() OR is_service_role())
    WITH CHECK (profile_id = current_user_id() OR is_service_role());

CREATE POLICY user_preferences_delete ON user_preferences
    FOR DELETE
    USING (is_service_role());

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLE: user_preferences
--   profile_id    uuid  PK  REFERENCES profiles(id)  ON DELETE CASCADE
--   last_view_pos text  NULL  — POS sub-view: quick|full|floor|orders
--   last_view_kds text  NULL  — KDS sub-view: station|expo|bumpbar
--   updated_at    timestamptz NOT NULL DEFAULT timezone('utc', now())
--
-- TRIGGER: trg_user_preferences_updated_at  (set_updated_at_now, BEFORE UPDATE)
--
-- RLS POLICIES (all policies guard on profile_id = current_user_id() OR is_service_role()):
--   user_preferences_select  — FOR SELECT
--   user_preferences_insert  — FOR INSERT WITH CHECK
--   user_preferences_update  — FOR UPDATE USING + WITH CHECK
--   user_preferences_delete  — FOR DELETE (service_role only)
--
-- ORG-COLUMN: none. This table is scoped to the individual user (profile_id),
--   not to an organisation.  The workspace is cross-org — preferences travel
--   with the person, not the org.
--
-- NO GRANTS to authenticated / anon roles; all access is gated by RLS only.
-- Consistent with the project-wide pattern from 001 §4: no bare GRANTs,
-- service_role bypass via is_service_role() on every policy.
--
-- IDEMPOTENCY: CREATE TABLE IF NOT EXISTS + CREATE POLICY (non-IF-NOT-EXISTS,
--   but CREATE TRIGGER has IF NOT EXISTS via Postgres 14+; full re-run on a
--   migrated DB will error on duplicate trigger/policy names — acceptable per
--   project convention since migrations run once).
-- =============================================================================
