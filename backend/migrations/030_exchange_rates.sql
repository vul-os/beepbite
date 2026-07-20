-- =============================================================================
-- 030_exchange_rates.sql  —  Wave 10: USD billing via FX
-- =============================================================================
--
-- Pre-flight audit (grepped before authoring):
--
--   exchange_rates       — EXISTS in 007_payments_generic.sql (line 851).
--                          Columns: id, from_currency, to_currency, rate numeric(18,8),
--                          source, fetched_at, created_at.
--                          No expires_at. Index on (from_currency, to_currency, fetched_at DESC).
--                          Public SELECT granted, INSERT/UPDATE/DELETE revoked from PUBLIC.
--
--   latest_exchange_rate — NOT FOUND in any migration.  → CREATE.
--
-- Canonical FX names:
--   exchange_rates.base_code       — ALIAS for from_currency (added as generated column)
--   exchange_rates.quote_code      — ALIAS for to_currency   (added as generated column)
--   exchange_rates.expires_at      — ADD COLUMN IF NOT EXISTS
--   latest_exchange_rate(base,quote) — new SQL function
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §1  exchange_rates — extend existing table
-- ---------------------------------------------------------------------------
-- The table was created in 007 with columns from_currency / to_currency / rate.
-- Wave 10 agents use base_code / quote_code / expires_at.  We add:
--   • expires_at       (new nullable column)
--   • base_code        (generated alias for from_currency, for agent clarity)
--   • quote_code       (generated alias for to_currency,   for agent clarity)
-- No RLS is added — the table is global reference data (like currencies)
-- with world-readable SELECT already granted in 007.
-- No bare GRANT … TO service_role — 001 default privileges cover it.
-- ---------------------------------------------------------------------------

ALTER TABLE exchange_rates
    ADD COLUMN IF NOT EXISTS expires_at  timestamptz;

-- Stored-generated alias columns so Wave 10 agents can use base_code / quote_code
-- without touching every existing query that uses from_currency / to_currency.
ALTER TABLE exchange_rates
    ADD COLUMN IF NOT EXISTS base_code  text
        GENERATED ALWAYS AS (from_currency) STORED;

ALTER TABLE exchange_rates
    ADD COLUMN IF NOT EXISTS quote_code text
        GENERATED ALWAYS AS (to_currency) STORED;

-- Composite index the FX worker uses for fast latest-rate lookups by Wave 10 names.
-- Existing idx_exchange_rates_pair_time covers (from_currency, to_currency, fetched_at DESC)
-- so we add a parallel index on the alias columns for queries that reference them directly.
CREATE INDEX IF NOT EXISTS idx_exchange_rates_codes_time
    ON exchange_rates (base_code, quote_code, fetched_at DESC);

COMMENT ON COLUMN exchange_rates.expires_at IS
    'Optional hard expiry for this rate snapshot.  '
    'NULL means "valid until superseded".  '
    'latest_exchange_rate() filters out rows where expires_at < now().';

COMMENT ON COLUMN exchange_rates.base_code IS
    'Generated alias for from_currency.  Wave 10 FX worker canonical name.';

COMMENT ON COLUMN exchange_rates.quote_code IS
    'Generated alias for to_currency.  Wave 10 FX worker canonical name.';

-- ---------------------------------------------------------------------------
-- §2  latest_exchange_rate(base text, quote text) — SQL function (new)
-- ---------------------------------------------------------------------------
-- Returns the most recent non-expired rate for a (base, quote) pair.
-- Returns NULL when no valid row exists; callers should handle NULL and fall back
-- to a hard-coded floor rate or reject the invoice.
--
-- SECURITY INVOKER so the caller's RLS context is used — consistent with how
-- other view/function helpers work in this codebase.  exchange_rates has no RLS
-- so the effective result is the same regardless of caller role.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION latest_exchange_rate(base text, quote text)
RETURNS numeric(20,10)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT rate
    FROM   exchange_rates
    WHERE  from_currency = base
      AND  to_currency   = quote
      AND  (expires_at IS NULL OR expires_at > now())
    ORDER  BY fetched_at DESC
    LIMIT  1;
$$;

COMMENT ON FUNCTION latest_exchange_rate(text, text) IS
    'Returns the most recent non-expired FX rate for the given (base, quote) currency pair.  '
    'Returns NULL when no valid snapshot exists.  '
    'Used for order FX conversion.';

-- ---------------------------------------------------------------------------
-- §4  Audit summary
-- ---------------------------------------------------------------------------
--
-- EXISTED — SKIPPED (no DDL changes):
--   • exchange_rates table           (007_payments_generic.sql §16)
--   • exchange_rates index           idx_exchange_rates_pair_time
--   • exchange_rates PUBLIC SELECT   (GRANT in 007; 001 service_role default covers writes)
--
-- CREATED / EXTENDED in this migration:
--   • exchange_rates.expires_at          timestamptz (nullable)
--   • exchange_rates.base_code           text GENERATED ALWAYS AS (from_currency) STORED
--   • exchange_rates.quote_code          text GENERATED ALWAYS AS (to_currency)   STORED
--   • idx_exchange_rates_codes_time      on (base_code, quote_code, fetched_at DESC)
--   • latest_exchange_rate(text,text)    SQL function, STABLE, SECURITY INVOKER
--
-- EXACT CONTRACT for Wave 10 FX worker + invoice generator agents:
--
--   exchange_rates
--     id             uuid
--     from_currency  text  (FK → currencies.code)   [legacy primary name]
--     to_currency    text  (FK → currencies.code)   [legacy primary name]
--     base_code      text  GENERATED                [Wave 10 read alias]
--     quote_code     text  GENERATED                [Wave 10 read alias]
--     rate           numeric(18,8)
--     source         text
--     fetched_at     timestamptz NOT NULL
--     expires_at     timestamptz
--     created_at     timestamptz NOT NULL DEFAULT now()
--
--   latest_exchange_rate(base text, quote text) → numeric(20,10)
--     Returns most-recent non-expired rate; NULL if none.
--
--     id                   uuid PK
--     org_id               uuid NOT NULL FK organizations(id)
--     period_start         date NOT NULL
--     period_end           date NOT NULL
--     usd_amount_cents     bigint NOT NULL  [legacy write target]
--     amount_usd_cents     bigint GENERATED [Wave 10 read alias]
--     local_amount_cents   bigint NOT NULL  [legacy write target]
--     amount_local_cents   bigint GENERATED [Wave 10 read alias]
--     local_currency_code  text NOT NULL FK currencies(code)  [legacy write target]
--     currency_code        text GENERATED   [Wave 10 read alias]
--     fx_rate              numeric(18,8) NOT NULL  [legacy; must still be written]
--     fx_rate_snapshot     numeric(20,10) nullable [Wave 10 write target, higher precision]
--     fx_fetched_at        timestamptz nullable
--     provider_txn_id      text nullable
--     status               text NOT NULL DEFAULT 'issued'
--                          CHECK IN ('issued','paid','void','overdue')
--     issued_at            timestamptz NOT NULL DEFAULT now()
--     paid_at              timestamptz
--     created_at           timestamptz NOT NULL DEFAULT now()
--     updated_at           timestamptz NOT NULL DEFAULT now()
