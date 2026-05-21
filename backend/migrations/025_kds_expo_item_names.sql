-- ---------------------------------------------------------------------------
-- 025  kds_expo_view — include item names
-- ---------------------------------------------------------------------------
-- The original kds_expo_view (014) built the per-station items jsonb with only
-- order_item_id / quantity / item_status / notes — NO item name. A kitchen
-- display must show WHAT to cook, so this recreates the view with the item
-- name (and item_id) joined in via kds_ticket_items → order_items → items.
-- security_invoker = on so RLS on the underlying tables applies to the caller.
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
                        'item_id',       oi.item_id,
                        'name',          i.name,
                        'quantity',      kti.quantity,
                        'item_status',   kti.item_status,
                        'notes',         kti.notes
                    )
                    ORDER BY kti.created_at
                )
                FROM kds_ticket_items kti
                JOIN order_items oi ON oi.id = kti.order_item_id
                JOIN items       i  ON i.id  = oi.item_id
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
