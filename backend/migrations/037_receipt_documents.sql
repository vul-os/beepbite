-- Migration 037: receipt_documents — Wave 27 / Now-17 Receipt PDF delivery
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- Records every generated/sent receipt (PDF, email, WhatsApp) for an order.
-- One row per delivery event: the same order may have multiple rows if the
-- receipt was resent via different channels.
--
-- Pre-flight checks:
--   • orders table exists (008_orders_and_kds.sql).
--   • organizations table exists (002_auth_and_tenancy.sql).
--   • Migration 036 is the most recent style reference.
--   • No receipt_documents table in migrations 001-036.
--   • org-column convention: organization_id (matches orders, adjustments,
--     cashdrawer_sessions, tip_pools, etc.).
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  receipt_documents — core table
-- =============================================================================

CREATE TABLE IF NOT EXISTS receipt_documents (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id         uuid         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    organization_id  uuid         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    storage_key      text         NOT NULL,
    channel          text         NOT NULL DEFAULT 'pdf'
                                  CHECK (channel IN ('pdf', 'email', 'whatsapp')),
    generated_at     timestamptz  NOT NULL DEFAULT timezone('utc', now()),
    retention_until  timestamptz  NOT NULL DEFAULT (timezone('utc', now()) + INTERVAL '7 years')
);

COMMENT ON TABLE receipt_documents IS
    'Records of generated and delivered receipt PDFs, one row per channel '
    'per delivery event. storage_key is an opaque blob reference (e.g. '
    'object-storage path or base64 stub). Retention is 7 years by default '
    'to satisfy fiscal record-keeping requirements.';

COMMENT ON COLUMN receipt_documents.channel IS
    'Delivery channel: pdf = generated locally (HTTP download), '
    'email = delivered via email.Provider.Send, '
    'whatsapp = delivered via WhatsApp document message.';

COMMENT ON COLUMN receipt_documents.storage_key IS
    'Opaque reference to the stored PDF: object-storage path, CDN URL, or '
    'base64-encoded inline bytes. Interpretation is up to the caller.';

-- =============================================================================
-- §2  Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_receipt_documents_order_id
    ON receipt_documents (order_id);

CREATE INDEX IF NOT EXISTS idx_receipt_documents_org_generated
    ON receipt_documents (organization_id, generated_at DESC);

-- =============================================================================
-- §3  Row-Level Security
-- =============================================================================

ALTER TABLE receipt_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_documents FORCE ROW LEVEL SECURITY;

-- Org members may read their own org's receipt_documents.
DO $$
BEGIN
    CREATE POLICY receipt_documents_select
        ON receipt_documents
        FOR SELECT
        USING (organization_id = current_org_id() OR is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy receipt_documents_select already exists; skipping.';
END;
$$;

-- Only service_role (background jobs, API handlers acting on behalf of org) may
-- insert. Tenants cannot self-issue receipt_documents rows directly.
DO $$
BEGIN
    CREATE POLICY receipt_documents_insert
        ON receipt_documents
        FOR INSERT
        WITH CHECK (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy receipt_documents_insert already exists; skipping.';
END;
$$;

-- No UPDATE/DELETE by anyone except service_role; the table is append-only
-- from the tenant perspective.
DO $$
BEGIN
    CREATE POLICY receipt_documents_delete
        ON receipt_documents
        FOR DELETE
        USING (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy receipt_documents_delete already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- ORG-COLUMN CHOSEN: organization_id
--   Matches the canonical convention for all commerce-area tables: orders,
--   order_items, order_payments, cashdrawer_sessions, tip_pools, adjustments.
--
-- RLS REASONING
--   Tenant SELECT: organization_id = current_org_id() OR is_service_role().
--     Uses direct org-column equality; cheap, consistent with orders policy.
--   INSERT: service_role only. The receiptdelivery handler runs under
--     db.ServiceRoleScope() for INSERT (recording delivery) while the GET
--     runs under the tenant scope (enforced by order location guard).
--   UPDATE: no policy → table is append-only (immutable audit log).
--   DELETE: service_role only (retention enforcement job may purge expired rows).
--
-- COLUMN CONTRACT (for the receiptdelivery backend agent)
--   receipt_documents
--     id               uuid        PK, gen_random_uuid()
--     order_id         uuid NOT NULL FK → orders(id) ON DELETE CASCADE
--     organization_id  uuid NOT NULL FK → organizations(id) ON DELETE CASCADE
--     storage_key      text NOT NULL   — opaque blob reference
--     channel          text NOT NULL DEFAULT 'pdf'
--                      CHECK (pdf | email | whatsapp)
--     generated_at     timestamptz NOT NULL DEFAULT now() UTC
--     retention_until  timestamptz NOT NULL DEFAULT now() + 7 years
--
-- INDEXES
--   idx_receipt_documents_order_id        (order_id)
--   idx_receipt_documents_org_generated   (organization_id, generated_at DESC)
-- =============================================================================
