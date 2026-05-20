-- =============================================================================
-- MIGRATION 006 — TABLES AND FLOOR (DINE-IN INFRASTRUCTURE)
-- =============================================================================
-- Source: legacy 20240101000016_tables_dine_in.sql
--
-- Tables defined here:
--   sections, tables, table_sessions, seats, check_splits, check_split_items
--
-- Dependencies:
--   001 (enums, helpers), 002 (organizations, currencies), 003 (staff),
--   007 (locations) — NOTE: locations is created in 007_payments_generic.sql
--       which runs before this file in the consolidated sequence.
--
-- RLS pattern: location-scoped (join through locations → organization_id).
--
-- Notes:
--   - "tables" is a near-reserved identifier; quoted throughout.
--   - orders/order_items FKs to table_sessions/seats are defined in 008
--     (orders_and_kds) which owns those tables.
--   - Legacy tables `order_details`, `order_financial_details`, `driver_ratings`,
--     `delivery_drivers`, `driver_locations`, `driver_earnings` that were part
--     of legacy 002 are intentionally absent — they are replaced by consolidated
--     columns in `orders`/`order_payments` (008) and new driver tables (011).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SECTIONS
-- Floor areas per location (e.g. "Patio", "Bar", "Main Room")
-- ---------------------------------------------------------------------------

CREATE TABLE sections (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK constraint fk_sections_location added by 007_payments_generic.sql (after locations exists)
    location_id uuid        NOT NULL,
    name        text        NOT NULL,
    sort_order  integer     NOT NULL DEFAULT 0,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (location_id, name)
);

COMMENT ON TABLE sections IS
    'Floor sections / areas within a location (e.g. Patio, Bar, Main Room). '
    'Each section groups physical tables on the floor plan.';

CREATE INDEX idx_sections_location_id ON sections(location_id);
CREATE INDEX idx_sections_active       ON sections(location_id, is_active);

CREATE TRIGGER trg_sections_updated_at
    BEFORE UPDATE ON sections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: location-scoped
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections FORCE ROW LEVEL SECURITY;

-- Threat: tenant A must not read or mutate tenant B's floor sections.
-- POLICY sections_select ON sections deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY sections_insert ON sections deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY sections_update ON sections deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- Soft-delete preferred; hard delete restricted to service_role.
CREATE POLICY sections_delete ON sections FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- TABLES
-- Physical tables on the floor.
-- Quoted because "tables" is a near-reserved keyword in Postgres.
-- ---------------------------------------------------------------------------

CREATE TABLE "tables" (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK constraint fk_tables_location added by 007_payments_generic.sql (after locations exists)
    location_id uuid            NOT NULL,
    section_id  uuid            REFERENCES sections(id) ON DELETE SET NULL,
    label       text            NOT NULL,
    capacity    integer         NOT NULL CHECK (capacity > 0),
    status      text            NOT NULL DEFAULT 'available'
                                CHECK (status IN ('available', 'occupied', 'reserved', 'out_of_service')),
    pos_x       decimal(8,2),
    pos_y       decimal(8,2),
    is_active   boolean         NOT NULL DEFAULT true,
    created_at  timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at  timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (location_id, label)
);

COMMENT ON TABLE "tables" IS
    'Physical restaurant tables. Linked to a section (floor area) and tracked '
    'through table_sessions. pos_x/pos_y support drag-and-drop floor-plan editors.';

CREATE INDEX idx_tables_location_id ON "tables"(location_id);
CREATE INDEX idx_tables_section_id  ON "tables"(section_id) WHERE section_id IS NOT NULL;
CREATE INDEX idx_tables_status       ON "tables"(location_id, status);

CREATE TRIGGER trg_tables_updated_at
    BEFORE UPDATE ON "tables"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: location-scoped
ALTER TABLE "tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tables" FORCE ROW LEVEL SECURITY;

-- POLICY tables_select ON "tables" deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY tables_insert ON "tables" deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY tables_update ON "tables" deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY tables_delete ON "tables" FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- TABLE SESSIONS
-- A party occupying a table from open to close/transfer.
-- ---------------------------------------------------------------------------

CREATE TABLE table_sessions (
    id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id                    uuid        NOT NULL REFERENCES "tables"(id) ON DELETE CASCADE,
    -- FK constraint fk_table_sessions_location added by 007_payments_generic.sql (after locations exists)
    location_id                 uuid        NOT NULL,
    opened_by                   uuid        REFERENCES staff(id) ON DELETE SET NULL,
    party_size                  integer     NOT NULL DEFAULT 1 CHECK (party_size > 0),
    status                      text        NOT NULL DEFAULT 'open'
                                            CHECK (status IN ('open', 'closed', 'transferred')),
    opened_at                   timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    closed_at                   timestamptz,
    transferred_to_session_id   uuid        REFERENCES table_sessions(id) ON DELETE SET NULL,
    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE table_sessions IS
    'A party occupying a table. Tracks open/closed/transferred state. '
    'Orders placed during this session are linked via orders.table_session_id (defined in 008).';

-- Enforce at most one open session per table at a time.
CREATE UNIQUE INDEX one_open_session_per_table
    ON table_sessions(table_id) WHERE status = 'open';

CREATE INDEX idx_table_sessions_table_id    ON table_sessions(table_id);
CREATE INDEX idx_table_sessions_location_id ON table_sessions(location_id);
CREATE INDEX idx_table_sessions_status      ON table_sessions(status);
CREATE INDEX idx_table_sessions_opened_at   ON table_sessions(location_id, opened_at DESC);

CREATE TRIGGER trg_table_sessions_updated_at
    BEFORE UPDATE ON table_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: location-scoped (location_id is a direct column here)
ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_sessions FORCE ROW LEVEL SECURITY;

-- POLICY table_sessions_select ON table_sessions deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY table_sessions_insert ON table_sessions deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY table_sessions_update ON table_sessions deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY table_sessions_delete ON table_sessions FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- SEATS
-- Per-diner seats within a table session (enables split-by-seat).
-- ---------------------------------------------------------------------------

CREATE TABLE seats (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    table_session_id    uuid        NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    seat_number         integer     NOT NULL CHECK (seat_number > 0),
    guest_name          text,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (table_session_id, seat_number)
);

COMMENT ON TABLE seats IS
    'Individual diner seats within a table session. '
    'order_items can be linked to a seat to enable per-seat check splitting.';

CREATE INDEX idx_seats_table_session_id ON seats(table_session_id);

CREATE TRIGGER trg_seats_updated_at
    BEFORE UPDATE ON seats
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: scoped through table_sessions → locations → organization_id
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE seats FORCE ROW LEVEL SECURITY;

-- POLICY seats_select ON seats deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY seats_insert ON seats deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY seats_update ON seats deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY seats_delete ON seats FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- CHECK SPLITS
-- Records how a session's bill was split into sub-checks for separate payment.
-- ---------------------------------------------------------------------------

CREATE TABLE check_splits (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    table_session_id    uuid        NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
    split_label         text        NOT NULL,
    created_by          uuid        REFERENCES staff(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (table_session_id, split_label)
);

COMMENT ON TABLE check_splits IS
    'Sub-checks within a table session, enabling split-by-person / split-by-item '
    'billing. Each split maps to one or more order_items via check_split_items.';

CREATE INDEX idx_check_splits_table_session_id ON check_splits(table_session_id);

CREATE TRIGGER trg_check_splits_updated_at
    BEFORE UPDATE ON check_splits
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: scoped through table_sessions → locations → organization_id
ALTER TABLE check_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_splits FORCE ROW LEVEL SECURITY;

-- POLICY check_splits_select ON check_splits deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY check_splits_insert ON check_splits deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY check_splits_update ON check_splits deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY check_splits_delete ON check_splits FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- CHECK SPLIT ITEMS
-- Which order_items belong to which split (supports fractional item allocation).
-- ---------------------------------------------------------------------------

CREATE TABLE check_split_items (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    check_split_id  uuid            NOT NULL REFERENCES check_splits(id) ON DELETE CASCADE,
    -- FK constraint fk_check_split_items_order_item added by 008_orders_and_kds.sql (after order_items exists)
    order_item_id   uuid            NOT NULL,
    quantity        decimal(10,3)   NOT NULL CHECK (quantity > 0),
    UNIQUE (check_split_id, order_item_id)
);

COMMENT ON TABLE check_split_items IS
    'Associates order_items with a check_split. quantity supports partial '
    'allocations (e.g. a shared appetizer split 0.5 / 0.5 across two splits).';

CREATE INDEX idx_check_split_items_check_split_id  ON check_split_items(check_split_id);
CREATE INDEX idx_check_split_items_order_item_id   ON check_split_items(order_item_id);

-- RLS: scoped through check_splits → table_sessions → locations → organization_id
ALTER TABLE check_split_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_split_items FORCE ROW LEVEL SECURITY;

-- POLICY check_split_items_select ON check_split_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY check_split_items_insert ON check_split_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

-- POLICY check_split_items_update ON check_split_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)

CREATE POLICY check_split_items_delete ON check_split_items FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- GRANTS
-- Authenticated app role reads/writes via RLS above.
-- marketplace_role has no business access to floor tables.
-- ---------------------------------------------------------------------------
REVOKE ALL ON sections, "tables", table_sessions, seats, check_splits, check_split_items FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Migration 006 complete. Tables: sections, tables, table_sessions, seats,
-- check_splits, check_split_items (6 tables, all RLS-enabled, location-scoped).
-- orders/order_items FK to table_sessions and seats defined in 008.
