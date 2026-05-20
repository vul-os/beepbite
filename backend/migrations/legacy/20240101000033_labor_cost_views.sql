-- ======================
-- LABOR COST REPORTING VIEWS (migration 33)
--
-- Depends on:
--   migration 02: staff_time_entries, staff_shifts
--   migration 22: labor_hours_daily (view), daily_sales_summary (view)
--   migration 29: staff_pay_rates
--
-- Simplification notes:
--   - Only rate_type IN ('hourly', 'per_shift') are priced; salary_monthly,
--     salary_annual, and commission rows are skipped in v1 (no row emitted
--     for those staff on days they have no hourly/per_shift rate). A future
--     migration can add salary slicing.
--   - "Current" rate = staff_pay_rates row where effective_until IS NULL.
--   - Overtime is approximated on a per-day basis using
--     overtime_threshold_hours_per_week / 7 as a daily threshold. Hours above
--     that threshold in a single shift use rate * overtime_multiplier.
--   - Salary types are intentionally excluded (not approximated) to avoid
--     double-counting when a staff member has both hourly and salary rows.
-- ======================


-- ---------------------------------------------------------------------------
-- 1. labor_cost_daily
-- Per (work_date, location_id, staff_id): labor cost in cents derived from
-- staff_time_entries actual clock pairs (via labor_hours_daily view) joined
-- to the staff member's current pay rate. Only hourly and per_shift rates
-- are handled in v1.
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS labor_cost_daily;

CREATE VIEW labor_cost_daily AS
WITH
-- Re-aggregate the per-cycle rows from labor_hours_daily into one worked_hours
-- value per (staff_id, location_id, work_date). A staff member can clock in
-- multiple times on the same date; we sum all completed cycles (NULL
-- worked_minutes are excluded).
daily_hours AS (
    SELECT
        lhd.staff_id,
        lhd.location_id,
        lhd.work_date,
        ROUND(
            COALESCE(SUM(lhd.worked_minutes) FILTER (WHERE lhd.worked_minutes IS NOT NULL), 0)
            / 60.0,
            4
        )::numeric                          AS hours_worked
    FROM labor_hours_daily lhd
    GROUP BY lhd.staff_id, lhd.location_id, lhd.work_date
),
-- Current pay rate per staff: one row per (staff_id, rate_type).
-- We take only the two rate types handled in v1.
current_rates AS (
    SELECT
        spr.staff_id,
        spr.rate_type,
        spr.amount_cents,
        spr.overtime_multiplier,
        spr.overtime_threshold_hours_per_week
    FROM staff_pay_rates spr
    WHERE spr.effective_until IS NULL
      AND spr.rate_type IN ('hourly', 'per_shift')
),
-- Compute cost per (staff, location, date) per applicable rate row.
-- For staff with both hourly and per_shift rows, both are summed (unlikely
-- in practice, but safe).
cost_per_rate AS (
    SELECT
        dh.work_date,
        dh.location_id,
        dh.staff_id,
        cr.rate_type,
        dh.hours_worked,
        CASE cr.rate_type
            -- hourly: straight time up to daily OT threshold, OT above it.
            WHEN 'hourly' THEN
                CASE
                    WHEN dh.hours_worked <= 0
                    THEN 0

                    -- daily threshold derived from weekly threshold / 7
                    WHEN cr.overtime_threshold_hours_per_week IS NULL
                      OR (cr.overtime_threshold_hours_per_week / 7.0) >= dh.hours_worked
                    THEN ROUND(cr.amount_cents * dh.hours_worked)

                    -- split: straight portion + overtime portion
                    ELSE
                        ROUND(
                            cr.amount_cents
                            * (cr.overtime_threshold_hours_per_week / 7.0)
                        )
                        +
                        ROUND(
                            cr.amount_cents
                            * cr.overtime_multiplier
                            * (dh.hours_worked - (cr.overtime_threshold_hours_per_week / 7.0))
                        )
                END

            -- per_shift: flat rate regardless of hours (one unit per distinct
            -- clock-in cycle, approximated here as 1 shift per date).
            WHEN 'per_shift' THEN cr.amount_cents

            ELSE 0
        END::bigint                         AS shift_cost_cents
    FROM daily_hours dh
    JOIN current_rates cr ON cr.staff_id = dh.staff_id
    WHERE dh.hours_worked > 0
       OR cr.rate_type = 'per_shift'   -- per_shift fires even for 0-hour days (e.g. a show-up)
)
SELECT
    cpr.work_date,
    cpr.location_id,
    cpr.staff_id,
    SUM(cpr.hours_worked)::numeric          AS hours_worked,
    SUM(cpr.shift_cost_cents)::bigint       AS labor_cost_cents
FROM cost_per_rate cpr
GROUP BY cpr.work_date, cpr.location_id, cpr.staff_id;

COMMENT ON VIEW labor_cost_daily IS
    'Daily labor cost in cents per (work_date, location_id, staff_id); '
    'hourly rate with rough daily overtime split + flat per_shift rate only (v1, salary excluded).';


-- ---------------------------------------------------------------------------
-- 2. sales_per_labor_hour
-- Per (sale_date, location_id): net_sales / total labor hours worked.
-- Rounded to 2 decimal places. NULL when total labor hours = 0 or no clock
-- data exists.
-- net_sales comes from daily_sales_summary which rolls up all order_types;
-- total labor hours are summed from labor_cost_daily (which already excludes
-- NULL worked_minutes cycles).
-- ---------------------------------------------------------------------------

DROP VIEW IF EXISTS sales_per_labor_hour;

CREATE VIEW sales_per_labor_hour AS
WITH
-- Aggregate all order_types in daily_sales_summary into a single net figure
-- per (location_id, sale_date).
sales_agg AS (
    SELECT
        dss.location_id,
        dss.sale_date,
        SUM(dss.net_sales)::decimal(14,2)   AS total_net_sales
    FROM daily_sales_summary dss
    GROUP BY dss.location_id, dss.sale_date
),
-- Aggregate labor hours from labor_cost_daily (already per-staff per-date).
labor_agg AS (
    SELECT
        lcd.location_id,
        lcd.work_date,
        SUM(lcd.hours_worked)::numeric       AS total_hours_worked
    FROM labor_cost_daily lcd
    GROUP BY lcd.location_id, lcd.work_date
)
SELECT
    COALESCE(s.location_id, l.location_id)  AS location_id,
    COALESCE(s.sale_date,   l.work_date)    AS sale_date,
    s.total_net_sales,
    l.total_hours_worked,
    CASE
        WHEN COALESCE(l.total_hours_worked, 0) = 0 THEN NULL
        ELSE ROUND(s.total_net_sales / l.total_hours_worked, 2)
    END::decimal(14,2)                      AS net_sales_per_labor_hour
FROM sales_agg s
FULL OUTER JOIN labor_agg l
    ON  l.location_id = s.location_id
    AND l.work_date   = s.sale_date;

COMMENT ON VIEW sales_per_labor_hour IS
    'Net sales (decimal) divided by total hours worked per (sale_date, location_id); '
    'NULL when no clock-in hours recorded for that day.';

