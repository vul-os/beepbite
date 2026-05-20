-- ======================
-- DINE-IN SUPPORT
-- Floor sections, tables, table sessions, seats, and split-check infrastructure.
-- ======================

-- Sections: floor areas per location (e.g. "Patio", "Bar", "Main Room")
CREATE TABLE sections (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(location_id, name)
);

-- Tables: physical tables on the floor
-- Note: "tables" is a reserved-ish identifier; quoted everywhere it appears.
CREATE TABLE "tables" (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    section_id uuid REFERENCES sections(id) ON DELETE SET NULL,
    label text NOT NULL,
    capacity integer NOT NULL CHECK (capacity > 0),
    status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved', 'out_of_service')),
    pos_x decimal(8,2),
    pos_y decimal(8,2),
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(location_id, label)
);

-- Table sessions: a party occupying a table
CREATE TABLE table_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    table_id uuid REFERENCES "tables"(id) ON DELETE CASCADE NOT NULL,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    opened_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    party_size integer NOT NULL DEFAULT 1 CHECK (party_size > 0),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'transferred')),
    opened_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    closed_at timestamptz,
    transferred_to_session_id uuid REFERENCES table_sessions(id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Only one open session may exist per table at a time
CREATE UNIQUE INDEX one_open_session_per_table ON table_sessions(table_id) WHERE status = 'open';

-- Seats: per-diner tickets inside a session (enables split-by-seat)
CREATE TABLE seats (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    table_session_id uuid REFERENCES table_sessions(id) ON DELETE CASCADE NOT NULL,
    seat_number integer NOT NULL CHECK (seat_number > 0),
    guest_name text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(table_session_id, seat_number)
);

-- ======================
-- ORDERS CHANGES
-- ======================

-- Widen order_type to include 'dine_in'
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (order_type IN ('delivery', 'pickup', 'whatsapp', 'dine_in'));

-- Add dine-in linkage and course firing to orders
ALTER TABLE orders ADD COLUMN table_session_id uuid REFERENCES table_sessions(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN course_number integer;

-- Add seat and per-item course override to order_items
ALTER TABLE order_items ADD COLUMN seat_id uuid REFERENCES seats(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN course_number integer;

-- ======================
-- SPLIT-CHECK SUPPORT
-- ======================

-- Check splits: records how a session was split into sub-checks for separate payment
CREATE TABLE check_splits (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    table_session_id uuid REFERENCES table_sessions(id) ON DELETE CASCADE NOT NULL,
    split_label text NOT NULL,
    created_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(table_session_id, split_label)
);

-- Check split items: which order_items go on which split (supports half-item splits)
CREATE TABLE check_split_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    check_split_id uuid REFERENCES check_splits(id) ON DELETE CASCADE NOT NULL,
    order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE NOT NULL,
    quantity decimal(10,3) NOT NULL CHECK (quantity > 0),
    UNIQUE(check_split_id, order_item_id)
);

-- ======================
-- INDEXES
-- ======================

CREATE INDEX idx_table_sessions_table_id ON table_sessions(table_id);
CREATE INDEX idx_table_sessions_location_id ON table_sessions(location_id);
CREATE INDEX idx_table_sessions_status ON table_sessions(status);
CREATE INDEX idx_seats_table_session_id ON seats(table_session_id);
CREATE INDEX idx_orders_table_session_id ON orders(table_session_id) WHERE table_session_id IS NOT NULL;
CREATE INDEX idx_order_items_seat_id ON order_items(seat_id) WHERE seat_id IS NOT NULL;
CREATE INDEX idx_tables_location_id ON "tables"(location_id);
CREATE INDEX idx_tables_section_id ON "tables"(section_id);
CREATE INDEX idx_sections_location_id ON sections(location_id);
CREATE INDEX idx_check_splits_table_session_id ON check_splits(table_session_id);
CREATE INDEX idx_check_split_items_check_split_id ON check_split_items(check_split_id);
CREATE INDEX idx_check_split_items_order_item_id ON check_split_items(order_item_id);

-- ======================
-- UPDATED_AT TRIGGERS
-- ======================

-- TODO: attach updated_at trigger to sections
-- TODO: attach updated_at trigger to "tables"
-- TODO: attach updated_at trigger to table_sessions
-- TODO: attach updated_at trigger to seats
-- TODO: attach updated_at trigger to check_splits
