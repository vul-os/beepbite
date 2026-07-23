-- BeepBite — baseline schema (folded).
--
-- The 55-file migration history is collapsed into this single forward-only
-- baseline. BeepBite has no production database, so nothing is lost; this file
-- reproduces, byte-for-byte, the schema those 55 migrations produced (verified
-- with a pg_dump --schema-only diff on postgres:16 — apply the old chain, apply
-- this, the two dumps are identical).
--
-- Shape: each table's PRIMARY KEY and UNIQUE constraints are inlined into its
-- CREATE TABLE (CHECK constraints were already inline). Foreign keys stay in a
-- trailing ADD CONSTRAINT block, and functions/sequences keep their generated
-- order. That is deliberate: this schema is 146 tables with mutual dependencies
-- (plpgsql helpers that RETURN table row-types, and table column DEFAULTs that
-- call those helpers, e.g. current_user_id()) plus 4 partitioned tables — a
-- shape only a full object-graph topological sort could inline further, which
-- would trade proven correctness for a cosmetic last step. The dependency order
-- Postgres itself requires is preserved.
--
-- Roles: CREATE ROLE is cluster-global and omitted by pg_dump, so the two
-- non-login RLS roles (service_role, marketplace_role) are (re)created up top,
-- guarded so a non-superuser runner skips them. Every RLS policy is written as
-- "... OR is_service_role()", keeping service access explicit and auditable
-- rather than granted via BYPASSRLS.
--
-- Applied by cmd/migrate, which creates and maintains schema_migrations itself.

SET check_function_bodies = false;

-- ── Roles ───────────────────────────────────────────────────────────────────
-- pg_dump omits CREATE ROLE (roles are cluster-global). These are the two
-- non-login roles the RLS model depends on: every policy is written as
-- `... OR is_service_role()` / `... OR is_marketplace_role()`, so access is
-- explicit and auditable rather than granted via BYPASSRLS. Guarded so a
-- non-superuser runner (or a re-run) skips gracefully.
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'service_role already exists or requires CREATEROLE privilege; skipping.';
END $$;

DO $$ BEGIN
  COMMENT ON ROLE service_role IS
    'Role for migration runner, cron jobs, admin scripts. '
    'Sets app.is_service_role=true before any SQL so RLS policies grant access.';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE marketplace_role NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'marketplace_role already exists or requires CREATEROLE privilege; skipping.';
END $$;

DO $$ BEGIN
  COMMENT ON ROLE marketplace_role IS
    'Role for public marketplace read endpoints. Sets app.is_marketplace_role=true.';
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;
COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';
CREATE TYPE public.actor_type AS ENUM (
    'member',
    'staff',
    'system',
    'customer',
    'webhook',
    'api_key'
);
CREATE TYPE public.custom_domain_status AS ENUM (
    'pending',
    'verifying',
    'verified',
    'cert_issuing',
    'live',
    'failed'
);
CREATE TYPE public.driver_assignment_status AS ENUM (
    'offered',
    'accepted',
    'picked_up',
    'delivered',
    'canceled'
);
CREATE TYPE public.driver_shift_status AS ENUM (
    'online',
    'paused',
    'offline'
);
CREATE TYPE public.fulfillment_type AS ENUM (
    'collection',
    'delivery',
    'dine_in'
);
CREATE TYPE public.kds_event_type AS ENUM (
    'fired',
    'started',
    'ready',
    'served',
    'bumped',
    'recalled',
    're_fired',
    'cancelled',
    'priority_changed',
    'rushed',
    'item_86ed',
    'note_added'
);
COMMENT ON TYPE public.kds_event_type IS 'Event log entry types for KDS ticket lifecycle. Values: fired, started, ready, served, bumped, recalled, re_fired, cancelled, priority_changed, rushed, item_86ed, note_added.';
CREATE TYPE public.order_status AS ENUM (
    'pending',
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'delivered',
    'completed',
    'cancelled',
    'pending_on_delivery'
);
CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'completed',
    'failed',
    'refunded',
    'partially_refunded'
);
CREATE TYPE public.provider_status AS ENUM (
    'active',
    'inactive',
    'testing'
);
CREATE TYPE public.topup_status AS ENUM (
    'initiated',
    'succeeded',
    'failed',
    'refunded'
);
CREATE TYPE public.wallet_txn_kind AS ENUM (
    'topup',
    'debit_llm',
    'debit_whatsapp',
    'debit_sms',
    'debit_bulk_import',
    'debit_overage',
    'refund',
    'adjustment'
);
CREATE TYPE public.whatsapp_link_intent AS ENUM (
    'bind',
    'order'
);
CREATE FUNCTION public._check_whatsapp_account_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF (
        SELECT count(*) FROM whatsapp_accounts WHERE profile_id = NEW.profile_id
    ) >= 3 THEN
        RAISE EXCEPTION 'profile % already has 3 WhatsApp accounts (maximum)', NEW.profile_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public._sync_whatsapp_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE profiles SET whatsapp_count = whatsapp_count + 1 WHERE id = NEW.profile_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE profiles SET whatsapp_count = GREATEST(whatsapp_count - 1, 0) WHERE id = OLD.profile_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE FUNCTION public.archive_old_audit_log(retain_days integer) RETURNS TABLE(moved_rows bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cutoff timestamptz;
BEGIN
    v_cutoff := now() - (retain_days || ' days')::interval;

    WITH deleted AS (
        DELETE FROM audit_log
        WHERE created_at < v_cutoff
        RETURNING *
    )
    INSERT INTO audit_log_archived SELECT * FROM deleted;

    GET DIAGNOSTICS moved_rows = ROW_COUNT;
    RETURN NEXT;
END;
$$;
COMMENT ON FUNCTION public.archive_old_audit_log(retain_days integer) IS 'Move audit_log rows older than retain_days days into audit_log_archived. Called by the Wave 4 compliance retention job. Returns count of moved rows.';
CREATE FUNCTION public.auto_86_from_inventory() RETURNS trigger
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

    -- Transition back to stocked: clear the 86 flag.
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
COMMENT ON FUNCTION public.auto_86_from_inventory() IS 'AFTER trigger function (attached in 005_inventory.sql on inventory_items). Flips items.is_86ed when linked inventory_items.current_stock crosses zero. Only activates when items.auto_86_when_inventory_empty = true. Preserved from legacy migration 28.';
CREATE FUNCTION public.calculate_recipe_cost(item_uuid uuid) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    total_cost decimal(10,2) := 0;
BEGIN
    SELECT COALESCE(SUM(cost_contribution), 0)
      INTO total_cost
      FROM get_item_components(item_uuid);
    RETURN total_cost;
END;
$$;
CREATE FUNCTION public.calculate_recipe_depth(item_uuid uuid) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    current_depth integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM item_recipes WHERE parent_item_id = item_uuid) THEN
        RETURN 0;
    END IF;

    SELECT COALESCE(MAX(calculate_recipe_depth(child_item_id)), 0) + 1
      INTO current_depth
      FROM item_recipes
     WHERE parent_item_id = item_uuid;

    RETURN COALESCE(current_depth, 0);
END;
$$;
COMMENT ON FUNCTION public.calculate_recipe_depth(item_uuid uuid) IS 'Recursively calculates the maximum recipe-tree depth for the given item. Returns 0 for items with no child recipes. Guard: item_tree CTE caps recursion at depth 10.';
CREATE FUNCTION public.cancel_invitation(p_user_id uuid, p_invite_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    user_role     text;
    invite_record organization_invites%ROWTYPE;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    SELECT * INTO invite_record
    FROM organization_invites WHERE id = p_invite_id AND status = 'pending';

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Invitation not found or already processed');
    END IF;

    SELECT role INTO user_role
    FROM organization_members
    WHERE organization_id = invite_record.organization_id AND profile_id = p_user_id;

    IF user_role IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'You are not a member of this organization');
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RETURN json_build_object('success', false, 'error', 'Insufficient permissions to cancel invitations');
    END IF;

    DELETE FROM organization_invites WHERE id = p_invite_id;

    RETURN json_build_object('success', true, 'message', 'Invitation cancelled successfully');
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;
CREATE FUNCTION public.check_circular_dependency(parent_id uuid, child_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    has_cycle boolean := false;
BEGIN
    -- A cycle exists if parent_id is already reachable as a component of child_id.
    SELECT EXISTS (
        SELECT 1
          FROM get_item_components(child_id)
         WHERE component_item_id = parent_id
    ) INTO has_cycle;

    RETURN NOT has_cycle;
END;
$$;
COMMENT ON FUNCTION public.check_circular_dependency(parent_id uuid, child_id uuid) IS 'Returns TRUE if adding (parent_id → child_id) to item_recipes is safe. Returns FALSE if parent_id is already a transitive component of child_id (which would create a cycle). Used in the item_recipes CHECK constraint.';
CREATE FUNCTION public.check_invites(p_user_id uuid) RETURNS TABLE(invite_id uuid, organization_id uuid, organization_name text, invited_by_name text, role text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    current_user_email text;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    SELECT email INTO current_user_email
    FROM profiles
    WHERE id = p_user_id;

    IF current_user_email IS NULL THEN
        RAISE EXCEPTION 'User profile not found';
    END IF;

    RETURN QUERY
    SELECT
        oi.id,
        oi.organization_id,
        o.name,
        COALESCE(p.full_name, p.username, 'Unknown'),
        oi.role,
        oi.created_at
    FROM organization_invites oi
    JOIN organizations o ON oi.organization_id = o.id
    LEFT JOIN profiles p ON oi.invited_by = p.id
    WHERE oi.email = current_user_email
      AND oi.status = 'pending'
      AND o.is_active = true
    ORDER BY oi.created_at DESC;
END;
$$;
CREATE FUNCTION public.current_actor_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT COALESCE(
    nullif(current_setting('app.current_actor_id', true), '')::uuid,
    nullif(current_setting('app.current_user_id', true), '')::uuid
  );
$$;
COMMENT ON FUNCTION public.current_actor_id() IS 'Returns the staff actor UUID from app.current_actor_id if set (PIN overlay), otherwise falls back to app.current_user_id. Used for audit attribution.';
CREATE FUNCTION public.current_capabilities() RETURNS jsonb
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT COALESCE(
    nullif(current_setting('app.current_capabilities', true), '')::jsonb,
    '{}'::jsonb
  );
$$;
COMMENT ON FUNCTION public.current_capabilities() IS 'Returns organization_members.capabilities jsonb for the current session. Returns {} (empty object) if not set.';
CREATE FUNCTION public.current_org_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT nullif(current_setting('app.current_org_id', true), '')::uuid;
$$;
COMMENT ON FUNCTION public.current_org_id() IS 'Returns the organization UUID from app.current_org_id session variable. Returns NULL if the variable is not set or is empty — which causes all org-scoped RLS policies to return zero rows.';
CREATE FUNCTION public.current_user_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;
COMMENT ON FUNCTION public.current_user_id() IS 'Returns the auth_users.id UUID from app.current_user_id session variable.';
CREATE FUNCTION public.default_member_capabilities() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only fill when capabilities are absent/empty so explicit grants are kept.
    IF NEW.capabilities IS NULL OR NEW.capabilities = '{}'::jsonb THEN
        IF NEW.role IN ('owner', 'manager', 'admin') THEN
            NEW.capabilities := jsonb_build_object(
                'can_pos',               true,
                'can_kitchen',           true,
                'can_void',              true,
                'can_comp',              true,
                'can_refund',            true,
                'can_settle',            true,
                'can_view_reports',      true,
                'can_manage_payroll',    true,
                'can_manage_bank',       true,
                'can_manage_inventory',  true,
                'can_view_inventory',    true,
                'can_manage_promotions', true,
                'can_manage_menu',       true,
                'can_drive',             false
            );
        ELSIF NEW.role = 'kitchen' THEN
            NEW.capabilities := jsonb_build_object('can_kitchen', true, 'can_view_inventory', true);
        ELSIF NEW.role = 'pos' THEN
            NEW.capabilities := jsonb_build_object('can_pos', true, 'can_settle', true);
        ELSIF NEW.role = 'driver' THEN
            NEW.capabilities := jsonb_build_object('can_drive', true);
        END IF;
        -- role='staff' keeps an empty capability set (explicit grants only).
    END IF;
    RETURN NEW;
END;
$$;
CREATE FUNCTION public.get_item_components(item_uuid uuid, current_level integer DEFAULT 1) RETURNS TABLE(component_item_id uuid, component_name text, total_quantity numeric, unit text, level_depth integer, cost_contribution numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE item_tree AS (
        -- Base case: direct children
        SELECT
            ir.child_item_id                                                                   AS component_item_id,
            i.name                                                                             AS component_name,
            ir.quantity_needed::decimal(10,3)                                                  AS total_quantity,
            ir.unit                                                                            AS unit,
            current_level                                                                      AS level_depth,
            (ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0))::decimal(10,2) AS cost_contribution
        FROM item_recipes ir
        JOIN items i ON ir.child_item_id = i.id
        WHERE ir.parent_item_id = item_uuid

        UNION ALL

        -- Recursive case: children of children (cap at depth 10 to prevent infinite loops)
        SELECT
            ir.child_item_id                                                                         AS component_item_id,
            i.name                                                                                   AS component_name,
            (it.total_quantity * ir.quantity_needed)::decimal(10,3)                                  AS total_quantity,
            ir.unit                                                                                  AS unit,
            (it.level_depth + 1)                                                                     AS level_depth,
            (it.total_quantity * ir.quantity_needed * COALESCE(ir.cost_per_unit, i.cost_price, 0))::decimal(10,2) AS cost_contribution
        FROM item_tree it
        JOIN item_recipes ir ON it.component_item_id = ir.parent_item_id
        JOIN items i ON ir.child_item_id = i.id
        WHERE it.level_depth < 10
    )
    SELECT it.component_item_id,
           it.component_name,
           it.total_quantity,
           it.unit,
           it.level_depth,
           it.cost_contribution
      FROM item_tree it
     ORDER BY it.level_depth, it.component_name;
END;
$$;
COMMENT ON FUNCTION public.get_item_components(item_uuid uuid, current_level integer) IS 'Returns all components (ingredients) of an item via recursive CTE. Recursion is capped at depth 10. cost_contribution = quantity * cost_per_unit or falls back to items.cost_price.';
CREATE FUNCTION public.handle_new_organization() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    -- Skip if a location already exists for this org.
    IF EXISTS (SELECT 1 FROM public.locations WHERE organization_id = NEW.id) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.locations (organization_id, name)
    VALUES (NEW.id, NEW.name);

    RETURN NEW;
END;
$$;
CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    new_profile_id    uuid;
    proposed_username text;
    final_username    text;
    username_counter  integer := 1;
    username_exists   boolean;
    invite_count      integer;
BEGIN
    proposed_username := COALESCE(
        NULLIF(trim(new.raw_user_meta_data->>'username'), ''),
        split_part(new.email, '@', 1)
    );

    IF char_length(proposed_username) < 3 THEN
        proposed_username := proposed_username || '123';
    END IF;

    final_username := proposed_username;
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM public.profiles WHERE username = final_username
        ) INTO username_exists;
        EXIT WHEN NOT username_exists;
        final_username := proposed_username || username_counter::text;
        username_counter := username_counter + 1;
    END LOOP;

    INSERT INTO public.profiles (id, full_name, email, avatar_url, username)
    VALUES (
        new.id,
        new.raw_user_meta_data->>'full_name',
        new.email,
        new.raw_user_meta_data->>'avatar_url',
        final_username
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO new_profile_id;

    IF new_profile_id IS NULL THEN
        SELECT id INTO new_profile_id FROM public.profiles WHERE id = new.id;
    END IF;

    SELECT count(*) INTO invite_count
    FROM public.organization_invites
    WHERE email = new.email AND status = 'pending';

    IF invite_count > 0 THEN
        INSERT INTO public.organization_members (organization_id, profile_id, role)
        SELECT organization_id, new_profile_id, role
        FROM public.organization_invites
        WHERE email = new.email AND status = 'pending'
        ON CONFLICT (organization_id, profile_id) DO NOTHING;

        UPDATE public.organization_invites
        SET status = 'accepted', updated_at = now()
        WHERE email = new.email AND status = 'pending';
    END IF;

    RETURN new;
END;
$$;
CREATE FUNCTION public.has_capability(cap text) RETURNS boolean
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT COALESCE((current_capabilities() ->> cap)::bool, false);
$$;
COMMENT ON FUNCTION public.has_capability(cap text) IS 'Returns true if the named capability key is set to true in the current session capabilities.';
CREATE FUNCTION public.is_marketplace_role() RETURNS boolean
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT COALESCE(nullif(current_setting('app.is_marketplace_role', true), '')::bool, false);
$$;
COMMENT ON FUNCTION public.is_marketplace_role() IS 'Returns true when app.is_marketplace_role is set to true. Used in RLS policies to allow narrow public SELECT on is_marketplace_visible rows.';
CREATE FUNCTION public.is_service_role() RETURNS boolean
    LANGUAGE sql STABLE PARALLEL SAFE
    AS $$
  SELECT COALESCE(nullif(current_setting('app.is_service_role', true), '')::bool, false);
$$;
COMMENT ON FUNCTION public.is_service_role() IS 'Returns true when app.is_service_role is set to true. Used in RLS policies to allow system jobs and migration runners to see all rows.';
CREATE FUNCTION public.latest_exchange_rate(base text, quote text) RETURNS numeric
    LANGUAGE sql STABLE
    AS $$
    SELECT rate
    FROM   exchange_rates
    WHERE  from_currency = base
      AND  to_currency   = quote
      AND  (expires_at IS NULL OR expires_at > now())
    ORDER  BY fetched_at DESC
    LIMIT  1;
$$;
COMMENT ON FUNCTION public.latest_exchange_rate(base text, quote text) IS 'Returns the most recent non-expired FX rate for the given (base, quote) currency pair.  Returns NULL when no valid snapshot exists.  Used for order FX conversion.';
CREATE FUNCTION public.list_organization_invitations(p_user_id uuid, p_organization_id uuid) RETURNS TABLE(invite_id uuid, email text, role text, invited_by_name text, created_at timestamp with time zone, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    user_role text;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;

    SELECT om.role INTO user_role
    FROM organization_members om
    WHERE om.organization_id = p_organization_id AND om.profile_id = p_user_id;

    IF user_role IS NULL THEN
        RAISE EXCEPTION 'You are not a member of this organization';
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RAISE EXCEPTION 'Insufficient permissions to view invitations';
    END IF;

    RETURN QUERY
    SELECT
        oi.id,
        oi.email,
        oi.role,
        COALESCE(p.full_name, p.username, 'Unknown'),
        oi.created_at,
        oi.status
    FROM organization_invites oi
    LEFT JOIN profiles p ON oi.invited_by = p.id
    WHERE oi.organization_id = p_organization_id
    ORDER BY oi.created_at DESC;
END;
$$;
CREATE FUNCTION public.lookup_location_by_slug(p_slug text) RETURNS TABLE(id uuid, organization_id uuid, name text, slug text, description text, city text, country text, address text, currency_code text, offers_delivery boolean, offers_collection boolean, on_delivery_payment_methods text[], is_marketplace_visible boolean, is_active boolean, estimated_prep_time integer)
    LANGUAGE sql STABLE
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
COMMENT ON FUNCTION public.lookup_location_by_slug(p_slug text) IS 'Resolves a store slug to its full location row. Returns 0 rows when the slug is unknown or the location is not active (middleware treats 0 rows as an unknown/reserved subdomain and falls through). is_marketplace_visible is NOT filtered — the subdomain middleware must resolve PIN-login locations even when they opt out of marketplace listing. SECURITY INVOKER: RLS on locations applies. marketplace_role callers see only is_marketplace_visible = true rows per the locations_select_marketplace policy. EXECUTE granted to PUBLIC because slug resolution is a public routing operation. Audit finding [2]: closes the Wave-7 T7.6 missing-function promise.';
CREATE TABLE public.driver_location_pings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_member_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    accuracy_m real,
    heading_deg real,
    speed_mps real,
    recorded_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
)
PARTITION BY RANGE (recorded_at);
ALTER TABLE ONLY public.driver_location_pings FORCE ROW LEVEL SECURITY;
CREATE FUNCTION public.pings_visible_to_customer(track_token text) RETURNS SETOF public.driver_location_pings
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    v_order_id          uuid;
    v_customer_profile  uuid;
    v_order_status      order_status;
    v_delivery_lat      double precision;
    v_delivery_lng      double precision;
    v_driver_member_id  uuid;
    v_caller_user_id    uuid;
    v_ping              driver_location_pings;
    v_dist_km           double precision;
    v_dlat              double precision;
    v_dlng              double precision;
    v_a                 double precision;
BEGIN
    v_caller_user_id := current_user_id();
    IF v_caller_user_id IS NULL THEN
        RETURN;
    END IF;

    SELECT ott.order_id, ott.customer_profile_id
    INTO v_order_id, v_customer_profile
    FROM order_tracking_tokens ott
    WHERE ott.token = track_token
      AND ott.revoked_at IS NULL
      AND ott.expires_at > now();
    IF NOT FOUND THEN RETURN; END IF;

    -- profiles.id = auth_users.id = the value returned by current_user_id()
    IF NOT EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = v_customer_profile
          AND p.id = v_caller_user_id
    ) THEN
        RETURN;
    END IF;

    SELECT o.status INTO v_order_status FROM orders o WHERE o.id = v_order_id;
    IF v_order_status IS DISTINCT FROM 'out_for_delivery' THEN RETURN; END IF;

    SELECT ca.latitude::double precision, ca.longitude::double precision
    INTO v_delivery_lat, v_delivery_lng
    FROM orders o
    JOIN customer_addresses ca ON ca.id = o.delivery_address_id
    WHERE o.id = v_order_id;
    IF v_delivery_lat IS NULL THEN RETURN; END IF;

    SELECT da.driver_member_id INTO v_driver_member_id
    FROM driver_assignments da
    WHERE da.order_id = v_order_id
      AND da.status IN ('accepted', 'picked_up')
    ORDER BY da.offered_at DESC
    LIMIT 1;
    IF v_driver_member_id IS NULL THEN RETURN; END IF;

    -- Fetch latest ping
    SELECT * INTO v_ping
    FROM driver_location_pings p
    WHERE p.driver_member_id = v_driver_member_id
    ORDER BY p.recorded_at DESC
    LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;

    -- Haversine distance check (< 5 km)
    v_dlat  := radians(v_ping.lat - v_delivery_lat);
    v_dlng  := radians(v_ping.lng - v_delivery_lng);
    v_a     := sin(v_dlat / 2) ^ 2
             + cos(radians(v_delivery_lat)) * cos(radians(v_ping.lat))
             * sin(v_dlng / 2) ^ 2;
    v_dist_km := 2.0 * 6371.0 * asin(sqrt(v_a));

    IF v_dist_km <= 5.0 THEN
        RETURN NEXT v_ping;
    END IF;

    RETURN;
END;
$$;
COMMENT ON FUNCTION public.pings_visible_to_customer(track_token text) IS 'Returns the latest driver_location_pings row for a tracking token ONLY when: (a) the order is out_for_delivery, (b) the driver is within 5 km of the delivery address, (c) the calling session user_id matches the token''s customer_profile_id. Returns 0 rows in all other cases. Uses haversine approximation; PostGIS deferred.';
CREATE FUNCTION public.queue_kds_fanout() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.status IN ('confirmed', 'preparing', 'ready')
       AND (OLD IS NULL OR OLD.status NOT IN ('confirmed', 'preparing', 'ready'))
    THEN
        -- Elevate to service role for the restricted insert, then drop back.
        PERFORM set_config('app.is_service_role', 'true', true);
        INSERT INTO kds_fanout_queue (order_id)
        VALUES (NEW.id)
        ON CONFLICT (order_id) DO NOTHING;
        PERFORM set_config('app.is_service_role', '', true);
    END IF;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.queue_kds_fanout() IS 'Trigger: enqueues an order for KDS fan-out when status first enters a kitchen-active state (confirmed, preparing, ready). Idempotent via ON CONFLICT.';
CREATE FUNCTION public.refresh_reporting_views() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- no-op: all reporting views in 014 are non-materialized plain views.
    -- Add: REFRESH MATERIALIZED VIEW CONCURRENTLY <name>; when promoted.
    RETURN;
END;
$$;
COMMENT ON FUNCTION public.refresh_reporting_views() IS 'Refreshes any materialized reporting views. Currently a no-op — all reporting views in migration 014 are plain CREATE OR REPLACE VIEWs. Add REFRESH MATERIALIZED VIEW CONCURRENTLY calls here when promoted.';
CREATE FUNCTION public.respond_invitation(p_user_id uuid, p_invite_id uuid, p_accept boolean) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    current_user_email text;
    invite_record organization_invites%ROWTYPE;
    result json;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    SELECT email INTO current_user_email
    FROM profiles WHERE id = p_user_id;

    IF current_user_email IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'User profile not found');
    END IF;

    SELECT oi.* INTO invite_record
    FROM organization_invites oi
    JOIN organizations o ON oi.organization_id = o.id
    WHERE oi.id = p_invite_id
      AND oi.email = current_user_email
      AND oi.status = 'pending'
      AND o.is_active = true;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'No pending invitation found or invitation expired');
    END IF;

    IF p_accept THEN
        UPDATE organization_invites
        SET status = 'accepted', updated_at = now()
        WHERE id = invite_record.id;

        INSERT INTO organization_members (organization_id, profile_id, role)
        VALUES (invite_record.organization_id, p_user_id, invite_record.role)
        ON CONFLICT (organization_id, profile_id) DO UPDATE SET
            role = EXCLUDED.role,
            updated_at = now();

        result := json_build_object(
            'success', true,
            'message', 'Invitation accepted successfully',
            'organization_id', invite_record.organization_id,
            'role', invite_record.role
        );
    ELSE
        UPDATE organization_invites
        SET status = 'rejected', updated_at = now()
        WHERE id = invite_record.id;

        result := json_build_object('success', true, 'message', 'Invitation rejected');
    END IF;

    RETURN result;
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;
CREATE FUNCTION public.send_invitation(p_user_id uuid, p_organization_id uuid, p_email text, p_role text DEFAULT 'staff'::text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
    organization_exists   boolean;
    user_is_member        boolean;
    user_role             text;
    invite_exists         boolean;
    user_already_member   boolean;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'user_id is required');
    END IF;

    IF p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RETURN json_build_object('success', false, 'error', 'Invalid email format');
    END IF;

    IF p_role NOT IN ('owner', 'manager', 'staff', 'admin', 'kitchen', 'pos', 'driver') THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid role. Must be owner, manager, staff, admin, kitchen, pos, or driver'
        );
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organizations WHERE id = p_organization_id AND is_active = true
    ) INTO organization_exists;

    IF NOT organization_exists THEN
        RETURN json_build_object('success', false, 'error', 'Organization not found or inactive');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_members
        WHERE organization_id = p_organization_id AND profile_id = p_user_id
    ),
    COALESCE(
        (SELECT role FROM organization_members
         WHERE organization_id = p_organization_id AND profile_id = p_user_id),
        'none'
    ) INTO user_is_member, user_role;

    IF NOT user_is_member THEN
        RETURN json_build_object('success', false, 'error', 'You are not a member of this organization');
    END IF;

    IF user_role NOT IN ('owner', 'manager', 'admin') THEN
        RETURN json_build_object('success', false, 'error', 'Insufficient permissions to send invitations');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_members om
        JOIN profiles p ON om.profile_id = p.id
        WHERE om.organization_id = p_organization_id AND p.email = p_email
    ) INTO user_already_member;

    IF user_already_member THEN
        RETURN json_build_object('success', false, 'error', 'User is already a member of this organization');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM organization_invites
        WHERE organization_id = p_organization_id
          AND email = p_email
          AND status = 'pending'
    ) INTO invite_exists;

    IF invite_exists THEN
        RETURN json_build_object('success', false, 'error', 'A pending invitation already exists for this email');
    END IF;

    INSERT INTO organization_invites (organization_id, email, invited_by, role, status)
    VALUES (p_organization_id, p_email, p_user_id, p_role, 'pending');

    RETURN json_build_object(
        'success', true,
        'message', 'Invitation sent successfully',
        'invited_email', p_email,
        'role', p_role
    );
EXCEPTION WHEN others THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$_$;
CREATE FUNCTION public.set_updated_at_now() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.set_updated_at_now() IS 'Trigger function: sets updated_at to the current UTC timestamp on row update. Used by BEFORE UPDATE triggers on all tables with an updated_at column.';
CREATE FUNCTION public.trg_fn_course_fire_on_bump() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_order_id          uuid;
    v_location_id       uuid;
    v_ticket_course_num integer;
    v_next_course_id    uuid;
    v_next_sort_order   integer;
    v_already_queued    boolean;
BEGIN
    -- Only act on 'bumped' events.
    IF NEW.event_type <> 'bumped' THEN
        RETURN NEW;
    END IF;

    -- Resolve order_id and location_id from the bumped ticket.
    SELECT kt.order_id, o.location_id, kt.course_number
      INTO v_order_id, v_location_id, v_ticket_course_num
      FROM kds_tickets kt
      JOIN orders o ON o.id = kt.order_id
     WHERE kt.id = NEW.ticket_id;

    -- If we couldn't resolve (e.g. ticket/order deleted mid-flight), exit.
    IF v_order_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- No course_number set on the ticket — nothing to fire next.
    IF v_ticket_course_num IS NULL THEN
        RETURN NEW;
    END IF;

    -- Find the NEXT course in sort_order after the bumped course's sort_order,
    -- in the same location, that has fire_on_previous_course_bumped = true.
    -- We use sort_order as the ordering axis (courses.sort_order defined in 004).
    SELECT c.id, c.sort_order
      INTO v_next_course_id, v_next_sort_order
      FROM courses c
     WHERE c.location_id = v_location_id
       AND c.is_active   = true
       AND c.fire_on_previous_course_bumped = true
       AND c.sort_order > v_ticket_course_num
     ORDER BY c.sort_order ASC
     LIMIT 1;

    -- No eligible next course — nothing to fire.
    IF v_next_course_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Double-fire guard: check whether any order_item for this order that belongs
    -- to the next course is already represented in kds_fanout_queue (pending or
    -- processing). We check at the order level because kds_fanout_queue has a
    -- UNIQUE(order_id) constraint — one row per order, regardless of course.
    -- If the order is already queued (for ANY course), we skip to avoid
    -- overwriting a live fanout in progress.
    SELECT EXISTS (
        SELECT 1
          FROM kds_fanout_queue kfq
         WHERE kfq.order_id = v_order_id
           AND kfq.state IN ('pending', 'processing')
    ) INTO v_already_queued;

    IF v_already_queued THEN
        RETURN NEW;
    END IF;

    -- Also guard: check whether a kds_ticket already exists for any next-course
    -- item on this order (meaning the course was already fanned out via a prior
    -- enqueue that completed). This covers the case where the queue row was
    -- deleted after processing.
    IF EXISTS (
        SELECT 1
          FROM kds_tickets kt2
          JOIN orders o2 ON o2.id = kt2.order_id
         WHERE kt2.order_id   = v_order_id
           AND kt2.course_number = v_next_sort_order
           AND kt2.status NOT IN ('cancelled')
    ) THEN
        RETURN NEW;
    END IF;

    -- Elevate to service-role for the restricted INSERT into kds_fanout_queue
    -- (RLS on kds_fanout_queue restricts INSERT to is_service_role() — see 008).
    -- Pattern mirrors migration 020 (queue_kds_fanout trigger).
    PERFORM set_config('app.is_service_role', 'true', true);

    INSERT INTO kds_fanout_queue (order_id, state, retry_count)
    VALUES (v_order_id, 'pending', 0)
    ON CONFLICT (order_id) DO NOTHING;

    -- Restore scope: drop back to whatever the caller's session had.
    PERFORM set_config('app.is_service_role', '', true);

    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.trg_fn_course_fire_on_bump() IS 'NEW (Wave 11). AFTER INSERT trigger on kds_ticket_events. When event_type = ''bumped'', looks up the next course (courses.sort_order) in the same location that has fire_on_previous_course_bumped = true. If found and not already queued, enqueues the order in kds_fanout_queue (service-role elevation follows the migration 020 pattern). Double-fire guard: UNIQUE(order_id) + EXISTS check on active queue rows + EXISTS check on already-fanned-out tickets for the next course.';
CREATE FUNCTION public.trg_fn_item_default_station_routing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_station_id uuid;
BEGIN
    SELECT id INTO v_station_id
    FROM kitchen_stations
    WHERE location_id = NEW.location_id AND name = 'Kitchen'
    LIMIT 1;

    IF v_station_id IS NULL THEN
        RAISE NOTICE
            'trg_fn_item_default_station_routing: no Kitchen station for location_id=%, '
            'item_id=% — skipping',
            NEW.location_id, NEW.id;
        RETURN NEW;
    END IF;

    INSERT INTO item_station_routing (item_id, station_id, is_primary)
    VALUES (NEW.id, v_station_id, true)
    ON CONFLICT (item_id, station_id) DO NOTHING;

    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.trg_fn_item_default_station_routing() IS 'Trigger: routes a newly inserted item to its location''s Kitchen station.';
CREATE FUNCTION public.trg_fn_location_default_kitchen_station() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO kitchen_stations (location_id, name, station_type, sort_order, is_active)
    VALUES (NEW.id, 'Kitchen', 'prep', 0, true)
    ON CONFLICT (location_id, name) DO NOTHING;
    RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.trg_fn_location_default_kitchen_station() IS 'Trigger: creates a default ''Kitchen'' station when a new location is inserted.';
CREATE FUNCTION public.trigger_update_recipe_metadata() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        PERFORM update_recipe_metadata(NEW.parent_item_id);
        PERFORM update_recipe_metadata(ir.parent_item_id)
          FROM item_recipes ir
         WHERE ir.child_item_id = NEW.parent_item_id;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM update_recipe_metadata(OLD.parent_item_id);
        PERFORM update_recipe_metadata(ir.parent_item_id)
          FROM item_recipes ir
         WHERE ir.child_item_id = OLD.parent_item_id;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE FUNCTION public.update_recipe_metadata(item_uuid uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    depth           integer;
    component_count integer;
    complexity      text;
    calculated_cost decimal(10,2);
BEGIN
    depth := calculate_recipe_depth(item_uuid);

    SELECT COUNT(*)
      INTO component_count
      FROM get_item_components(item_uuid);

    IF depth = 0 THEN
        complexity := 'simple';
    ELSIF depth <= 2 AND component_count <= 5 THEN
        complexity := 'moderate';
    ELSE
        complexity := 'complex';
    END IF;

    calculated_cost := calculate_recipe_cost(item_uuid);

    UPDATE items
       SET max_recipe_level = depth,
           total_components  = component_count,
           recipe_complexity = complexity,
           recipe_type = CASE WHEN depth = 0 THEN 'simple' ELSE 'recipe' END,
           cost_price  = CASE WHEN auto_calculate_cost THEN calculated_cost ELSE cost_price END,
           updated_at  = timezone('utc', now())
     WHERE id = item_uuid;
END;
$$;
CREATE TABLE public.adjustment_reasons (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    adjustment_type text NOT NULL,
    requires_manager_approval boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT adjustment_reasons_adjustment_type_check CHECK ((adjustment_type = ANY (ARRAY['void'::text, 'comp'::text, 'price_override'::text, 'manager_discount'::text, 'refund'::text]))),
    CONSTRAINT adjustment_reasons_location_id_code_key UNIQUE (location_id, code),
    CONSTRAINT adjustment_reasons_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.adjustment_reasons FORCE ROW LEVEL SECURITY;
CREATE TABLE public.allergens (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    icon text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT allergens_organization_id_code_key UNIQUE (organization_id, code),
    CONSTRAINT allergens_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.allergens FORCE ROW LEVEL SECURITY;
CREATE TABLE public.api_keys (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    name text NOT NULL,
    prefix_visible text NOT NULL,
    key_hash text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_by uuid,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    environment text DEFAULT 'live'::text NOT NULL,
    CONSTRAINT api_keys_environment_check CHECK ((environment = ANY (ARRAY['live'::text, 'test'::text]))),
    CONSTRAINT api_keys_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.api_keys FORCE ROW LEVEL SECURITY;
CREATE VIEW public.api_keys_safe WITH (security_invoker='on') AS
 SELECT id,
    org_id,
    name,
    prefix_visible,
    scopes,
    expires_at,
    last_used_at,
    created_by,
    revoked_at,
    created_at,
    updated_at
   FROM public.api_keys;
COMMENT ON VIEW public.api_keys_safe IS 'Public-safe view of api_keys: key_hash column excluded. Non-service_role code must query this view, never the base table.';
CREATE TABLE public.audit_log (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    location_id uuid,
    actor_type public.actor_type NOT NULL,
    actor_id uuid,
    actor_label text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    before_state jsonb,
    after_state jsonb,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT audit_log_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.audit_log FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.audit_log IS 'Append-only audit trail. Written exclusively by application code via the service role (not by DB triggers). actor_type uses the actor_type enum from migration 001. No updated_at — rows are immutable once inserted.';
CREATE TABLE public.audit_log_archived (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    location_id uuid,
    actor_type public.actor_type NOT NULL,
    actor_id uuid,
    actor_label text,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    before_state jsonb,
    after_state jsonb,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    ip inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT audit_log_archived_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.audit_log_archived FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.audit_log_archived IS 'Cold archive of audit_log rows older than the retention window. Populated by archive_old_audit_log(retain_days). Queried by the Wave 4 compliance export job only; not surfaced to tenant-facing API.';
CREATE TABLE public.auth_users (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text,
    email_verified boolean DEFAULT false NOT NULL,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_sign_in_at timestamp with time zone,
    is_platform_admin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    totp_secret_ciphertext text,
    totp_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT auth_users_email_key UNIQUE (email),
    CONSTRAINT auth_users_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.auth_users FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.auth_users.totp_secret_ciphertext IS 'AES-256-GCM ciphertext of the base32 TOTP secret (secretbox format: base64(nonce||sealed)). NULL when TOTP not enrolled.';
COMMENT ON COLUMN public.auth_users.totp_enabled IS 'true once the user has successfully verified their TOTP device. Prevents half-enrolled accounts from being gated.';
CREATE TABLE public.cart_item_variations (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cart_item_id uuid NOT NULL,
    variation_id uuid NOT NULL,
    option_id uuid NOT NULL,
    price_modifier numeric(10,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT cart_item_variations_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.cart_item_variations FORCE ROW LEVEL SECURITY;
CREATE TABLE public.cart_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    location_id uuid NOT NULL,
    item_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(10,2) NOT NULL,
    total_price numeric(10,2) NOT NULL,
    special_instructions text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT cart_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT cart_items_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.cart_items FORCE ROW LEVEL SECURITY;
CREATE TABLE public.cash_drawer_counts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cash_drawer_session_id uuid NOT NULL,
    count_type text NOT NULL,
    total_cents bigint NOT NULL,
    denominations jsonb,
    counted_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT cash_drawer_counts_count_type_check CHECK ((count_type = ANY (ARRAY['open'::text, 'close'::text, 'mid_shift'::text]))),
    CONSTRAINT cash_drawer_counts_total_cents_check CHECK ((total_cents >= 0)),
    CONSTRAINT cash_drawer_counts_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.cash_drawer_counts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.cash_drawer_movements (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cash_drawer_session_id uuid NOT NULL,
    movement_type text NOT NULL,
    amount_cents bigint NOT NULL,
    reason text,
    reference_type text,
    reference_id uuid,
    performed_by uuid,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT cash_drawer_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['paid_in'::text, 'paid_out'::text, 'petty_cash'::text, 'tip_out'::text, 'no_sale'::text, 'drop'::text, 'pickup'::text]))),
    CONSTRAINT cash_drawer_movements_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.cash_drawer_movements FORCE ROW LEVEL SECURITY;
CREATE TABLE public.cash_drawer_session_payments (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cash_drawer_session_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT cash_drawer_session_payments_payment_id_key UNIQUE (payment_id),
    CONSTRAINT cash_drawer_session_payments_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.cash_drawer_session_payments FORCE ROW LEVEL SECURITY;
CREATE TABLE public.cash_drawer_sessions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cash_drawer_id uuid NOT NULL,
    opened_by uuid,
    closed_by uuid,
    opening_float_cents bigint DEFAULT 0 NOT NULL,
    declared_closing_cents bigint,
    expected_closing_cents bigint,
    over_short_cents bigint,
    is_blind_close boolean DEFAULT false NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    closed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    cashier_label text,
    CONSTRAINT cash_drawer_sessions_opening_float_cents_check CHECK ((opening_float_cents >= 0)),
    CONSTRAINT cash_drawer_sessions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'reconciled'::text]))),
    CONSTRAINT cash_drawer_sessions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.cash_drawer_sessions FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.cash_drawer_sessions.cashier_label IS 'Optional human-readable label identifying the cashier or terminal context for this session, e.g. "Alice" or "Till 1 – Bob". Dual-cashier setup: each cashier has their own cash_drawer row and opens their own session; this label appears on shift reports and drawer-count screens so staff can tell the sessions apart at a glance. NULL for single-cashier locations. Wave 32 dual-cash-drawer feature.';
CREATE TABLE public.order_payments (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    payment_method_code text NOT NULL,
    amount_paid_cents bigint NOT NULL,
    tip_amount_cents bigint DEFAULT 0 NOT NULL,
    change_given_cents bigint DEFAULT 0 NOT NULL,
    payment_reference text,
    external_transaction_id text,
    payment_status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    paid_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    confirmed_at timestamp with time zone,
    processed_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_payments_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.order_payments FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.order_payments IS 'Records a tender applied to an order (cash, card machine, transfer, voucher). No card processing happens here — the money already moved at the counter. FK order_id → orders(id) is added by migration 008.';
CREATE TABLE public.payment_methods (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    kind text DEFAULT 'offline'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    requires_reference boolean DEFAULT false NOT NULL,
    supports_tips boolean DEFAULT true NOT NULL,
    processing_fee_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    fixed_fee_cents integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT payment_methods_kind_check CHECK ((kind = 'offline'::text)),
    CONSTRAINT payment_methods_code_key UNIQUE (code),
    CONSTRAINT payment_methods_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE public.payment_methods IS 'Platform-wide registry of accepted payment methods. Not RLS-protected — public SELECT; only service_role may mutate. Seed data lives in migration 014.';
CREATE VIEW public.cash_drawer_eod_report WITH (security_invoker='on') AS
 WITH session_method_payments AS (
         SELECT cdsp.cash_drawer_session_id AS session_id,
            op.payment_method_code AS method_code,
            (COALESCE(sum(op.amount_paid_cents), (0)::numeric))::bigint AS method_total_cents
           FROM (public.cash_drawer_session_payments cdsp
             JOIN public.order_payments op ON ((op.id = cdsp.payment_id)))
          WHERE (op.payment_status = 'completed'::public.payment_status)
          GROUP BY cdsp.cash_drawer_session_id, op.payment_method_code
        ), session_cash_movements AS (
         SELECT cdm.cash_drawer_session_id AS session_id,
            (COALESCE(sum(
                CASE
                    WHEN (cdm.amount_cents > 0) THEN cdm.amount_cents
                    ELSE (0)::bigint
                END), (0)::numeric))::bigint AS movements_in_cents,
            (COALESCE(sum(
                CASE
                    WHEN (cdm.amount_cents < 0) THEN (- cdm.amount_cents)
                    ELSE (0)::bigint
                END), (0)::numeric))::bigint AS movements_out_cents,
            (COALESCE(sum(cdm.amount_cents), (0)::numeric))::bigint AS movements_net_cents
           FROM public.cash_drawer_movements cdm
          GROUP BY cdm.cash_drawer_session_id
        )
 SELECT s.id AS session_id,
    s.cash_drawer_id,
    s.opened_at,
    s.closed_at,
    s.status,
    pm.code AS payment_method_code,
    pm.name AS payment_method_name,
        CASE
            WHEN (pm.code = 'cash'::text) THEN ((COALESCE(s.opening_float_cents, (0)::bigint) + COALESCE(scm.movements_net_cents, (0)::bigint)) + COALESCE(smp.method_total_cents, (0)::bigint))
            ELSE COALESCE(smp.method_total_cents, (0)::bigint)
        END AS expected_cents,
        CASE
            WHEN (pm.code = 'cash'::text) THEN COALESCE(scm.movements_in_cents, (0)::bigint)
            ELSE (0)::bigint
        END AS cash_movements_in_cents,
        CASE
            WHEN (pm.code = 'cash'::text) THEN COALESCE(scm.movements_out_cents, (0)::bigint)
            ELSE (0)::bigint
        END AS cash_movements_out_cents,
    s.declared_closing_cents AS declared_cents,
    s.over_short_cents
   FROM (((public.cash_drawer_sessions s
     LEFT JOIN session_method_payments smp ON ((smp.session_id = s.id)))
     LEFT JOIN public.payment_methods pm ON ((pm.code = smp.method_code)))
     LEFT JOIN session_cash_movements scm ON ((scm.session_id = s.id)))
  WHERE ((pm.code IS NOT NULL) OR (EXISTS ( SELECT 1
           FROM session_cash_movements scm2
          WHERE (scm2.session_id = s.id))));
COMMENT ON VIEW public.cash_drawer_eod_report IS 'Per (session, payment_method) EOD reconciliation. Cash row includes opening float + net movements. Non-cash rows show tender total only. security_invoker = on.';
CREATE TABLE public.cash_drawers (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT cash_drawers_location_id_name_key UNIQUE (location_id, name),
    CONSTRAINT cash_drawers_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.cash_drawers FORCE ROW LEVEL SECURITY;
CREATE TABLE public.categories (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    parent_id uuid,
    name text NOT NULL,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT categories_location_id_name_key UNIQUE (location_id, name),
    CONSTRAINT categories_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.categories FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.categories IS 'Menu categories, organization-scoped via both location_id and organization_id. organization_id is the RLS anchor; location_id drives the display context.';
CREATE TABLE public.category_station_routing (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    station_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT category_station_routing_category_id_station_id_key UNIQUE (category_id, station_id),
    CONSTRAINT category_station_routing_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.category_station_routing FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.category_station_routing IS 'Routes an entire menu category to a kitchen station. Lower priority than item_station_routing — used as a fallback when no explicit item routing exists.';
CREATE TABLE public.check_split_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    check_split_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    quantity numeric(10,3) NOT NULL,
    CONSTRAINT check_split_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT check_split_items_check_split_id_order_item_id_key UNIQUE (check_split_id, order_item_id),
    CONSTRAINT check_split_items_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.check_split_items FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.check_split_items IS 'Associates order_items with a check_split. quantity supports partial allocations (e.g. a shared appetizer split 0.5 / 0.5 across two splits).';
CREATE TABLE public.check_splits (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_session_id uuid NOT NULL,
    split_label text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT check_splits_pkey PRIMARY KEY (id),
    CONSTRAINT check_splits_table_session_id_split_label_key UNIQUE (table_session_id, split_label)
);
ALTER TABLE ONLY public.check_splits FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.check_splits IS 'Sub-checks within a table session, enabling split-by-person / split-by-item billing. Each split maps to one or more order_items via check_split_items.';
CREATE TABLE public.coupon_codes (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promotion_id uuid NOT NULL,
    code text NOT NULL,
    max_uses integer DEFAULT 1 NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    assigned_to_customer_id uuid,
    active_from timestamp with time zone,
    active_until timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT coupon_codes_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.coupon_codes FORCE ROW LEVEL SECURITY;
CREATE TABLE public.courses (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    fire_on_previous_course_bumped boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT courses_location_id_name_key UNIQUE (location_id, name),
    CONSTRAINT courses_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.courses FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.courses IS 'NEW (ROADMAP Now-22). Named kitchen fire courses. fire_on_previous_course_bumped=true tells the KDS fanout worker to automatically fire this course when the preceding course is bumped.';
CREATE TABLE public.currencies (

    code text NOT NULL,
    name text NOT NULL,
    symbol text NOT NULL,
    decimal_digits integer DEFAULT 2 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT currencies_pkey PRIMARY KEY (code)
);
COMMENT ON TABLE public.currencies IS 'ISO 4217 currency reference. Global — not tenant-scoped. Mutable only by service_role.';
COMMENT ON COLUMN public.currencies.decimal_digits IS 'ISO 4217 minor-unit exponent: 2 for most, 0 for JPY/KRW/ISK/CLP/VND/XOF, 3 for the Gulf dinars (KWD/BHD/OMR/JOD/TND). This is the ONLY correct source for the amount↔minor-unit conversion. A literal /100 in application code is a bug: it renders ¥1000 as ¥10 and KD 1.000 as KD 10.00.';
CREATE TABLE public.custom_domains (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    hostname text NOT NULL,
    status public.custom_domain_status DEFAULT 'pending'::public.custom_domain_status NOT NULL,
    verification_token text DEFAULT (replace((gen_random_uuid())::text, '-'::text, ''::text) || replace((gen_random_uuid())::text, '-'::text, ''::text)),
    verified_at timestamp with time zone,
    cert_issued_at timestamp with time zone,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT custom_domains_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.custom_domains FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.custom_domains IS 'Custom hostnames attached to BeepBite locations. verification_token is used for DNS TXT record proof-of-ownership. status lifecycle: pending → verifying → verified → cert_issuing → live. removed_at marks soft-deleted rows; hard-delete is performed by a batch job.';
CREATE TABLE public.customer_addresses (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    address_line_1 text,
    address_line_2 text,
    city text,
    postal_code text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    delivery_instructions text,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT customer_addresses_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.customer_addresses FORCE ROW LEVEL SECURITY;
CREATE TABLE public.customer_favorite_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    item_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_favorite_items_organization_id_customer_id_item_id_key UNIQUE (organization_id, customer_id, item_id),
    CONSTRAINT customer_favorite_items_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.customer_favorite_items FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.customer_favorite_items IS 'A customer''s saved favourite menu items within an organisation. One row per (organization_id, customer_id, item_id) triplet. organization_id is the RLS anchor (matches customers, promotions, etc.). ON DELETE CASCADE on all three FKs ensures no orphaned rows. Wave 32 customer-favourites feature.';
CREATE TABLE public.customer_loyalty_stamps (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    location_id uuid,
    stamps integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT customer_loyalty_stamps_stamps_check CHECK ((stamps >= 0)),
    CONSTRAINT customer_loyalty_stamps_organization_id_customer_id_locatio_key UNIQUE (organization_id, customer_id, location_id),
    CONSTRAINT customer_loyalty_stamps_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.customer_loyalty_stamps FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.customer_loyalty_stamps IS 'Per-customer stamp balance toward the next free item under the stamp-card loyalty programme. One row per (organization, customer, location). stamps is incremented by the POS handler on qualifying purchases and reset when a redemption fires. RLS: org-scoped (organization_id = current_org_id()). Wave 24 stamp-card feature.';
COMMENT ON COLUMN public.customer_loyalty_stamps.stamps IS 'Current stamp count. POS handler resets to (stamps - stamps_required) on redemption so any overshoot carries forward correctly.';
CREATE TABLE public.customers (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    profile_id uuid,
    whatsapp_number text,
    first_name text,
    last_name text,
    email text,
    notes text,
    is_blocked boolean DEFAULT false NOT NULL,
    last_order_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    total_orders integer DEFAULT 0 NOT NULL,
    total_spent numeric(12,2) DEFAULT 0 NOT NULL,
    loyalty_points integer DEFAULT 0 NOT NULL,
    loyalty_tier text DEFAULT 'bronze'::text NOT NULL,
    points_earned_total integer DEFAULT 0 NOT NULL,
    points_redeemed_total integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    pii_purged_at timestamp with time zone,
    CONSTRAINT customers_loyalty_tier_check CHECK ((loyalty_tier = ANY (ARRAY['bronze'::text, 'silver'::text, 'gold'::text, 'platinum'::text]))),
    CONSTRAINT customers_organization_id_whatsapp_number_key UNIQUE (organization_id, whatsapp_number),
    CONSTRAINT customers_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.customers FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.customers.pii_purged_at IS 'Timestamp when right-to-be-forgotten was applied. PII columns (first_name, last_name, email, whatsapp_number, notes) are set to NULL. Order rows are retained anonymised.';
CREATE TABLE public.items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    category_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    short_description text,
    price numeric(10,2) NOT NULL,
    cost_price numeric(10,2),
    preparation_time integer DEFAULT 15 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    image_url text,
    track_inventory boolean DEFAULT false NOT NULL,
    current_stock integer DEFAULT 0 NOT NULL,
    low_stock_threshold integer DEFAULT 5 NOT NULL,
    recipe_type text DEFAULT 'simple'::text NOT NULL,
    max_recipe_level integer DEFAULT 0 NOT NULL,
    total_components integer DEFAULT 0 NOT NULL,
    recipe_complexity text DEFAULT 'simple'::text NOT NULL,
    auto_calculate_cost boolean DEFAULT false NOT NULL,
    is_recipe_ingredient boolean DEFAULT false NOT NULL,
    available_from timestamp with time zone,
    available_until timestamp with time zone,
    is_86ed boolean DEFAULT false NOT NULL,
    auto_86_when_inventory_empty boolean DEFAULT false NOT NULL,
    calories integer,
    kilojoules integer,
    spice_level integer,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    daily_quantity integer,
    daily_sold_count integer DEFAULT 0 NOT NULL,
    daily_counter_date date,
    is_daily_special boolean DEFAULT false NOT NULL,
    special_price_cents bigint,
    special_date date,
    sku text,
    CONSTRAINT items_recipe_complexity_check CHECK ((recipe_complexity = ANY (ARRAY['simple'::text, 'moderate'::text, 'complex'::text]))),
    CONSTRAINT items_recipe_type_check CHECK ((recipe_type = ANY (ARRAY['simple'::text, 'recipe'::text, 'component'::text]))),
    CONSTRAINT items_spice_level_check CHECK (((spice_level >= 0) AND (spice_level <= 5))),
    CONSTRAINT items_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.items FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.items IS 'Menu items. RLS is location-scoped via a JOIN to locations.organization_id. Marketplace role may SELECT active/non-86ed items from marketplace-visible locations.';
COMMENT ON COLUMN public.items.recipe_type IS 'simple: no sub-items. recipe: made from other items. component: used in other recipes.';
COMMENT ON COLUMN public.items.is_recipe_ingredient IS 'True when this item exists primarily as an ingredient in other item_recipes rows rather than as a standalone sellable. Sourced from legacy 008.';
COMMENT ON COLUMN public.items.daily_quantity IS 'Maximum units of this item available in a single calendar day. NULL = unlimited (no countdown displayed to guests). Wave 24 "N left today" feature.';
COMMENT ON COLUMN public.items.daily_sold_count IS 'Units sold today (resets to 0 when daily_counter_date advances). Incremented atomically by the POS charge handler. Wave 24 "N left today" feature.';
COMMENT ON COLUMN public.items.daily_counter_date IS 'Calendar date (location-local) that daily_sold_count applies to. POS handler: if daily_counter_date < today, reset daily_sold_count = 0 and set daily_counter_date = today before incrementing. Wave 24 "N left today" feature.';
COMMENT ON COLUMN public.items.is_daily_special IS 'When true this item is the daily special. The POS / marketplace shows it with a "Special" badge and uses special_price_cents if set. Wave 32 daily-specials feature.';
COMMENT ON COLUMN public.items.special_price_cents IS 'Override price in cents when this item is a daily special. NULL = use the regular items.price. Wave 32 daily-specials feature.';
COMMENT ON COLUMN public.items.special_date IS 'The calendar date this special applies to. NULL = no date restriction (active until is_daily_special is set back to false). POS handler should check: is_daily_special AND (special_date IS NULL OR special_date = current_date). Wave 32 daily-specials feature.';
CREATE TABLE public.order_adjustments (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid,
    adjustment_type text NOT NULL,
    reason_id uuid,
    reason_text text,
    amount_cents bigint NOT NULL,
    original_amount_cents bigint,
    applied_by uuid,
    approved_by uuid,
    approval_status text DEFAULT 'approved'::text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_adjustments_adjustment_type_check CHECK ((adjustment_type = ANY (ARRAY['void'::text, 'comp'::text, 'price_override'::text, 'manager_discount'::text, 'refund'::text]))),
    CONSTRAINT order_adjustments_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT order_adjustments_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.order_adjustments FORCE ROW LEVEL SECURITY;
CREATE TABLE public.order_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    item_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price_cents bigint NOT NULL,
    total_price_cents bigint NOT NULL,
    special_instructions text,
    seat_id uuid,
    course_number integer,
    client_id text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    course_id uuid,
    CONSTRAINT order_items_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT order_items_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.order_items FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.order_items IS 'Line items for an order. seat_id/course_number support dine-in course firing. unit_price_cents / total_price_cents in bigint cents for precision. client_id / idempotency_key for item-level duplicate detection.';
COMMENT ON COLUMN public.order_items.course_id IS 'NEW (Wave 11). FK to courses(id). Nullable: NULL means the item is not assigned to a named course. The legacy integer course_number is preserved for back-compat; new code should prefer course_id.';
CREATE TABLE public.orders (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    customer_id uuid,
    organization_id uuid NOT NULL,
    order_number text NOT NULL,
    status public.order_status DEFAULT 'pending'::public.order_status NOT NULL,
    fulfillment_type public.fulfillment_type DEFAULT 'collection'::public.fulfillment_type NOT NULL,
    order_type text DEFAULT 'pickup'::text,
    table_session_id uuid,
    course_number integer,
    delivery_address text,
    delivery_latitude numeric(10,7),
    delivery_longitude numeric(10,7),
    delivery_distance_km numeric(5,2),
    delivery_instructions text,
    subtotal_cents bigint DEFAULT 0 NOT NULL,
    delivery_fee_cents bigint DEFAULT 0 NOT NULL,
    discount_cents bigint DEFAULT 0 NOT NULL,
    tax_cents bigint DEFAULT 0 NOT NULL,
    total_cents bigint DEFAULT 0 NOT NULL,
    tax_rate numeric(5,2) DEFAULT 0.00 NOT NULL,
    tax_inclusive boolean DEFAULT true NOT NULL,
    currency_code text,
    fx_rate_to_zar numeric(18,8) DEFAULT 1 NOT NULL,
    fiscal_receipt_number text,
    fiscal_receipt_assigned_at timestamp with time zone,
    client_id text,
    idempotency_key text,
    estimated_prep_time integer,
    estimated_delivery_time timestamp with time zone,
    ready_at timestamp with time zone,
    picked_up_at timestamp with time zone,
    delivered_at timestamp with time zone,
    taken_by uuid,
    notes text,
    kitchen_notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    delivery_address_id uuid,
    customer_note text,
    gratuity_cents bigint DEFAULT 0 NOT NULL,
    pickup_at timestamp with time zone,
    held_at timestamp with time zone,
    is_open_tab boolean DEFAULT false NOT NULL,
    tab_name text,
    business_date date DEFAULT (timezone('utc'::text, now()))::date,
    CONSTRAINT orders_order_type_check CHECK ((order_type = ANY (ARRAY['delivery'::text, 'pickup'::text, 'whatsapp'::text, 'dine_in'::text]))),
    CONSTRAINT orders_client_id_key UNIQUE (client_id),
    CONSTRAINT orders_idempotency_key_key UNIQUE (idempotency_key),
    CONSTRAINT orders_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.orders FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.orders IS 'Central order record. Consolidates orders + order_details + order_financial_details from legacy 002. fulfillment_type uses the fulfillment_type enum (001). client_id / idempotency_key enable duplicate submission detection and safe retries. fiscal_receipt_number is unique per location (enforced below).';
COMMENT ON COLUMN public.orders.order_type IS 'Legacy text column for backward compat with chatbot handlers. New code should use fulfillment_type instead. Dropped in Wave 9.';
COMMENT ON COLUMN public.orders.tax_rate IS 'The rate this order was actually taxed at, snapshotted from the location at order time. Never recomputed — a rate change must not restate past sales.';
COMMENT ON COLUMN public.orders.tax_inclusive IS 'Whether this order''s line prices already contained the tax, snapshotted from locations.tax_inclusive at order time.';
COMMENT ON COLUMN public.orders.delivery_address_id IS 'FK to the customer_addresses row selected at checkout. NULL for walk-in POS, collection, or dine-in orders. Used by pings_visible_to_customer() (011_delivery.sql) to resolve the haversine delivery-coordinate check. The denormalised delivery_latitude / delivery_longitude columns are kept alongside this FK for backward-compat with chatbot code.';
COMMENT ON COLUMN public.orders.customer_note IS 'Customer-supplied note entered at checkout (e.g. "extra napkins please"). Distinct from orders.notes (internal staff note) and orders.kitchen_notes (KDS-facing). Set once at order creation; not editable by staff. Wave 24 easy-wins feature.';
COMMENT ON COLUMN public.orders.held_at IS 'Timestamp at which this order was placed on hold (fire-later / held ticket). NULL = order is NOT held and flows normally through KDS fanout. When NOT NULL the KDS fanout worker skips this order; the cashier must explicitly release it (set held_at = NULL) to fire it to the kitchen. Wave 32 held-ticket feature.';
COMMENT ON COLUMN public.orders.is_open_tab IS 'When true this is an open bar/dine-in tab: items are added over time and the check is settled later. When false (default) the order is a standard single-shot order. Wave 32 open-tab feature.';
COMMENT ON COLUMN public.orders.tab_name IS 'Optional human-readable label for the tab, e.g. "Table 4 – Smith" or "Bar 2". NULL for non-tab orders. Wave 32 open-tab feature.';
COMMENT ON COLUMN public.orders.business_date IS 'The local calendar date of the location''s trading day this order belongs to, computed at insert time from locations.timezone (see internal/bizday). created_at remains the absolute UTC instant; this is the DAY that instant falls in for the people working the till. Scopes the daily order-number sequence, the cash-drawer close and the Z-report, so all three agree.';
CREATE VIEW public.daily_sales_summary WITH (security_invoker='on') AS
 SELECT o.location_id,
    date((o.created_at AT TIME ZONE 'UTC'::text)) AS sale_date,
    o.order_type,
    count(DISTINCT o.id) AS order_count,
    (COALESCE(sum(oi_agg.subtotal_cents), (0)::numeric))::bigint AS gross_subtotal_cents,
    (COALESCE(sum(o.tax_cents), (0)::numeric))::bigint AS tax_total_cents,
    (COALESCE(sum(oa_agg.discount_cents), (0)::numeric))::bigint AS discount_total_cents,
    (COALESCE(sum(tp.tip_cents), (0)::numeric))::bigint AS tip_total_cents,
    (COALESCE(sum(o.delivery_fee_cents), (0)::numeric))::bigint AS delivery_fee_total_cents,
    ((COALESCE(sum(oi_agg.subtotal_cents), (0)::numeric) - COALESCE(sum(oa_agg.discount_cents), (0)::numeric)))::bigint AS net_sales_cents,
    (((COALESCE(sum(oi_agg.subtotal_cents), (0)::numeric) - COALESCE(sum(oa_agg.discount_cents), (0)::numeric)) - COALESCE(sum(oi_agg.estimated_cost_cents), (0)::numeric)))::bigint AS gross_profit_cents
   FROM (((public.orders o
     LEFT JOIN LATERAL ( SELECT COALESCE(sum((oi.unit_price_cents * oi.quantity)), (0)::numeric) AS subtotal_cents,
            COALESCE(sum((oi.quantity * COALESCE((round((i.cost_price * (100)::numeric)))::bigint, (0)::bigint))), (0)::numeric) AS estimated_cost_cents
           FROM (public.order_items oi
             LEFT JOIN public.items i ON ((i.id = oi.item_id)))
          WHERE (oi.order_id = o.id)) oi_agg ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(abs(oa.amount_cents)), (0)::numeric) AS discount_cents
           FROM public.order_adjustments oa
          WHERE ((oa.order_id = o.id) AND (oa.adjustment_type = ANY (ARRAY['discount'::text, 'comp'::text, 'void'::text])) AND (oa.approval_status = 'approved'::text))) oa_agg ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(op.tip_amount_cents), (0)::numeric) AS tip_cents
           FROM public.order_payments op
          WHERE ((op.order_id = o.id) AND (op.payment_status = 'completed'::public.payment_status))) tp ON (true))
  WHERE (o.status <> 'cancelled'::public.order_status)
  GROUP BY o.location_id, (date((o.created_at AT TIME ZONE 'UTC'::text))), o.order_type;
COMMENT ON VIEW public.daily_sales_summary IS 'Daily sales rollup per (location, sale_date, order_type). All monetary values in cents (bigint). security_invoker = on: RLS on orders and order_items filters to the caller''s org automatically.';
CREATE TABLE public.data_export_jobs (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    storage_key text,
    requested_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT data_export_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'complete'::text, 'failed'::text]))),
    CONSTRAINT data_export_jobs_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.data_export_jobs FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.data_export_jobs IS 'One row per data-export request. The handler inserts a row and returns a storage_key link when the archive is ready. Status lifecycle: pending → processing → complete | failed.';
COMMENT ON COLUMN public.data_export_jobs.storage_key IS 'Object-store key (Fly/R2 path) for the JSON archive. Populated when status = ''complete''.';
CREATE TABLE public.delivery_zones (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    polygon jsonb NOT NULL,
    delivery_fee_cents bigint DEFAULT 0 NOT NULL,
    min_order_cents bigint DEFAULT 0 NOT NULL,
    estimated_eta_minutes integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT delivery_zones_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.delivery_zones FORCE ROW LEVEL SECURITY;
CREATE TABLE public.dietary_tags (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    icon text,
    sort_order integer DEFAULT 0 NOT NULL,
    is_customer_facing boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT dietary_tags_organization_id_code_key UNIQUE (organization_id, code),
    CONSTRAINT dietary_tags_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.dietary_tags FORCE ROW LEVEL SECURITY;
CREATE TABLE public.driver_assignments (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    driver_member_id uuid NOT NULL,
    status public.driver_assignment_status DEFAULT 'offered'::public.driver_assignment_status NOT NULL,
    offered_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    accepted_at timestamp with time zone,
    picked_up_at timestamp with time zone,
    delivered_at timestamp with time zone,
    canceled_reason text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT driver_assignments_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.driver_assignments FORCE ROW LEVEL SECURITY;
CREATE TABLE public.driver_emergency_contacts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_member_id uuid NOT NULL,
    contact_name text NOT NULL,
    relationship text,
    phone_e164 text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT driver_emergency_contacts_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.driver_emergency_contacts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.driver_location_pings_default (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_member_id uuid NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    accuracy_m real,
    heading_deg real,
    speed_mps real,
    recorded_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT driver_location_pings_default_pkey PRIMARY KEY (id, recorded_at)
);
CREATE TABLE public.driver_shifts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_member_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    ended_at timestamp with time zone,
    status public.driver_shift_status DEFAULT 'online'::public.driver_shift_status NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT driver_shifts_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.driver_shifts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.elevation_tokens_used (

    token_hash text NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT elevation_tokens_used_pkey PRIMARY KEY (token_hash)
);
COMMENT ON TABLE public.elevation_tokens_used IS 'Single-use tracking for manager-elevation JWTs (T9.5e). Rows are inserted before the privileged action executes; a duplicate token_hash means the token was already consumed (replay).';
CREATE TABLE public.email_providers (

    code text NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT email_providers_code_check CHECK ((code = ANY (ARRAY['sendgrid'::text, 'mailgun'::text, 'ses'::text, 'smtp'::text]))),
    CONSTRAINT email_providers_pkey PRIMARY KEY (code)
);
COMMENT ON TABLE public.email_providers IS 'Platform-wide registry of supported email delivery providers. code is the stable identifier used by location_email_credentials. Not RLS-protected — public SELECT; only service_role may mutate. Seeded by this migration.';
CREATE TABLE public.email_verification_tokens (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_verification_tokens_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.email_verification_tokens FORCE ROW LEVEL SECURITY;
CREATE TABLE public.exchange_rates (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    from_currency text NOT NULL,
    to_currency text NOT NULL,
    rate numeric(18,8) NOT NULL,
    source text,
    fetched_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at timestamp with time zone,
    base_code text GENERATED ALWAYS AS (from_currency) STORED,
    quote_code text GENERATED ALWAYS AS (to_currency) STORED,
    CONSTRAINT exchange_rates_rate_check CHECK ((rate > (0)::numeric)),
    CONSTRAINT exchange_rates_from_currency_to_currency_fetched_at_key UNIQUE (from_currency, to_currency, fetched_at),
    CONSTRAINT exchange_rates_pkey PRIMARY KEY (id)
);
COMMENT ON TABLE public.exchange_rates IS 'Point-in-time FX rate snapshots, used for order FX conversion.';
COMMENT ON COLUMN public.exchange_rates.expires_at IS 'Optional hard expiry for this rate snapshot.  NULL means "valid until superseded".  latest_exchange_rate() filters out rows where expires_at < now().';
COMMENT ON COLUMN public.exchange_rates.base_code IS 'Generated alias for from_currency.  Wave 10 FX worker canonical name.';
COMMENT ON COLUMN public.exchange_rates.quote_code IS 'Generated alias for to_currency.  Wave 10 FX worker canonical name.';
CREATE TABLE public.fiscal_sequences (

    location_id uuid NOT NULL,
    current_number bigint DEFAULT 0 NOT NULL,
    prefix text DEFAULT ''::text NOT NULL,
    reset_policy text DEFAULT 'never'::text NOT NULL,
    last_reset_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fiscal_sequences_reset_policy_check CHECK ((reset_policy = ANY (ARRAY['never'::text, 'yearly'::text, 'monthly'::text]))),
    CONSTRAINT fiscal_sequences_pkey PRIMARY KEY (location_id)
);
ALTER TABLE ONLY public.fiscal_sequences FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.fiscal_sequences IS 'Per-location monotonic counter for fiscal receipt numbers. current_number is incremented atomically by the fiscal handler.';
CREATE TABLE public.gift_card_transactions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gift_card_id uuid NOT NULL,
    txn_type text NOT NULL,
    amount_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL,
    order_id uuid,
    payment_id uuid,
    performed_by_staff_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT gift_card_transactions_balance_after_cents_check CHECK ((balance_after_cents >= 0)),
    CONSTRAINT gift_card_transactions_txn_type_check CHECK ((txn_type = ANY (ARRAY['issue'::text, 'redeem'::text, 'reload'::text, 'refund'::text, 'adjust'::text, 'expire'::text]))),
    CONSTRAINT gift_card_transactions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.gift_card_transactions FORCE ROW LEVEL SECURITY;
CREATE TABLE public.gift_cards (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    code text NOT NULL,
    card_type text DEFAULT 'digital'::text NOT NULL,
    pin_hash text,
    initial_balance_cents bigint NOT NULL,
    current_balance_cents bigint NOT NULL,
    currency text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    issued_to_customer_id uuid,
    issued_to_name text,
    issued_to_email text,
    issued_to_phone text,
    issued_by_staff_id uuid,
    purchased_in_order_id uuid,
    expires_at timestamp with time zone,
    activated_at timestamp with time zone,
    last_redeemed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT gift_cards_card_type_check CHECK ((card_type = ANY (ARRAY['physical'::text, 'digital'::text]))),
    CONSTRAINT gift_cards_currency_check CHECK ((char_length(currency) = 3)),
    CONSTRAINT gift_cards_current_balance_cents_check CHECK ((current_balance_cents >= 0)),
    CONSTRAINT gift_cards_initial_balance_cents_check CHECK ((initial_balance_cents >= 0)),
    CONSTRAINT gift_cards_status_check CHECK ((status = ANY (ARRAY['active'::text, 'redeemed'::text, 'expired'::text, 'disabled'::text, 'fraud_hold'::text]))),
    CONSTRAINT gift_cards_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.gift_cards FORCE ROW LEVEL SECURITY;
CREATE TABLE public.goods_receipt_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    goods_receipt_id uuid NOT NULL,
    purchase_order_item_id uuid NOT NULL,
    quantity_received numeric(12,4) NOT NULL,
    unit_price_cents bigint NOT NULL,
    quality_ok boolean DEFAULT true NOT NULL,
    rejection_reason text,
    stock_movement_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT goods_receipt_items_quantity_received_check CHECK ((quantity_received > (0)::numeric)),
    CONSTRAINT goods_receipt_items_unit_price_cents_check CHECK ((unit_price_cents >= 0)),
    CONSTRAINT goods_receipt_items_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.goods_receipt_items FORCE ROW LEVEL SECURITY;
CREATE TABLE public.goods_receipts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid NOT NULL,
    receipt_number text,
    received_by uuid,
    received_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    delivery_note_number text,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT goods_receipts_pkey PRIMARY KEY (id),
    CONSTRAINT goods_receipts_purchase_order_id_receipt_number_key UNIQUE (purchase_order_id, receipt_number)
);
ALTER TABLE ONLY public.goods_receipts FORCE ROW LEVEL SECURITY;
CREATE VIEW public.hourly_sales_heatmap WITH (security_invoker='on') AS
 SELECT o.location_id,
    (EXTRACT(isodow FROM (o.created_at AT TIME ZONE 'UTC'::text)))::integer AS day_of_week,
    (EXTRACT(hour FROM (o.created_at AT TIME ZONE 'UTC'::text)))::integer AS hour_of_day,
    count(DISTINCT o.id) AS order_count,
    (COALESCE(sum(oi_agg.subtotal_cents), (0)::numeric))::bigint AS total_revenue_cents,
        CASE
            WHEN (count(DISTINCT o.id) = 0) THEN (0)::bigint
            ELSE ((COALESCE(sum(oi_agg.subtotal_cents), (0)::numeric) / (count(DISTINCT o.id))::numeric))::bigint
        END AS avg_ticket_cents
   FROM (public.orders o
     LEFT JOIN LATERAL ( SELECT COALESCE(sum((oi.unit_price_cents * oi.quantity)), (0)::numeric) AS subtotal_cents
           FROM public.order_items oi
          WHERE (oi.order_id = o.id)) oi_agg ON (true))
  WHERE ((o.status <> 'cancelled'::public.order_status) AND (o.created_at >= (now() - '90 days'::interval)))
  GROUP BY o.location_id, (EXTRACT(isodow FROM (o.created_at AT TIME ZONE 'UTC'::text))), (EXTRACT(hour FROM (o.created_at AT TIME ZONE 'UTC'::text)));
COMMENT ON VIEW public.hourly_sales_heatmap IS 'Trailing 90-day heatmap: orders and revenue bucketed by ISO day-of-week (1=Mon..7=Sun) and hour-of-day (0..23), per location. All amounts in cents.';
CREATE TABLE public.house_account_charges (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    house_account_id uuid NOT NULL,
    order_id uuid NOT NULL,
    customer_id uuid,
    amount_cents bigint NOT NULL,
    house_account_invoice_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT house_account_charges_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT house_account_charges_order_id_key UNIQUE (order_id),
    CONSTRAINT house_account_charges_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.house_account_charges FORCE ROW LEVEL SECURITY;
CREATE TABLE public.house_account_invoices (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    house_account_id uuid NOT NULL,
    invoice_number text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    subtotal_cents bigint DEFAULT 0 NOT NULL,
    tax_cents bigint DEFAULT 0 NOT NULL,
    total_cents bigint DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    due_date date,
    sent_at timestamp with time zone,
    paid_at timestamp with time zone,
    paid_amount_cents bigint DEFAULT 0 NOT NULL,
    pdf_url text,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT house_account_invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text, 'partial'::text]))),
    CONSTRAINT house_account_invoices_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.house_account_invoices FORCE ROW LEVEL SECURITY;
CREATE TABLE public.house_account_members (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    house_account_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    spending_limit_cents bigint,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT house_account_members_house_account_id_customer_id_key UNIQUE (house_account_id, customer_id),
    CONSTRAINT house_account_members_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.house_account_members FORCE ROW LEVEL SECURITY;
CREATE TABLE public.house_accounts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    account_name text NOT NULL,
    contact_name text,
    contact_email text,
    contact_phone text,
    billing_address text,
    credit_limit_cents bigint,
    current_balance_cents bigint DEFAULT 0 NOT NULL,
    currency text NOT NULL,
    billing_cycle text DEFAULT 'monthly'::text NOT NULL,
    net_terms_days integer DEFAULT 30 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT house_accounts_billing_cycle_check CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'weekly'::text, 'on_demand'::text]))),
    CONSTRAINT house_accounts_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.house_accounts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.idempotency_keys (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    request_hash text,
    status text DEFAULT 'in_progress'::text NOT NULL,
    response_status integer,
    response_body jsonb,
    response_headers jsonb,
    entity_type text,
    entity_id uuid,
    error_message text,
    locked_at timestamp with time zone,
    locked_by text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT idempotency_keys_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id),
    CONSTRAINT idempotency_keys_scope_key_key UNIQUE (scope, key)
);
ALTER TABLE ONLY public.idempotency_keys FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.idempotency_keys IS 'Service-level idempotency cache for payment calls and inbound webhook handlers. NOT tenant-scoped. scope+key is the unique lookup; the cached response columns guarantee exact-same-outcome on retry. Expired rows are cleaned up by the retention sweep job.';
CREATE TABLE public.ingredient_price_history (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inventory_item_id uuid NOT NULL,
    supplier_id uuid,
    source_type text NOT NULL,
    goods_receipt_item_id uuid,
    price_per_base_unit_cents bigint NOT NULL,
    effective_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    recorded_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT ingredient_price_history_price_per_base_unit_cents_check CHECK ((price_per_base_unit_cents >= 0)),
    CONSTRAINT ingredient_price_history_source_type_check CHECK ((source_type = ANY (ARRAY['goods_receipt'::text, 'manual'::text, 'supplier_catalog_sync'::text, 'system_adjustment'::text]))),
    CONSTRAINT ingredient_price_history_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.ingredient_price_history FORCE ROW LEVEL SECURITY;
CREATE TABLE public.inventory_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    unit text NOT NULL,
    current_stock numeric(10,3) DEFAULT 0 NOT NULL,
    minimum_stock numeric(10,3) DEFAULT 0 NOT NULL,
    cost_per_unit numeric(10,2),
    link_to_item_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT inventory_items_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.inventory_items FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.inventory_items IS 'Raw ingredient / consumable stock tracking. location-scoped via RLS. link_to_item_id enables auto-86 propagation to menu items when stock hits zero.';
COMMENT ON COLUMN public.inventory_items.link_to_item_id IS 'Optional FK to items(id). When set and items.auto_86_when_inventory_empty=true, the trg_auto_86_from_inventory trigger flips items.is_86ed as stock crosses zero. Source: legacy migration 24.';
CREATE TABLE public.invoices (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    issuer text NOT NULL,
    issuer_org_id uuid,
    recipient_org_id uuid,
    recipient_customer_id uuid,
    recipient_snapshot jsonb,
    invoice_number text NOT NULL,
    currency text NOT NULL,
    subtotal_cents bigint NOT NULL,
    vat_cents bigint DEFAULT 0 NOT NULL,
    vat_rate_percent numeric(6,4),
    vat_applied boolean DEFAULT false NOT NULL,
    total_cents bigint NOT NULL,
    due_date date,
    status text DEFAULT 'draft'::text NOT NULL,
    issued_at timestamp with time zone,
    paid_at timestamp with time zone,
    pdf_object_key text,
    idempotency_key text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT invoices_currency_check CHECK ((char_length(currency) = 3)),
    CONSTRAINT invoices_has_recipient CHECK (((recipient_org_id IS NOT NULL) OR (recipient_customer_id IS NOT NULL) OR (issuer = 'platform'::text))),
    CONSTRAINT invoices_issuer_check CHECK ((issuer = ANY (ARRAY['platform'::text, 'tenant'::text]))),
    CONSTRAINT invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'paid'::text, 'overdue'::text, 'cancelled'::text, 'void'::text]))),
    CONSTRAINT invoices_subtotal_cents_check CHECK ((subtotal_cents >= 0)),
    CONSTRAINT invoices_total_cents_check CHECK ((total_cents >= 0)),
    CONSTRAINT invoices_vat_cents_check CHECK ((vat_cents >= 0)),
    CONSTRAINT invoices_idempotency_key_key UNIQUE (idempotency_key),
    CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number),
    CONSTRAINT invoices_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.invoices FORCE ROW LEVEL SECURITY;
CREATE TABLE public.item_allergens (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    allergen_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT item_allergens_item_id_allergen_id_key UNIQUE (item_id, allergen_id),
    CONSTRAINT item_allergens_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.item_allergens FORCE ROW LEVEL SECURITY;
CREATE TABLE public.item_dietary_tags (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    dietary_tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT item_dietary_tags_item_id_dietary_tag_id_key UNIQUE (item_id, dietary_tag_id),
    CONSTRAINT item_dietary_tags_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.item_dietary_tags FORCE ROW LEVEL SECURITY;
CREATE TABLE public.item_menu_schedules (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    menu_schedule_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT item_menu_schedules_item_id_menu_schedule_id_key UNIQUE (item_id, menu_schedule_id),
    CONSTRAINT item_menu_schedules_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.item_menu_schedules FORCE ROW LEVEL SECURITY;
CREATE TABLE public.item_prep_steps (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    step_number integer NOT NULL,
    instruction text NOT NULL,
    station_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT item_prep_steps_step_number_check CHECK ((step_number > 0)),
    CONSTRAINT item_prep_steps_item_id_step_number_key UNIQUE (item_id, step_number),
    CONSTRAINT item_prep_steps_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.item_prep_steps FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.item_prep_steps.station_id IS 'Optional FK to kitchen_stations(id). The FK constraint is added by 008_orders_and_kds.sql after kitchen_stations is created, to avoid a forward-reference DDL failure.';
CREATE TABLE public.item_price_schedules (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    menu_schedule_id uuid NOT NULL,
    price numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT item_price_schedules_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT item_price_schedules_item_id_menu_schedule_id_key UNIQUE (item_id, menu_schedule_id),
    CONSTRAINT item_price_schedules_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.item_price_schedules FORCE ROW LEVEL SECURITY;
CREATE TABLE public.item_recipes (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parent_item_id uuid NOT NULL,
    child_item_id uuid NOT NULL,
    quantity_needed numeric(10,3) NOT NULL,
    unit text,
    recipe_level integer DEFAULT 1 NOT NULL,
    cost_per_unit numeric(10,2),
    yield_pct numeric(5,2) DEFAULT 100 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT check_no_circular_deps CHECK (public.check_circular_dependency(parent_item_id, child_item_id)),
    CONSTRAINT item_recipes_check CHECK ((parent_item_id <> child_item_id)),
    CONSTRAINT item_recipes_quantity_needed_check CHECK ((quantity_needed > (0)::numeric)),
    CONSTRAINT item_recipes_parent_item_id_child_item_id_key UNIQUE (parent_item_id, child_item_id),
    CONSTRAINT item_recipes_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.item_recipes FORCE ROW LEVEL SECURITY;
CREATE TABLE public.item_station_routing (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    station_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT item_station_routing_item_id_station_id_key UNIQUE (item_id, station_id),
    CONSTRAINT item_station_routing_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.item_station_routing FORCE ROW LEVEL SECURITY;
CREATE TABLE public.kds_display_groups (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    station_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    auto_recall_seconds integer,
    CONSTRAINT kds_display_groups_location_id_name_key UNIQUE (location_id, name),
    CONSTRAINT kds_display_groups_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.kds_display_groups FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.kds_display_groups IS 'Logical groups of kitchen stations shown together on a KDS screen. Replaces the legacy kds_expo_view from migration 028. station_ids is a UUID array referencing kitchen_stations.id values.';
COMMENT ON COLUMN public.kds_display_groups.display_order IS 'Render order of this display group within the location KDS layout. Lower values appear first. Supersedes the legacy sort_order column for station-config UI ordering.';
COMMENT ON COLUMN public.kds_display_groups.auto_recall_seconds IS 'If set, tickets bumped at all stations in this group are automatically recalled after this many seconds. NULL disables auto-recall.';
CREATE TABLE public.kds_ticket_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    quantity numeric(10,3) NOT NULL,
    item_status text DEFAULT 'fired'::text NOT NULL,
    started_at timestamp with time zone,
    ready_at timestamp with time zone,
    bumped_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT kds_ticket_items_item_status_check CHECK ((item_status = ANY (ARRAY['fired'::text, 'in_progress'::text, 'ready'::text, 'bumped'::text, 'voided'::text, '86ed'::text]))),
    CONSTRAINT kds_ticket_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT kds_ticket_items_pkey PRIMARY KEY (id),
    CONSTRAINT kds_ticket_items_ticket_id_order_item_id_key UNIQUE (ticket_id, order_item_id)
);
ALTER TABLE ONLY public.kds_ticket_items FORCE ROW LEVEL SECURITY;
CREATE TABLE public.kds_tickets (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    station_id uuid NOT NULL,
    ticket_number integer NOT NULL,
    status text DEFAULT 'fired'::text NOT NULL,
    fired_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    started_at timestamp with time zone,
    ready_at timestamp with time zone,
    bumped_at timestamp with time zone,
    bumped_by uuid,
    course_number integer,
    priority integer DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT kds_tickets_status_check CHECK ((status = ANY (ARRAY['fired'::text, 'in_progress'::text, 'ready'::text, 'bumped'::text, 'recalled'::text, 'cancelled'::text]))),
    CONSTRAINT kds_tickets_order_id_station_id_key UNIQUE (order_id, station_id),
    CONSTRAINT kds_tickets_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.kds_tickets FORCE ROW LEVEL SECURITY;
CREATE TABLE public.kitchen_stations (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    station_type text DEFAULT 'prep'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT kitchen_stations_station_type_check CHECK ((station_type = ANY (ARRAY['prep'::text, 'expo'::text, 'bar'::text]))),
    CONSTRAINT kitchen_stations_location_id_name_key UNIQUE (location_id, name),
    CONSTRAINT kitchen_stations_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.kitchen_stations FORCE ROW LEVEL SECURITY;
CREATE VIEW public.kds_expo_view WITH (security_invoker='on') AS
 SELECT t.order_id,
    ks.location_id,
    min(t.fired_at) AS earliest_fired_at,
    bool_and((t.status = 'ready'::text)) AS all_ready,
    bool_or((t.status = 'in_progress'::text)) AS any_in_progress,
    jsonb_agg(jsonb_build_object('ticket_id', t.id, 'station_name', ks.name, 'status', t.status, 'fired_at', t.fired_at, 'ready_at', t.ready_at, 'course_number', t.course_number, 'items', COALESCE(( SELECT jsonb_agg(jsonb_build_object('order_item_id', kti.order_item_id, 'item_id', oi.item_id, 'name', i.name, 'quantity', kti.quantity, 'item_status', kti.item_status, 'notes', kti.notes) ORDER BY kti.created_at) AS jsonb_agg
           FROM ((public.kds_ticket_items kti
             JOIN public.order_items oi ON ((oi.id = kti.order_item_id)))
             JOIN public.items i ON ((i.id = oi.item_id)))
          WHERE (kti.ticket_id = t.id)), '[]'::jsonb)) ORDER BY ks.name) AS station_tickets,
    COALESCE(max(t.priority), 0) AS max_priority
   FROM (public.kds_tickets t
     JOIN public.kitchen_stations ks ON ((ks.id = t.station_id)))
  WHERE (t.status = ANY (ARRAY['fired'::text, 'in_progress'::text, 'ready'::text]))
  GROUP BY t.order_id, ks.location_id
  ORDER BY (min(t.fired_at)), COALESCE(max(t.priority), 0) DESC;
COMMENT ON VIEW public.kds_expo_view IS 'Open KDS tickets grouped by order. all_ready = true when expo can bump the whole order. Uses security_invoker = on so RLS on kds_tickets, kitchen_stations, and kds_ticket_items applies to the caller automatically.';
CREATE TABLE public.kds_fanout_queue (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    queued_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    error_message text,
    retry_count integer DEFAULT 0 NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    CONSTRAINT kds_fanout_queue_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'processing'::text, 'dead'::text]))),
    CONSTRAINT kds_fanout_queue_order_id_key UNIQUE (order_id),
    CONSTRAINT kds_fanout_queue_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.kds_fanout_queue FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.kds_fanout_queue IS 'Queue for fanning out orders to KDS stations. retry_count and state=''dead'' support the Wave 6 dead-letter pattern: after N retries, the worker sets state=''dead'' and alerts ops.';
CREATE TABLE public.kds_ticket_events (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    ticket_item_id uuid,
    event_type public.kds_event_type NOT NULL,
    performed_by uuid,
    payload jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT kds_ticket_events_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.kds_ticket_events FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.kds_ticket_events IS 'Immutable event log for KDS ticket lifecycle. event_type uses the kds_event_type enum (includes ''ready'' added to 001). No UPDATE or DELETE — append-only.';
CREATE TABLE public.staff_time_entries (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    location_id uuid NOT NULL,
    entry_type text NOT NULL,
    "timestamp" timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT staff_time_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['clock_in'::text, 'clock_out'::text, 'break_start'::text, 'break_end'::text]))),
    CONSTRAINT staff_time_entries_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.staff_time_entries FORCE ROW LEVEL SECURITY;
CREATE VIEW public.labor_hours_daily WITH (security_invoker='on') AS
 WITH ordered AS (
         SELECT ste.id,
            ste.staff_id,
            ste.location_id,
            ste.entry_type,
            ste."timestamp",
            row_number() OVER (PARTITION BY ste.staff_id, ste.entry_type ORDER BY ste."timestamp") AS rn
           FROM public.staff_time_entries ste
        ), clock_pairs AS (
         SELECT ci.staff_id,
            ci.location_id,
            ci."timestamp" AS clock_in_at,
            co."timestamp" AS clock_out_at,
            date((ci."timestamp" AT TIME ZONE 'UTC'::text)) AS work_date
           FROM (ordered ci
             LEFT JOIN ordered co ON (((co.staff_id = ci.staff_id) AND (co.entry_type = 'clock_out'::text) AND (co.rn = ci.rn))))
          WHERE (ci.entry_type = 'clock_in'::text)
        ), break_pairs AS (
         SELECT bs.staff_id,
            bs."timestamp" AS break_start_at,
            be."timestamp" AS break_end_at
           FROM (ordered bs
             LEFT JOIN ordered be ON (((be.staff_id = bs.staff_id) AND (be.entry_type = 'break_end'::text) AND (be.rn = bs.rn))))
          WHERE (bs.entry_type = 'break_start'::text)
        ), break_minutes_per_shift AS (
         SELECT cp_1.staff_id,
            cp_1.clock_in_at,
            cp_1.clock_out_at,
            COALESCE(sum((EXTRACT(epoch FROM (bp.break_end_at - bp.break_start_at)) / 60.0)), (0)::numeric) AS break_minutes
           FROM (clock_pairs cp_1
             LEFT JOIN break_pairs bp ON (((bp.staff_id = cp_1.staff_id) AND (bp.break_start_at >= cp_1.clock_in_at) AND ((cp_1.clock_out_at IS NULL) OR (bp.break_end_at <= cp_1.clock_out_at)))))
          GROUP BY cp_1.staff_id, cp_1.clock_in_at, cp_1.clock_out_at
        )
 SELECT cp.location_id,
    cp.staff_id,
    cp.work_date,
    cp.clock_in_at,
    cp.clock_out_at,
        CASE
            WHEN (cp.clock_out_at IS NULL) THEN NULL::numeric
            ELSE round((EXTRACT(epoch FROM (cp.clock_out_at - cp.clock_in_at)) / 60.0), 2)
        END AS total_minutes,
    round(COALESCE(bm.break_minutes, (0)::numeric), 2) AS break_minutes,
        CASE
            WHEN (cp.clock_out_at IS NULL) THEN NULL::numeric
            ELSE round(((EXTRACT(epoch FROM (cp.clock_out_at - cp.clock_in_at)) / 60.0) - COALESCE(bm.break_minutes, (0)::numeric)), 2)
        END AS worked_minutes
   FROM (clock_pairs cp
     LEFT JOIN break_minutes_per_shift bm ON (((bm.staff_id = cp.staff_id) AND (bm.clock_in_at = cp.clock_in_at) AND (NOT (bm.clock_out_at IS DISTINCT FROM cp.clock_out_at)))));
COMMENT ON VIEW public.labor_hours_daily IS 'Per-shift labor clock pairs with break deduction. One row per clock-in cycle. Forgotten clock-outs leave clock_out_at and worked_minutes NULL. security_invoker = on.';
CREATE TABLE public.staff_pay_rates (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    rate_type text NOT NULL,
    amount_cents bigint NOT NULL,
    currency text NOT NULL,
    commission_percentage numeric(6,3),
    commission_basis text,
    overtime_multiplier numeric(4,2) DEFAULT 1.5 NOT NULL,
    overtime_threshold_hours_per_week numeric(5,2) DEFAULT 45,
    effective_from date NOT NULL,
    effective_until date,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT staff_pay_rates_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT staff_pay_rates_check CHECK (((effective_until IS NULL) OR (effective_until >= effective_from))),
    CONSTRAINT staff_pay_rates_commission_basis_check CHECK (((commission_basis = ANY (ARRAY['sales'::text, 'orders'::text, 'tips'::text])) OR (commission_basis IS NULL))),
    CONSTRAINT staff_pay_rates_commission_percentage_check CHECK (((commission_percentage IS NULL) OR (commission_percentage >= (0)::numeric))),
    CONSTRAINT staff_pay_rates_overtime_multiplier_check CHECK ((overtime_multiplier >= (1)::numeric)),
    CONSTRAINT staff_pay_rates_rate_type_check CHECK ((rate_type = ANY (ARRAY['hourly'::text, 'salary_monthly'::text, 'salary_annual'::text, 'commission'::text, 'per_shift'::text]))),
    CONSTRAINT staff_pay_rates_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.staff_pay_rates FORCE ROW LEVEL SECURITY;
CREATE VIEW public.labor_cost_daily WITH (security_invoker='on') AS
 WITH daily_hours AS (
         SELECT lhd.staff_id,
            lhd.location_id,
            lhd.work_date,
            round((COALESCE(sum(lhd.worked_minutes) FILTER (WHERE (lhd.worked_minutes IS NOT NULL)), (0)::numeric) / 60.0), 4) AS hours_worked
           FROM public.labor_hours_daily lhd
          GROUP BY lhd.staff_id, lhd.location_id, lhd.work_date
        ), current_rates AS (
         SELECT spr.staff_id,
            spr.rate_type,
            spr.amount_cents,
            spr.overtime_multiplier,
            spr.overtime_threshold_hours_per_week
           FROM public.staff_pay_rates spr
          WHERE ((spr.effective_until IS NULL) AND (spr.rate_type = ANY (ARRAY['hourly'::text, 'per_shift'::text])))
        ), cost_per_rate AS (
         SELECT dh.work_date,
            dh.location_id,
            dh.staff_id,
            cr.rate_type,
            dh.hours_worked,
            (
                CASE cr.rate_type
                    WHEN 'hourly'::text THEN
                    CASE
                        WHEN (dh.hours_worked <= (0)::numeric) THEN (0)::numeric
                        WHEN ((cr.overtime_threshold_hours_per_week IS NULL) OR ((cr.overtime_threshold_hours_per_week / 7.0) >= dh.hours_worked)) THEN round(((cr.amount_cents)::numeric * dh.hours_worked))
                        ELSE (round(((cr.amount_cents)::numeric * (cr.overtime_threshold_hours_per_week / 7.0))) + round((((cr.amount_cents)::numeric * cr.overtime_multiplier) * (dh.hours_worked - (cr.overtime_threshold_hours_per_week / 7.0)))))
                    END
                    WHEN 'per_shift'::text THEN (cr.amount_cents)::numeric
                    ELSE (0)::numeric
                END)::bigint AS shift_cost_cents
           FROM (daily_hours dh
             JOIN current_rates cr ON ((cr.staff_id = dh.staff_id)))
          WHERE ((dh.hours_worked > (0)::numeric) OR (cr.rate_type = 'per_shift'::text))
        )
 SELECT work_date,
    location_id,
    staff_id,
    sum(hours_worked) AS hours_worked,
    (sum(shift_cost_cents))::bigint AS labor_cost_cents
   FROM cost_per_rate cpr
  GROUP BY work_date, location_id, staff_id;
COMMENT ON VIEW public.labor_cost_daily IS 'Daily labor cost in cents per (work_date, location_id, staff_id). Hourly rate with rough daily OT split + flat per_shift. Salary excluded (v1). security_invoker = on.';
CREATE TABLE public.legal_acceptances (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    document_id uuid NOT NULL,
    accepted_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    ip text,
    CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.legal_acceptances FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.legal_acceptances IS 'Immutable log of when each profile accepted a specific document version. Records are never updated; a new row is inserted per acceptance event. IP is stored for audit purposes only and must not be surfaced in product UIs.';
CREATE TABLE public.legal_documents (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    version text NOT NULL,
    body_md text NOT NULL,
    effective_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT legal_documents_kind_check CHECK ((kind = ANY (ARRAY['terms'::text, 'privacy'::text]))),
    CONSTRAINT legal_documents_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.legal_documents FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.legal_documents IS 'Versioned legal documents (terms of service, privacy policy). Each (kind, version) pair is unique. The current document is the row with the greatest effective_at that is <= now().';
COMMENT ON COLUMN public.legal_documents.kind IS 'Document type: ''terms'' = Terms of Service; ''privacy'' = Privacy Policy.';
COMMENT ON COLUMN public.legal_documents.version IS 'Human-readable version string, e.g. ''2026-05-21'' or ''v2.1''.';
COMMENT ON COLUMN public.legal_documents.body_md IS 'Full document body in Markdown, rendered client-side.';
CREATE TABLE public.llm_messages (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    conversation_id text,
    provider text,
    model text,
    tokens_in integer DEFAULT 0 NOT NULL,
    tokens_out integer DEFAULT 0 NOT NULL,
    cost_cents bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_messages_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.llm_messages FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.llm_messages IS 'Append-only per-org LLM inference cost ledger. One row per API call. cost_cents is computed by the Go layer from llm_model_pricing at call time and stored in the org currency denomination.';
COMMENT ON COLUMN public.llm_messages.conversation_id IS 'Opaque session/thread identifier to group turns of a multi-turn conversation. No FK — may span multiple systems or be provider-supplied.';
COMMENT ON COLUMN public.llm_messages.cost_cents IS 'Cost of this call expressed in the smallest unit of the org currency (e.g. ZAR cents). Computed by Go from llm_model_pricing.input/output_cost_per_1k.';
CREATE TABLE public.llm_model_pricing (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    input_cost_per_1k numeric(20,10) DEFAULT 0 NOT NULL,
    output_cost_per_1k numeric(20,10) DEFAULT 0 NOT NULL,
    supports_vision boolean DEFAULT false NOT NULL,
    supports_tools boolean DEFAULT false NOT NULL,
    context_length integer,
    source text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_model_pricing_pkey PRIMARY KEY (id),
    CONSTRAINT llm_model_pricing_provider_model_key UNIQUE (provider, model)
);
COMMENT ON TABLE public.llm_model_pricing IS 'Platform-wide reference: cost rates per LLM provider and model. Not RLS-protected — public SELECT; only service_role may mutate. Costs are in USD per 1 000 tokens (numeric(20,10) for sub-cent precision).';
COMMENT ON COLUMN public.llm_model_pricing.input_cost_per_1k IS 'USD cost per 1 000 input (prompt) tokens. Use numeric(20,10) for sub-cent precision (e.g. $0.0000015 per token for cheap models).';
COMMENT ON COLUMN public.llm_model_pricing.output_cost_per_1k IS 'USD cost per 1 000 output (completion) tokens.';
COMMENT ON COLUMN public.llm_model_pricing.context_length IS 'Maximum context window for this model version in tokens. NULL when unknown.';
CREATE TABLE public.llm_tool_executions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    llm_message_id uuid NOT NULL,
    tool_name text NOT NULL,
    args jsonb,
    result_summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT llm_tool_executions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.llm_tool_executions FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.llm_tool_executions IS 'Append-only record of tool/function calls made within an LLM message turn. Cascade-deleted when the parent llm_messages row is removed. args stores the raw JSON arguments; result_summary is a truncated plaintext summary of the tool output for audit/debug purposes.';
COMMENT ON COLUMN public.llm_tool_executions.args IS 'JSON arguments passed to the tool at call time. May be NULL for zero-argument tools. Stored as raw jsonb for schema flexibility across tool types.';
COMMENT ON COLUMN public.llm_tool_executions.result_summary IS 'Truncated plaintext summary of the tool result for audit/debug. Not the full tool output (which may be large); the Go layer truncates before insert.';
CREATE TABLE public.location_email_credentials (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    provider_code text NOT NULL,
    encrypted_keys text NOT NULL,
    sender_domain text,
    sender_email text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT location_email_credentials_location_id_provider_code_key UNIQUE (location_id, provider_code),
    CONSTRAINT location_email_credentials_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.location_email_credentials FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.location_email_credentials IS 'Per-location email delivery provider credentials. encrypted_keys is AES-GCM ciphertext decrypted at call time by the Go layer; never returned raw to API consumers. Encrypted per-location email provider credentials.';
COMMENT ON COLUMN public.location_email_credentials.encrypted_keys IS 'AES-GCM encrypted provider credentials (API key, SMTP password, etc.). Structure varies by provider_code: for sendgrid/mailgun it is a JSON object {"api_key":"..."}, for ses {"access_key_id":"...","secret_access_key":"..."}, for smtp {"host":"...","port":587,"username":"...","password":"..."}. The Go layer encrypts on write and decrypts on use; raw value is never returned.';
COMMENT ON COLUMN public.location_email_credentials.sender_domain IS 'Verified sender domain registered with the email provider (e.g. mail.example.com). Used for DKIM/SPF validation. NULL when not yet configured.';
COMMENT ON COLUMN public.location_email_credentials.sender_email IS 'Default From address for outbound emails sent via this credential set. NULL to fall back to provider-level default. Must be within sender_domain when set.';
CREATE TABLE public.location_printers (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    connection text NOT NULL,
    host text,
    port integer DEFAULT 9100 NOT NULL,
    station_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT location_printers_connection_check CHECK ((connection = ANY (ARRAY['network'::text, 'usb'::text]))),
    CONSTRAINT location_printers_kind_check CHECK ((kind = ANY (ARRAY['receipt'::text, 'kitchen'::text]))),
    CONSTRAINT location_printers_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.location_printers FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.location_printers IS 'Hardware printers (receipt or kitchen) attached to a BeepBite location. connection=network printers are addressed by host:port; connection=usb printers are driven by the local POS agent. station_id binds a kitchen printer to a specific kitchen station for ticket-based routing mirroring the KDS fanout logic.';
COMMENT ON COLUMN public.location_printers.kind IS 'receipt — customer-facing receipt printer; kitchen — kitchen order ticket printer.';
COMMENT ON COLUMN public.location_printers.connection IS 'network — TCP ESC/POS (host:port); usb — local USB device managed by POS agent.';
COMMENT ON COLUMN public.location_printers.station_id IS 'Optional FK to kitchen_stations. When set, kitchen-print jobs are filtered to order items routed to this station (mirrors KDS fanout).';
CREATE TABLE public.locations (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    slug text,
    description text,
    city text,
    country text,
    whatsapp_number text,
    address text,
    latitude numeric(10,7),
    longitude numeric(10,7),
    delivery_fee numeric(10,2) DEFAULT 0.00 NOT NULL,
    free_delivery_threshold numeric(10,2) DEFAULT 0.00 NOT NULL,
    max_delivery_distance_km numeric(5,2) DEFAULT 10.0 NOT NULL,
    estimated_prep_time integer DEFAULT 30 NOT NULL,
    currency_code text,
    offers_delivery boolean DEFAULT false NOT NULL,
    offers_collection boolean DEFAULT true NOT NULL,
    on_delivery_payment_methods text[] DEFAULT '{}'::text[] NOT NULL,
    is_marketplace_visible boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    accepts_delivery boolean DEFAULT true NOT NULL,
    accepts_pickup boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    auto_gratuity_enabled boolean DEFAULT false NOT NULL,
    auto_gratuity_percent numeric(5,2) DEFAULT 0.00 NOT NULL,
    auto_gratuity_min_party integer DEFAULT 6 NOT NULL,
    pickup_slot_capacity integer DEFAULT 0 NOT NULL,
    pickup_slot_minutes integer DEFAULT 15 NOT NULL,
    avg_prep_minutes integer DEFAULT 15 NOT NULL,
    avg_rating numeric(3,2) DEFAULT 0 NOT NULL,
    rating_count integer DEFAULT 0 NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    locale text,
    tax_rate numeric(5,2) DEFAULT 0.00 NOT NULL,
    tax_inclusive boolean DEFAULT true NOT NULL,
    tax_label text,
    phone_country_code text,
    CONSTRAINT locations_country_iso3166 CHECK (((country IS NULL) OR (country ~ '^[A-Z]{2}$'::text))),
    CONSTRAINT locations_must_offer_channel CHECK ((offers_delivery OR offers_collection)),
    CONSTRAINT locations_phone_country_code_format CHECK (((phone_country_code IS NULL) OR (phone_country_code ~ '^[0-9]{1,4}$'::text))),
    CONSTRAINT locations_tax_rate_range CHECK (((tax_rate >= (0)::numeric) AND (tax_rate <= (100)::numeric))),
    CONSTRAINT locations_timezone_shape CHECK (((timezone = 'UTC'::text) OR (timezone ~ '^[A-Za-z_]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?$'::text))),
    CONSTRAINT locations_pkey PRIMARY KEY (id),
    CONSTRAINT locations_slug_key UNIQUE (slug)
);
ALTER TABLE ONLY public.locations FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.locations IS 'Physical or virtual store locations (branches). FK anchor for nearly every other tenant table. slug enables marketplace URLs. is_marketplace_visible controls public discovery.';
COMMENT ON COLUMN public.locations.country IS 'ISO 3166-1 alpha-2, uppercase. Not itself used for money or time — those come from currency_code and timezone — but it is what the onboarding UI uses to suggest sensible values for them.';
COMMENT ON COLUMN public.locations.delivery_fee IS 'Delivery fee in MAJOR units of the location''s currency_code. Defaults to 0: any non-zero default is a fixed number of rand/dollars/yen and is wrong in every currency but the one it was written for.';
COMMENT ON COLUMN public.locations.on_delivery_payment_methods IS 'Array of payment_methods.code values accepted for on-delivery / COD orders. e.g. ''{cash_on_delivery, card_on_delivery}''';
COMMENT ON COLUMN public.locations.auto_gratuity_enabled IS 'When true the POS appends gratuity automatically for large parties. Wave 24 auto-gratuity feature.';
COMMENT ON COLUMN public.locations.auto_gratuity_percent IS 'Percentage of order subtotal added as auto-gratuity (e.g. 18.00 = 18 %). Only applied when auto_gratuity_enabled = true AND party size >= auto_gratuity_min_party.';
COMMENT ON COLUMN public.locations.auto_gratuity_min_party IS 'Minimum party / guest count that triggers auto-gratuity. Default 6 (industry standard). Wave 24 auto-gratuity feature.';
COMMENT ON COLUMN public.locations.pickup_slot_capacity IS 'Maximum number of pickup orders accepted per time slot. 0 = feature disabled (unlimited / no slot enforcement). Wave 24 pickup-slot feature.';
COMMENT ON COLUMN public.locations.pickup_slot_minutes IS 'Slot duration in minutes (e.g. 15 produces slots at :00, :15, :30, :45). Ignored when pickup_slot_capacity = 0. Wave 24 pickup-slot feature.';
COMMENT ON COLUMN public.locations.avg_prep_minutes IS 'Rolling average of actual order preparation time in minutes, updated by the POS/kitchen analytics job. Distinct from locations.estimated_prep_time (007), which is the owner-configured static delivery-ETA baseline. avg_prep_minutes drives the customer-facing wait-time widget. Default 15 (industry baseline). Wave 32 wait-time-estimation feature.';
COMMENT ON COLUMN public.locations.avg_rating IS 'Materialized average star rating from visible marketplace_reviews rows. Refreshed by the reviews backend agent on each review approval. Range 0.00–5.00; 0 means no reviews yet.';
COMMENT ON COLUMN public.locations.rating_count IS 'Count of visible marketplace_reviews rows contributing to avg_rating. Refreshed alongside avg_rating.';
COMMENT ON COLUMN public.locations.timezone IS 'IANA timezone name, e.g. ''Europe/Lisbon'', ''America/New_York''. Defines the trading day: order-number counter resets, cash-drawer close, shift reports and "today''s sales" are all computed as local calendar days in this zone (internal/bizday). Timestamps remain stored in UTC — only the boundaries are local. Defaults to UTC, which is both neutral and the behaviour that predated this column.';
COMMENT ON COLUMN public.locations.locale IS 'BCP-47 locale, e.g. ''pt-PT'', ''ja-JP''. Controls presentation only: number grouping, decimal separator, currency symbol placement and date format. It never changes an amount and never changes which currency an amount is in. NULL means CLDR root formatting, which belongs to no country — a neutral fallback rather than someone else''s convention.';
COMMENT ON COLUMN public.locations.tax_rate IS 'Effective sales-tax rate as a percentage, e.g. 15.00 (ZA VAT), 23.00 (PT), 8.88 (NYC), 0.00 (tax-exempt or not yet configured). Zero is the default because inventing a tax rate for an operator is worse than charging none: one is a visible gap, the other is a silent overcharge. The tax_rates table remains the source for locations needing multiple named rates.';
COMMENT ON COLUMN public.locations.tax_inclusive IS 'Whether menu/item prices ALREADY CONTAIN the tax. true is the VAT/GST convention (ZA, EU, UK, AU, JP): the shelf price is the price and the receipt shows how much of it was tax. false is the US/CA sales-tax convention: tax is added at the register. This is a genuine country difference, not a display preference — the same price and rate produce different totals — so it must be set per location, and is snapshotted onto each order so a later settings change cannot restate past sales.';
COMMENT ON COLUMN public.locations.tax_label IS 'What the receipt calls the tax: ''VAT'', ''GST'', ''Sales Tax'', ''Consumption Tax''. NULL falls back to the generic ''Tax''. Printing ''VAT'' on a US receipt is a factual error, so this is not cosmetic.';
COMMENT ON COLUMN public.locations.phone_country_code IS 'E.164 country calling code WITHOUT the plus, e.g. ''27'', ''1'', ''351''. Used to promote a locally-typed customer number (''082 123 4567'') to E.164 before it is stored or handed to WhatsApp, so the same person is not created twice under two spellings. NULL means numbers must already be E.164 — no country is guessed.';
CREATE TABLE public.loyalty_config (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    points_per_currency_unit numeric(12,4) DEFAULT 100 NOT NULL,
    min_redemption_points integer DEFAULT 0 NOT NULL,
    max_redemption_pct_of_order numeric(5,2),
    points_expiry_months integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    stamps_enabled boolean DEFAULT false NOT NULL,
    stamps_required integer DEFAULT 10 NOT NULL,
    stamp_item_id uuid,
    CONSTRAINT loyalty_config_max_redemption_pct_of_order_check CHECK (((max_redemption_pct_of_order >= (0)::numeric) AND (max_redemption_pct_of_order <= (100)::numeric))),
    CONSTRAINT loyalty_config_organization_id_key UNIQUE (organization_id),
    CONSTRAINT loyalty_config_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.loyalty_config FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.loyalty_config.stamps_enabled IS 'When true the org uses stamp-card loyalty in addition to (or instead of) points. Wave 24 stamp-card feature.';
COMMENT ON COLUMN public.loyalty_config.stamps_required IS 'Number of qualifying purchases needed to earn one free item. Default 10 ("buy 10 get 1 free"). Only relevant when stamps_enabled = true.';
COMMENT ON COLUMN public.loyalty_config.stamp_item_id IS 'FK to items(id): the specific item that earns a stamp per purchase. NULL = any item purchase earns a stamp. ON DELETE SET NULL so deleting the qualifying item gracefully reverts to "any item".';
CREATE TABLE public.loyalty_transactions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    txn_type text NOT NULL,
    points integer NOT NULL,
    balance_after integer NOT NULL,
    order_id uuid,
    expires_at timestamp with time zone,
    notes text,
    performed_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT loyalty_transactions_balance_after_check CHECK ((balance_after >= 0)),
    CONSTRAINT loyalty_transactions_txn_type_check CHECK ((txn_type = ANY (ARRAY['earn'::text, 'redeem'::text, 'adjust'::text, 'expire'::text, 'transfer'::text]))),
    CONSTRAINT loyalty_transactions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.loyalty_transactions FORCE ROW LEVEL SECURITY;
CREATE TABLE public.marketplace_reviews (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid,
    customer_profile_id uuid,
    location_id uuid NOT NULL,
    stars integer NOT NULL,
    review_text text,
    photos text[] DEFAULT '{}'::text[] NOT NULL,
    verified_purchase boolean DEFAULT true NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    owner_reply text,
    owner_replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    organization_id uuid NOT NULL,
    text text,
    CONSTRAINT marketplace_reviews_stars_check CHECK (((stars >= 1) AND (stars <= 5))),
    CONSTRAINT marketplace_reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'visible'::text, 'hidden'::text, 'removed'::text]))),
    CONSTRAINT marketplace_reviews_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.marketplace_reviews FORCE ROW LEVEL SECURITY;
CREATE VIEW public.menu_engineering WITH (security_invoker='on') AS
 WITH item_sales AS (
         SELECT o.location_id,
            oi.item_id,
            i.name AS item_name,
            i.category_id,
            c.name AS category_name,
            (round((COALESCE(i.cost_price, (0)::numeric) * (100)::numeric)))::bigint AS cost_price_cents,
            sum(oi.quantity) AS units_sold,
            (sum((oi.unit_price_cents * oi.quantity)))::bigint AS revenue_cents,
            (((sum(oi.quantity))::numeric * round((COALESCE(i.cost_price, (0)::numeric) * (100)::numeric))))::bigint AS cost_cents
           FROM (((public.orders o
             JOIN public.order_items oi ON ((oi.order_id = o.id)))
             JOIN public.items i ON ((i.id = oi.item_id)))
             LEFT JOIN public.categories c ON ((c.id = i.category_id)))
          WHERE ((o.status <> 'cancelled'::public.order_status) AND (o.created_at >= (now() - '30 days'::interval)))
          GROUP BY o.location_id, oi.item_id, i.name, i.category_id, c.name, i.cost_price
        ), scored AS (
         SELECT s.location_id,
            s.item_id,
            s.item_name,
            s.category_id,
            s.category_name,
            s.cost_price_cents,
            s.units_sold,
            s.revenue_cents,
            s.cost_cents,
            (s.revenue_cents - s.cost_cents) AS margin_cents,
                CASE
                    WHEN (s.units_sold = 0) THEN (0)::numeric
                    ELSE (((s.revenue_cents - s.cost_cents))::numeric / (s.units_sold)::numeric)
                END AS margin_per_unit_cents,
            percent_rank() OVER (PARTITION BY s.location_id ORDER BY s.units_sold) AS popularity_score,
            percent_rank() OVER (PARTITION BY s.location_id ORDER BY
                CASE
                    WHEN (s.units_sold = 0) THEN (0)::numeric
                    ELSE (((s.revenue_cents - s.cost_cents))::numeric / (s.units_sold)::numeric)
                END) AS margin_score
           FROM item_sales s
        )
 SELECT location_id,
    item_id,
    item_name,
    category_id,
    category_name,
    units_sold,
    revenue_cents,
    cost_cents,
    margin_cents,
    margin_per_unit_cents,
    round((popularity_score)::numeric, 4) AS popularity_score,
    round((margin_score)::numeric, 4) AS margin_score,
        CASE
            WHEN ((popularity_score >= (0.5)::double precision) AND (margin_score >= (0.5)::double precision)) THEN 'star'::text
            WHEN ((popularity_score >= (0.5)::double precision) AND (margin_score < (0.5)::double precision)) THEN 'plowhorse'::text
            WHEN ((popularity_score < (0.5)::double precision) AND (margin_score >= (0.5)::double precision)) THEN 'puzzle'::text
            ELSE 'dog'::text
        END AS classification
   FROM scored;
COMMENT ON VIEW public.menu_engineering IS 'Trailing 30-day menu engineering four-box (star/plowhorse/puzzle/dog). Cost is items.cost_price (converted to cents) * qty — not recipe-weighted. security_invoker = on. All amounts in cents.';
CREATE TABLE public.menu_schedule_slots (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    menu_schedule_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT menu_schedule_slots_day_of_week_check CHECK (((day_of_week >= 1) AND (day_of_week <= 7))),
    CONSTRAINT menu_schedule_slots_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.menu_schedule_slots FORCE ROW LEVEL SECURITY;
CREATE TABLE public.menu_schedules (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT menu_schedules_location_id_code_key UNIQUE (location_id, code),
    CONSTRAINT menu_schedules_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.menu_schedules FORCE ROW LEVEL SECURITY;
CREATE TABLE public.modifier_groups (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    name text NOT NULL,
    min_select integer DEFAULT 0 NOT NULL,
    max_select integer DEFAULT 1 NOT NULL,
    is_required boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT modifier_groups_check CHECK ((max_select >= min_select)),
    CONSTRAINT modifier_groups_max_select_check CHECK ((max_select >= 1)),
    CONSTRAINT modifier_groups_min_select_check CHECK ((min_select >= 0)),
    CONSTRAINT modifier_groups_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.modifier_groups FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.modifier_groups IS 'NEW (ROADMAP Now-22). Replaces legacy item_variations. Supports min/max selection cardinality and required-group semantics. item_variations and item_variation_options from legacy migration 2 are intentionally omitted; this model supersedes them.';
CREATE TABLE public.modifiers (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    modifier_group_id uuid NOT NULL,
    name text NOT NULL,
    price_delta_cents bigint DEFAULT 0 NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT modifiers_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.modifiers FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.modifiers IS 'NEW (ROADMAP Now-22). Replaces legacy item_variation_options. price_delta_cents is signed (positive = surcharge, negative = discount). is_active can be flipped per-option to soft-86 a single modifier (plan §004: is_active bool).';
CREATE TABLE public.onboarding_progress (

    org_id uuid NOT NULL,
    step integer DEFAULT 0 NOT NULL,
    completed_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT onboarding_progress_pkey PRIMARY KEY (org_id)
);
ALTER TABLE ONLY public.onboarding_progress FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.onboarding_progress IS 'Stores per-organisation onboarding wizard progress. One row per org. step is the highest wizard step reached (0-based). completed_steps is a jsonb array of step-key strings explicitly completed. Written by the onboarding handler; read by the wizard UI to resume.';
COMMENT ON COLUMN public.onboarding_progress.org_id IS 'FK to organizations.id. Primary key — one row per organisation.';
COMMENT ON COLUMN public.onboarding_progress.step IS 'Highest wizard step index reached by the user (0-based). Step 0 = verify email, 1 = first store, 2 = menu items, 3 = invite staff/driver, 4 = connect payment, 5 = test order.';
COMMENT ON COLUMN public.onboarding_progress.completed_steps IS 'JSON array of step keys that have been fully completed, e.g. ["email","location","menu","staff","payment","order"]. The wizard UI updates this on each step completion.';
COMMENT ON COLUMN public.onboarding_progress.updated_at IS 'Timestamp of the last progress write. Updated automatically by trigger.';
CREATE TABLE public.order_item_discounts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_item_id uuid NOT NULL,
    promotion_redemption_id uuid NOT NULL,
    discount_amount_cents bigint NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_item_discounts_discount_amount_cents_check CHECK ((discount_amount_cents >= 0)),
    CONSTRAINT order_item_discounts_order_item_id_promotion_redemption_id_key UNIQUE (order_item_id, promotion_redemption_id),
    CONSTRAINT order_item_discounts_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.order_item_discounts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.order_item_modifiers (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_item_id uuid NOT NULL,
    modifier_id uuid NOT NULL,
    price_cents_snapshot bigint NOT NULL,
    name_snapshot text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_item_modifiers_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.order_item_modifiers FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.order_item_modifiers IS 'NEW (Wave 11). Records which modifier options were selected for each order_item. Snapshots name and price so the order record is immutable regardless of later catalogue edits. modifier_id is kept (not nullable) for back-reference and reporting; use *_snapshot columns for display.';
COMMENT ON COLUMN public.order_item_modifiers.price_cents_snapshot IS 'modifiers.price_delta_cents captured at order time (signed: positive = surcharge, negative = discount). Immutable after insert.';
COMMENT ON COLUMN public.order_item_modifiers.name_snapshot IS 'modifiers.name captured at order time. Immutable after insert.';
CREATE TABLE public.order_tracking_tokens (

    token text NOT NULL,
    order_id uuid NOT NULL,
    customer_profile_id uuid,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT order_tracking_tokens_pkey PRIMARY KEY (token)
);
ALTER TABLE ONLY public.order_tracking_tokens FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.order_tracking_tokens IS 'Short-lived tokens allowing customers (or anonymous links) to track an order without authentication. customer_profile_id links to the profiles row when the customer is authenticated; NULL for link-based anonymous tracking.';
CREATE TABLE public.organization_invites (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    role text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT organization_invites_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text, 'admin'::text, 'kitchen'::text, 'pos'::text, 'driver'::text]))),
    CONSTRAINT organization_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]))),
    CONSTRAINT organization_invites_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.organization_invites FORCE ROW LEVEL SECURITY;
CREATE TABLE public.organization_members (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    role text NOT NULL,
    capabilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'staff'::text, 'admin'::text, 'kitchen'::text, 'pos'::text, 'driver'::text]))),
    CONSTRAINT organization_members_organization_id_profile_id_key UNIQUE (organization_id, profile_id),
    CONSTRAINT organization_members_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.organization_members FORCE ROW LEVEL SECURITY;
CREATE TABLE public.organizations (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    default_currency_code text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by uuid DEFAULT public.current_user_id(),
    paused_at timestamp with time zone,
    deleted_at timestamp with time zone,
    scheduled_purge_at timestamp with time zone,
    CONSTRAINT organizations_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.organizations FORCE ROW LEVEL SECURITY;
COMMENT ON COLUMN public.organizations.paused_at IS 'Set by the platform admin tool when an org is force-paused. NULL means the org is running normally. Non-NULL records the exact moment an admin paused the org. Cleared (set to NULL) on admin unpause. Wave 26 platform admin tool.';
COMMENT ON COLUMN public.organizations.deleted_at IS 'Timestamp of soft-delete initiation. NULL = active. Set to now() by DELETE /settings/account. Reversible via restore endpoint while scheduled_purge_at > now().';
COMMENT ON COLUMN public.organizations.scheduled_purge_at IS 'When the org is scheduled for hard-delete (deleted_at + 30 days). The softdelete job checks scheduled_purge_at < now() nightly.';
CREATE TABLE public.password_reset_tokens (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash)
);
ALTER TABLE ONLY public.password_reset_tokens FORCE ROW LEVEL SECURITY;
CREATE TABLE public.payroll_periods (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    location_id uuid,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    totals_jsonb jsonb DEFAULT '{}'::jsonb NOT NULL,
    exported_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT payroll_periods_dates_check CHECK ((period_end >= period_start)),
    CONSTRAINT payroll_periods_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'processing'::text, 'exported'::text, 'voided'::text]))),
    CONSTRAINT payroll_periods_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.payroll_periods FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.payroll_periods IS '[NEW] Payroll period aggregate: one row per exported payroll run for an org (optionally a specific location). The totals_jsonb snapshot is written once by the export job and treated as immutable after status=exported.';
CREATE TABLE public.pii_access_log (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_type public.actor_type NOT NULL,
    actor_id uuid,
    customer_id uuid,
    access_kind text NOT NULL,
    fields_accessed text[] DEFAULT '{}'::text[] NOT NULL,
    reason text,
    request_id text,
    ip_address inet,
    user_agent text,
    accessed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT pii_access_log_access_kind_check CHECK ((access_kind = ANY (ARRAY['view'::text, 'export'::text, 'update'::text, 'search'::text]))),
    CONSTRAINT pii_access_log_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.pii_access_log FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.pii_access_log IS 'Records every access to customer PII fields by staff / system / export jobs. Written by application code (not DB triggers). SELECT restricted to service_role to prevent PII log from becoming a privacy leak itself.';
CREATE TABLE public.platform_admin_actions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_user_id uuid NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT platform_admin_actions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.platform_admin_actions FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.platform_admin_actions IS 'Append-only audit log for every action taken via the platform admin tool. Service-role read/write only. Wave 26 platform admin tool.';
COMMENT ON COLUMN public.platform_admin_actions.admin_user_id IS 'auth_users.id of the platform admin who performed the action.';
COMMENT ON COLUMN public.platform_admin_actions.action IS 'Short verb describing the action, e.g. pause_org, unpause_org, impersonate_user, revoke_token, flag_org, clear_flag.';
COMMENT ON COLUMN public.platform_admin_actions.target_type IS 'Entity kind affected: organization, user, location, order, etc.';
COMMENT ON COLUMN public.platform_admin_actions.target_id IS 'UUID of the affected entity (matches target_type).';
COMMENT ON COLUMN public.platform_admin_actions.details IS 'Arbitrary JSON: reason string, before/after field snapshots, request IP, user-agent, or any other context the handler records.';
CREATE TABLE public.pos_shifts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    cash_drawer_id uuid,
    cash_drawer_session_id uuid,
    opened_by uuid,
    opened_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    closed_at timestamp with time zone,
    status text DEFAULT 'open'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT pos_shifts_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text]))),
    CONSTRAINT pos_shifts_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.pos_shifts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.prep_batch_inputs (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prep_batch_id uuid NOT NULL,
    inventory_item_id uuid NOT NULL,
    quantity_consumed numeric(10,2) NOT NULL,
    unit text NOT NULL,
    CONSTRAINT prep_batch_inputs_quantity_consumed_check CHECK ((quantity_consumed > (0)::numeric)),
    CONSTRAINT prep_batch_inputs_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.prep_batch_inputs FORCE ROW LEVEL SECURITY;
CREATE TABLE public.prep_batches (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    produced_inventory_item_id uuid NOT NULL,
    produced_quantity numeric(10,2) NOT NULL,
    produced_unit text NOT NULL,
    recipe_yield_pct numeric(5,2),
    prepared_by_staff_id uuid,
    prepared_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT prep_batches_produced_quantity_check CHECK ((produced_quantity > (0)::numeric)),
    CONSTRAINT prep_batches_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.prep_batches FORCE ROW LEVEL SECURITY;
CREATE TABLE public.profiles (

    id uuid NOT NULL,
    updated_at timestamp with time zone,
    username text,
    full_name text,
    email text,
    avatar_url text,
    website text,
    whatsapp_count integer DEFAULT 0 NOT NULL,
    phone text,
    department text,
    title text,
    CONSTRAINT username_length CHECK ((char_length(username) >= 3)),
    CONSTRAINT profiles_email_key UNIQUE (email),
    CONSTRAINT profiles_pkey PRIMARY KEY (id),
    CONSTRAINT profiles_username_key UNIQUE (username)
);
ALTER TABLE ONLY public.profiles FORCE ROW LEVEL SECURITY;
CREATE TABLE public.promotion_redemptions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promotion_id uuid NOT NULL,
    coupon_code_id uuid,
    order_id uuid NOT NULL,
    customer_id uuid,
    discount_amount_cents bigint NOT NULL,
    applied_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT promotion_redemptions_discount_amount_cents_check CHECK ((discount_amount_cents >= 0)),
    CONSTRAINT promotion_redemptions_pkey PRIMARY KEY (id),
    CONSTRAINT promotion_redemptions_promotion_id_order_id_key UNIQUE (promotion_id, order_id)
);
ALTER TABLE ONLY public.promotion_redemptions FORCE ROW LEVEL SECURITY;
CREATE TABLE public.promotion_target_categories (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promotion_id uuid NOT NULL,
    category_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT promotion_target_categories_pkey PRIMARY KEY (id),
    CONSTRAINT promotion_target_categories_promotion_id_category_id_key UNIQUE (promotion_id, category_id)
);
ALTER TABLE ONLY public.promotion_target_categories FORCE ROW LEVEL SECURITY;
CREATE TABLE public.promotion_target_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    promotion_id uuid NOT NULL,
    item_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT promotion_target_items_pkey PRIMARY KEY (id),
    CONSTRAINT promotion_target_items_promotion_id_item_id_key UNIQUE (promotion_id, item_id)
);
ALTER TABLE ONLY public.promotion_target_items FORCE ROW LEVEL SECURITY;
CREATE TABLE public.promotions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid,
    name text NOT NULL,
    description text,
    promo_type text NOT NULL,
    scope text NOT NULL,
    percent_off numeric(5,2),
    fixed_off_cents bigint,
    happy_hour_price_cents bigint,
    bogo_buy_qty integer DEFAULT 1 NOT NULL,
    bogo_get_qty integer DEFAULT 1 NOT NULL,
    bogo_get_discount_percent numeric(5,2) DEFAULT 100 NOT NULL,
    free_item_id uuid,
    min_spend_cents bigint DEFAULT 0 NOT NULL,
    max_discount_cents bigint,
    stackable boolean DEFAULT false NOT NULL,
    requires_coupon_code boolean DEFAULT false NOT NULL,
    active_from timestamp with time zone,
    active_until timestamp with time zone,
    dayparts jsonb,
    customer_segment text DEFAULT 'all'::text,
    usage_limit_total integer,
    usage_limit_per_customer integer DEFAULT 1,
    is_active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT promotions_bogo_get_discount_percent_check CHECK (((bogo_get_discount_percent >= (0)::numeric) AND (bogo_get_discount_percent <= (100)::numeric))),
    CONSTRAINT promotions_customer_segment_check CHECK (((customer_segment = ANY (ARRAY['all'::text, 'first_time'::text, 'vip'::text, 'lapsed'::text])) OR (customer_segment IS NULL))),
    CONSTRAINT promotions_percent_off_check CHECK (((percent_off IS NULL) OR ((percent_off >= (0)::numeric) AND (percent_off <= (100)::numeric)))),
    CONSTRAINT promotions_promo_type_check CHECK ((promo_type = ANY (ARRAY['percent_off'::text, 'fixed_off'::text, 'bogo'::text, 'free_item'::text, 'happy_hour_price'::text, 'free_delivery'::text]))),
    CONSTRAINT promotions_scope_check CHECK ((scope = ANY (ARRAY['order'::text, 'item'::text, 'category'::text, 'delivery'::text]))),
    CONSTRAINT promotions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.promotions FORCE ROW LEVEL SECURITY;
CREATE TABLE public.purchase_order_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id uuid NOT NULL,
    inventory_item_id uuid NOT NULL,
    supplier_inventory_item_id uuid,
    ordered_quantity numeric(12,4) NOT NULL,
    ordered_unit text NOT NULL,
    ordered_unit_price_cents bigint NOT NULL,
    received_quantity numeric(12,4) DEFAULT 0 NOT NULL,
    received_unit_price_cents bigint,
    line_total_cents bigint DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT purchase_order_items_ordered_quantity_check CHECK ((ordered_quantity > (0)::numeric)),
    CONSTRAINT purchase_order_items_ordered_unit_price_cents_check CHECK ((ordered_unit_price_cents >= 0)),
    CONSTRAINT purchase_order_items_received_quantity_check CHECK ((received_quantity >= (0)::numeric)),
    CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.purchase_order_items FORCE ROW LEVEL SECURITY;
CREATE TABLE public.purchase_orders (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    supplier_id uuid,
    po_number text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    ordered_by uuid,
    ordered_at timestamp with time zone,
    expected_delivery_date date,
    delivered_at timestamp with time zone,
    currency text NOT NULL,
    subtotal_cents bigint DEFAULT 0 NOT NULL,
    tax_cents bigint DEFAULT 0 NOT NULL,
    shipping_cents bigint DEFAULT 0 NOT NULL,
    total_cents bigint DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT purchase_orders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'partially_received'::text, 'received'::text, 'cancelled'::text, 'closed'::text]))),
    CONSTRAINT purchase_orders_location_id_po_number_key UNIQUE (location_id, po_number),
    CONSTRAINT purchase_orders_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.purchase_orders FORCE ROW LEVEL SECURITY;
CREATE TABLE public.receipt_documents (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    storage_key text NOT NULL,
    channel text DEFAULT 'pdf'::text NOT NULL,
    generated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    retention_until timestamp with time zone DEFAULT (timezone('utc'::text, now()) + '7 years'::interval) NOT NULL,
    CONSTRAINT receipt_documents_channel_check CHECK ((channel = ANY (ARRAY['pdf'::text, 'email'::text, 'whatsapp'::text]))),
    CONSTRAINT receipt_documents_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.receipt_documents FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.receipt_documents IS 'Records of generated and delivered receipt PDFs, one row per channel per delivery event. storage_key is an opaque blob reference (e.g. object-storage path or base64 stub). Retention is 7 years by default to satisfy fiscal record-keeping requirements.';
COMMENT ON COLUMN public.receipt_documents.storage_key IS 'Opaque reference to the stored PDF: object-storage path, CDN URL, or base64-encoded inline bytes. Interpretation is up to the caller.';
COMMENT ON COLUMN public.receipt_documents.channel IS 'Delivery channel: pdf = generated locally (HTTP download), email = delivered via email.Provider.Send, whatsapp = delivered via WhatsApp document message.';
CREATE VIEW public.recipe_breakdown WITH (security_invoker='on') AS
 SELECT p.id AS parent_item_id,
    p.name AS parent_item_name,
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
    round(((c.cost_contribution / NULLIF(public.calculate_recipe_cost(p.id), (0)::numeric)) * (100)::numeric), 2) AS cost_percentage
   FROM (public.items p
     CROSS JOIN LATERAL public.get_item_components(p.id) c(component_item_id, component_name, total_quantity, unit, level_depth, cost_contribution))
  WHERE (p.recipe_type = ANY (ARRAY['recipe'::text, 'component'::text]))
  ORDER BY p.name, c.level_depth, c.component_name;
COMMENT ON VIEW public.recipe_breakdown IS 'Flat expansion of every recipe-type item''s component tree via get_item_components(). One row per (parent item, component item) combination including recursive sub-components. total_quantity is the accumulated quantity at the given level depth. cost_percentage is this component''s share of the parent''s total recipe cost. WITH (security_invoker = on): RLS on items filters parents to the caller''s org; RLS on item_recipes inside get_item_components() applies the same. Ported from legacy migrations 20240101000005 and 20240101000007, adapted to use quantity_needed (consolidated schema column name in 004_menu.sql). Audit finding [3]: closes the missing view referenced in allowlist.go:52 and exercised by suite_recipes.go:90.';
CREATE TABLE public.recipe_cost_runs (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    last_price_history_id uuid,
    items_updated_count integer DEFAULT 0 NOT NULL,
    error_message text,
    CONSTRAINT recipe_cost_runs_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.recipe_cost_runs FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.recipe_cost_runs IS 'Watermark table for the background recipe-cost recomputation job. Populated when ingredient_price_history rows are inserted. Source: legacy migration 35. Not org-scoped; service_role only.';
CREATE TABLE public.refresh_tokens (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    issued_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by uuid,
    user_agent text,
    ip inet,
    CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash)
);
ALTER TABLE ONLY public.refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE TABLE public.refunds (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    order_id uuid NOT NULL,
    refund_amount_cents bigint NOT NULL,
    refund_reason text,
    refund_type text DEFAULT 'full'::text NOT NULL,
    refund_method text,
    external_refund_id text,
    refund_status text DEFAULT 'pending'::text NOT NULL,
    processed_by uuid,
    approved_by uuid,
    refunded_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT refunds_refund_status_check CHECK ((refund_status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT refunds_refund_type_check CHECK ((refund_type = ANY (ARRAY['full'::text, 'partial'::text]))),
    CONSTRAINT refunds_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.refunds FORCE ROW LEVEL SECURITY;
CREATE TABLE public.reservations (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    customer_id uuid,
    customer_name text NOT NULL,
    customer_phone text,
    customer_email text,
    party_size integer NOT NULL,
    reservation_at timestamp with time zone NOT NULL,
    duration_minutes integer DEFAULT 90 NOT NULL,
    table_id uuid,
    section_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    special_requests text,
    confirmation_sent_at timestamp with time zone,
    created_by_staff_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT reservations_party_size_check CHECK ((party_size > 0)),
    CONSTRAINT reservations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'seated'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text]))),
    CONSTRAINT reservations_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.reservations FORCE ROW LEVEL SECURITY;
CREATE VIEW public.revenue_by_payment_method WITH (security_invoker='on') AS
 SELECT o.location_id,
    date((op.paid_at AT TIME ZONE 'UTC'::text)) AS sale_date,
    op.payment_method_code,
    count(*) AS txn_count,
    (COALESCE(sum(op.amount_paid_cents), (0)::numeric))::bigint AS gross_cents,
    (0)::bigint AS processing_fee_cents,
    (COALESCE(sum(op.amount_paid_cents), (0)::numeric))::bigint AS net_cents,
    (COALESCE(sum(op.tip_amount_cents), (0)::numeric))::bigint AS tip_cents
   FROM (public.order_payments op
     JOIN public.orders o ON ((o.id = op.order_id)))
  WHERE ((op.payment_status = 'completed'::public.payment_status) AND (o.status <> 'cancelled'::public.order_status))
  GROUP BY o.location_id, (date((op.paid_at AT TIME ZONE 'UTC'::text))), op.payment_method_code;
COMMENT ON VIEW public.revenue_by_payment_method IS 'Completed-payment revenue per (location, date, method). All amounts in cents. security_invoker = on.';
CREATE TABLE public.reviews (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    rating integer NOT NULL,
    comment text,
    reply text,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 10))),
    CONSTRAINT reviews_order_id_key UNIQUE (order_id),
    CONSTRAINT reviews_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.reviews FORCE ROW LEVEL SECURITY;
CREATE VIEW public.sales_per_labor_hour WITH (security_invoker='on') AS
 WITH sales_agg AS (
         SELECT dss.location_id,
            dss.sale_date,
            (sum(dss.net_sales_cents))::bigint AS total_net_sales_cents
           FROM public.daily_sales_summary dss
          GROUP BY dss.location_id, dss.sale_date
        ), labor_agg AS (
         SELECT lcd.location_id,
            lcd.work_date,
            sum(lcd.hours_worked) AS total_hours_worked
           FROM public.labor_cost_daily lcd
          GROUP BY lcd.location_id, lcd.work_date
        )
 SELECT COALESCE(s.location_id, l.location_id) AS location_id,
    COALESCE(s.sale_date, l.work_date) AS sale_date,
    s.total_net_sales_cents,
    l.total_hours_worked,
        CASE
            WHEN (COALESCE(l.total_hours_worked, (0)::numeric) = (0)::numeric) THEN NULL::numeric
            ELSE round(((s.total_net_sales_cents)::numeric / l.total_hours_worked), 2)
        END AS net_sales_cents_per_labor_hour
   FROM (sales_agg s
     FULL JOIN labor_agg l ON (((l.location_id = s.location_id) AND (l.work_date = s.sale_date))));
COMMENT ON VIEW public.sales_per_labor_hour IS 'Net sales cents / total hours worked per (location, date). NULL when no clock-in hours for that day. security_invoker = on.';
CREATE TABLE public.seats (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_session_id uuid NOT NULL,
    seat_number integer NOT NULL,
    guest_name text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT seats_seat_number_check CHECK ((seat_number > 0)),
    CONSTRAINT seats_pkey PRIMARY KEY (id),
    CONSTRAINT seats_table_session_id_seat_number_key UNIQUE (table_session_id, seat_number)
);
ALTER TABLE ONLY public.seats FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.seats IS 'Individual diner seats within a table session. order_items can be linked to a seat to enable per-seat check splitting.';
CREATE TABLE public.sections (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT sections_location_id_name_key UNIQUE (location_id, name),
    CONSTRAINT sections_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.sections FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.sections IS 'Floor sections / areas within a location (e.g. Patio, Bar, Main Room). Each section groups physical tables on the floor plan.';
CREATE TABLE public.staff (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    member_id uuid,
    employee_id text,
    first_name text NOT NULL,
    last_name text NOT NULL,
    display_name text,
    email text,
    phone text,
    role text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    failed_login_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    password_hash text,
    password_set_at timestamp with time zone,
    must_change_password boolean DEFAULT false NOT NULL,
    pin_hash text,
    username text,
    hire_date date,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT staff_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'manager'::text, 'cashier'::text, 'kitchen'::text, 'admin'::text]))),
    CONSTRAINT staff_employee_id_key UNIQUE (employee_id),
    CONSTRAINT staff_location_id_password_hash_key UNIQUE (location_id, password_hash),
    CONSTRAINT staff_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.staff FORCE ROW LEVEL SECURITY;
CREATE TABLE public.staff_attendance_summary (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    location_id uuid NOT NULL,
    work_date date NOT NULL,
    clock_in_time timestamp with time zone,
    clock_out_time timestamp with time zone,
    total_hours numeric(4,2) DEFAULT 0 NOT NULL,
    break_minutes integer DEFAULT 0 NOT NULL,
    overtime_hours numeric(4,2) DEFAULT 0 NOT NULL,
    is_present boolean DEFAULT false NOT NULL,
    is_late boolean DEFAULT false NOT NULL,
    minutes_late integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT staff_attendance_summary_pkey PRIMARY KEY (id),
    CONSTRAINT staff_attendance_summary_staff_id_work_date_key UNIQUE (staff_id, work_date)
);
ALTER TABLE ONLY public.staff_attendance_summary FORCE ROW LEVEL SECURITY;
CREATE TABLE public.staff_password_reset_tokens (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    token_hash text NOT NULL,
    issued_by uuid,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT staff_password_reset_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT staff_password_reset_tokens_token_hash_key UNIQUE (token_hash)
);
ALTER TABLE ONLY public.staff_password_reset_tokens FORCE ROW LEVEL SECURITY;
CREATE TABLE public.staff_refresh_tokens (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    token_hash text NOT NULL,
    issued_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    replaced_by uuid,
    user_agent text,
    ip inet,
    CONSTRAINT staff_refresh_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT staff_refresh_tokens_token_hash_key UNIQUE (token_hash)
);
ALTER TABLE ONLY public.staff_refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE TABLE public.staff_shifts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    staff_id uuid NOT NULL,
    location_id uuid NOT NULL,
    shift_date date NOT NULL,
    scheduled_start time without time zone NOT NULL,
    scheduled_end time without time zone NOT NULL,
    actual_start time without time zone,
    actual_end time without time zone,
    total_hours numeric(4,2),
    break_duration_minutes integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT staff_shifts_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'no_show'::text, 'partial'::text]))),
    CONSTRAINT staff_shifts_pkey PRIMARY KEY (id),
    CONSTRAINT staff_shifts_staff_id_shift_date_key UNIQUE (staff_id, shift_date)
);
ALTER TABLE ONLY public.staff_shifts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.stock_movements (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inventory_item_id uuid NOT NULL,
    movement_type text NOT NULL,
    quantity numeric(10,3) NOT NULL,
    unit_cost numeric(10,2),
    reference_id uuid,
    notes text,
    waste_reason text,
    recorded_by uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT stock_movements_movement_type_check CHECK ((movement_type = ANY (ARRAY['purchase'::text, 'sale'::text, 'waste'::text, 'adjustment'::text, 'grn'::text]))),
    CONSTRAINT stock_movements_waste_reason_check CHECK (((waste_reason IS NULL) OR (waste_reason = ANY (ARRAY['spoilage'::text, 'spillage'::text, 'theft'::text, 'staff_meal'::text, 'prep_loss'::text, 'expired'::text, 'contamination'::text])))),
    CONSTRAINT stock_movements_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.stock_movements FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.stock_movements IS 'Append-only audit ledger for inventory_items stock changes. movement_type includes ''grn'' (goods receipt note) from legacy 31. waste_reason constraint added by legacy 34.';
CREATE TABLE public.store_credit_transactions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    store_credit_id uuid NOT NULL,
    txn_type text NOT NULL,
    amount_cents bigint NOT NULL,
    balance_after_cents bigint NOT NULL,
    order_id uuid,
    payment_id uuid,
    refund_id uuid,
    performed_by_staff_id uuid,
    granted_by_profile_id uuid,
    reason text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT store_credit_transactions_balance_after_cents_check CHECK ((balance_after_cents >= 0)),
    CONSTRAINT store_credit_transactions_txn_type_check CHECK ((txn_type = ANY (ARRAY['grant'::text, 'redeem'::text, 'refund_to_credit'::text, 'expire'::text, 'adjust'::text]))),
    CONSTRAINT store_credit_transactions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.store_credit_transactions FORCE ROW LEVEL SECURITY;
CREATE TABLE public.store_credits (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    balance_cents bigint DEFAULT 0 NOT NULL,
    currency text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT store_credits_balance_cents_check CHECK ((balance_cents >= 0)),
    CONSTRAINT store_credits_organization_id_customer_id_key UNIQUE (organization_id, customer_id),
    CONSTRAINT store_credits_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.store_credits FORCE ROW LEVEL SECURITY;
CREATE TABLE public.supplier_contacts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    name text NOT NULL,
    role text,
    email text,
    phone text,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT supplier_contacts_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.supplier_contacts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.supplier_inventory_items (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    inventory_item_id uuid NOT NULL,
    supplier_sku text,
    pack_size numeric(12,4),
    pack_unit text,
    last_price_per_pack_cents bigint,
    lead_time_days integer,
    is_preferred boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT supplier_inventory_items_pkey PRIMARY KEY (id),
    CONSTRAINT supplier_inventory_items_supplier_id_inventory_item_id_key UNIQUE (supplier_id, inventory_item_id)
);
ALTER TABLE ONLY public.supplier_inventory_items FORCE ROW LEVEL SECURITY;
CREATE TABLE public.supplier_invoice_lines (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_invoice_id uuid NOT NULL,
    purchase_order_item_id uuid,
    goods_receipt_item_id uuid,
    description text,
    quantity numeric(12,4) NOT NULL,
    unit_price_cents bigint NOT NULL,
    line_total_cents bigint NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT supplier_invoice_lines_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT supplier_invoice_lines_unit_price_cents_check CHECK ((unit_price_cents >= 0)),
    CONSTRAINT supplier_invoice_lines_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.supplier_invoice_lines FORCE ROW LEVEL SECURITY;
CREATE TABLE public.supplier_invoices (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    location_id uuid NOT NULL,
    invoice_number text NOT NULL,
    invoice_date date NOT NULL,
    due_date date,
    subtotal_cents bigint DEFAULT 0 NOT NULL,
    tax_cents bigint DEFAULT 0 NOT NULL,
    total_cents bigint DEFAULT 0 NOT NULL,
    currency text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    match_status text DEFAULT 'unmatched'::text NOT NULL,
    paid_at timestamp with time zone,
    notes text,
    pdf_url text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT supplier_invoices_match_status_check CHECK ((match_status = ANY (ARRAY['unmatched'::text, 'price_variance'::text, 'qty_variance'::text, 'matched'::text]))),
    CONSTRAINT supplier_invoices_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'matched'::text, 'disputed'::text, 'approved'::text, 'paid'::text, 'cancelled'::text]))),
    CONSTRAINT supplier_invoices_pkey PRIMARY KEY (id),
    CONSTRAINT supplier_invoices_supplier_id_invoice_number_key UNIQUE (supplier_id, invoice_number)
);
ALTER TABLE ONLY public.supplier_invoices FORCE ROW LEVEL SECURITY;
CREATE TABLE public.supplier_locations (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    location_id uuid NOT NULL,
    account_number text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT supplier_locations_pkey PRIMARY KEY (id),
    CONSTRAINT supplier_locations_supplier_id_location_id_key UNIQUE (supplier_id, location_id)
);
ALTER TABLE ONLY public.supplier_locations FORCE ROW LEVEL SECURITY;
CREATE TABLE public.suppliers (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    display_name text,
    tax_id text,
    payment_terms_days integer DEFAULT 30 NOT NULL,
    default_currency text NOT NULL,
    website text,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT suppliers_default_currency_check CHECK ((char_length(default_currency) = 3)),
    CONSTRAINT suppliers_organization_id_name_key UNIQUE (organization_id, name),
    CONSTRAINT suppliers_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.suppliers FORCE ROW LEVEL SECURITY;
CREATE TABLE public.table_sessions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_id uuid NOT NULL,
    location_id uuid NOT NULL,
    opened_by uuid,
    party_size integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    opened_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    closed_at timestamp with time zone,
    transferred_to_session_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT table_sessions_party_size_check CHECK ((party_size > 0)),
    CONSTRAINT table_sessions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'transferred'::text]))),
    CONSTRAINT table_sessions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.table_sessions FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.table_sessions IS 'A party occupying a table. Tracks open/closed/transferred state. Orders placed during this session are linked via orders.table_session_id (defined in 008).';
CREATE TABLE public.tables (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    section_id uuid,
    label text NOT NULL,
    capacity integer NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    pos_x numeric(8,2),
    pos_y numeric(8,2),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT tables_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT tables_status_check CHECK ((status = ANY (ARRAY['available'::text, 'occupied'::text, 'reserved'::text, 'out_of_service'::text]))),
    CONSTRAINT tables_location_id_label_key UNIQUE (location_id, label),
    CONSTRAINT tables_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.tables FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tables IS 'Physical restaurant tables. Linked to a section (floor area) and tracked through table_sessions. pos_x/pos_y support drag-and-drop floor-plan editors.';
CREATE TABLE public.tax_profiles (

    org_id uuid NOT NULL,
    legal_name text NOT NULL,
    registered_address text NOT NULL,
    country text NOT NULL,
    vat_number text,
    vat_rate_percent numeric(6,4),
    company_number text,
    contact_email text,
    contact_phone text,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT tax_profiles_country_check CHECK ((char_length(country) = 2)),
    CONSTRAINT tax_profiles_pkey PRIMARY KEY (org_id)
);
ALTER TABLE ONLY public.tax_profiles FORCE ROW LEVEL SECURITY;
CREATE TABLE public.tax_rates (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    name text NOT NULL,
    rate numeric(5,2) NOT NULL,
    is_inclusive boolean DEFAULT true NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT tax_rates_rate_check CHECK (((rate >= (0)::numeric) AND (rate <= (100)::numeric))),
    CONSTRAINT tax_rates_location_id_name_key UNIQUE (location_id, name),
    CONSTRAINT tax_rates_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.tax_rates FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tax_rates IS 'Tax rate configurations per location. is_inclusive=true means prices already include this tax (standard for ZA VAT). Multiple rates per location are supported for mixed-tax menus.';
COMMENT ON COLUMN public.tax_rates.is_inclusive IS 'true = prices already include this tax (the VAT/GST convention used in ZA, the EU, the UK, AU and JP). false = tax is added at the register (the US/CA sales-tax convention). Set from the location''s configuration, not assumed.';
CREATE VIEW public.theoretical_vs_actual_cogs WITH (security_invoker='on') AS
 WITH theoretical AS (
         SELECT o.location_id,
            date((o.created_at AT TIME ZONE 'UTC'::text)) AS sale_date,
            (sum(((oi.quantity)::numeric * round((COALESCE(i.cost_price, (0)::numeric) * (100)::numeric)))))::bigint AS theoretical_cost_cents
           FROM ((public.orders o
             JOIN public.order_items oi ON ((oi.order_id = o.id)))
             JOIN public.items i ON ((i.id = oi.item_id)))
          WHERE ((o.status <> 'cancelled'::public.order_status) AND (o.created_at >= (now() - '30 days'::interval)))
          GROUP BY o.location_id, (date((o.created_at AT TIME ZONE 'UTC'::text)))
        ), actual AS (
         SELECT inv.location_id,
            date((sm.created_at AT TIME ZONE 'UTC'::text)) AS sale_date,
            (sum((abs(sm.quantity) * COALESCE(sm.unit_cost, (0)::numeric))))::bigint AS actual_cost_cents
           FROM (public.stock_movements sm
             JOIN public.inventory_items inv ON ((inv.id = sm.inventory_item_id)))
          WHERE ((sm.movement_type = ANY (ARRAY['sale'::text, 'waste'::text])) AND (sm.created_at >= (now() - '30 days'::interval)))
          GROUP BY inv.location_id, (date((sm.created_at AT TIME ZONE 'UTC'::text)))
        )
 SELECT COALESCE(t.location_id, a.location_id) AS location_id,
    COALESCE(t.sale_date, a.sale_date) AS sale_date,
    COALESCE(t.theoretical_cost_cents, (0)::bigint) AS theoretical_cost_cents,
    COALESCE(a.actual_cost_cents, (0)::bigint) AS actual_cost_cents,
    (COALESCE(a.actual_cost_cents, (0)::bigint) - COALESCE(t.theoretical_cost_cents, (0)::bigint)) AS variance_cents,
        CASE
            WHEN (COALESCE(t.theoretical_cost_cents, (0)::bigint) = 0) THEN NULL::numeric
            ELSE round(((((COALESCE(a.actual_cost_cents, (0)::bigint) - t.theoretical_cost_cents))::numeric / (NULLIF(t.theoretical_cost_cents, 0))::numeric) * (100)::numeric), 2)
        END AS variance_pct
   FROM (theoretical t
     FULL JOIN actual a ON (((a.location_id = t.location_id) AND (a.sale_date = t.sale_date))));
COMMENT ON VIEW public.theoretical_vs_actual_cogs IS 'Food-cost variance per (location, date): theoretical (cost_price in cents * qty) vs actual stock consumption (stock_movements sale/waste). All amounts in cents. security_invoker = on.';
CREATE TABLE public.tip_distributions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tip_pool_id uuid NOT NULL,
    staff_id uuid NOT NULL,
    amount_cents bigint NOT NULL,
    hours_worked numeric(8,2),
    weight_points numeric(8,2),
    distributed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    payroll_exported_at timestamp with time zone,
    CONSTRAINT tip_distributions_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT tip_distributions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.tip_distributions FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tip_distributions IS 'Per-staff disbursements from a tip pool. payroll_exported_at is set by the payroll export job once the row is included in an exported payroll_period.';
CREATE TABLE public.tip_pool_contributions (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tip_pool_id uuid NOT NULL,
    order_payment_id uuid,
    amount_cents bigint NOT NULL,
    contributed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT tip_pool_contributions_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT tip_pool_contributions_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.tip_pool_contributions FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tip_pool_contributions IS 'Individual tip amounts flowing into a pool from an order payment. amount_cents must be >= 0; negative adjustments are not supported here (reduce contributions by voiding the source order_payment).';
CREATE TABLE public.tip_pools (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid,
    name text NOT NULL,
    rule_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    shift_date date,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    distributed_at timestamp with time zone,
    CONSTRAINT tip_pools_rule_type_check CHECK ((rule_type = ANY (ARRAY['equal_split'::text, 'hours_weighted'::text, 'points_weighted'::text, 'role_weighted'::text]))),
    CONSTRAINT tip_pools_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.tip_pools FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.tip_pools IS 'Tipping pool definitions. Each pool collects tip contributions from one or more order payments and distributes them to staff according to rule_type. shift_date is nullable: NULL = rolling pool not tied to a single date.';
COMMENT ON COLUMN public.tip_pools.distributed_at IS 'Set to the UTC timestamp when DistributePool successfully ran for this pool. NULL means the pool has not been distributed yet. Once set, any further distribute attempts are rejected with HTTP 409.';
CREATE TABLE public.user_backup_codes (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT user_backup_codes_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.user_backup_codes FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.user_backup_codes IS 'One-time backup codes for TOTP recovery. Each code is stored as a SHA-256 hash; the plaintext is shown to the user exactly once at enroll time.';
COMMENT ON COLUMN public.user_backup_codes.profile_id IS 'References profiles.id (= auth_users.id). Cascades on user deletion.';
COMMENT ON COLUMN public.user_backup_codes.code_hash IS 'SHA-256 hex digest of the raw 8-character alphanumeric backup code.';
COMMENT ON COLUMN public.user_backup_codes.used_at IS 'Timestamp of first (and only permitted) use. NULL means the code is still valid.';
CREATE TABLE public.user_preferences (

    profile_id uuid NOT NULL,
    last_view_pos text,
    last_view_kds text,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT user_preferences_pkey PRIMARY KEY (profile_id)
);
ALTER TABLE ONLY public.user_preferences FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.user_preferences IS 'Per-user workspace view preferences. One row per profile. Written by PUT /me/preferences; read by GET /me/preferences. Wave 35 / Now-27 unified workspace.';
COMMENT ON COLUMN public.user_preferences.last_view_pos IS 'Last POS sub-view selected: quick | full | floor | orders. NULL means "not yet set — use default".';
COMMENT ON COLUMN public.user_preferences.last_view_kds IS 'Last Kitchen sub-view selected: station | expo | bumpbar. NULL means "not yet set — use default".';
CREATE TABLE public.waitlist (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    location_id uuid NOT NULL,
    customer_name text NOT NULL,
    customer_phone text,
    party_size integer NOT NULL,
    quoted_wait_minutes integer,
    added_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    seated_at timestamp with time zone,
    removed_at timestamp with time zone,
    removal_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT waitlist_party_size_check CHECK ((party_size > 0)),
    CONSTRAINT waitlist_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.waitlist FORCE ROW LEVEL SECURITY;
CREATE TABLE public.webhook_deliveries (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    endpoint_id uuid NOT NULL,
    org_id uuid NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    response_code integer,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    CONSTRAINT webhook_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text]))),
    CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.webhook_deliveries FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.webhook_deliveries IS 'Append-only delivery log and retry queue for outbound tenant webhooks. Rows are created by the delivery worker (service_role) on each event dispatch. org_id is denormalised from webhook_endpoints for org-scoped RLS SELECT. Tenant users have org-scoped SELECT for dashboard/debug views; all writes are restricted to service_role. Wave 22 feature.';
COMMENT ON COLUMN public.webhook_deliveries.org_id IS 'Denormalised from webhook_endpoints.org_id. Enables org-scoped RLS SELECT without a join. Must match the org_id of the referenced endpoint_id.';
COMMENT ON COLUMN public.webhook_deliveries.payload IS 'Full JSON event payload delivered (or attempted) to the endpoint. Stored for replay and audit. May contain PII — subject to org-scoped RLS.';
COMMENT ON COLUMN public.webhook_deliveries.status IS '"pending" = not yet attempted; "delivered" = HTTP 2xx received; "failed" = exhausted retries or non-retryable error. Retry worker selects WHERE status IN (''pending'', ''failed'').';
COMMENT ON COLUMN public.webhook_deliveries.attempts IS 'Number of delivery attempts made so far (including the first try). Retry worker increments this on each attempt. Upper retry limit (e.g. 5) is enforced in Go, not in the schema.';
CREATE TABLE public.webhook_endpoints (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    url text NOT NULL,
    signing_secret_ciphertext text,
    events text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    description text,
    CONSTRAINT webhook_endpoints_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.webhook_endpoints FORCE ROW LEVEL SECURITY;
CREATE TABLE public.whatsapp_account_links (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    phone_e164 text NOT NULL,
    bound_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_account_links_phone_e164_key UNIQUE (phone_e164),
    CONSTRAINT whatsapp_account_links_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.whatsapp_account_links FORCE ROW LEVEL SECURITY;
CREATE TABLE public.whatsapp_accounts (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    profile_id uuid NOT NULL,
    phone_e164 text NOT NULL,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT whatsapp_accounts_phone_e164_key UNIQUE (phone_e164),
    CONSTRAINT whatsapp_accounts_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.whatsapp_accounts FORCE ROW LEVEL SECURITY;
CREATE TABLE public.whatsapp_link_tokens (

    token text NOT NULL,
    phone_e164 text NOT NULL,
    intent public.whatsapp_link_intent NOT NULL,
    profile_id uuid,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    CONSTRAINT whatsapp_link_tokens_pkey PRIMARY KEY (token)
);
ALTER TABLE ONLY public.whatsapp_link_tokens FORCE ROW LEVEL SECURITY;
CREATE TABLE public.whatsapp_phone_numbers (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    meta_phone_number_id text NOT NULL,
    display_phone text NOT NULL,
    country text NOT NULL,
    regions text[] DEFAULT '{}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    configured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT whatsapp_phone_numbers_meta_phone_number_id_key UNIQUE (meta_phone_number_id),
    CONSTRAINT whatsapp_phone_numbers_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.whatsapp_phone_numbers FORCE ROW LEVEL SECURITY;
COMMENT ON TABLE public.whatsapp_phone_numbers IS 'Registry of WhatsApp phone numbers registered with the Meta Business API. Each row maps a Meta phone_number_id to a BeepBite-managed number with country/region routing metadata. Platform-owned; service role access only.';
COMMENT ON COLUMN public.whatsapp_phone_numbers.meta_phone_number_id IS 'The phone_number_id provided by Meta in webhook payloads (Metadata.PhoneNumberID). Used by the inbound webhook resolver to identify which BeepBite number received the message. UNIQUE enforces one row per Meta number.';
COMMENT ON COLUMN public.whatsapp_phone_numbers.display_phone IS 'Human-readable phone number (e.g. +27 82 123 4567). Shown in the platform-admin UI and in outbound message logs.';
COMMENT ON COLUMN public.whatsapp_phone_numbers.country IS 'ISO 3166-1 alpha-2 country code (e.g. ZA, NG, KE). Used by PickOutbound to select the country-primary number when no last-used number is recorded for a customer conversation.';
COMMENT ON COLUMN public.whatsapp_phone_numbers.regions IS 'Optional sub-region tags (e.g. {''gauteng'',''western-cape''}). Future routing logic may use these for finer-grained selection.';
COMMENT ON COLUMN public.whatsapp_phone_numbers.active IS 'False = number is deactivated; excluded from outbound routing and hidden from active listings. Rows are soft-deleted, never hard-deleted.';
COMMENT ON COLUMN public.whatsapp_phone_numbers.configured_at IS 'Timestamp when this number was first registered with BeepBite. Defaults to now(); may be set explicitly when backfilling historical numbers.';
CREATE TABLE public.whatsapp_routing (

    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    meta_phone_number_id text NOT NULL,
    phone_e164 text NOT NULL,
    country text,
    regions text[],
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT whatsapp_routing_meta_phone_number_id_key UNIQUE (meta_phone_number_id),
    CONSTRAINT whatsapp_routing_pkey PRIMARY KEY (id)
);
ALTER TABLE ONLY public.whatsapp_routing FORCE ROW LEVEL SECURITY;
ALTER TABLE ONLY public.driver_location_pings ATTACH PARTITION public.driver_location_pings_default DEFAULT;
ALTER TABLE ONLY public.driver_location_pings
    ADD CONSTRAINT driver_location_pings_pkey PRIMARY KEY (id, recorded_at);
CREATE INDEX audit_log_archived_action_created_at_idx ON public.audit_log_archived USING btree (action, created_at DESC);
CREATE INDEX audit_log_archived_actor_type_actor_id_created_at_idx ON public.audit_log_archived USING btree (actor_type, actor_id, created_at DESC);
CREATE INDEX audit_log_archived_entity_type_entity_id_created_at_idx ON public.audit_log_archived USING btree (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_archived_location_id_created_at_idx ON public.audit_log_archived USING btree (location_id, created_at DESC) WHERE (location_id IS NOT NULL);
CREATE INDEX audit_log_archived_organization_id_created_at_idx ON public.audit_log_archived USING btree (organization_id, created_at DESC);
CREATE UNIQUE INDEX coupon_codes_code_lower_idx ON public.coupon_codes USING btree (lower(code));
CREATE UNIQUE INDEX custom_domains_hostname_active_uq ON public.custom_domains USING btree (hostname) WHERE (removed_at IS NULL);
CREATE UNIQUE INDEX customer_loyalty_stamps_org_customer_location_uq ON public.customer_loyalty_stamps USING btree (organization_id, customer_id, location_id) WHERE (location_id IS NOT NULL);
CREATE UNIQUE INDEX customer_loyalty_stamps_org_customer_uq ON public.customer_loyalty_stamps USING btree (organization_id, customer_id) WHERE (location_id IS NULL);
CREATE INDEX idx_driver_location_pings_driver_time ON ONLY public.driver_location_pings USING btree (driver_member_id, recorded_at DESC);
CREATE INDEX driver_location_pings_default_driver_member_id_recorded_at_idx ON public.driver_location_pings_default USING btree (driver_member_id, recorded_at DESC);
CREATE INDEX elevation_tokens_used_used_at_idx ON public.elevation_tokens_used USING btree (used_at);
CREATE UNIQUE INDEX gift_cards_code_lower ON public.gift_cards USING btree (lower(code));
CREATE INDEX idx_adjustment_reasons_location ON public.adjustment_reasons USING btree (location_id);
CREATE INDEX idx_allergens_organization ON public.allergens USING btree (organization_id);
CREATE INDEX idx_api_keys_active ON public.api_keys USING btree (org_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_api_keys_key_hash ON public.api_keys USING btree (key_hash);
CREATE INDEX idx_api_keys_org ON public.api_keys USING btree (org_id);
CREATE INDEX idx_api_keys_prefix ON public.api_keys USING btree (prefix_visible);
CREATE INDEX idx_audit_log_action_created ON public.audit_log USING btree (action, created_at DESC);
CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_type, actor_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id, created_at DESC);
CREATE INDEX idx_audit_log_location_created ON public.audit_log USING btree (location_id, created_at DESC) WHERE (location_id IS NOT NULL);
CREATE INDEX idx_audit_log_org_created ON public.audit_log USING btree (organization_id, created_at DESC);
CREATE INDEX idx_auth_users_email ON public.auth_users USING btree (lower(email));
CREATE INDEX idx_cart_item_variations_cart_item ON public.cart_item_variations USING btree (cart_item_id);
CREATE INDEX idx_cart_items_created_at ON public.cart_items USING btree (created_at);
CREATE INDEX idx_cart_items_customer_location ON public.cart_items USING btree (customer_id, location_id);
CREATE INDEX idx_cart_items_item ON public.cart_items USING btree (item_id);
CREATE INDEX idx_cash_drawer_counts_session ON public.cash_drawer_counts USING btree (cash_drawer_session_id);
CREATE INDEX idx_cash_drawer_movements_created_at ON public.cash_drawer_movements USING btree (created_at);
CREATE INDEX idx_cash_drawer_movements_session ON public.cash_drawer_movements USING btree (cash_drawer_session_id);
CREATE INDEX idx_cash_drawer_session_payments_session ON public.cash_drawer_session_payments USING btree (cash_drawer_session_id);
CREATE INDEX idx_cash_drawer_sessions_drawer_status ON public.cash_drawer_sessions USING btree (cash_drawer_id, status);
CREATE INDEX idx_cash_drawer_sessions_opened_at ON public.cash_drawer_sessions USING btree (opened_at);
CREATE INDEX idx_cash_drawers_location ON public.cash_drawers USING btree (location_id);
CREATE INDEX idx_categories_location ON public.categories USING btree (location_id);
CREATE INDEX idx_categories_organization ON public.categories USING btree (organization_id);
CREATE INDEX idx_categories_parent ON public.categories USING btree (parent_id) WHERE (parent_id IS NOT NULL);
CREATE INDEX idx_check_split_items_check_split_id ON public.check_split_items USING btree (check_split_id);
CREATE INDEX idx_check_split_items_order_item_id ON public.check_split_items USING btree (order_item_id);
CREATE INDEX idx_check_splits_table_session_id ON public.check_splits USING btree (table_session_id);
CREATE INDEX idx_coupon_codes_assigned_customer ON public.coupon_codes USING btree (assigned_to_customer_id) WHERE (assigned_to_customer_id IS NOT NULL);
CREATE INDEX idx_coupon_codes_promotion ON public.coupon_codes USING btree (promotion_id);
CREATE INDEX idx_courses_location ON public.courses USING btree (location_id);
CREATE INDEX idx_csr_category_id ON public.category_station_routing USING btree (category_id);
CREATE INDEX idx_csr_station_id ON public.category_station_routing USING btree (station_id);
CREATE INDEX idx_custom_domains_hostname ON public.custom_domains USING btree (hostname);
CREATE INDEX idx_custom_domains_location ON public.custom_domains USING btree (location_id, created_at DESC) WHERE (removed_at IS NULL);
CREATE INDEX idx_custom_domains_location_id ON public.custom_domains USING btree (location_id);
CREATE INDEX idx_custom_domains_status ON public.custom_domains USING btree (status);
CREATE INDEX idx_customer_addresses_customer ON public.customer_addresses USING btree (customer_id);
CREATE INDEX idx_customer_favorites_customer ON public.customer_favorite_items USING btree (customer_id);
CREATE INDEX idx_customer_favorites_item ON public.customer_favorite_items USING btree (item_id);
CREATE INDEX idx_customer_favorites_org_customer ON public.customer_favorite_items USING btree (organization_id, customer_id);
CREATE INDEX idx_customer_loyalty_stamps_customer ON public.customer_loyalty_stamps USING btree (customer_id);
CREATE INDEX idx_customer_loyalty_stamps_org_customer ON public.customer_loyalty_stamps USING btree (organization_id, customer_id);
CREATE INDEX idx_customers_org ON public.customers USING btree (organization_id);
CREATE INDEX idx_customers_profile ON public.customers USING btree (profile_id) WHERE (profile_id IS NOT NULL);
CREATE INDEX idx_customers_whatsapp ON public.customers USING btree (whatsapp_number);
CREATE INDEX idx_customers_whatsapp_lower ON public.customers USING btree (lower(whatsapp_number));
COMMENT ON INDEX public.idx_customers_whatsapp_lower IS 'Case-insensitive prefix/exact search on customers.whatsapp_number for the POS "find customer by phone" flow. Complements idx_customers_whatsapp (010) which is a plain B-tree on the raw value. Wave 24 easy-wins feature.';
CREATE INDEX idx_data_export_jobs_org_status ON public.data_export_jobs USING btree (org_id, status);
CREATE INDEX idx_delivery_zones_location ON public.delivery_zones USING btree (location_id) WHERE is_active;
CREATE INDEX idx_delivery_zones_org ON public.delivery_zones USING btree (organization_id);
CREATE INDEX idx_dietary_tags_organization ON public.dietary_tags USING btree (organization_id);
CREATE INDEX idx_driver_assignments_driver ON public.driver_assignments USING btree (driver_member_id);
CREATE INDEX idx_driver_assignments_offered_at ON public.driver_assignments USING btree (offered_at);
CREATE INDEX idx_driver_assignments_order ON public.driver_assignments USING btree (order_id);
CREATE INDEX idx_driver_assignments_status ON public.driver_assignments USING btree (status);
CREATE INDEX idx_driver_emergency_contacts_driver ON public.driver_emergency_contacts USING btree (driver_member_id);
CREATE INDEX idx_driver_shifts_driver ON public.driver_shifts USING btree (driver_member_id);
CREATE INDEX idx_driver_shifts_started ON public.driver_shifts USING btree (started_at);
CREATE INDEX idx_email_verification_tokens_user ON public.email_verification_tokens USING btree (user_id);
CREATE INDEX idx_exchange_rates_codes_time ON public.exchange_rates USING btree (base_code, quote_code, fetched_at DESC);
CREATE INDEX idx_exchange_rates_pair_time ON public.exchange_rates USING btree (from_currency, to_currency, fetched_at DESC);
CREATE INDEX idx_gift_card_transactions_card_created ON public.gift_card_transactions USING btree (gift_card_id, created_at DESC);
CREATE INDEX idx_gift_card_transactions_order ON public.gift_card_transactions USING btree (order_id) WHERE (order_id IS NOT NULL);
CREATE INDEX idx_gift_cards_expires_at ON public.gift_cards USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_gift_cards_issued_to_customer ON public.gift_cards USING btree (issued_to_customer_id);
CREATE INDEX idx_gift_cards_organization ON public.gift_cards USING btree (organization_id);
CREATE INDEX idx_gift_cards_status ON public.gift_cards USING btree (status);
CREATE INDEX idx_goods_receipt_items_goods_receipt ON public.goods_receipt_items USING btree (goods_receipt_id);
CREATE INDEX idx_goods_receipt_items_purchase_order_item ON public.goods_receipt_items USING btree (purchase_order_item_id);
CREATE INDEX idx_goods_receipts_purchase_order ON public.goods_receipts USING btree (purchase_order_id);
CREATE INDEX idx_goods_receipts_received_at ON public.goods_receipts USING btree (received_at);
CREATE INDEX idx_house_account_charges_account ON public.house_account_charges USING btree (house_account_id);
CREATE INDEX idx_house_account_charges_invoice ON public.house_account_charges USING btree (house_account_invoice_id) WHERE (house_account_invoice_id IS NOT NULL);
CREATE INDEX idx_house_account_charges_order ON public.house_account_charges USING btree (order_id);
CREATE INDEX idx_house_account_invoices_account_status ON public.house_account_invoices USING btree (house_account_id, status);
CREATE INDEX idx_house_account_invoices_due_date ON public.house_account_invoices USING btree (due_date) WHERE (due_date IS NOT NULL);
CREATE INDEX idx_house_account_members_account ON public.house_account_members USING btree (house_account_id);
CREATE INDEX idx_house_account_members_customer ON public.house_account_members USING btree (customer_id);
CREATE INDEX idx_house_accounts_org_active ON public.house_accounts USING btree (organization_id, is_active);
CREATE INDEX idx_idempotency_keys_expires ON public.idempotency_keys USING btree (expires_at) WHERE (status = 'completed'::text);
CREATE INDEX idx_idempotency_keys_stuck ON public.idempotency_keys USING btree (status, locked_at) WHERE (status = 'in_progress'::text);
CREATE INDEX idx_ingredient_price_history_item_effective ON public.ingredient_price_history USING btree (inventory_item_id, effective_at DESC);
CREATE INDEX idx_ingredient_price_history_supplier ON public.ingredient_price_history USING btree (supplier_id);
CREATE INDEX idx_inventory_items_link_to_item ON public.inventory_items USING btree (link_to_item_id) WHERE (link_to_item_id IS NOT NULL);
CREATE INDEX idx_inventory_items_location ON public.inventory_items USING btree (location_id);
CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date) WHERE (due_date IS NOT NULL);
CREATE INDEX idx_invoices_issued_at ON public.invoices USING btree (issued_at);
CREATE INDEX idx_invoices_issuer_org ON public.invoices USING btree (issuer_org_id) WHERE (issuer_org_id IS NOT NULL);
CREATE INDEX idx_invoices_recipient_cust ON public.invoices USING btree (recipient_customer_id) WHERE (recipient_customer_id IS NOT NULL);
CREATE INDEX idx_invoices_recipient_org ON public.invoices USING btree (recipient_org_id) WHERE (recipient_org_id IS NOT NULL);
CREATE INDEX idx_invoices_status ON public.invoices USING btree (status);
CREATE INDEX idx_item_allergens_allergen_id ON public.item_allergens USING btree (allergen_id);
CREATE INDEX idx_item_allergens_item_id ON public.item_allergens USING btree (item_id);
CREATE INDEX idx_item_dietary_tags_dietary_tag_id ON public.item_dietary_tags USING btree (dietary_tag_id);
CREATE INDEX idx_item_dietary_tags_item_id ON public.item_dietary_tags USING btree (item_id);
CREATE INDEX idx_item_menu_schedules_item_id ON public.item_menu_schedules USING btree (item_id);
CREATE INDEX idx_item_menu_schedules_menu_schedule ON public.item_menu_schedules USING btree (menu_schedule_id);
CREATE INDEX idx_item_prep_steps_item ON public.item_prep_steps USING btree (item_id, step_number);
CREATE INDEX idx_item_price_schedules_item_id ON public.item_price_schedules USING btree (item_id);
CREATE INDEX idx_item_price_schedules_menu_schedule ON public.item_price_schedules USING btree (menu_schedule_id);
CREATE INDEX idx_item_recipes_child ON public.item_recipes USING btree (child_item_id);
CREATE INDEX idx_item_recipes_level ON public.item_recipes USING btree (recipe_level);
CREATE INDEX idx_item_recipes_parent ON public.item_recipes USING btree (parent_item_id);
CREATE INDEX idx_item_station_routing_item_id ON public.item_station_routing USING btree (item_id);
CREATE INDEX idx_item_station_routing_station_id ON public.item_station_routing USING btree (station_id);
CREATE INDEX idx_items_available_until ON public.items USING btree (available_until) WHERE (available_until IS NOT NULL);
CREATE INDEX idx_items_category ON public.items USING btree (category_id);
CREATE INDEX idx_items_daily_special ON public.items USING btree (location_id, is_daily_special, special_date) WHERE (is_daily_special = true);
CREATE INDEX idx_items_is_86ed ON public.items USING btree (is_86ed) WHERE (is_86ed = true);
CREATE INDEX idx_items_location_active_86ed ON public.items USING btree (location_id, is_active, is_86ed);
CREATE INDEX idx_kds_display_groups_location_id ON public.kds_display_groups USING btree (location_id);
CREATE INDEX idx_kds_fanout_queue_retry ON public.kds_fanout_queue USING btree (state, retry_count) WHERE (state = ANY (ARRAY['processing'::text, 'dead'::text]));
CREATE INDEX idx_kds_fanout_queue_unprocessed ON public.kds_fanout_queue USING btree (queued_at) WHERE (state = 'pending'::text);
CREATE INDEX idx_kds_ticket_events_created_at ON public.kds_ticket_events USING btree (created_at DESC);
CREATE INDEX idx_kds_ticket_events_ticket_id ON public.kds_ticket_events USING btree (ticket_id);
CREATE INDEX idx_kds_ticket_events_type ON public.kds_ticket_events USING btree (event_type, created_at DESC);
CREATE INDEX idx_kds_ticket_items_order_item_id ON public.kds_ticket_items USING btree (order_item_id);
CREATE INDEX idx_kds_ticket_items_ticket_id ON public.kds_ticket_items USING btree (ticket_id);
CREATE INDEX idx_kds_tickets_order_id ON public.kds_tickets USING btree (order_id);
CREATE INDEX idx_kds_tickets_station_status ON public.kds_tickets USING btree (station_id, status);
CREATE INDEX idx_kds_tickets_status_fired ON public.kds_tickets USING btree (status, fired_at);
CREATE INDEX idx_kitchen_stations_active ON public.kitchen_stations USING btree (location_id, is_active);
CREATE INDEX idx_kitchen_stations_location_id ON public.kitchen_stations USING btree (location_id);
CREATE INDEX idx_legal_acceptances_profile ON public.legal_acceptances USING btree (profile_id, accepted_at DESC);
CREATE UNIQUE INDEX idx_legal_acceptances_profile_document ON public.legal_acceptances USING btree (profile_id, document_id);
CREATE INDEX idx_legal_documents_kind_effective ON public.legal_documents USING btree (kind, effective_at DESC);
CREATE UNIQUE INDEX idx_legal_documents_kind_version ON public.legal_documents USING btree (kind, version);
CREATE INDEX idx_llm_messages_conversation ON public.llm_messages USING btree (conversation_id) WHERE (conversation_id IS NOT NULL);
CREATE INDEX idx_llm_messages_org_created ON public.llm_messages USING btree (organization_id, created_at DESC);
CREATE INDEX idx_llm_messages_provider_model ON public.llm_messages USING btree (provider, model);
CREATE INDEX idx_llm_model_pricing_provider ON public.llm_model_pricing USING btree (provider, model);
CREATE INDEX idx_llm_tool_executions_message ON public.llm_tool_executions USING btree (llm_message_id);
CREATE INDEX idx_llm_tool_executions_tool_name ON public.llm_tool_executions USING btree (tool_name, created_at DESC);
CREATE INDEX idx_loc_email_cred_active ON public.location_email_credentials USING btree (location_id, is_active);
CREATE INDEX idx_loc_email_cred_location ON public.location_email_credentials USING btree (location_id);
CREATE INDEX idx_loc_email_cred_provider ON public.location_email_credentials USING btree (provider_code);
CREATE INDEX idx_location_printers_location_active ON public.location_printers USING btree (location_id, is_active) WHERE is_active;
CREATE INDEX idx_location_printers_location_id ON public.location_printers USING btree (location_id);
CREATE INDEX idx_locations_active ON public.locations USING btree (is_active);
CREATE INDEX idx_locations_marketplace ON public.locations USING btree (is_marketplace_visible) WHERE (is_marketplace_visible = true);
CREATE INDEX idx_locations_organization_id ON public.locations USING btree (organization_id);
CREATE INDEX idx_locations_slug ON public.locations USING btree (slug) WHERE (slug IS NOT NULL);
CREATE INDEX idx_loyalty_transactions_customer_created ON public.loyalty_transactions USING btree (customer_id, created_at DESC);
CREATE INDEX idx_loyalty_transactions_expires_at ON public.loyalty_transactions USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_loyalty_transactions_order ON public.loyalty_transactions USING btree (order_id) WHERE (order_id IS NOT NULL);
CREATE INDEX idx_loyalty_transactions_organization ON public.loyalty_transactions USING btree (organization_id);
CREATE INDEX idx_marketplace_reviews_customer ON public.marketplace_reviews USING btree (customer_profile_id) WHERE (customer_profile_id IS NOT NULL);
CREATE INDEX idx_marketplace_reviews_location_created ON public.marketplace_reviews USING btree (location_id, created_at DESC);
CREATE INDEX idx_marketplace_reviews_location_status ON public.marketplace_reviews USING btree (location_id, status);
CREATE UNIQUE INDEX idx_marketplace_reviews_order_uq ON public.marketplace_reviews USING btree (order_id) WHERE (order_id IS NOT NULL);
CREATE INDEX idx_menu_schedule_slots_schedule_day ON public.menu_schedule_slots USING btree (menu_schedule_id, day_of_week);
CREATE INDEX idx_menu_schedules_location ON public.menu_schedules USING btree (location_id);
CREATE INDEX idx_modifier_groups_item ON public.modifier_groups USING btree (item_id);
CREATE INDEX idx_modifiers_active ON public.modifiers USING btree (modifier_group_id, is_active) WHERE (is_active = true);
CREATE INDEX idx_modifiers_group ON public.modifiers USING btree (modifier_group_id);
CREATE INDEX idx_order_adjustments_applied_by ON public.order_adjustments USING btree (applied_by);
CREATE INDEX idx_order_adjustments_created_at ON public.order_adjustments USING btree (created_at);
CREATE INDEX idx_order_adjustments_order ON public.order_adjustments USING btree (order_id);
CREATE INDEX idx_order_adjustments_order_item ON public.order_adjustments USING btree (order_item_id);
CREATE INDEX idx_order_item_discounts_order_item ON public.order_item_discounts USING btree (order_item_id);
CREATE INDEX idx_order_item_discounts_redemption ON public.order_item_discounts USING btree (promotion_redemption_id);
CREATE INDEX idx_order_item_modifiers_modifier_id ON public.order_item_modifiers USING btree (modifier_id);
CREATE INDEX idx_order_item_modifiers_order_item_id ON public.order_item_modifiers USING btree (order_item_id);
CREATE INDEX idx_order_items_course_id ON public.order_items USING btree (course_id) WHERE (course_id IS NOT NULL);
CREATE INDEX idx_order_items_item_id ON public.order_items USING btree (item_id);
CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);
CREATE INDEX idx_order_items_seat_id ON public.order_items USING btree (seat_id) WHERE (seat_id IS NOT NULL);
CREATE INDEX idx_order_payments_method ON public.order_payments USING btree (payment_method_code);
CREATE INDEX idx_order_payments_order_id ON public.order_payments USING btree (order_id);
CREATE INDEX idx_order_payments_paid_at ON public.order_payments USING btree (paid_at DESC);
CREATE INDEX idx_order_payments_status ON public.order_payments USING btree (payment_status);
CREATE INDEX idx_order_tracking_tokens_expires ON public.order_tracking_tokens USING btree (expires_at) WHERE (revoked_at IS NULL);
CREATE INDEX idx_order_tracking_tokens_order_id ON public.order_tracking_tokens USING btree (order_id);
CREATE INDEX idx_order_tracking_tokens_profile ON public.order_tracking_tokens USING btree (customer_profile_id) WHERE (customer_profile_id IS NOT NULL);
CREATE INDEX idx_orders_created_at ON public.orders USING btree (location_id, created_at DESC);
CREATE INDEX idx_orders_customer_id ON public.orders USING btree (customer_id) WHERE (customer_id IS NOT NULL);
CREATE INDEX idx_orders_delivery_address_id ON public.orders USING btree (delivery_address_id) WHERE (delivery_address_id IS NOT NULL);
CREATE UNIQUE INDEX idx_orders_fiscal_receipt_unique ON public.orders USING btree (location_id, fiscal_receipt_number) WHERE (fiscal_receipt_number IS NOT NULL);
CREATE INDEX idx_orders_held ON public.orders USING btree (location_id, held_at) WHERE (held_at IS NOT NULL);
CREATE INDEX idx_orders_location_business_date ON public.orders USING btree (location_id, business_date);
CREATE INDEX idx_orders_location_id ON public.orders USING btree (location_id);
CREATE INDEX idx_orders_open_tab ON public.orders USING btree (location_id, is_open_tab) WHERE (is_open_tab = true);
CREATE INDEX idx_orders_org_id ON public.orders USING btree (organization_id);
CREATE INDEX idx_orders_status ON public.orders USING btree (location_id, status);
CREATE INDEX idx_orders_table_session ON public.orders USING btree (table_session_id) WHERE (table_session_id IS NOT NULL);
CREATE INDEX idx_org_invites_email ON public.organization_invites USING btree (email);
CREATE INDEX idx_org_invites_org ON public.organization_invites USING btree (organization_id);
CREATE INDEX idx_org_members_active ON public.organization_members USING btree (organization_id) WHERE (archived_at IS NULL);
CREATE INDEX idx_org_members_org ON public.organization_members USING btree (organization_id);
CREATE INDEX idx_org_members_profile ON public.organization_members USING btree (profile_id);
CREATE INDEX idx_organizations_created_by ON public.organizations USING btree (created_by);
CREATE INDEX idx_password_reset_tokens_user ON public.password_reset_tokens USING btree (user_id);
CREATE INDEX idx_payroll_periods_location ON public.payroll_periods USING btree (location_id) WHERE (location_id IS NOT NULL);
CREATE UNIQUE INDEX idx_payroll_periods_no_overlap_location ON public.payroll_periods USING btree (org_id, location_id, period_start, period_end) WHERE (location_id IS NOT NULL);
CREATE UNIQUE INDEX idx_payroll_periods_no_overlap_org ON public.payroll_periods USING btree (org_id, period_start, period_end) WHERE (location_id IS NULL);
CREATE INDEX idx_payroll_periods_org ON public.payroll_periods USING btree (org_id, period_start DESC);
CREATE INDEX idx_payroll_periods_status ON public.payroll_periods USING btree (org_id, status) WHERE (status <> ALL (ARRAY['exported'::text, 'voided'::text]));
CREATE INDEX idx_pii_access_log_actor ON public.pii_access_log USING btree (actor_type, actor_id, accessed_at DESC);
CREATE INDEX idx_pii_access_log_customer ON public.pii_access_log USING btree (customer_id, accessed_at DESC) WHERE (customer_id IS NOT NULL);
CREATE INDEX idx_pii_access_log_kind ON public.pii_access_log USING btree (access_kind, accessed_at DESC);
CREATE INDEX idx_platform_admin_actions_admin ON public.platform_admin_actions USING btree (admin_user_id, created_at DESC);
CREATE INDEX idx_platform_admin_actions_created ON public.platform_admin_actions USING btree (created_at DESC);
CREATE INDEX idx_platform_admin_actions_target ON public.platform_admin_actions USING btree (target_type, target_id, created_at DESC);
CREATE INDEX idx_pos_shifts_location ON public.pos_shifts USING btree (location_id);
CREATE INDEX idx_pos_shifts_opened_by ON public.pos_shifts USING btree (opened_by) WHERE (opened_by IS NOT NULL);
CREATE INDEX idx_prep_batch_inputs_batch ON public.prep_batch_inputs USING btree (prep_batch_id);
CREATE INDEX idx_prep_batch_inputs_inventory_item ON public.prep_batch_inputs USING btree (inventory_item_id);
CREATE INDEX idx_prep_batches_location ON public.prep_batches USING btree (location_id);
CREATE INDEX idx_prep_batches_organization ON public.prep_batches USING btree (organization_id);
CREATE INDEX idx_prep_batches_produced_item ON public.prep_batches USING btree (produced_inventory_item_id);
CREATE INDEX idx_promotion_redemptions_applied_at ON public.promotion_redemptions USING btree (applied_at);
CREATE INDEX idx_promotion_redemptions_customer ON public.promotion_redemptions USING btree (customer_id);
CREATE INDEX idx_promotion_redemptions_order ON public.promotion_redemptions USING btree (order_id);
CREATE INDEX idx_promotion_redemptions_promotion ON public.promotion_redemptions USING btree (promotion_id);
CREATE INDEX idx_promotion_target_categories_category ON public.promotion_target_categories USING btree (category_id);
CREATE INDEX idx_promotion_target_categories_promotion ON public.promotion_target_categories USING btree (promotion_id);
CREATE INDEX idx_promotion_target_items_item ON public.promotion_target_items USING btree (item_id);
CREATE INDEX idx_promotion_target_items_promotion ON public.promotion_target_items USING btree (promotion_id);
CREATE INDEX idx_promotions_location_active ON public.promotions USING btree (location_id, is_active) WHERE (location_id IS NOT NULL);
CREATE INDEX idx_promotions_org_active ON public.promotions USING btree (organization_id, is_active);
CREATE INDEX idx_promotions_window ON public.promotions USING btree (active_from, active_until);
CREATE INDEX idx_purchase_order_items_inventory_item ON public.purchase_order_items USING btree (inventory_item_id);
CREATE INDEX idx_purchase_order_items_purchase_order ON public.purchase_order_items USING btree (purchase_order_id);
CREATE INDEX idx_purchase_orders_expected_delivery ON public.purchase_orders USING btree (expected_delivery_date);
CREATE INDEX idx_purchase_orders_location_status ON public.purchase_orders USING btree (location_id, status);
CREATE INDEX idx_purchase_orders_supplier ON public.purchase_orders USING btree (supplier_id);
CREATE INDEX idx_receipt_documents_order_id ON public.receipt_documents USING btree (order_id);
CREATE INDEX idx_receipt_documents_org_generated ON public.receipt_documents USING btree (organization_id, generated_at DESC);
CREATE INDEX idx_recipe_cost_runs_started_at ON public.recipe_cost_runs USING btree (started_at DESC);
CREATE INDEX idx_refresh_tokens_expires ON public.refresh_tokens USING btree (expires_at);
CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens USING btree (user_id);
CREATE UNIQUE INDEX idx_refunds_external_refund_id_unique ON public.refunds USING btree (external_refund_id) WHERE (external_refund_id IS NOT NULL);
CREATE INDEX idx_refunds_order_id ON public.refunds USING btree (order_id);
CREATE INDEX idx_refunds_payment_id ON public.refunds USING btree (payment_id);
CREATE INDEX idx_refunds_status ON public.refunds USING btree (refund_status);
CREATE INDEX idx_reservations_location_date ON public.reservations USING btree (location_id, reservation_at);
CREATE INDEX idx_reviews_order ON public.reviews USING btree (order_id);
CREATE INDEX idx_seats_table_session_id ON public.seats USING btree (table_session_id);
CREATE INDEX idx_sections_active ON public.sections USING btree (location_id, is_active);
CREATE INDEX idx_sections_location_id ON public.sections USING btree (location_id);
CREATE INDEX idx_staff_attendance_date ON public.staff_attendance_summary USING btree (work_date);
CREATE INDEX idx_staff_attendance_location ON public.staff_attendance_summary USING btree (location_id);
CREATE INDEX idx_staff_email ON public.staff USING btree (email) WHERE (email IS NOT NULL);
CREATE INDEX idx_staff_location ON public.staff USING btree (location_id);
CREATE INDEX idx_staff_member ON public.staff USING btree (member_id) WHERE (member_id IS NOT NULL);
CREATE INDEX idx_staff_pay_rates_effective ON public.staff_pay_rates USING btree (staff_id, effective_from DESC);
CREATE INDEX idx_staff_pay_rates_staff ON public.staff_pay_rates USING btree (staff_id);
CREATE INDEX idx_staff_pw_reset_tokens_staff ON public.staff_password_reset_tokens USING btree (staff_id);
CREATE INDEX idx_staff_refresh_tokens_expires ON public.staff_refresh_tokens USING btree (expires_at);
CREATE INDEX idx_staff_refresh_tokens_staff ON public.staff_refresh_tokens USING btree (staff_id);
CREATE INDEX idx_staff_shifts_date ON public.staff_shifts USING btree (shift_date);
CREATE INDEX idx_staff_shifts_location ON public.staff_shifts USING btree (location_id);
CREATE INDEX idx_staff_time_entries_location ON public.staff_time_entries USING btree (location_id);
CREATE INDEX idx_staff_time_entries_staff ON public.staff_time_entries USING btree (staff_id);
CREATE INDEX idx_staff_time_entries_ts ON public.staff_time_entries USING btree ("timestamp");
CREATE UNIQUE INDEX idx_staff_username_per_location ON public.staff USING btree (location_id, lower(username)) WHERE (username IS NOT NULL);
CREATE INDEX idx_stock_movements_created_at ON public.stock_movements USING btree (created_at DESC);
CREATE INDEX idx_stock_movements_inventory_item ON public.stock_movements USING btree (inventory_item_id);
CREATE INDEX idx_stock_movements_movement_type ON public.stock_movements USING btree (movement_type);
CREATE INDEX idx_stock_movements_waste_reason ON public.stock_movements USING btree (waste_reason) WHERE (waste_reason IS NOT NULL);
CREATE INDEX idx_store_credit_transactions_credit_created ON public.store_credit_transactions USING btree (store_credit_id, created_at DESC);
CREATE INDEX idx_store_credit_transactions_order ON public.store_credit_transactions USING btree (order_id);
CREATE INDEX idx_store_credit_transactions_refund ON public.store_credit_transactions USING btree (refund_id) WHERE (refund_id IS NOT NULL);
CREATE INDEX idx_store_credits_customer ON public.store_credits USING btree (customer_id);
CREATE INDEX idx_store_credits_organization ON public.store_credits USING btree (organization_id);
CREATE INDEX idx_supplier_contacts_supplier ON public.supplier_contacts USING btree (supplier_id);
CREATE INDEX idx_supplier_inventory_items_inventory_item ON public.supplier_inventory_items USING btree (inventory_item_id);
CREATE INDEX idx_supplier_inventory_items_supplier ON public.supplier_inventory_items USING btree (supplier_id);
CREATE INDEX idx_supplier_invoice_lines_invoice ON public.supplier_invoice_lines USING btree (supplier_invoice_id);
CREATE INDEX idx_supplier_invoice_lines_purchase_order_item ON public.supplier_invoice_lines USING btree (purchase_order_item_id);
CREATE INDEX idx_supplier_invoices_due_date ON public.supplier_invoices USING btree (due_date);
CREATE INDEX idx_supplier_invoices_location ON public.supplier_invoices USING btree (location_id);
CREATE INDEX idx_supplier_invoices_status ON public.supplier_invoices USING btree (status);
CREATE INDEX idx_supplier_invoices_supplier ON public.supplier_invoices USING btree (supplier_id);
CREATE INDEX idx_supplier_locations_location ON public.supplier_locations USING btree (location_id);
CREATE INDEX idx_supplier_locations_supplier ON public.supplier_locations USING btree (supplier_id);
CREATE INDEX idx_suppliers_organization ON public.suppliers USING btree (organization_id);
CREATE INDEX idx_table_sessions_location_id ON public.table_sessions USING btree (location_id);
CREATE INDEX idx_table_sessions_opened_at ON public.table_sessions USING btree (location_id, opened_at DESC);
CREATE INDEX idx_table_sessions_status ON public.table_sessions USING btree (status);
CREATE INDEX idx_table_sessions_table_id ON public.table_sessions USING btree (table_id);
CREATE INDEX idx_tables_location_id ON public.tables USING btree (location_id);
CREATE INDEX idx_tables_section_id ON public.tables USING btree (section_id) WHERE (section_id IS NOT NULL);
CREATE INDEX idx_tables_status ON public.tables USING btree (location_id, status);
CREATE INDEX idx_tax_rates_active ON public.tax_rates USING btree (location_id, is_active);
CREATE INDEX idx_tax_rates_location_id ON public.tax_rates USING btree (location_id);
CREATE INDEX idx_tip_contributions_payment ON public.tip_pool_contributions USING btree (order_payment_id) WHERE (order_payment_id IS NOT NULL);
CREATE UNIQUE INDEX idx_tip_contributions_payment_unique ON public.tip_pool_contributions USING btree (order_payment_id) WHERE (order_payment_id IS NOT NULL);
COMMENT ON INDEX public.idx_tip_contributions_payment_unique IS 'Prevents the same order_payment from contributing to any tip pool more than once. The application maps a 23505 violation on this index to a no-op (idempotent success) so re-delivery of the same webhook is safe.';
CREATE INDEX idx_tip_contributions_pool ON public.tip_pool_contributions USING btree (tip_pool_id, contributed_at DESC);
CREATE INDEX idx_tip_distributions_pool ON public.tip_distributions USING btree (tip_pool_id, distributed_at DESC);
CREATE INDEX idx_tip_distributions_staff ON public.tip_distributions USING btree (staff_id, distributed_at DESC);
CREATE INDEX idx_tip_distributions_unexported ON public.tip_distributions USING btree (staff_id) WHERE (payroll_exported_at IS NULL);
CREATE INDEX idx_tip_pools_location ON public.tip_pools USING btree (location_id) WHERE (is_active = true);
CREATE INDEX idx_tip_pools_org ON public.tip_pools USING btree (organization_id);
CREATE INDEX idx_tip_pools_shift_date ON public.tip_pools USING btree (location_id, shift_date) WHERE (shift_date IS NOT NULL);
CREATE INDEX idx_tip_pools_undistributed ON public.tip_pools USING btree (organization_id, location_id) WHERE ((distributed_at IS NULL) AND (is_active = true));
CREATE INDEX idx_user_backup_codes_profile_id ON public.user_backup_codes USING btree (profile_id);
CREATE INDEX idx_user_backup_codes_unused ON public.user_backup_codes USING btree (profile_id) WHERE (used_at IS NULL);
CREATE INDEX idx_waitlist_location_active ON public.waitlist USING btree (location_id, added_at) WHERE ((seated_at IS NULL) AND (removed_at IS NULL));
CREATE INDEX idx_webhook_deliveries_endpoint_created ON public.webhook_deliveries USING btree (endpoint_id, created_at DESC);
CREATE INDEX idx_webhook_deliveries_org_id ON public.webhook_deliveries USING btree (org_id);
CREATE INDEX idx_webhook_deliveries_status ON public.webhook_deliveries USING btree (status);
CREATE INDEX idx_webhook_endpoints_active ON public.webhook_endpoints USING btree (org_id, is_active);
CREATE INDEX idx_webhook_endpoints_org ON public.webhook_endpoints USING btree (org_id);
CREATE INDEX idx_whatsapp_account_links_profile ON public.whatsapp_account_links USING btree (profile_id);
CREATE INDEX idx_whatsapp_accounts_profile ON public.whatsapp_accounts USING btree (profile_id);
CREATE INDEX idx_whatsapp_link_tokens_expires ON public.whatsapp_link_tokens USING btree (expires_at);
CREATE INDEX idx_whatsapp_link_tokens_phone ON public.whatsapp_link_tokens USING btree (phone_e164);
CREATE INDEX idx_whatsapp_phone_numbers_active ON public.whatsapp_phone_numbers USING btree (meta_phone_number_id) WHERE (active = true);
CREATE INDEX idx_whatsapp_phone_numbers_country ON public.whatsapp_phone_numbers USING btree (country, configured_at) WHERE (active = true);
CREATE INDEX idx_whatsapp_routing_location ON public.whatsapp_routing USING btree (location_id);
CREATE UNIQUE INDEX items_location_sku_uq ON public.items USING btree (location_id, sku) WHERE (sku IS NOT NULL);
CREATE UNIQUE INDEX one_current_rate_per_staff_and_type ON public.staff_pay_rates USING btree (staff_id, rate_type) WHERE (effective_until IS NULL);
CREATE UNIQUE INDEX one_default_address_per_customer ON public.customer_addresses USING btree (customer_id) WHERE is_default;
CREATE UNIQUE INDEX one_open_driver_shift ON public.driver_shifts USING btree (driver_member_id) WHERE (status = ANY (ARRAY['online'::public.driver_shift_status, 'paused'::public.driver_shift_status]));
CREATE UNIQUE INDEX one_open_pos_shift_per_opener ON public.pos_shifts USING btree (location_id, opened_by) WHERE ((status = 'open'::text) AND (opened_by IS NOT NULL));
CREATE UNIQUE INDEX one_open_session_per_drawer ON public.cash_drawer_sessions USING btree (cash_drawer_id) WHERE (status = 'open'::text);
CREATE UNIQUE INDEX one_open_session_per_table ON public.table_sessions USING btree (table_id) WHERE (status = 'open'::text);
CREATE UNIQUE INDEX unique_order_number_per_business_date ON public.orders USING btree (location_id, order_number, business_date);
COMMENT ON INDEX public.unique_order_number_per_business_date IS 'Order numbers are unique per location per TRADING day. Replaces unique_order_number_per_day, which scoped by the UTC day and so reset the sequence mid-service for any location more than a couple of hours from UTC.';
ALTER INDEX public.idx_driver_location_pings_driver_time ATTACH PARTITION public.driver_location_pings_default_driver_member_id_recorded_at_idx;
ALTER INDEX public.driver_location_pings_pkey ATTACH PARTITION public.driver_location_pings_default_pkey;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON public.auth_users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER onboarding_progress_updated_at BEFORE UPDATE ON public.onboarding_progress FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_adjustment_reasons_updated_at BEFORE UPDATE ON public.adjustment_reasons FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_allergens_updated_at BEFORE UPDATE ON public.allergens FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_api_keys_updated_at BEFORE UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_auth_users_updated_at BEFORE UPDATE ON public.auth_users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_auto_86_from_inventory AFTER UPDATE OF current_stock, link_to_item_id ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.auto_86_from_inventory();
CREATE TRIGGER trg_cart_items_updated_at BEFORE UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_cash_drawer_sessions_updated_at BEFORE UPDATE ON public.cash_drawer_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_cash_drawers_updated_at BEFORE UPDATE ON public.cash_drawers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_check_splits_updated_at BEFORE UPDATE ON public.check_splits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_coupon_codes_updated_at BEFORE UPDATE ON public.coupon_codes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_course_fire_on_bump AFTER INSERT ON public.kds_ticket_events FOR EACH ROW EXECUTE FUNCTION public.trg_fn_course_fire_on_bump();
CREATE TRIGGER trg_courses_updated_at BEFORE UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_custom_domains_updated_at BEFORE UPDATE ON public.custom_domains FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_customer_addresses_updated_at BEFORE UPDATE ON public.customer_addresses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_customer_loyalty_stamps_updated_at BEFORE UPDATE ON public.customer_loyalty_stamps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_default_member_capabilities BEFORE INSERT OR UPDATE OF role ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.default_member_capabilities();
CREATE TRIGGER trg_delivery_zones_updated_at BEFORE UPDATE ON public.delivery_zones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_dietary_tags_updated_at BEFORE UPDATE ON public.dietary_tags FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_driver_assignments_updated_at BEFORE UPDATE ON public.driver_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_driver_emergency_contacts_updated_at BEFORE UPDATE ON public.driver_emergency_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_driver_shifts_updated_at BEFORE UPDATE ON public.driver_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_fiscal_sequences_updated_at BEFORE UPDATE ON public.fiscal_sequences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_gift_cards_updated_at BEFORE UPDATE ON public.gift_cards FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_house_account_invoices_updated_at BEFORE UPDATE ON public.house_account_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_house_account_members_updated_at BEFORE UPDATE ON public.house_account_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_house_accounts_updated_at BEFORE UPDATE ON public.house_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_inventory_items_updated_at BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_item_default_station_routing AFTER INSERT ON public.items FOR EACH ROW EXECUTE FUNCTION public.trg_fn_item_default_station_routing();
CREATE TRIGGER trg_item_prep_steps_updated_at BEFORE UPDATE ON public.item_prep_steps FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_item_price_schedules_updated_at BEFORE UPDATE ON public.item_price_schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_item_recipes_updated_at BEFORE UPDATE ON public.item_recipes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_items_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_kds_display_groups_updated_at BEFORE UPDATE ON public.kds_display_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_kds_ticket_items_updated_at BEFORE UPDATE ON public.kds_ticket_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_kds_tickets_updated_at BEFORE UPDATE ON public.kds_tickets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_kitchen_stations_updated_at BEFORE UPDATE ON public.kitchen_stations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_loc_email_cred_updated_at BEFORE UPDATE ON public.location_email_credentials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_location_default_kitchen_station AFTER INSERT ON public.locations FOR EACH ROW EXECUTE FUNCTION public.trg_fn_location_default_kitchen_station();
CREATE TRIGGER trg_location_printers_updated_at BEFORE UPDATE ON public.location_printers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_locations_updated_at BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_loyalty_config_updated_at BEFORE UPDATE ON public.loyalty_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_marketplace_reviews_updated_at BEFORE UPDATE ON public.marketplace_reviews FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_menu_schedules_updated_at BEFORE UPDATE ON public.menu_schedules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_modifier_groups_updated_at BEFORE UPDATE ON public.modifier_groups FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_modifiers_updated_at BEFORE UPDATE ON public.modifiers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_order_items_updated_at BEFORE UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_order_payments_updated_at BEFORE UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_organization_invites_updated_at BEFORE UPDATE ON public.organization_invites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_organization_members_updated_at BEFORE UPDATE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_pos_shifts_updated_at BEFORE UPDATE ON public.pos_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_prep_batches_updated_at BEFORE UPDATE ON public.prep_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_promotions_updated_at BEFORE UPDATE ON public.promotions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_purchase_order_items_updated_at BEFORE UPDATE ON public.purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON public.purchase_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_queue_kds_fanout AFTER INSERT OR UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.queue_kds_fanout();
CREATE TRIGGER trg_refunds_updated_at BEFORE UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_reservations_updated_at BEFORE UPDATE ON public.reservations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_seats_updated_at BEFORE UPDATE ON public.seats FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_sections_updated_at BEFORE UPDATE ON public.sections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_staff_attendance_summary_updated_at BEFORE UPDATE ON public.staff_attendance_summary FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_staff_pay_rates_updated_at BEFORE UPDATE ON public.staff_pay_rates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_staff_shifts_updated_at BEFORE UPDATE ON public.staff_shifts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_store_credits_updated_at BEFORE UPDATE ON public.store_credits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_supplier_contacts_updated_at BEFORE UPDATE ON public.supplier_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_supplier_inventory_items_updated_at BEFORE UPDATE ON public.supplier_inventory_items FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_supplier_invoices_updated_at BEFORE UPDATE ON public.supplier_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_supplier_locations_updated_at BEFORE UPDATE ON public.supplier_locations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_table_sessions_updated_at BEFORE UPDATE ON public.table_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_tables_updated_at BEFORE UPDATE ON public.tables FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_tax_profiles_updated_at BEFORE UPDATE ON public.tax_profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_tax_rates_updated_at BEFORE UPDATE ON public.tax_rates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_tip_pools_updated_at BEFORE UPDATE ON public.tip_pools FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_user_preferences_updated_at BEFORE UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_waitlist_updated_at BEFORE UPDATE ON public.waitlist FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_webhook_endpoints_updated_at BEFORE UPDATE ON public.webhook_endpoints FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trg_whatsapp_accounts_count AFTER INSERT OR DELETE ON public.whatsapp_accounts FOR EACH ROW EXECUTE FUNCTION public._sync_whatsapp_count();
CREATE TRIGGER trg_whatsapp_accounts_max_3 BEFORE INSERT ON public.whatsapp_accounts FOR EACH ROW EXECUTE FUNCTION public._check_whatsapp_account_limit();
CREATE TRIGGER trg_whatsapp_routing_updated_at BEFORE UPDATE ON public.whatsapp_routing FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();
CREATE TRIGGER trigger_item_recipes_metadata AFTER INSERT OR DELETE OR UPDATE ON public.item_recipes FOR EACH ROW EXECUTE FUNCTION public.trigger_update_recipe_metadata();
ALTER TABLE ONLY public.adjustment_reasons
    ADD CONSTRAINT adjustment_reasons_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.allergens
    ADD CONSTRAINT allergens_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.cart_item_variations
    ADD CONSTRAINT cart_item_variations_cart_item_id_fkey FOREIGN KEY (cart_item_id) REFERENCES public.cart_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cash_drawer_counts
    ADD CONSTRAINT cash_drawer_counts_cash_drawer_session_id_fkey FOREIGN KEY (cash_drawer_session_id) REFERENCES public.cash_drawer_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cash_drawer_counts
    ADD CONSTRAINT cash_drawer_counts_counted_by_fkey FOREIGN KEY (counted_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.cash_drawer_movements
    ADD CONSTRAINT cash_drawer_movements_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.cash_drawer_movements
    ADD CONSTRAINT cash_drawer_movements_cash_drawer_session_id_fkey FOREIGN KEY (cash_drawer_session_id) REFERENCES public.cash_drawer_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cash_drawer_movements
    ADD CONSTRAINT cash_drawer_movements_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.cash_drawer_session_payments
    ADD CONSTRAINT cash_drawer_session_payments_cash_drawer_session_id_fkey FOREIGN KEY (cash_drawer_session_id) REFERENCES public.cash_drawer_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cash_drawer_session_payments
    ADD CONSTRAINT cash_drawer_session_payments_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.order_payments(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cash_drawer_sessions
    ADD CONSTRAINT cash_drawer_sessions_cash_drawer_id_fkey FOREIGN KEY (cash_drawer_id) REFERENCES public.cash_drawers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cash_drawer_sessions
    ADD CONSTRAINT cash_drawer_sessions_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.cash_drawer_sessions
    ADD CONSTRAINT cash_drawer_sessions_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.cash_drawers
    ADD CONSTRAINT cash_drawers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.category_station_routing
    ADD CONSTRAINT category_station_routing_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.category_station_routing
    ADD CONSTRAINT category_station_routing_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.kitchen_stations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.check_split_items
    ADD CONSTRAINT check_split_items_check_split_id_fkey FOREIGN KEY (check_split_id) REFERENCES public.check_splits(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.check_splits
    ADD CONSTRAINT check_splits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.check_splits
    ADD CONSTRAINT check_splits_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES public.table_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.coupon_codes
    ADD CONSTRAINT coupon_codes_assigned_to_customer_id_fkey FOREIGN KEY (assigned_to_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.coupon_codes
    ADD CONSTRAINT coupon_codes_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.custom_domains
    ADD CONSTRAINT custom_domains_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customer_addresses
    ADD CONSTRAINT customer_addresses_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customer_favorite_items
    ADD CONSTRAINT customer_favorite_items_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customer_favorite_items
    ADD CONSTRAINT customer_favorite_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customer_favorite_items
    ADD CONSTRAINT customer_favorite_items_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customer_loyalty_stamps
    ADD CONSTRAINT customer_loyalty_stamps_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customer_loyalty_stamps
    ADD CONSTRAINT customer_loyalty_stamps_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customer_loyalty_stamps
    ADD CONSTRAINT customer_loyalty_stamps_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.data_export_jobs
    ADD CONSTRAINT data_export_jobs_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.data_export_jobs
    ADD CONSTRAINT data_export_jobs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.delivery_zones
    ADD CONSTRAINT delivery_zones_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.delivery_zones
    ADD CONSTRAINT delivery_zones_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.dietary_tags
    ADD CONSTRAINT dietary_tags_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.driver_assignments
    ADD CONSTRAINT driver_assignments_driver_member_id_fkey FOREIGN KEY (driver_member_id) REFERENCES public.organization_members(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.driver_assignments
    ADD CONSTRAINT driver_assignments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.driver_emergency_contacts
    ADD CONSTRAINT driver_emergency_contacts_driver_member_id_fkey FOREIGN KEY (driver_member_id) REFERENCES public.organization_members(id) ON DELETE CASCADE;
ALTER TABLE public.driver_location_pings
    ADD CONSTRAINT driver_location_pings_driver_member_id_fkey FOREIGN KEY (driver_member_id) REFERENCES public.organization_members(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.driver_shifts
    ADD CONSTRAINT driver_shifts_driver_member_id_fkey FOREIGN KEY (driver_member_id) REFERENCES public.organization_members(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.email_verification_tokens
    ADD CONSTRAINT email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_from_currency_fkey FOREIGN KEY (from_currency) REFERENCES public.currencies(code);
ALTER TABLE ONLY public.exchange_rates
    ADD CONSTRAINT exchange_rates_to_currency_fkey FOREIGN KEY (to_currency) REFERENCES public.currencies(code);
ALTER TABLE ONLY public.fiscal_sequences
    ADD CONSTRAINT fiscal_sequences_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT fk_cart_items_customer FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT fk_categories_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.check_split_items
    ADD CONSTRAINT fk_check_split_items_order_item FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.courses
    ADD CONSTRAINT fk_courses_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT fk_inventory_items_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.items
    ADD CONSTRAINT fk_items_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.menu_schedules
    ADD CONSTRAINT fk_menu_schedules_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT fk_order_payments_order FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.prep_batches
    ADD CONSTRAINT fk_prep_batches_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT fk_purchase_orders_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT fk_refunds_order FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sections
    ADD CONSTRAINT fk_sections_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_attendance_summary
    ADD CONSTRAINT fk_staff_attendance_summary_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT fk_staff_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_shifts
    ADD CONSTRAINT fk_staff_shifts_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_time_entries
    ADD CONSTRAINT fk_staff_time_entries_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.supplier_invoices
    ADD CONSTRAINT fk_supplier_invoices_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.supplier_locations
    ADD CONSTRAINT fk_supplier_locations_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.table_sessions
    ADD CONSTRAINT fk_table_sessions_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tables
    ADD CONSTRAINT fk_tables_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.gift_card_transactions
    ADD CONSTRAINT gift_card_transactions_gift_card_id_fkey FOREIGN KEY (gift_card_id) REFERENCES public.gift_cards(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.gift_card_transactions
    ADD CONSTRAINT gift_card_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.gift_card_transactions
    ADD CONSTRAINT gift_card_transactions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.order_payments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.gift_card_transactions
    ADD CONSTRAINT gift_card_transactions_performed_by_staff_id_fkey FOREIGN KEY (performed_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_issued_by_staff_id_fkey FOREIGN KEY (issued_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_issued_to_customer_id_fkey FOREIGN KEY (issued_to_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.gift_cards
    ADD CONSTRAINT gift_cards_purchased_in_order_id_fkey FOREIGN KEY (purchased_in_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.goods_receipt_items
    ADD CONSTRAINT goods_receipt_items_goods_receipt_id_fkey FOREIGN KEY (goods_receipt_id) REFERENCES public.goods_receipts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.goods_receipt_items
    ADD CONSTRAINT goods_receipt_items_purchase_order_item_id_fkey FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.goods_receipt_items
    ADD CONSTRAINT goods_receipt_items_stock_movement_id_fkey FOREIGN KEY (stock_movement_id) REFERENCES public.stock_movements(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.goods_receipts
    ADD CONSTRAINT goods_receipts_received_by_fkey FOREIGN KEY (received_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.house_account_charges
    ADD CONSTRAINT house_account_charges_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.house_account_charges
    ADD CONSTRAINT house_account_charges_house_account_id_fkey FOREIGN KEY (house_account_id) REFERENCES public.house_accounts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.house_account_charges
    ADD CONSTRAINT house_account_charges_house_account_invoice_id_fkey FOREIGN KEY (house_account_invoice_id) REFERENCES public.house_account_invoices(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.house_account_charges
    ADD CONSTRAINT house_account_charges_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.house_account_invoices
    ADD CONSTRAINT house_account_invoices_house_account_id_fkey FOREIGN KEY (house_account_id) REFERENCES public.house_accounts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.house_account_members
    ADD CONSTRAINT house_account_members_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.house_account_members
    ADD CONSTRAINT house_account_members_house_account_id_fkey FOREIGN KEY (house_account_id) REFERENCES public.house_accounts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.house_accounts
    ADD CONSTRAINT house_accounts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.ingredient_price_history
    ADD CONSTRAINT ingredient_price_history_goods_receipt_item_id_fkey FOREIGN KEY (goods_receipt_item_id) REFERENCES public.goods_receipt_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.ingredient_price_history
    ADD CONSTRAINT ingredient_price_history_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.ingredient_price_history
    ADD CONSTRAINT ingredient_price_history_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.ingredient_price_history
    ADD CONSTRAINT ingredient_price_history_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_link_to_item_id_fkey FOREIGN KEY (link_to_item_id) REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_issuer_org_id_fkey FOREIGN KEY (issuer_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_recipient_customer_id_fkey FOREIGN KEY (recipient_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_recipient_org_id_fkey FOREIGN KEY (recipient_org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.item_allergens
    ADD CONSTRAINT item_allergens_allergen_id_fkey FOREIGN KEY (allergen_id) REFERENCES public.allergens(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_allergens
    ADD CONSTRAINT item_allergens_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_dietary_tags
    ADD CONSTRAINT item_dietary_tags_dietary_tag_id_fkey FOREIGN KEY (dietary_tag_id) REFERENCES public.dietary_tags(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_dietary_tags
    ADD CONSTRAINT item_dietary_tags_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_menu_schedules
    ADD CONSTRAINT item_menu_schedules_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_menu_schedules
    ADD CONSTRAINT item_menu_schedules_menu_schedule_id_fkey FOREIGN KEY (menu_schedule_id) REFERENCES public.menu_schedules(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_prep_steps
    ADD CONSTRAINT item_prep_steps_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_price_schedules
    ADD CONSTRAINT item_price_schedules_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_price_schedules
    ADD CONSTRAINT item_price_schedules_menu_schedule_id_fkey FOREIGN KEY (menu_schedule_id) REFERENCES public.menu_schedules(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_recipes
    ADD CONSTRAINT item_recipes_child_item_id_fkey FOREIGN KEY (child_item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_recipes
    ADD CONSTRAINT item_recipes_parent_item_id_fkey FOREIGN KEY (parent_item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_station_routing
    ADD CONSTRAINT item_station_routing_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.item_station_routing
    ADD CONSTRAINT item_station_routing_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.kitchen_stations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kds_display_groups
    ADD CONSTRAINT kds_display_groups_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kds_fanout_queue
    ADD CONSTRAINT kds_fanout_queue_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kds_ticket_events
    ADD CONSTRAINT kds_ticket_events_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.kds_ticket_events
    ADD CONSTRAINT kds_ticket_events_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.kds_tickets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kds_ticket_events
    ADD CONSTRAINT kds_ticket_events_ticket_item_id_fkey FOREIGN KEY (ticket_item_id) REFERENCES public.kds_ticket_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kds_ticket_items
    ADD CONSTRAINT kds_ticket_items_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kds_ticket_items
    ADD CONSTRAINT kds_ticket_items_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.kds_tickets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kds_tickets
    ADD CONSTRAINT kds_tickets_bumped_by_fkey FOREIGN KEY (bumped_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.kds_tickets
    ADD CONSTRAINT kds_tickets_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kds_tickets
    ADD CONSTRAINT kds_tickets_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.kitchen_stations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.kitchen_stations
    ADD CONSTRAINT kitchen_stations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.legal_documents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.llm_messages
    ADD CONSTRAINT llm_messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.llm_tool_executions
    ADD CONSTRAINT llm_tool_executions_llm_message_id_fkey FOREIGN KEY (llm_message_id) REFERENCES public.llm_messages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.location_email_credentials
    ADD CONSTRAINT location_email_credentials_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.location_email_credentials
    ADD CONSTRAINT location_email_credentials_provider_code_fkey FOREIGN KEY (provider_code) REFERENCES public.email_providers(code);
ALTER TABLE ONLY public.location_printers
    ADD CONSTRAINT location_printers_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.location_printers
    ADD CONSTRAINT location_printers_station_id_fkey FOREIGN KEY (station_id) REFERENCES public.kitchen_stations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_currency_code_fkey FOREIGN KEY (currency_code) REFERENCES public.currencies(code);
ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.loyalty_config
    ADD CONSTRAINT loyalty_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.loyalty_config
    ADD CONSTRAINT loyalty_config_stamp_item_id_fkey FOREIGN KEY (stamp_item_id) REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.loyalty_transactions
    ADD CONSTRAINT loyalty_transactions_performed_by_staff_id_fkey FOREIGN KEY (performed_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_reviews
    ADD CONSTRAINT marketplace_reviews_customer_profile_id_fkey FOREIGN KEY (customer_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_reviews
    ADD CONSTRAINT marketplace_reviews_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_reviews
    ADD CONSTRAINT marketplace_reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.marketplace_reviews
    ADD CONSTRAINT marketplace_reviews_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.menu_schedule_slots
    ADD CONSTRAINT menu_schedule_slots_menu_schedule_id_fkey FOREIGN KEY (menu_schedule_id) REFERENCES public.menu_schedules(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.modifier_groups
    ADD CONSTRAINT modifier_groups_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.modifiers
    ADD CONSTRAINT modifiers_modifier_group_id_fkey FOREIGN KEY (modifier_group_id) REFERENCES public.modifier_groups(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_applied_by_fkey FOREIGN KEY (applied_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_adjustments
    ADD CONSTRAINT order_adjustments_reason_id_fkey FOREIGN KEY (reason_id) REFERENCES public.adjustment_reasons(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_item_discounts
    ADD CONSTRAINT order_item_discounts_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_item_discounts
    ADD CONSTRAINT order_item_discounts_promotion_redemption_id_fkey FOREIGN KEY (promotion_redemption_id) REFERENCES public.promotion_redemptions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_item_modifiers
    ADD CONSTRAINT order_item_modifiers_modifier_id_fkey FOREIGN KEY (modifier_id) REFERENCES public.modifiers(id);
ALTER TABLE ONLY public.order_item_modifiers
    ADD CONSTRAINT order_item_modifiers_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_seat_id_fkey FOREIGN KEY (seat_id) REFERENCES public.seats(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_payment_method_code_fkey FOREIGN KEY (payment_method_code) REFERENCES public.payment_methods(code);
ALTER TABLE ONLY public.order_payments
    ADD CONSTRAINT order_payments_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_tracking_tokens
    ADD CONSTRAINT order_tracking_tokens_customer_profile_id_fkey FOREIGN KEY (customer_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.order_tracking_tokens
    ADD CONSTRAINT order_tracking_tokens_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_currency_code_fkey FOREIGN KEY (currency_code) REFERENCES public.currencies(code);
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_delivery_address_id_fkey FOREIGN KEY (delivery_address_id) REFERENCES public.customer_addresses(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES public.table_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_taken_by_fkey FOREIGN KEY (taken_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.organization_invites
    ADD CONSTRAINT organization_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.organization_invites
    ADD CONSTRAINT organization_invites_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_default_currency_code_fkey FOREIGN KEY (default_currency_code) REFERENCES public.currencies(code);
ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payroll_periods
    ADD CONSTRAINT payroll_periods_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.payroll_periods
    ADD CONSTRAINT payroll_periods_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pii_access_log
    ADD CONSTRAINT pii_access_log_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.platform_admin_actions
    ADD CONSTRAINT platform_admin_actions_admin_user_id_fkey FOREIGN KEY (admin_user_id) REFERENCES public.auth_users(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_cash_drawer_id_fkey FOREIGN KEY (cash_drawer_id) REFERENCES public.cash_drawers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_cash_drawer_session_id_fkey FOREIGN KEY (cash_drawer_session_id) REFERENCES public.cash_drawer_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pos_shifts
    ADD CONSTRAINT pos_shifts_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.prep_batch_inputs
    ADD CONSTRAINT prep_batch_inputs_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.prep_batch_inputs
    ADD CONSTRAINT prep_batch_inputs_prep_batch_id_fkey FOREIGN KEY (prep_batch_id) REFERENCES public.prep_batches(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.prep_batches
    ADD CONSTRAINT prep_batches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.prep_batches
    ADD CONSTRAINT prep_batches_prepared_by_staff_id_fkey FOREIGN KEY (prepared_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.prep_batches
    ADD CONSTRAINT prep_batches_produced_inventory_item_id_fkey FOREIGN KEY (produced_inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES public.auth_users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.promotion_redemptions
    ADD CONSTRAINT promotion_redemptions_coupon_code_id_fkey FOREIGN KEY (coupon_code_id) REFERENCES public.coupon_codes(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.promotion_redemptions
    ADD CONSTRAINT promotion_redemptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.promotion_redemptions
    ADD CONSTRAINT promotion_redemptions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.promotion_redemptions
    ADD CONSTRAINT promotion_redemptions_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.promotion_target_categories
    ADD CONSTRAINT promotion_target_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.promotion_target_categories
    ADD CONSTRAINT promotion_target_categories_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.promotion_target_items
    ADD CONSTRAINT promotion_target_items_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.promotion_target_items
    ADD CONSTRAINT promotion_target_items_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_free_item_id_fkey FOREIGN KEY (free_item_id) REFERENCES public.items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_supplier_inventory_item_id_fkey FOREIGN KEY (supplier_inventory_item_id) REFERENCES public.supplier_inventory_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_ordered_by_fkey FOREIGN KEY (ordered_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.receipt_documents
    ADD CONSTRAINT receipt_documents_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.receipt_documents
    ADD CONSTRAINT receipt_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES public.refresh_tokens(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.auth_users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.order_payments(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reservations
    ADD CONSTRAINT reservations_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.seats
    ADD CONSTRAINT seats_table_session_id_fkey FOREIGN KEY (table_session_id) REFERENCES public.table_sessions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_attendance_summary
    ADD CONSTRAINT staff_attendance_summary_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff
    ADD CONSTRAINT staff_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.organization_members(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.staff_password_reset_tokens
    ADD CONSTRAINT staff_password_reset_tokens_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.staff_password_reset_tokens
    ADD CONSTRAINT staff_password_reset_tokens_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_pay_rates
    ADD CONSTRAINT staff_pay_rates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.staff_pay_rates
    ADD CONSTRAINT staff_pay_rates_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_refresh_tokens
    ADD CONSTRAINT staff_refresh_tokens_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES public.staff_refresh_tokens(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.staff_refresh_tokens
    ADD CONSTRAINT staff_refresh_tokens_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_shifts
    ADD CONSTRAINT staff_shifts_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.staff_time_entries
    ADD CONSTRAINT staff_time_entries_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.store_credit_transactions
    ADD CONSTRAINT store_credit_transactions_granted_by_profile_id_fkey FOREIGN KEY (granted_by_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.store_credit_transactions
    ADD CONSTRAINT store_credit_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.store_credit_transactions
    ADD CONSTRAINT store_credit_transactions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.order_payments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.store_credit_transactions
    ADD CONSTRAINT store_credit_transactions_performed_by_staff_id_fkey FOREIGN KEY (performed_by_staff_id) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.store_credit_transactions
    ADD CONSTRAINT store_credit_transactions_refund_id_fkey FOREIGN KEY (refund_id) REFERENCES public.refunds(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.store_credit_transactions
    ADD CONSTRAINT store_credit_transactions_store_credit_id_fkey FOREIGN KEY (store_credit_id) REFERENCES public.store_credits(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.store_credits
    ADD CONSTRAINT store_credits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.store_credits
    ADD CONSTRAINT store_credits_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.supplier_contacts
    ADD CONSTRAINT supplier_contacts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.supplier_inventory_items
    ADD CONSTRAINT supplier_inventory_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.supplier_inventory_items
    ADD CONSTRAINT supplier_inventory_items_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.supplier_invoice_lines
    ADD CONSTRAINT supplier_invoice_lines_goods_receipt_item_id_fkey FOREIGN KEY (goods_receipt_item_id) REFERENCES public.goods_receipt_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.supplier_invoice_lines
    ADD CONSTRAINT supplier_invoice_lines_purchase_order_item_id_fkey FOREIGN KEY (purchase_order_item_id) REFERENCES public.purchase_order_items(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.supplier_invoice_lines
    ADD CONSTRAINT supplier_invoice_lines_supplier_invoice_id_fkey FOREIGN KEY (supplier_invoice_id) REFERENCES public.supplier_invoices(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.supplier_invoices
    ADD CONSTRAINT supplier_invoices_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.supplier_locations
    ADD CONSTRAINT supplier_locations_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.table_sessions
    ADD CONSTRAINT table_sessions_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.staff(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.table_sessions
    ADD CONSTRAINT table_sessions_table_id_fkey FOREIGN KEY (table_id) REFERENCES public.tables(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.table_sessions
    ADD CONSTRAINT table_sessions_transferred_to_session_id_fkey FOREIGN KEY (transferred_to_session_id) REFERENCES public.table_sessions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tables
    ADD CONSTRAINT tables_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tax_profiles
    ADD CONSTRAINT tax_profiles_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tax_rates
    ADD CONSTRAINT tax_rates_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tip_distributions
    ADD CONSTRAINT tip_distributions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id) ON DELETE RESTRICT;
ALTER TABLE ONLY public.tip_distributions
    ADD CONSTRAINT tip_distributions_tip_pool_id_fkey FOREIGN KEY (tip_pool_id) REFERENCES public.tip_pools(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tip_pool_contributions
    ADD CONSTRAINT tip_pool_contributions_order_payment_id_fkey FOREIGN KEY (order_payment_id) REFERENCES public.order_payments(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tip_pool_contributions
    ADD CONSTRAINT tip_pool_contributions_tip_pool_id_fkey FOREIGN KEY (tip_pool_id) REFERENCES public.tip_pools(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.tip_pools
    ADD CONSTRAINT tip_pools_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.tip_pools
    ADD CONSTRAINT tip_pools_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_backup_codes
    ADD CONSTRAINT user_backup_codes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_preferences
    ADD CONSTRAINT user_preferences_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.waitlist
    ADD CONSTRAINT waitlist_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.webhook_endpoints
    ADD CONSTRAINT webhook_endpoints_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.whatsapp_account_links
    ADD CONSTRAINT whatsapp_account_links_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.whatsapp_accounts
    ADD CONSTRAINT whatsapp_accounts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.whatsapp_link_tokens
    ADD CONSTRAINT whatsapp_link_tokens_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.whatsapp_routing
    ADD CONSTRAINT whatsapp_routing_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE CASCADE;
ALTER TABLE public.adjustment_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY adjustment_reasons_delete ON public.adjustment_reasons FOR DELETE USING (public.is_service_role());
CREATE POLICY adjustment_reasons_insert ON public.adjustment_reasons FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY adjustment_reasons_select ON public.adjustment_reasons FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY adjustment_reasons_update ON public.adjustment_reasons FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.allergens ENABLE ROW LEVEL SECURITY;
CREATE POLICY allergens_delete ON public.allergens FOR DELETE USING (public.is_service_role());
CREATE POLICY allergens_insert ON public.allergens FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY allergens_select ON public.allergens FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY allergens_select_marketplace ON public.allergens FOR SELECT USING (public.is_marketplace_role());
CREATE POLICY allergens_update ON public.allergens FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_delete ON public.api_keys FOR DELETE USING (public.is_service_role());
CREATE POLICY api_keys_insert ON public.api_keys FOR INSERT WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY api_keys_select ON public.api_keys FOR SELECT USING (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY api_keys_update ON public.api_keys FOR UPDATE USING (((org_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log_archived ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_archived_delete ON public.audit_log_archived FOR DELETE USING (false);
CREATE POLICY audit_log_archived_insert ON public.audit_log_archived FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY audit_log_archived_select ON public.audit_log_archived FOR SELECT USING (public.is_service_role());
CREATE POLICY audit_log_archived_update ON public.audit_log_archived FOR UPDATE USING (false);
CREATE POLICY audit_log_delete ON public.audit_log FOR DELETE USING (false);
CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY audit_log_update ON public.audit_log FOR UPDATE USING (false);
ALTER TABLE public.auth_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_users_delete ON public.auth_users FOR DELETE USING (public.is_service_role());
CREATE POLICY auth_users_insert ON public.auth_users FOR INSERT WITH CHECK (((id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY auth_users_select ON public.auth_users FOR SELECT USING (((id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY auth_users_update ON public.auth_users FOR UPDATE USING (((id = public.current_user_id()) OR public.is_service_role())) WITH CHECK (((id = public.current_user_id()) OR public.is_service_role()));
ALTER TABLE public.cart_item_variations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cart_item_variations_delete ON public.cart_item_variations FOR DELETE USING (public.is_service_role());
CREATE POLICY cart_item_variations_insert ON public.cart_item_variations FOR INSERT WITH CHECK (((cart_item_id IN ( SELECT ci.id
   FROM (public.cart_items ci
     JOIN public.locations l ON ((l.id = ci.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cart_item_variations_select ON public.cart_item_variations FOR SELECT USING (((cart_item_id IN ( SELECT ci.id
   FROM (public.cart_items ci
     JOIN public.locations l ON ((l.id = ci.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cart_item_variations_update ON public.cart_item_variations FOR UPDATE USING (((cart_item_id IN ( SELECT ci.id
   FROM (public.cart_items ci
     JOIN public.locations l ON ((l.id = ci.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((cart_item_id IN ( SELECT ci.id
   FROM (public.cart_items ci
     JOIN public.locations l ON ((l.id = ci.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY cart_items_delete ON public.cart_items FOR DELETE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cart_items_insert ON public.cart_items FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cart_items_select ON public.cart_items FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cart_items_update ON public.cart_items FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.cash_drawer_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_drawer_counts_delete ON public.cash_drawer_counts FOR DELETE USING (public.is_service_role());
CREATE POLICY cash_drawer_counts_insert ON public.cash_drawer_counts FOR INSERT WITH CHECK (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawer_counts_select ON public.cash_drawer_counts FOR SELECT USING (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawer_counts_update ON public.cash_drawer_counts FOR UPDATE USING (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.cash_drawer_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_drawer_movements_delete ON public.cash_drawer_movements FOR DELETE USING (public.is_service_role());
CREATE POLICY cash_drawer_movements_insert ON public.cash_drawer_movements FOR INSERT WITH CHECK (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawer_movements_select ON public.cash_drawer_movements FOR SELECT USING (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawer_movements_update ON public.cash_drawer_movements FOR UPDATE USING (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.cash_drawer_session_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_drawer_session_payments_delete ON public.cash_drawer_session_payments FOR DELETE USING (public.is_service_role());
CREATE POLICY cash_drawer_session_payments_insert ON public.cash_drawer_session_payments FOR INSERT WITH CHECK (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawer_session_payments_select ON public.cash_drawer_session_payments FOR SELECT USING (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawer_session_payments_update ON public.cash_drawer_session_payments FOR UPDATE USING (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((cash_drawer_session_id IN ( SELECT cds.id
   FROM ((public.cash_drawer_sessions cds
     JOIN public.cash_drawers cd ON ((cd.id = cds.cash_drawer_id)))
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.cash_drawer_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_drawer_sessions_delete ON public.cash_drawer_sessions FOR DELETE USING (public.is_service_role());
CREATE POLICY cash_drawer_sessions_insert ON public.cash_drawer_sessions FOR INSERT WITH CHECK (((cash_drawer_id IN ( SELECT cd.id
   FROM (public.cash_drawers cd
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawer_sessions_select ON public.cash_drawer_sessions FOR SELECT USING (((cash_drawer_id IN ( SELECT cd.id
   FROM (public.cash_drawers cd
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawer_sessions_update ON public.cash_drawer_sessions FOR UPDATE USING (((cash_drawer_id IN ( SELECT cd.id
   FROM (public.cash_drawers cd
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((cash_drawer_id IN ( SELECT cd.id
   FROM (public.cash_drawers cd
     JOIN public.locations l ON ((l.id = cd.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.cash_drawers ENABLE ROW LEVEL SECURITY;
CREATE POLICY cash_drawers_delete ON public.cash_drawers FOR DELETE USING (public.is_service_role());
CREATE POLICY cash_drawers_insert ON public.cash_drawers FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawers_select ON public.cash_drawers FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY cash_drawers_update ON public.cash_drawers FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY categories_delete ON public.categories FOR DELETE USING (public.is_service_role());
CREATE POLICY categories_insert ON public.categories FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY categories_select ON public.categories FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY categories_select_marketplace ON public.categories FOR SELECT USING ((public.is_marketplace_role() AND (location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.is_marketplace_visible = true))) AND (is_active = true)));
CREATE POLICY categories_update ON public.categories FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.category_station_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_split_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY check_split_items_delete ON public.check_split_items FOR DELETE USING (public.is_service_role());
CREATE POLICY check_split_items_insert ON public.check_split_items FOR INSERT WITH CHECK (((check_split_id IN ( SELECT cs.id
   FROM ((public.check_splits cs
     JOIN public.table_sessions ts ON ((ts.id = cs.table_session_id)))
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY check_split_items_select ON public.check_split_items FOR SELECT USING (((check_split_id IN ( SELECT cs.id
   FROM ((public.check_splits cs
     JOIN public.table_sessions ts ON ((ts.id = cs.table_session_id)))
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY check_split_items_update ON public.check_split_items FOR UPDATE USING (((check_split_id IN ( SELECT cs.id
   FROM ((public.check_splits cs
     JOIN public.table_sessions ts ON ((ts.id = cs.table_session_id)))
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((check_split_id IN ( SELECT cs.id
   FROM ((public.check_splits cs
     JOIN public.table_sessions ts ON ((ts.id = cs.table_session_id)))
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.check_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY check_splits_delete ON public.check_splits FOR DELETE USING (public.is_service_role());
CREATE POLICY check_splits_insert ON public.check_splits FOR INSERT WITH CHECK (((table_session_id IN ( SELECT ts.id
   FROM (public.table_sessions ts
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY check_splits_select ON public.check_splits FOR SELECT USING (((table_session_id IN ( SELECT ts.id
   FROM (public.table_sessions ts
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY check_splits_update ON public.check_splits FOR UPDATE USING (((table_session_id IN ( SELECT ts.id
   FROM (public.table_sessions ts
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((table_session_id IN ( SELECT ts.id
   FROM (public.table_sessions ts
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.coupon_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY coupon_codes_delete ON public.coupon_codes FOR DELETE USING (public.is_service_role());
CREATE POLICY coupon_codes_insert ON public.coupon_codes FOR INSERT WITH CHECK (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY coupon_codes_select ON public.coupon_codes FOR SELECT USING (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY coupon_codes_update ON public.coupon_codes FOR UPDATE USING (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY courses_delete ON public.courses FOR DELETE USING (public.is_service_role());
CREATE POLICY courses_insert ON public.courses FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY courses_select ON public.courses FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY courses_update ON public.courses FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY csr_delete ON public.category_station_routing FOR DELETE USING (public.is_service_role());
CREATE POLICY csr_insert ON public.category_station_routing FOR INSERT WITH CHECK (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY csr_select ON public.category_station_routing FOR SELECT USING (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY csr_update ON public.category_station_routing FOR UPDATE USING (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.custom_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY custom_domains_delete ON public.custom_domains FOR DELETE USING (public.is_service_role());
CREATE POLICY custom_domains_delete_service_role ON public.custom_domains FOR DELETE USING (public.is_service_role());
CREATE POLICY custom_domains_insert ON public.custom_domains FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY custom_domains_insert_tenant ON public.custom_domains FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY custom_domains_select ON public.custom_domains FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY custom_domains_select_tenant ON public.custom_domains FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY custom_domains_update ON public.custom_domains FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY custom_domains_update_tenant ON public.custom_domains FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_addresses_delete ON public.customer_addresses FOR DELETE USING (public.is_service_role());
CREATE POLICY customer_addresses_insert ON public.customer_addresses FOR INSERT WITH CHECK (((customer_id IN ( SELECT customers.id
   FROM public.customers
  WHERE (customers.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY customer_addresses_select ON public.customer_addresses FOR SELECT USING (((customer_id IN ( SELECT customers.id
   FROM public.customers
  WHERE (customers.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY customer_addresses_update ON public.customer_addresses FOR UPDATE USING (((customer_id IN ( SELECT customers.id
   FROM public.customers
  WHERE (customers.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((customer_id IN ( SELECT customers.id
   FROM public.customers
  WHERE (customers.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.customer_favorite_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_favorite_items_delete ON public.customer_favorite_items FOR DELETE USING (public.is_service_role());
CREATE POLICY customer_favorite_items_insert ON public.customer_favorite_items FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY customer_favorite_items_select ON public.customer_favorite_items FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY customer_favorite_items_update ON public.customer_favorite_items FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.customer_loyalty_stamps ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_loyalty_stamps_delete ON public.customer_loyalty_stamps FOR DELETE USING (public.is_service_role());
CREATE POLICY customer_loyalty_stamps_insert ON public.customer_loyalty_stamps FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY customer_loyalty_stamps_select ON public.customer_loyalty_stamps FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY customer_loyalty_stamps_update ON public.customer_loyalty_stamps FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_delete ON public.customers FOR DELETE USING (public.is_service_role());
CREATE POLICY customers_insert ON public.customers FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY customers_select ON public.customers FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY customers_update ON public.customers FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.data_export_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY data_export_jobs_delete_service ON public.data_export_jobs FOR DELETE USING (public.is_service_role());
CREATE POLICY data_export_jobs_insert_tenant ON public.data_export_jobs FOR INSERT WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY data_export_jobs_select_tenant ON public.data_export_jobs FOR SELECT USING (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY data_export_jobs_update_service ON public.data_export_jobs FOR UPDATE USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_zones_delete ON public.delivery_zones FOR DELETE USING (public.is_service_role());
CREATE POLICY delivery_zones_insert ON public.delivery_zones FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY delivery_zones_select ON public.delivery_zones FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY delivery_zones_update ON public.delivery_zones FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.dietary_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY dietary_tags_delete ON public.dietary_tags FOR DELETE USING (public.is_service_role());
CREATE POLICY dietary_tags_insert ON public.dietary_tags FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY dietary_tags_select ON public.dietary_tags FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY dietary_tags_select_marketplace ON public.dietary_tags FOR SELECT USING ((public.is_marketplace_role() AND (is_customer_facing = true)));
CREATE POLICY dietary_tags_update ON public.dietary_tags FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.driver_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_assignments_delete ON public.driver_assignments FOR DELETE USING (public.is_service_role());
CREATE POLICY driver_assignments_insert ON public.driver_assignments FOR INSERT WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY driver_assignments_select ON public.driver_assignments FOR SELECT USING (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR (order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY driver_assignments_update ON public.driver_assignments FOR UPDATE USING (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR (order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR (order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.driver_emergency_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_emergency_contacts_delete ON public.driver_emergency_contacts FOR DELETE USING (public.is_service_role());
CREATE POLICY driver_emergency_contacts_insert ON public.driver_emergency_contacts FOR INSERT WITH CHECK (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR public.is_service_role()));
CREATE POLICY driver_emergency_contacts_select ON public.driver_emergency_contacts FOR SELECT USING (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR public.is_service_role()));
CREATE POLICY driver_emergency_contacts_update ON public.driver_emergency_contacts FOR UPDATE USING (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR public.is_service_role())) WITH CHECK (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR public.is_service_role()));
ALTER TABLE public.driver_location_pings ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_location_pings_delete ON public.driver_location_pings FOR DELETE USING (public.is_service_role());
CREATE POLICY driver_location_pings_insert ON public.driver_location_pings FOR INSERT WITH CHECK (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR public.is_service_role()));
CREATE POLICY driver_location_pings_select ON public.driver_location_pings FOR SELECT USING (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR (driver_member_id IN ( SELECT da.driver_member_id
   FROM ((public.driver_assignments da
     JOIN public.orders o ON ((o.id = da.order_id)))
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE ((l.organization_id = public.current_org_id()) AND (da.status = ANY (ARRAY['accepted'::public.driver_assignment_status, 'picked_up'::public.driver_assignment_status]))))) OR public.is_service_role()));
CREATE POLICY driver_location_pings_update ON public.driver_location_pings FOR UPDATE USING (public.is_service_role());
ALTER TABLE public.driver_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_shifts_delete ON public.driver_shifts FOR DELETE USING (public.is_service_role());
CREATE POLICY driver_shifts_insert ON public.driver_shifts FOR INSERT WITH CHECK (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR public.is_service_role()));
CREATE POLICY driver_shifts_select ON public.driver_shifts FOR SELECT USING (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR (driver_member_id IN ( SELECT organization_members.id
   FROM public.organization_members
  WHERE (organization_members.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY driver_shifts_update ON public.driver_shifts FOR UPDATE USING (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR (driver_member_id IN ( SELECT organization_members.id
   FROM public.organization_members
  WHERE (organization_members.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((driver_member_id IN ( SELECT om.id
   FROM public.organization_members om
  WHERE (om.profile_id = public.current_user_id()))) OR (driver_member_id IN ( SELECT organization_members.id
   FROM public.organization_members
  WHERE (organization_members.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.email_verification_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_verification_tokens_insert ON public.email_verification_tokens FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY email_verification_tokens_select ON public.email_verification_tokens FOR SELECT USING (public.is_service_role());
CREATE POLICY email_verification_tokens_update ON public.email_verification_tokens FOR UPDATE USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.fiscal_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY fiscal_sequences_delete ON public.fiscal_sequences FOR DELETE USING (public.is_service_role());
CREATE POLICY fiscal_sequences_insert ON public.fiscal_sequences FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY fiscal_sequences_select ON public.fiscal_sequences FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY fiscal_sequences_update ON public.fiscal_sequences FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.gift_card_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY gift_card_transactions_delete ON public.gift_card_transactions FOR DELETE USING (false);
CREATE POLICY gift_card_transactions_insert ON public.gift_card_transactions FOR INSERT WITH CHECK (((gift_card_id IN ( SELECT gift_cards.id
   FROM public.gift_cards
  WHERE (gift_cards.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY gift_card_transactions_select ON public.gift_card_transactions FOR SELECT USING (((gift_card_id IN ( SELECT gift_cards.id
   FROM public.gift_cards
  WHERE (gift_cards.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY gift_card_transactions_update ON public.gift_card_transactions FOR UPDATE USING (false);
ALTER TABLE public.gift_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY gift_cards_delete ON public.gift_cards FOR DELETE USING (public.is_service_role());
CREATE POLICY gift_cards_insert ON public.gift_cards FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY gift_cards_select ON public.gift_cards FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY gift_cards_update ON public.gift_cards FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.goods_receipt_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY goods_receipt_items_delete ON public.goods_receipt_items FOR DELETE USING (public.is_service_role());
CREATE POLICY goods_receipt_items_insert ON public.goods_receipt_items FOR INSERT WITH CHECK (((goods_receipt_id IN ( SELECT gr.id
   FROM ((public.goods_receipts gr
     JOIN public.purchase_orders po ON ((po.id = gr.purchase_order_id)))
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY goods_receipt_items_select ON public.goods_receipt_items FOR SELECT USING (((goods_receipt_id IN ( SELECT gr.id
   FROM ((public.goods_receipts gr
     JOIN public.purchase_orders po ON ((po.id = gr.purchase_order_id)))
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY goods_receipt_items_update ON public.goods_receipt_items FOR UPDATE USING (((goods_receipt_id IN ( SELECT gr.id
   FROM ((public.goods_receipts gr
     JOIN public.purchase_orders po ON ((po.id = gr.purchase_order_id)))
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((goods_receipt_id IN ( SELECT gr.id
   FROM ((public.goods_receipts gr
     JOIN public.purchase_orders po ON ((po.id = gr.purchase_order_id)))
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.goods_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY goods_receipts_delete ON public.goods_receipts FOR DELETE USING (public.is_service_role());
CREATE POLICY goods_receipts_insert ON public.goods_receipts FOR INSERT WITH CHECK (((purchase_order_id IN ( SELECT po.id
   FROM (public.purchase_orders po
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY goods_receipts_select ON public.goods_receipts FOR SELECT USING (((purchase_order_id IN ( SELECT po.id
   FROM (public.purchase_orders po
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY goods_receipts_update ON public.goods_receipts FOR UPDATE USING (((purchase_order_id IN ( SELECT po.id
   FROM (public.purchase_orders po
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((purchase_order_id IN ( SELECT po.id
   FROM (public.purchase_orders po
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.house_account_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY house_account_charges_delete ON public.house_account_charges FOR DELETE USING (public.is_service_role());
CREATE POLICY house_account_charges_insert ON public.house_account_charges FOR INSERT WITH CHECK (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY house_account_charges_select ON public.house_account_charges FOR SELECT USING (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY house_account_charges_update ON public.house_account_charges FOR UPDATE USING (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.house_account_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY house_account_invoices_delete ON public.house_account_invoices FOR DELETE USING (public.is_service_role());
CREATE POLICY house_account_invoices_insert ON public.house_account_invoices FOR INSERT WITH CHECK (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY house_account_invoices_select ON public.house_account_invoices FOR SELECT USING (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY house_account_invoices_update ON public.house_account_invoices FOR UPDATE USING (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.house_account_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY house_account_members_delete ON public.house_account_members FOR DELETE USING (public.is_service_role());
CREATE POLICY house_account_members_insert ON public.house_account_members FOR INSERT WITH CHECK (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY house_account_members_select ON public.house_account_members FOR SELECT USING (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY house_account_members_update ON public.house_account_members FOR UPDATE USING (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((house_account_id IN ( SELECT house_accounts.id
   FROM public.house_accounts
  WHERE (house_accounts.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.house_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY house_accounts_delete ON public.house_accounts FOR DELETE USING (public.is_service_role());
CREATE POLICY house_accounts_insert ON public.house_accounts FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY house_accounts_select ON public.house_accounts FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY house_accounts_update ON public.house_accounts FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_keys_all ON public.idempotency_keys USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.ingredient_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY ingredient_price_history_delete ON public.ingredient_price_history FOR DELETE USING (public.is_service_role());
CREATE POLICY ingredient_price_history_insert ON public.ingredient_price_history FOR INSERT WITH CHECK (((inventory_item_id IN ( SELECT inv.id
   FROM (public.inventory_items inv
     JOIN public.locations l ON ((l.id = inv.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY ingredient_price_history_select ON public.ingredient_price_history FOR SELECT USING (((inventory_item_id IN ( SELECT inv.id
   FROM (public.inventory_items inv
     JOIN public.locations l ON ((l.id = inv.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY ingredient_price_history_update ON public.ingredient_price_history FOR UPDATE USING (false);
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_items_delete ON public.inventory_items FOR DELETE USING (public.is_service_role());
CREATE POLICY inventory_items_insert ON public.inventory_items FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY inventory_items_select ON public.inventory_items FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY inventory_items_update ON public.inventory_items FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_delete ON public.invoices FOR DELETE USING (public.is_service_role());
CREATE POLICY invoices_insert ON public.invoices FOR INSERT WITH CHECK (((issuer_org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY invoices_select ON public.invoices FOR SELECT USING (((issuer_org_id = public.current_org_id()) OR (recipient_org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY invoices_update ON public.invoices FOR UPDATE USING (((issuer_org_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((issuer_org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY isr_delete ON public.item_station_routing FOR DELETE USING (public.is_service_role());
CREATE POLICY isr_insert ON public.item_station_routing FOR INSERT WITH CHECK (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY isr_select ON public.item_station_routing FOR SELECT USING (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY isr_update ON public.item_station_routing FOR UPDATE USING (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.item_allergens ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_allergens_delete ON public.item_allergens FOR DELETE USING (public.is_service_role());
CREATE POLICY item_allergens_insert ON public.item_allergens FOR INSERT WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_allergens_select ON public.item_allergens FOR SELECT USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_allergens_select_marketplace ON public.item_allergens FOR SELECT USING ((public.is_marketplace_role() AND (item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE ((l.is_marketplace_visible = true) AND (i.is_active = true) AND (i.is_86ed = false))))));
CREATE POLICY item_allergens_update ON public.item_allergens FOR UPDATE USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.item_dietary_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_dietary_tags_delete ON public.item_dietary_tags FOR DELETE USING (public.is_service_role());
CREATE POLICY item_dietary_tags_insert ON public.item_dietary_tags FOR INSERT WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_dietary_tags_select ON public.item_dietary_tags FOR SELECT USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_dietary_tags_select_marketplace ON public.item_dietary_tags FOR SELECT USING ((public.is_marketplace_role() AND (item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE ((l.is_marketplace_visible = true) AND (i.is_active = true) AND (i.is_86ed = false))))));
CREATE POLICY item_dietary_tags_update ON public.item_dietary_tags FOR UPDATE USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.item_menu_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_menu_schedules_delete ON public.item_menu_schedules FOR DELETE USING (public.is_service_role());
CREATE POLICY item_menu_schedules_insert ON public.item_menu_schedules FOR INSERT WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_menu_schedules_select ON public.item_menu_schedules FOR SELECT USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_menu_schedules_update ON public.item_menu_schedules FOR UPDATE USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.item_prep_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_prep_steps_delete ON public.item_prep_steps FOR DELETE USING (public.is_service_role());
CREATE POLICY item_prep_steps_insert ON public.item_prep_steps FOR INSERT WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_prep_steps_select ON public.item_prep_steps FOR SELECT USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_prep_steps_update ON public.item_prep_steps FOR UPDATE USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.item_price_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_price_schedules_delete ON public.item_price_schedules FOR DELETE USING (public.is_service_role());
CREATE POLICY item_price_schedules_insert ON public.item_price_schedules FOR INSERT WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_price_schedules_select ON public.item_price_schedules FOR SELECT USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_price_schedules_update ON public.item_price_schedules FOR UPDATE USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.item_recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY item_recipes_delete ON public.item_recipes FOR DELETE USING (public.is_service_role());
CREATE POLICY item_recipes_insert ON public.item_recipes FOR INSERT WITH CHECK (((parent_item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_recipes_select ON public.item_recipes FOR SELECT USING (((parent_item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY item_recipes_update ON public.item_recipes FOR UPDATE USING (((parent_item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((parent_item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.item_station_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_delete ON public.items FOR DELETE USING (public.is_service_role());
CREATE POLICY items_insert ON public.items FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY items_select ON public.items FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY items_select_marketplace ON public.items FOR SELECT USING ((public.is_marketplace_role() AND (is_active = true) AND (is_86ed = false) AND (location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.is_marketplace_visible = true)))));
CREATE POLICY items_update ON public.items FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.kds_display_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY kds_display_groups_delete ON public.kds_display_groups FOR DELETE USING (public.is_service_role());
CREATE POLICY kds_display_groups_insert ON public.kds_display_groups FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_display_groups_select ON public.kds_display_groups FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_display_groups_update ON public.kds_display_groups FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_events_delete ON public.kds_ticket_events FOR DELETE USING (false);
CREATE POLICY kds_events_insert ON public.kds_ticket_events FOR INSERT WITH CHECK (((ticket_id IN ( SELECT kt.id
   FROM ((public.kds_tickets kt
     JOIN public.kitchen_stations ks ON ((ks.id = kt.station_id)))
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_events_select ON public.kds_ticket_events FOR SELECT USING (((ticket_id IN ( SELECT kt.id
   FROM ((public.kds_tickets kt
     JOIN public.kitchen_stations ks ON ((ks.id = kt.station_id)))
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_events_update ON public.kds_ticket_events FOR UPDATE USING (false);
CREATE POLICY kds_fanout_delete ON public.kds_fanout_queue FOR DELETE USING (public.is_service_role());
CREATE POLICY kds_fanout_insert ON public.kds_fanout_queue FOR INSERT WITH CHECK (public.is_service_role());
ALTER TABLE public.kds_fanout_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY kds_fanout_select ON public.kds_fanout_queue FOR SELECT USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_fanout_update ON public.kds_fanout_queue FOR UPDATE USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.kds_ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kds_ticket_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY kds_ticket_items_delete ON public.kds_ticket_items FOR DELETE USING (public.is_service_role());
CREATE POLICY kds_ticket_items_insert ON public.kds_ticket_items FOR INSERT WITH CHECK (((ticket_id IN ( SELECT kt.id
   FROM ((public.kds_tickets kt
     JOIN public.kitchen_stations ks ON ((ks.id = kt.station_id)))
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_ticket_items_select ON public.kds_ticket_items FOR SELECT USING (((ticket_id IN ( SELECT kt.id
   FROM ((public.kds_tickets kt
     JOIN public.kitchen_stations ks ON ((ks.id = kt.station_id)))
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_ticket_items_update ON public.kds_ticket_items FOR UPDATE USING (((ticket_id IN ( SELECT kt.id
   FROM ((public.kds_tickets kt
     JOIN public.kitchen_stations ks ON ((ks.id = kt.station_id)))
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((ticket_id IN ( SELECT kt.id
   FROM ((public.kds_tickets kt
     JOIN public.kitchen_stations ks ON ((ks.id = kt.station_id)))
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.kds_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY kds_tickets_delete ON public.kds_tickets FOR DELETE USING (public.is_service_role());
CREATE POLICY kds_tickets_insert ON public.kds_tickets FOR INSERT WITH CHECK (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_tickets_select ON public.kds_tickets FOR SELECT USING (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kds_tickets_update ON public.kds_tickets FOR UPDATE USING (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((station_id IN ( SELECT ks.id
   FROM (public.kitchen_stations ks
     JOIN public.locations l ON ((l.id = ks.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.kitchen_stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY kitchen_stations_delete ON public.kitchen_stations FOR DELETE USING (public.is_service_role());
CREATE POLICY kitchen_stations_insert ON public.kitchen_stations FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kitchen_stations_select ON public.kitchen_stations FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY kitchen_stations_update ON public.kitchen_stations FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_acceptances_insert_self ON public.legal_acceptances FOR INSERT WITH CHECK (((profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY legal_acceptances_select_owner ON public.legal_acceptances FOR SELECT USING (((profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY legal_acceptances_write_service ON public.legal_acceptances USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.legal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_documents_select_public ON public.legal_documents FOR SELECT USING (true);
CREATE POLICY legal_documents_write_service ON public.legal_documents USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.llm_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY llm_messages_delete ON public.llm_messages FOR DELETE USING (false);
CREATE POLICY llm_messages_insert ON public.llm_messages FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY llm_messages_select ON public.llm_messages FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY llm_messages_update ON public.llm_messages FOR UPDATE USING (false);
ALTER TABLE public.llm_tool_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY llm_tool_executions_delete ON public.llm_tool_executions FOR DELETE USING (false);
CREATE POLICY llm_tool_executions_insert ON public.llm_tool_executions FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY llm_tool_executions_select ON public.llm_tool_executions FOR SELECT USING (((llm_message_id IN ( SELECT llm_messages.id
   FROM public.llm_messages
  WHERE (llm_messages.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY llm_tool_executions_update ON public.llm_tool_executions FOR UPDATE USING (false);
CREATE POLICY loc_email_cred_delete ON public.location_email_credentials FOR DELETE USING (public.is_service_role());
CREATE POLICY loc_email_cred_insert ON public.location_email_credentials FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY loc_email_cred_select ON public.location_email_credentials FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY loc_email_cred_update ON public.location_email_credentials FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.location_email_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_printers ENABLE ROW LEVEL SECURITY;
CREATE POLICY location_printers_delete_tenant ON public.location_printers FOR DELETE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY location_printers_insert_tenant ON public.location_printers FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY location_printers_select_tenant ON public.location_printers FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY location_printers_update_tenant ON public.location_printers FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY locations_delete ON public.locations FOR DELETE USING (public.is_service_role());
CREATE POLICY locations_insert ON public.locations FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY locations_select_marketplace ON public.locations FOR SELECT USING ((public.is_marketplace_role() AND (is_marketplace_visible = true)));
CREATE POLICY locations_select_member ON public.locations FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY locations_update ON public.locations FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.loyalty_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY loyalty_config_delete ON public.loyalty_config FOR DELETE USING (public.is_service_role());
CREATE POLICY loyalty_config_insert ON public.loyalty_config FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY loyalty_config_select ON public.loyalty_config FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY loyalty_config_update ON public.loyalty_config FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY loyalty_transactions_delete ON public.loyalty_transactions FOR DELETE USING (false);
CREATE POLICY loyalty_transactions_insert ON public.loyalty_transactions FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY loyalty_transactions_select ON public.loyalty_transactions FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY loyalty_transactions_update ON public.loyalty_transactions FOR UPDATE USING (false);
ALTER TABLE public.marketplace_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_reviews_delete ON public.marketplace_reviews FOR DELETE USING (public.is_service_role());
CREATE POLICY marketplace_reviews_insert ON public.marketplace_reviews FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY marketplace_reviews_insert_customer ON public.marketplace_reviews FOR INSERT WITH CHECK (((customer_profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY marketplace_reviews_owner_reply ON public.marketplace_reviews FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY marketplace_reviews_select_public ON public.marketplace_reviews FOR SELECT USING ((public.is_marketplace_role() AND (status = 'visible'::text)));
CREATE POLICY marketplace_reviews_select_tenant ON public.marketplace_reviews FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY marketplace_reviews_update ON public.marketplace_reviews FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.menu_schedule_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_schedule_slots_delete ON public.menu_schedule_slots FOR DELETE USING (public.is_service_role());
CREATE POLICY menu_schedule_slots_insert ON public.menu_schedule_slots FOR INSERT WITH CHECK (((menu_schedule_id IN ( SELECT ms.id
   FROM (public.menu_schedules ms
     JOIN public.locations l ON ((l.id = ms.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY menu_schedule_slots_select ON public.menu_schedule_slots FOR SELECT USING (((menu_schedule_id IN ( SELECT ms.id
   FROM (public.menu_schedules ms
     JOIN public.locations l ON ((l.id = ms.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY menu_schedule_slots_select_marketplace ON public.menu_schedule_slots FOR SELECT USING ((public.is_marketplace_role() AND (menu_schedule_id IN ( SELECT ms.id
   FROM (public.menu_schedules ms
     JOIN public.locations l ON ((l.id = ms.location_id)))
  WHERE ((l.is_marketplace_visible = true) AND (ms.is_active = true))))));
CREATE POLICY menu_schedule_slots_update ON public.menu_schedule_slots FOR UPDATE USING (((menu_schedule_id IN ( SELECT ms.id
   FROM (public.menu_schedules ms
     JOIN public.locations l ON ((l.id = ms.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((menu_schedule_id IN ( SELECT ms.id
   FROM (public.menu_schedules ms
     JOIN public.locations l ON ((l.id = ms.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.menu_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_schedules_delete ON public.menu_schedules FOR DELETE USING (public.is_service_role());
CREATE POLICY menu_schedules_insert ON public.menu_schedules FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY menu_schedules_select ON public.menu_schedules FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY menu_schedules_select_marketplace ON public.menu_schedules FOR SELECT USING ((public.is_marketplace_role() AND (location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.is_marketplace_visible = true))) AND (is_active = true)));
CREATE POLICY menu_schedules_update ON public.menu_schedules FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.modifier_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY modifier_groups_delete ON public.modifier_groups FOR DELETE USING (public.is_service_role());
CREATE POLICY modifier_groups_insert ON public.modifier_groups FOR INSERT WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY modifier_groups_select ON public.modifier_groups FOR SELECT USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY modifier_groups_select_marketplace ON public.modifier_groups FOR SELECT USING ((public.is_marketplace_role() AND (item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE ((l.is_marketplace_visible = true) AND (i.is_active = true) AND (i.is_86ed = false))))));
CREATE POLICY modifier_groups_update ON public.modifier_groups FOR UPDATE USING (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((item_id IN ( SELECT i.id
   FROM (public.items i
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY modifiers_delete ON public.modifiers FOR DELETE USING (public.is_service_role());
CREATE POLICY modifiers_insert ON public.modifiers FOR INSERT WITH CHECK (((modifier_group_id IN ( SELECT mg.id
   FROM ((public.modifier_groups mg
     JOIN public.items i ON ((i.id = mg.item_id)))
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY modifiers_select ON public.modifiers FOR SELECT USING (((modifier_group_id IN ( SELECT mg.id
   FROM ((public.modifier_groups mg
     JOIN public.items i ON ((i.id = mg.item_id)))
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY modifiers_select_marketplace ON public.modifiers FOR SELECT USING ((public.is_marketplace_role() AND (modifier_group_id IN ( SELECT mg.id
   FROM ((public.modifier_groups mg
     JOIN public.items i ON ((i.id = mg.item_id)))
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE ((l.is_marketplace_visible = true) AND (i.is_active = true) AND (i.is_86ed = false)))) AND (is_active = true)));
CREATE POLICY modifiers_update ON public.modifiers FOR UPDATE USING (((modifier_group_id IN ( SELECT mg.id
   FROM ((public.modifier_groups mg
     JOIN public.items i ON ((i.id = mg.item_id)))
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((modifier_group_id IN ( SELECT mg.id
   FROM ((public.modifier_groups mg
     JOIN public.items i ON ((i.id = mg.item_id)))
     JOIN public.locations l ON ((l.id = i.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY oim_delete ON public.order_item_modifiers FOR DELETE USING (public.is_service_role());
CREATE POLICY oim_insert ON public.order_item_modifiers FOR INSERT WITH CHECK (((order_item_id IN ( SELECT oi.id
   FROM (public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
  WHERE (o.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY oim_select ON public.order_item_modifiers FOR SELECT USING (((order_item_id IN ( SELECT oi.id
   FROM (public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
  WHERE (o.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY oim_update ON public.order_item_modifiers FOR UPDATE USING (((order_item_id IN ( SELECT oi.id
   FROM (public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
  WHERE (o.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((order_item_id IN ( SELECT oi.id
   FROM (public.order_items oi
     JOIN public.orders o ON ((o.id = oi.order_id)))
  WHERE (o.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY onboarding_progress_delete ON public.onboarding_progress FOR DELETE USING (public.is_service_role());
CREATE POLICY onboarding_progress_insert ON public.onboarding_progress FOR INSERT WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY onboarding_progress_select ON public.onboarding_progress FOR SELECT USING (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY onboarding_progress_update ON public.onboarding_progress FOR UPDATE USING (((org_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.order_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_adjustments_delete ON public.order_adjustments FOR DELETE USING (public.is_service_role());
CREATE POLICY order_adjustments_insert ON public.order_adjustments FOR INSERT WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY order_adjustments_select ON public.order_adjustments FOR SELECT USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY order_adjustments_update ON public.order_adjustments FOR UPDATE USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.order_item_discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_item_discounts_delete ON public.order_item_discounts FOR DELETE USING (public.is_service_role());
CREATE POLICY order_item_discounts_insert ON public.order_item_discounts FOR INSERT WITH CHECK (((promotion_redemption_id IN ( SELECT pr.id
   FROM (public.promotion_redemptions pr
     JOIN public.promotions p ON ((p.id = pr.promotion_id)))
  WHERE (p.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY order_item_discounts_select ON public.order_item_discounts FOR SELECT USING (((promotion_redemption_id IN ( SELECT pr.id
   FROM (public.promotion_redemptions pr
     JOIN public.promotions p ON ((p.id = pr.promotion_id)))
  WHERE (p.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY order_item_discounts_update ON public.order_item_discounts FOR UPDATE USING (((promotion_redemption_id IN ( SELECT pr.id
   FROM (public.promotion_redemptions pr
     JOIN public.promotions p ON ((p.id = pr.promotion_id)))
  WHERE (p.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((promotion_redemption_id IN ( SELECT pr.id
   FROM (public.promotion_redemptions pr
     JOIN public.promotions p ON ((p.id = pr.promotion_id)))
  WHERE (p.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.order_item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_items_delete ON public.order_items FOR DELETE USING (public.is_service_role());
CREATE POLICY order_items_insert ON public.order_items FOR INSERT WITH CHECK (((order_id IN ( SELECT orders.id
   FROM public.orders
  WHERE (orders.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY order_items_select ON public.order_items FOR SELECT USING (((order_id IN ( SELECT orders.id
   FROM public.orders
  WHERE (orders.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY order_items_update ON public.order_items FOR UPDATE USING (((order_id IN ( SELECT orders.id
   FROM public.orders
  WHERE (orders.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((order_id IN ( SELECT orders.id
   FROM public.orders
  WHERE (orders.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_payments_delete ON public.order_payments FOR DELETE USING (public.is_service_role());
CREATE POLICY order_payments_insert ON public.order_payments FOR INSERT WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY order_payments_select ON public.order_payments FOR SELECT USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY order_payments_update ON public.order_payments FOR UPDATE USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.order_tracking_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_delete ON public.orders FOR DELETE USING (public.is_service_role());
CREATE POLICY orders_insert ON public.orders FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY orders_select ON public.orders FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY orders_update ON public.orders FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_invites_delete ON public.organization_invites FOR DELETE USING (public.is_service_role());
CREATE POLICY organization_invites_insert ON public.organization_invites FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY organization_invites_select ON public.organization_invites FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY organization_invites_update ON public.organization_invites FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_members_delete ON public.organization_members FOR DELETE USING (public.is_service_role());
CREATE POLICY organization_members_insert ON public.organization_members FOR INSERT WITH CHECK ((public.is_service_role() OR ((profile_id = public.current_user_id()) AND ((organization_id = public.current_org_id()) OR (NOT (EXISTS ( SELECT 1
   FROM public.organization_members existing
  WHERE ((existing.profile_id = public.current_user_id()) AND (existing.organization_id = organization_members.organization_id)))))))));
CREATE POLICY organization_members_select ON public.organization_members FOR SELECT USING ((public.is_service_role() OR (profile_id = public.current_user_id()) OR (organization_id = public.current_org_id())));
CREATE POLICY organization_members_update ON public.organization_members FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_delete ON public.organizations FOR DELETE USING (public.is_service_role());
CREATE POLICY organizations_insert ON public.organizations FOR INSERT WITH CHECK ((public.is_service_role() OR (public.current_user_id() IS NOT NULL)));
CREATE POLICY organizations_select ON public.organizations FOR SELECT USING (((id = public.current_org_id()) OR public.is_service_role() OR (created_by = public.current_user_id()) OR (EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members.organization_id = organizations.id) AND (organization_members.profile_id = public.current_user_id()))))));
CREATE POLICY organizations_update ON public.organizations FOR UPDATE USING (((id = public.current_org_id()) OR (created_by = public.current_user_id()) OR public.is_service_role())) WITH CHECK (((id = public.current_org_id()) OR (created_by = public.current_user_id()) OR public.is_service_role()));
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY password_reset_tokens_delete ON public.password_reset_tokens FOR DELETE USING (((user_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY password_reset_tokens_insert ON public.password_reset_tokens FOR INSERT WITH CHECK (((user_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY password_reset_tokens_select ON public.password_reset_tokens FOR SELECT USING (((user_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY password_reset_tokens_update ON public.password_reset_tokens FOR UPDATE USING (((user_id = public.current_user_id()) OR public.is_service_role())) WITH CHECK (((user_id = public.current_user_id()) OR public.is_service_role()));
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_periods_delete ON public.payroll_periods FOR DELETE USING (public.is_service_role());
CREATE POLICY payroll_periods_insert ON public.payroll_periods FOR INSERT WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY payroll_periods_select ON public.payroll_periods FOR SELECT USING (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY payroll_periods_update ON public.payroll_periods FOR UPDATE USING (((org_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.pii_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY pii_access_log_delete ON public.pii_access_log FOR DELETE USING (false);
CREATE POLICY pii_access_log_insert ON public.pii_access_log FOR INSERT WITH CHECK (true);
CREATE POLICY pii_access_log_select ON public.pii_access_log FOR SELECT USING (public.is_service_role());
CREATE POLICY pii_access_log_update ON public.pii_access_log FOR UPDATE USING (false);
ALTER TABLE public.platform_admin_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_admin_actions_insert ON public.platform_admin_actions FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY platform_admin_actions_select ON public.platform_admin_actions FOR SELECT USING (public.is_service_role());
ALTER TABLE public.pos_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_shifts_delete ON public.pos_shifts FOR DELETE USING (public.is_service_role());
CREATE POLICY pos_shifts_insert ON public.pos_shifts FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY pos_shifts_select ON public.pos_shifts FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY pos_shifts_update ON public.pos_shifts FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.prep_batch_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY prep_batch_inputs_delete ON public.prep_batch_inputs FOR DELETE USING (public.is_service_role());
CREATE POLICY prep_batch_inputs_insert ON public.prep_batch_inputs FOR INSERT WITH CHECK (((prep_batch_id IN ( SELECT pb.id
   FROM public.prep_batches pb
  WHERE (pb.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY prep_batch_inputs_select ON public.prep_batch_inputs FOR SELECT USING (((prep_batch_id IN ( SELECT pb.id
   FROM public.prep_batches pb
  WHERE (pb.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY prep_batch_inputs_update ON public.prep_batch_inputs FOR UPDATE USING (false);
ALTER TABLE public.prep_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY prep_batches_delete ON public.prep_batches FOR DELETE USING (public.is_service_role());
CREATE POLICY prep_batches_insert ON public.prep_batches FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY prep_batches_select ON public.prep_batches FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY prep_batches_update ON public.prep_batches FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_delete ON public.profiles FOR DELETE USING (public.is_service_role());
CREATE POLICY profiles_insert ON public.profiles FOR INSERT WITH CHECK (((id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY profiles_select ON public.profiles FOR SELECT USING (((id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING (((id = public.current_user_id()) OR public.is_service_role())) WITH CHECK (((id = public.current_user_id()) OR public.is_service_role()));
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotion_redemptions_delete ON public.promotion_redemptions FOR DELETE USING (public.is_service_role());
CREATE POLICY promotion_redemptions_insert ON public.promotion_redemptions FOR INSERT WITH CHECK (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY promotion_redemptions_select ON public.promotion_redemptions FOR SELECT USING (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY promotion_redemptions_update ON public.promotion_redemptions FOR UPDATE USING (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.promotion_target_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotion_target_categories_delete ON public.promotion_target_categories FOR DELETE USING (public.is_service_role());
CREATE POLICY promotion_target_categories_insert ON public.promotion_target_categories FOR INSERT WITH CHECK (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY promotion_target_categories_select ON public.promotion_target_categories FOR SELECT USING (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY promotion_target_categories_update ON public.promotion_target_categories FOR UPDATE USING (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.promotion_target_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotion_target_items_delete ON public.promotion_target_items FOR DELETE USING (public.is_service_role());
CREATE POLICY promotion_target_items_insert ON public.promotion_target_items FOR INSERT WITH CHECK (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY promotion_target_items_select ON public.promotion_target_items FOR SELECT USING (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY promotion_target_items_update ON public.promotion_target_items FOR UPDATE USING (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((promotion_id IN ( SELECT promotions.id
   FROM public.promotions
  WHERE (promotions.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotions_delete ON public.promotions FOR DELETE USING (public.is_service_role());
CREATE POLICY promotions_insert ON public.promotions FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY promotions_select ON public.promotions FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY promotions_update ON public.promotions FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_order_items_delete ON public.purchase_order_items FOR DELETE USING (public.is_service_role());
CREATE POLICY purchase_order_items_insert ON public.purchase_order_items FOR INSERT WITH CHECK (((purchase_order_id IN ( SELECT po.id
   FROM (public.purchase_orders po
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY purchase_order_items_select ON public.purchase_order_items FOR SELECT USING (((purchase_order_id IN ( SELECT po.id
   FROM (public.purchase_orders po
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY purchase_order_items_update ON public.purchase_order_items FOR UPDATE USING (((purchase_order_id IN ( SELECT po.id
   FROM (public.purchase_orders po
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((purchase_order_id IN ( SELECT po.id
   FROM (public.purchase_orders po
     JOIN public.locations l ON ((l.id = po.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_delete ON public.purchase_orders FOR DELETE USING (public.is_service_role());
CREATE POLICY purchase_orders_insert ON public.purchase_orders FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY purchase_orders_select ON public.purchase_orders FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY purchase_orders_update ON public.purchase_orders FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.receipt_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY receipt_documents_delete ON public.receipt_documents FOR DELETE USING (public.is_service_role());
CREATE POLICY receipt_documents_insert ON public.receipt_documents FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY receipt_documents_select ON public.receipt_documents FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.recipe_cost_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY recipe_cost_runs_all ON public.recipe_cost_runs USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_delete ON public.refresh_tokens FOR DELETE USING (((user_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY refresh_tokens_insert ON public.refresh_tokens FOR INSERT WITH CHECK (((user_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY refresh_tokens_select ON public.refresh_tokens FOR SELECT USING (((user_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY refresh_tokens_update ON public.refresh_tokens FOR UPDATE USING (((user_id = public.current_user_id()) OR public.is_service_role())) WITH CHECK (((user_id = public.current_user_id()) OR public.is_service_role()));
ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY refunds_delete ON public.refunds FOR DELETE USING (public.is_service_role());
CREATE POLICY refunds_insert ON public.refunds FOR INSERT WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY refunds_select ON public.refunds FOR SELECT USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY refunds_update ON public.refunds FOR UPDATE USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY reservations_delete ON public.reservations FOR DELETE USING (public.is_service_role());
CREATE POLICY reservations_insert ON public.reservations FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY reservations_select ON public.reservations FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY reservations_update ON public.reservations FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_delete ON public.reviews FOR DELETE USING (public.is_service_role());
CREATE POLICY reviews_insert ON public.reviews FOR INSERT WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY reviews_select ON public.reviews FOR SELECT USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY reviews_update ON public.reviews FOR UPDATE USING (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((order_id IN ( SELECT o.id
   FROM (public.orders o
     JOIN public.locations l ON ((l.id = o.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY seats_delete ON public.seats FOR DELETE USING (public.is_service_role());
CREATE POLICY seats_insert ON public.seats FOR INSERT WITH CHECK (((table_session_id IN ( SELECT ts.id
   FROM (public.table_sessions ts
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY seats_select ON public.seats FOR SELECT USING (((table_session_id IN ( SELECT ts.id
   FROM (public.table_sessions ts
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY seats_update ON public.seats FOR UPDATE USING (((table_session_id IN ( SELECT ts.id
   FROM (public.table_sessions ts
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((table_session_id IN ( SELECT ts.id
   FROM (public.table_sessions ts
     JOIN public.locations l ON ((l.id = ts.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY sections_delete ON public.sections FOR DELETE USING (public.is_service_role());
CREATE POLICY sections_insert ON public.sections FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY sections_select ON public.sections FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY sections_update ON public.sections FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_attendance_summary_delete ON public.staff_attendance_summary FOR DELETE USING (public.is_service_role());
CREATE POLICY staff_attendance_summary_insert ON public.staff_attendance_summary FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY staff_attendance_summary_select ON public.staff_attendance_summary FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY staff_attendance_summary_update ON public.staff_attendance_summary FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY staff_delete ON public.staff FOR DELETE USING (public.is_service_role());
CREATE POLICY staff_insert ON public.staff FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.staff_password_reset_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_password_reset_tokens_delete ON public.staff_password_reset_tokens FOR DELETE USING (public.is_service_role());
CREATE POLICY staff_password_reset_tokens_insert ON public.staff_password_reset_tokens FOR INSERT WITH CHECK (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
CREATE POLICY staff_password_reset_tokens_select ON public.staff_password_reset_tokens FOR SELECT USING (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
CREATE POLICY staff_password_reset_tokens_update ON public.staff_password_reset_tokens FOR UPDATE USING (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role())) WITH CHECK (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
ALTER TABLE public.staff_pay_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_pay_rates_delete ON public.staff_pay_rates FOR DELETE USING (public.is_service_role());
CREATE POLICY staff_pay_rates_insert ON public.staff_pay_rates FOR INSERT WITH CHECK (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
CREATE POLICY staff_pay_rates_select ON public.staff_pay_rates FOR SELECT USING (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
CREATE POLICY staff_pay_rates_update ON public.staff_pay_rates FOR UPDATE USING (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role())) WITH CHECK (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
ALTER TABLE public.staff_refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_refresh_tokens_delete ON public.staff_refresh_tokens FOR DELETE USING (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
CREATE POLICY staff_refresh_tokens_insert ON public.staff_refresh_tokens FOR INSERT WITH CHECK (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
CREATE POLICY staff_refresh_tokens_select ON public.staff_refresh_tokens FOR SELECT USING (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
CREATE POLICY staff_refresh_tokens_update ON public.staff_refresh_tokens FOR UPDATE USING (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role())) WITH CHECK (((staff_id IN ( SELECT s.id
   FROM public.staff s
  WHERE (s.location_id IN ( SELECT locations.id
           FROM public.locations
          WHERE (locations.organization_id = public.current_org_id()))))) OR public.is_service_role()));
CREATE POLICY staff_select ON public.staff FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.staff_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_shifts_delete ON public.staff_shifts FOR DELETE USING (public.is_service_role());
CREATE POLICY staff_shifts_insert ON public.staff_shifts FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY staff_shifts_select ON public.staff_shifts FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY staff_shifts_update ON public.staff_shifts FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.staff_time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_time_entries_delete ON public.staff_time_entries FOR DELETE USING (public.is_service_role());
CREATE POLICY staff_time_entries_insert ON public.staff_time_entries FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY staff_time_entries_select ON public.staff_time_entries FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY staff_time_entries_update ON public.staff_time_entries FOR UPDATE USING (public.is_service_role()) WITH CHECK (public.is_service_role());
CREATE POLICY staff_update ON public.staff FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_delete ON public.stock_movements FOR DELETE USING (public.is_service_role());
CREATE POLICY stock_movements_insert ON public.stock_movements FOR INSERT WITH CHECK (((inventory_item_id IN ( SELECT inv.id
   FROM (public.inventory_items inv
     JOIN public.locations l ON ((l.id = inv.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT USING (((inventory_item_id IN ( SELECT inv.id
   FROM (public.inventory_items inv
     JOIN public.locations l ON ((l.id = inv.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY stock_movements_update ON public.stock_movements FOR UPDATE USING (false);
ALTER TABLE public.store_credit_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY store_credit_transactions_delete ON public.store_credit_transactions FOR DELETE USING (public.is_service_role());
CREATE POLICY store_credit_transactions_insert ON public.store_credit_transactions FOR INSERT WITH CHECK (((store_credit_id IN ( SELECT store_credits.id
   FROM public.store_credits
  WHERE (store_credits.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY store_credit_transactions_select ON public.store_credit_transactions FOR SELECT USING (((store_credit_id IN ( SELECT store_credits.id
   FROM public.store_credits
  WHERE (store_credits.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY store_credit_transactions_update ON public.store_credit_transactions FOR UPDATE USING (public.is_service_role());
ALTER TABLE public.store_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY store_credits_delete ON public.store_credits FOR DELETE USING (public.is_service_role());
CREATE POLICY store_credits_insert ON public.store_credits FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY store_credits_select ON public.store_credits FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY store_credits_update ON public.store_credits FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.supplier_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_contacts_delete ON public.supplier_contacts FOR DELETE USING (public.is_service_role());
CREATE POLICY supplier_contacts_insert ON public.supplier_contacts FOR INSERT WITH CHECK (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_contacts_select ON public.supplier_contacts FOR SELECT USING (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_contacts_update ON public.supplier_contacts FOR UPDATE USING (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.supplier_inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_inventory_items_delete ON public.supplier_inventory_items FOR DELETE USING (public.is_service_role());
CREATE POLICY supplier_inventory_items_insert ON public.supplier_inventory_items FOR INSERT WITH CHECK (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_inventory_items_select ON public.supplier_inventory_items FOR SELECT USING (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_inventory_items_update ON public.supplier_inventory_items FOR UPDATE USING (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_invoice_lines_delete ON public.supplier_invoice_lines FOR DELETE USING (public.is_service_role());
CREATE POLICY supplier_invoice_lines_insert ON public.supplier_invoice_lines FOR INSERT WITH CHECK (((supplier_invoice_id IN ( SELECT si.id
   FROM (public.supplier_invoices si
     JOIN public.locations l ON ((l.id = si.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_invoice_lines_select ON public.supplier_invoice_lines FOR SELECT USING (((supplier_invoice_id IN ( SELECT si.id
   FROM (public.supplier_invoices si
     JOIN public.locations l ON ((l.id = si.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_invoice_lines_update ON public.supplier_invoice_lines FOR UPDATE USING (((supplier_invoice_id IN ( SELECT si.id
   FROM (public.supplier_invoices si
     JOIN public.locations l ON ((l.id = si.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((supplier_invoice_id IN ( SELECT si.id
   FROM (public.supplier_invoices si
     JOIN public.locations l ON ((l.id = si.location_id)))
  WHERE (l.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_invoices_delete ON public.supplier_invoices FOR DELETE USING (public.is_service_role());
CREATE POLICY supplier_invoices_insert ON public.supplier_invoices FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_invoices_select ON public.supplier_invoices FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_invoices_update ON public.supplier_invoices FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.supplier_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_locations_delete ON public.supplier_locations FOR DELETE USING (public.is_service_role());
CREATE POLICY supplier_locations_insert ON public.supplier_locations FOR INSERT WITH CHECK (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_locations_select ON public.supplier_locations FOR SELECT USING (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY supplier_locations_update ON public.supplier_locations FOR UPDATE USING (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((supplier_id IN ( SELECT suppliers.id
   FROM public.suppliers
  WHERE (suppliers.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE USING (public.is_service_role());
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY table_sessions_delete ON public.table_sessions FOR DELETE USING (public.is_service_role());
CREATE POLICY table_sessions_insert ON public.table_sessions FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY table_sessions_select ON public.table_sessions FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY table_sessions_update ON public.table_sessions FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY tables_delete ON public.tables FOR DELETE USING (public.is_service_role());
CREATE POLICY tables_insert ON public.tables FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY tables_select ON public.tables FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY tables_update ON public.tables FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.tax_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_profiles_delete ON public.tax_profiles FOR DELETE USING (public.is_service_role());
CREATE POLICY tax_profiles_insert ON public.tax_profiles FOR INSERT WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY tax_profiles_select ON public.tax_profiles FOR SELECT USING (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY tax_profiles_update ON public.tax_profiles FOR UPDATE USING (((org_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.tax_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tax_rates_delete ON public.tax_rates FOR DELETE USING (public.is_service_role());
CREATE POLICY tax_rates_insert ON public.tax_rates FOR INSERT WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY tax_rates_select ON public.tax_rates FOR SELECT USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY tax_rates_update ON public.tax_rates FOR UPDATE USING (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((location_id IN ( SELECT locations.id
   FROM public.locations
  WHERE (locations.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.tip_distributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tip_distributions_delete ON public.tip_distributions FOR DELETE USING (public.is_service_role());
CREATE POLICY tip_distributions_insert ON public.tip_distributions FOR INSERT WITH CHECK (((tip_pool_id IN ( SELECT tip_pools.id
   FROM public.tip_pools
  WHERE (tip_pools.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY tip_distributions_select ON public.tip_distributions FOR SELECT USING (((tip_pool_id IN ( SELECT tip_pools.id
   FROM public.tip_pools
  WHERE (tip_pools.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY tip_distributions_update ON public.tip_distributions FOR UPDATE USING (((tip_pool_id IN ( SELECT tip_pools.id
   FROM public.tip_pools
  WHERE (tip_pools.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((tip_pool_id IN ( SELECT tip_pools.id
   FROM public.tip_pools
  WHERE (tip_pools.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.tip_pool_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tip_pool_contributions_delete ON public.tip_pool_contributions FOR DELETE USING (public.is_service_role());
CREATE POLICY tip_pool_contributions_insert ON public.tip_pool_contributions FOR INSERT WITH CHECK (((tip_pool_id IN ( SELECT tip_pools.id
   FROM public.tip_pools
  WHERE (tip_pools.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY tip_pool_contributions_select ON public.tip_pool_contributions FOR SELECT USING (((tip_pool_id IN ( SELECT tip_pools.id
   FROM public.tip_pools
  WHERE (tip_pools.organization_id = public.current_org_id()))) OR public.is_service_role()));
CREATE POLICY tip_pool_contributions_update ON public.tip_pool_contributions FOR UPDATE USING (((tip_pool_id IN ( SELECT tip_pools.id
   FROM public.tip_pools
  WHERE (tip_pools.organization_id = public.current_org_id()))) OR public.is_service_role())) WITH CHECK (((tip_pool_id IN ( SELECT tip_pools.id
   FROM public.tip_pools
  WHERE (tip_pools.organization_id = public.current_org_id()))) OR public.is_service_role()));
ALTER TABLE public.tip_pools ENABLE ROW LEVEL SECURITY;
CREATE POLICY tip_pools_delete ON public.tip_pools FOR DELETE USING (public.is_service_role());
CREATE POLICY tip_pools_insert ON public.tip_pools FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY tip_pools_select ON public.tip_pools FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY tip_pools_update ON public.tip_pools FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY tracking_tokens_delete ON public.order_tracking_tokens FOR DELETE USING (public.is_service_role());
CREATE POLICY tracking_tokens_insert ON public.order_tracking_tokens FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY tracking_tokens_select ON public.order_tracking_tokens FOR SELECT USING (((customer_profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY tracking_tokens_update ON public.order_tracking_tokens FOR UPDATE USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.user_backup_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_backup_codes_delete ON public.user_backup_codes FOR DELETE USING (public.is_service_role());
CREATE POLICY user_backup_codes_insert ON public.user_backup_codes FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY user_backup_codes_select ON public.user_backup_codes FOR SELECT USING (((profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY user_backup_codes_update ON public.user_backup_codes FOR UPDATE USING (public.is_service_role());
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_preferences_delete ON public.user_preferences FOR DELETE USING (public.is_service_role());
CREATE POLICY user_preferences_insert ON public.user_preferences FOR INSERT WITH CHECK (((profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY user_preferences_select ON public.user_preferences FOR SELECT USING (((profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY user_preferences_update ON public.user_preferences FOR UPDATE USING (((profile_id = public.current_user_id()) OR public.is_service_role())) WITH CHECK (((profile_id = public.current_user_id()) OR public.is_service_role()));
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY waitlist_delete ON public.waitlist FOR DELETE USING (public.is_service_role());
CREATE POLICY waitlist_insert ON public.waitlist FOR INSERT WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY waitlist_select ON public.waitlist FOR SELECT USING (((organization_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY waitlist_update ON public.waitlist FOR UPDATE USING (((organization_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((organization_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_delete ON public.webhook_deliveries FOR DELETE USING (public.is_service_role());
CREATE POLICY webhook_deliveries_insert ON public.webhook_deliveries FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY webhook_deliveries_select ON public.webhook_deliveries FOR SELECT USING (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY webhook_deliveries_update ON public.webhook_deliveries FOR UPDATE USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_endpoints_delete ON public.webhook_endpoints FOR DELETE USING (public.is_service_role());
CREATE POLICY webhook_endpoints_insert ON public.webhook_endpoints FOR INSERT WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY webhook_endpoints_select ON public.webhook_endpoints FOR SELECT USING (((org_id = public.current_org_id()) OR public.is_service_role()));
CREATE POLICY webhook_endpoints_update ON public.webhook_endpoints FOR UPDATE USING (((org_id = public.current_org_id()) OR public.is_service_role())) WITH CHECK (((org_id = public.current_org_id()) OR public.is_service_role()));
ALTER TABLE public.whatsapp_account_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_account_links_delete ON public.whatsapp_account_links FOR DELETE USING (public.is_service_role());
CREATE POLICY whatsapp_account_links_insert ON public.whatsapp_account_links FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY whatsapp_account_links_select ON public.whatsapp_account_links FOR SELECT USING (((profile_id = public.current_user_id()) OR public.is_service_role()));
ALTER TABLE public.whatsapp_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_accounts_delete ON public.whatsapp_accounts FOR DELETE USING (((profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY whatsapp_accounts_insert ON public.whatsapp_accounts FOR INSERT WITH CHECK (((profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY whatsapp_accounts_select ON public.whatsapp_accounts FOR SELECT USING (((profile_id = public.current_user_id()) OR public.is_service_role()));
CREATE POLICY whatsapp_accounts_update ON public.whatsapp_accounts FOR UPDATE USING (((profile_id = public.current_user_id()) OR public.is_service_role())) WITH CHECK (((profile_id = public.current_user_id()) OR public.is_service_role()));
ALTER TABLE public.whatsapp_link_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_link_tokens_delete ON public.whatsapp_link_tokens FOR DELETE USING (public.is_service_role());
CREATE POLICY whatsapp_link_tokens_insert ON public.whatsapp_link_tokens FOR INSERT WITH CHECK (public.is_service_role());
CREATE POLICY whatsapp_link_tokens_select ON public.whatsapp_link_tokens FOR SELECT USING (public.is_service_role());
CREATE POLICY whatsapp_link_tokens_update ON public.whatsapp_link_tokens FOR UPDATE USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.whatsapp_phone_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_phone_numbers_service_role ON public.whatsapp_phone_numbers USING (public.is_service_role()) WITH CHECK (public.is_service_role());
ALTER TABLE public.whatsapp_routing ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_routing_all ON public.whatsapp_routing USING (public.is_service_role()) WITH CHECK (public.is_service_role());
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO marketplace_role;
GRANT ALL ON FUNCTION public._check_whatsapp_account_limit() TO service_role;
GRANT ALL ON FUNCTION public._sync_whatsapp_count() TO service_role;
GRANT ALL ON FUNCTION public.archive_old_audit_log(retain_days integer) TO service_role;
GRANT ALL ON FUNCTION public.auto_86_from_inventory() TO service_role;
GRANT ALL ON FUNCTION public.calculate_recipe_cost(item_uuid uuid) TO service_role;
GRANT ALL ON FUNCTION public.calculate_recipe_depth(item_uuid uuid) TO service_role;
GRANT ALL ON FUNCTION public.cancel_invitation(p_user_id uuid, p_invite_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.check_circular_dependency(parent_id uuid, child_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.check_invites(p_user_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.default_member_capabilities() TO service_role;
GRANT ALL ON FUNCTION public.get_item_components(item_uuid uuid, current_level integer) TO service_role;
GRANT ALL ON FUNCTION public.handle_new_organization() TO service_role;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;
GRANT ALL ON FUNCTION public.latest_exchange_rate(base text, quote text) TO service_role;
GRANT ALL ON FUNCTION public.list_organization_invitations(p_user_id uuid, p_organization_id uuid) TO service_role;
GRANT ALL ON FUNCTION public.lookup_location_by_slug(p_slug text) TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.driver_location_pings TO service_role;
GRANT SELECT ON TABLE public.driver_location_pings TO marketplace_role;
GRANT ALL ON FUNCTION public.pings_visible_to_customer(track_token text) TO service_role;
GRANT ALL ON FUNCTION public.queue_kds_fanout() TO service_role;
GRANT ALL ON FUNCTION public.refresh_reporting_views() TO service_role;
GRANT ALL ON FUNCTION public.respond_invitation(p_user_id uuid, p_invite_id uuid, p_accept boolean) TO service_role;
GRANT ALL ON FUNCTION public.send_invitation(p_user_id uuid, p_organization_id uuid, p_email text, p_role text) TO service_role;
GRANT ALL ON FUNCTION public.set_updated_at_now() TO service_role;
GRANT ALL ON FUNCTION public.trg_fn_course_fire_on_bump() TO service_role;
GRANT ALL ON FUNCTION public.trg_fn_item_default_station_routing() TO service_role;
GRANT ALL ON FUNCTION public.trg_fn_location_default_kitchen_station() TO service_role;
GRANT ALL ON FUNCTION public.trigger_update_recipe_metadata() TO service_role;
GRANT ALL ON FUNCTION public.update_recipe_metadata(item_uuid uuid) TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.adjustment_reasons TO service_role;
GRANT SELECT ON TABLE public.adjustment_reasons TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.allergens TO service_role;
GRANT SELECT ON TABLE public.allergens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.api_keys TO service_role;
GRANT SELECT ON TABLE public.api_keys TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.api_keys_safe TO service_role;
GRANT SELECT ON TABLE public.api_keys_safe TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.audit_log TO service_role;
GRANT SELECT ON TABLE public.audit_log TO marketplace_role;
GRANT SELECT,INSERT ON TABLE public.audit_log TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.audit_log_archived TO service_role;
GRANT SELECT ON TABLE public.audit_log_archived TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.auth_users TO service_role;
GRANT SELECT ON TABLE public.auth_users TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cart_item_variations TO service_role;
GRANT SELECT ON TABLE public.cart_item_variations TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cart_items TO service_role;
GRANT SELECT ON TABLE public.cart_items TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cash_drawer_counts TO service_role;
GRANT SELECT ON TABLE public.cash_drawer_counts TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cash_drawer_movements TO service_role;
GRANT SELECT ON TABLE public.cash_drawer_movements TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cash_drawer_session_payments TO service_role;
GRANT SELECT ON TABLE public.cash_drawer_session_payments TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cash_drawer_sessions TO service_role;
GRANT SELECT ON TABLE public.cash_drawer_sessions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.order_payments TO service_role;
GRANT SELECT ON TABLE public.order_payments TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.payment_methods TO service_role;
GRANT SELECT ON TABLE public.payment_methods TO marketplace_role;
GRANT SELECT ON TABLE public.payment_methods TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cash_drawer_eod_report TO service_role;
GRANT SELECT ON TABLE public.cash_drawer_eod_report TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.cash_drawers TO service_role;
GRANT SELECT ON TABLE public.cash_drawers TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.categories TO service_role;
GRANT SELECT ON TABLE public.categories TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.category_station_routing TO service_role;
GRANT SELECT ON TABLE public.category_station_routing TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.check_split_items TO service_role;
GRANT SELECT ON TABLE public.check_split_items TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.check_splits TO service_role;
GRANT SELECT ON TABLE public.check_splits TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.coupon_codes TO service_role;
GRANT SELECT ON TABLE public.coupon_codes TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.courses TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.currencies TO service_role;
GRANT SELECT ON TABLE public.currencies TO marketplace_role;
GRANT SELECT ON TABLE public.currencies TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.custom_domains TO service_role;
GRANT SELECT ON TABLE public.custom_domains TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customer_addresses TO service_role;
GRANT SELECT ON TABLE public.customer_addresses TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customer_favorite_items TO service_role;
GRANT SELECT ON TABLE public.customer_favorite_items TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customer_loyalty_stamps TO service_role;
GRANT SELECT ON TABLE public.customer_loyalty_stamps TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.customers TO service_role;
GRANT SELECT ON TABLE public.customers TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.items TO service_role;
GRANT SELECT ON TABLE public.items TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.order_adjustments TO service_role;
GRANT SELECT ON TABLE public.order_adjustments TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.order_items TO service_role;
GRANT SELECT ON TABLE public.order_items TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.orders TO service_role;
GRANT SELECT ON TABLE public.orders TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.daily_sales_summary TO service_role;
GRANT SELECT ON TABLE public.daily_sales_summary TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.data_export_jobs TO service_role;
GRANT SELECT ON TABLE public.data_export_jobs TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.delivery_zones TO service_role;
GRANT SELECT ON TABLE public.delivery_zones TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.dietary_tags TO service_role;
GRANT SELECT ON TABLE public.dietary_tags TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.driver_assignments TO service_role;
GRANT SELECT ON TABLE public.driver_assignments TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.driver_emergency_contacts TO service_role;
GRANT SELECT ON TABLE public.driver_emergency_contacts TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.driver_location_pings_default TO service_role;
GRANT SELECT ON TABLE public.driver_location_pings_default TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.driver_shifts TO service_role;
GRANT SELECT ON TABLE public.driver_shifts TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.elevation_tokens_used TO service_role;
GRANT SELECT ON TABLE public.elevation_tokens_used TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.email_providers TO service_role;
GRANT SELECT ON TABLE public.email_providers TO marketplace_role;
GRANT SELECT ON TABLE public.email_providers TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.email_verification_tokens TO service_role;
GRANT SELECT ON TABLE public.email_verification_tokens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.exchange_rates TO service_role;
GRANT SELECT ON TABLE public.exchange_rates TO marketplace_role;
GRANT SELECT ON TABLE public.exchange_rates TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.fiscal_sequences TO service_role;
GRANT SELECT ON TABLE public.fiscal_sequences TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.gift_card_transactions TO service_role;
GRANT SELECT ON TABLE public.gift_card_transactions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.gift_cards TO service_role;
GRANT SELECT ON TABLE public.gift_cards TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.goods_receipt_items TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.goods_receipts TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.hourly_sales_heatmap TO service_role;
GRANT SELECT ON TABLE public.hourly_sales_heatmap TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.house_account_charges TO service_role;
GRANT SELECT ON TABLE public.house_account_charges TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.house_account_invoices TO service_role;
GRANT SELECT ON TABLE public.house_account_invoices TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.house_account_members TO service_role;
GRANT SELECT ON TABLE public.house_account_members TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.house_accounts TO service_role;
GRANT SELECT ON TABLE public.house_accounts TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.idempotency_keys TO service_role;
GRANT SELECT ON TABLE public.idempotency_keys TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.ingredient_price_history TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.inventory_items TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.invoices TO service_role;
GRANT SELECT ON TABLE public.invoices TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_allergens TO service_role;
GRANT SELECT ON TABLE public.item_allergens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_dietary_tags TO service_role;
GRANT SELECT ON TABLE public.item_dietary_tags TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_menu_schedules TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_prep_steps TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_price_schedules TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_recipes TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.item_station_routing TO service_role;
GRANT SELECT ON TABLE public.item_station_routing TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.kds_display_groups TO service_role;
GRANT SELECT ON TABLE public.kds_display_groups TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.kds_ticket_items TO service_role;
GRANT SELECT ON TABLE public.kds_ticket_items TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.kds_tickets TO service_role;
GRANT SELECT ON TABLE public.kds_tickets TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.kitchen_stations TO service_role;
GRANT SELECT ON TABLE public.kitchen_stations TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.kds_expo_view TO service_role;
GRANT SELECT ON TABLE public.kds_expo_view TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.kds_fanout_queue TO service_role;
GRANT SELECT ON TABLE public.kds_fanout_queue TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.kds_ticket_events TO service_role;
GRANT SELECT ON TABLE public.kds_ticket_events TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.staff_time_entries TO service_role;
GRANT SELECT ON TABLE public.staff_time_entries TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.labor_hours_daily TO service_role;
GRANT SELECT ON TABLE public.labor_hours_daily TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.staff_pay_rates TO service_role;
GRANT SELECT ON TABLE public.staff_pay_rates TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.labor_cost_daily TO service_role;
GRANT SELECT ON TABLE public.labor_cost_daily TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.legal_acceptances TO service_role;
GRANT SELECT ON TABLE public.legal_acceptances TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.legal_documents TO service_role;
GRANT SELECT ON TABLE public.legal_documents TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.llm_messages TO service_role;
GRANT SELECT ON TABLE public.llm_messages TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.llm_model_pricing TO service_role;
GRANT SELECT ON TABLE public.llm_model_pricing TO marketplace_role;
GRANT SELECT ON TABLE public.llm_model_pricing TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.llm_tool_executions TO service_role;
GRANT SELECT ON TABLE public.llm_tool_executions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.location_email_credentials TO service_role;
GRANT SELECT ON TABLE public.location_email_credentials TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.location_printers TO service_role;
GRANT SELECT ON TABLE public.location_printers TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.locations TO service_role;
GRANT SELECT ON TABLE public.locations TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.loyalty_config TO service_role;
GRANT SELECT ON TABLE public.loyalty_config TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.loyalty_transactions TO service_role;
GRANT SELECT ON TABLE public.loyalty_transactions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.marketplace_reviews TO service_role;
GRANT SELECT ON TABLE public.marketplace_reviews TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.menu_engineering TO service_role;
GRANT SELECT ON TABLE public.menu_engineering TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.menu_schedule_slots TO service_role;
GRANT SELECT ON TABLE public.menu_schedule_slots TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.menu_schedules TO service_role;
GRANT SELECT ON TABLE public.menu_schedules TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.modifier_groups TO service_role;
GRANT SELECT ON TABLE public.modifier_groups TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.modifiers TO service_role;
GRANT SELECT ON TABLE public.modifiers TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.onboarding_progress TO service_role;
GRANT SELECT ON TABLE public.onboarding_progress TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.order_item_discounts TO service_role;
GRANT SELECT ON TABLE public.order_item_discounts TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.order_item_modifiers TO service_role;
GRANT SELECT ON TABLE public.order_item_modifiers TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.order_tracking_tokens TO service_role;
GRANT SELECT ON TABLE public.order_tracking_tokens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.organization_invites TO service_role;
GRANT SELECT ON TABLE public.organization_invites TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.organization_members TO service_role;
GRANT SELECT ON TABLE public.organization_members TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.organizations TO service_role;
GRANT SELECT ON TABLE public.organizations TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.password_reset_tokens TO service_role;
GRANT SELECT ON TABLE public.password_reset_tokens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.payroll_periods TO service_role;
GRANT SELECT ON TABLE public.payroll_periods TO marketplace_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.payroll_periods TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pii_access_log TO service_role;
GRANT SELECT ON TABLE public.pii_access_log TO marketplace_role;
GRANT INSERT ON TABLE public.pii_access_log TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.platform_admin_actions TO service_role;
GRANT SELECT ON TABLE public.platform_admin_actions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pos_shifts TO service_role;
GRANT SELECT ON TABLE public.pos_shifts TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.prep_batch_inputs TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.prep_batches TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.profiles TO service_role;
GRANT SELECT ON TABLE public.profiles TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.promotion_redemptions TO service_role;
GRANT SELECT ON TABLE public.promotion_redemptions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.promotion_target_categories TO service_role;
GRANT SELECT ON TABLE public.promotion_target_categories TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.promotion_target_items TO service_role;
GRANT SELECT ON TABLE public.promotion_target_items TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.promotions TO service_role;
GRANT SELECT ON TABLE public.promotions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.purchase_order_items TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.purchase_orders TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.receipt_documents TO service_role;
GRANT SELECT ON TABLE public.receipt_documents TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.recipe_breakdown TO service_role;
GRANT SELECT ON TABLE public.recipe_breakdown TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.recipe_cost_runs TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.refresh_tokens TO service_role;
GRANT SELECT ON TABLE public.refresh_tokens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.refunds TO service_role;
GRANT SELECT ON TABLE public.refunds TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.reservations TO service_role;
GRANT SELECT ON TABLE public.reservations TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.revenue_by_payment_method TO service_role;
GRANT SELECT ON TABLE public.revenue_by_payment_method TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.reviews TO service_role;
GRANT SELECT ON TABLE public.reviews TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.sales_per_labor_hour TO service_role;
GRANT SELECT ON TABLE public.sales_per_labor_hour TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.seats TO service_role;
GRANT SELECT ON TABLE public.seats TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.sections TO service_role;
GRANT SELECT ON TABLE public.sections TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.staff TO service_role;
GRANT SELECT ON TABLE public.staff TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.staff_attendance_summary TO service_role;
GRANT SELECT ON TABLE public.staff_attendance_summary TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.staff_password_reset_tokens TO service_role;
GRANT SELECT ON TABLE public.staff_password_reset_tokens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.staff_refresh_tokens TO service_role;
GRANT SELECT ON TABLE public.staff_refresh_tokens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.staff_shifts TO service_role;
GRANT SELECT ON TABLE public.staff_shifts TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.stock_movements TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.store_credit_transactions TO service_role;
GRANT SELECT ON TABLE public.store_credit_transactions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.store_credits TO service_role;
GRANT SELECT ON TABLE public.store_credits TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.supplier_contacts TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.supplier_inventory_items TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.supplier_invoice_lines TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.supplier_invoices TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.supplier_locations TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.suppliers TO service_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.table_sessions TO service_role;
GRANT SELECT ON TABLE public.table_sessions TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.tables TO service_role;
GRANT SELECT ON TABLE public.tables TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.tax_profiles TO service_role;
GRANT SELECT ON TABLE public.tax_profiles TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.tax_rates TO service_role;
GRANT SELECT ON TABLE public.tax_rates TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.theoretical_vs_actual_cogs TO service_role;
GRANT SELECT ON TABLE public.theoretical_vs_actual_cogs TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.tip_distributions TO service_role;
GRANT SELECT ON TABLE public.tip_distributions TO marketplace_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.tip_distributions TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.tip_pool_contributions TO service_role;
GRANT SELECT ON TABLE public.tip_pool_contributions TO marketplace_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.tip_pool_contributions TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.tip_pools TO service_role;
GRANT SELECT ON TABLE public.tip_pools TO marketplace_role;
GRANT SELECT,INSERT,UPDATE ON TABLE public.tip_pools TO PUBLIC;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.user_backup_codes TO service_role;
GRANT SELECT ON TABLE public.user_backup_codes TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.user_preferences TO service_role;
GRANT SELECT ON TABLE public.user_preferences TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.waitlist TO service_role;
GRANT SELECT ON TABLE public.waitlist TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.webhook_deliveries TO service_role;
GRANT SELECT ON TABLE public.webhook_deliveries TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.webhook_endpoints TO service_role;
GRANT SELECT ON TABLE public.webhook_endpoints TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.whatsapp_account_links TO service_role;
GRANT SELECT ON TABLE public.whatsapp_account_links TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.whatsapp_accounts TO service_role;
GRANT SELECT ON TABLE public.whatsapp_accounts TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.whatsapp_link_tokens TO service_role;
GRANT SELECT ON TABLE public.whatsapp_link_tokens TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.whatsapp_phone_numbers TO service_role;
GRANT SELECT ON TABLE public.whatsapp_phone_numbers TO marketplace_role;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.whatsapp_routing TO service_role;
GRANT SELECT ON TABLE public.whatsapp_routing TO marketplace_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO marketplace_role;

-- ============================================================================
-- Reference-data seeds (restored 2026-07-23): the migration fold was schema-
-- only, so these rows — loaded by the pre-fold chain (migrations 014/024/056)
-- into FK-target reference tables — were dropped from the baseline. A fresh DB
-- needs them: orders.currency_code, locations payment methods, and email
-- provider config all FK/relate to these. Statements are verbatim from the
-- original migrations (idempotent, ON CONFLICT-guarded).
-- ============================================================================

-- currencies (014: base set)
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

-- currencies (056: extended ISO set)
INSERT INTO currencies (code, name, symbol, decimal_digits, is_active) VALUES
    ('JPY', 'Japanese Yen',            '¥',   0, true),
    ('KRW', 'South Korean Won',        '₩',   0, true),
    ('ISK', 'Icelandic Króna',         'kr',  0, true),
    ('CLP', 'Chilean Peso',            '$',   0, true),
    ('VND', 'Vietnamese Dong',         '₫',   0, true),
    ('UGX', 'Ugandan Shilling',        'USh', 0, true),
    ('RWF', 'Rwandan Franc',           'FRw', 0, true),
    ('XOF', 'West African CFA Franc',  'CFA', 0, true),
    ('XAF', 'Central African CFA Franc','FCFA',0, true),
    ('KWD', 'Kuwaiti Dinar',           'د.ك', 3, true),
    ('BHD', 'Bahraini Dinar',          '.د.ب',3, true),
    ('OMR', 'Omani Rial',              'ر.ع.',3, true),
    ('JOD', 'Jordanian Dinar',         'د.ا', 3, true),
    ('TND', 'Tunisian Dinar',          'د.ت', 3, true),
    ('AUD', 'Australian Dollar',       '$',   2, true),
    ('CAD', 'Canadian Dollar',         '$',   2, true),
    ('NZD', 'New Zealand Dollar',      '$',   2, true),
    ('CHF', 'Swiss Franc',             'CHF', 2, true),
    ('SEK', 'Swedish Krona',           'kr',  2, true),
    ('NOK', 'Norwegian Krone',         'kr',  2, true),
    ('DKK', 'Danish Krone',            'kr',  2, true),
    ('PLN', 'Polish Złoty',            'zł',  2, true),
    ('CZK', 'Czech Koruna',            'Kč',  2, true),
    ('BRL', 'Brazilian Real',          'R$',  2, true),
    ('MXN', 'Mexican Peso',            '$',   2, true),
    ('ARS', 'Argentine Peso',          '$',   2, true),
    ('SGD', 'Singapore Dollar',        '$',   2, true),
    ('HKD', 'Hong Kong Dollar',        'HK$', 2, true),
    ('MYR', 'Malaysian Ringgit',       'RM',  2, true),
    ('THB', 'Thai Baht',               '฿',   2, true),
    ('IDR', 'Indonesian Rupiah',       'Rp',  2, true),
    ('PHP', 'Philippine Peso',         '₱',   2, true),
    ('AED', 'UAE Dirham',              'د.إ', 2, true),
    ('SAR', 'Saudi Riyal',             'ر.س', 2, true),
    ('ILS', 'Israeli New Shekel',      '₪',   2, true),
    ('TRY', 'Turkish Lira',            '₺',   2, true),
    ('EGP', 'Egyptian Pound',          'E£',  2, true),
    ('MAD', 'Moroccan Dirham',         'د.م.',2, true),
    ('TZS', 'Tanzanian Shilling',      'TSh', 2, true),
    ('ZMW', 'Zambian Kwacha',          'ZK',  2, true),
    ('BWP', 'Botswana Pula',           'P',   2, true),
    ('NAD', 'Namibian Dollar',         '$',   2, true),
    ('MUR', 'Mauritian Rupee',         '₨',   2, true),
    ('PKR', 'Pakistani Rupee',         '₨',   2, true),
    ('BDT', 'Bangladeshi Taka',        '৳',   2, true),
    ('LKR', 'Sri Lankan Rupee',        'Rs',  2, true),
    ('CNY', 'Chinese Yuan',            '¥',   2, true),
    ('RUB', 'Russian Ruble',           '₽',   2, true),
    ('UAH', 'Ukrainian Hryvnia',       '₴',   2, true),
    ('RON', 'Romanian Leu',            'lei', 2, true),
    ('HUF', 'Hungarian Forint',        'Ft',  2, true),
    ('COP', 'Colombian Peso',          '$',   2, true),
    ('PEN', 'Peruvian Sol',            'S/',  2, true)
ON CONFLICT (code) DO NOTHING;

-- payment_methods (014)
INSERT INTO payment_methods (code, name, kind, is_active, requires_reference, supports_tips)
VALUES
    ('cash',             'Cash',              'offline', true, false, true),
    ('card_in_person',   'Card Machine',      'offline', true, true,  true),
    ('eft',              'Bank Transfer',     'offline', true, true,  false),
    ('gift_card',        'Gift Card',         'offline', true, false, false),
    ('house_account',    'House Account',     'offline', true, false, true),
    ('store_credit',     'Store Credit',      'offline', true, false, false),
    ('cash_on_delivery', 'Cash on Delivery',  'offline', true, false, true),
    ('card_on_delivery', 'Card on Delivery',  'offline', true, true,  true)
ON CONFLICT (code) DO UPDATE
    SET name               = EXCLUDED.name,
        kind               = EXCLUDED.kind,
        is_active          = EXCLUDED.is_active,
        requires_reference = EXCLUDED.requires_reference,
        supports_tips      = EXCLUDED.supports_tips;

-- email_providers (024)
INSERT INTO email_providers (code, name, is_active) VALUES
    ('sendgrid',  'SendGrid',                true),
    ('mailgun',   'Mailgun',                 true),
    ('ses',       'Amazon SES',              true),
    ('smtp',      'Generic SMTP',            true)
ON CONFLICT (code) DO NOTHING;

