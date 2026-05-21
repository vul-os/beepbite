-- Migration 038: hardware_printers — Wave 29 / Now-19
-- ---------------------------------------------------------------------------
-- Context
-- -------
-- Adds the location_printers table to manage network and USB receipt/kitchen
-- printers attached to a BeepBite location. Each printer may optionally be
-- routed to a specific kitchen_stations row so that kitchen-print jobs follow
-- the same station-routing logic as KDS tickets.
--
-- Pre-flight checks (performed before writing this file):
--   • kitchen_stations EXISTS (008_orders_and_kds.sql §CREATE TABLE).
--     id is uuid PK; location_id uuid NOT NULL FK → locations.
--   • No location_printers table in migrations 001–037.
--   • Style reference: 036_custom_domains.sql — DO block policies, IF NOT EXISTS
--     guards, OBJECT & RLS SUMMARY footer.
--   • org-column convention for location-scoped tables: location_id FK that RLS
--     resolves via locations.organization_id = current_org_id().
--     (Same pattern used by kitchen_stations, kds_display_groups, etc.)
-- ---------------------------------------------------------------------------

-- =============================================================================
-- §1  location_printers — core table
-- =============================================================================

CREATE TABLE IF NOT EXISTS location_printers (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    kind        text        NOT NULL
                            CHECK (kind IN ('receipt', 'kitchen')),
    connection  text        NOT NULL
                            CHECK (connection IN ('network', 'usb')),
    -- Network-connection fields (populated when connection = 'network')
    host        text,
    port        integer     NOT NULL DEFAULT 9100,
    -- Optional station binding for kitchen printers.
    -- When set, only orders fanned out to this station are sent to this printer.
    station_id  uuid        REFERENCES kitchen_stations(id) ON DELETE SET NULL,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

COMMENT ON TABLE location_printers IS
    'Hardware printers (receipt or kitchen) attached to a BeepBite location. '
    'connection=network printers are addressed by host:port; '
    'connection=usb printers are driven by the local POS agent. '
    'station_id binds a kitchen printer to a specific kitchen station for '
    'ticket-based routing mirroring the KDS fanout logic.';

COMMENT ON COLUMN location_printers.kind IS
    'receipt — customer-facing receipt printer; '
    'kitchen — kitchen order ticket printer.';

COMMENT ON COLUMN location_printers.connection IS
    'network — TCP ESC/POS (host:port); '
    'usb — local USB device managed by POS agent.';

COMMENT ON COLUMN location_printers.station_id IS
    'Optional FK to kitchen_stations. When set, kitchen-print jobs are '
    'filtered to order items routed to this station (mirrors KDS fanout).';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_location_printers_location_id
    ON location_printers (location_id);

CREATE INDEX IF NOT EXISTS idx_location_printers_location_active
    ON location_printers (location_id, is_active)
    WHERE is_active;

-- Auto-update updated_at
CREATE TRIGGER trg_location_printers_updated_at
    BEFORE UPDATE ON location_printers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- =============================================================================
-- §2  RLS
-- =============================================================================

ALTER TABLE location_printers ENABLE ROW LEVEL SECURITY;

-- Org members of the location's org may SELECT their printers.
DO $$
BEGIN
    CREATE POLICY location_printers_select_tenant
        ON location_printers
        FOR SELECT
        USING (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy location_printers_select_tenant already exists; skipping.';
END;
$$;

-- Org members may INSERT printers for their own locations.
DO $$
BEGIN
    CREATE POLICY location_printers_insert_tenant
        ON location_printers
        FOR INSERT
        WITH CHECK (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy location_printers_insert_tenant already exists; skipping.';
END;
$$;

-- Org members may UPDATE (rename, change host/port, toggle active).
DO $$
BEGIN
    CREATE POLICY location_printers_update_tenant
        ON location_printers
        FOR UPDATE
        USING (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        )
        WITH CHECK (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy location_printers_update_tenant already exists; skipping.';
END;
$$;

-- Org members may DELETE printers for their own locations.
DO $$
BEGIN
    CREATE POLICY location_printers_delete_tenant
        ON location_printers
        FOR DELETE
        USING (
            location_id IN (
                SELECT id FROM locations
                WHERE organization_id = current_org_id()
            )
            OR is_service_role()
        );
EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'policy location_printers_delete_tenant already exists; skipping.';
END;
$$;

-- =============================================================================
-- OBJECT & RLS SUMMARY
-- =============================================================================
--
-- TABLE: location_printers
--   id          uuid         PK, gen_random_uuid()
--   location_id uuid NOT NULL FK → locations(id) ON DELETE CASCADE
--   name        text NOT NULL
--   kind        text NOT NULL CHECK (receipt|kitchen)
--   connection  text NOT NULL CHECK (network|usb)
--   host        text NULL     — hostname/IP for network printers
--   port        integer NOT NULL DEFAULT 9100 — TCP port for network printers
--   station_id  uuid NULL     FK → kitchen_stations(id) ON DELETE SET NULL
--   is_active   boolean NOT NULL DEFAULT true
--   created_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
--   updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
--
-- INDEXES
--   idx_location_printers_location_id     (location_id)
--   idx_location_printers_location_active (location_id, is_active) WHERE is_active
--
-- RLS
--   Org-column convention: location_id FK resolved via
--     locations.organization_id = current_org_id() subquery.
--   All four operations (SELECT/INSERT/UPDATE/DELETE) allow org members of the
--   location's owning org, plus service_role bypass on each.
--   No bare GRANT to service_role — consistent with the project-wide pattern
--   (001 §4): all policies include OR is_service_role().
--
-- TRIGGER
--   trg_location_printers_updated_at — auto-update updated_at on every UPDATE.
-- =============================================================================
