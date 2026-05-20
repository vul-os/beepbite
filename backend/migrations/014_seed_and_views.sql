-- =============================================================================
-- MIGRATION 014 — SEED DATA + REPORTING VIEWS
-- =============================================================================
-- Sources: legacy 22 (reporting_views.sql), legacy 28 (triggers_and_report_views.sql),
--          legacy 33 (labor_cost_views.sql), legacy 26 (regions seed),
--          legacy 38 (currencies seed), legacy 27 (subscription_plans seed),
--          schema-consolidation-plan.md §1.014 and ROADMAP Now-1.
--
-- NO new tables. This migration only:
--   A. Seed data: regions, currencies, payment_providers, subscription_plans
--   B. Reporting views (all with security_invoker = on):
--        daily_sales_summary, hourly_sales_heatmap, menu_engineering,
--        labor_hours_daily, labor_cost_daily, sales_per_labor_hour,
--        theoretical_vs_actual_cogs, revenue_by_payment_method,
--        cash_drawer_eod_report, kds_expo_view
--   C. refresh_reporting_views() — stable no-op for future matviews
--
-- Views use `WITH (security_invoker = on)` (Postgres 15+) so every query runs
-- under the caller's RLS context. The caller's app.current_org_id session var
-- is already set by middleware, so RLS on underlying tables applies correctly.
--
-- Reference tables (regions, currencies, payment_providers, subscription_plans)
-- are NOT under RLS per schema-consolidation-plan.md §5.
-- Access pattern: GRANT SELECT TO PUBLIC; REVOKE INSERT/UPDATE/DELETE FROM PUBLIC.
-- =============================================================================


-- =============================================================================
-- A. SEED DATA
-- =============================================================================


-- ---------------------------------------------------------------------------
-- A.1  currencies
-- Full launch set: USD, ZAR, NGN, KES, GHS, EUR, GBP, INR
-- display_symbol is the short symbol used in UI (e.g. "$" not "US$").
-- decimal_places governs formatting (NGN has 2 decimal places but often shown
-- as whole naira in practice — we store 2 per ISO 4217 and let the UI decide).
-- ---------------------------------------------------------------------------
INSERT INTO currencies (code, name, symbol, decimal_digits, is_active)
VALUES
    ('USD', 'US Dollar',            '$',    2, true),
    ('ZAR', 'South African Rand',   'R',    2, true),
    ('NGN', 'Nigerian Naira',       '₦',    2, true),
    ('KES', 'Kenyan Shilling',      'KSh',  2, true),
    ('GHS', 'Ghanaian Cedi',        '₵',    2, true),
    ('EUR', 'Euro',                 '€',    2, true),
    ('GBP', 'British Pound',        '£',    2, true),
    ('INR', 'Indian Rupee',         '₹',    2, true)
ON CONFLICT (code) DO UPDATE
    SET name         = EXCLUDED.name,
        symbol       = EXCLUDED.symbol,
        decimal_digits = EXCLUDED.decimal_digits,
        is_active    = EXCLUDED.is_active;


-- ---------------------------------------------------------------------------
-- A.2  regions
-- ZA, NG, KE, GH, US, GB, EU — each with currency + timezone + payment_provider.
-- payment_provider is the default provider for new locations in that region.
-- EU is a synthetic multi-country entry for Stripe-based EU deployments.
-- ---------------------------------------------------------------------------
INSERT INTO regions (code, name, currency, timezone, payment_provider, default_tax_rate, default_tax_name, is_active)
VALUES
    ('ZA', 'South Africa',          'ZAR', 'Africa/Johannesburg',  'paystack', 15.00, 'VAT',  true),
    ('NG', 'Nigeria',               'NGN', 'Africa/Lagos',         'paystack',  7.50, 'VAT',  true),
    ('KE', 'Kenya',                 'KES', 'Africa/Nairobi',       'paystack', 16.00, 'VAT',  true),
    ('GH', 'Ghana',                 'GHS', 'Africa/Accra',         'paystack', 15.00, 'VAT',  true),
    ('US', 'United States',         'USD', 'America/New_York',     'stripe',    0.00, 'Tax',  true),
    ('GB', 'United Kingdom',        'GBP', 'Europe/London',        'stripe',   20.00, 'VAT',  true),
    ('EU', 'European Union',        'EUR', 'Europe/Berlin',        'stripe',   20.00, 'VAT',  true)
ON CONFLICT (code) DO UPDATE
    SET name              = EXCLUDED.name,
        currency          = EXCLUDED.currency,
        timezone          = EXCLUDED.timezone,
        payment_provider  = EXCLUDED.payment_provider,
        default_tax_rate  = EXCLUDED.default_tax_rate,
        default_tax_name  = EXCLUDED.default_tax_name,
        is_active         = EXCLUDED.is_active;


-- ---------------------------------------------------------------------------
-- A.3  payment_providers
-- Registry: paystack (active), stripe (active), payfast (disabled by default).
-- The `code` column is the unique key used in regions.payment_provider and
-- location_payment_credentials.provider_code.
-- ---------------------------------------------------------------------------
INSERT INTO payment_providers (code, display_name, status)
VALUES
    ('paystack', 'Paystack',  'active'),
    ('stripe',   'Stripe',    'active'),
    ('payfast',  'PayFast',   'inactive')
ON CONFLICT (code) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        status       = EXCLUDED.status;


-- ---------------------------------------------------------------------------
-- A.4  subscription_plans
-- Tiers: Free $0, Starter $39/loc, Growth $249/loc, Scale $799/loc (USD).
-- Amounts stored in USD cents (monthly_fee_cents). Wallet-billed model: fee
-- is a ledger debit, not a Stripe subscription.
--
-- Quotas (included per location per billing month, per ROADMAP Now-1):
--   orders:              Free=500,  Starter=2000,  Growth=10000, Scale=unlimited
--   whatsapp_outbound:   Free=200,  Starter=1000,  Growth=5000,  Scale=unlimited
--   llm_messages:        Free=100,  Starter=500,   Growth=2000,  Scale=unlimited
--   email_outbound:      Free=500,  Starter=2000,  Growth=10000, Scale=unlimited
--   bulk_imports:        Free=0,    Starter=5,     Growth=25,    Scale=unlimited
--
-- Overage rates (USD cents per unit, per ROADMAP Now-1):
--   orders:              $0.02  = 2 cents
--   whatsapp_outbound:   $0.05  = 5 cents
--   llm_messages:        $0.10  = 10 cents
--   email_outbound:      $0.001 = 0.1 cents → stored as numeric in features jsonb
--   bulk_imports:        $0.50  = 50 cents
--
-- tier_code CHECK constraint in legacy 27 used ('free','starter','growth','pro').
-- We extend it here to add 'scale'. If the CHECK still exists, we widen it first.
-- ---------------------------------------------------------------------------

-- Widen the tier_code CHECK to include 'scale' (it was 'pro' in legacy 27).
-- We use a DO block to be idempotent: drop the old CHECK name if present,
-- add the new one only if absent.
DO $$
BEGIN
    -- Remove legacy constraint if it exists (it may have varied names across envs).
    ALTER TABLE subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_tier_code_check;
EXCEPTION WHEN OTHERS THEN
    NULL;  -- already gone or never existed; safe to continue
END $$;

ALTER TABLE subscription_plans
    ADD CONSTRAINT subscription_plans_tier_code_check
    CHECK (tier_code IN ('free', 'starter', 'growth', 'scale'));

INSERT INTO subscription_plans (
    tier_code,
    display_name,
    description,
    monthly_fee_cents,
    annual_fee_cents,
    transaction_fee_percentage,
    transaction_fee_fixed_cents,
    payout_fee_percentage,
    payout_fee_fixed_cents,
    max_locations,
    max_staff,
    max_orders_per_month,
    features,
    is_active,
    sort_order,
    billed_in_currency_code
)
VALUES
    (
        'free',
        'Free',
        'Offline payments only. Up to 500 orders/mo. No LLM chat. No payouts. '
        '90-day inactivity auto-pause.',
        0,        -- $0/month
        0,
        3.500, 200,
        0.000, 500,
        1,        -- max 1 location
        5,        -- max 5 staff
        500,
        jsonb_build_object(
            'kds',              false,
            'multi_location',   false,
            'online_payments',  false,
            'llm_chat',         false,
            'whatsapp_ordering',false,
            'payouts',          false,
            'included_quotas',  jsonb_build_object(
                'orders',             500,
                'whatsapp_outbound',  200,
                'llm_messages',       100,
                'email_outbound',     500,
                'bulk_imports',         0
            ),
            'overage_rates_cents', jsonb_build_object(
                'orders',             2,
                'whatsapp_outbound',  5,
                'llm_messages',      10,
                'email_outbound',     0,   -- not available on free
                'bulk_imports',       0    -- not available on free
            )
        ),
        true,
        0,
        'USD'
    ),
    (
        'starter',
        'Starter',
        '$39/location/month. Online payments, KDS, WhatsApp ordering, '
        'up to 2000 orders/mo.',
        3900,     -- $39/month in USD cents
        42120,    -- $421.20/year (10% discount)
        2.900, 150,
        0.000, 500,
        1,        -- max 1 location
        20,
        2000,
        jsonb_build_object(
            'kds',              true,
            'multi_location',   false,
            'online_payments',  true,
            'llm_chat',         true,
            'whatsapp_ordering',true,
            'payouts',          true,
            'included_quotas',  jsonb_build_object(
                'orders',             2000,
                'whatsapp_outbound',  1000,
                'llm_messages',        500,
                'email_outbound',     2000,
                'bulk_imports',          5
            ),
            'overage_rates_cents', jsonb_build_object(
                'orders',             2,
                'whatsapp_outbound',  5,
                'llm_messages',      10,
                'email_outbound',     0,
                'bulk_imports',      50
            )
        ),
        true,
        1,
        'USD'
    ),
    (
        'growth',
        'Growth',
        '$249/location/month. Multi-location, lower transaction fees, '
        'up to 10 000 orders/mo.',
        24900,    -- $249/month in USD cents
        268920,   -- $2689.20/year (10% discount)
        2.500, 100,
        0.000, 0,
        NULL,     -- unlimited locations
        NULL,     -- unlimited staff
        10000,
        jsonb_build_object(
            'kds',              true,
            'multi_location',   true,
            'online_payments',  true,
            'llm_chat',         true,
            'whatsapp_ordering',true,
            'payouts',          true,
            'included_quotas',  jsonb_build_object(
                'orders',             10000,
                'whatsapp_outbound',   5000,
                'llm_messages',        2000,
                'email_outbound',     10000,
                'bulk_imports',          25
            ),
            'overage_rates_cents', jsonb_build_object(
                'orders',             2,
                'whatsapp_outbound',  5,
                'llm_messages',      10,
                'email_outbound',     0,
                'bulk_imports',      50
            )
        ),
        true,
        2,
        'USD'
    ),
    (
        'scale',
        'Scale',
        '$799/location/month. Unlimited orders, lowest transaction fees, '
        'free payouts, dedicated support.',
        79900,    -- $799/month in USD cents
        862920,   -- $8629.20/year (10% discount)
        2.000, 50,
        0.000, 0,
        NULL,     -- unlimited
        NULL,     -- unlimited
        NULL,     -- unlimited
        jsonb_build_object(
            'kds',              true,
            'multi_location',   true,
            'online_payments',  true,
            'llm_chat',         true,
            'whatsapp_ordering',true,
            'payouts',          true,
            'dedicated_support',true,
            'included_quotas',  jsonb_build_object(
                'orders',             NULL,   -- unlimited (NULL = no cap)
                'whatsapp_outbound',  NULL,
                'llm_messages',       NULL,
                'email_outbound',     NULL,
                'bulk_imports',       NULL
            ),
            'overage_rates_cents', jsonb_build_object(
                'orders',             0,
                'whatsapp_outbound',  0,
                'llm_messages',       0,
                'email_outbound',     0,
                'bulk_imports',       0
            )
        ),
        true,
        3,
        'USD'
    )
ON CONFLICT (tier_code) DO UPDATE
    SET display_name                 = EXCLUDED.display_name,
        description                  = EXCLUDED.description,
        monthly_fee_cents            = EXCLUDED.monthly_fee_cents,
        annual_fee_cents             = EXCLUDED.annual_fee_cents,
        transaction_fee_percentage   = EXCLUDED.transaction_fee_percentage,
        transaction_fee_fixed_cents  = EXCLUDED.transaction_fee_fixed_cents,
        payout_fee_percentage        = EXCLUDED.payout_fee_percentage,
        payout_fee_fixed_cents       = EXCLUDED.payout_fee_fixed_cents,
        max_locations                = EXCLUDED.max_locations,
        max_staff                    = EXCLUDED.max_staff,
        max_orders_per_month         = EXCLUDED.max_orders_per_month,
        features                     = EXCLUDED.features,
        is_active                    = EXCLUDED.is_active,
        sort_order                   = EXCLUDED.sort_order,
        billed_in_currency_code      = EXCLUDED.billed_in_currency_code;


-- =============================================================================
-- B. REPORTING VIEWS
-- =============================================================================
-- All views use WITH (security_invoker = on) so they execute under the
-- calling session's RLS context. The caller's app.current_org_id is set by
-- middleware before the query reaches these views.
--
-- Views are declared with CREATE OR REPLACE so this migration is idempotent
-- on a database that already has legacy views from migrations 22/28/33.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- B.1  daily_sales_summary
-- One row per (location_id, sale_date, order_type).
-- Assumes consolidated schema where orders.total_amount_cents (bigint) exists.
-- Falls back gracefully to 0 when columns are NULL (COALESCE throughout).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW daily_sales_summary
WITH (security_invoker = on)
AS
SELECT
    o.location_id,
    (date(o.created_at AT TIME ZONE 'UTC'))::date           AS sale_date,
    o.order_type,
    COUNT(DISTINCT o.id)                                     AS order_count,
    -- Subtotal: sum of (unit_price * qty) across order_items
    COALESCE(SUM(oi_agg.subtotal_cents), 0)::bigint          AS gross_subtotal_cents,
    -- Tax
    COALESCE(SUM(o.tax_cents), 0)::bigint                    AS tax_total_cents,
    -- Discounts applied via order_adjustments (type in ('discount','comp','void'))
    COALESCE(SUM(oa_agg.discount_cents), 0)::bigint          AS discount_total_cents,
    -- Tips from completed order_payments
    COALESCE(SUM(tp.tip_cents), 0)::bigint                   AS tip_total_cents,
    -- Delivery fees
    COALESCE(SUM(o.delivery_fee_cents), 0)::bigint           AS delivery_fee_total_cents,
    -- Net sales = gross - discounts (excl. tax, delivery, tips)
    (COALESCE(SUM(oi_agg.subtotal_cents), 0)
     - COALESCE(SUM(oa_agg.discount_cents), 0))::bigint      AS net_sales_cents,
    -- Profit approximation: net_sales - estimated COGS from item.cost_price
    (COALESCE(SUM(oi_agg.subtotal_cents), 0)
     - COALESCE(SUM(oa_agg.discount_cents), 0)
     - COALESCE(SUM(oi_agg.estimated_cost_cents), 0))::bigint AS gross_profit_cents
FROM orders o
LEFT JOIN LATERAL (
    SELECT
        COALESCE(SUM(oi.unit_price_cents * oi.quantity), 0)                    AS subtotal_cents,
        COALESCE(SUM(oi.quantity * COALESCE(ROUND(i.cost_price * 100)::bigint, 0)), 0) AS estimated_cost_cents
    FROM order_items oi
    LEFT JOIN items i ON i.id = oi.item_id
    WHERE oi.order_id = o.id
) oi_agg ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(ABS(oa.amount_cents)), 0) AS discount_cents
    FROM order_adjustments oa
    WHERE oa.order_id = o.id
      AND oa.adjustment_type IN ('discount', 'comp', 'void')
      AND oa.approval_status = 'approved'
) oa_agg ON true
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(op.tip_amount_cents), 0) AS tip_cents
    FROM order_payments op
    WHERE op.order_id = o.id
      AND op.payment_status = 'completed'
) tp ON true
WHERE o.status <> 'cancelled'
GROUP BY
    o.location_id,
    (date(o.created_at AT TIME ZONE 'UTC'))::date,
    o.order_type;

COMMENT ON VIEW daily_sales_summary IS
    'Daily sales rollup per (location, sale_date, order_type). All monetary '
    'values in cents (bigint). security_invoker = on: RLS on orders and '
    'order_items filters to the caller''s org automatically.';


-- ---------------------------------------------------------------------------
-- B.2  hourly_sales_heatmap
-- Trailing 90-day heatmap by ISO dow (1=Mon..7=Sun) and hour_of_day (0..23).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW hourly_sales_heatmap
WITH (security_invoker = on)
AS
SELECT
    o.location_id,
    EXTRACT(isodow FROM o.created_at AT TIME ZONE 'UTC')::int  AS day_of_week,
    EXTRACT(hour   FROM o.created_at AT TIME ZONE 'UTC')::int  AS hour_of_day,
    COUNT(DISTINCT o.id)                                        AS order_count,
    COALESCE(SUM(oi_agg.subtotal_cents), 0)::bigint             AS total_revenue_cents,
    CASE
        WHEN COUNT(DISTINCT o.id) = 0 THEN 0
        ELSE (COALESCE(SUM(oi_agg.subtotal_cents), 0)
              / COUNT(DISTINCT o.id))::bigint
    END                                                         AS avg_ticket_cents
FROM orders o
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(oi.unit_price_cents * oi.quantity), 0) AS subtotal_cents
    FROM order_items oi
    WHERE oi.order_id = o.id
) oi_agg ON true
WHERE o.status <> 'cancelled'
  AND o.created_at >= now() - interval '90 days'
GROUP BY
    o.location_id,
    EXTRACT(isodow FROM o.created_at AT TIME ZONE 'UTC'),
    EXTRACT(hour   FROM o.created_at AT TIME ZONE 'UTC');

COMMENT ON VIEW hourly_sales_heatmap IS
    'Trailing 90-day heatmap: orders and revenue bucketed by ISO day-of-week '
    '(1=Mon..7=Sun) and hour-of-day (0..23), per location. All amounts in cents.';


-- ---------------------------------------------------------------------------
-- B.3  menu_engineering
-- Classic four-box (Kasavana & Smith) over trailing 30 days.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW menu_engineering
WITH (security_invoker = on)
AS
WITH item_sales AS (
    SELECT
        o.location_id,
        oi.item_id,
        i.name                                                 AS item_name,
        i.category_id,
        c.name                                                 AS category_name,
        ROUND(COALESCE(i.cost_price, 0) * 100)::bigint         AS cost_price_cents,
        SUM(oi.quantity)::bigint                               AS units_sold,
        SUM(oi.unit_price_cents * oi.quantity)::bigint         AS revenue_cents,
        (SUM(oi.quantity) * ROUND(COALESCE(i.cost_price, 0) * 100))::bigint AS cost_cents
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
        (s.revenue_cents - s.cost_cents)::bigint               AS margin_cents,
        CASE WHEN s.units_sold = 0 THEN 0::numeric
             ELSE ((s.revenue_cents - s.cost_cents)::numeric / s.units_sold)
        END                                                     AS margin_per_unit_cents,
        PERCENT_RANK() OVER (
            PARTITION BY s.location_id ORDER BY s.units_sold
        )                                                       AS popularity_score,
        PERCENT_RANK() OVER (
            PARTITION BY s.location_id
            ORDER BY CASE WHEN s.units_sold = 0 THEN 0::numeric
                         ELSE (s.revenue_cents - s.cost_cents)::numeric / s.units_sold
                    END
        )                                                       AS margin_score
    FROM item_sales s
)
SELECT
    location_id,
    item_id,
    item_name,
    category_id,
    category_name,
    units_sold,
    revenue_cents,
    cost_cents,
    margin_cents,
    margin_per_unit_cents,
    ROUND(popularity_score::numeric, 4) AS popularity_score,
    ROUND(margin_score::numeric, 4)     AS margin_score,
    CASE
        WHEN popularity_score >= 0.5 AND margin_score >= 0.5 THEN 'star'
        WHEN popularity_score >= 0.5 AND margin_score <  0.5 THEN 'plowhorse'
        WHEN popularity_score <  0.5 AND margin_score >= 0.5 THEN 'puzzle'
        ELSE 'dog'
    END                                 AS classification
FROM scored;

COMMENT ON VIEW menu_engineering IS
    'Trailing 30-day menu engineering four-box (star/plowhorse/puzzle/dog). '
    'Cost is items.cost_price (converted to cents) * qty — not recipe-weighted. '
    'security_invoker = on. All amounts in cents.';


-- ---------------------------------------------------------------------------
-- B.4  labor_hours_daily
-- Pairs clock_in → clock_out per staff per UTC work_date, subtracts breaks.
-- Edge cases: forgotten clock-outs → NULL worked_minutes; multi-shift days
-- produce multiple rows (one per cycle).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW labor_hours_daily
WITH (security_invoker = on)
AS
WITH ordered AS (
    SELECT
        ste.id,
        ste.staff_id,
        ste.location_id,
        ste.entry_type,
        ste.timestamp,
        ROW_NUMBER() OVER (
            PARTITION BY ste.staff_id, ste.entry_type
            ORDER BY ste.timestamp
        ) AS rn
    FROM staff_time_entries ste
),
clock_pairs AS (
    SELECT
        ci.staff_id,
        ci.location_id,
        ci.timestamp                                                      AS clock_in_at,
        co.timestamp                                                      AS clock_out_at,
        (date(ci.timestamp AT TIME ZONE 'UTC'))::date                    AS work_date
    FROM ordered ci
    LEFT JOIN ordered co
        ON  co.staff_id   = ci.staff_id
        AND co.entry_type = 'clock_out'
        AND co.rn         = ci.rn
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
        ELSE ROUND(
            (EXTRACT(EPOCH FROM (cp.clock_out_at - cp.clock_in_at)) / 60.0)::numeric,
            2
        )
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
    'Per-shift labor clock pairs with break deduction. One row per clock-in '
    'cycle. Forgotten clock-outs leave clock_out_at and worked_minutes NULL. '
    'security_invoker = on.';


-- ---------------------------------------------------------------------------
-- B.5  labor_cost_daily
-- Joins labor_hours_daily to staff_pay_rates for cost-in-cents calculation.
-- Handles hourly (with daily OT approximation) and per_shift rates only.
-- salary_monthly / salary_annual are excluded in v1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW labor_cost_daily
WITH (security_invoker = on)
AS
WITH daily_hours AS (
    SELECT
        lhd.staff_id,
        lhd.location_id,
        lhd.work_date,
        ROUND(
            COALESCE(SUM(lhd.worked_minutes) FILTER (WHERE lhd.worked_minutes IS NOT NULL), 0)
            / 60.0,
            4
        )::numeric AS hours_worked
    FROM labor_hours_daily lhd
    GROUP BY lhd.staff_id, lhd.location_id, lhd.work_date
),
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
cost_per_rate AS (
    SELECT
        dh.work_date,
        dh.location_id,
        dh.staff_id,
        cr.rate_type,
        dh.hours_worked,
        CASE cr.rate_type
            WHEN 'hourly' THEN
                CASE
                    WHEN dh.hours_worked <= 0 THEN 0
                    WHEN cr.overtime_threshold_hours_per_week IS NULL
                      OR (cr.overtime_threshold_hours_per_week / 7.0) >= dh.hours_worked
                    THEN ROUND(cr.amount_cents * dh.hours_worked)
                    ELSE
                        ROUND(cr.amount_cents * (cr.overtime_threshold_hours_per_week / 7.0))
                        + ROUND(
                            cr.amount_cents
                            * cr.overtime_multiplier
                            * (dh.hours_worked - (cr.overtime_threshold_hours_per_week / 7.0))
                          )
                END
            WHEN 'per_shift' THEN cr.amount_cents
            ELSE 0
        END::bigint AS shift_cost_cents
    FROM daily_hours dh
    JOIN current_rates cr ON cr.staff_id = dh.staff_id
    WHERE dh.hours_worked > 0
       OR cr.rate_type = 'per_shift'
)
SELECT
    cpr.work_date,
    cpr.location_id,
    cpr.staff_id,
    SUM(cpr.hours_worked)::numeric    AS hours_worked,
    SUM(cpr.shift_cost_cents)::bigint AS labor_cost_cents
FROM cost_per_rate cpr
GROUP BY cpr.work_date, cpr.location_id, cpr.staff_id;

COMMENT ON VIEW labor_cost_daily IS
    'Daily labor cost in cents per (work_date, location_id, staff_id). '
    'Hourly rate with rough daily OT split + flat per_shift. Salary excluded (v1). '
    'security_invoker = on.';


-- ---------------------------------------------------------------------------
-- B.6  sales_per_labor_hour
-- Net sales (from daily_sales_summary) / total labor hours (from labor_cost_daily).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW sales_per_labor_hour
WITH (security_invoker = on)
AS
WITH sales_agg AS (
    SELECT
        dss.location_id,
        dss.sale_date,
        SUM(dss.net_sales_cents)::bigint AS total_net_sales_cents
    FROM daily_sales_summary dss
    GROUP BY dss.location_id, dss.sale_date
),
labor_agg AS (
    SELECT
        lcd.location_id,
        lcd.work_date,
        SUM(lcd.hours_worked)::numeric AS total_hours_worked
    FROM labor_cost_daily lcd
    GROUP BY lcd.location_id, lcd.work_date
)
SELECT
    COALESCE(s.location_id, l.location_id)                      AS location_id,
    COALESCE(s.sale_date,   l.work_date)                        AS sale_date,
    s.total_net_sales_cents,
    l.total_hours_worked,
    CASE
        WHEN COALESCE(l.total_hours_worked, 0) = 0 THEN NULL
        ELSE ROUND(s.total_net_sales_cents::numeric / l.total_hours_worked, 2)
    END::numeric                                                AS net_sales_cents_per_labor_hour
FROM sales_agg s
FULL OUTER JOIN labor_agg l
    ON  l.location_id = s.location_id
    AND l.work_date   = s.sale_date;

COMMENT ON VIEW sales_per_labor_hour IS
    'Net sales cents / total hours worked per (location, date). '
    'NULL when no clock-in hours for that day. security_invoker = on.';


-- ---------------------------------------------------------------------------
-- B.7  theoretical_vs_actual_cogs
-- Theoretical cost from items.cost_price (cents) * qty vs actual from
-- stock_movements (movement_type IN (''sale'',''waste'')).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW theoretical_vs_actual_cogs
WITH (security_invoker = on)
AS
WITH theoretical AS (
    SELECT
        o.location_id,
        (date(o.created_at AT TIME ZONE 'UTC'))::date           AS sale_date,
        SUM(oi.quantity * ROUND(COALESCE(i.cost_price, 0) * 100))::bigint AS theoretical_cost_cents
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
        (date(sm.created_at AT TIME ZONE 'UTC'))::date          AS sale_date,
        SUM(ABS(sm.quantity) * COALESCE(sm.unit_cost, 0))::bigint AS actual_cost_cents
    FROM stock_movements sm
    JOIN inventory_items inv ON inv.id = sm.inventory_item_id
    WHERE sm.movement_type IN ('sale', 'waste')
      AND sm.created_at >= now() - interval '30 days'
    GROUP BY inv.location_id, (date(sm.created_at AT TIME ZONE 'UTC'))::date
)
SELECT
    COALESCE(t.location_id, a.location_id)                      AS location_id,
    COALESCE(t.sale_date,   a.sale_date)                        AS sale_date,
    COALESCE(t.theoretical_cost_cents, 0)::bigint               AS theoretical_cost_cents,
    COALESCE(a.actual_cost_cents,      0)::bigint               AS actual_cost_cents,
    (COALESCE(a.actual_cost_cents, 0) - COALESCE(t.theoretical_cost_cents, 0))::bigint AS variance_cents,
    CASE
        WHEN COALESCE(t.theoretical_cost_cents, 0) = 0 THEN NULL
        ELSE ROUND(
            ((COALESCE(a.actual_cost_cents, 0) - t.theoretical_cost_cents)::numeric
             / NULLIF(t.theoretical_cost_cents, 0)) * 100,
            2
        )
    END AS variance_pct
FROM theoretical t
FULL OUTER JOIN actual a
    ON  a.location_id = t.location_id
    AND a.sale_date   = t.sale_date;

COMMENT ON VIEW theoretical_vs_actual_cogs IS
    'Food-cost variance per (location, date): theoretical (cost_price in cents * qty) '
    'vs actual stock consumption (stock_movements sale/waste). All amounts in cents. '
    'security_invoker = on.';


-- ---------------------------------------------------------------------------
-- B.8  revenue_by_payment_method
-- One row per (location_id, sale_date, payment_method_code).
-- Completed payments only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW revenue_by_payment_method
WITH (security_invoker = on)
AS
SELECT
    o.location_id,
    (date(op.paid_at AT TIME ZONE 'UTC'))::date         AS sale_date,
    op.payment_method_code,
    COUNT(*)::bigint                                     AS txn_count,
    COALESCE(SUM(op.amount_paid_cents), 0)::bigint       AS gross_cents,
    COALESCE(SUM(
        COALESCE(pf.processing_fee_cents, 0) + COALESCE(pf.gateway_fee_cents, 0)
    ), 0)::bigint                                        AS processing_fee_cents,
    COALESCE(SUM(
        COALESCE(pf.merchant_amount_cents, op.amount_paid_cents)
    ), 0)::bigint                                        AS net_cents,
    COALESCE(SUM(op.tip_amount_cents), 0)::bigint        AS tip_cents
FROM order_payments op
JOIN orders o         ON o.id  = op.order_id
LEFT JOIN payment_fees pf ON pf.payment_id = op.id
WHERE op.payment_status = 'completed'
  AND o.status <> 'cancelled'
GROUP BY
    o.location_id,
    (date(op.paid_at AT TIME ZONE 'UTC'))::date,
    op.payment_method_code;

COMMENT ON VIEW revenue_by_payment_method IS
    'Completed-payment revenue per (location, date, method). All amounts in cents. '
    'security_invoker = on.';


-- ---------------------------------------------------------------------------
-- B.9  cash_drawer_eod_report
-- Per (session, payment_method) reconciliation. Cash row includes float +
-- net movements. Non-cash rows show tender total only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW cash_drawer_eod_report
WITH (security_invoker = on)
AS
WITH session_method_payments AS (
    SELECT
        cdsp.cash_drawer_session_id                             AS session_id,
        op.payment_method_code                                  AS method_code,
        COALESCE(SUM(op.amount_paid_cents), 0)::bigint          AS method_total_cents
    FROM cash_drawer_session_payments cdsp
    JOIN order_payments op ON op.id = cdsp.payment_id
    WHERE op.payment_status = 'completed'
    GROUP BY cdsp.cash_drawer_session_id, op.payment_method_code
),
session_cash_movements AS (
    SELECT
        cdm.cash_drawer_session_id                              AS session_id,
        COALESCE(SUM(CASE WHEN cdm.amount_cents > 0 THEN cdm.amount_cents  ELSE 0 END), 0)::bigint AS movements_in_cents,
        COALESCE(SUM(CASE WHEN cdm.amount_cents < 0 THEN -cdm.amount_cents ELSE 0 END), 0)::bigint AS movements_out_cents,
        COALESCE(SUM(cdm.amount_cents), 0)::bigint              AS movements_net_cents
    FROM cash_drawer_movements cdm
    GROUP BY cdm.cash_drawer_session_id
)
SELECT
    s.id                                                        AS session_id,
    s.cash_drawer_id,
    s.opened_at,
    s.closed_at,
    s.status,
    pm.code                                                     AS payment_method_code,
    pm.name                                                     AS payment_method_name,
    CASE
        WHEN pm.code = 'cash' THEN
            COALESCE(s.opening_float_cents, 0)
            + COALESCE(scm.movements_net_cents, 0)
            + COALESCE(smp.method_total_cents, 0)
        ELSE COALESCE(smp.method_total_cents, 0)
    END::bigint                                                 AS expected_cents,
    CASE WHEN pm.code = 'cash' THEN COALESCE(scm.movements_in_cents,  0) ELSE 0 END::bigint AS cash_movements_in_cents,
    CASE WHEN pm.code = 'cash' THEN COALESCE(scm.movements_out_cents, 0) ELSE 0 END::bigint AS cash_movements_out_cents,
    s.declared_closing_cents                                    AS declared_cents,
    s.over_short_cents
FROM cash_drawer_sessions s
LEFT JOIN session_method_payments smp ON smp.session_id = s.id
LEFT JOIN payment_methods pm          ON pm.code = smp.method_code
LEFT JOIN session_cash_movements scm  ON scm.session_id = s.id
WHERE pm.code IS NOT NULL
   OR EXISTS (
       SELECT 1 FROM session_cash_movements scm2 WHERE scm2.session_id = s.id
   );

COMMENT ON VIEW cash_drawer_eod_report IS
    'Per (session, payment_method) EOD reconciliation. Cash row includes opening '
    'float + net movements. Non-cash rows show tender total only. '
    'security_invoker = on.';


-- ---------------------------------------------------------------------------
-- B.10  kds_expo_view
-- Open orders on the expo screen with a jsonb array of per-station tickets.
-- "Open" = any non-bumped, non-cancelled ticket exists.
-- all_ready flags when expo can bump the whole order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW kds_expo_view
WITH (security_invoker = on)
AS
SELECT
    t.order_id,
    ks.location_id,
    MIN(t.fired_at)                                             AS earliest_fired_at,
    bool_and(t.status = 'ready')                               AS all_ready,
    bool_or(t.status  = 'in_progress')                         AS any_in_progress,
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
    )                                                          AS station_tickets,
    COALESCE(MAX(t.priority), 0)                               AS max_priority
FROM kds_tickets t
JOIN kitchen_stations ks ON ks.id = t.station_id
WHERE t.status IN ('fired', 'in_progress', 'ready')
GROUP BY t.order_id, ks.location_id
ORDER BY MIN(t.fired_at) ASC, COALESCE(MAX(t.priority), 0) DESC;

COMMENT ON VIEW kds_expo_view IS
    'Open KDS tickets grouped by order. all_ready = true when expo can bump '
    'the whole order. Uses security_invoker = on so RLS on kds_tickets, '
    'kitchen_stations, and kds_ticket_items applies to the caller automatically.';


-- =============================================================================
-- C. refresh_reporting_views()
-- =============================================================================
-- Stable no-op: all views above are plain CREATE VIEW (not materialized).
-- When a materialized view is added, issue REFRESH MATERIALIZED VIEW CONCURRENTLY
-- inside this function and add a unique index on the MV first.
-- =============================================================================

CREATE OR REPLACE FUNCTION refresh_reporting_views()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    -- no-op: all reporting views in 014 are non-materialized plain views.
    -- Add: REFRESH MATERIALIZED VIEW CONCURRENTLY <name>; when promoted.
    RETURN;
END;
$$;

COMMENT ON FUNCTION refresh_reporting_views() IS
    'Refreshes any materialized reporting views. Currently a no-op — all '
    'reporting views in migration 014 are plain CREATE OR REPLACE VIEWs. '
    'Add REFRESH MATERIALIZED VIEW CONCURRENTLY calls here when promoted.';


-- =============================================================================
-- DONE — Migration 014
-- No new tables.
-- Seed: currencies (8 rows), regions (7 rows), payment_providers (3 rows),
--       subscription_plans (4 rows: free/starter/growth/scale).
-- Views (10): daily_sales_summary, hourly_sales_heatmap, menu_engineering,
--              labor_hours_daily, labor_cost_daily, sales_per_labor_hour,
--              theoretical_vs_actual_cogs, revenue_by_payment_method,
--              cash_drawer_eod_report, kds_expo_view.
-- Functions: refresh_reporting_views()
-- =============================================================================
