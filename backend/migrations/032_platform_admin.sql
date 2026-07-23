-- =============================================================================
-- MIGRATION 032 — PLATFORM ADMIN TOOL (Wave 26)
-- =============================================================================
-- Purpose: adds schema needed by the internal platform admin tool.
-- All column additions use ADD COLUMN IF NOT EXISTS.
-- New table uses CREATE TABLE IF NOT EXISTS.
-- No bare GRANT … TO service_role — ALTER DEFAULT PRIVILEGES in
-- 001_extensions_and_helpers.sql already grants ALL ON TABLES TO service_role
-- for every table created in this session.
--
-- PRE-MIGRATION EXISTENCE AUDIT:
--
--   auth_users                     — EXISTS (002_auth_and_tenancy.sql §1)
--     auth_users.is_platform_admin — EXISTS (002 line 60); boolean NOT NULL DEFAULT false
--                                    → SKIPPED (already present)
--
--   organizations                  — EXISTS (002_auth_and_tenancy.sql §6)
--     organizations.is_active      — EXISTS (002 line 244); boolean NOT NULL DEFAULT true
--                                    NOTE: is_active is a broad soft-delete flag used by many
--                                    tables and functions (e.g. check_invites, send_invitation).
--                                    It is NOT safe to repurpose as the admin-lifecycle pause
--                                    signal because flipping it to false also blocks ordinary
--                                    tenant-auth (org-scoped RLS checks current_org_id()).
--                                    A separate nullable paused_at timestamp is the correct
--                                    approach: NULL = running, non-NULL = admin-paused.
--     organizations.paused_at      — MISSING → CREATED HERE
--
--   platform_admin_actions         — MISSING → CREATED HERE
--
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. organizations.paused_at  [NEW — Wave 26]
-- ---------------------------------------------------------------------------
-- Nullable timestamptz. NULL means the org is running normally. A non-NULL
-- value means an admin has force-paused the org at that timestamp. The admin
-- backend reads/writes this column via service_role; RLS on organizations
-- already allows service_role full access (002_auth_and_tenancy.sql line 267).
--
-- The admin tool should ALSO flip organizations.is_active when pausing so that
-- the existing invite/org-lookup guards (which check is_active) remain coherent.
-- paused_at provides the audit timestamp and distinguishes an admin pause from
-- a voluntary deactivation. On unpause: set paused_at = NULL (and restore
-- is_active = true if that was the only reason it was false).
-- ---------------------------------------------------------------------------

ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS paused_at timestamptz;                          -- NULL = running; non-NULL = admin-paused at this timestamp

COMMENT ON COLUMN organizations.paused_at IS
    'Set by the platform admin tool when an org is force-paused. '
    'NULL means the org is running normally. Non-NULL records the exact '
    'moment an admin paused the org. Cleared (set to NULL) on admin unpause. '
    'Wave 26 platform admin tool.';


-- ---------------------------------------------------------------------------
-- 2. platform_admin_actions  [NEW — Wave 26]
-- ---------------------------------------------------------------------------
-- Append-only audit log for every action taken via the platform admin tool.
-- Only service_role can read or write rows (admin handlers run as service_role).
-- No tenant-facing policies — this table must never be readable by org sessions.
--
-- Columns:
--   id             — synthetic PK (uuid, generated)
--   admin_user_id  — auth_users.id of the platform admin who took the action
--   action         — short verb: 'pause_org', 'unpause_org', 'impersonate_user',
--                    'revoke_token', 'flag_org', etc.
--   target_type    — entity kind: 'organization', 'user', 'location', etc.
--   target_id      — uuid of the affected entity
--   details        — arbitrary JSON payload (reason, before/after state, IP, etc.)
--   created_at     — wall-clock time the action was recorded (UTC, immutable)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_admin_actions (
    id              uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_user_id   uuid        NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
    action          text        NOT NULL,
    target_type     text        NOT NULL,
    target_id       uuid        NOT NULL,
    details         jsonb       NOT NULL DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Fast lookups by admin (for "what did admin X do?") and by target (for "what
-- happened to org Y?"), plus a time-range index for the admin dashboard feed.
CREATE INDEX IF NOT EXISTS idx_platform_admin_actions_admin
    ON platform_admin_actions (admin_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_admin_actions_target
    ON platform_admin_actions (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_admin_actions_created
    ON platform_admin_actions (created_at DESC);

REVOKE ALL ON platform_admin_actions FROM PUBLIC;

-- RLS: service-only. No tenant session — not even an org owner — may read or
-- write this table. All admin handlers set app.is_service_role = true before
-- executing SQL (see 001_extensions_and_helpers.sql §service_role pattern).
ALTER TABLE platform_admin_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin_actions FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_admin_actions_select ON platform_admin_actions FOR SELECT
    USING (is_service_role());

CREATE POLICY platform_admin_actions_insert ON platform_admin_actions FOR INSERT
    WITH CHECK (is_service_role());

-- Updates and deletes intentionally omitted: the audit log is append-only.
-- If a row must be amended (e.g. legal hold lift), that must go through a
-- separate service-role migration or a new INSERT with action='amend_record'.

COMMENT ON TABLE platform_admin_actions IS
    'Append-only audit log for every action taken via the platform admin tool. '
    'Service-role read/write only. Wave 26 platform admin tool.';

COMMENT ON COLUMN platform_admin_actions.admin_user_id IS
    'auth_users.id of the platform admin who performed the action.';
COMMENT ON COLUMN platform_admin_actions.action IS
    'Short verb describing the action, e.g. pause_org, unpause_org, '
    'impersonate_user, revoke_token, flag_org, clear_flag.';
COMMENT ON COLUMN platform_admin_actions.target_type IS
    'Entity kind affected: organization, user, location, order, etc.';
COMMENT ON COLUMN platform_admin_actions.target_id IS
    'UUID of the affected entity (matches target_type).';
COMMENT ON COLUMN platform_admin_actions.details IS
    'Arbitrary JSON: reason string, before/after field snapshots, '
    'request IP, user-agent, or any other context the handler records.';


-- =============================================================================
-- CONTRACT SUMMARY FOR THE PLATFORM ADMIN BACKEND AGENT
-- =============================================================================
--
-- EXISTED (skipped — no DDL emitted):
--   auth_users.is_platform_admin   boolean NOT NULL DEFAULT false
--     → gates the admin tool; already in 002_auth_and_tenancy.sql line 60.
--     → RLS on auth_users is ENABLE+FORCE; policies allow
--       (id = current_user_id() OR is_service_role()), so admin handlers
--       running as service_role can UPDATE is_platform_admin freely.
--
--   organizations.is_active        boolean NOT NULL DEFAULT true
--     → general soft-delete flag; already in 002_auth_and_tenancy.sql line 244.
--     → Admin "pause" should also flip this to false (so is_active guards in
--       invite/auth functions remain coherent), but paused_at is the canonical
--       pause-state column added by this migration.
--
-- CREATED:
--   organizations.paused_at        timestamptz  (nullable)
--     → NULL  = org is running.
--     → non-NULL = admin-force-paused at that UTC timestamp.
--     → On pause:   UPDATE organizations SET is_active = false, paused_at = now() WHERE id = $1
--     → On unpause: UPDATE organizations SET is_active = true,  paused_at = NULL  WHERE id = $1
--       (only restore is_active if paused_at was the sole reason it was false)
--
--   platform_admin_actions         (table)
--     Columns:
--       id             uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY
--       admin_user_id  uuid        NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT
--       action         text        NOT NULL
--       target_type    text        NOT NULL
--       target_id      uuid        NOT NULL
--       details        jsonb       NOT NULL DEFAULT '{}'
--       created_at     timestamptz NOT NULL DEFAULT timezone('utc', now())
--     RLS: ENABLE + FORCE; service_role only (SELECT + INSERT).
--     Indexes: (admin_user_id, created_at DESC), (target_type, target_id, created_at DESC),
--              (created_at DESC).
--     Append-only: no UPDATE or DELETE policies.
--
-- =============================================================================
