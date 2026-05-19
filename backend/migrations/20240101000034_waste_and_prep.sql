
-- Waste reason on movements (only meaningful when movement_type='waste')
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS waste_reason TEXT CHECK (
    waste_reason IS NULL OR waste_reason IN ('spoilage','spillage','theft','staff_meal','prep_loss','expired','contamination')
  );

-- Yield % on recipe lines (how much usable product comes out of raw input)
ALTER TABLE item_recipes
  ADD COLUMN IF NOT EXISTS yield_pct NUMERIC(5,2) NOT NULL DEFAULT 100;

-- Prep batches: produced N units of soup today, deduct raw + add prep-item stock
CREATE TABLE IF NOT EXISTS prep_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  location_id UUID NOT NULL REFERENCES locations(id),
  produced_inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  produced_quantity NUMERIC(10,2) NOT NULL,
  produced_unit TEXT NOT NULL,
  recipe_yield_pct NUMERIC(5,2),
  prepared_by_staff_id UUID REFERENCES staff(id),
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prep_batch_inputs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_batch_id UUID NOT NULL REFERENCES prep_batches(id) ON DELETE CASCADE,
  inventory_item_id UUID NOT NULL REFERENCES inventory_items(id),
  quantity_consumed NUMERIC(10,2) NOT NULL,
  unit TEXT NOT NULL
);

DROP TRIGGER IF EXISTS prep_batches_updated_at ON prep_batches;
CREATE TRIGGER prep_batches_updated_at BEFORE UPDATE ON prep_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

CREATE INDEX IF NOT EXISTS idx_stock_movements_waste_reason ON stock_movements(waste_reason) WHERE waste_reason IS NOT NULL;

