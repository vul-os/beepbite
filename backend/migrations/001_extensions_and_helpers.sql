-- =============================================================================
-- MIGRATION 001 — EXTENSIONS, ENUMS, RLS HELPER FUNCTIONS, ROLES
-- =============================================================================
-- This migration does NOT create any tables. It runs first and establishes:
--   1. Required Postgres extensions.
--   2. Common enums used across multiple domain migrations.
--   3. RLS session-variable helper functions.
--   4. Two Postgres roles: service_role and marketplace_role.
--   5. A baseline REVOKE ALL FROM PUBLIC so subsequent migrations grant explicitly.
--
-- Safe to run against an empty Postgres 15+ database.
-- Idempotent: uses CREATE OR REPLACE / CREATE IF NOT EXISTS / DO $$ ... $$ guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- pgcrypto provides gen_random_uuid() and encode/decode used by token helpers.

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_stat_statements not available (requires superuser or shared_preload_libraries): %', SQLERRM;
END $$;
-- pg_stat_statements: query-level performance visibility; safe to add here.
-- Wrapped in a DO block so non-superuser migration runners skip it gracefully.
-- On managed Postgres (Fly, RDS, etc.) this is typically pre-loaded via
-- shared_preload_libraries; the CREATE IF NOT EXISTS will succeed as a no-op.

-- ---------------------------------------------------------------------------
-- 2. COMMON ENUMS
-- ---------------------------------------------------------------------------
-- All enums are defined here so domain migrations can reference them without
-- cross-migration dependencies. Adding new values to an enum is always additive
-- in Postgres; removing values requires a migration.

-- actor_type: who performed an auditable action.
DO $$ BEGIN
  CREATE TYPE actor_type AS ENUM (
    'member',    -- auth_users / organization_members (owner, manager, staff role)
    'staff',     -- staff table row (PIN-identified actor)
    'system',    -- background jobs, cron runners
    'customer',  -- marketplace customer (profiles row)
    'webhook',   -- inbound webhook from external provider
    'api_key'    -- public API key (Now-12)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- order_status: full lifecycle including pending_on_delivery (Now-4).
DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'pending',             -- created, not yet confirmed
    'confirmed',           -- restaurant accepted
    'preparing',           -- kitchen started
    'ready',               -- ready for pickup / handover
    'out_for_delivery',    -- driver picked up
    'delivered',           -- delivered to customer
    'completed',           -- settled and closed
    'cancelled',           -- cancelled before fulfillment
    'pending_on_delivery'  -- COD / card-on-delivery; payment deferred to handover
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- payment_status: status of an individual payment attempt or order_payment row.
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'pending',
    'completed',
    'failed',
    'refunded',
    'partially_refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- kds_event_type: event log entries for KDS ticket lifecycle.
DO $$ BEGIN
  CREATE TYPE kds_event_type AS ENUM (
    'fired',
    'started',
    'ready',             -- item/ticket is ready for expo
    'bumped',            -- completed at station
    'recalled',          -- pulled back from bumped
    're_fired',          -- sent back to kitchen
    'cancelled',
    'priority_changed',
    'rushed',
    'item_86ed',
    'note_added'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- fulfillment_type: how an order reaches the customer.
DO $$ BEGIN
  CREATE TYPE fulfillment_type AS ENUM (
    'collection',   -- customer picks up (replaces legacy 'pickup')
    'delivery',     -- delivered to customer address
    'dine_in'       -- eat in the restaurant
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- provider_status: lifecycle state for payment / email / LLM providers.
DO $$ BEGIN
  CREATE TYPE provider_status AS ENUM (
    'active',
    'inactive',
    'testing'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- wallet_txn_kind: categories of wallet ledger entries (Now-1).
DO $$ BEGIN
  CREATE TYPE wallet_txn_kind AS ENUM (
    'topup',
    'debit_llm',
    'debit_whatsapp',
    'debit_sms',
    'debit_bulk_import',
    'debit_overage',
    'refund',
    'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- topup_status: lifecycle of a wallet top-up attempt.
DO $$ BEGIN
  CREATE TYPE topup_status AS ENUM (
    'initiated',
    'succeeded',
    'failed',
    'refunded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- driver_assignment_status: lifecycle of a driver ↔ order pairing (Now-7).
DO $$ BEGIN
  CREATE TYPE driver_assignment_status AS ENUM (
    'offered',
    'accepted',
    'picked_up',
    'delivered',
    'canceled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- driver_shift_status: whether a driver is currently taking deliveries.
DO $$ BEGIN
  CREATE TYPE driver_shift_status AS ENUM (
    'online',
    'paused',
    'offline'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- whatsapp_link_intent: purpose of a WhatsApp link token (Now-8).
DO $$ BEGIN
  CREATE TYPE whatsapp_link_intent AS ENUM (
    'bind',   -- binding a phone number to an account
    'order'   -- starting an order flow
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- custom_domain_status: lifecycle of a tenant custom domain (Now-13).
DO $$ BEGIN
  CREATE TYPE custom_domain_status AS ENUM (
    'pending',
    'verifying',
    'verified',
    'cert_issuing',
    'live',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. RLS HELPER FUNCTIONS
-- ---------------------------------------------------------------------------
-- All functions use current_setting('app.xxx', true) with missing_ok=true.
-- A missing or empty-string setting returns NULL, which makes every RLS
-- predicate evaluate to FALSE → zero rows visible. This is the safe default
-- for unauthenticated or improperly scoped connections.
--
-- All functions are STABLE (no side effects; safe to call multiple times per
-- statement) and SECURITY DEFINER is NOT used (they run as the calling user).
-- LEAKPROOF is intentionally omitted — setting it requires superuser privilege
-- and the migration runner may be a non-superuser role. A superuser can
-- retroactively mark these LEAKPROOF with ALTER FUNCTION ... LEAKPROOF.

-- current_org_id(): returns the org UUID from the session var, or NULL.
CREATE OR REPLACE FUNCTION current_org_id()
RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.current_org_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION current_org_id() IS
  'Returns the organization UUID from app.current_org_id session variable. '
  'Returns NULL if the variable is not set or is empty — which causes all '
  'org-scoped RLS policies to return zero rows.';

-- current_user_id(): returns the authenticated user UUID, or NULL.
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION current_user_id() IS
  'Returns the auth_users.id UUID from app.current_user_id session variable.';

-- current_actor_id(): returns the staff actor UUID if a PIN overlay is active;
-- otherwise falls back to the member session user UUID.
CREATE OR REPLACE FUNCTION current_actor_id()
RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(
    nullif(current_setting('app.current_actor_id', true), '')::uuid,
    nullif(current_setting('app.current_user_id', true), '')::uuid
  );
$$;

COMMENT ON FUNCTION current_actor_id() IS
  'Returns the staff actor UUID from app.current_actor_id if set (PIN overlay), '
  'otherwise falls back to app.current_user_id. Used for audit attribution.';

-- current_capabilities(): returns the current member's capability flags as jsonb.
-- Returns an empty object if not set so downstream callers can safely use ->> without null checks.
CREATE OR REPLACE FUNCTION current_capabilities()
RETURNS jsonb
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(
    nullif(current_setting('app.current_capabilities', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

COMMENT ON FUNCTION current_capabilities() IS
  'Returns organization_members.capabilities jsonb for the current session. '
  'Returns {} (empty object) if not set.';

-- has_capability(cap): returns true if the named key is truthy in capabilities.
CREATE OR REPLACE FUNCTION has_capability(cap text)
RETURNS bool
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT COALESCE((current_capabilities() ->> cap)::bool, false);
$$;

COMMENT ON FUNCTION has_capability(text) IS
  'Returns true if the named capability key is set to true in the current session capabilities.';

-- is_service_role(): returns true when running as the service role.
-- Service role bypasses RLS via the policy USING clause but does NOT use
-- Postgres row-security bypass (we do NOT use ALTER ROLE service_role BYPASSRLS).
-- Instead every policy explicitly includes OR is_service_role().
CREATE OR REPLACE FUNCTION is_service_role()
RETURNS bool
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(nullif(current_setting('app.is_service_role', true), '')::bool, false);
$$;

COMMENT ON FUNCTION is_service_role() IS
  'Returns true when app.is_service_role is set to true. Used in RLS policies '
  'to allow system jobs and migration runners to see all rows.';

-- is_marketplace_role(): returns true when running as the marketplace role.
CREATE OR REPLACE FUNCTION is_marketplace_role()
RETURNS bool
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT COALESCE(nullif(current_setting('app.is_marketplace_role', true), '')::bool, false);
$$;

COMMENT ON FUNCTION is_marketplace_role() IS
  'Returns true when app.is_marketplace_role is set to true. Used in RLS '
  'policies to allow narrow public SELECT on is_marketplace_visible rows.';

-- ---------------------------------------------------------------------------
-- 4. ROLES
-- ---------------------------------------------------------------------------

-- service_role: used by the migration runner, background jobs, admin scripts.
-- Does NOT use BYPASSRLS — instead, every policy includes OR is_service_role()
-- so service access is explicit and auditable via session-var inspection.
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'service_role already exists or requires CREATEROLE privilege to create; skipping.';
END $$;

DO $$ BEGIN
  COMMENT ON ROLE service_role IS
    'Role for migration runner, cron jobs, admin scripts. '
    'Sets app.is_service_role=true before any SQL so RLS policies grant access.';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- marketplace_role: used by public discovery endpoints.
-- Granted narrow SELECT on specific columns of specific tables in later migrations.
DO $$ BEGIN
  CREATE ROLE marketplace_role NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'marketplace_role already exists or requires CREATEROLE privilege to create; skipping.';
END $$;

DO $$ BEGIN
  COMMENT ON ROLE marketplace_role IS
    'Role for public marketplace read endpoints. '
    'Sets app.is_marketplace_role=true. '
    'Granted SELECT on is_marketplace_visible=true rows of locations + related tables.';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 5. BASELINE REVOKE
-- ---------------------------------------------------------------------------
-- Remove all default PUBLIC privileges. Each subsequent migration grants only
-- what it needs on the tables it creates. This prevents a newly created table
-- from being world-readable before its RLS policies are attached.

-- Note: we revoke from SCHEMA public to prevent public from creating objects.
-- We do NOT revoke CONNECT from PUBLIC here — the Go pool handles that via
-- connection credentials. Individual table-level grants are issued in each
-- domain migration.

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Revoke default execute on functions from PUBLIC so new functions are
-- only callable by roles that are explicitly granted.
-- Note: existing functions (like pg_catalog builtins) are not affected.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Grant service_role and marketplace_role the ability to use the public schema.
-- Wrapped: if roles were not created (non-superuser runner), skip gracefully.
DO $$ BEGIN
  GRANT USAGE ON SCHEMA public TO service_role, marketplace_role;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'service_role or marketplace_role not found; skipping GRANT USAGE.';
END $$;

-- Grant service_role full access on all future objects in the public schema.
DO $$ BEGIN
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'service_role not found; skipping default privilege grants.';
END $$;

-- marketplace_role gets SELECT on tables only — specific tables will add their
-- own policies. The default here is a safety net so the role can query after
-- grants are added in domain migrations.
DO $$ BEGIN
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO marketplace_role;
EXCEPTION WHEN undefined_object THEN
  RAISE NOTICE 'marketplace_role not found; skipping default privilege grant.';
END $$;

-- ---------------------------------------------------------------------------
-- 6. SHARED UTILITY FUNCTION
-- ---------------------------------------------------------------------------
-- set_updated_at_now() is used by trigger attachments throughout domain migrations.
-- Defined here so all subsequent migrations can reference it without worrying
-- about cross-migration dependencies.

CREATE OR REPLACE FUNCTION set_updated_at_now()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at_now() IS
  'Trigger function: sets updated_at to the current UTC timestamp on row update. '
  'Used by BEFORE UPDATE triggers on all tables with an updated_at column.';

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Migration 001 complete. State:
--   - Extensions: pgcrypto, pg_stat_statements
--   - Enums: actor_type, order_status, payment_status, kds_event_type,
--             fulfillment_type, provider_status, wallet_txn_kind, topup_status,
--             driver_assignment_status, driver_shift_status,
--             whatsapp_link_intent, custom_domain_status
--   - Functions: current_org_id(), current_user_id(), current_actor_id(),
--                current_capabilities(), has_capability(text),
--                is_service_role(), is_marketplace_role(),
--                set_updated_at_now()
--   - Roles: service_role, marketplace_role
--   - Privileges: REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--                 default grants to service_role (ALL) and marketplace_role (SELECT)
