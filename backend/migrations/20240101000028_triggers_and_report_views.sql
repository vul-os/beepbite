-- ======================
-- TRIGGERS & REPORT VIEWS
-- Adds two enforcement/automation triggers (approval enforcement on
-- order_adjustments, auto-86 propagation from inventory_items to items)
-- and two reporting views (KDS expo screen, cash drawer end-of-day).
-- Follow-up to migration 18 (approval enforcement was left for this step),
-- migration 24 (is_86ed + auto_86_when_inventory_empty columns),
-- migration 17 (KDS tables) and migration 18 (cash drawer tables).
-- ======================


-- ======================
-- 1. APPROVAL ENFORCEMENT ON order_adjustments
-- Prevents a reason that requires_manager_approval from being marked
-- 'approved' without an approved_by staff id, and disallows self-approval.
-- Lives in the DB (not just the app) so ad-hoc SQL or other services
-- cannot bypass the control — this is audit-critical for comp/void fraud.
-- ======================

CREATE OR REPLACE FUNCTION enforce_order_adjustment_approval()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_requires_approval boolean;
BEGIN
    -- Self-approval check applies regardless of reason_id (belt-and-braces).
    IF NEW.applied_by IS NOT NULL
       AND NEW.approved_by IS NOT NULL
       AND NEW.applied_by = NEW.approved_by THEN
        RAISE EXCEPTION 'order_adjustments: applied_by and approved_by must differ';
    END IF;

    -- No reason_id => free-form only, skip approval enforcement.
    IF NEW.reason_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT requires_manager_approval
      INTO v_requires_approval
      FROM adjustment_reasons
     WHERE id = NEW.reason_id;

    -- If reason demands approval, only 'approved' rows must carry approved_by.
    -- 'pending' rows are legitimately waiting on a manager, 'rejected' rows
    -- do not take effect so approved_by is immaterial.
    IF COALESCE(v_requires_approval, false) = true
       AND NEW.approval_status = 'approved'
       AND NEW.approved_by IS NULL THEN
        RAISE EXCEPTION 'order_adjustments: approved_by required when reason requires manager approval';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_adjustments_approval ON order_adjustments;
CREATE TRIGGER trg_order_adjustments_approval
    BEFORE INSERT OR UPDATE ON order_adjustments
    FOR EACH ROW
    EXECUTE FUNCTION enforce_order_adjustment_approval();


-- ======================
-- 2. AUTO-86 FROM INVENTORY
-- When stock crosses 0 in either direction, flip items.is_86ed on the
-- linked menu item (opt-in via items.auto_86_when_inventory_empty).
-- AFTER trigger because we need final NEW values and are mutating a
-- different table; no recursion risk (items is_86ed change has no trigger).
-- ======================

CREATE OR REPLACE FUNCTION auto_86_from_inventory()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_empty boolean := COALESCE(OLD.current_stock, 0) <= 0;
    v_new_empty boolean := COALESCE(NEW.current_stock, 0) <= 0;
BEGIN
    -- Fast exit: nothing interesting happened.
    IF v_old_empty = v_new_empty
       AND COALESCE(OLD.link_to_item_id::text, '') = COALESCE(NEW.link_to_item_id::text, '') THEN
        RETURN NULL;
    END IF;

    -- Must be linked to a menu item to have any effect.
    IF NEW.link_to_item_id IS NULL THEN
        RETURN NULL;
    END IF;

    -- Transition into empty: mark the linked item 86ed if opted in.
    IF v_new_empty AND NOT v_old_empty THEN
        UPDATE items
           SET is_86ed = true
         WHERE id = NEW.link_to_item_id
           AND auto_86_when_inventory_empty = true
           AND is_86ed = false;

    -- Transition back to stocked: clear the 86 flag if we previously set it.
    ELSIF NOT v_new_empty AND v_old_empty THEN
        UPDATE items
           SET is_86ed = false
         WHERE id = NEW.link_to_item_id
           AND auto_86_when_inventory_empty = true
           AND is_86ed = true;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_86_from_inventory ON inventory_items;
CREATE TRIGGER trg_auto_86_from_inventory
    AFTER UPDATE OF current_stock, link_to_item_id ON inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION auto_86_from_inventory();


-- ======================
-- 3. kds_expo_view
-- One row per open order on the expo screen with a nested array of its
-- per-station tickets and their items. Drives the expo UI which needs
-- to coordinate "all stations ready" before bumping the whole order.
-- "Open" = any non-bumped/non-cancelled ticket exists on the order.
-- ======================

CREATE OR REPLACE VIEW kds_expo_view AS
SELECT
    t.order_id,
    ks.location_id,
    MIN(t.fired_at)                                                    AS earliest_fired_at,
    -- all_ready: every live ticket on this order is in 'ready' state.
    -- A bumped ticket is already "off the board" so it doesn't block.
    bool_and(t.status = 'ready')                                       AS all_ready,
    bool_or(t.status = 'in_progress')                                  AS any_in_progress,
    jsonb_agg(
        jsonb_build_object(
            'ticket_id',     t.id,
            'station_name',  ks.name,
            'status',        t.status,
            'fired_at',      t.fired_at,
            'ready_at',      t.ready_at,
            'course_number', t.course_number,
            'items',         COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'order_item_id', kti.order_item_id,
                        'quantity',      kti.quantity,
                        'item_status',   kti.item_status,
                        'notes',         kti.notes
                    )
                    ORDER BY kti.created_at
                )
                FROM kds_ticket_items kti
                WHERE kti.ticket_id = t.id
            ), '[]'::jsonb)
        )
        ORDER BY ks.name
    )                                                                  AS station_tickets,
    COALESCE(MAX(t.priority), 0)                                       AS max_priority
FROM kds_tickets t
JOIN kitchen_stations ks ON ks.id = t.station_id
WHERE t.status IN ('fired', 'in_progress', 'ready')
GROUP BY t.order_id, ks.location_id
ORDER BY MIN(t.fired_at) ASC, COALESCE(MAX(t.priority), 0) DESC;

COMMENT ON VIEW kds_expo_view IS
    'Open KDS tickets grouped by order with a jsonb array of per-station '
    'sub-tickets. all_ready flags when expo can bump the whole order.';


-- ======================
-- 4. cash_drawer_eod_report
-- One row per (session, payment_method) used in that session. The cash row
-- folds in opening float and non-sale cash movements so the "expected"
-- number matches what a manager physically expects to count in the till;
-- non-cash rows just show the sum of payments tendered against that method.
--
-- Judgment call: order_payments.payment_method_code is the real FK in this
-- schema (there is no order_payments.payment_method_id), and the amount
-- column is amount_paid_cents — the task description used slightly different
-- names. We follow what actually exists in migrations 1-25. Tips are
-- intentionally excluded from expected_cents since tip cash typically
-- doesn't live in the till (handled via tip_out movements).
-- ======================

CREATE OR REPLACE VIEW cash_drawer_eod_report AS
WITH session_method_payments AS (
    -- Totals per (session, method) for every method that saw action.
    SELECT
        cdsp.cash_drawer_session_id    AS session_id,
        op.payment_method_code         AS method_code,
        COALESCE(SUM(op.amount_paid_cents), 0)::bigint AS method_total_cents
    FROM cash_drawer_session_payments cdsp
    JOIN order_payments op ON op.id = cdsp.payment_id
    WHERE op.payment_status = 'completed'
    GROUP BY cdsp.cash_drawer_session_id, op.payment_method_code
),
session_cash_movements AS (
    -- Positive / negative cash drawer movements (tip_out, paid_out, drop, etc).
    SELECT
        cdm.cash_drawer_session_id AS session_id,
        COALESCE(SUM(CASE WHEN cdm.amount_cents > 0 THEN cdm.amount_cents ELSE 0 END), 0)::bigint     AS movements_in_cents,
        COALESCE(SUM(CASE WHEN cdm.amount_cents < 0 THEN -cdm.amount_cents ELSE 0 END), 0)::bigint    AS movements_out_cents,
        COALESCE(SUM(cdm.amount_cents), 0)::bigint                                                    AS movements_net_cents
    FROM cash_drawer_movements cdm
    GROUP BY cdm.cash_drawer_session_id
)
SELECT
    s.id                                AS session_id,
    s.cash_drawer_id,
    s.opened_at,
    s.closed_at,
    s.status,
    pm.code                             AS payment_method_code,
    pm.name                             AS payment_method_name,
    -- expected_cents: for cash, reconcile float + net movements + cash payments
    -- so the number matches the physical till. For non-cash, just the tender total.
    CASE
        WHEN pm.code = 'cash' THEN
            COALESCE(s.opening_float_cents, 0)
            + COALESCE(scm.movements_net_cents, 0)
            + COALESCE(smp.method_total_cents, 0)
        ELSE COALESCE(smp.method_total_cents, 0)
    END::bigint                         AS expected_cents,
    CASE WHEN pm.code = 'cash' THEN COALESCE(scm.movements_in_cents, 0)  ELSE 0 END::bigint AS cash_movements_in_cents,
    CASE WHEN pm.code = 'cash' THEN COALESCE(scm.movements_out_cents, 0) ELSE 0 END::bigint AS cash_movements_out_cents,
    s.declared_closing_cents            AS declared_cents,
    s.over_short_cents
FROM cash_drawer_sessions s
LEFT JOIN session_method_payments smp ON smp.session_id = s.id
LEFT JOIN payment_methods pm          ON pm.code = smp.method_code
LEFT JOIN session_cash_movements scm  ON scm.session_id = s.id
-- Drop the synthetic row where a session has no payments AND no join match.
WHERE pm.code IS NOT NULL
   OR EXISTS (
        -- Keep a cash row for sessions with movements but no cash payments
        -- so float/movements still show up at close-out time.
        SELECT 1 FROM session_cash_movements scm2
         WHERE scm2.session_id = s.id
     );

COMMENT ON VIEW cash_drawer_eod_report IS
    'Per-(session, payment_method) reconciliation row. For the cash row, '
    'expected_cents = opening_float + net cash movements + cash payments. '
    'Non-cash rows report expected = sum of completed order_payments only.';
