-- =============================================================================
-- 047_wave_audit_fixes.sql — schema fixes from the 10-agent test pass
-- =============================================================================

-- (1) FORCE RLS on tables that only had ENABLE — the owning DB role bypasses
--     ENABLE-only RLS, so a raw pool query would skip the service-role/tenant
--     policy. Matches the project-wide FORCE convention.
ALTER TABLE whatsapp_phone_numbers FORCE ROW LEVEL SECURITY;
ALTER TABLE location_printers      FORCE ROW LEVEL SECURITY;
ALTER TABLE data_export_jobs       FORCE ROW LEVEL SECURITY;

-- (2) GDPR right-to-be-forgotten: customers.whatsapp_number is NOT NULL, so
--     ForgetCustomer's `SET whatsapp_number = NULL` always 500'd. Drop NOT NULL.
--     The UNIQUE(organization_id, whatsapp_number) constraint is unaffected —
--     Postgres treats NULLs as distinct, so multiple forgotten customers are OK.
ALTER TABLE customers ALTER COLUMN whatsapp_number DROP NOT NULL;

-- (3) custom_domains pre-existed (migration 007); 036's CREATE TABLE IF NOT
--     EXISTS was a no-op, so verification_token never got its default → every
--     new domain got a blank token and verification could never succeed.
--     Add the default (uuid-based, no pgcrypto dependency) + backfill blanks.
ALTER TABLE custom_domains
    ALTER COLUMN verification_token
    SET DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

UPDATE custom_domains
    SET verification_token = (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    WHERE verification_token IS NULL OR verification_token = '';

-- (4) custom_domains hostname uniqueness must ignore soft-deleted rows, else a
--     removed hostname can never be re-registered. Replace the blanket UNIQUE
--     with a partial unique index over live rows.
DO $$
DECLARE
    conname text;
BEGIN
    SELECT c.conname INTO conname
    FROM pg_constraint c
    WHERE c.conrelid = 'custom_domains'::regclass
      AND c.contype = 'u'
      AND c.conkey = (SELECT array_agg(attnum)
                      FROM pg_attribute
                      WHERE attrelid = 'custom_domains'::regclass AND attname = 'hostname');
    IF conname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE custom_domains DROP CONSTRAINT %I', conname);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS custom_domains_hostname_active_uq
    ON custom_domains (hostname)
    WHERE removed_at IS NULL;
