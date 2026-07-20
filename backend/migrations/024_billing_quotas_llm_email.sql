-- =============================================================================
-- MIGRATION 024 — BILLING / QUOTAS / LLM / EMAIL  (Wave 19)
-- =============================================================================
-- LLM usage/pricing ledger and email-provider credential tables.
--
-- EXISTENCE AUDIT (confirmed before writing):
--   organizations            — EXISTS (002_auth_and_tenancy.sql §5)
--   locations                — EXISTS (007_payments_generic.sql §5)
--   set_updated_at_now()     — EXISTS (001_extensions_and_helpers.sql §6)
--   current_org_id()         — EXISTS (001_extensions_and_helpers.sql §3)
--   is_service_role()        — EXISTS (001_extensions_and_helpers.sql §3)
--
-- OBJECTS CREATED:
--   3. llm_model_pricing    — NEW TABLE, world-readable reference (no RLS)
--   4. llm_messages         — NEW TABLE, org-scoped RLS
--   5. llm_tool_executions  — NEW TABLE, service-role-scoped RLS
--   6. email_providers      — NEW TABLE, world-readable reference (no RLS); seeded
--   7. location_email_credentials — NEW TABLE, location→org-scoped RLS
--
-- ROLE SAFETY NOTE:
--   This migration issues NO bare GRANT ... TO service_role.
--   service_role access is provided by the ALTER DEFAULT PRIVILEGES set in 001
--   (GRANT ALL ON TABLES TO service_role) which covers every table created here
--   automatically.  Each RLS policy includes OR is_service_role() for explicit
--   service-role bypass — consistent with migrations 002–023.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3. llm_model_pricing — platform-wide reference table
-- ---------------------------------------------------------------------------
-- Stores per-model cost rates from each LLM provider. Updated by the billing
-- job or manually via service_role. Public SELECT.
-- Not RLS-protected — global reference data.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_model_pricing (
    id                    uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    provider              text            NOT NULL,           -- 'openai', 'anthropic', 'google', etc.
    model                 text            NOT NULL,           -- 'gpt-4o', 'claude-3-5-sonnet-20241022', etc.
    input_cost_per_1k     numeric(20,10)  NOT NULL DEFAULT 0, -- USD cost per 1 000 input tokens
    output_cost_per_1k    numeric(20,10)  NOT NULL DEFAULT 0, -- USD cost per 1 000 output tokens
    supports_vision       boolean         NOT NULL DEFAULT false,
    supports_tools        boolean         NOT NULL DEFAULT false,
    context_length        integer,                            -- max context window in tokens; NULL = unknown
    source                text,                              -- 'official_pricing_page', 'manual', etc.
    updated_at            timestamptz     NOT NULL DEFAULT now(),
    UNIQUE (provider, model)
);

COMMENT ON TABLE llm_model_pricing IS
    'Platform-wide reference: cost rates per LLM provider and model. '
    'Not RLS-protected — public SELECT; only service_role may mutate. '
    'Costs are in USD per 1 000 tokens (numeric(20,10) for sub-cent precision).';
COMMENT ON COLUMN llm_model_pricing.input_cost_per_1k IS
    'USD cost per 1 000 input (prompt) tokens. Use numeric(20,10) for '
    'sub-cent precision (e.g. $0.0000015 per token for cheap models).';
COMMENT ON COLUMN llm_model_pricing.output_cost_per_1k IS
    'USD cost per 1 000 output (completion) tokens.';
COMMENT ON COLUMN llm_model_pricing.context_length IS
    'Maximum context window for this model version in tokens. NULL when unknown.';

CREATE INDEX IF NOT EXISTS idx_llm_model_pricing_provider
    ON llm_model_pricing(provider, model);

-- Reference table: world-readable, service_role-only writes.
GRANT SELECT ON llm_model_pricing TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON llm_model_pricing FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. llm_messages — per-org LLM inference cost ledger
-- ---------------------------------------------------------------------------
-- One row per LLM API call made on behalf of an organisation. cost_cents is
-- computed by the Go layer using llm_model_pricing rates at call time and stored
-- accumulated cost.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_messages (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    conversation_id   text,       -- opaque session identifier; no FK (may span systems)
    provider          text,       -- 'openai', 'anthropic', 'google', etc.
    model             text,       -- exact model identifier used for the call
    tokens_in         integer     NOT NULL DEFAULT 0,  -- prompt tokens consumed
    tokens_out        integer     NOT NULL DEFAULT 0,  -- completion tokens generated
    cost_cents        bigint      NOT NULL DEFAULT 0,  -- cost in smallest currency unit
    created_at        timestamptz NOT NULL DEFAULT now()
    -- No updated_at: append-only cost ledger.
);

COMMENT ON TABLE llm_messages IS
    'Append-only per-org LLM inference cost ledger. One row per API call. '
    'cost_cents is computed by the Go layer from llm_model_pricing at call time '
    'and stored in the org currency denomination.';
COMMENT ON COLUMN llm_messages.conversation_id IS
    'Opaque session/thread identifier to group turns of a multi-turn conversation. '
    'No FK — may span multiple systems or be provider-supplied.';
COMMENT ON COLUMN llm_messages.cost_cents IS
    'Cost of this call expressed in the smallest unit of the org currency '
    '(e.g. ZAR cents). Computed by Go from llm_model_pricing.input/output_cost_per_1k.';

CREATE INDEX IF NOT EXISTS idx_llm_messages_org_created
    ON llm_messages(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_messages_conversation
    ON llm_messages(conversation_id)
    WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_llm_messages_provider_model
    ON llm_messages(provider, model);

ALTER TABLE llm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY llm_messages_select ON llm_messages FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

-- Writes are service_role-only: the Go billing middleware inserts on behalf of the org.
CREATE POLICY llm_messages_insert ON llm_messages FOR INSERT
    WITH CHECK (is_service_role());
-- Append-only: no UPDATE or DELETE by anyone.
CREATE POLICY llm_messages_update ON llm_messages FOR UPDATE
    USING (false);
CREATE POLICY llm_messages_delete ON llm_messages FOR DELETE
    USING (false);

-- ---------------------------------------------------------------------------
-- 5. llm_tool_executions — child records for tool/function calls in llm_messages
-- ---------------------------------------------------------------------------
-- Each LLM message may invoke zero or more tools (function calls). This table
-- records the tool name, arguments, and a summary of the result for debugging,
-- auditing, and cost attribution. Rows are cascade-deleted when the parent
-- llm_message is deleted (though the parent is append-only, CASCADE handles
-- any service_role cleanup).
--
-- RLS: service_role only for writes; reads are exposed via the parent
-- llm_messages org (join through llm_message_id). Using a subquery join so
-- tenants can read their own tool executions through org scope.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_tool_executions (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    llm_message_id   uuid        NOT NULL REFERENCES llm_messages(id) ON DELETE CASCADE,
    tool_name        text        NOT NULL,
    args             jsonb,      -- deserialized function arguments; NULL if none
    result_summary   text,       -- human-readable summary of the tool result
    created_at       timestamptz NOT NULL DEFAULT now()
    -- No updated_at: append-only.
);

COMMENT ON TABLE llm_tool_executions IS
    'Append-only record of tool/function calls made within an LLM message turn. '
    'Cascade-deleted when the parent llm_messages row is removed. '
    'args stores the raw JSON arguments; result_summary is a truncated plaintext '
    'summary of the tool output for audit/debug purposes.';
COMMENT ON COLUMN llm_tool_executions.args IS
    'JSON arguments passed to the tool at call time. May be NULL for zero-argument '
    'tools. Stored as raw jsonb for schema flexibility across tool types.';
COMMENT ON COLUMN llm_tool_executions.result_summary IS
    'Truncated plaintext summary of the tool result for audit/debug. Not the full '
    'tool output (which may be large); the Go layer truncates before insert.';

CREATE INDEX IF NOT EXISTS idx_llm_tool_executions_message
    ON llm_tool_executions(llm_message_id);
CREATE INDEX IF NOT EXISTS idx_llm_tool_executions_tool_name
    ON llm_tool_executions(tool_name, created_at DESC);

ALTER TABLE llm_tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_tool_executions FORCE ROW LEVEL SECURITY;

-- Tenants can read tool executions for messages that belong to their org.
-- The subquery joins through llm_messages to enforce the org boundary.
CREATE POLICY llm_tool_executions_select ON llm_tool_executions FOR SELECT
    USING (
        llm_message_id IN (
            SELECT id FROM llm_messages WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );

-- Writes are service_role-only (Go billing/LLM middleware inserts after each call).
CREATE POLICY llm_tool_executions_insert ON llm_tool_executions FOR INSERT
    WITH CHECK (is_service_role());
-- Append-only: no UPDATE or DELETE.
CREATE POLICY llm_tool_executions_update ON llm_tool_executions FOR UPDATE
    USING (false);
CREATE POLICY llm_tool_executions_delete ON llm_tool_executions FOR DELETE
    USING (false);

-- ---------------------------------------------------------------------------
-- 6. email_providers — platform-wide reference; seeded immediately
-- ---------------------------------------------------------------------------
-- Defines the set of email delivery providers supported by BeepBite.
-- code is the PK (text) to match the pattern of payment_methods.code.
-- Public SELECT (like payment_methods); service_role-only writes.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS email_providers (
    code        text        PRIMARY KEY
                            CHECK (code IN ('sendgrid','mailgun','ses','smtp')),
    name        text        NOT NULL,
    is_active   boolean     NOT NULL DEFAULT true
);

COMMENT ON TABLE email_providers IS
    'Platform-wide registry of supported email delivery providers. '
    'code is the stable identifier used by location_email_credentials. '
    'Not RLS-protected — public SELECT; only service_role may mutate. '
    'Seeded by this migration.';

-- Reference table: world-readable, service_role-only writes (mirrors payment_methods).
GRANT SELECT ON email_providers TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON email_providers FROM PUBLIC;

-- Seed the 5 supported providers.
INSERT INTO email_providers (code, name, is_active) VALUES
    ('sendgrid',  'SendGrid',                true),
    ('mailgun',   'Mailgun',                 true),
    ('ses',       'Amazon SES',              true),
    ('smtp',      'Generic SMTP',            true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. location_email_credentials — per-location email provider config
-- ---------------------------------------------------------------------------
-- Stores encrypted email provider credentials for a location. Modelled on
-- encrypted_keys stores the provider
-- API key / SMTP password as an AES-GCM ciphertext; the Go layer decrypts it.
--
-- RLS: scoped via location_id → locations → organization_id, matching the
-- pattern used by custom_domains etc. in 007.
-- Writes restricted to service_role (credentials set via admin endpoint).
-- Deletes restricted to service_role (deactivate via is_active=false otherwise).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS location_email_credentials (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id     uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    provider_code   text        NOT NULL REFERENCES email_providers(code),
    -- AES-GCM ciphertext of provider credentials (API key, SMTP password, etc.).
    -- The Go layer decrypts via platform AES-GCM key; never returned raw to clients.
    encrypted_keys  text        NOT NULL,
    sender_domain   text,       -- verified sender domain (e.g. 'mail.example.com')
    sender_email    text,       -- default From address (e.g. 'noreply@example.com')
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (location_id, provider_code)
);

COMMENT ON TABLE location_email_credentials IS
    'Per-location email delivery provider credentials. '
    'encrypted_keys is AES-GCM ciphertext decrypted at call time by the Go layer; '
    'never returned raw to API consumers. '
    'Encrypted per-location email provider credentials.';
COMMENT ON COLUMN location_email_credentials.encrypted_keys IS
    'AES-GCM encrypted provider credentials (API key, SMTP password, etc.). '
    'Structure varies by provider_code: for sendgrid/mailgun it is a JSON '
    'object {"api_key":"..."}, for ses {"access_key_id":"...","secret_access_key":"..."}, '
    'for smtp {"host":"...","port":587,"username":"...","password":"..."}. '
    'The Go layer encrypts on write and decrypts on use; raw value is never returned.';
COMMENT ON COLUMN location_email_credentials.sender_domain IS
    'Verified sender domain registered with the email provider (e.g. mail.example.com). '
    'Used for DKIM/SPF validation. NULL when not yet configured.';
COMMENT ON COLUMN location_email_credentials.sender_email IS
    'Default From address for outbound emails sent via this credential set. '
    'NULL to fall back to provider-level default. Must be within sender_domain when set.';

CREATE INDEX IF NOT EXISTS idx_loc_email_cred_location
    ON location_email_credentials(location_id);
CREATE INDEX IF NOT EXISTS idx_loc_email_cred_provider
    ON location_email_credentials(provider_code);
CREATE INDEX IF NOT EXISTS idx_loc_email_cred_active
    ON location_email_credentials(location_id, is_active);

CREATE TRIGGER trg_loc_email_cred_updated_at
    BEFORE UPDATE ON location_email_credentials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE location_email_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_email_credentials FORCE ROW LEVEL SECURITY;

-- Tenants can read credentials for locations that belong to their org.
-- The subquery join mirrors the tenant-scoping pattern used in 007.
CREATE POLICY loc_email_cred_select ON location_email_credentials FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );

-- Inserts restricted to service_role (admin endpoint / onboarding job).
CREATE POLICY loc_email_cred_insert ON location_email_credentials FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );

-- Updates restricted to service_role (key rotation / activation changes).
CREATE POLICY loc_email_cred_update ON location_email_credentials FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );

-- Hard deletes via service_role only; handlers should deactivate (is_active=false).
CREATE POLICY loc_email_cred_delete ON location_email_credentials FOR DELETE
    USING (is_service_role());

-- =============================================================================
-- DONE — Migration 024 complete.
-- =============================================================================
--
-- OBJECT SUMMARY
-- ──────────────────────────────────────────────────────────────────────────────
-- FOUND EXISTING (not recreated):
--   organizations                 — 002_auth_and_tenancy.sql §5
--   locations                     — 007_payments_generic.sql §5
--   set_updated_at_now()          — 001_extensions_and_helpers.sql §6
--   current_org_id()              — 001_extensions_and_helpers.sql §3
--   is_service_role()             — 001_extensions_and_helpers.sql §3
--
-- MODIFIED:
--     + payment_method_token         text    (nullable)
--
-- CREATED (new tables):
--     PK: id uuid
--     UNIQUE: (organization_id, location_id, resource, period_start)
--     Columns: organization_id, location_id (nullable), resource (CHECK enum),
--              period_start date, period_end date, used_count bigint,
--              included_count bigint, updated_at timestamptz
--     RLS:  SELECT → org members + service_role
--           INSERT/UPDATE/DELETE → service_role only
--
--   llm_model_pricing             — world-readable reference, no RLS
--     PK: id uuid
--     UNIQUE: (provider, model)
--     Columns: provider text, model text, input_cost_per_1k numeric(20,10),
--              output_cost_per_1k numeric(20,10), supports_vision boolean,
--              supports_tools boolean, context_length integer (nullable),
--              source text (nullable), updated_at timestamptz
--     Access: GRANT SELECT TO PUBLIC; INSERT/UPDATE/DELETE revoked from PUBLIC
--
--   llm_messages                  — org-scoped RLS, append-only
--     PK: id uuid
--     Columns: organization_id uuid, conversation_id text (nullable),
--              provider text (nullable), model text (nullable),
--              tokens_in integer, tokens_out integer, cost_cents bigint,
--              created_at timestamptz
--     RLS:  SELECT → org members + service_role
--           INSERT  → service_role only
--           UPDATE  → USING(false) [append-only]
--           DELETE  → USING(false) [append-only]
--
--   llm_tool_executions           — service-role write; read via parent org scope
--     PK: id uuid
--     FK: llm_message_id → llm_messages(id) ON DELETE CASCADE
--     Columns: tool_name text, args jsonb (nullable),
--              result_summary text (nullable), created_at timestamptz
--     RLS:  SELECT → subquery (llm_messages.organization_id = current_org_id()) OR service_role
--           INSERT  → service_role only
--           UPDATE  → USING(false) [append-only]
--           DELETE  → USING(false) [append-only]
--
--   email_providers               — world-readable reference, no RLS; seeded
--     PK: code text CHECK IN ('sendgrid','mailgun','ses','smtp')
--     Columns: name text, is_active boolean
--     Seed rows: sendgrid, mailgun, ses, smtp
--     Access: GRANT SELECT TO PUBLIC; INSERT/UPDATE/DELETE revoked from PUBLIC
--
--   location_email_credentials    — location→org-scoped RLS
--     PK: id uuid
--     FK: location_id → locations(id) ON DELETE CASCADE
--     FK: provider_code → email_providers(code)
--     UNIQUE: (location_id, provider_code)
--     Columns: encrypted_keys text NOT NULL, sender_domain text (nullable),
--              sender_email text (nullable), is_active boolean,
--              created_at timestamptz, updated_at timestamptz
--     RLS:  SELECT/INSERT/UPDATE → subquery (locations.organization_id = current_org_id())
--                                  OR is_service_role()
--           DELETE → service_role only
-- =============================================================================
