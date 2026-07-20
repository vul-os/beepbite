-- =============================================================================
-- MIGRATION 013 — COMPLIANCE
-- =============================================================================
-- Sources: legacy 23 (audit_log_and_idempotency.sql),
--          legacy 39 (pii_log_and_audit_retention.sql).
--
-- Tables defined here:
--   audit_log            — polymorphic append-only event trail
--   audit_log_archived   — cold storage mirror for the archive job (Wave 4)
--   idempotency_keys     — service-level safe-retry cache (not tenant-scoped)
--   pii_access_log       — PII field access entries
--
-- Notes:
--   - webhook_event_log is in migration 008 (payments domain) — NOT here.
--   - audit_log uses the actor_type enum defined in 001.
--   - actor_type CHECK now includes 'api_key' (enum value added in 001 vs the
--     legacy text CHECK which listed only 4 values).
--   - idempotency_keys: system-level only; NOT org-scoped RLS.
--
-- RLS strategy:
--   audit_log:       append-only; INSERT via service_role; SELECT by org;
--                    UPDATE/DELETE blocked for everyone via RLS.
--   audit_log_archived: mirrors audit_log RLS (SELECT service_role only;
--                    INSERT service_role only via archive job).
--   idempotency_keys: service_role only on all operations.
--   pii_access_log:  INSERT from any authenticated session; SELECT service_role only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. audit_log
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenant context (nullable for system-level events with no org scope)
    organization_id uuid        REFERENCES organizations(id) ON DELETE SET NULL,
    location_id     uuid        REFERENCES locations(id)     ON DELETE SET NULL,

    -- Polymorphic actor (resolved in application layer, never FK'd in DB)
    --   member  → auth_users.id / profiles.id
    --   staff   → staff.id
    --   system  → NULL (background job)
    --   customer→ customers.id
    --   webhook → NULL (inbound webhook)
    --   api_key → api_keys.id
    actor_type      actor_type  NOT NULL,
    actor_id        uuid,       -- polymorphic; not FK'd
    actor_label     text,       -- human-readable: "jane@acme.com", "staff:T-12", "system:cron"

    -- What happened and to what entity
    action          text        NOT NULL,   -- e.g. 'item.price_changed', 'order.voided', 'drawer.closed'
    entity_type     text        NOT NULL,   -- e.g. 'order', 'item', 'staff', 'promotion'
    entity_id       uuid,                   -- polymorphic; not FK'd

    -- State diff (partial snapshots of changed fields only)
    before_state    jsonb,
    after_state     jsonb,
    reason          text,

    -- Request context
    metadata        jsonb       NOT NULL DEFAULT '{}',
    ip              inet,
    user_agent      text,

    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
    -- NO updated_at: this table is append-only; existing rows are immutable.
);

CREATE INDEX idx_audit_log_org_created     ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_log_location_created ON audit_log(location_id,     created_at DESC)
    WHERE location_id IS NOT NULL;
CREATE INDEX idx_audit_log_actor           ON audit_log(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_audit_log_entity          ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_log_action_created  ON audit_log(action, created_at DESC);

COMMENT ON TABLE audit_log IS
    'Append-only audit trail. Written exclusively by application code via the '
    'service role (not by DB triggers). actor_type uses the actor_type enum from '
    'migration 001. No updated_at — rows are immutable once inserted.';

-- RLS — append-only; UPDATE and DELETE are closed off for everyone.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- Tenant members can read their own org's audit rows (for the audit viewer in /manager).
-- Service role can read all rows.
CREATE POLICY audit_log_select ON audit_log FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

-- Only service_role may INSERT. Handlers must use a service-scope transaction
-- for audit writes; this is intentional so a compromised tenant session cannot
-- forge audit rows.
CREATE POLICY audit_log_insert ON audit_log FOR INSERT
    WITH CHECK (is_service_role());

-- Audit log is immutable: no UPDATE or DELETE by anyone.
-- (service_role bypasses RLS in practice, but explicitly documenting intent.)
CREATE POLICY audit_log_update ON audit_log FOR UPDATE
    USING (false);

CREATE POLICY audit_log_delete ON audit_log FOR DELETE
    USING (false);


-- ---------------------------------------------------------------------------
-- 2. audit_log_archived
-- ---------------------------------------------------------------------------
-- Mirrors audit_log schema exactly. Populated by the archive_old_audit_log()
-- function below. Treated as cold storage; not queried by tenant-facing APIs.
-- This table is intentionally defined AFTER audit_log so LIKE ... INCLUDING ALL
-- captures the correct column definitions.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log_archived (LIKE audit_log INCLUDING ALL);

COMMENT ON TABLE audit_log_archived IS
    'Cold archive of audit_log rows older than the retention window. '
    'Populated by archive_old_audit_log(retain_days). Queried by the Wave 4 '
    'compliance export job only; not surfaced to tenant-facing API.';

-- RLS — service_role only for both read and write.
ALTER TABLE audit_log_archived ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_archived FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_archived_select ON audit_log_archived FOR SELECT
    USING (is_service_role());

CREATE POLICY audit_log_archived_insert ON audit_log_archived FOR INSERT
    WITH CHECK (is_service_role());

CREATE POLICY audit_log_archived_update ON audit_log_archived FOR UPDATE
    USING (false);

CREATE POLICY audit_log_archived_delete ON audit_log_archived FOR DELETE
    USING (false);


-- ---------------------------------------------------------------------------
-- 3. archive_old_audit_log()
-- ---------------------------------------------------------------------------
-- Wave 4 scheduled job calls this. For v1 it moves rows; partitioning is a
-- follow-up (add btree_gist + range partitioning on created_at then).
-- Returns the number of rows moved (suitable for cron job logging).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION archive_old_audit_log(retain_days int)
RETURNS TABLE (moved_rows bigint)
LANGUAGE plpgsql
AS $$
DECLARE
    v_cutoff timestamptz;
BEGIN
    v_cutoff := now() - (retain_days || ' days')::interval;

    WITH deleted AS (
        DELETE FROM audit_log
        WHERE created_at < v_cutoff
        RETURNING *
    )
    INSERT INTO audit_log_archived SELECT * FROM deleted;

    GET DIAGNOSTICS moved_rows = ROW_COUNT;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION archive_old_audit_log(int) IS
    'Move audit_log rows older than retain_days days into audit_log_archived. '
    'Called by the Wave 4 compliance retention job. Returns count of moved rows.';


-- ---------------------------------------------------------------------------
-- 4. idempotency_keys
-- ---------------------------------------------------------------------------
-- System-level table for safe retries of payment calls and inbound webhook
-- handlers. NOT org-scoped: service_role only.
-- The (scope, key) unique pair is the primary lookup — additional columns
-- cache the original response so retries return the exact same outcome.
-- ---------------------------------------------------------------------------

CREATE TABLE idempotency_keys (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Namespace + client-supplied key form the unique lookup.
    --   scope examples: 'pos_charge', 'whatsapp_inbound'
    --   key  examples:  'order:<uuid>', 'wa:msg:<message_id>'
    scope           text        NOT NULL,
    key             text        NOT NULL,
    -- sha256 of the request body; if the same key is reused with a different
    -- body the handler should return HTTP 409 (conflict).
    request_hash    text,

    status          text        NOT NULL DEFAULT 'in_progress'
                                CHECK (status IN ('in_progress', 'completed', 'failed')),

    -- Cached response for exact-same-outcome retries.
    response_status int,        -- HTTP status of the original response
    response_body   jsonb,
    response_headers jsonb,

    -- Resulting entity for audit / debug cross-reference.
    entity_type     text,       -- e.g. 'order_payment', 'order'
    entity_id       uuid,

    error_message   text,

    -- Advisory worker lock (for concurrency control; not a hard Postgres lock).
    locked_at       timestamptz,
    locked_by       text,       -- process/host identifier

    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    completed_at    timestamptz,
    -- 24–48h typical; enforced by retention sweep, not DB CHECK.
    expires_at      timestamptz NOT NULL,

    UNIQUE (scope, key)
);

-- The UNIQUE(scope, key) constraint already provides a primary lookup index.
CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys(expires_at)
    WHERE status = 'completed';  -- retention sweep

CREATE INDEX idx_idempotency_keys_stuck ON idempotency_keys(status, locked_at)
    WHERE status = 'in_progress';  -- stuck-lock recovery sweep

COMMENT ON TABLE idempotency_keys IS
    'Service-level idempotency cache for payment calls and inbound webhook '
    'handlers. NOT tenant-scoped. scope+key is the unique lookup; the cached '
    'response columns guarantee exact-same-outcome on retry. Expired rows are '
    'cleaned up by the retention sweep job.';

-- RLS — service_role only; tenants never touch this table.
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY idempotency_keys_all ON idempotency_keys
    USING   (is_service_role())
    WITH CHECK (is_service_role());


-- ---------------------------------------------------------------------------
-- 5. pii_access_log
-- ---------------------------------------------------------------------------
-- Records every time a staff member, manager, or system job accesses
-- personal-data fields on a customer record. Populated by application code
-- at the handler layer; not driven by DB triggers (trigger overhead on every
-- customer SELECT is too high).
--
-- RLS:
--   INSERT from any authenticated session (any role can emit a PII access
--   record when it touches PII — this is intentional; we log broadly).
--   SELECT: service_role only (compliance officer / audit export only).
-- ---------------------------------------------------------------------------

CREATE TABLE pii_access_log (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type      actor_type  NOT NULL,   -- uses enum from 001
    actor_id        uuid,
    customer_id     uuid        REFERENCES customers(id) ON DELETE SET NULL,
    access_kind     text        NOT NULL    CHECK (access_kind IN ('view', 'export', 'update', 'search')),
    -- List of field names accessed, e.g. ARRAY['email','phone','address']
    fields_accessed text[]      NOT NULL DEFAULT '{}',
    reason          text,
    request_id      text,
    ip_address      inet,
    user_agent      text,
    accessed_at     timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_pii_access_log_customer ON pii_access_log(customer_id, accessed_at DESC)
    WHERE customer_id IS NOT NULL;
CREATE INDEX idx_pii_access_log_actor    ON pii_access_log(actor_type, actor_id, accessed_at DESC);
CREATE INDEX idx_pii_access_log_kind     ON pii_access_log(access_kind, accessed_at DESC);

COMMENT ON TABLE pii_access_log IS
    'Records every access to customer PII fields by staff / system / export jobs. '
    'Written by application code (not DB triggers). SELECT restricted to '
    'service_role to prevent PII log from becoming a privacy leak itself.';

-- RLS — write-open to authenticated; read restricted to service_role.
ALTER TABLE pii_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_access_log FORCE ROW LEVEL SECURITY;

-- Any authenticated session may INSERT (a staff member looking up a customer
-- should write the PII log row without extra privilege).
CREATE POLICY pii_access_log_insert ON pii_access_log FOR INSERT
    WITH CHECK (true);  -- gated by connection-level auth, not org check

-- Only service_role may SELECT (compliance / audit export).
CREATE POLICY pii_access_log_select ON pii_access_log FOR SELECT
    USING (is_service_role());

-- No UPDATE or DELETE — PII log is append-only.
CREATE POLICY pii_access_log_update ON pii_access_log FOR UPDATE
    USING (false);

CREATE POLICY pii_access_log_delete ON pii_access_log FOR DELETE
    USING (false);


-- ---------------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------------
-- audit_log / pii_access_log: PUBLIC needs INSERT so app connections can write.
-- SELECT on audit_log is allowed to PUBLIC but RLS restricts it to org rows.
-- idempotency_keys / audit_log_archived: service_role only.
GRANT SELECT, INSERT ON audit_log        TO PUBLIC;
GRANT INSERT         ON pii_access_log   TO PUBLIC;
-- service_role already has ALL via default privileges from migration 001.

-- ---------------------------------------------------------------------------
-- DONE — Migration 013
-- Tables: audit_log, audit_log_archived, idempotency_keys, pii_access_log
-- Functions: archive_old_audit_log(int)
-- ---------------------------------------------------------------------------
