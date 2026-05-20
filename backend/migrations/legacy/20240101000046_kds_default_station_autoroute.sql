-- =============================================================================
-- KDS DEFAULT STATION AUTO-ROUTE
-- Makes KDS "just work" for new POS users with no station/routing data.
-- All blocks are idempotent — safe to run repeatedly.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. BACKFILL kitchen_stations
--    Insert a default 'Kitchen' station for every location that has none.
-- ---------------------------------------------------------------------------
INSERT INTO kitchen_stations (location_id, name, station_type, sort_order, is_active)
SELECT
    l.id,
    'Kitchen',
    'prep',
    0,
    true
FROM locations l
WHERE NOT EXISTS (
    SELECT 1
    FROM kitchen_stations ks
    WHERE ks.location_id = l.id
);

-- ---------------------------------------------------------------------------
-- 2. BACKFILL item_station_routing
--    Route every item to its location's 'Kitchen' station where no routing
--    exists yet.  ON CONFLICT DO NOTHING keeps this idempotent.
-- ---------------------------------------------------------------------------
INSERT INTO item_station_routing (item_id, station_id, is_primary)
SELECT
    i.id          AS item_id,
    ks.id         AS station_id,
    true          AS is_primary
FROM items i
JOIN kitchen_stations ks
    ON ks.location_id = i.location_id
   AND ks.name = 'Kitchen'
ON CONFLICT (item_id, station_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. TRIGGER: auto-create 'Kitchen' station when a new location is inserted.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_location_default_kitchen_station()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO kitchen_stations (location_id, name, station_type, sort_order, is_active)
    VALUES (NEW.id, 'Kitchen', 'prep', 0, true)
    ON CONFLICT (location_id, name) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_location_default_kitchen_station ON locations;
CREATE TRIGGER trg_location_default_kitchen_station
    AFTER INSERT ON locations
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_location_default_kitchen_station();

-- ---------------------------------------------------------------------------
-- 4. TRIGGER: auto-route a new item to its location's 'Kitchen' station.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_item_default_station_routing()
RETURNS TRIGGER AS $$
DECLARE
    v_station_id uuid;
BEGIN
    SELECT id INTO v_station_id
    FROM kitchen_stations
    WHERE location_id = NEW.location_id
      AND name = 'Kitchen'
    LIMIT 1;

    IF v_station_id IS NULL THEN
        RAISE NOTICE
            'trg_fn_item_default_station_routing: no Kitchen station found for location_id=%, item_id=% — skipping auto-route',
            NEW.location_id, NEW.id;
        RETURN NEW;
    END IF;

    INSERT INTO item_station_routing (item_id, station_id, is_primary)
    VALUES (NEW.id, v_station_id, true)
    ON CONFLICT (item_id, station_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_item_default_station_routing ON items;
CREATE TRIGGER trg_item_default_station_routing
    AFTER INSERT ON items
    FOR EACH ROW
    EXECUTE FUNCTION trg_fn_item_default_station_routing();

-- ---------------------------------------------------------------------------
-- 5. BACKFILL kds_fanout_queue
--    Enqueue any active orders that never produced KDS tickets so the fanout
--    worker can pick them up on next poll.  ON CONFLICT DO NOTHING is safe.
-- ---------------------------------------------------------------------------
INSERT INTO kds_fanout_queue (order_id)
SELECT o.id
FROM orders o
WHERE o.status IN ('confirmed', 'preparing', 'ready')
  AND NOT EXISTS (
      SELECT 1
      FROM kds_tickets kt
      WHERE kt.order_id = o.id
  )
ON CONFLICT (order_id) DO NOTHING;
