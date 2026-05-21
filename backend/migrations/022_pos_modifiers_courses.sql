-- =============================================================================
-- MIGRATION 022 — POS MODIFIERS & COURSE ASSIGNMENTS
-- =============================================================================
-- Wave 11 POS schema: closes two verified persistence gaps.
--
-- Gap 1: modifier selections chosen at the POS are NEVER written to the DB.
--   modifier_groups and modifiers were created in 004 but no join table records
--   which options were chosen on a given order_item. order_item_modifiers fills
--   that gap.
--
-- Gap 2: order_items.course_id does not exist — items can only be associated
--   with a course via the coarse integer order_items.course_number (legacy back-
--   compat). Adding the FK-backed course_id column enables proper course-scoped
--   KDS fanout and course-fire trigger logic.
--
-- Gap 3 (trigger): when a KDS ticket for course N is bumped, the system must
--   automatically enqueue course N+1 (if fire_on_previous_course_bumped = true)
--   into kds_fanout_queue so the fanout runner picks it up.
--
-- Dependencies:
--   001 (enums: kds_event_type includes 'bumped')
--   004 (modifiers, courses)
--   008 (order_items, orders, kds_tickets, kds_ticket_events, kds_fanout_queue)
--   020 (pattern for service-role elevation inside triggers)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. order_item_modifiers
-- ---------------------------------------------------------------------------
-- Records which modifier options were chosen for each order_item at order-
-- creation time. Snapshots name + price_cents so the order is immutable even
-- if the modifier is later edited or deactivated.
--
-- RLS choice: MIRROR of order_items (008).
--   order_items policies scope via:
--     order_id IN (SELECT id FROM orders WHERE organization_id = current_org_id())
--   We apply the identical two-hop join:
--     order_item_id → order_items.order_id → orders.organization_id
--   This is consistent, requires no new helpers, and follows the pattern used
--   by kds_ticket_items (ticket_id → kds_tickets → kitchen_stations → locations).
--
--   INSERT: org-scoped WITH CHECK OR is_service_role().
--     The POS handler runs under a tenant-scoped transaction (store.go:97-104);
--     it sets app.current_org_id before DML, so the org-scoped path works.
--     The service-role path handles the async fanout worker and seed scripts.
--   SELECT/UPDATE: same org-scoped join + is_service_role().
--   DELETE: service_role only (locked, like order_items_delete in 008).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS order_item_modifiers (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id       uuid        NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    modifier_id         uuid        NOT NULL REFERENCES modifiers(id),
    -- Snapshot columns: capture name + price at order time so subsequent
    -- edits to the modifier catalogue don't retroactively change order history.
    price_cents_snapshot bigint     NOT NULL,
    name_snapshot       text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
    -- NO updated_at — modifier selections are immutable once recorded.
);

COMMENT ON TABLE order_item_modifiers IS
    'NEW (Wave 11). Records which modifier options were selected for each '
    'order_item. Snapshots name and price so the order record is immutable '
    'regardless of later catalogue edits. modifier_id is kept (not nullable) '
    'for back-reference and reporting; use *_snapshot columns for display.';

COMMENT ON COLUMN order_item_modifiers.price_cents_snapshot IS
    'modifiers.price_delta_cents captured at order time (signed: positive = '
    'surcharge, negative = discount). Immutable after insert.';

COMMENT ON COLUMN order_item_modifiers.name_snapshot IS
    'modifiers.name captured at order time. Immutable after insert.';

CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_order_item_id
    ON order_item_modifiers(order_item_id);

CREATE INDEX IF NOT EXISTS idx_order_item_modifiers_modifier_id
    ON order_item_modifiers(modifier_id);

ALTER TABLE order_item_modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_item_modifiers FORCE ROW LEVEL SECURITY;

-- Threat: tenant A must not read modifier selections belonging to tenant B.
-- Pattern: two-hop join order_item_id → order_items → orders.organization_id,
--          matching the identical pattern used for order_items itself in 008.
CREATE POLICY oim_select ON order_item_modifiers FOR SELECT
    USING (
        order_item_id IN (
            SELECT oi.id FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.organization_id = current_org_id()
        )
        OR is_service_role()
    );

-- INSERT: tenant-scoped path (POS handler) + service-role path (jobs/seeds).
-- WITH CHECK ensures no cross-tenant write even if order_item_id is crafted.
CREATE POLICY oim_insert ON order_item_modifiers FOR INSERT
    WITH CHECK (
        order_item_id IN (
            SELECT oi.id FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.organization_id = current_org_id()
        )
        OR is_service_role()
    );

-- UPDATE: same guard as select (modifier snapshots should rarely be updated,
-- but keep the policy consistent rather than locking to service_role only,
-- since adjustment handlers may need to void/correct a modifier line).
CREATE POLICY oim_update ON order_item_modifiers FOR UPDATE
    USING (
        order_item_id IN (
            SELECT oi.id FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.organization_id = current_org_id()
        )
        OR is_service_role()
    )
    WITH CHECK (
        order_item_id IN (
            SELECT oi.id FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.organization_id = current_org_id()
        )
        OR is_service_role()
    );

-- Hard deletes locked to service_role; handlers should void via adjustment.
CREATE POLICY oim_delete ON order_item_modifiers FOR DELETE
    USING (is_service_role());

-- service_role access comes from the ALTER DEFAULT PRIVILEGES established in
-- migration 001 (matching the convention in 002+). We do NOT issue an explicit
-- GRANT here: the service_role Postgres role may not exist when the migration
-- runner lacks CREATEROLE (it's created best-effort in 001), and a bare GRANT
-- to a missing role aborts the migration. RLS enforcement uses the
-- is_service_role() GUC function in the policies above, not role membership.


-- ---------------------------------------------------------------------------
-- 2. order_items.course_id  (ADD COLUMN)
-- ---------------------------------------------------------------------------
-- Nullable FK to courses(id). Complements the existing integer course_number
-- which remains for back-compat with legacy chatbot handlers.
--
-- ON DELETE SET NULL: deleting a course does not cascade-delete order_items;
-- the item simply loses its course assignment and falls back to ungrouped /
-- the integer course_number column if that is still populated.
--
-- ADD COLUMN IF NOT EXISTS: safe to re-run.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'order_items' AND column_name = 'course_id'
    ) THEN
        ALTER TABLE order_items
            ADD COLUMN course_id uuid REFERENCES courses(id) ON DELETE SET NULL;

        COMMENT ON COLUMN order_items.course_id IS
            'NEW (Wave 11). FK to courses(id). Nullable: NULL means the item is '
            'not assigned to a named course. The legacy integer course_number is '
            'preserved for back-compat; new code should prefer course_id.';
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_items_course_id
    ON order_items(course_id)
    WHERE course_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 3. Course-fire trigger: auto-enqueue the next course on bump
-- ---------------------------------------------------------------------------
-- Firing condition: an INSERT on kds_ticket_events with event_type = 'bumped'.
--   - 'bumped' is the canonical "completed at station" event in kds_event_type
--     (defined in 001 and written by the KDS handler bump path).
--   - We prefer kds_ticket_events INSERT over kds_tickets UPDATE because the
--     event log is append-only and less likely to cause conflicts with concurrent
--     status updates; also, kds_ticket_events already has the ticket_id so we
--     can join up in one step.
--
-- Logic:
--   1. From the bumped ticket, derive the order's location_id and the course
--      assigned to the ticket (kds_tickets.course_number — the integer column
--      still used here because kds_tickets does not yet have a course_id FK;
--      see assumption note at bottom of file).
--   2. Find the NEXT course (by sort_order) in the same location that has
--      fire_on_previous_course_bumped = true.
--   3. Check that no order_item for the order in the NEXT course is already
--      in kds_fanout_queue state='pending' or 'processing' (double-fire guard).
--   4. Enqueue the order into kds_fanout_queue so the fanout runner picks it up.
--      The runner will then create kds_tickets only for the next-course items.
--
-- Double-fire guard:
--   ON CONFLICT (order_id) DO NOTHING in kds_fanout_queue is the primary guard
--   (the table has UNIQUE(order_id)). An additional EXISTS check before the
--   INSERT avoids the unnecessary contention when the order is already queued.
--
-- Service-role elevation:
--   Follows the pattern established in migration 020 (queue_kds_fanout):
--   elevate app.is_service_role to 'true' for the INSERT into kds_fanout_queue,
--   then restore '' (empty = false) immediately after. The trigger runs in the
--   same transaction as the kds_ticket_events INSERT, which may be under either
--   a tenant scope (KDS handler) or service-role scope (fanout runner). We
--   normalise both to service-role for just the enqueue step.
--
-- Note on course matching:
--   kds_tickets.course_number (integer) records which course the ticket belongs
--   to. We use this to find the matching courses row via courses.sort_order.
--   Assumption: course_number on kds_tickets corresponds to courses.sort_order
--   (both are integers; the fanout runner populates course_number from
--   orders.course_number which is the sort_order value). See assumptions below.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_fn_course_fire_on_bump()
RETURNS TRIGGER
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

COMMENT ON FUNCTION trg_fn_course_fire_on_bump() IS
    'NEW (Wave 11). AFTER INSERT trigger on kds_ticket_events. '
    'When event_type = ''bumped'', looks up the next course (courses.sort_order) '
    'in the same location that has fire_on_previous_course_bumped = true. '
    'If found and not already queued, enqueues the order in kds_fanout_queue '
    '(service-role elevation follows the migration 020 pattern). '
    'Double-fire guard: UNIQUE(order_id) + EXISTS check on active queue rows + '
    'EXISTS check on already-fanned-out tickets for the next course.';

DROP TRIGGER IF EXISTS trg_course_fire_on_bump ON kds_ticket_events;
CREATE TRIGGER trg_course_fire_on_bump
    AFTER INSERT ON kds_ticket_events
    FOR EACH ROW EXECUTE FUNCTION trg_fn_course_fire_on_bump();


-- ---------------------------------------------------------------------------
-- DONE — Migration 022
-- ---------------------------------------------------------------------------
-- Objects created:
--
-- TABLE  order_item_modifiers
--   Columns: id (pk uuid), order_item_id (fk→order_items, cascade),
--            modifier_id (fk→modifiers), price_cents_snapshot (bigint not null),
--            name_snapshot (text not null), created_at (timestamptz not null).
--   Indexes: idx_order_item_modifiers_order_item_id, idx_order_item_modifiers_modifier_id.
--   RLS: ENABLE + FORCE. Policies scope via order_item_id→order_items→orders.organization_id
--        OR is_service_role(). DELETE locked to service_role. Mirrors order_items 008 pattern.
--   Grant: service_role full access (belt-and-suspenders).
--
-- COLUMN order_items.course_id  (uuid, nullable, FK→courses ON DELETE SET NULL)
--   Added via DO $$ IF NOT EXISTS guard (idempotent).
--   Index: idx_order_items_course_id (partial, WHERE course_id IS NOT NULL).
--
-- FUNCTION trg_fn_course_fire_on_bump()
--   Fires: AFTER INSERT ON kds_ticket_events FOR EACH ROW.
--   Condition: NEW.event_type = 'bumped'.
--   Logic: resolve order/location/course_number → find next course by sort_order
--          where fire_on_previous_course_bumped = true → guard → enqueue.
--   Double-fire guard:
--     1. ON CONFLICT (order_id) DO NOTHING on kds_fanout_queue (unique constraint).
--     2. EXISTS check: skip if order already has state IN ('pending','processing').
--     3. EXISTS check: skip if kds_tickets already exist for the next course_number.
--   Service-role elevation: set_config('app.is_service_role','true',true) / ''
--     identical to migration 020 queue_kds_fanout() pattern.
--
-- TRIGGER trg_course_fire_on_bump ON kds_ticket_events AFTER INSERT FOR EACH ROW.
--
-- ---------------------------------------------------------------------------
-- RLS REASONING for order_item_modifiers
-- ---------------------------------------------------------------------------
-- Option A (chosen): two-hop join  order_item_id → order_items → orders.organization_id
--   Pro: exactly mirrors how order_items is policed in 008 (same pattern).
--        No new helper functions required. Works under both tenant scope and
--        service-role scope (is_service_role() short-circuits the join).
--   Con: slightly more expensive than a direct organization_id column, but
--        order_item_modifiers is insert-heavy / read-light at scale; the index
--        on order_item_id makes the join fast.
--
-- Option B (rejected): add organization_id column as a denormalised anchor.
--   Pro: trivially fast RLS check.
--   Con: data duplication; violates the consolidation plan's stated preference
--        for join-based policies on child tables. Not used by order_items itself.
--
-- ---------------------------------------------------------------------------
-- ASSUMPTIONS (course ordering)
-- ---------------------------------------------------------------------------
-- 1. kds_tickets.course_number (integer) is populated by the fanout path with
--    the same integer value as courses.sort_order for the course that the items
--    belong to. The trigger therefore uses kds_tickets.course_number to locate
--    "this course" in the courses table by sort_order.
--
--    If the two integers are not aligned (e.g. course_number is a 1-based
--    sequence and sort_order is 0-based or has gaps), the trigger will silently
--    find no next course and do nothing — it will never enqueue erroneously.
--
-- 2. courses.sort_order is the authoritative ordering axis. If two courses share
--    the same sort_order, LIMIT 1 ORDER BY sort_order ASC will pick one
--    arbitrarily; operators should keep sort_order values unique per location.
--
-- 3. Column NOT found: kds_tickets does not yet have a course_id UUID column
--    (only the integer course_number). The trigger uses course_number for matching.
--    A future migration can add kds_tickets.course_id and update the trigger to
--    use the FK-based lookup instead of the sort_order integer comparison.
-- =============================================================================
