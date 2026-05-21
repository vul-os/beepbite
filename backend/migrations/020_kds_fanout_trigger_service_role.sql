-- Migration 020: let the KDS-fanout enqueue trigger write its service-role table.
--
-- queue_kds_fanout() fires AFTER INSERT/UPDATE OF status on orders and inserts a
-- row into kds_fanout_queue so the async KDS worker picks the order up. But
-- kds_fanout_queue's RLS restricts INSERT to is_service_role() (migration 008),
-- while orders are created under a tenant scope (current_org_id, is_service_role
-- = false). The trigger therefore failed with a row-level-security violation on
-- every tenant-context order insert (e.g. the POS create-order flow), which
-- aborted the whole order transaction.
--
-- Fix: the trigger is a trusted system action, so it elevates app.is_service_role
-- to true (transaction-local) for just the enqueue, then restores tenant scope.
-- The surrounding order mutation keeps running under the caller's tenant scope.

BEGIN;

CREATE OR REPLACE FUNCTION public.queue_kds_fanout()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

COMMIT;
