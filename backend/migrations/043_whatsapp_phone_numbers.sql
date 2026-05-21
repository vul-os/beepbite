-- Migration 043: whatsapp_phone_numbers — Wave 37 / Now-29 multi-number support
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- BeepBite is expanding WhatsApp coverage to multiple phone numbers (countries/
-- regions).  Each number is registered with the Meta Business API under a
-- distinct phone_number_id.  This table is the authoritative registry of all
-- active numbers; it is platform-owned (no per-org row-level security) and
-- managed exclusively by platform admins.
--
-- Pre-flight checks (performed before writing this file):
--   • No whatsapp_phone_numbers table exists in migrations 001–042.
--   • Migration 036 is the most recent non-review style reference for
--     platform-owned tables with RLS + service-role bypass.
--   • Platform admin pattern (service_role bypass only) is established in
--     032_platform_admin.sql and used consistently through 036.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  whatsapp_phone_numbers — core table
-- =============================================================================

CREATE TABLE IF NOT EXISTS whatsapp_phone_numbers (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    meta_phone_number_id text         NOT NULL UNIQUE,
    display_phone        text         NOT NULL,
    country              text         NOT NULL,
    regions              text[]       NOT NULL DEFAULT '{}',
    active               boolean      NOT NULL DEFAULT true,
    configured_at        timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE whatsapp_phone_numbers IS
    'Registry of WhatsApp phone numbers registered with the Meta Business API. '
    'Each row maps a Meta phone_number_id to a BeepBite-managed number with '
    'country/region routing metadata. Platform-owned; service role access only.';

COMMENT ON COLUMN whatsapp_phone_numbers.meta_phone_number_id IS
    'The phone_number_id provided by Meta in webhook payloads (Metadata.PhoneNumberID). '
    'Used by the inbound webhook resolver to identify which BeepBite number received '
    'the message. UNIQUE enforces one row per Meta number.';

COMMENT ON COLUMN whatsapp_phone_numbers.display_phone IS
    'Human-readable phone number (e.g. +27 82 123 4567). '
    'Shown in the platform-admin UI and in outbound message logs.';

COMMENT ON COLUMN whatsapp_phone_numbers.country IS
    'ISO 3166-1 alpha-2 country code (e.g. ZA, NG, KE). '
    'Used by PickOutbound to select the country-primary number when '
    'no last-used number is recorded for a customer conversation.';

COMMENT ON COLUMN whatsapp_phone_numbers.regions IS
    'Optional sub-region tags (e.g. {''gauteng'',''western-cape''}). '
    'Future routing logic may use these for finer-grained selection.';

COMMENT ON COLUMN whatsapp_phone_numbers.active IS
    'False = number is deactivated; excluded from outbound routing '
    'and hidden from active listings. Rows are soft-deleted, never hard-deleted.';

COMMENT ON COLUMN whatsapp_phone_numbers.configured_at IS
    'Timestamp when this number was first registered with BeepBite. '
    'Defaults to now(); may be set explicitly when backfilling historical numbers.';

-- =============================================================================
-- §2  Indexes
-- =============================================================================

-- Primary access pattern: inbound webhook resolves by meta_phone_number_id.
-- UNIQUE constraint already creates an index on that column; the partial
-- index below covers the common "active only" lookup pattern.
CREATE INDEX IF NOT EXISTS idx_whatsapp_phone_numbers_active
    ON whatsapp_phone_numbers (meta_phone_number_id)
    WHERE active = true;

-- Outbound routing: pick by country (active only).
CREATE INDEX IF NOT EXISTS idx_whatsapp_phone_numbers_country
    ON whatsapp_phone_numbers (country, configured_at)
    WHERE active = true;

-- =============================================================================
-- §3  RLS — platform-owned, service-role only
-- =============================================================================

ALTER TABLE whatsapp_phone_numbers ENABLE ROW LEVEL SECURITY;

-- All operations require service role (platform admin).
-- Platform-admin HTTP handlers always run under db.ServiceRoleScope(),
-- which sets app.is_service_role = 'true'.
-- No tenant-scoped access is granted.

DO $$
BEGIN
    CREATE POLICY whatsapp_phone_numbers_service_role
        ON whatsapp_phone_numbers
        FOR ALL
        USING (is_service_role())
        WITH CHECK (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy whatsapp_phone_numbers_service_role already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLE: whatsapp_phone_numbers
--   id                   uuid         PK, gen_random_uuid()
--   meta_phone_number_id text         NOT NULL UNIQUE
--   display_phone        text         NOT NULL
--   country              text         NOT NULL (ISO 3166-1 alpha-2)
--   regions              text[]       NOT NULL DEFAULT '{}'
--   active               boolean      NOT NULL DEFAULT true
--   configured_at        timestamptz  NOT NULL DEFAULT now()
--
-- RLS REASONING
--   Platform-owned table with no org boundary.  Only the service role (platform
--   admin HTTP layer) may read or write rows.  No marketplace or tenant policy
--   is granted.  This matches the pattern used for platform_admin_actions
--   (migration 032).
--
-- INDEXES
--   whatsapp_phone_numbers_meta_phone_number_id_key  UNIQUE (meta_phone_number_id)
--   idx_whatsapp_phone_numbers_active                (meta_phone_number_id) WHERE active
--   idx_whatsapp_phone_numbers_country               (country, configured_at) WHERE active
-- =============================================================================
