-- =============================================================================
-- MIGRATION 005 — INVENTORY
-- =============================================================================
-- Sources:
--   legacy 2  — inventory_items (base), stock_movements (base)
--   legacy 24 — inventory_items.link_to_item_id column
--   legacy 31 — stock_movements.movement_type += 'grn'
--   legacy 34 — stock_movements.waste_reason, prep_batches, prep_batch_inputs
--   legacy 20 — suppliers, supplier_contacts, supplier_locations,
--                supplier_inventory_items, purchase_orders, purchase_order_items,
--                goods_receipts, goods_receipt_items, supplier_invoices,
--                supplier_invoice_lines, ingredient_price_history
--   legacy 35 — recipe_cost_runs
--
-- Dependency order:
--   001 (helpers) → 002 (organizations, profiles) → 003 (staff) →
--   004 (items, auto_86_from_inventory function) → this migration (005)
--
-- The auto_86_from_inventory() trigger function is defined in 004_menu.sql.
-- This migration attaches the trigger to inventory_items.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. INVENTORY_ITEMS
-- ---------------------------------------------------------------------------
-- Sources: legacy 2 (base), legacy 24 (link_to_item_id), legacy 34 (prep cross-ref).

CREATE TABLE inventory_items (
    id               uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK constraint fk_inventory_items_location added by 007_payments_generic.sql (after locations exists)
    location_id      uuid           NOT NULL,
    name             text           NOT NULL,
    description      text,
    unit             text           NOT NULL,       -- kg, litres, pieces, etc.
    current_stock    decimal(10,3)  NOT NULL DEFAULT 0,
    minimum_stock    decimal(10,3)  NOT NULL DEFAULT 0,
    cost_per_unit    decimal(10,2),                 -- latest known cost
    -- Optional link from raw ingredient to a sellable menu item.
    -- Used by auto-86 logic: when stock → 0, linked item is 86ed if opted in.
    link_to_item_id  uuid           REFERENCES items(id) ON DELETE SET NULL,  -- legacy 24
    created_at       timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at       timestamptz    NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_inventory_items_location       ON inventory_items(location_id);
CREATE INDEX idx_inventory_items_link_to_item   ON inventory_items(link_to_item_id)
    WHERE link_to_item_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_inventory_items_updated_at ON inventory_items;
CREATE TRIGGER trg_inventory_items_updated_at
    BEFORE UPDATE ON inventory_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- Auto-86 trigger (function defined in 004_menu.sql).
-- Fires AFTER UPDATE on current_stock or link_to_item_id changes.
DROP TRIGGER IF EXISTS trg_auto_86_from_inventory ON inventory_items;
CREATE TRIGGER trg_auto_86_from_inventory
    AFTER UPDATE OF current_stock, link_to_item_id ON inventory_items
    FOR EACH ROW EXECUTE FUNCTION auto_86_from_inventory();

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;

-- POLICY inventory_items_select ON inventory_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY inventory_items_insert ON inventory_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY inventory_items_update ON inventory_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- Deletes locked to service_role; operators should zero stock instead.
CREATE POLICY inventory_items_delete ON inventory_items FOR DELETE
    USING (is_service_role());

COMMENT ON TABLE inventory_items IS
    'Raw ingredient / consumable stock tracking. location-scoped via RLS. '
    'link_to_item_id enables auto-86 propagation to menu items when stock hits zero.';
COMMENT ON COLUMN inventory_items.link_to_item_id IS
    'Optional FK to items(id). When set and items.auto_86_when_inventory_empty=true, '
    'the trg_auto_86_from_inventory trigger flips items.is_86ed as stock crosses zero. '
    'Source: legacy migration 24.';

-- ---------------------------------------------------------------------------
-- 2. STOCK_MOVEMENTS
-- ---------------------------------------------------------------------------
-- Sources: legacy 2 (base), 31 ('grn' movement_type), 34 (waste_reason).

CREATE TABLE stock_movements (
    id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id   uuid           NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    movement_type       text           NOT NULL
                            CHECK (movement_type IN ('purchase', 'sale', 'waste', 'adjustment', 'grn')),
    -- 'grn' (Goods Receipt Note) added in legacy 31; all types consolidated here.
    quantity            decimal(10,3)  NOT NULL,   -- positive = incoming, negative = outgoing
    unit_cost           decimal(10,2),
    reference_id        uuid,                       -- e.g., order_id, purchase_order_id
    notes               text,
    -- waste_reason: only relevant when movement_type = 'waste'. (legacy 34)
    waste_reason        text
                            CHECK (waste_reason IS NULL OR waste_reason IN (
                                'spoilage', 'spillage', 'theft', 'staff_meal',
                                'prep_loss', 'expired', 'contamination'
                            )),
    recorded_by         uuid           REFERENCES profiles(id) ON DELETE SET NULL,
    created_at          timestamptz    NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_stock_movements_inventory_item  ON stock_movements(inventory_item_id);
CREATE INDEX idx_stock_movements_waste_reason    ON stock_movements(waste_reason)
    WHERE waste_reason IS NOT NULL;
CREATE INDEX idx_stock_movements_movement_type   ON stock_movements(movement_type);
CREATE INDEX idx_stock_movements_created_at      ON stock_movements(created_at DESC);

-- stock_movements is append-only; no updated_at column or trigger.

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;

-- POLICY stock_movements_select ON stock_movements deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY stock_movements_insert ON stock_movements deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- stock_movements is append-only; no UPDATE policy.
CREATE POLICY stock_movements_update ON stock_movements FOR UPDATE
    USING (false);
CREATE POLICY stock_movements_delete ON stock_movements FOR DELETE
    USING (is_service_role());

COMMENT ON TABLE stock_movements IS
    'Append-only audit ledger for inventory_items stock changes. '
    'movement_type includes ''grn'' (goods receipt note) from legacy 31. '
    'waste_reason constraint added by legacy 34.';

-- ---------------------------------------------------------------------------
-- 3. SUPPLIERS
-- ---------------------------------------------------------------------------

CREATE TABLE suppliers (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                text        NOT NULL,
    display_name        text,
    tax_id              text,       -- VAT number / company reg
    payment_terms_days  integer     NOT NULL DEFAULT 30,
    default_currency    text        NOT NULL DEFAULT 'ZAR'
                            CHECK (char_length(default_currency) = 3),
    website             text,
    notes               text,
    is_active           boolean     NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(organization_id, name)
);

CREATE INDEX idx_suppliers_organization ON suppliers(organization_id);

DROP TRIGGER IF EXISTS trg_suppliers_updated_at ON suppliers;
CREATE TRIGGER trg_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;

CREATE POLICY suppliers_select ON suppliers FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY suppliers_insert ON suppliers FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY suppliers_update ON suppliers FOR UPDATE
    USING  (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY suppliers_delete ON suppliers FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 4. SUPPLIER_CONTACTS
-- ---------------------------------------------------------------------------

CREATE TABLE supplier_contacts (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    role        text,       -- "Sales Rep", "Accounts"
    email       text,
    phone       text,
    is_primary  boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);

DROP TRIGGER IF EXISTS trg_supplier_contacts_updated_at ON supplier_contacts;
CREATE TRIGGER trg_supplier_contacts_updated_at
    BEFORE UPDATE ON supplier_contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY supplier_contacts_select ON supplier_contacts FOR SELECT
    USING (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_contacts_insert ON supplier_contacts FOR INSERT
    WITH CHECK (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_contacts_update ON supplier_contacts FOR UPDATE
    USING (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_contacts_delete ON supplier_contacts FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 5. SUPPLIER_LOCATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE supplier_locations (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id    uuid        NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    -- FK constraint fk_supplier_locations_location added by 007_payments_generic.sql (after locations exists)
    location_id    uuid        NOT NULL,
    account_number text,       -- supplier's account number for this location
    created_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at     timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(supplier_id, location_id)
);

CREATE INDEX idx_supplier_locations_supplier ON supplier_locations(supplier_id);
CREATE INDEX idx_supplier_locations_location ON supplier_locations(location_id);

DROP TRIGGER IF EXISTS trg_supplier_locations_updated_at ON supplier_locations;
CREATE TRIGGER trg_supplier_locations_updated_at
    BEFORE UPDATE ON supplier_locations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE supplier_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_locations FORCE ROW LEVEL SECURITY;

CREATE POLICY supplier_locations_select ON supplier_locations FOR SELECT
    USING (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_locations_insert ON supplier_locations FOR INSERT
    WITH CHECK (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_locations_update ON supplier_locations FOR UPDATE
    USING (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_locations_delete ON supplier_locations FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 6. SUPPLIER_INVENTORY_ITEMS (catalog: which supplier sells which ingredient)
-- ---------------------------------------------------------------------------

CREATE TABLE supplier_inventory_items (
    id                       uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id              uuid           NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    inventory_item_id        uuid           NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    supplier_sku             text,
    pack_size                decimal(12,4),  -- e.g., 25 for a 25 kg bag
    pack_unit                text,           -- e.g., 'kg' — must match inventory_items.unit convention
    last_price_per_pack_cents bigint,        -- most recent price per pack (cents)
    lead_time_days           integer,
    is_preferred             boolean        NOT NULL DEFAULT false,
    is_active                boolean        NOT NULL DEFAULT true,
    created_at               timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at               timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(supplier_id, inventory_item_id)
);

CREATE INDEX idx_supplier_inventory_items_supplier        ON supplier_inventory_items(supplier_id);
CREATE INDEX idx_supplier_inventory_items_inventory_item  ON supplier_inventory_items(inventory_item_id);

DROP TRIGGER IF EXISTS trg_supplier_inventory_items_updated_at ON supplier_inventory_items;
CREATE TRIGGER trg_supplier_inventory_items_updated_at
    BEFORE UPDATE ON supplier_inventory_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE supplier_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_inventory_items FORCE ROW LEVEL SECURITY;

CREATE POLICY supplier_inventory_items_select ON supplier_inventory_items FOR SELECT
    USING (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_inventory_items_insert ON supplier_inventory_items FOR INSERT
    WITH CHECK (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_inventory_items_update ON supplier_inventory_items FOR UPDATE
    USING (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    )
    WITH CHECK (
        supplier_id IN (SELECT id FROM suppliers WHERE organization_id = current_org_id())
        OR is_service_role()
    );
CREATE POLICY supplier_inventory_items_delete ON supplier_inventory_items FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 7. PURCHASE_ORDERS
-- ---------------------------------------------------------------------------

CREATE TABLE purchase_orders (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- FK constraint fk_purchase_orders_location added by 007_payments_generic.sql (after locations exists)
    location_id            uuid        NOT NULL,
    supplier_id            uuid        REFERENCES suppliers(id) ON DELETE SET NULL,
    po_number              text        NOT NULL,   -- location-scoped, user-facing
    status                 text        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled', 'closed')),
    ordered_by             uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    ordered_at             timestamptz,
    expected_delivery_date date,
    delivered_at           timestamptz,
    currency               text        NOT NULL DEFAULT 'ZAR',
    subtotal_cents         bigint      NOT NULL DEFAULT 0,
    tax_cents              bigint      NOT NULL DEFAULT 0,
    shipping_cents         bigint      NOT NULL DEFAULT 0,
    total_cents            bigint      NOT NULL DEFAULT 0,
    notes                  text,
    created_at             timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at             timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(location_id, po_number)
);

CREATE INDEX idx_purchase_orders_location_status   ON purchase_orders(location_id, status);
CREATE INDEX idx_purchase_orders_supplier          ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_expected_delivery ON purchase_orders(expected_delivery_date);

DROP TRIGGER IF EXISTS trg_purchase_orders_updated_at ON purchase_orders;
CREATE TRIGGER trg_purchase_orders_updated_at
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;

-- POLICY purchase_orders_select ON purchase_orders deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY purchase_orders_insert ON purchase_orders deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY purchase_orders_update ON purchase_orders deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY purchase_orders_delete ON purchase_orders FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 8. PURCHASE_ORDER_ITEMS
-- ---------------------------------------------------------------------------

CREATE TABLE purchase_order_items (
    id                          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id           uuid           NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    inventory_item_id           uuid           NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    supplier_inventory_item_id  uuid           REFERENCES supplier_inventory_items(id) ON DELETE SET NULL,
    ordered_quantity            decimal(12,4)  NOT NULL CHECK (ordered_quantity > 0),
    ordered_unit                text           NOT NULL,
    ordered_unit_price_cents    bigint         NOT NULL CHECK (ordered_unit_price_cents >= 0),
    received_quantity           decimal(12,4)  NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    received_unit_price_cents   bigint,        -- may differ from ordered if supplier changes price on delivery
    line_total_cents            bigint         NOT NULL DEFAULT 0,
    notes                       text,
    created_at                  timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz    NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_purchase_order_items_purchase_order  ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_purchase_order_items_inventory_item  ON purchase_order_items(inventory_item_id);

DROP TRIGGER IF EXISTS trg_purchase_order_items_updated_at ON purchase_order_items;
CREATE TRIGGER trg_purchase_order_items_updated_at
    BEFORE UPDATE ON purchase_order_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;

-- POLICY purchase_order_items_select ON purchase_order_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY purchase_order_items_insert ON purchase_order_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY purchase_order_items_update ON purchase_order_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY purchase_order_items_delete ON purchase_order_items FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 9. GOODS_RECEIPTS
-- ---------------------------------------------------------------------------
-- A PO can be received in multiple partial shipments.

CREATE TABLE goods_receipts (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id    uuid        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    receipt_number       text,
    received_by          uuid        REFERENCES staff(id) ON DELETE SET NULL,
    received_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    delivery_note_number text,       -- supplier's delivery note number
    notes                text,
    created_at           timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(purchase_order_id, receipt_number)
);

CREATE INDEX idx_goods_receipts_purchase_order ON goods_receipts(purchase_order_id);
CREATE INDEX idx_goods_receipts_received_at    ON goods_receipts(received_at);

-- No updated_at; goods receipts are effectively append-only headers.

ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts FORCE ROW LEVEL SECURITY;

-- POLICY goods_receipts_select ON goods_receipts deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY goods_receipts_insert ON goods_receipts deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY goods_receipts_update ON goods_receipts deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY goods_receipts_delete ON goods_receipts FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 10. GOODS_RECEIPT_ITEMS
-- ---------------------------------------------------------------------------

CREATE TABLE goods_receipt_items (
    id                      uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    goods_receipt_id        uuid           NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
    purchase_order_item_id  uuid           NOT NULL REFERENCES purchase_order_items(id) ON DELETE CASCADE,
    quantity_received       decimal(12,4)  NOT NULL CHECK (quantity_received > 0),
    unit_price_cents        bigint         NOT NULL CHECK (unit_price_cents >= 0),
    quality_ok              boolean        NOT NULL DEFAULT true,
    rejection_reason        text,
    stock_movement_id       uuid           REFERENCES stock_movements(id) ON DELETE SET NULL,
    created_at              timestamptz    NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_goods_receipt_items_goods_receipt      ON goods_receipt_items(goods_receipt_id);
CREATE INDEX idx_goods_receipt_items_purchase_order_item ON goods_receipt_items(purchase_order_item_id);

ALTER TABLE goods_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_items FORCE ROW LEVEL SECURITY;

-- POLICY goods_receipt_items_select ON goods_receipt_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY goods_receipt_items_insert ON goods_receipt_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY goods_receipt_items_update ON goods_receipt_items deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY goods_receipt_items_delete ON goods_receipt_items FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 11. SUPPLIER_INVOICES (3-way match: PO + GRN + Invoice)
-- ---------------------------------------------------------------------------

CREATE TABLE supplier_invoices (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id     uuid        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    -- FK constraint fk_supplier_invoices_location added by 007_payments_generic.sql (after locations exists)
    location_id     uuid        NOT NULL,
    invoice_number  text        NOT NULL,
    invoice_date    date        NOT NULL,
    due_date        date,
    subtotal_cents  bigint      NOT NULL DEFAULT 0,
    tax_cents       bigint      NOT NULL DEFAULT 0,
    total_cents     bigint      NOT NULL DEFAULT 0,
    currency        text        NOT NULL DEFAULT 'ZAR',
    status          text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'matched', 'disputed', 'approved', 'paid', 'cancelled')),
    match_status    text        NOT NULL DEFAULT 'unmatched'
                        CHECK (match_status IN ('unmatched', 'price_variance', 'qty_variance', 'matched')),
    paid_at         timestamptz,
    notes           text,
    pdf_url         text,
    created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE(supplier_id, invoice_number)
);

CREATE INDEX idx_supplier_invoices_supplier  ON supplier_invoices(supplier_id);
CREATE INDEX idx_supplier_invoices_location  ON supplier_invoices(location_id);
CREATE INDEX idx_supplier_invoices_status    ON supplier_invoices(status);
CREATE INDEX idx_supplier_invoices_due_date  ON supplier_invoices(due_date);

DROP TRIGGER IF EXISTS trg_supplier_invoices_updated_at ON supplier_invoices;
CREATE TRIGGER trg_supplier_invoices_updated_at
    BEFORE UPDATE ON supplier_invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices FORCE ROW LEVEL SECURITY;

-- POLICY supplier_invoices_select ON supplier_invoices deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY supplier_invoices_insert ON supplier_invoices deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY supplier_invoices_update ON supplier_invoices deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY supplier_invoices_delete ON supplier_invoices FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 12. SUPPLIER_INVOICE_LINES
-- ---------------------------------------------------------------------------

CREATE TABLE supplier_invoice_lines (
    id                      uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_invoice_id     uuid           NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
    purchase_order_item_id  uuid           REFERENCES purchase_order_items(id) ON DELETE SET NULL,
    goods_receipt_item_id   uuid           REFERENCES goods_receipt_items(id) ON DELETE SET NULL,
    description             text,          -- fallback when no PO link
    quantity                decimal(12,4)  NOT NULL CHECK (quantity > 0),
    unit_price_cents        bigint         NOT NULL CHECK (unit_price_cents >= 0),
    line_total_cents        bigint         NOT NULL,
    created_at              timestamptz    NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_supplier_invoice_lines_invoice           ON supplier_invoice_lines(supplier_invoice_id);
CREATE INDEX idx_supplier_invoice_lines_purchase_order_item ON supplier_invoice_lines(purchase_order_item_id);

ALTER TABLE supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoice_lines FORCE ROW LEVEL SECURITY;

-- POLICY supplier_invoice_lines_select ON supplier_invoice_lines deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY supplier_invoice_lines_insert ON supplier_invoice_lines deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY supplier_invoice_lines_update ON supplier_invoice_lines deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY supplier_invoice_lines_delete ON supplier_invoice_lines FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 13. INGREDIENT_PRICE_HISTORY
-- ---------------------------------------------------------------------------
-- Auto-populated on goods receipt so recipe costs can be recomputed over time.

CREATE TABLE ingredient_price_history (
    id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_item_id        uuid        NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    supplier_id              uuid        REFERENCES suppliers(id) ON DELETE SET NULL,
    source_type              text        NOT NULL
                                 CHECK (source_type IN ('goods_receipt', 'manual', 'supplier_catalog_sync', 'system_adjustment')),
    goods_receipt_item_id    uuid        REFERENCES goods_receipt_items(id) ON DELETE SET NULL,
    price_per_base_unit_cents bigint     NOT NULL CHECK (price_per_base_unit_cents >= 0),
    effective_at             timestamptz NOT NULL DEFAULT timezone('utc', now()),
    recorded_by              uuid        REFERENCES profiles(id) ON DELETE SET NULL,
    notes                    text,
    created_at               timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_ingredient_price_history_item_effective ON ingredient_price_history(inventory_item_id, effective_at DESC);
CREATE INDEX idx_ingredient_price_history_supplier       ON ingredient_price_history(supplier_id);

-- Append-only; no updated_at.

ALTER TABLE ingredient_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_price_history FORCE ROW LEVEL SECURITY;

-- POLICY ingredient_price_history_select ON ingredient_price_history deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
-- POLICY ingredient_price_history_insert ON ingredient_price_history deferred to 007 (locations must exist first; Postgres 18 DDL-time check)
CREATE POLICY ingredient_price_history_update ON ingredient_price_history FOR UPDATE
    USING (false);   -- append-only
CREATE POLICY ingredient_price_history_delete ON ingredient_price_history FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 14. PREP_BATCHES (legacy 34)
-- ---------------------------------------------------------------------------

CREATE TABLE prep_batches (
    id                          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             uuid           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    -- FK constraint fk_prep_batches_location added by 007_payments_generic.sql (after locations exists)
    location_id                 uuid           NOT NULL,
    produced_inventory_item_id  uuid           NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    produced_quantity           numeric(10,2)  NOT NULL CHECK (produced_quantity > 0),
    produced_unit               text           NOT NULL,
    recipe_yield_pct            numeric(5,2),
    prepared_by_staff_id        uuid           REFERENCES staff(id) ON DELETE SET NULL,
    prepared_at                 timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    notes                       text,
    created_at                  timestamptz    NOT NULL DEFAULT timezone('utc', now()),
    updated_at                  timestamptz    NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX idx_prep_batches_location      ON prep_batches(location_id);
CREATE INDEX idx_prep_batches_organization  ON prep_batches(organization_id);
CREATE INDEX idx_prep_batches_produced_item ON prep_batches(produced_inventory_item_id);

DROP TRIGGER IF EXISTS trg_prep_batches_updated_at ON prep_batches;
CREATE TRIGGER trg_prep_batches_updated_at
    BEFORE UPDATE ON prep_batches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

ALTER TABLE prep_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE prep_batches FORCE ROW LEVEL SECURITY;

CREATE POLICY prep_batches_select ON prep_batches FOR SELECT
    USING (organization_id = current_org_id() OR is_service_role());
CREATE POLICY prep_batches_insert ON prep_batches FOR INSERT
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY prep_batches_update ON prep_batches FOR UPDATE
    USING  (organization_id = current_org_id() OR is_service_role())
    WITH CHECK (organization_id = current_org_id() OR is_service_role());
CREATE POLICY prep_batches_delete ON prep_batches FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 15. PREP_BATCH_INPUTS (legacy 34)
-- ---------------------------------------------------------------------------

CREATE TABLE prep_batch_inputs (
    id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    prep_batch_id       uuid           NOT NULL REFERENCES prep_batches(id) ON DELETE CASCADE,
    inventory_item_id   uuid           NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    quantity_consumed   numeric(10,2)  NOT NULL CHECK (quantity_consumed > 0),
    unit                text           NOT NULL
);

CREATE INDEX idx_prep_batch_inputs_batch         ON prep_batch_inputs(prep_batch_id);
CREATE INDEX idx_prep_batch_inputs_inventory_item ON prep_batch_inputs(inventory_item_id);

-- No updated_at; inputs are set at batch creation and not modified.

ALTER TABLE prep_batch_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE prep_batch_inputs FORCE ROW LEVEL SECURITY;

CREATE POLICY prep_batch_inputs_select ON prep_batch_inputs FOR SELECT
    USING (
        prep_batch_id IN (
            SELECT pb.id FROM prep_batches pb
            WHERE pb.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY prep_batch_inputs_insert ON prep_batch_inputs FOR INSERT
    WITH CHECK (
        prep_batch_id IN (
            SELECT pb.id FROM prep_batches pb
            WHERE pb.organization_id = current_org_id()
        )
        OR is_service_role()
    );
CREATE POLICY prep_batch_inputs_update ON prep_batch_inputs FOR UPDATE
    USING (false);   -- immutable after batch creation
CREATE POLICY prep_batch_inputs_delete ON prep_batch_inputs FOR DELETE
    USING (is_service_role());

-- ---------------------------------------------------------------------------
-- 16. RECIPE_COST_RUNS (legacy 35)
-- ---------------------------------------------------------------------------
-- System-level table; tracks the background job that recomputes item costs
-- whenever ingredient_price_history rows are inserted.
-- Not org-scoped — this is a global job-progress table.

CREATE TABLE recipe_cost_runs (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at            timestamptz NOT NULL DEFAULT now(),
    completed_at          timestamptz,
    last_price_history_id uuid,       -- watermark: newest ingredient_price_history.id processed
    items_updated_count   integer     NOT NULL DEFAULT 0,
    error_message         text
);

CREATE INDEX idx_recipe_cost_runs_started_at ON recipe_cost_runs(started_at DESC);

-- recipe_cost_runs: only service_role reads/writes; no tenant access.
-- Threat: cost recomputation details are system-internal operational data.
ALTER TABLE recipe_cost_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_cost_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY recipe_cost_runs_all ON recipe_cost_runs
    USING (is_service_role())
    WITH CHECK (is_service_role());

COMMENT ON TABLE recipe_cost_runs IS
    'Watermark table for the background recipe-cost recomputation job. '
    'Populated when ingredient_price_history rows are inserted. '
    'Source: legacy migration 35. Not org-scoped; service_role only.';

-- ---------------------------------------------------------------------------
-- 17. GRANT DEFAULTS
-- ---------------------------------------------------------------------------
-- 001 issued REVOKE ALL FROM PUBLIC globally. Grant only what is needed.
-- service_role has ALL via ALTER DEFAULT PRIVILEGES in 001.
-- marketplace_role: no inventory tables are public. All REVOKE from marketplace_role.

-- Wrapped in exception guard: non-superuser runners cannot create roles; role may
-- be absent. Behaviour is identical to the role-creation guard in 001.
DO $$
BEGIN
    REVOKE ALL ON inventory_items         FROM marketplace_role;
    REVOKE ALL ON stock_movements         FROM marketplace_role;
    REVOKE ALL ON suppliers               FROM marketplace_role;
    REVOKE ALL ON supplier_contacts       FROM marketplace_role;
    REVOKE ALL ON supplier_locations      FROM marketplace_role;
    REVOKE ALL ON supplier_inventory_items FROM marketplace_role;
    REVOKE ALL ON purchase_orders         FROM marketplace_role;
    REVOKE ALL ON purchase_order_items    FROM marketplace_role;
    REVOKE ALL ON goods_receipts          FROM marketplace_role;
    REVOKE ALL ON goods_receipt_items     FROM marketplace_role;
    REVOKE ALL ON supplier_invoices       FROM marketplace_role;
    REVOKE ALL ON supplier_invoice_lines  FROM marketplace_role;
    REVOKE ALL ON ingredient_price_history FROM marketplace_role;
    REVOKE ALL ON prep_batches            FROM marketplace_role;
    REVOKE ALL ON prep_batch_inputs       FROM marketplace_role;
    REVOKE ALL ON recipe_cost_runs        FROM marketplace_role;
EXCEPTION WHEN undefined_object OR insufficient_privilege THEN
    RAISE NOTICE 'marketplace_role not found; skipping inventory REVOKE statements.';
END $$;

-- =============================================================================
-- POLICY SUMMARY (end-of-file reference)
-- =============================================================================
--
-- TABLE                    | POLICY NAME                            | PURPOSE / THREAT
-- -------------------------|----------------------------------------|------------------------------------
-- inventory_items          | inventory_items_select/insert/update   | Location→org scoped. Prevents cross-
--                          |                                        | tenant stock reads/writes.
--                          | inventory_items_delete                 | Service_role only; operators zero stock.
-- stock_movements          | stock_movements_select                 | Via inventory_item → location → org.
--                          | stock_movements_insert                 | Same chain.
--                          | stock_movements_update                 | USING(false) — ledger is append-only.
--                          | stock_movements_delete                 | Service_role only.
-- suppliers                | suppliers_select/insert/update         | Org-scoped vendor master.
--                          | suppliers_delete                       | Service_role only.
-- supplier_contacts        | (via supplier → org)                   | Contact details are supplier-child rows.
-- supplier_locations       | (via supplier → org)                   | Which locations buy from which supplier.
-- supplier_inventory_items | (via supplier → org)                   | Catalog mapping; org-scoped.
-- purchase_orders          | (via location → org)                   | PO is location-scoped.
-- purchase_order_items     | (via PO → location → org)              | PO line items inherit PO's scope.
-- goods_receipts           | (via PO → location → org)              | GRN header inherits PO's scope.
-- goods_receipt_items      | (via GR → PO → location → org)         | GRN lines inherit GRN's scope.
-- supplier_invoices        | (via location → org)                   | Invoice is location-scoped.
-- supplier_invoice_lines   | (via invoice → location → org)         | Invoice lines inherit invoice's scope.
-- ingredient_price_history | (via inventory_item → location → org)  | Price history scoped to ingredient owner.
--                          | ingredient_price_history_update        | USING(false) — append-only pricing log.
-- prep_batches             | (org-scoped directly)                  | Batch is org+location scoped.
-- prep_batch_inputs        | (via batch → org)                      | Inputs are immutable after batch creation.
--                          | prep_batch_inputs_update               | USING(false) — immutable after insert.
-- recipe_cost_runs         | recipe_cost_runs_all                   | USING+CHECK(is_service_role()) only.
--                          |                                        | System job table; no tenant visibility.
-- =============================================================================
