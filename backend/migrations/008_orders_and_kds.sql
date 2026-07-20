-- =============================================================================
-- MIGRATION 008 — ORDERS AND KDS
-- =============================================================================
-- Sources: legacy 002 (orders, order_items), 003 (order status trigger),
--          016 (table/seat columns on orders/order_items — absorbed here),
--          017 (kds), 028 (kds_expo_view → kds_display_groups),
--          036 (kds_fanout_queue), 040 (fiscal_sequences, fiscal columns on orders),
--          045 (orders.customer_id nullable), 046 (kds default station autoroute triggers).
--
-- WHY THIS IS 008 (WAS 007 IN PLAN):
--   Per schema-consolidation-plan.md §9 (open question 1), this file was renumbered
--   from 007 to 008 so that `locations` (defined in 007_payments_generic.sql) exists
--   before `orders` references it via FK. All tables in this file depend on locations.
--
-- Tables defined here (16 tables):
--   orders, order_items, order_payments (FK only — table in 007), tax_rates,
--   kitchen_stations, item_station_routing, category_station_routing [NEW],
--   kds_tickets, kds_ticket_items, kds_ticket_events, kds_fanout_queue,
--   kds_display_groups [NEW], fiscal_sequences, order_tracking_tokens [NEW]
--
-- Cross-migration FKs sealed here (007 tables need orders to exist):
--   order_payments.order_id → orders(id)
--   refunds.order_id → orders(id)
--
-- Intentionally absent (legacy tables replaced):
--   order_details, order_financial_details — columns folded into orders/order_payments.
--   driver_ratings, driver_earnings — old simplified model; new driver tables in 011.
--   delivery_drivers, driver_locations — old simplified model; new driver_* in 011.
--   order_item_variations — superseded by modifier model (migration 004); see note.
--
-- order_item_variations note:
--   Legacy 002 defined order_item_variations as a join table for item_variations ×
--   item_variation_options.  Migration 004 replaces item_variations with modifier_groups
--   + modifiers.  The consolidated model stores modifier choices directly on order_items
--   (or as a separate order_item_modifiers table in Wave 9).  For Wave 0 we omit
--   order_item_variations; the chatbot retains cart_item_variations (in 007) for compat.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. TAX RATES  (org/location-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE tax_rates (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id     uuid            NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name            text            NOT NULL,   -- e.g. "VAT 15%"
    rate            decimal(5,2)    NOT NULL CHECK (rate >= 0 AND rate <= 100),
    is_inclusive    boolean         NOT NULL DEFAULT true,
    is_active       boolean         NOT NULL DEFAULT true,
    created_at      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (location_id, name)
);

COMMENT ON TABLE tax_rates IS
    'Tax rate configurations per location. is_inclusive=true means prices '
    'already include this tax (standard for ZA VAT). Multiple rates per location '
    'are supported for mixed-tax menus.';

CREATE INDEX idx_tax_rates_location_id ON tax_rates(location_id);
CREATE INDEX idx_tax_rates_active      ON tax_rates(location_id, is_active);

CREATE TRIGGER trg_tax_rates_updated_at
    BEFORE UPDATE ON tax_rates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates FORCE ROW LEVEL SECURITY;

CREATE POLICY tax_rates_select ON tax_rates FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY tax_rates_insert ON tax_rates FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY tax_rates_update ON tax_rates FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY tax_rates_delete ON tax_rates FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 2. ORDERS
-- Consolidated from legacy 002, 016, 038, 040, 045, 046.
-- Replaces the legacy split across orders + order_details + order_financial_details.
-- ---------------------------------------------------------------------------

CREATE TABLE orders (
    id                              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id                     uuid                NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    -- customer_id is nullable to support walk-in POS orders (legacy 045).
    -- FK to customers(id) deferred to 010 (customers defined there).
    customer_id                     uuid,
    organization_id                 uuid                NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    order_number                    text                NOT NULL,

    -- Status and fulfilment
    status                          order_status        NOT NULL DEFAULT 'pending',
    fulfillment_type                fulfillment_type    NOT NULL DEFAULT 'collection',
    -- Legacy compat: order_type kept as text for chatbot handlers until Wave 9 port.
    -- After Wave 9, this column is dropped in favour of fulfillment_type.
    order_type                      text                DEFAULT 'pickup'
                                                        CHECK (order_type IN ('delivery','pickup','whatsapp','dine_in')),

    -- Dine-in linkage (absorbed from legacy 016)
    table_session_id                uuid                REFERENCES table_sessions(id) ON DELETE SET NULL,
    course_number                   integer,

    -- Delivery details (absorbed from order_details)
    delivery_address                text,
    delivery_latitude               decimal(10,7),
    delivery_longitude              decimal(10,7),
    delivery_distance_km            decimal(5,2),
    delivery_instructions           text,

    -- Financial summary (absorbed from order_financial_details)
    subtotal_cents                  bigint              NOT NULL DEFAULT 0,
    delivery_fee_cents              bigint              NOT NULL DEFAULT 0,
    discount_cents                  bigint              NOT NULL DEFAULT 0,
    tax_cents                       bigint              NOT NULL DEFAULT 0,
    total_cents                     bigint              NOT NULL DEFAULT 0,
    tax_rate                        decimal(5,2)        NOT NULL DEFAULT 15.00,
    tax_inclusive                   boolean             NOT NULL DEFAULT true,

    -- Multi-currency (legacy 038)
    currency_code                   text                REFERENCES currencies(code) DEFAULT 'ZAR',
    fx_rate_to_zar                  numeric(18,8)       NOT NULL DEFAULT 1,

    -- Fiscal (legacy 040)
    fiscal_receipt_number           text,
    fiscal_receipt_assigned_at      timestamptz,

    -- Client-side deduplication
    -- client_id: ULID or UUID assigned by the client to detect duplicate submissions.
    client_id                       text                UNIQUE,
    -- idempotency_key: server-generated or client-supplied key for safe retries.
    idempotency_key                 text                UNIQUE,

    -- Timing
    estimated_prep_time             integer,            -- minutes
    estimated_delivery_time         timestamptz,
    ready_at                        timestamptz,
    picked_up_at                    timestamptz,
    delivered_at                    timestamptz,

    -- Attribution
    taken_by                        uuid                REFERENCES profiles(id) ON DELETE SET NULL,
    notes                           text,
    kitchen_notes                   text,

    created_at                      timestamptz         NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at                      timestamptz         NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE orders IS
    'Central order record. Consolidates orders + order_details + order_financial_details '
    'from legacy 002. fulfillment_type uses the fulfillment_type enum (001). '
    'client_id / idempotency_key enable duplicate submission detection and safe retries. '
    'fiscal_receipt_number is unique per location (enforced below).';
COMMENT ON COLUMN orders.order_type IS
    'Legacy text column for backward compat with chatbot handlers. '
    'New code should use fulfillment_type instead. Dropped in Wave 9.';

-- Per-day unique order number per location (mirrors legacy pattern).
CREATE UNIQUE INDEX unique_order_number_per_day
    ON orders (location_id, order_number, date_trunc('day', created_at AT TIME ZONE 'UTC'));

-- Unique fiscal receipt number per location.
CREATE UNIQUE INDEX idx_orders_fiscal_receipt_unique
    ON orders(location_id, fiscal_receipt_number)
    WHERE fiscal_receipt_number IS NOT NULL;

CREATE INDEX idx_orders_location_id     ON orders(location_id);
CREATE INDEX idx_orders_customer_id     ON orders(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_orders_org_id          ON orders(organization_id);
CREATE INDEX idx_orders_status          ON orders(location_id, status);
CREATE INDEX idx_orders_created_at      ON orders(location_id, created_at DESC);
CREATE INDEX idx_orders_table_session   ON orders(table_session_id) WHERE table_session_id IS NOT NULL;

CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- RLS: org-scoped
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

-- Threat: tenant A must not read or mutate tenant B's orders.
CREATE POLICY orders_select ON orders FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY orders_insert ON orders FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY orders_update ON orders FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
-- Hard deletes locked to service_role; handlers soft-cancel via status='cancelled'.
CREATE POLICY orders_delete ON orders FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 3. ORDER ITEMS
-- Consolidated from legacy 002 + 016 (seat_id, course_number).
-- ---------------------------------------------------------------------------

CREATE TABLE order_items (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id                uuid            NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id                 uuid            NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity                integer         NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_cents        bigint          NOT NULL,
    total_price_cents       bigint          NOT NULL,
    special_instructions    text,
    -- Dine-in: per-item seat assignment (legacy 016)
    seat_id                 uuid            REFERENCES seats(id) ON DELETE SET NULL,
    course_number           integer,        -- per-item course override
    -- Deduplication (mirrors orders for item-level idempotency)
    client_id               text,
    idempotency_key         text,
    created_at              timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at              timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
);

COMMENT ON TABLE order_items IS
    'Line items for an order. seat_id/course_number support dine-in course firing. '
    'unit_price_cents / total_price_cents in bigint cents for precision. '
    'client_id / idempotency_key for item-level duplicate detection.';

CREATE INDEX idx_order_items_order_id   ON order_items(order_id);
CREATE INDEX idx_order_items_item_id    ON order_items(item_id);
CREATE INDEX idx_order_items_seat_id    ON order_items(seat_id) WHERE seat_id IS NOT NULL;

CREATE TRIGGER trg_order_items_updated_at
    BEFORE UPDATE ON order_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;

CREATE POLICY order_items_select ON order_items FOR SELECT
    USING (
        order_id IN (
            SELECT id FROM orders WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY order_items_insert ON order_items FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT id FROM orders WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY order_items_update ON order_items FOR UPDATE
    USING (
        order_id IN (
            SELECT id FROM orders WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        order_id IN (
            SELECT id FROM orders WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY order_items_delete ON order_items FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 4. SEAL DEFERRED CROSS-MIGRATION FKs (007 → 008)
-- Now that orders and order_items exist, add FKs declared in 007.
-- ---------------------------------------------------------------------------

-- order_payments.order_id → orders(id)
ALTER TABLE order_payments
    ADD CONSTRAINT fk_order_payments_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- refunds.order_id → orders(id)
ALTER TABLE refunds
    ADD CONSTRAINT fk_refunds_order
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;

-- check_split_items.order_item_id → order_items(id)
-- (check_split_items created in 006; order_items now exists)
ALTER TABLE check_split_items
    ADD CONSTRAINT fk_check_split_items_order_item
    FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. KITCHEN STATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE kitchen_stations (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id     uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name            text        NOT NULL,
    station_type    text        NOT NULL DEFAULT 'prep'
                                CHECK (station_type IN ('prep', 'expo', 'bar')),
    sort_order      integer     NOT NULL DEFAULT 0,
    is_active       boolean     NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (location_id, name)
);

CREATE INDEX idx_kitchen_stations_location_id ON kitchen_stations(location_id);
CREATE INDEX idx_kitchen_stations_active      ON kitchen_stations(location_id, is_active);

CREATE TRIGGER trg_kitchen_stations_updated_at
    BEFORE UPDATE ON kitchen_stations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE kitchen_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_stations FORCE ROW LEVEL SECURITY;

CREATE POLICY kitchen_stations_select ON kitchen_stations FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY kitchen_stations_insert ON kitchen_stations FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY kitchen_stations_update ON kitchen_stations FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY kitchen_stations_delete ON kitchen_stations FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 6. ITEM STATION ROUTING  (items → kitchen_stations, many-to-many)
-- ---------------------------------------------------------------------------

CREATE TABLE item_station_routing (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id     uuid        NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    station_id  uuid        NOT NULL REFERENCES kitchen_stations(id) ON DELETE CASCADE,
    is_primary  boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (item_id, station_id)
);

CREATE INDEX idx_item_station_routing_item_id    ON item_station_routing(item_id);
CREATE INDEX idx_item_station_routing_station_id ON item_station_routing(station_id);

ALTER TABLE item_station_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_station_routing FORCE ROW LEVEL SECURITY;

CREATE POLICY isr_select ON item_station_routing FOR SELECT
    USING (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY isr_insert ON item_station_routing FOR INSERT
    WITH CHECK (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY isr_update ON item_station_routing FOR UPDATE
    USING (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY isr_delete ON item_station_routing FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 7. CATEGORY STATION ROUTING  [NEW — ROADMAP Now-23]
-- Routes entire categories to a station as a default fallback.
-- ---------------------------------------------------------------------------

CREATE TABLE category_station_routing (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id uuid        NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    station_id  uuid        NOT NULL REFERENCES kitchen_stations(id) ON DELETE CASCADE,
    is_primary  boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (category_id, station_id)
);

COMMENT ON TABLE category_station_routing IS
    'Routes an entire menu category to a kitchen station. '
    'Lower priority than item_station_routing — used as a fallback when no '
    'explicit item routing exists.';

CREATE INDEX idx_csr_category_id ON category_station_routing(category_id);
CREATE INDEX idx_csr_station_id  ON category_station_routing(station_id);

ALTER TABLE category_station_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_station_routing FORCE ROW LEVEL SECURITY;

CREATE POLICY csr_select ON category_station_routing FOR SELECT
    USING (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY csr_insert ON category_station_routing FOR INSERT
    WITH CHECK (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY csr_update ON category_station_routing FOR UPDATE
    USING (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY csr_delete ON category_station_routing FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 8. KDS TICKETS  (one per order × station)
-- ---------------------------------------------------------------------------

CREATE TABLE kds_tickets (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    station_id      uuid        NOT NULL REFERENCES kitchen_stations(id) ON DELETE CASCADE,
    ticket_number   integer     NOT NULL,
    status          text        NOT NULL DEFAULT 'fired'
                                CHECK (status IN ('fired','in_progress','ready','bumped','recalled','cancelled')),
    fired_at        timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    started_at      timestamptz,
    ready_at        timestamptz,
    bumped_at       timestamptz,
    bumped_by       uuid        REFERENCES staff(id) ON DELETE SET NULL,
    course_number   integer,
    priority        integer     NOT NULL DEFAULT 0,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (order_id, station_id)
);

CREATE INDEX idx_kds_tickets_order_id       ON kds_tickets(order_id);
CREATE INDEX idx_kds_tickets_station_status ON kds_tickets(station_id, status);
CREATE INDEX idx_kds_tickets_status_fired   ON kds_tickets(status, fired_at);

CREATE TRIGGER trg_kds_tickets_updated_at
    BEFORE UPDATE ON kds_tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE kds_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_tickets FORCE ROW LEVEL SECURITY;

CREATE POLICY kds_tickets_select ON kds_tickets FOR SELECT
    USING (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY kds_tickets_insert ON kds_tickets FOR INSERT
    WITH CHECK (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY kds_tickets_update ON kds_tickets FOR UPDATE
    USING (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        station_id IN (
            SELECT ks.id FROM kitchen_stations ks
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY kds_tickets_delete ON kds_tickets FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 9. KDS TICKET ITEMS
-- ---------------------------------------------------------------------------

CREATE TABLE kds_ticket_items (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       uuid            NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
    order_item_id   uuid            NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    quantity        decimal(10,3)   NOT NULL CHECK (quantity > 0),
    item_status     text            NOT NULL DEFAULT 'fired'
                                    CHECK (item_status IN ('fired','in_progress','ready','bumped','voided','86ed')),
    started_at      timestamptz,
    ready_at        timestamptz,
    bumped_at       timestamptz,
    notes           text,
    created_at      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (ticket_id, order_item_id)
);

CREATE INDEX idx_kds_ticket_items_ticket_id     ON kds_ticket_items(ticket_id);
CREATE INDEX idx_kds_ticket_items_order_item_id ON kds_ticket_items(order_item_id);

CREATE TRIGGER trg_kds_ticket_items_updated_at
    BEFORE UPDATE ON kds_ticket_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE kds_ticket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_ticket_items FORCE ROW LEVEL SECURITY;

CREATE POLICY kds_ticket_items_select ON kds_ticket_items FOR SELECT
    USING (
        ticket_id IN (
            SELECT kt.id FROM kds_tickets kt
            JOIN kitchen_stations ks ON ks.id = kt.station_id
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY kds_ticket_items_insert ON kds_ticket_items FOR INSERT
    WITH CHECK (
        ticket_id IN (
            SELECT kt.id FROM kds_tickets kt
            JOIN kitchen_stations ks ON ks.id = kt.station_id
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY kds_ticket_items_update ON kds_ticket_items FOR UPDATE
    USING (
        ticket_id IN (
            SELECT kt.id FROM kds_tickets kt
            JOIN kitchen_stations ks ON ks.id = kt.station_id
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        ticket_id IN (
            SELECT kt.id FROM kds_tickets kt
            JOIN kitchen_stations ks ON ks.id = kt.station_id
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY kds_ticket_items_delete ON kds_ticket_items FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 10. KDS TICKET EVENTS  (immutable event log)
-- event_type uses the kds_event_type enum defined in 001 (includes 'ready').
-- ---------------------------------------------------------------------------

CREATE TABLE kds_ticket_events (
    id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       uuid            NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
    -- ticket_item_id is nullable: some events are ticket-level (e.g. bumped, recalled).
    ticket_item_id  uuid            REFERENCES kds_ticket_items(id) ON DELETE CASCADE,
    event_type      kds_event_type  NOT NULL,
    performed_by    uuid            REFERENCES staff(id) ON DELETE SET NULL,
    payload         jsonb,          -- structured event data (priority change, note text, etc.)
    created_at      timestamptz     NOT NULL DEFAULT timezone('utc'::text, now())
    -- NO updated_at — append-only
);

COMMENT ON TABLE kds_ticket_events IS
    'Immutable event log for KDS ticket lifecycle. event_type uses the kds_event_type '
    'enum (includes ''ready'' added to 001). No UPDATE or DELETE — append-only.';

CREATE INDEX idx_kds_ticket_events_ticket_id  ON kds_ticket_events(ticket_id);
CREATE INDEX idx_kds_ticket_events_created_at ON kds_ticket_events(created_at DESC);
CREATE INDEX idx_kds_ticket_events_type       ON kds_ticket_events(event_type, created_at DESC);

ALTER TABLE kds_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_ticket_events FORCE ROW LEVEL SECURITY;

CREATE POLICY kds_events_select ON kds_ticket_events FOR SELECT
    USING (
        ticket_id IN (
            SELECT kt.id FROM kds_tickets kt
            JOIN kitchen_stations ks ON ks.id = kt.station_id
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY kds_events_insert ON kds_ticket_events FOR INSERT
    WITH CHECK (
        ticket_id IN (
            SELECT kt.id FROM kds_tickets kt
            JOIN kitchen_stations ks ON ks.id = kt.station_id
            JOIN locations l ON l.id = ks.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
-- Append-only: no UPDATE or DELETE for anyone.
CREATE POLICY kds_events_update ON kds_ticket_events FOR UPDATE USING (false);
CREATE POLICY kds_events_delete ON kds_ticket_events FOR DELETE USING (false);

-- ---------------------------------------------------------------------------
-- 11. KDS FANOUT QUEUE
-- Extended from legacy 036 with retry_count and state columns.
-- ---------------------------------------------------------------------------

CREATE TABLE kds_fanout_queue (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    queued_at       timestamptz NOT NULL DEFAULT now(),
    processed_at    timestamptz,
    error_message   text,
    retry_count     int         NOT NULL DEFAULT 0,
    state           text        NOT NULL DEFAULT 'pending'
                                CHECK (state IN ('pending', 'processing', 'dead')),
    UNIQUE (order_id)
);

COMMENT ON TABLE kds_fanout_queue IS
    'Queue for fanning out orders to KDS stations. retry_count and state=''dead'' '
    'support the Wave 6 dead-letter pattern: after N retries, the worker sets '
    'state=''dead'' and alerts ops.';

CREATE INDEX idx_kds_fanout_queue_unprocessed
    ON kds_fanout_queue(queued_at)
    WHERE state = 'pending';
CREATE INDEX idx_kds_fanout_queue_retry
    ON kds_fanout_queue(state, retry_count)
    WHERE state IN ('processing', 'dead');

ALTER TABLE kds_fanout_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_fanout_queue FORCE ROW LEVEL SECURITY;

CREATE POLICY kds_fanout_select ON kds_fanout_queue FOR SELECT
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY kds_fanout_insert ON kds_fanout_queue FOR INSERT
    WITH CHECK (is_service_role());
CREATE POLICY kds_fanout_update ON kds_fanout_queue FOR UPDATE
    USING (is_service_role()) WITH CHECK (is_service_role());
CREATE POLICY kds_fanout_delete ON kds_fanout_queue FOR DELETE
    USING (is_service_role());

-- KDS fanout trigger (from legacy 036; reused unchanged):
-- Enqueue an order when status transitions to a kitchen-active state.
CREATE OR REPLACE FUNCTION queue_kds_fanout()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IN ('confirmed', 'preparing', 'ready')
       AND (OLD IS NULL OR OLD.status NOT IN ('confirmed', 'preparing', 'ready'))
    THEN
        INSERT INTO kds_fanout_queue (order_id)
        VALUES (NEW.id)
        ON CONFLICT (order_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION queue_kds_fanout() IS
    'Trigger: enqueues an order for KDS fan-out when status first enters a '
    'kitchen-active state (confirmed, preparing, ready). Idempotent via ON CONFLICT.';

DROP TRIGGER IF EXISTS trg_queue_kds_fanout ON orders;
CREATE TRIGGER trg_queue_kds_fanout
    AFTER INSERT OR UPDATE OF status ON orders
    FOR EACH ROW EXECUTE FUNCTION queue_kds_fanout();

-- ---------------------------------------------------------------------------
-- 12. KDS DISPLAY GROUPS  [NEW — ROADMAP Now-23]
-- Absorbed from legacy 028 (kds_expo_view) — modelled as a table not a view.
-- ---------------------------------------------------------------------------

CREATE TABLE kds_display_groups (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    -- station_ids: which kitchen_stations are visible in this group.
    station_ids uuid[]      NOT NULL DEFAULT '{}',
    sort_order  integer     NOT NULL DEFAULT 0,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at  timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (location_id, name)
);

COMMENT ON TABLE kds_display_groups IS
    'Logical groups of kitchen stations shown together on a KDS screen. '
    'Replaces the legacy kds_expo_view from migration 028. station_ids is a '
    'UUID array referencing kitchen_stations.id values.';

CREATE INDEX idx_kds_display_groups_location_id ON kds_display_groups(location_id);

CREATE TRIGGER trg_kds_display_groups_updated_at
    BEFORE UPDATE ON kds_display_groups
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE kds_display_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_display_groups FORCE ROW LEVEL SECURITY;

CREATE POLICY kds_display_groups_select ON kds_display_groups FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY kds_display_groups_insert ON kds_display_groups FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY kds_display_groups_update ON kds_display_groups FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY kds_display_groups_delete ON kds_display_groups FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 13. FISCAL SEQUENCES  (per-location fiscal receipt counter)
-- ---------------------------------------------------------------------------

CREATE TABLE fiscal_sequences (
    location_id     uuid        PRIMARY KEY REFERENCES locations(id) ON DELETE CASCADE,
    current_number  bigint      NOT NULL DEFAULT 0,
    prefix          text        NOT NULL DEFAULT '',   -- e.g. "INV-2026-"
    reset_policy    text        NOT NULL DEFAULT 'never'
                                CHECK (reset_policy IN ('never','yearly','monthly')),
    last_reset_at   timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE fiscal_sequences IS
    'Per-location monotonic counter for fiscal receipt numbers. '
    'current_number is incremented atomically by the fiscal handler.';

CREATE TRIGGER trg_fiscal_sequences_updated_at
    BEFORE UPDATE ON fiscal_sequences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE fiscal_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_sequences FORCE ROW LEVEL SECURITY;

CREATE POLICY fiscal_sequences_select ON fiscal_sequences FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY fiscal_sequences_insert ON fiscal_sequences FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY fiscal_sequences_update ON fiscal_sequences FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY fiscal_sequences_delete ON fiscal_sequences FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 14. ORDER TRACKING TOKENS  [NEW — ROADMAP Now-7]
-- Scoped to: service_role OR customer_profile_id = current_user_id().
-- ---------------------------------------------------------------------------

CREATE TABLE order_tracking_tokens (
    token               text        PRIMARY KEY,
    order_id            uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_profile_id uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    expires_at          timestamptz NOT NULL,
    revoked_at          timestamptz,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
    -- NO updated_at — tokens are issued once; revocation is append-style (set revoked_at).
);

COMMENT ON TABLE order_tracking_tokens IS
    'Short-lived tokens allowing customers (or anonymous links) to track an order '
    'without authentication. customer_profile_id links to the profiles row '
    'when the customer is authenticated; NULL for link-based anonymous tracking.';

CREATE INDEX idx_order_tracking_tokens_order_id ON order_tracking_tokens(order_id);
CREATE INDEX idx_order_tracking_tokens_expires  ON order_tracking_tokens(expires_at)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_order_tracking_tokens_profile  ON order_tracking_tokens(customer_profile_id)
    WHERE customer_profile_id IS NOT NULL;

ALTER TABLE order_tracking_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_tracking_tokens FORCE ROW LEVEL SECURITY;

-- Customers can see their own tokens; service_role can see all.
-- Anonymous tokens (customer_profile_id IS NULL) are service_role-only.
CREATE POLICY tracking_tokens_select ON order_tracking_tokens FOR SELECT
    USING (
        customer_profile_id = current_user_id()
        OR is_service_role()
    );
CREATE POLICY tracking_tokens_insert ON order_tracking_tokens FOR INSERT
    WITH CHECK (is_service_role());
-- Revocation: service_role sets revoked_at.
CREATE POLICY tracking_tokens_update ON order_tracking_tokens FOR UPDATE
    USING (is_service_role()) WITH CHECK (is_service_role());
CREATE POLICY tracking_tokens_delete ON order_tracking_tokens FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 15. AUTO-ROUTE TRIGGERS (from legacy 046)
-- Backfill and auto-route triggers are NOT included here (Wave 0 schema-only).
-- Backfill runs as part of the migration runner's post-run seeding step (014).
-- The two auto-route triggers are defined for new rows only:
-- ---------------------------------------------------------------------------

-- Auto-create a default 'Kitchen' station when a new location is inserted.
CREATE OR REPLACE FUNCTION trg_fn_location_default_kitchen_station()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO kitchen_stations (location_id, name, station_type, sort_order, is_active)
    VALUES (NEW.id, 'Kitchen', 'prep', 0, true)
    ON CONFLICT (location_id, name) DO NOTHING;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_location_default_kitchen_station() IS
    'Trigger: creates a default ''Kitchen'' station when a new location is inserted.';

DROP TRIGGER IF EXISTS trg_location_default_kitchen_station ON locations;
CREATE TRIGGER trg_location_default_kitchen_station
    AFTER INSERT ON locations
    FOR EACH ROW EXECUTE FUNCTION trg_fn_location_default_kitchen_station();

-- Auto-route a new item to its location's 'Kitchen' station.
CREATE OR REPLACE FUNCTION trg_fn_item_default_station_routing()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_station_id uuid;
BEGIN
    SELECT id INTO v_station_id
    FROM kitchen_stations
    WHERE location_id = NEW.location_id AND name = 'Kitchen'
    LIMIT 1;

    IF v_station_id IS NULL THEN
        RAISE NOTICE
            'trg_fn_item_default_station_routing: no Kitchen station for location_id=%, '
            'item_id=% — skipping',
            NEW.location_id, NEW.id;
        RETURN NEW;
    END IF;

    INSERT INTO item_station_routing (item_id, station_id, is_primary)
    VALUES (NEW.id, v_station_id, true)
    ON CONFLICT (item_id, station_id) DO NOTHING;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION trg_fn_item_default_station_routing() IS
    'Trigger: routes a newly inserted item to its location''s Kitchen station.';

DROP TRIGGER IF EXISTS trg_item_default_station_routing ON items;
CREATE TRIGGER trg_item_default_station_routing
    AFTER INSERT ON items
    FOR EACH ROW EXECUTE FUNCTION trg_fn_item_default_station_routing();

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Migration 008 complete.
-- Tables (14): tax_rates, orders, order_items, kitchen_stations,
--   item_station_routing, category_station_routing [NEW], kds_tickets,
--   kds_ticket_items, kds_ticket_events, kds_fanout_queue, kds_display_groups [NEW],
--   fiscal_sequences, order_tracking_tokens [NEW].
-- Deferred FKs sealed: order_payments→orders, refunds→orders,
--   check_split_items→order_items.
-- Triggers: queue_kds_fanout (kds fanout enqueue),
--   trg_fn_location_default_kitchen_station (auto kitchen station),
--   trg_fn_item_default_station_routing (auto item routing).
--
-- All tables are RLS-enabled. kds_ticket_events is append-only (no UPDATE/DELETE).
-- Legacy tables intentionally absent: order_details, order_financial_details,
--   driver_ratings, driver_earnings, delivery_drivers, driver_locations,
--   order_item_variations.

-- =============================================================================
-- DEFERRED RLS POLICIES FROM 007 — require orders table (defined here)
-- =============================================================================
-- These policies in payment tables reference orders.id.
-- Deferred from 007 because orders is defined in this migration (008).
-- Postgres 18 validates policy table references at DDL time.
-- =============================================================================

CREATE POLICY order_payments_select ON order_payments FOR SELECT
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY order_payments_insert ON order_payments FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY order_payments_update ON order_payments FOR UPDATE
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY refunds_select ON refunds FOR SELECT
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY refunds_insert ON refunds FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY refunds_update ON refunds FOR UPDATE
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );

