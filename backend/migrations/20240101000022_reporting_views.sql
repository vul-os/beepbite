-- ======================
-- REPORTING VIEWS
-- Consumed by the frontend analytics dashboard. Add new views below and bump
-- the migration, don't modify in place (views dropped via CREATE OR REPLACE
-- only work when column list doesn't change).
-- ======================

-- TODO: labor_hours_daily currently exposes hours only. Labor cost in currency
-- requires a `staff_pay_rates` table (hourly_rate_cents, effective_from,
-- effective_until) which is on the roadmap but not yet built. Once available,
-- add a labor_cost_daily view that joins the clock pairs to the rate active on
-- work_date.

-- Convention: all views are SECURITY INVOKER (the default). No RLS.
-- Dates in UTC for cross-location consistency; per-location timezone handling
-- is a follow-up once `locations.timezone` lands.


-- ======================
-- 1. daily_sales_summary
-- One row per (location_id, sale_date, order_type).
-- Uses order_financial_details for the money columns (decimal(10,2), NOT cents).
-- tip is read from order_payments.tip_amount_cents — that table stores CENTS
-- (bigint), so we divide by 100 and cast to numeric to keep the unit aligned
-- with the rest of this view. Unit mismatch noted here intentionally.
-- ======================
CREATE VIEW daily_sales_summary AS
SELECT
    o.location_id,
    (date(o.created_at AT TIME ZONE 'UTC'))::date AS sale_date,
    o.order_type,
    COUNT(DISTINCT o.id)                                    AS order_count,
    COALESCE(SUM(ofd.subtotal), 0)::decimal(14,2)           AS gross_sales_subtotal,
    COALESCE(SUM(ofd.tax_amount), 0)::decimal(14,2)         AS tax_total,
    COALESCE(SUM(ofd.discount_amount), 0)::decimal(14,2)    AS discount_total,
    -- tip_amount_cents is bigint cents; convert to numeric here (unit mismatch note above)
    (COALESCE(SUM(tp.tip_cents), 0)::numeric / 100)::decimal(14,2) AS tip_total,
    COALESCE(SUM(ofd.delivery_fee), 0)::decimal(14,2)       AS delivery_fee_total,
    COALESCE(SUM(ofd.total_amount - COALESCE(ofd.tax_amount, 0) - COALESCE(ofd.delivery_fee, 0)), 0)::decimal(14,2) AS net_sales,
    COALESCE(SUM(ofd.total_cost), 0)::decimal(14,2)         AS total_cost,
    COALESCE(SUM(ofd.profit_amount), 0)::decimal(14,2)      AS total_profit,
    CASE
        WHEN COALESCE(SUM(ofd.total_amount), 0) = 0 THEN 0
        ELSE ROUND(
            (COALESCE(SUM(ofd.profit_amount), 0) / NULLIF(SUM(ofd.total_amount), 0)) * 100,
            2
        )
    END                                                      AS profit_margin_pct
FROM orders o
LEFT JOIN order_financial_details ofd ON ofd.order_id = o.id
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(op.tip_amount_cents), 0) AS tip_cents
    FROM order_payments op
    WHERE op.order_id = o.id
      AND op.payment_status = 'completed'
) tp ON TRUE
WHERE o.status <> 'cancelled'
GROUP BY
    o.location_id,
    (date(o.created_at AT TIME ZONE 'UTC'))::date,
    o.order_type;

COMMENT ON VIEW daily_sales_summary IS
    'Daily sales rollup per (location, order_type). Money columns come from '
    'order_financial_details (decimal). tip_total is derived from '
    'order_payments.tip_amount_cents (bigint cents) divided by 100 — unit '
    'conversion is intentional.';


-- ======================
-- 2. hourly_sales_heatmap
-- Trailing 90-day heatmap by ISO dow (1=Mon..7=Sun) and hour_of_day (0..23).
-- ======================
CREATE VIEW hourly_sales_heatmap AS
SELECT
    o.location_id,
    EXTRACT(isodow FROM o.created_at AT TIME ZONE 'UTC')::int AS day_of_week,
    EXTRACT(hour   FROM o.created_at AT TIME ZONE 'UTC')::int AS hour_of_day,
    COUNT(DISTINCT o.id)                                       AS order_count,
    COALESCE(SUM(ofd.total_amount), 0)::decimal(14,2)          AS total_revenue,
    CASE
        WHEN COUNT(DISTINCT o.id) = 0 THEN 0
        ELSE ROUND(COALESCE(SUM(ofd.total_amount), 0) / COUNT(DISTINCT o.id), 2)
    END                                                        AS avg_ticket
FROM orders o
LEFT JOIN order_financial_details ofd ON ofd.order_id = o.id
WHERE o.status <> 'cancelled'
  AND o.created_at >= now() - interval '90 days'
GROUP BY
    o.location_id,
    EXTRACT(isodow FROM o.created_at AT TIME ZONE 'UTC'),
    EXTRACT(hour   FROM o.created_at AT TIME ZONE 'UTC');

COMMENT ON VIEW hourly_sales_heatmap IS
    'Trailing 90-day heatmap: orders and revenue bucketed by ISO day-of-week '
    '(1=Mon..7=Sun) and hour-of-day (0..23), per location.';


-- ======================
-- 3. menu_engineering
-- Classic four-box menu analysis over the trailing 30 days.
--   - popularity = PERCENT_RANK over units_sold within location
--   - margin     = PERCENT_RANK over margin_per_unit within location
--   - classification thresholds: 0.5
--        both >= 0.5         => 'star'
--        popularity >= 0.5   => 'plowhorse' (popular, low margin)
--        margin >= 0.5       => 'puzzle'    (high margin, unpopular)
--        else                => 'dog'
-- Cost: order_items does not capture per-line cost; we fall back to
-- items.cost_price * units_sold. A future migration should snapshot cost on
-- the order_item at sale time for true historical COGS.
-- ======================
CREATE VIEW menu_engineering AS
WITH item_sales AS (
    SELECT
        o.location_id,
        oi.item_id,
        i.name                              AS item_name,
        i.category_id,
        c.name                              AS category_name,
        i.cost_price                        AS cost_price,
        SUM(oi.quantity)::bigint            AS units_sold,
        SUM(oi.total_price)::decimal(14,2)  AS revenue,
        (SUM(oi.quantity) * COALESCE(i.cost_price, 0))::decimal(14,2) AS cost
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN items i        ON i.id        = oi.item_id
    LEFT JOIN categories c ON c.id     = i.category_id
    WHERE o.status <> 'cancelled'
      AND o.created_at >= now() - interval '30 days'
    GROUP BY
        o.location_id, oi.item_id, i.name, i.category_id, c.name, i.cost_price
),
scored AS (
    SELECT
        s.*,
        (s.revenue - s.cost)::decimal(14,2) AS margin,
        CASE
            WHEN s.units_sold = 0 THEN 0
            ELSE ((s.revenue - s.cost) / s.units_sold)::decimal(14,4)
        END AS margin_per_unit,
        PERCENT_RANK() OVER (
            PARTITION BY s.location_id
            ORDER BY s.units_sold
        ) AS popularity_score,
        PERCENT_RANK() OVER (
            PARTITION BY s.location_id
            ORDER BY CASE WHEN s.units_sold = 0 THEN 0
                          ELSE (s.revenue - s.cost) / s.units_sold
                     END
        ) AS margin_score
    FROM item_sales s
)
SELECT
    location_id,
    item_id,
    item_name,
    category_id,
    category_name,
    units_sold,
    revenue,
    cost,
    margin,
    margin_per_unit,
    popularity_score,
    margin_score,
    CASE
        WHEN popularity_score >= 0.5 AND margin_score >= 0.5 THEN 'star'
        WHEN popularity_score >= 0.5 AND margin_score <  0.5 THEN 'plowhorse'
        WHEN popularity_score <  0.5 AND margin_score >= 0.5 THEN 'puzzle'
        ELSE 'dog'
    END AS classification
FROM scored;

COMMENT ON VIEW menu_engineering IS
    'Trailing 30-day menu engineering (Kasavana & Smith four-box). Cost is '
    'approximated as units_sold * items.cost_price since order_items does not '
    'snapshot cost at sale time. Classification thresholds at the 50th '
    'percentile within each location.';


-- ======================
-- 4. labor_hours_daily
-- Pairs clock_in -> next clock_out per staff per UTC work_date and subtracts
-- paired break_start -> break_end intervals that fall within the shift.
--
-- Edge cases:
--   - Forgotten clock-outs produce NULL clock_out_at and NULL worked_minutes.
--   - Shifts crossing midnight are attributed to the clock_in's UTC date.
--   - Orphan break_end without break_start (or vice versa) is ignored.
--   - Multiple clock_in/clock_out cycles on the same date produce multiple
--     rows (the view is per-cycle, not strictly per-day).
-- This is deliberately a "best effort" pairing; an upstream reconciliation
-- job should emit a cleaner staff_attendance_summary row once rates exist.
-- ======================
CREATE VIEW labor_hours_daily AS
WITH ordered AS (
    -- Each entry with a running sequence per staff
    SELECT
        ste.id,
        ste.staff_id,
        ste.location_id,
        ste.entry_type,
        ste.timestamp,
        ROW_NUMBER() OVER (PARTITION BY ste.staff_id, ste.entry_type ORDER BY ste.timestamp) AS rn
    FROM staff_time_entries ste
),
clock_pairs AS (
    -- Pair each clock_in with the same-indexed clock_out for that staff.
    -- Works for well-formed sequences; uneven counts leave the tail unpaired.
    SELECT
        ci.staff_id,
        ci.location_id,
        ci.timestamp                                                 AS clock_in_at,
        co.timestamp                                                 AS clock_out_at,
        (date(ci.timestamp AT TIME ZONE 'UTC'))::date                AS work_date
    FROM ordered ci
    LEFT JOIN ordered co
        ON  co.staff_id    = ci.staff_id
        AND co.entry_type  = 'clock_out'
        AND co.rn          = ci.rn
    WHERE ci.entry_type = 'clock_in'
),
break_pairs AS (
    SELECT
        bs.staff_id,
        bs.timestamp AS break_start_at,
        be.timestamp AS break_end_at
    FROM ordered bs
    LEFT JOIN ordered be
        ON  be.staff_id   = bs.staff_id
        AND be.entry_type = 'break_end'
        AND be.rn         = bs.rn
    WHERE bs.entry_type = 'break_start'
),
break_minutes_per_shift AS (
    SELECT
        cp.staff_id,
        cp.clock_in_at,
        cp.clock_out_at,
        COALESCE(SUM(
            EXTRACT(EPOCH FROM (bp.break_end_at - bp.break_start_at)) / 60.0
        ), 0)::numeric AS break_minutes
    FROM clock_pairs cp
    LEFT JOIN break_pairs bp
        ON  bp.staff_id       = cp.staff_id
        AND bp.break_start_at >= cp.clock_in_at
        AND (cp.clock_out_at IS NULL OR bp.break_end_at <= cp.clock_out_at)
    GROUP BY cp.staff_id, cp.clock_in_at, cp.clock_out_at
)
SELECT
    cp.location_id,
    cp.staff_id,
    cp.work_date,
    cp.clock_in_at,
    cp.clock_out_at,
    CASE
        WHEN cp.clock_out_at IS NULL THEN NULL
        ELSE ROUND((EXTRACT(EPOCH FROM (cp.clock_out_at - cp.clock_in_at)) / 60.0)::numeric, 2)
    END AS total_minutes,
    ROUND(COALESCE(bm.break_minutes, 0), 2) AS break_minutes,
    CASE
        WHEN cp.clock_out_at IS NULL THEN NULL
        ELSE ROUND(
            ((EXTRACT(EPOCH FROM (cp.clock_out_at - cp.clock_in_at)) / 60.0)
             - COALESCE(bm.break_minutes, 0))::numeric,
            2
        )
    END AS worked_minutes
FROM clock_pairs cp
LEFT JOIN break_minutes_per_shift bm
    ON  bm.staff_id     = cp.staff_id
    AND bm.clock_in_at  = cp.clock_in_at
    AND (bm.clock_out_at IS NOT DISTINCT FROM cp.clock_out_at);

COMMENT ON VIEW labor_hours_daily IS
    'Per-shift labor rows: pairs clock_in to the nth clock_out for the same '
    'staff member, then subtracts same-indexed break_start/break_end intervals '
    'that fall within the shift. Forgotten clock-outs leave clock_out_at and '
    'worked_minutes NULL. See TODO at top of file re: labor cost in currency.';


-- ======================
-- 5. theoretical_vs_actual_cogs
-- Theoretical cost = SUM(items.cost_price * qty_sold) for non-cancelled orders.
-- Actual cost consumed = SUM(|quantity| * unit_cost) for stock_movements of
-- movement_type IN ('sale', 'waste').
-- Both bucketed per (location_id, sale_date) over the last 30 days.
--
-- Approximation caveat: true COGS would weight stock consumption by
-- item_recipes -> inventory_items using calculate_recipe_cost(item_id) and
-- recipe-driven stock_movements. This view is the minimum viable signal for
-- a variance dashboard; when the recipe join is productionized, add a
-- materialized cogs_recipe_weighted view alongside this one.
-- ======================
CREATE VIEW theoretical_vs_actual_cogs AS
WITH theoretical AS (
    SELECT
        o.location_id,
        (date(o.created_at AT TIME ZONE 'UTC'))::date AS sale_date,
        SUM(oi.quantity * COALESCE(i.cost_price, 0))::decimal(14,2) AS theoretical_cost
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    JOIN items i        ON i.id        = oi.item_id
    WHERE o.status <> 'cancelled'
      AND o.created_at >= now() - interval '30 days'
    GROUP BY o.location_id, (date(o.created_at AT TIME ZONE 'UTC'))::date
),
actual AS (
    SELECT
        inv.location_id,
        (date(sm.created_at AT TIME ZONE 'UTC'))::date AS sale_date,
        SUM(ABS(sm.quantity) * COALESCE(sm.unit_cost, 0))::decimal(14,2) AS actual_cost_consumed
    FROM stock_movements sm
    JOIN inventory_items inv ON inv.id = sm.inventory_item_id
    WHERE sm.movement_type IN ('sale', 'waste')
      AND sm.created_at >= now() - interval '30 days'
    GROUP BY inv.location_id, (date(sm.created_at AT TIME ZONE 'UTC'))::date
)
SELECT
    COALESCE(t.location_id, a.location_id)         AS location_id,
    COALESCE(t.sale_date,   a.sale_date)           AS sale_date,
    COALESCE(t.theoretical_cost, 0)                AS theoretical_cost,
    COALESCE(a.actual_cost_consumed, 0)            AS actual_cost_consumed,
    (COALESCE(a.actual_cost_consumed, 0) - COALESCE(t.theoretical_cost, 0))::decimal(14,2) AS variance,
    CASE
        WHEN COALESCE(t.theoretical_cost, 0) = 0 THEN NULL
        ELSE ROUND(
            ((COALESCE(a.actual_cost_consumed, 0) - t.theoretical_cost)
             / NULLIF(t.theoretical_cost, 0)) * 100,
            2
        )
    END                                            AS variance_pct
FROM theoretical t
FULL OUTER JOIN actual a
    ON a.location_id = t.location_id
   AND a.sale_date   = t.sale_date;

COMMENT ON VIEW theoretical_vs_actual_cogs IS
    'Approximate food-cost variance: theoretical cost (items.cost_price * qty '
    'sold) vs actual consumption (stock_movements of type sale/waste). True '
    'recipe-weighted COGS requires joining item_recipes and calling '
    'calculate_recipe_cost; add that as a separate view later.';


-- ======================
-- 6. revenue_by_payment_method
-- One row per (location_id, sale_date, payment_method_code).
-- payment_status='completed' only (enum from 20240101000004_payment_system.sql).
-- ======================
CREATE VIEW revenue_by_payment_method AS
SELECT
    o.location_id,
    (date(op.paid_at AT TIME ZONE 'UTC'))::date    AS sale_date,
    op.payment_method_code,
    COUNT(*)                                        AS txn_count,
    COALESCE(SUM(op.amount_paid_cents), 0)::bigint  AS gross_cents,
    COALESCE(SUM(
        COALESCE(pf.processing_fee_cents, 0) + COALESCE(pf.gateway_fee_cents, 0)
    ), 0)::bigint                                   AS processing_fee_cents,
    COALESCE(SUM(
        COALESCE(pf.merchant_amount_cents, op.amount_paid_cents)
    ), 0)::bigint                                   AS net_cents,
    COALESCE(SUM(op.tip_amount_cents), 0)::bigint   AS tip_cents
FROM order_payments op
JOIN orders o         ON o.id = op.order_id
LEFT JOIN payment_fees pf ON pf.payment_id = op.id
WHERE op.payment_status = 'completed'
  AND o.status <> 'cancelled'
GROUP BY
    o.location_id,
    (date(op.paid_at AT TIME ZONE 'UTC'))::date,
    op.payment_method_code;

COMMENT ON VIEW revenue_by_payment_method IS
    'Completed-payment revenue broken down per location / day / method. All '
    'amounts in cents (bigint) to match order_payments/payment_fees.';


-- ======================
-- REFRESH HELPER
-- No materialized views are currently emitted from this migration; keep the
-- function in place so the API surface is stable and so new materialized
-- views added later have an obvious home.
-- ======================
CREATE OR REPLACE FUNCTION refresh_reporting_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- no-op: all reporting views are non-materialized
    -- When a materialized view is added above, issue:
    --   REFRESH MATERIALIZED VIEW CONCURRENTLY <name>;
    -- here (and add a unique index on the MV so CONCURRENTLY works).
    RETURN;
END;
$$;

COMMENT ON FUNCTION refresh_reporting_views() IS
    'Refreshes any materialized reporting views. Currently a no-op — all '
    'reporting views in 20240101000022 are plain CREATE VIEW.';
