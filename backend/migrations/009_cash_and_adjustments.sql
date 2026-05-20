-- =============================================================================
-- MIGRATION 009 — CASH AND ADJUSTMENTS
-- =============================================================================
-- Sources: legacy 18 (cash_drawer_and_adjustments), legacy 31 (schema_fixes).
-- New tables: pos_shifts.
--
-- Key changes vs legacy 18:
--   - order_adjustments.adjustment_type CHECK includes 'refund' (absorbed from
--     legacy 31 which added it via ALTER TABLE — we define it inline here).
--   - pos_shifts is new (schema-consolidation-plan § 009 tasks).
--
-- RLS scope: all tables are location-scoped. Staff within the org's locations
-- can read/write their location's cash drawer data. Deletes are service_role only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CASH DRAWERS
-- Physical cash drawers, one per register/station per location.
-- ---------------------------------------------------------------------------

CREATE TABLE cash_drawers (
    id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name        text        NOT NULL,   -- e.g. "Front Register", "Bar"
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (location_id, name)
);

CREATE INDEX idx_cash_drawers_location ON cash_drawers(location_id);

DROP TRIGGER IF EXISTS trg_cash_drawers_updated_at ON cash_drawers;
CREATE TRIGGER trg_cash_drawers_updated_at
    BEFORE UPDATE ON cash_drawers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 2. CASH DRAWER SESSIONS
-- Open/close cycles. Only one open session per drawer enforced by partial index.
-- ---------------------------------------------------------------------------

CREATE TABLE cash_drawer_sessions (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    cash_drawer_id          uuid        NOT NULL REFERENCES cash_drawers(id) ON DELETE CASCADE,
    opened_by               uuid        REFERENCES staff(id) ON DELETE SET NULL,
    closed_by               uuid        REFERENCES staff(id) ON DELETE SET NULL,

    -- Amounts in cents
    opening_float_cents     bigint      NOT NULL DEFAULT 0 CHECK (opening_float_cents >= 0),
    declared_closing_cents  bigint,   -- set at close; null until then
    expected_closing_cents  bigint,   -- system-calculated; null until close
    over_short_cents        bigint,   -- declared - expected; can be negative

    -- Blind close: staff counts without seeing expected amount
    is_blind_close          boolean     NOT NULL DEFAULT false,

    status                  text        NOT NULL DEFAULT 'open'
                                        CHECK (status IN ('open', 'closed', 'reconciled')),

    opened_at               timestamptz NOT NULL DEFAULT timezone('utc', now()),
    closed_at               timestamptz,
    notes                   text,

    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Only one open session per drawer at a time
CREATE UNIQUE INDEX one_open_session_per_drawer
    ON cash_drawer_sessions(cash_drawer_id)
    WHERE status = 'open';

CREATE INDEX idx_cash_drawer_sessions_drawer_status ON cash_drawer_sessions(cash_drawer_id, status);
CREATE INDEX idx_cash_drawer_sessions_opened_at     ON cash_drawer_sessions(opened_at);

DROP TRIGGER IF EXISTS trg_cash_drawer_sessions_updated_at ON cash_drawer_sessions;
CREATE TRIGGER trg_cash_drawer_sessions_updated_at
    BEFORE UPDATE ON cash_drawer_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 3. CASH DRAWER MOVEMENTS
-- All cash in/out events during a session.
-- ---------------------------------------------------------------------------

CREATE TABLE cash_drawer_movements (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    cash_drawer_session_id  uuid        NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
    movement_type           text        NOT NULL
                                        CHECK (movement_type IN (
                                            'paid_in', 'paid_out', 'petty_cash',
                                            'tip_out', 'no_sale', 'drop', 'pickup'
                                        )),
    amount_cents            bigint      NOT NULL, -- positive=in, negative=out by convention
    reason                  text,

    -- Polymorphic reference (no FK — can point at various tables)
    reference_type          text,   -- e.g. 'order_payment', 'manual', 'change_fund'
    reference_id            uuid,

    performed_by            uuid        REFERENCES staff(id) ON DELETE SET NULL,
    approved_by             uuid        REFERENCES staff(id) ON DELETE SET NULL,

    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_cash_drawer_movements_session    ON cash_drawer_movements(cash_drawer_session_id);
CREATE INDEX idx_cash_drawer_movements_created_at ON cash_drawer_movements(created_at);

-- ---------------------------------------------------------------------------
-- 4. CASH DRAWER COUNTS
-- Denomination-level counts recorded at open, mid-shift, or close.
-- ---------------------------------------------------------------------------

CREATE TABLE cash_drawer_counts (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    cash_drawer_session_id  uuid        NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
    count_type              text        NOT NULL CHECK (count_type IN ('open', 'close', 'mid_shift')),
    total_cents             bigint      NOT NULL CHECK (total_cents >= 0),
    denominations           jsonb,  -- e.g. {"R200":2,"R100":5,"R50":3,...} — currency-agnostic
    counted_by              uuid        REFERENCES staff(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_cash_drawer_counts_session ON cash_drawer_counts(cash_drawer_session_id);

-- ---------------------------------------------------------------------------
-- 5. CASH DRAWER SESSION PAYMENTS
-- Links cash-type order_payments to the session in which they occurred.
-- Used to compute expected_closing_cents at close time.
-- ---------------------------------------------------------------------------

CREATE TABLE cash_drawer_session_payments (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    cash_drawer_session_id  uuid        NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
    payment_id              uuid        NOT NULL REFERENCES order_payments(id) ON DELETE CASCADE,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (payment_id)
);

CREATE INDEX idx_cash_drawer_session_payments_session ON cash_drawer_session_payments(cash_drawer_session_id);

-- ---------------------------------------------------------------------------
-- 6. ADJUSTMENT REASONS
-- Configurable reason codes per location for voids, comps, overrides.
-- ---------------------------------------------------------------------------

CREATE TABLE adjustment_reasons (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id                 uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    code                        text        NOT NULL, -- e.g. 'QUALITY', 'LONG_WAIT', 'STAFF_MEAL'
    label                       text        NOT NULL,
    adjustment_type             text        NOT NULL
                                            CHECK (adjustment_type IN (
                                                'void', 'comp', 'price_override',
                                                'manager_discount', 'refund'
                                            )),
    requires_manager_approval   boolean     NOT NULL DEFAULT true,
    is_active                   boolean     NOT NULL DEFAULT true,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (location_id, code)
);

CREATE INDEX idx_adjustment_reasons_location ON adjustment_reasons(location_id);

DROP TRIGGER IF EXISTS trg_adjustment_reasons_updated_at ON adjustment_reasons;
CREATE TRIGGER trg_adjustment_reasons_updated_at
    BEFORE UPDATE ON adjustment_reasons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 7. ORDER ADJUSTMENTS
-- Auditable record of every void/comp/price-override/manager-discount/refund.
-- adjustment_type CHECK includes 'refund' per legacy 31 follow-up note.
-- ---------------------------------------------------------------------------

CREATE TABLE order_adjustments (
    id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id            uuid        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id       uuid        REFERENCES order_items(id) ON DELETE CASCADE, -- NULL = order-level
    adjustment_type     text        NOT NULL
                                    CHECK (adjustment_type IN (
                                        'void', 'comp', 'price_override',
                                        'manager_discount', 'refund'
                                    )),

    reason_id           uuid        REFERENCES adjustment_reasons(id) ON DELETE SET NULL,
    reason_text         text,   -- free-form override

    -- amount_cents is always positive; meaning depends on adjustment_type.
    amount_cents        bigint      NOT NULL,
    original_amount_cents bigint,  -- pre-adjustment value (for price_override: original unit_price * qty)

    applied_by          uuid        REFERENCES staff(id) ON DELETE SET NULL,
    approved_by         uuid        REFERENCES staff(id) ON DELETE SET NULL,

    -- If reason requires_manager_approval=true, approved_by SHOULD be NOT NULL when
    -- approval_status='approved'. Enforced at the application layer.
    approval_status     text        NOT NULL DEFAULT 'approved'
                                    CHECK (approval_status IN ('pending', 'approved', 'rejected')),

    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_order_adjustments_order      ON order_adjustments(order_id);
CREATE INDEX idx_order_adjustments_order_item ON order_adjustments(order_item_id);
CREATE INDEX idx_order_adjustments_applied_by ON order_adjustments(applied_by);
CREATE INDEX idx_order_adjustments_created_at ON order_adjustments(created_at);

-- ---------------------------------------------------------------------------
-- 8. POS SHIFTS  [NEW]
-- Tracks a member's POS session: which drawer they opened, when, status.
-- Links to cash_drawer_sessions for the float; opened_by is an org_member.
-- ---------------------------------------------------------------------------

CREATE TABLE pos_shifts (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id                 uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    cash_drawer_id              uuid        REFERENCES cash_drawers(id) ON DELETE SET NULL,
    cash_drawer_session_id      uuid        REFERENCES cash_drawer_sessions(id) ON DELETE SET NULL,
    opened_by                   uuid        REFERENCES staff(id) ON DELETE SET NULL,
    opened_at                   timestamptz NOT NULL DEFAULT timezone('utc', now()),
    closed_at                   timestamptz,
    status                      text        NOT NULL DEFAULT 'open'
                                            CHECK (status IN ('open', 'closed')),
    notes                       text,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- One open shift per location per opener at a time
CREATE UNIQUE INDEX one_open_pos_shift_per_opener
    ON pos_shifts(location_id, opened_by)
    WHERE status = 'open' AND opened_by IS NOT NULL;

CREATE INDEX idx_pos_shifts_location ON pos_shifts(location_id);
CREATE INDEX idx_pos_shifts_opened_by ON pos_shifts(opened_by) WHERE opened_by IS NOT NULL;

DROP TRIGGER IF EXISTS trg_pos_shifts_updated_at ON pos_shifts;
CREATE TRIGGER trg_pos_shifts_updated_at
    BEFORE UPDATE ON pos_shifts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY — location-scoped for all tables
-- Threat model: a tenant must never see another tenant's cash data.
-- Service_role bypasses via explicit OR clause.
-- ---------------------------------------------------------------------------

-- Helper view to resolve location_id for session/movement/count/payment tables
-- (these have a chain: movement→session→drawer→location).
-- We resolve the chain inline in each policy for clarity.

-- 9.1 cash_drawers -------------------------------------------------------
ALTER TABLE cash_drawers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawers FORCE ROW LEVEL SECURITY;

CREATE POLICY cash_drawers_select ON cash_drawers FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY cash_drawers_insert ON cash_drawers FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY cash_drawers_update ON cash_drawers FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY cash_drawers_delete ON cash_drawers FOR DELETE
    USING (is_service_role());

-- 9.2 cash_drawer_sessions -----------------------------------------------
ALTER TABLE cash_drawer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawer_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY cash_drawer_sessions_select ON cash_drawer_sessions FOR SELECT
    USING (
        cash_drawer_id IN (
            SELECT cd.id FROM cash_drawers cd
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_sessions_insert ON cash_drawer_sessions FOR INSERT
    WITH CHECK (
        cash_drawer_id IN (
            SELECT cd.id FROM cash_drawers cd
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_sessions_update ON cash_drawer_sessions FOR UPDATE
    USING (
        cash_drawer_id IN (
            SELECT cd.id FROM cash_drawers cd
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        cash_drawer_id IN (
            SELECT cd.id FROM cash_drawers cd
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_sessions_delete ON cash_drawer_sessions FOR DELETE
    USING (is_service_role());

-- 9.3 cash_drawer_movements ----------------------------------------------
ALTER TABLE cash_drawer_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawer_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY cash_drawer_movements_select ON cash_drawer_movements FOR SELECT
    USING (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_movements_insert ON cash_drawer_movements FOR INSERT
    WITH CHECK (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_movements_update ON cash_drawer_movements FOR UPDATE
    USING (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_movements_delete ON cash_drawer_movements FOR DELETE
    USING (is_service_role());

-- 9.4 cash_drawer_counts -------------------------------------------------
ALTER TABLE cash_drawer_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawer_counts FORCE ROW LEVEL SECURITY;

CREATE POLICY cash_drawer_counts_select ON cash_drawer_counts FOR SELECT
    USING (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_counts_insert ON cash_drawer_counts FOR INSERT
    WITH CHECK (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_counts_update ON cash_drawer_counts FOR UPDATE
    USING (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_counts_delete ON cash_drawer_counts FOR DELETE
    USING (is_service_role());

-- 9.5 cash_drawer_session_payments ---------------------------------------
ALTER TABLE cash_drawer_session_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_drawer_session_payments FORCE ROW LEVEL SECURITY;

CREATE POLICY cash_drawer_session_payments_select ON cash_drawer_session_payments FOR SELECT
    USING (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_session_payments_insert ON cash_drawer_session_payments FOR INSERT
    WITH CHECK (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_session_payments_update ON cash_drawer_session_payments FOR UPDATE
    USING (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        cash_drawer_session_id IN (
            SELECT cds.id FROM cash_drawer_sessions cds
            JOIN cash_drawers cd ON cd.id = cds.cash_drawer_id
            JOIN locations l ON l.id = cd.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY cash_drawer_session_payments_delete ON cash_drawer_session_payments FOR DELETE
    USING (is_service_role());

-- 9.6 adjustment_reasons -------------------------------------------------
ALTER TABLE adjustment_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_reasons FORCE ROW LEVEL SECURITY;

CREATE POLICY adjustment_reasons_select ON adjustment_reasons FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY adjustment_reasons_insert ON adjustment_reasons FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY adjustment_reasons_update ON adjustment_reasons FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY adjustment_reasons_delete ON adjustment_reasons FOR DELETE
    USING (is_service_role());

-- 9.7 order_adjustments --------------------------------------------------
-- Scoped via the order's location (orders.location_id → locations.organization_id)
ALTER TABLE order_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_adjustments FORCE ROW LEVEL SECURITY;

CREATE POLICY order_adjustments_select ON order_adjustments FOR SELECT
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY order_adjustments_insert ON order_adjustments FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY order_adjustments_update ON order_adjustments FOR UPDATE
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
CREATE POLICY order_adjustments_delete ON order_adjustments FOR DELETE
    USING (is_service_role());

-- 9.8 pos_shifts ---------------------------------------------------------
ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_shifts FORCE ROW LEVEL SECURITY;

CREATE POLICY pos_shifts_select ON pos_shifts FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY pos_shifts_insert ON pos_shifts FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY pos_shifts_update ON pos_shifts FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY pos_shifts_delete ON pos_shifts FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Tables: cash_drawers, cash_drawer_sessions, cash_drawer_movements,
--         cash_drawer_counts, cash_drawer_session_payments,
--         adjustment_reasons, order_adjustments, pos_shifts  (8 total)
