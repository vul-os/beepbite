-- Allow POS walk-in orders to have no associated customer record.
-- Before this migration the orders.customer_id column was NOT NULL, which
-- prevented the POS handler from creating orders without first looking up or
-- creating a customer row. Walk-in (anonymous) POS orders are a normal case
-- so the column is made optional here.
ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL;
