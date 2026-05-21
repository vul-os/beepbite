-- =============================================================================
-- MIGRATION 027 — WAVE 22: PUBLIC API KEYS + TENANT WEBHOOKS (INCREMENTAL)
-- =============================================================================
-- api_keys and webhook_endpoints already exist with RLS from migration 007.
-- This migration only:
--   1. ADDs the new columns (environment, description) to those tables.
--   2. CREATEs the webhook_deliveries table (new in Wave 22).
--   3. ADDs idx_api_keys_key_hash (not created in 007).
--
-- DO NOT recreate api_keys or webhook_endpoints — their core columns, triggers,
-- and RLS policies are owned by 007 and must not be touched here.
--
-- RLS policy pattern matches 007 exactly:
--   USING (org_id = current_org_id() OR is_service_role())
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. api_keys — add `environment` column
-- ---------------------------------------------------------------------------
-- 007 defines: id, org_id, name, prefix_visible, key_hash, scopes,
--              expires_at, last_used_at, created_by, revoked_at,
--              created_at, updated_at.
-- Wave 22 adds: environment.
-- ---------------------------------------------------------------------------

ALTER TABLE api_keys
    ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'live'
        CHECK (environment IN ('live', 'test'));

-- idx_api_keys_key_hash was not created in 007 — add it here.
-- (idx_api_keys_prefix and idx_api_keys_org already exist from 007.)
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash
    ON api_keys (key_hash);

-- ---------------------------------------------------------------------------
-- 2. webhook_endpoints — add `description` column
-- ---------------------------------------------------------------------------
-- 007 defines: id, org_id, url, signing_secret_ciphertext, events,
--              is_active, created_at, updated_at.
-- Wave 22 adds: description.
-- ---------------------------------------------------------------------------

ALTER TABLE webhook_endpoints
    ADD COLUMN IF NOT EXISTS description text;

-- ---------------------------------------------------------------------------
-- 3. webhook_deliveries  [NEW — WAVE 22]
-- ---------------------------------------------------------------------------
-- Append-only delivery log and retry queue for outbound tenant webhooks.
-- org_id is denormalised from webhook_endpoints so the org-scoped RLS policy
-- works on tenant reads without a join.  Delivery worker writes under
-- service_role; tenants have org-scoped SELECT only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id     uuid        NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
    org_id          uuid        NOT NULL,   -- denormalised; matches endpoint's org_id
    event_type      text        NOT NULL,
    payload         jsonb       NOT NULL,
    status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'delivered', 'failed')),
    response_code   integer,               -- HTTP status code from last attempt
    attempts        integer     NOT NULL DEFAULT 0,
    last_error      text,                  -- last failure message / timeout reason
    created_at      timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz            -- set when status transitions to 'delivered'
);

-- Delivery worker: list deliveries for an endpoint in recency order.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint_created
    ON webhook_deliveries (endpoint_id, created_at DESC);

-- Retry worker: fast scan of non-delivered rows.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
    ON webhook_deliveries (status);

-- Tenant dashboard: org-scoped listing without joining webhook_endpoints.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id
    ON webhook_deliveries (org_id);

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;

-- SELECT: org members browse their delivery log; service_role for delivery worker.
-- Threat: cross-tenant inspection of another org's webhook payload contents.
CREATE POLICY webhook_deliveries_select ON webhook_deliveries FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());

-- INSERT: delivery worker (service_role) only — deliveries are system-generated.
-- Threat: tenant injecting fake delivery records.
CREATE POLICY webhook_deliveries_insert ON webhook_deliveries FOR INSERT
    WITH CHECK (is_service_role());

-- UPDATE: delivery worker (service_role) updates status, response_code, attempts.
-- Threat: tenant marking a failed delivery as delivered to suppress retries.
CREATE POLICY webhook_deliveries_update ON webhook_deliveries FOR UPDATE
    USING  (is_service_role())
    WITH CHECK (is_service_role());

-- DELETE: service_role only (retention / GDPR erasure jobs).
-- Threat: tenant deleting delivery evidence.
CREATE POLICY webhook_deliveries_delete ON webhook_deliveries FOR DELETE
    USING (is_service_role());

COMMENT ON TABLE webhook_deliveries IS
    'Append-only delivery log and retry queue for outbound tenant webhooks. '
    'Rows are created by the delivery worker (service_role) on each event dispatch. '
    'org_id is denormalised from webhook_endpoints for org-scoped RLS SELECT. '
    'Tenant users have org-scoped SELECT for dashboard/debug views; all writes '
    'are restricted to service_role. Wave 22 feature.';

COMMENT ON COLUMN webhook_deliveries.org_id IS
    'Denormalised from webhook_endpoints.org_id. '
    'Enables org-scoped RLS SELECT without a join. '
    'Must match the org_id of the referenced endpoint_id.';

COMMENT ON COLUMN webhook_deliveries.payload IS
    'Full JSON event payload delivered (or attempted) to the endpoint. '
    'Stored for replay and audit. May contain PII — subject to org-scoped RLS.';

COMMENT ON COLUMN webhook_deliveries.status IS
    '"pending" = not yet attempted; "delivered" = HTTP 2xx received; '
    '"failed" = exhausted retries or non-retryable error. '
    'Retry worker selects WHERE status IN (''pending'', ''failed'').';

COMMENT ON COLUMN webhook_deliveries.attempts IS
    'Number of delivery attempts made so far (including the first try). '
    'Retry worker increments this on each attempt. '
    'Upper retry limit (e.g. 5) is enforced in Go, not in the schema.';

-- =============================================================================
-- OBJECT SUMMARY
-- =============================================================================
--
-- ALTERED
--   api_keys.environment         text NOT NULL DEFAULT 'live' CHECK IN ('live','test')
--   webhook_endpoints.description  text  (nullable)
--
-- CREATED INDEX
--   idx_api_keys_key_hash        ON api_keys(key_hash)
--
-- NEW TABLE
--   webhook_deliveries
--     id              uuid PK
--     endpoint_id     uuid NOT NULL → webhook_endpoints(id) ON DELETE CASCADE
--     org_id          uuid NOT NULL   (denormalised for RLS)
--     event_type      text NOT NULL
--     payload         jsonb NOT NULL
--     status          text NOT NULL DEFAULT 'pending' CHECK IN ('pending','delivered','failed')
--     response_code   integer
--     attempts        integer NOT NULL DEFAULT 0
--     last_error      text
--     created_at      timestamptz NOT NULL DEFAULT now()
--     delivered_at    timestamptz
--   Indexes: idx_webhook_deliveries_endpoint_created, idx_webhook_deliveries_status,
--            idx_webhook_deliveries_org_id
--   RLS: ENABLE + FORCE; 4 policies (org_id-scoped SELECT; service_role-only writes)
-- =============================================================================
