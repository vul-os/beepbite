-- =============================================================================
-- MIGRATION 031 — KDS HARDENING: kds_display_groups columns + kds_event_type
-- =============================================================================
-- Wave 12, KDS hardening.
--
-- PRE-MIGRATION EXISTENCE AUDIT (verified against live DB 2026-05-21):
--
--   kds_display_groups     — EXISTS (020_kds_fanout_trigger_service_role.sql).
--                            Live columns: id, location_id, name, station_ids,
--                            sort_order, is_active, created_at, updated_at.
--                            MISSING: display_order, auto_recall_seconds.
--                            → ADD COLUMN IF NOT EXISTS for both.
--
--   kds_event_type (enum)  — EXISTS (001_extensions_and_helpers.sql).
--                            Live values: fired, started, ready, bumped, recalled,
--                            re_fired, cancelled, priority_changed, rushed,
--                            item_86ed, note_added.
--                            'ready' is PRESENT; 'served' is ABSENT.
--                            kds_ticket_events.event_type uses this enum (no CHECK
--                            constraint) → ALTER TYPE ... ADD VALUE IF NOT EXISTS.
--
--   category_station_routing — EXISTS (008_orders_and_kds.sql §5). NOT TOUCHED.
--
-- No bare GRANT … TO service_role.  service_role coverage is provided by the
-- ALTER DEFAULT PRIVILEGES block in 001_extensions_and_helpers.sql.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. kds_display_groups — add missing columns
-- ---------------------------------------------------------------------------
-- display_order replaces/supplements the existing sort_order column.
-- The station-config UI agent uses display_order for render ordering within
-- a group; sort_order (existing) is kept so no existing queries break.
ALTER TABLE kds_display_groups
    ADD COLUMN IF NOT EXISTS display_order     integer DEFAULT 0 NOT NULL,
    ADD COLUMN IF NOT EXISTS auto_recall_seconds integer;          -- NULL = disabled

COMMENT ON COLUMN kds_display_groups.display_order IS
    'Render order of this display group within the location KDS layout. '
    'Lower values appear first. Supersedes the legacy sort_order column '
    'for station-config UI ordering.';

COMMENT ON COLUMN kds_display_groups.auto_recall_seconds IS
    'If set, tickets bumped at all stations in this group are automatically '
    'recalled after this many seconds. NULL disables auto-recall.';

-- ---------------------------------------------------------------------------
-- 2. kds_event_type enum — add 'served'
-- ---------------------------------------------------------------------------
-- 'served' marks a ticket/item as handed off to the customer (expo or runner
-- confirmation).  ADD VALUE IF NOT EXISTS is a no-op when already present.
-- Must run outside a transaction block per PostgreSQL rules for enum changes,
-- but we wrap the whole migration in BEGIN/COMMIT and rely on the fact that
-- Supabase / the migration runner accepts ADD VALUE inside a transaction for
-- PG 12+.  If the runner rejects it, promote this statement to a standalone
-- DO block or run before the BEGIN.
ALTER TYPE kds_event_type ADD VALUE IF NOT EXISTS 'served' AFTER 'ready';

COMMENT ON TYPE kds_event_type IS
    'Event log entry types for KDS ticket lifecycle. '
    'Values: fired, started, ready, served, bumped, recalled, re_fired, '
    'cancelled, priority_changed, rushed, item_86ed, note_added.';

COMMIT;

-- =============================================================================
-- POST-MIGRATION SUMMARY
-- =============================================================================
--
-- EXISTED AND SKIPPED (no changes):
--   • kds_display_groups table itself (created in 020)
--   • kds_display_groups columns: id, location_id, name, station_ids,
--     sort_order, is_active, created_at, updated_at
--   • kds_display_groups RLS policies (all four: select/insert/update/delete)
--   • kds_display_groups trigger: trg_kds_display_groups_updated_at
--   • kds_display_groups indexes: pkey, idx_kds_display_groups_location_id,
--     unique (location_id, name)
--   • kds_event_type enum values: fired, started, ready, bumped, recalled,
--     re_fired, cancelled, priority_changed, rushed, item_86ed, note_added
--   • category_station_routing (008) — untouched
--   • kds_ticket_events — untouched (uses kds_event_type by reference;
--     the ADD VALUE above is sufficient; no CHECK constraint to rebuild)
--
-- CREATED / EXTENDED:
--   • kds_display_groups.display_order  integer NOT NULL DEFAULT 0
--   • kds_display_groups.auto_recall_seconds  integer NULL (NULL = disabled)
--   • kds_event_type: added value 'served' (after 'ready')
--
-- kds_display_groups CONTRACT (for station-config UI agent):
-- ┌─────────────────────┬─────────────────────────┬──────────┬─────────────────────────────────────────────┐
-- │ Column              │ Type                    │ Nullable │ Notes                                       │
-- ├─────────────────────┼─────────────────────────┼──────────┼─────────────────────────────────────────────┤
-- │ id                  │ uuid                    │ NOT NULL │ PK, gen_random_uuid()                       │
-- │ location_id         │ uuid                    │ NOT NULL │ FK → locations(id) ON DELETE CASCADE        │
-- │ name                │ text                    │ NOT NULL │ UNIQUE per (location_id, name)              │
-- │ station_ids         │ uuid[]                  │ NOT NULL │ DEFAULT '{}'  — refs kitchen_stations.id   │
-- │ sort_order          │ integer                 │ NOT NULL │ DEFAULT 0 (legacy; prefer display_order)    │
-- │ display_order       │ integer                 │ NOT NULL │ DEFAULT 0 — NEW; use for UI render order    │
-- │ is_active           │ boolean                 │ NOT NULL │ DEFAULT true                                │
-- │ auto_recall_seconds │ integer                 │ NULL OK  │ NULL = auto-recall disabled — NEW          │
-- │ created_at          │ timestamptz             │ NOT NULL │ DEFAULT timezone('utc', now())              │
-- │ updated_at          │ timestamptz             │ NOT NULL │ DEFAULT timezone('utc', now()), auto-set    │
-- └─────────────────────┴─────────────────────────┴──────────┴─────────────────────────────────────────────┘
-- RLS: location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
--       OR is_service_role()  — all four operations.
-- DELETE: is_service_role() only.
-- =============================================================================
