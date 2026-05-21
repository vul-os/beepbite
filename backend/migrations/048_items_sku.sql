-- =============================================================================
-- 048_items_sku.sql — add items.sku for barcode-scanner lookup
-- =============================================================================
--
-- The hardware barcode scanner (use-barcode-scanner.js) + POS lookup need an
-- SKU/barcode to resolve a scanned code to an item. The items table had no such
-- column, so lookup-by-SKU was unimplementable. Add a nullable sku and a unique
-- index per location (a code is unique within a store; NULLs are unconstrained).
-- The generic /data/items layer can then serve GET /data/items?eq=sku,<code>.
ALTER TABLE items ADD COLUMN IF NOT EXISTS sku text;

CREATE UNIQUE INDEX IF NOT EXISTS items_location_sku_uq
    ON items (location_id, sku)
    WHERE sku IS NOT NULL;
