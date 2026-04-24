-- ======================
-- CASH DRAWER MANAGEMENT & ORDER ADJUSTMENTS
-- Cash drawer open/close cycles, movements, counts; void/comp/price-override
-- adjustments with optional manager approval.
-- All monetary values stored in cents (bigint) to match payment_system.sql.
-- ======================

-- ======================
-- CASH DRAWERS
-- ======================

-- Physical cash drawers per location (typically one per station/register)
CREATE TABLE cash_drawers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL, -- e.g. "Front Register", "Bar"
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(location_id, name)
);

-- Open/close cycle of a drawer
CREATE TABLE cash_drawer_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    cash_drawer_id uuid REFERENCES cash_drawers(id) ON DELETE CASCADE NOT NULL,
    opened_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    closed_by uuid REFERENCES staff(id) ON DELETE SET NULL,

    -- Amounts (all in cents)
    opening_float_cents bigint NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),
    declared_closing_cents bigint, -- what staff counted (nullable until close)
    expected_closing_cents bigint, -- what system calculates (nullable until close)
    over_short_cents bigint, -- declared - expected; can be negative

    -- Blind close: staff counts without seeing expected amount
    is_blind_close boolean DEFAULT false,

    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'reconciled')),

    opened_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    closed_at timestamptz,
    notes text,

    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Only one open session per drawer at a time
CREATE UNIQUE INDEX one_open_session_per_drawer
    ON cash_drawer_sessions(cash_drawer_id)
    WHERE status = 'open';

-- All cash in/out events during a session
-- (paid-in, paid-out, petty-cash, tip-out, no-sale, drop, pickup)
CREATE TABLE cash_drawer_movements (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    cash_drawer_session_id uuid REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE NOT NULL,
    movement_type text NOT NULL CHECK (movement_type IN ('paid_in', 'paid_out', 'petty_cash', 'tip_out', 'no_sale', 'drop', 'pickup')),
    amount_cents bigint NOT NULL, -- positive for in, negative for out (sign by convention)
    reason text,

    -- Polymorphic reference (no FK because it can point at various tables)
    reference_type text, -- e.g. 'order_payment', 'manual', 'change_fund'
    reference_id uuid,

    performed_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    approved_by uuid REFERENCES staff(id) ON DELETE SET NULL, -- for paid-outs requiring manager approval

    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Declared counts broken down by denomination (for closing count & audit)
CREATE TABLE cash_drawer_counts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    cash_drawer_session_id uuid REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE NOT NULL,
    count_type text NOT NULL CHECK (count_type IN ('open', 'close', 'mid_shift')),
    total_cents bigint NOT NULL CHECK (total_cents >= 0),
    denominations jsonb, -- e.g. {"R200":2,"R100":5,"R50":3,...} — currency-agnostic
    counted_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Link cash-type order_payments to the session in which they occurred.
-- Used to compute expected_closing_cents at close time.
CREATE TABLE cash_drawer_session_payments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    cash_drawer_session_id uuid REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE NOT NULL,
    payment_id uuid REFERENCES order_payments(id) ON DELETE CASCADE NOT NULL,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(payment_id)
);

-- ======================
-- ORDER ADJUSTMENTS
-- Voids, comps, price-overrides, manager discounts
-- ======================

-- Configurable reason codes per location
CREATE TABLE adjustment_reasons (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    code text NOT NULL, -- e.g. "QUALITY", "LONG_WAIT", "GUEST_DISSATISFIED", "STAFF_MEAL", "MARKETING_COMP", "PRICE_OVERRIDE"
    label text NOT NULL,
    adjustment_type text NOT NULL CHECK (adjustment_type IN ('void', 'comp', 'price_override', 'manager_discount')),
    requires_manager_approval boolean NOT NULL DEFAULT true,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(location_id, code)
);

-- Actual applied adjustments (auditable record)
-- amount_cents is always positive; its meaning depends on adjustment_type:
--   'void'            — amount removed from order
--   'comp'            — amount comped (no charge)
--   'price_override'  — delta from original_amount_cents to the new price
--   'manager_discount' — discount amount applied by a manager
-- If the selected reason has requires_manager_approval = true and approval_status = 'approved',
-- approved_by should be NOT NULL. This invariant is documented intent here; enforce via trigger
-- or application logic in a follow-up migration.
CREATE TABLE order_adjustments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
    order_item_id uuid REFERENCES order_items(id) ON DELETE CASCADE, -- nullable; NULL = order-level adjustment
    adjustment_type text NOT NULL CHECK (adjustment_type IN ('void', 'comp', 'price_override', 'manager_discount')),

    reason_id uuid REFERENCES adjustment_reasons(id) ON DELETE SET NULL,
    reason_text text, -- free-form override

    amount_cents bigint NOT NULL, -- always positive; meaning depends on type
    original_amount_cents bigint, -- pre-adjustment value (for price_override: original unit_price * qty)

    applied_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    approved_by uuid REFERENCES staff(id) ON DELETE SET NULL, -- nullable if reason doesn't require approval

    approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending', 'approved', 'rejected')),

    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- INDEXES
-- ======================

-- Cash drawer indexes
CREATE INDEX idx_cash_drawers_location ON cash_drawers(location_id);
CREATE INDEX idx_cash_drawer_sessions_drawer_status ON cash_drawer_sessions(cash_drawer_id, status);
CREATE INDEX idx_cash_drawer_sessions_opened_at ON cash_drawer_sessions(opened_at);
CREATE INDEX idx_cash_drawer_movements_session ON cash_drawer_movements(cash_drawer_session_id);
CREATE INDEX idx_cash_drawer_movements_created_at ON cash_drawer_movements(created_at);
CREATE INDEX idx_cash_drawer_counts_session ON cash_drawer_counts(cash_drawer_session_id);
CREATE INDEX idx_cash_drawer_session_payments_session ON cash_drawer_session_payments(cash_drawer_session_id);

-- Adjustment indexes
CREATE INDEX idx_adjustment_reasons_location ON adjustment_reasons(location_id);
CREATE INDEX idx_order_adjustments_order ON order_adjustments(order_id);
CREATE INDEX idx_order_adjustments_order_item ON order_adjustments(order_item_id);
CREATE INDEX idx_order_adjustments_applied_by ON order_adjustments(applied_by);
CREATE INDEX idx_order_adjustments_created_at ON order_adjustments(created_at);
