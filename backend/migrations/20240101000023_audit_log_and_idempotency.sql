-- ======================
-- AUDIT LOG + IDEMPOTENCY
-- Generic, append-only audit trail; application-level (Go writes the rows,
-- not DB triggers). Paired with idempotency_keys for safe payment/webhook
-- retries and webhook_event_log for non-delivery-partner inbound events.
-- ======================

-- Create audit_log table (append-only event log for sensitive mutations)
CREATE TABLE audit_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL, -- usually NOT NULL in practice but keep nullable for system-level events
    location_id uuid REFERENCES locations(id) ON DELETE SET NULL,

    -- Actor (polymorphic; resolved in application layer)
    actor_type text NOT NULL CHECK (actor_type IN ('member','staff','system','customer','webhook')),
    actor_id uuid, -- member→profiles.id, staff→staff.id, customer→customers.id, system/webhook → NULL
    actor_label text, -- human-readable ("jane@acme.com", "staff:T-12 cashier", "system:migration")

    -- Action + target entity
    action text NOT NULL, -- e.g. 'item.price_changed', 'order.voided', 'order.comped', 'staff.role_changed', 'promotion.applied', 'refund.issued', 'staff.password_reset', 'menu.86ed', 'drawer.closed'
    entity_type text NOT NULL, -- e.g. 'order', 'item', 'staff', 'promotion'
    entity_id uuid, -- polymorphic; not FK'd

    -- Change payload
    before_state jsonb, -- partial snapshot of changed fields
    after_state jsonb, -- partial snapshot of changed fields
    reason text,

    -- Request context
    metadata jsonb DEFAULT '{}'::jsonb, -- free-form (e.g. request id, user agent, ip)
    ip inet,
    user_agent text,

    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
    -- NO updated_at — this table is append-only
);

CREATE INDEX idx_audit_log_org_created ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_log_location_created ON audit_log(location_id, created_at DESC) WHERE location_id IS NOT NULL;
CREATE INDEX idx_audit_log_actor ON audit_log(actor_type, actor_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_log_action_created ON audit_log(action, created_at DESC);


-- Create idempotency_keys table (keyed cache for safe retries of payments + webhook handlers)
CREATE TABLE idempotency_keys (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    key text NOT NULL, -- client-supplied or webhook-derived (e.g. paystack:event:<event_id>, stripe:<idempotency_key>, whatsapp:message:<id>)
    scope text NOT NULL, -- namespace, e.g. 'order_payment', 'paystack_webhook', 'uber_eats_webhook', 'whatsapp_inbound'
    request_hash text, -- sha256 of the request body to detect key reuse with different payload (collision → 409)

    status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','failed')),

    -- Cached response so retries return the exact original outcome
    response_status int, -- HTTP status of the original response
    response_body jsonb,
    response_headers jsonb,

    -- Resulting entity (for audit / debugging)
    entity_type text, -- e.g. 'order_payment', 'order'
    entity_id uuid,

    error_message text,

    -- Worker lock (advisory; expired via expires_at + stuck-lock sweep)
    locked_at timestamptz,
    locked_by text, -- process/host identifier

    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at timestamptz,
    expires_at timestamptz NOT NULL, -- 24-48 hours typical; enforced only by retention jobs, no CHECK

    UNIQUE(scope, key)
);

-- UNIQUE(scope, key) already provides a lookup index
CREATE INDEX idx_idempotency_keys_expires ON idempotency_keys(expires_at) WHERE status = 'completed'; -- retention sweep
CREATE INDEX idx_idempotency_keys_stuck ON idempotency_keys(status, locked_at) WHERE status = 'in_progress'; -- stuck-lock recovery


-- Create webhook_event_log table (broader catch-all for inbound webhooks from
-- non-delivery-partner providers; delivery_partner_webhook_events lives in
-- migration 12 and is intentionally not duplicated here)
CREATE TABLE webhook_event_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('paystack','yoco','stripe','whatsapp','resend','mapbox','other')),
    event_type text,
    external_event_id text, -- provider's id for the event

    signature_valid boolean,
    payload jsonb NOT NULL,
    headers jsonb,

    processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending','processed','failed','ignored')),
    error_message text,
    processed_at timestamptz,

    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Partial unique index: external_event_id can be NULL for synthetic/test events
CREATE UNIQUE INDEX idx_webhook_event_log_provider_external
    ON webhook_event_log(provider, external_event_id)
    WHERE external_event_id IS NOT NULL;

CREATE INDEX idx_webhook_event_log_provider_status_created
    ON webhook_event_log(provider, processing_status, created_at DESC);
CREATE INDEX idx_webhook_event_log_event_type_created
    ON webhook_event_log(event_type, created_at DESC);
