-- =============================================================================
-- 050_email_verification_tokens.sql — email verification token table
-- =============================================================================
--
-- Introduces email_verification_tokens, used by the POST /auth/verify/send
-- and POST /auth/verify/confirm flows.  password_reset_tokens already exists
-- (pre-migration); this migration adds the parallel table for email
-- verification links.
--
-- Pre-flight checks (read-only psql before writing):
--   • email_verification_tokens does NOT exist in migrations 001-049.
--     → CREATE TABLE is safe.
--   • auth_users has email_verified bool column (migration 002).
--   • is_service_role() helper defined in migration 001.
-- =============================================================================

-- =============================================================================
-- §1  email_verification_tokens — token table
-- =============================================================================

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash  text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user
    ON email_verification_tokens (user_id);

-- =============================================================================
-- §2  email_verification_tokens — RLS
-- =============================================================================

REVOKE ALL ON email_verification_tokens FROM PUBLIC;

ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens FORCE ROW LEVEL SECURITY;

-- Only service-role may read (tokens are opaque server-side secrets).
DO $$
BEGIN
    CREATE POLICY email_verification_tokens_select
        ON email_verification_tokens
        FOR SELECT
        USING (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy email_verification_tokens_select already exists; skipping.';
END;
$$;

-- Only service-role may insert (handler runs under ServiceRoleScope).
DO $$
BEGIN
    CREATE POLICY email_verification_tokens_insert
        ON email_verification_tokens
        FOR INSERT
        WITH CHECK (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy email_verification_tokens_insert already exists; skipping.';
END;
$$;

-- Only service-role may update (mark consumed_at).
DO $$
BEGIN
    CREATE POLICY email_verification_tokens_update
        ON email_verification_tokens
        FOR UPDATE
        USING (is_service_role())
        WITH CHECK (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy email_verification_tokens_update already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLE: email_verification_tokens
--   id          uuid        PK, gen_random_uuid()
--   user_id     uuid NOT NULL FK → auth_users(id) ON DELETE CASCADE
--   token_hash  text NOT NULL    — sha256 hex of the raw token (server-side only)
--   expires_at  timestamptz NOT NULL
--   consumed_at timestamptz NULL — set when the token is successfully used
--   created_at  timestamptz NOT NULL DEFAULT now()
--
-- INDEXES
--   idx_email_verification_tokens_user (user_id)
--
-- RLS REASONING
--   All operations restricted to is_service_role() — tokens are opaque to end
--   users and are only ever read/written by Go handlers running under
--   ServiceRoleScope (db.Scoped with db.ServiceRoleScope()).
-- =============================================================================
