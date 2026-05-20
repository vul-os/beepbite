-- ======================
-- KITCHEN DISPLAY SYSTEM (KDS)
-- ======================

-- Kitchen stations - logical prep stations (grill, fry, salad, bar, expo)
CREATE TABLE kitchen_stations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL, -- e.g., "Grill", "Cold Line", "Expo", "Bar"
    station_type text NOT NULL DEFAULT 'prep' CHECK (station_type IN ('prep', 'expo', 'bar')),
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(location_id, name)
);

-- Item to station routing - many-to-many (e.g. steak salad → grill + cold line)
CREATE TABLE item_station_routing (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id uuid REFERENCES items(id) ON DELETE CASCADE NOT NULL,
    station_id uuid REFERENCES kitchen_stations(id) ON DELETE CASCADE NOT NULL,
    is_primary boolean DEFAULT false, -- Primary station fires first / owns the ticket
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(item_id, station_id)
);

-- KDS tickets - one ticket per (order × station)
CREATE TABLE kds_tickets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    station_id uuid REFERENCES kitchen_stations(id) ON DELETE CASCADE NOT NULL,
    ticket_number integer NOT NULL, -- Per-location sequence
    status text NOT NULL DEFAULT 'fired' CHECK (status IN ('fired', 'in_progress', 'ready', 'bumped', 'recalled', 'cancelled')),
    fired_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    started_at timestamptz,
    ready_at timestamptz,
    bumped_at timestamptz,
    bumped_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    course_number integer, -- Mirrors orders.course_number for course-firing
    priority integer DEFAULT 0, -- Higher = rushes in front (VIP / late ticket)
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(order_id, station_id)
);

-- KDS ticket items - mirrors order_items but only those routed to this station
CREATE TABLE kds_ticket_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id uuid REFERENCES kds_tickets(id) ON DELETE CASCADE NOT NULL,
    order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE NOT NULL,
    quantity decimal(10,3) NOT NULL CHECK (quantity > 0),
    item_status text NOT NULL DEFAULT 'fired' CHECK (item_status IN ('fired', 'in_progress', 'ready', 'bumped', 'voided', '86ed')),
    started_at timestamptz,
    ready_at timestamptz,
    bumped_at timestamptz,
    notes text, -- Special instructions carried from order_items
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(ticket_id, order_item_id)
);

-- KDS ticket events - immutable event log
CREATE TABLE kds_ticket_events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id uuid REFERENCES kds_tickets(id) ON DELETE CASCADE NOT NULL,
    ticket_item_id uuid REFERENCES kds_ticket_items(id) ON DELETE CASCADE, -- Nullable - some events are ticket-level
    event_type text NOT NULL CHECK (event_type IN ('fired', 'started', 'bumped', 'recalled', 're_fired', 'cancelled', 'priority_changed', 'rushed', 'item_86ed', 'note_added')),
    performed_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    payload jsonb, -- Structured event data (e.g. old/new priority, note text)
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- INDEXES
-- ======================

CREATE INDEX idx_kitchen_stations_location_id ON kitchen_stations(location_id);

CREATE INDEX idx_item_station_routing_item_id ON item_station_routing(item_id);
CREATE INDEX idx_item_station_routing_station_id ON item_station_routing(station_id);

CREATE INDEX idx_kds_tickets_order_id ON kds_tickets(order_id);
CREATE INDEX idx_kds_tickets_station_status ON kds_tickets(station_id, status);
CREATE INDEX idx_kds_tickets_status_fired_at ON kds_tickets(status, fired_at);

CREATE INDEX idx_kds_ticket_items_ticket_id ON kds_ticket_items(ticket_id);
CREATE INDEX idx_kds_ticket_items_order_item_id ON kds_ticket_items(order_item_id);

CREATE INDEX idx_kds_ticket_events_ticket_id ON kds_ticket_events(ticket_id);
CREATE INDEX idx_kds_ticket_events_created_at ON kds_ticket_events(created_at);

-- ======================
-- UPDATED_AT TRIGGERS
-- ======================

-- TODO: attach updated_at trigger to kitchen_stations
-- TODO: attach updated_at trigger to kds_tickets
-- TODO: attach updated_at trigger to kds_ticket_items
