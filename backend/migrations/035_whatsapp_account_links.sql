-- Migration 035: whatsapp_account_links — Wave 17 / Now-8 WhatsApp number ↔ account binding
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- Wave 17 (Now-8) introduces the ability for authenticated users to bind their
-- WhatsApp phone numbers to their profile so the platform can correlate
-- inbound WhatsApp messages with account holders.
--
-- The project already ships whatsapp_accounts (002_auth_and_tenancy.sql §9)
-- and whatsapp_link_tokens (002_auth_and_tenancy.sql §10) as part of the
-- whatsapp_send/webhook surface.  This migration introduces two parallel
-- tables that serve the self-service binding flow:
--
--   whatsapp_account_links — the canonical binding record produced by the
--                            POST /link-whatsapp/{token} endpoint.
--                            A per-profile cap of 3 is enforced in Go code.
--   (whatsapp_link_tokens already exists — no DDL needed for the token table;
--    the handler reuses it with intent='bind'.)
--
-- Pre-flight checks (read-only psql before writing this file):
--   • whatsapp_account_links does NOT exist in any migration 001-034.
--     → CREATE TABLE is safe.
--   • whatsapp_link_tokens exists (002 §10) with columns:
--       token, phone_e164, intent whatsapp_link_intent, profile_id,
--       expires_at, used_at.
--     → No DDL changes needed; the handler uses intent='bind' and used_at.
--   • profiles has no whatsapp_account_links FK yet.
--     → FK added by the table's profile_id column below.
--   • current_user_id() helper defined in migration 001 §4.
--   • is_service_role() helper defined in migration 001 §4.
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  whatsapp_account_links — binding table
-- =============================================================================
-- One row per (profile, phone) pair.  phone_e164 is globally unique so the
-- same phone number cannot be bound to two profiles simultaneously.
-- The 3-number-per-profile cap is enforced in Go code (not a DB trigger here,
-- so the handler can return a structured 409 response instead of a raw
-- SQLSTATE check_violation).

CREATE TABLE IF NOT EXISTS whatsapp_account_links (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    phone_e164  text        NOT NULL UNIQUE,
    bound_at    timestamptz NOT NULL DEFAULT now()
);

-- Covering index: look up all numbers bound to a profile (used by the
-- manage-numbers view and the 3-cap check).
CREATE INDEX IF NOT EXISTS idx_whatsapp_account_links_profile
    ON whatsapp_account_links (profile_id);

-- =============================================================================
-- §2  whatsapp_account_links — RLS
-- =============================================================================

REVOKE ALL ON whatsapp_account_links FROM PUBLIC;

ALTER TABLE whatsapp_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_account_links FORCE ROW LEVEL SECURITY;

-- Owners can read their own bindings; service-role can read all.
DO $$
BEGIN
    CREATE POLICY whatsapp_account_links_select
        ON whatsapp_account_links
        FOR SELECT
        USING (profile_id = current_user_id() OR is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy whatsapp_account_links_select already exists; skipping.';
END;
$$;

-- Only service-role may insert (the binding handler runs under
-- ServiceRoleScope to sidestep RLS and atomically check the 3-cap).
DO $$
BEGIN
    CREATE POLICY whatsapp_account_links_insert
        ON whatsapp_account_links
        FOR INSERT
        WITH CHECK (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy whatsapp_account_links_insert already exists; skipping.';
END;
$$;

-- Only service-role may delete (future unbind endpoint).
DO $$
BEGIN
    CREATE POLICY whatsapp_account_links_delete
        ON whatsapp_account_links
        FOR DELETE
        USING (is_service_role());
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy whatsapp_account_links_delete already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLE: whatsapp_account_links
--   id          uuid        PK, gen_random_uuid()
--   profile_id  uuid NOT NULL FK → profiles(id) ON DELETE CASCADE
--   phone_e164  text NOT NULL UNIQUE   — globally unique phone binding
--   bound_at    timestamptz NOT NULL DEFAULT now()
--
-- TABLE: whatsapp_link_tokens  (already exists from migration 002)
--   token       text     PK
--   phone_e164  text     NOT NULL
--   intent      enum     NOT NULL  — handler uses intent='bind'
--   profile_id  uuid     NULL FK → profiles(id) ON DELETE SET NULL
--   expires_at  timestamptz NOT NULL
--   used_at     timestamptz NULL    — set on consumption (= spec's consumed_at)
--
-- INDEXES
--   idx_whatsapp_account_links_profile (profile_id)  [ADDED §1]
--   [existing] idx_whatsapp_link_tokens_phone (phone_e164)
--   [existing] idx_whatsapp_link_tokens_expires (expires_at)
--
-- RLS REASONING
--   whatsapp_account_links SELECT: profile_id = current_user_id() OR is_service_role()
--     — user can only see their own bindings; service-role can see all.
--   whatsapp_account_links INSERT: is_service_role() only
--     — the binding handler uses ServiceRoleScope so it can atomically
--       count existing bindings and insert without the cap-check racing.
--   whatsapp_account_links DELETE: is_service_role() only
--     — a future unbind handler will use ServiceRoleScope.
--   whatsapp_link_tokens (existing): is_service_role() only for all operations
--     — tokens are opaque to end-users; the handler runs under ServiceRoleScope.
--
-- 3-CAP ENFORCEMENT
--   The 3-number-per-profile cap is checked in Go code inside a service-role
--   transaction (see internal/handlers/whatsapplink/store.go BindPhone).
--   Using Go code (not a trigger) lets the handler distinguish the cap-exceeded
--   condition from a unique-phone conflict and return a structured 409.
-- =============================================================================
