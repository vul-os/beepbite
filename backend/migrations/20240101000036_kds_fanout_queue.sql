
CREATE TABLE kds_fanout_queue (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    queued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    UNIQUE (order_id)  -- one fan-out entry per order
);

CREATE INDEX idx_kds_fanout_queue_unprocessed
    ON kds_fanout_queue (queued_at)
    WHERE processed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Trigger function: enqueue an order for KDS fan-out when its status enters
-- any of the "kitchen-active" states for the first time.
-- Valid orders.status values (from migration 2):
--   pending | confirmed | preparing | ready | out_for_delivery |
--   delivered | completed | cancelled
-- We trigger on confirmed, preparing, or ready — the states where kitchen
-- work is expected.  ON CONFLICT DO NOTHING makes it safe to re-run.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION queue_kds_fanout() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('confirmed', 'preparing', 'ready')
       AND (OLD IS NULL OR OLD.status NOT IN ('confirmed', 'preparing', 'ready'))
    THEN
        INSERT INTO kds_fanout_queue (order_id)
        VALUES (NEW.id)
        ON CONFLICT (order_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_queue_kds_fanout ON orders;
CREATE TRIGGER trg_queue_kds_fanout
    AFTER INSERT OR UPDATE OF status ON orders
    FOR EACH ROW EXECUTE FUNCTION queue_kds_fanout();

