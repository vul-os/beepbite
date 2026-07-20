-- =============================================================================
-- MIGRATION 021 — FOUNDATION PATCH
-- =============================================================================
-- Closes three audit findings: missing functions / views that active code
-- references but that no prior consolidated migration ever defined.
--
-- Safe to re-run: both objects use CREATE OR REPLACE.
-- Does NOT modify any table, index, trigger, or RLS policy.
--
-- Audit findings closed:
--   [2] lookup_location_by_slug(p_slug text)
--       Promised in Wave-7 task T7.6 (tasks.md:339) for the subdomain middleware
--       internal/subdomain/middleware.go. The Go middleware is not yet written, but
--       other slug-resolution code (checkout.go:138, store.go:206) already queries
--       locations by slug inline. This function centralises that contract so the
--       middleware can call it without duplicating logic.
--
--   [3] recipe_breakdown  (view)
--       Listed in backend/internal/handlers/data/allowlist.go:52 as a Select-only
--       view. Exercised by backend/cmd/tests/suite_recipes.go:90 via
--       GET /data/recipe_breakdown?limit=5. Only exists in
--       backend/migrations/legacy/20240101000005_recursive_recipes.sql and
--       backend/migrations/legacy/20240101000007_apply_recursive_recipes.sql.
--       Ported forward using consolidated schema column names (quantity_needed on
--       item_recipes, get_item_components() from 004_menu.sql).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- [2]  lookup_location_by_slug(p_slug text)
-- ---------------------------------------------------------------------------
-- CONTRACT (from tasks.md:339, Wave-7 T7.6):
--   Backend middleware internal/subdomain/middleware.go reads r.Host, extracts
--   the first label (the store slug), then calls lookup_location_by_slug(slug).
--   If matched, sets r.Context() with subdomain_location_id.
--
-- The middleware needs at minimum: id (to populate subdomain_location_id) and
-- enough context to decide whether to serve the store. checkout.go:138 and
-- store.go:206 also query locations by slug inline — the columns they use
-- (id, name, slug, offers_delivery, offers_collection, is_marketplace_visible,
-- is_active, on_delivery_payment_methods, estimated_prep_time, currency_code)
-- are all included here so the middleware (and future callers) can avoid a
-- second round-trip.
--
-- The function restricts to is_active = true by default because the middleware
-- must silently ignore deactivated stores (treat them as unknown subdomains).
-- is_marketplace_visible is NOT filtered here — the caller decides whether to
-- enforce it. The subdomain middleware should resolve the location even for
-- stores that are active but not listed on the marketplace directory (e.g. a
-- staff-only PIN login via /s/:slug must still resolve).
--
-- Security model: STABLE, SECURITY INVOKER. Callers with marketplace_role see
-- what RLS allows on locations (is_marketplace_visible = true rows). Callers
-- with service_role or an authenticated org session see their own rows.
-- Public callers using the anonymous role (e.g. marketplace checkout) must be
-- given EXECUTE explicitly; we grant it to PUBLIC since slug lookups are
-- intentionally a public operation (the slug is in the URL).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION lookup_location_by_slug(p_slug text)
RETURNS TABLE (
    id                          uuid,
    organization_id             uuid,
    name                        text,
    slug                        text,
    description                 text,
    city                        text,
    country                     text,
    address                     text,
    currency_code               text,
    offers_delivery             boolean,
    offers_collection           boolean,
    on_delivery_payment_methods text[],
    is_marketplace_visible      boolean,
    is_active                   boolean,
    estimated_prep_time         integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
    SELECT
        l.id,
        l.organization_id,
        l.name,
        l.slug,
        l.description,
        l.city,
        l.country,
        l.address,
        l.currency_code,
        l.offers_delivery,
        l.offers_collection,
        l.on_delivery_payment_methods,
        l.is_marketplace_visible,
        l.is_active,
        l.estimated_prep_time
    FROM locations l
    WHERE l.slug = p_slug
      AND l.is_active = true
    LIMIT 1;
$$;

COMMENT ON FUNCTION lookup_location_by_slug(text) IS
    'Resolves a store slug to its full location row. Returns 0 rows when the slug '
    'is unknown or the location is not active (middleware treats 0 rows as an '
    'unknown/reserved subdomain and falls through). '
    'is_marketplace_visible is NOT filtered — the subdomain middleware must resolve '
    'PIN-login locations even when they opt out of marketplace listing. '
    'SECURITY INVOKER: RLS on locations applies. marketplace_role callers see only '
    'is_marketplace_visible = true rows per the locations_select_marketplace policy. '
    'EXECUTE granted to PUBLIC because slug resolution is a public routing operation. '
    'Audit finding [2]: closes the Wave-7 T7.6 missing-function promise.';

-- Grant EXECUTE to PUBLIC so anonymous/marketplace callers can resolve subdomains.
-- service_role and authenticated roles already have EXECUTE via default privileges
-- (001_extensions_and_helpers.sql line 353).
GRANT EXECUTE ON FUNCTION lookup_location_by_slug(text) TO PUBLIC;


-- ---------------------------------------------------------------------------
-- [3]  recipe_breakdown  (view)
-- ---------------------------------------------------------------------------
-- CONTRACT (from allowlist.go:52, suite_recipes.go:90):
--   GET /data/recipe_breakdown?limit=5  → HTTP 200
--   SELECT on recipe_breakdown must succeed for any authenticated org member
--   whose items include at least one recipe-type row.
--
-- Legacy definition (20240101000005_recursive_recipes.sql:220 and
-- 20240101000007_apply_recursive_recipes.sql:190) used:
--   CROSS JOIN LATERAL get_item_components(p.id) c
--   WHERE p.recipe_type IN ('recipe', 'component')
--   ORDER BY p.name, c.level_depth, c.component_name
--
-- The legacy view referenced column `quantity` on item_recipes (the old name).
-- The consolidated schema (004_menu.sql:187) renamed it to `quantity_needed`.
-- get_item_components() in 004_menu.sql already uses quantity_needed internally
-- and returns total_quantity (the accumulated quantity through recursive levels)
-- so the view column name is preserved as total_quantity (from the function
-- return type at 004_menu.sql:256).
--
-- The legacy view also used cost_percentage which computes
--   cost_contribution / NULLIF(calculate_recipe_cost(parent), 0) * 100
-- This is preserved as-is — calculate_recipe_cost() is defined in 004_menu.sql.
--
-- Security model: WITH (security_invoker = on) matches the convention used by
-- all ten views in 014_seed_and_views.sql. RLS on items (via location →
-- organization_id = current_org_id()) filters the parent rows. RLS on
-- item_recipes is applied within get_item_components() for the same reason.
--
-- Grants: service_role and authenticated roles receive SELECT via default
-- privileges (001_extensions_and_helpers.sql). marketplace_role does NOT need
-- this view (it is an operational recipe tool, not a customer-facing surface).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW recipe_breakdown
WITH (security_invoker = on)
AS
SELECT
    p.id                                                        AS parent_item_id,
    p.name                                                      AS parent_item_name,
    p.location_id,
    p.recipe_complexity,
    p.max_recipe_level,
    p.total_components,
    c.component_item_id,
    c.component_name,
    c.total_quantity,
    c.unit,
    c.level_depth,
    c.cost_contribution,
    ROUND(
        (c.cost_contribution / NULLIF(calculate_recipe_cost(p.id), 0)) * 100,
        2
    )                                                           AS cost_percentage
FROM items p
CROSS JOIN LATERAL get_item_components(p.id) c
WHERE p.recipe_type IN ('recipe', 'component')
ORDER BY p.name, c.level_depth, c.component_name;

COMMENT ON VIEW recipe_breakdown IS
    'Flat expansion of every recipe-type item''s component tree via get_item_components(). '
    'One row per (parent item, component item) combination including recursive sub-components. '
    'total_quantity is the accumulated quantity at the given level depth. '
    'cost_percentage is this component''s share of the parent''s total recipe cost. '
    'WITH (security_invoker = on): RLS on items filters parents to the caller''s org; '
    'RLS on item_recipes inside get_item_components() applies the same. '
    'Ported from legacy migrations 20240101000005 and 20240101000007, adapted to use '
    'quantity_needed (consolidated schema column name in 004_menu.sql). '
    'Audit finding [3]: closes the missing view referenced in allowlist.go:52 and '
    'exercised by suite_recipes.go:90.';

-- =============================================================================
-- DONE — Migration 021
-- No table, index, trigger, or RLS policy changes.
-- Two objects created (all CREATE OR REPLACE):
--   FUNCTION lookup_location_by_slug(text)         → RETURNS TABLE (15 cols)
--   VIEW     recipe_breakdown                       → security_invoker = on
-- =============================================================================
