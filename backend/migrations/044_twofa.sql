-- Migration 044: twofa — Wave 39 TOTP-based two-factor authentication + audit viewer
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- Adds TOTP two-factor authentication (Google Authenticator-style) to the
-- member auth flow.  The TOTP secret is encrypted at rest using the same
-- AES-256-GCM pattern used for payment keys (internal/secretbox).
--
-- Pre-flight checks (performed before writing this file):
--   • auth_users EXISTS in 002_auth_and_tenancy.sql.
--     → All DDL below is purely additive (ADD COLUMN IF NOT EXISTS).
--   • profiles EXISTS in 002_auth_and_tenancy.sql.
--     → user_backup_codes FK references profiles.id.
--   • No totp_* column exists in any prior migration 001-043.
--     → ADD COLUMN IF NOT EXISTS is safe.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  auth_users — TOTP columns
-- =============================================================================

-- 1a. Encrypted TOTP secret (AES-256-GCM, base64-encoded via secretbox).
--     NULL means TOTP not yet enrolled.
ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS totp_secret_ciphertext text;

-- 1b. Flag that TOTP has been verified and is active for this account.
--     Separate from the secret so that a half-completed enroll (secret stored
--     but never verified) does not gate the user out.
ALTER TABLE auth_users
    ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN auth_users.totp_secret_ciphertext IS
    'AES-256-GCM ciphertext of the base32 TOTP secret (secretbox format: base64(nonce||sealed)). NULL when TOTP not enrolled.';

COMMENT ON COLUMN auth_users.totp_enabled IS
    'true once the user has successfully verified their TOTP device. Prevents half-enrolled accounts from being gated.';

-- =============================================================================
-- §2  user_backup_codes — one-time-use recovery codes
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_backup_codes (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    code_hash   text        NOT NULL,  -- SHA-256 hex of the raw code (never store plaintext)
    used_at     timestamptz,           -- NULL = unused; set on first consumption
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE user_backup_codes IS
    'One-time backup codes for TOTP recovery. Each code is stored as a SHA-256 hash; the plaintext is shown to the user exactly once at enroll time.';

COMMENT ON COLUMN user_backup_codes.profile_id IS
    'References profiles.id (= auth_users.id). Cascades on user deletion.';

COMMENT ON COLUMN user_backup_codes.code_hash IS
    'SHA-256 hex digest of the raw 8-character alphanumeric backup code.';

COMMENT ON COLUMN user_backup_codes.used_at IS
    'Timestamp of first (and only permitted) use. NULL means the code is still valid.';

-- Performance: fast lookup by user when validating a backup code.
CREATE INDEX IF NOT EXISTS idx_user_backup_codes_profile_id
    ON user_backup_codes (profile_id);

-- Performance: find unused codes for a user.
CREATE INDEX IF NOT EXISTS idx_user_backup_codes_unused
    ON user_backup_codes (profile_id)
    WHERE used_at IS NULL;

-- =============================================================================
-- §3  RLS — user_backup_codes
-- =============================================================================

REVOKE ALL ON user_backup_codes FROM PUBLIC;

ALTER TABLE user_backup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_backup_codes FORCE ROW LEVEL SECURITY;

-- Each user can only SELECT their own backup code rows (needed for the UI
-- to show "N codes remaining"). Actual validation is done at service-role
-- to prevent timing attacks.
CREATE POLICY user_backup_codes_select ON user_backup_codes FOR SELECT
    USING (profile_id = current_user_id() OR is_service_role());

-- Only service-role may insert or update (the backend writes them, never
-- the client directly).
CREATE POLICY user_backup_codes_insert ON user_backup_codes FOR INSERT
    WITH CHECK (is_service_role());

CREATE POLICY user_backup_codes_update ON user_backup_codes FOR UPDATE
    USING (is_service_role());

CREATE POLICY user_backup_codes_delete ON user_backup_codes FOR DELETE
    USING (is_service_role());
