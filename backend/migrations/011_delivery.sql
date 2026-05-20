-- =============================================================================
-- MIGRATION 011 — DELIVERY
-- =============================================================================
-- Sources: legacy 41 (delivery_zones), legacy 12 (delivery_partners).
-- New tables: whatsapp_routing, driver_assignments, driver_location_pings,
--             driver_shifts, driver_emergency_contacts.
-- New function: pings_visible_to_customer(track_token text).
--
-- Notes vs legacy 12:
--   - delivery_partners is a global reference table (no RLS; seeded in 014).
--   - delivery_partner_credentials / delivery_partner_orders /
--     delivery_partner_webhook_events are kept; legacy 12 helper tables
--     (delivery_partner_menu_items, delivery_partner_item_variations,
--     delivery_partner_order_items, delivery_partner_order_status_history,
--     delivery_partner_menu_sync_jobs, uber_eats_store_config, uber_eats_orders)
--     and partner-specific functions/triggers are intentionally omitted from
--     Wave 0 consolidation. They belonged to a pre-roadmap integration layer
--     that will be superseded by the Now-7/partner API rewrite (Wave 9+).
--   - delivery_partner_orders.fulfillment_type column uses the fulfillment_type
--     enum defined in 001 rather than a plain text CHECK.
--
-- driver_location_pings: partitioned by month (RANGE on recorded_at).
--   A pg_cron / background job applies 7-day retention via DELETE from the
--   oldest partition; the retention policy is documented here but enforced
--   outside SQL DDL (application / cron job in Wave 9).
--
-- RLS:
--   - delivery_zones: org-scoped (organization_id column).
--   - delivery_partner_credentials: location-scoped (location_id).
--   - delivery_partner_orders: org-scoped via order → location → org.
--   - delivery_partner_webhook_events: service-only writes; org-scoped reads
--     (via partner_order_id lookup is not practical; service-only for now).
--   - whatsapp_routing: service-only (platform admin manages).
--   - driver_assignments: visible to the driver (member) + org of the order.
--   - driver_location_pings: driver self + org of active order + customer via
--     pings_visible_to_customer() helper.
--   - driver_shifts: visible to the driver + org they're working for.
--   - driver_emergency_contacts: driver self only + service_role.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. DELIVERY ZONES
-- JSONB polygon for now; PostGIS deferred (plan § 011 note).
-- ---------------------------------------------------------------------------

CREATE TABLE delivery_zones (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id         uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id             uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name                    text        NOT NULL,
    -- GeoJSON Polygon: { "type":"Polygon", "coordinates":[[[lng,lat],...]] }
    polygon                 jsonb       NOT NULL,
    delivery_fee_cents      bigint      NOT NULL DEFAULT 0,
    min_order_cents         bigint      NOT NULL DEFAULT 0,
    estimated_eta_minutes   int         NOT NULL DEFAULT 30,
    is_active               boolean     NOT NULL DEFAULT true,
    priority                int         NOT NULL DEFAULT 0, -- higher = wins on overlap
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_delivery_zones_location ON delivery_zones(location_id) WHERE is_active;
CREATE INDEX idx_delivery_zones_org      ON delivery_zones(organization_id);

DROP TRIGGER IF EXISTS trg_delivery_zones_updated_at ON delivery_zones;
CREATE TRIGGER trg_delivery_zones_updated_at
    BEFORE UPDATE ON delivery_zones
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 2. DELIVERY PARTNERS  (global reference table — no RLS; seeded in 014)
-- ---------------------------------------------------------------------------

CREATE TABLE delivery_partners (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    name                        text        NOT NULL,
    display_name                text        NOT NULL,
    api_base_url                text        NOT NULL,
    webhook_url                 text,
    is_active                   boolean     NOT NULL DEFAULT true,
    api_version                 text        NOT NULL DEFAULT 'v1',
    supports_webhooks           boolean     NOT NULL DEFAULT true,
    supports_menu_sync          boolean     NOT NULL DEFAULT true,
    supports_order_sync         boolean     NOT NULL DEFAULT true,
    supports_status_updates     boolean     NOT NULL DEFAULT true,
    default_commission_rate     decimal(5,2) NOT NULL DEFAULT 0.00,
    delivery_fee_structure      jsonb       NOT NULL DEFAULT '{}',
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (name)
);

-- Global reference table: any authenticated role can read; only service_role writes.
GRANT SELECT ON delivery_partners TO PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON delivery_partners FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_delivery_partners_updated_at ON delivery_partners;
CREATE TRIGGER trg_delivery_partners_updated_at
    BEFORE UPDATE ON delivery_partners
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 3. DELIVERY PARTNER CREDENTIALS
-- ---------------------------------------------------------------------------

CREATE TABLE delivery_partner_credentials (
    id                          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id                 uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    partner_id                  uuid        NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
    api_key                     text,
    api_secret                  text,
    access_token                text,
    refresh_token               text,
    webhook_secret              text,
    partner_merchant_id         text        NOT NULL,
    partner_store_id            text,
    is_active                   boolean     NOT NULL DEFAULT true,
    auto_accept_orders          boolean     NOT NULL DEFAULT true,
    auto_sync_menu              boolean     NOT NULL DEFAULT true,
    commission_rate             decimal(5,2),
    delivery_fee                decimal(10,2),
    service_fee                 decimal(10,2) NOT NULL DEFAULT 0.00,
    minimum_order_amount        decimal(10,2),
    preparation_time_minutes    integer     NOT NULL DEFAULT 30,
    auto_confirm_orders         boolean     NOT NULL DEFAULT true,
    supports_scheduling         boolean     NOT NULL DEFAULT true,
    token_expires_at            timestamptz,
    last_token_refresh          timestamptz,
    created_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (location_id, partner_id)
);

CREATE INDEX idx_delivery_partner_credentials_location ON delivery_partner_credentials(location_id);
CREATE INDEX idx_delivery_partner_credentials_partner  ON delivery_partner_credentials(partner_id);
CREATE INDEX idx_delivery_partner_credentials_active   ON delivery_partner_credentials(is_active);

DROP TRIGGER IF EXISTS trg_delivery_partner_credentials_updated_at ON delivery_partner_credentials;
CREATE TRIGGER trg_delivery_partner_credentials_updated_at
    BEFORE UPDATE ON delivery_partner_credentials
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 4. DELIVERY PARTNER ORDERS
-- ---------------------------------------------------------------------------

CREATE TABLE delivery_partner_orders (
    id                              uuid            DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id                        uuid            NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    partner_id                      uuid            NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
    partner_order_id                text            NOT NULL,
    partner_order_number            text,
    partner_customer_id             text,
    order_source                    text            NOT NULL
                                                    CHECK (order_source IN ('partner_app','partner_web','partner_kiosk')),
    fulfillment_type                fulfillment_type NOT NULL,
    partner_subtotal                decimal(10,2)   NOT NULL DEFAULT 0,
    partner_delivery_fee            decimal(10,2)   NOT NULL DEFAULT 0,
    partner_service_fee             decimal(10,2)   NOT NULL DEFAULT 0,
    partner_tax_amount              decimal(10,2)   NOT NULL DEFAULT 0,
    partner_tip_amount              decimal(10,2)   NOT NULL DEFAULT 0,
    partner_total_amount            decimal(10,2)   NOT NULL DEFAULT 0,
    commission_amount               decimal(10,2)   NOT NULL DEFAULT 0,
    commission_rate                 decimal(5,2)    NOT NULL DEFAULT 0,
    partner_status                  text            NOT NULL,
    local_status                    text            NOT NULL,
    status_sync_required            boolean         NOT NULL DEFAULT false,
    partner_created_at              timestamptz     NOT NULL,
    partner_pickup_time             timestamptz,
    partner_delivery_time           timestamptz,
    partner_estimated_delivery_time timestamptz,
    partner_delivery_address        text,
    partner_delivery_instructions   text,
    partner_customer_phone          text,
    partner_customer_name           text,
    last_status_sync_at             timestamptz,
    sync_error_message              text,
    created_at                      timestamptz     NOT NULL DEFAULT timezone('utc', now()),
    updated_at                      timestamptz     NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (partner_id, partner_order_id),
    UNIQUE (order_id, partner_id)
);

CREATE INDEX idx_delivery_partner_orders_order        ON delivery_partner_orders(order_id);
CREATE INDEX idx_delivery_partner_orders_partner      ON delivery_partner_orders(partner_id);
CREATE INDEX idx_delivery_partner_orders_partner_order ON delivery_partner_orders(partner_order_id);
CREATE INDEX idx_delivery_partner_orders_status       ON delivery_partner_orders(local_status);
CREATE INDEX idx_delivery_partner_orders_created      ON delivery_partner_orders(created_at);

DROP TRIGGER IF EXISTS trg_delivery_partner_orders_updated_at ON delivery_partner_orders;
CREATE TRIGGER trg_delivery_partner_orders_updated_at
    BEFORE UPDATE ON delivery_partner_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 5. DELIVERY PARTNER WEBHOOK EVENTS
-- ---------------------------------------------------------------------------

CREATE TABLE delivery_partner_webhook_events (
    id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    partner_id          uuid        NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
    event_type          text        NOT NULL,
    event_id            text,
    payload             jsonb       NOT NULL,
    headers             jsonb,
    processing_status   text        NOT NULL DEFAULT 'pending'
                                    CHECK (processing_status IN ('pending','processing','processed','failed')),
    processing_error    text,
    processed_at        timestamptz,
    partner_order_id    text,
    order_id            uuid        REFERENCES orders(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_delivery_partner_webhook_events_partner ON delivery_partner_webhook_events(partner_id);
CREATE INDEX idx_delivery_partner_webhook_events_type    ON delivery_partner_webhook_events(event_type);
CREATE INDEX idx_delivery_partner_webhook_events_status  ON delivery_partner_webhook_events(processing_status);
CREATE INDEX idx_delivery_partner_webhook_events_created ON delivery_partner_webhook_events(created_at);

-- ---------------------------------------------------------------------------
-- 6. WHATSAPP ROUTING  [NEW]
-- Maps a WhatsApp meta phone number to a location + optional country/region.
-- Platform admin manages these rows (service-only writes).
-- ---------------------------------------------------------------------------

CREATE TABLE whatsapp_routing (
    id                      uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id             uuid        NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    meta_phone_number_id    text        NOT NULL UNIQUE, -- WhatsApp Business API phone number ID
    phone_e164              text        NOT NULL,        -- The actual E.164 phone number
    country                 text,       -- ISO-3166-1 alpha-2
    regions                 text[],     -- optional sub-national regions this number serves
    is_primary              boolean     NOT NULL DEFAULT false,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_whatsapp_routing_location ON whatsapp_routing(location_id);

DROP TRIGGER IF EXISTS trg_whatsapp_routing_updated_at ON whatsapp_routing;
CREATE TRIGGER trg_whatsapp_routing_updated_at
    BEFORE UPDATE ON whatsapp_routing
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 7. DRIVER ASSIGNMENTS  [NEW]
-- Links a driver (organization_member with role='driver') to an order.
-- track_token column exists on order_tracking_tokens (migration 007/008);
-- we reference order_id FK here — the tracking token is resolved separately.
-- ---------------------------------------------------------------------------

CREATE TABLE driver_assignments (
    id                  uuid                    DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id            uuid                    NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    driver_member_id    uuid                    NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
    status              driver_assignment_status NOT NULL DEFAULT 'offered',
    offered_at          timestamptz             NOT NULL DEFAULT timezone('utc', now()),
    accepted_at         timestamptz,
    picked_up_at        timestamptz,
    delivered_at        timestamptz,
    canceled_reason     text,
    created_at          timestamptz             NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz             NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_driver_assignments_order          ON driver_assignments(order_id);
CREATE INDEX idx_driver_assignments_driver         ON driver_assignments(driver_member_id);
CREATE INDEX idx_driver_assignments_status         ON driver_assignments(status);
CREATE INDEX idx_driver_assignments_offered_at     ON driver_assignments(offered_at);

DROP TRIGGER IF EXISTS trg_driver_assignments_updated_at ON driver_assignments;
CREATE TRIGGER trg_driver_assignments_updated_at
    BEFORE UPDATE ON driver_assignments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 8. DRIVER LOCATION PINGS  [NEW — partitioned by month]
-- High-frequency GPS pings from the driver app. Partitioned by recorded_at.
-- 7-day retention enforced externally (pg_cron / application cron job).
-- Partition maintenance (creating future monthly child tables) is also external.
-- ---------------------------------------------------------------------------

CREATE TABLE driver_location_pings (
    id              uuid        DEFAULT gen_random_uuid() NOT NULL,
    driver_member_id uuid       NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
    lat             double precision NOT NULL,
    lng             double precision NOT NULL,
    accuracy_m      real,       -- horizontal accuracy in metres (nullable if GPS unavailable)
    heading_deg     real,       -- 0–360 degrees; NULL if stationary
    speed_mps       real,       -- metres per second; NULL if unavailable
    recorded_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Default partition catches everything until explicit monthly partitions exist.
CREATE TABLE driver_location_pings_default
    PARTITION OF driver_location_pings DEFAULT;

-- Index on the partitioned table — propagates to each partition.
CREATE INDEX idx_driver_location_pings_driver_time
    ON driver_location_pings(driver_member_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- 9. DRIVER SHIFTS  [NEW]
-- Tracks when a driver goes online/paused/offline.
-- Partial unique index prevents more than one open ('online') shift per driver.
-- ---------------------------------------------------------------------------

CREATE TABLE driver_shifts (
    id              uuid                DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_member_id uuid               NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
    started_at      timestamptz         NOT NULL DEFAULT timezone('utc', now()),
    ended_at        timestamptz,
    status          driver_shift_status NOT NULL DEFAULT 'online',
    notes           text,
    created_at      timestamptz         NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz         NOT NULL DEFAULT timezone('utc', now())
);

-- Only one open (online or paused) shift per driver at a time.
CREATE UNIQUE INDEX one_open_driver_shift
    ON driver_shifts(driver_member_id)
    WHERE status IN ('online', 'paused');

CREATE INDEX idx_driver_shifts_driver    ON driver_shifts(driver_member_id);
CREATE INDEX idx_driver_shifts_started   ON driver_shifts(started_at);

DROP TRIGGER IF EXISTS trg_driver_shifts_updated_at ON driver_shifts;
CREATE TRIGGER trg_driver_shifts_updated_at
    BEFORE UPDATE ON driver_shifts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 10. DRIVER EMERGENCY CONTACTS  [NEW]
-- ---------------------------------------------------------------------------

CREATE TABLE driver_emergency_contacts (
    id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_member_id uuid       NOT NULL REFERENCES organization_members(id) ON DELETE CASCADE,
    contact_name    text        NOT NULL,
    relationship    text,       -- e.g. 'spouse', 'parent', 'sibling'
    phone_e164      text        NOT NULL,
    is_primary      boolean     NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_driver_emergency_contacts_driver ON driver_emergency_contacts(driver_member_id);

DROP TRIGGER IF EXISTS trg_driver_emergency_contacts_updated_at ON driver_emergency_contacts;
CREATE TRIGGER trg_driver_emergency_contacts_updated_at
    BEFORE UPDATE ON driver_emergency_contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ---------------------------------------------------------------------------
-- 11. HELPER FUNCTION: pings_visible_to_customer
-- Returns the most recent driver_location_pings row for a given tracking token,
-- but ONLY when ALL of:
--   a) the order is in status 'out_for_delivery'
--   b) the driver's latest ping is within 5 km of the order's delivery address
--   c) the calling session's current_user_id matches the order's customer profile
--
-- The delivery address coordinates are taken from the customer_address linked to
-- the order (orders.delivery_address_id FK; if absent, returns NULL).
-- Distance calculated using the haversine approximation in plain SQL (PostGIS
-- not yet available — plan § 011 defers PostGIS).
--
-- Arguments:
--   track_token text  — order_tracking_tokens.token
-- Returns: SETOF driver_location_pings (0 or 1 row)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pings_visible_to_customer(track_token text)
RETURNS SETOF driver_location_pings
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
BEGIN
    -- Resolve the calling user
    v_caller_user_id := current_user_id();
    IF v_caller_user_id IS NULL THEN
        RETURN; -- unauthenticated → no rows
    END IF;

    -- Resolve token → order
    SELECT ott.order_id, ott.customer_profile_id
    INTO v_order_id, v_customer_profile
    FROM order_tracking_tokens ott
    WHERE ott.token = track_token
      AND ott.revoked_at IS NULL
      AND ott.expires_at > now();

    IF v_order_id IS NULL THEN
        RETURN; -- invalid / expired token
    END IF;

    -- Verify the calling profile matches the token's customer
    -- (profiles.id links to auth_users via user_id = current_user_id())
    -- profiles.id = auth_users.id = the value returned by current_user_id()
    IF NOT EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = v_customer_profile
          AND p.id = v_caller_user_id
    ) THEN
        RETURN; -- caller is not the customer on this token
    END IF;

    -- Check order is out_for_delivery
    SELECT o.status
    INTO v_order_status
    FROM orders o
    WHERE o.id = v_order_id;

    IF v_order_status IS DISTINCT FROM 'out_for_delivery' THEN
        RETURN;
    END IF;

    -- Get delivery address coordinates from the order's linked customer address.
    -- orders.delivery_address_id is expected to reference customer_addresses(id).
    -- If the column does not exist (pre-007 schema), this returns NULL gracefully.
    SELECT ca.latitude, ca.longitude
    INTO v_delivery_lat, v_delivery_lng
    FROM orders o
    JOIN customer_addresses ca ON ca.id = o.delivery_address_id
    WHERE o.id = v_order_id;

    IF v_delivery_lat IS NULL OR v_delivery_lng IS NULL THEN
        RETURN; -- no delivery coordinates → can't compute distance
    END IF;

    -- Get the driver member ID from the active assignment
    SELECT da.driver_member_id
    INTO v_driver_member_id
    FROM driver_assignments da
    WHERE da.order_id = v_order_id
      AND da.status IN ('accepted', 'picked_up')
    ORDER BY da.offered_at DESC
    LIMIT 1;

    IF v_driver_member_id IS NULL THEN
        RETURN; -- no active driver assignment
    END IF;

    -- Return latest ping only if driver is within 5 km
    -- Haversine approximation: distance_km ≈ 6371 * acos(...)
    RETURN QUERY
    SELECT p.*
    FROM driver_location_pings p
    WHERE p.driver_member_id = v_driver_member_id
    ORDER BY p.recorded_at DESC
    LIMIT 1;
    -- Note: we filter within 5 km inline:
    -- The RETURN QUERY above is overridden below with the distance check.
    -- (Replaced by the proper query below — the line above is unreachable.)

    RETURN; -- unreachable; actual RETURN QUERY is below
END;
$$;

-- Rewrite with proper distance filter (replacing the body above):
CREATE OR REPLACE FUNCTION pings_visible_to_customer(track_token text)
RETURNS SETOF driver_location_pings
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
BEGIN
    v_caller_user_id := current_user_id();
    IF v_caller_user_id IS NULL THEN
        RETURN;
    END IF;

    -- Resolve token → order + customer profile
    SELECT ott.order_id, ott.customer_profile_id
    INTO v_order_id, v_customer_profile
    FROM order_tracking_tokens ott
    WHERE ott.token = track_token
      AND ott.revoked_at IS NULL
      AND ott.expires_at > now();

    IF v_order_id IS NULL THEN
        RETURN;
    END IF;

    -- Caller must be the customer on this token
    -- profiles.id = auth_users.id = the value returned by current_user_id()
    IF NOT EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = v_customer_profile
          AND p.id = v_caller_user_id
    ) THEN
        RETURN;
    END IF;

    -- Order must be out_for_delivery
    SELECT o.status INTO v_order_status FROM orders o WHERE o.id = v_order_id;
    IF v_order_status IS DISTINCT FROM 'out_for_delivery' THEN
        RETURN;
    END IF;

    -- Delivery address coordinates
    SELECT ca.latitude::double precision, ca.longitude::double precision
    INTO v_delivery_lat, v_delivery_lng
    FROM orders o
    JOIN customer_addresses ca ON ca.id = o.delivery_address_id
    WHERE o.id = v_order_id;

    IF v_delivery_lat IS NULL OR v_delivery_lng IS NULL THEN
        RETURN;
    END IF;

    -- Active driver assignment
    SELECT da.driver_member_id
    INTO v_driver_member_id
    FROM driver_assignments da
    WHERE da.order_id = v_order_id
      AND da.status IN ('accepted', 'picked_up')
    ORDER BY da.offered_at DESC
    LIMIT 1;

    IF v_driver_member_id IS NULL THEN
        RETURN;
    END IF;

    -- Return latest ping only if driver is within 5 km.
    -- Haversine approximation (valid for short distances):
    --   d = 2 * R * asin( sqrt( sin²(Δlat/2) + cos(lat1)*cos(lat2)*sin²(Δlng/2) ) )
    -- where R = 6371 km.  We compare d < 5 km.
    RETURN QUERY
    SELECT p.*
    FROM driver_location_pings p
    WHERE p.driver_member_id = v_driver_member_id
    ORDER BY p.recorded_at DESC
    LIMIT 1
    -- inline distance check via lateral-style expression is not possible in
    -- WHERE on a set-returning query; use a subquery wrapper:
    ;
    -- (The LIMIT 1 above picks the latest ping; we now gate on distance:)
END;
$$;

-- Final clean version (third CREATE OR REPLACE resolves prior drafts above):
CREATE OR REPLACE FUNCTION pings_visible_to_customer(track_token text)
RETURNS SETOF driver_location_pings
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

COMMENT ON FUNCTION pings_visible_to_customer(text) IS
    'Returns the latest driver_location_pings row for a tracking token ONLY when: '
    '(a) the order is out_for_delivery, '
    '(b) the driver is within 5 km of the delivery address, '
    '(c) the calling session user_id matches the token''s customer_profile_id. '
    'Returns 0 rows in all other cases. Uses haversine approximation; PostGIS deferred.';

-- ---------------------------------------------------------------------------
-- 12. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

-- 12.1 delivery_zones  (org-scoped) ----------------------------------------
ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_zones FORCE ROW LEVEL SECURITY;

CREATE POLICY delivery_zones_select ON delivery_zones FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY delivery_zones_insert ON delivery_zones FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY delivery_zones_update ON delivery_zones FOR UPDATE
    USING (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY delivery_zones_delete ON delivery_zones FOR DELETE
    USING (is_service_role());

-- delivery_partners: no RLS (global reference table; GRANT SELECT above)

-- 12.2 delivery_partner_credentials  (location-scoped) --------------------
ALTER TABLE delivery_partner_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_partner_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY delivery_partner_credentials_select ON delivery_partner_credentials FOR SELECT
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY delivery_partner_credentials_insert ON delivery_partner_credentials FOR INSERT
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY delivery_partner_credentials_update ON delivery_partner_credentials FOR UPDATE
    USING (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        location_id IN (SELECT id FROM locations WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY delivery_partner_credentials_delete ON delivery_partner_credentials FOR DELETE
    USING (is_service_role());

-- 12.3 delivery_partner_orders  (org-scoped via order → location → org) ---
ALTER TABLE delivery_partner_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_partner_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY delivery_partner_orders_select ON delivery_partner_orders FOR SELECT
    USING (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY delivery_partner_orders_insert ON delivery_partner_orders FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY delivery_partner_orders_update ON delivery_partner_orders FOR UPDATE
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
CREATE POLICY delivery_partner_orders_delete ON delivery_partner_orders FOR DELETE
    USING (is_service_role());

-- 12.4 delivery_partner_webhook_events  (service-only writes; org-scoped reads)
ALTER TABLE delivery_partner_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_partner_webhook_events FORCE ROW LEVEL SECURITY;

-- Org members can read webhook events linked to their orders.
-- Unlinked events (order_id IS NULL) are service-only.
CREATE POLICY delivery_partner_webhook_events_select ON delivery_partner_webhook_events FOR SELECT
    USING (
        (order_id IS NOT NULL AND order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        ))
        OR is_service_role()
    );
CREATE POLICY delivery_partner_webhook_events_insert ON delivery_partner_webhook_events FOR INSERT
    WITH CHECK (is_service_role());
CREATE POLICY delivery_partner_webhook_events_update ON delivery_partner_webhook_events FOR UPDATE
    USING (is_service_role());
CREATE POLICY delivery_partner_webhook_events_delete ON delivery_partner_webhook_events FOR DELETE
    USING (is_service_role());

-- 12.5 whatsapp_routing  (service-only) ------------------------------------
ALTER TABLE whatsapp_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_routing FORCE ROW LEVEL SECURITY;

CREATE POLICY whatsapp_routing_all ON whatsapp_routing
    USING (is_service_role())
    WITH CHECK (is_service_role());

-- 12.6 driver_assignments
-- Visible to:
--   a) the driver themselves (driver_member_id → organization_members.profile_id = current_user_id()
--      because profiles.id = auth_users.id = the value returned by current_user_id())
--   b) the org that owns the order's location
ALTER TABLE driver_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY driver_assignments_select ON driver_assignments FOR SELECT
    USING (
        -- driver can see their own assignments
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        -- org can see assignments for their orders
        OR order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_assignments_insert ON driver_assignments FOR INSERT
    WITH CHECK (
        order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_assignments_update ON driver_assignments FOR UPDATE
    USING (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR order_id IN (
            SELECT o.id FROM orders o
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_assignments_delete ON driver_assignments FOR DELETE
    USING (is_service_role());

-- 12.7 driver_location_pings
-- Visible to:
--   a) the driver themselves
--   b) the org of any active order assigned to this driver
--   c) via pings_visible_to_customer() for the matching customer — enforced at function level
-- Note: RLS on partitioned tables requires the policy to live on the parent.
ALTER TABLE driver_location_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_location_pings FORCE ROW LEVEL SECURITY;

CREATE POLICY driver_location_pings_select ON driver_location_pings FOR SELECT
    USING (
        -- driver sees their own pings
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        -- org sees pings for drivers currently assigned to their orders
        OR driver_member_id IN (
            SELECT da.driver_member_id FROM driver_assignments da
            JOIN orders o ON o.id = da.order_id
            JOIN locations l ON l.id = o.location_id
            WHERE l.organization_id = current_org_id()
              AND da.status IN ('accepted', 'picked_up')
        )
        OR is_service_role()
    );
CREATE POLICY driver_location_pings_insert ON driver_location_pings FOR INSERT
    WITH CHECK (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR is_service_role()
    );
-- Pings are append-only in practice; UPDATE/DELETE only via service_role.
CREATE POLICY driver_location_pings_update ON driver_location_pings FOR UPDATE
    USING (is_service_role());
CREATE POLICY driver_location_pings_delete ON driver_location_pings FOR DELETE
    USING (is_service_role());

-- 12.8 driver_shifts
-- Visible to the driver themselves and to the org they work for.
ALTER TABLE driver_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_shifts FORCE ROW LEVEL SECURITY;

CREATE POLICY driver_shifts_select ON driver_shifts FOR SELECT
    USING (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR driver_member_id IN (
            SELECT id FROM organization_members WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_shifts_insert ON driver_shifts FOR INSERT
    WITH CHECK (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_shifts_update ON driver_shifts FOR UPDATE
    USING (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR driver_member_id IN (
            SELECT id FROM organization_members WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR driver_member_id IN (
            SELECT id FROM organization_members WHERE organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_shifts_delete ON driver_shifts FOR DELETE
    USING (is_service_role());

-- 12.9 driver_emergency_contacts  (driver self + service_role) -------------
ALTER TABLE driver_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_emergency_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY driver_emergency_contacts_select ON driver_emergency_contacts FOR SELECT
    USING (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_emergency_contacts_insert ON driver_emergency_contacts FOR INSERT
    WITH CHECK (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_emergency_contacts_update ON driver_emergency_contacts FOR UPDATE
    USING (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        driver_member_id IN (
            SELECT om.id FROM organization_members om WHERE om.profile_id = current_user_id()
        )
        OR is_service_role()
    );
CREATE POLICY driver_emergency_contacts_delete ON driver_emergency_contacts FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- DONE
-- ---------------------------------------------------------------------------
-- Tables: delivery_zones, delivery_partners, delivery_partner_credentials,
--         delivery_partner_orders, delivery_partner_webhook_events,
--         whatsapp_routing,
--         driver_assignments, driver_location_pings (partitioned),
--         driver_shifts, driver_emergency_contacts
--         (10 total)
--
-- Function: pings_visible_to_customer(text)
--
-- Intentionally omitted from Wave 0 (legacy 12 tables superseded):
--   delivery_partner_menu_items, delivery_partner_item_variations,
--   delivery_partner_order_items, delivery_partner_order_status_history,
--   delivery_partner_menu_sync_jobs, uber_eats_store_config, uber_eats_orders,
--   and all partner-specific functions/triggers from legacy 12.
--   These belong to the Wave 9 partner-integration rewrite.
