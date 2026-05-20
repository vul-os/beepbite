-- =============================================================================
-- MIGRATION 012 — SHIFTS, PAYROLL, TIPPING
-- =============================================================================
-- Sources: legacy 32 (tip_pooling), tasks.md 012 (payroll_periods [NEW]).
--
-- Tables defined here:
--   tip_pools                — tipping pool definitions per location/org
--   tip_pool_contributions   — order-payment-level contributions into a pool
--   tip_distributions        — per-staff disbursements from a pool
--   payroll_periods [NEW]    — payroll period aggregates per org/location
--
-- Note on staff tables:
--   staff, staff_shifts, staff_time_entries, staff_pay_rates are defined in
--   migration 003 (staff_and_pin.sql). This migration references them via FK
--   but does NOT redefine them. Labor cost reporting views belong to 014.
--
-- RLS strategy:
--   tip_pools, tip_pool_contributions, tip_distributions, payroll_periods:
--     location-scoped (joined through locations → organization_id).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. tip_pools
-- ---------------------------------------------------------------------------

CREATE TABLE tip_pools (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id         uuid            REFERENCES locations(id) ON DELETE SET NULL,
    name                text            NOT NULL,
    rule_type           text            NOT NULL CHECK (rule_type IN (
                                          'equal_split',
                                          'hours_weighted',
                                          'points_weighted',
                                          'role_weighted'
                                        )),
    -- rule_type-specific config:
    --   equal_split:      {} (no config needed)
    --   hours_weighted:   {} (hours from tip_distributions.hours_worked)
    --   points_weighted:  {"server_pts":3,"runner_pts":2,"busser_pts":1}
    --   role_weighted:    {"server":3,"runner":2,"busser":1}
    config              jsonb           NOT NULL DEFAULT '{}',
    shift_date          date,           -- NULL = ongoing pool (not tied to a single shift date)
    is_active           boolean         NOT NULL DEFAULT true,
    created_at          timestamptz     NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz     NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_tip_pools_org         ON tip_pools(organization_id);
CREATE INDEX idx_tip_pools_location    ON tip_pools(location_id) WHERE is_active = true;
CREATE INDEX idx_tip_pools_shift_date  ON tip_pools(location_id, shift_date) WHERE shift_date IS NOT NULL;

CREATE TRIGGER trg_tip_pools_updated_at
    BEFORE UPDATE ON tip_pools
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

COMMENT ON TABLE tip_pools IS
    'Tipping pool definitions. Each pool collects tip contributions from one or '
    'more order payments and distributes them to staff according to rule_type. '
    'shift_date is nullable: NULL = rolling pool not tied to a single date.';

-- RLS
ALTER TABLE tip_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_pools FORCE ROW LEVEL SECURITY;

-- Tenant sees their own org's pools; service bypasses.
CREATE POLICY tip_pools_select ON tip_pools FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());

CREATE POLICY tip_pools_insert ON tip_pools FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

CREATE POLICY tip_pools_update ON tip_pools FOR UPDATE
    USING   (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());

-- Deletes locked to service_role; handlers should soft-delete via is_active=false.
CREATE POLICY tip_pools_delete ON tip_pools FOR DELETE
    USING (is_service_role());


-- ---------------------------------------------------------------------------
-- 2. tip_pool_contributions
-- ---------------------------------------------------------------------------

CREATE TABLE tip_pool_contributions (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    tip_pool_id         uuid        NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
    order_payment_id    uuid        REFERENCES order_payments(id) ON DELETE SET NULL,
    amount_cents        bigint      NOT NULL CHECK (amount_cents >= 0),
    contributed_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_tip_contributions_pool
    ON tip_pool_contributions(tip_pool_id, contributed_at DESC);
CREATE INDEX idx_tip_contributions_payment
    ON tip_pool_contributions(order_payment_id) WHERE order_payment_id IS NOT NULL;

COMMENT ON TABLE tip_pool_contributions IS
    'Individual tip amounts flowing into a pool from an order payment. '
    'amount_cents must be >= 0; negative adjustments are not supported here '
    '(reduce contributions by voiding the source order_payment).';

-- RLS — scoped via tip_pool → tip_pools → organization_id
ALTER TABLE tip_pool_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_pool_contributions FORCE ROW LEVEL SECURITY;

CREATE POLICY tip_pool_contributions_select ON tip_pool_contributions FOR SELECT
    USING (
        tip_pool_id IN (
            SELECT id FROM tip_pools WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY tip_pool_contributions_insert ON tip_pool_contributions FOR INSERT
    WITH CHECK (
        tip_pool_id IN (
            SELECT id FROM tip_pools WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY tip_pool_contributions_update ON tip_pool_contributions FOR UPDATE
    USING (
        tip_pool_id IN (
            SELECT id FROM tip_pools WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        tip_pool_id IN (
            SELECT id FROM tip_pools WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY tip_pool_contributions_delete ON tip_pool_contributions FOR DELETE
    USING (is_service_role());


-- ---------------------------------------------------------------------------
-- 3. tip_distributions
-- ---------------------------------------------------------------------------

CREATE TABLE tip_distributions (
    id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    tip_pool_id             uuid            NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
    staff_id                uuid            NOT NULL REFERENCES staff(id) ON DELETE RESTRICT,
    amount_cents            bigint          NOT NULL CHECK (amount_cents >= 0),
    hours_worked            numeric(8, 2),  -- populated for hours_weighted pools
    weight_points           numeric(8, 2),  -- populated for points_weighted pools
    distributed_at          timestamptz     NOT NULL DEFAULT timezone('utc', now()),
    payroll_exported_at     timestamptz     -- set when this row is included in a payroll export
);

CREATE INDEX idx_tip_distributions_pool
    ON tip_distributions(tip_pool_id, distributed_at DESC);
CREATE INDEX idx_tip_distributions_staff
    ON tip_distributions(staff_id, distributed_at DESC);
CREATE INDEX idx_tip_distributions_unexported
    ON tip_distributions(staff_id) WHERE payroll_exported_at IS NULL;

COMMENT ON TABLE tip_distributions IS
    'Per-staff disbursements from a tip pool. payroll_exported_at is set by the '
    'payroll export job once the row is included in an exported payroll_period.';

-- RLS — scoped via tip_pool → tip_pools → organization_id
ALTER TABLE tip_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tip_distributions FORCE ROW LEVEL SECURITY;

CREATE POLICY tip_distributions_select ON tip_distributions FOR SELECT
    USING (
        tip_pool_id IN (
            SELECT id FROM tip_pools WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY tip_distributions_insert ON tip_distributions FOR INSERT
    WITH CHECK (
        tip_pool_id IN (
            SELECT id FROM tip_pools WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY tip_distributions_update ON tip_distributions FOR UPDATE
    USING (
        tip_pool_id IN (
            SELECT id FROM tip_pools WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        tip_pool_id IN (
            SELECT id FROM tip_pools WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );

CREATE POLICY tip_distributions_delete ON tip_distributions FOR DELETE
    USING (is_service_role());


-- ---------------------------------------------------------------------------
-- 4. payroll_periods [NEW] (tasks.md 012)
-- ---------------------------------------------------------------------------
-- Payroll-period aggregate: records the exported state of a payroll run for
-- one org (optionally one location). The totals_jsonb column holds a snapshot
-- of computed aggregates (total_hours, total_labor_cost_cents, etc.) as
-- produced by the payroll export job — this avoids re-querying historical
-- time-entry data after the period is closed.
-- ---------------------------------------------------------------------------

CREATE TABLE payroll_periods (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id     uuid        REFERENCES locations(id) ON DELETE SET NULL,
    period_start    date        NOT NULL,
    period_end      date        NOT NULL,
    status          text        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'processing', 'exported', 'voided')),
    -- Computed snapshot written by the export job. Keys:
    --   total_hours_worked      numeric   (sum of worked_minutes / 60 across the period)
    --   total_labor_cost_cents  bigint    (sum of shift_cost_cents from labor_cost_daily)
    --   staff_count             int       (distinct staff with at least one time entry)
    --   tip_distributions_cents bigint    (sum of tip_distributions.amount_cents in the period)
    totals_jsonb    jsonb       NOT NULL DEFAULT '{}',
    exported_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),

    CONSTRAINT payroll_periods_dates_check CHECK (period_end >= period_start)
);

CREATE INDEX idx_payroll_periods_org          ON payroll_periods(org_id, period_start DESC);
CREATE INDEX idx_payroll_periods_location     ON payroll_periods(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX idx_payroll_periods_status       ON payroll_periods(org_id, status) WHERE status NOT IN ('exported', 'voided');
-- Prevent overlapping periods for the same org+location combination.
-- Enforced in application layer with an exclusion constraint that requires
-- btree_gist; this plain index supports the lookup.
CREATE UNIQUE INDEX idx_payroll_periods_no_overlap_org
    ON payroll_periods(org_id, period_start, period_end) WHERE location_id IS NULL;
CREATE UNIQUE INDEX idx_payroll_periods_no_overlap_location
    ON payroll_periods(org_id, location_id, period_start, period_end) WHERE location_id IS NOT NULL;

COMMENT ON TABLE payroll_periods IS
    '[NEW] Payroll period aggregate: one row per exported payroll run for an '
    'org (optionally a specific location). The totals_jsonb snapshot is written '
    'once by the export job and treated as immutable after status=exported.';

-- RLS — org-scoped
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods FORCE ROW LEVEL SECURITY;

CREATE POLICY payroll_periods_select ON payroll_periods FOR SELECT
    USING (org_id = current_org_id() OR is_service_role());

CREATE POLICY payroll_periods_insert ON payroll_periods FOR INSERT
    WITH CHECK (org_id = current_org_id() OR is_service_role());

CREATE POLICY payroll_periods_update ON payroll_periods FOR UPDATE
    USING   (org_id = current_org_id() OR is_service_role())
    WITH CHECK (org_id = current_org_id() OR is_service_role());

-- Period rows are auditable; hard deletes locked to service_role.
CREATE POLICY payroll_periods_delete ON payroll_periods FOR DELETE
    USING (is_service_role());


-- ---------------------------------------------------------------------------
-- GRANTS
-- ---------------------------------------------------------------------------
-- service_role already has ALL via default privileges set in 001.
-- Authenticated app connections (no custom role in v1) need SELECT/INSERT/UPDATE.
-- DELETE is intentionally withheld from PUBLIC — soft-delete via status='voided'.
GRANT SELECT, INSERT, UPDATE ON tip_pools              TO PUBLIC;
GRANT SELECT, INSERT, UPDATE ON tip_pool_contributions TO PUBLIC;
GRANT SELECT, INSERT, UPDATE ON tip_distributions      TO PUBLIC;
GRANT SELECT, INSERT, UPDATE ON payroll_periods        TO PUBLIC;

-- ---------------------------------------------------------------------------
-- DONE — Migration 012
-- Tables: tip_pools, tip_pool_contributions, tip_distributions, payroll_periods
-- ---------------------------------------------------------------------------
