-- Migration 057: give orders an explicit business_date in the location's own
-- timezone, and hang the daily order-number sequence off it.
--
-- THE PROBLEM
--
-- The daily order number ("POS0001", resetting each day) was scoped by
--
--     date_trunc('day', created_at AT TIME ZONE 'UTC')
--
-- both in the MAX() query that picks the next number and in the unique index
-- that enforces it. That makes the trading day a UTC day.
--
-- A UTC day is only the right day for a store in UTC. In Johannesburg (UTC+2)
-- the counter resets at 02:00 — after close, so nobody noticed. In Los Angeles
-- (UTC-8) it resets at 16:00, in the middle of dinner service: the numbering
-- restarts at POS0001 mid-shift, the Z-report and the cash drawer cover
-- different sets of orders, and two orders forty minutes apart get the same
-- number on the same evening's tickets.
--
-- WHY A COLUMN AND NOT A BETTER INDEX EXPRESSION
--
-- The obvious fix — `AT TIME ZONE l.timezone` — cannot go in an index. Postgres
-- index expressions must be IMMUTABLE and may not reference another table, and
-- the timezone lives on locations. So the trading date is computed once by the
-- application, at insert time, from the location's configured zone, and stored.
--
-- Storing it also makes the day auditable. "Which trading day was this order
-- on?" becomes a column you can read rather than an expression whose answer
-- silently changes if the location's timezone is ever corrected.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS business_date date;

COMMENT ON COLUMN orders.business_date IS
    'The local calendar date of the location''s trading day this order belongs '
    'to, computed at insert time from locations.timezone (see internal/bizday). '
    'created_at remains the absolute UTC instant; this is the DAY that instant '
    'falls in for the people working the till. Scopes the daily order-number '
    'sequence, the cash-drawer close and the Z-report, so all three agree.';

-- Backfill from the UTC day.
--
-- This reproduces EXACTLY the day each existing order was already assigned
-- under the old expression, so no historical order changes its day, no
-- historical order number becomes a duplicate, and the new unique index below
-- can be built without conflict. Locations default to timezone 'UTC' in
-- migration 056, so existing rows and the going-forward computation agree until
-- an operator sets a real timezone — at which point only NEW orders adopt it.
UPDATE orders
   SET business_date = (created_at AT TIME ZONE 'UTC')::date
 WHERE business_date IS NULL;

ALTER TABLE orders
    ALTER COLUMN business_date SET DEFAULT (timezone('utc', now()))::date;

-- Replace the UTC-pinned index with one over the stored date.
DROP INDEX IF EXISTS unique_order_number_per_day;

CREATE UNIQUE INDEX IF NOT EXISTS unique_order_number_per_business_date
    ON orders (location_id, order_number, business_date);

COMMENT ON INDEX unique_order_number_per_business_date IS
    'Order numbers are unique per location per TRADING day. Replaces '
    'unique_order_number_per_day, which scoped by the UTC day and so reset the '
    'sequence mid-service for any location more than a couple of hours from '
    'UTC.';

-- Reporting and the drawer close both filter by trading day.
CREATE INDEX IF NOT EXISTS idx_orders_location_business_date
    ON orders (location_id, business_date);
