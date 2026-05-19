
CREATE TABLE fiscal_sequences (
  location_id UUID PRIMARY KEY REFERENCES locations(id),
  current_number BIGINT NOT NULL DEFAULT 0,
  prefix TEXT NOT NULL DEFAULT '',  -- e.g. "INV-2026-"
  reset_policy TEXT NOT NULL DEFAULT 'never' CHECK (reset_policy IN ('never','yearly','monthly')),
  last_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS fiscal_receipt_number TEXT,
  ADD COLUMN IF NOT EXISTS fiscal_receipt_assigned_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_fiscal_receipt_unique
  ON orders(location_id, fiscal_receipt_number)
  WHERE fiscal_receipt_number IS NOT NULL;

DROP TRIGGER IF EXISTS fiscal_sequences_updated_at ON fiscal_sequences;
CREATE TRIGGER fiscal_sequences_updated_at BEFORE UPDATE ON fiscal_sequences FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

