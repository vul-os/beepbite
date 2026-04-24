-- ======================
-- SUPPLIERS & PURCHASING
-- Layers procurement (purchase orders, goods receipts, supplier invoices,
-- 3-way match, ingredient price history) on top of existing inventory_items
-- and stock_movements from init_schema.
-- ======================

-- TODO: attach updated_at trigger once set_updated_at() helper exists

-- ======================
-- SUPPLIERS
-- ======================

-- Suppliers (organization-scoped vendor master)
CREATE TABLE suppliers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    display_name text,
    tax_id text, -- e.g., VAT number
    payment_terms_days integer DEFAULT 30, -- net-30 etc.
    default_currency text NOT NULL DEFAULT 'ZAR' CHECK (char_length(default_currency) = 3),
    website text,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(organization_id, name)
);

-- Supplier contacts (people at the supplier)
CREATE TABLE supplier_contacts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    role text, -- "Sales Rep", "Accounts"
    email text,
    phone text,
    is_primary boolean DEFAULT false,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Supplier <-> location mapping (which locations buy from which suppliers)
CREATE TABLE supplier_locations (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE NOT NULL,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    account_number text, -- supplier's account number for this location
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(supplier_id, location_id)
);

-- Supplier catalog mapping: same inventory item can be sourced from multiple
-- suppliers at different prices and pack sizes.
CREATE TABLE supplier_inventory_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE NOT NULL,
    inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE CASCADE NOT NULL,
    supplier_sku text,
    pack_size decimal(12,4), -- e.g., 25 (for a 25kg bag of flour)
    pack_unit text, -- e.g., 'kg' - must match inventory_items.unit convention
    last_price_per_pack_cents bigint, -- most recent price per pack
    lead_time_days integer,
    is_preferred boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(supplier_id, inventory_item_id)
);

-- ======================
-- PURCHASE ORDERS
-- ======================

-- Purchase orders (header)
CREATE TABLE purchase_orders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
    po_number text NOT NULL, -- location-scoped, user-facing
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled', 'closed')),
    ordered_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    ordered_at timestamptz,
    expected_delivery_date date,
    delivered_at timestamptz,
    currency text NOT NULL DEFAULT 'ZAR',
    subtotal_cents bigint NOT NULL DEFAULT 0,
    tax_cents bigint NOT NULL DEFAULT 0,
    shipping_cents bigint NOT NULL DEFAULT 0,
    total_cents bigint NOT NULL DEFAULT 0,
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(location_id, po_number)
);

-- Purchase order line items
CREATE TABLE purchase_order_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
    inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE RESTRICT NOT NULL,
    supplier_inventory_item_id uuid REFERENCES supplier_inventory_items(id) ON DELETE SET NULL,
    ordered_quantity decimal(12,4) NOT NULL CHECK (ordered_quantity > 0),
    ordered_unit text NOT NULL, -- usually matches pack_unit
    ordered_unit_price_cents bigint NOT NULL CHECK (ordered_unit_price_cents >= 0),
    received_quantity decimal(12,4) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
    received_unit_price_cents bigint, -- may differ from ordered if supplier changed price on delivery
    line_total_cents bigint NOT NULL DEFAULT 0,
    notes text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ======================
-- GOODS RECEIPT
-- A single PO can be received across multiple shipments (partial deliveries).
-- ======================

-- Goods receipt event (physical arrival of a shipment)
CREATE TABLE goods_receipts (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE NOT NULL,
    receipt_number text,
    received_by uuid REFERENCES staff(id) ON DELETE SET NULL,
    received_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    delivery_note_number text, -- supplier's DN
    notes text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(purchase_order_id, receipt_number)
);

-- Goods receipt line items (what actually arrived in each receipt)
CREATE TABLE goods_receipt_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    goods_receipt_id uuid REFERENCES goods_receipts(id) ON DELETE CASCADE NOT NULL,
    purchase_order_item_id uuid REFERENCES purchase_order_items(id) ON DELETE CASCADE NOT NULL,
    quantity_received decimal(12,4) NOT NULL CHECK (quantity_received > 0),
    unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
    quality_ok boolean DEFAULT true,
    rejection_reason text,
    stock_movement_id uuid REFERENCES stock_movements(id) ON DELETE SET NULL, -- filled after stock bump
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ======================
-- SUPPLIER INVOICES (3-WAY MATCH)
-- Match supplier invoice against PO + GRN to detect price/qty variances.
-- ======================

-- Supplier invoice (header)
CREATE TABLE supplier_invoices (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE RESTRICT NOT NULL,
    location_id uuid REFERENCES locations(id) ON DELETE CASCADE NOT NULL,
    invoice_number text NOT NULL,
    invoice_date date NOT NULL,
    due_date date,
    subtotal_cents bigint NOT NULL DEFAULT 0,
    tax_cents bigint NOT NULL DEFAULT 0,
    total_cents bigint NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'ZAR',
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'disputed', 'approved', 'paid', 'cancelled')),
    match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'price_variance', 'qty_variance', 'matched')),
    paid_at timestamptz,
    notes text,
    pdf_url text,
    created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(supplier_id, invoice_number)
);

-- Supplier invoice lines (line-level mapping to PO item + GRN item for variance detection)
CREATE TABLE supplier_invoice_lines (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    supplier_invoice_id uuid REFERENCES supplier_invoices(id) ON DELETE CASCADE NOT NULL,
    purchase_order_item_id uuid REFERENCES purchase_order_items(id) ON DELETE SET NULL,
    goods_receipt_item_id uuid REFERENCES goods_receipt_items(id) ON DELETE SET NULL,
    description text, -- fallback when no PO link
    quantity decimal(12,4) NOT NULL CHECK (quantity > 0),
    unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
    line_total_cents bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ======================
-- INGREDIENT PRICE HISTORY
-- Auto-populated on goods receipt so recipe cost can be recomputed over time.
-- ======================

CREATE TABLE ingredient_price_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE CASCADE NOT NULL,
    supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
    source_type text NOT NULL CHECK (source_type IN ('goods_receipt', 'manual', 'supplier_catalog_sync', 'system_adjustment')),
    goods_receipt_item_id uuid REFERENCES goods_receipt_items(id) ON DELETE SET NULL,
    price_per_base_unit_cents bigint NOT NULL CHECK (price_per_base_unit_cents >= 0), -- normalized to inventory_items.unit
    effective_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    recorded_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
    notes text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- ======================
-- INDEXES FOR PERFORMANCE
-- ======================

-- Suppliers
CREATE INDEX idx_suppliers_organization ON suppliers(organization_id);

-- Supplier contacts
CREATE INDEX idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);

-- Supplier locations
CREATE INDEX idx_supplier_locations_supplier ON supplier_locations(supplier_id);
CREATE INDEX idx_supplier_locations_location ON supplier_locations(location_id);

-- Supplier inventory items
CREATE INDEX idx_supplier_inventory_items_supplier ON supplier_inventory_items(supplier_id);
CREATE INDEX idx_supplier_inventory_items_inventory_item ON supplier_inventory_items(inventory_item_id);

-- Purchase orders
CREATE INDEX idx_purchase_orders_location_status ON purchase_orders(location_id, status);
CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_expected_delivery ON purchase_orders(expected_delivery_date);

-- Purchase order items
CREATE INDEX idx_purchase_order_items_purchase_order ON purchase_order_items(purchase_order_id);
CREATE INDEX idx_purchase_order_items_inventory_item ON purchase_order_items(inventory_item_id);

-- Goods receipts
CREATE INDEX idx_goods_receipts_purchase_order ON goods_receipts(purchase_order_id);
CREATE INDEX idx_goods_receipts_received_at ON goods_receipts(received_at);

-- Goods receipt items
CREATE INDEX idx_goods_receipt_items_goods_receipt ON goods_receipt_items(goods_receipt_id);
CREATE INDEX idx_goods_receipt_items_purchase_order_item ON goods_receipt_items(purchase_order_item_id);

-- Supplier invoices
CREATE INDEX idx_supplier_invoices_supplier ON supplier_invoices(supplier_id);
CREATE INDEX idx_supplier_invoices_location ON supplier_invoices(location_id);
CREATE INDEX idx_supplier_invoices_status ON supplier_invoices(status);
CREATE INDEX idx_supplier_invoices_due_date ON supplier_invoices(due_date);

-- Supplier invoice lines
CREATE INDEX idx_supplier_invoice_lines_supplier_invoice ON supplier_invoice_lines(supplier_invoice_id);
CREATE INDEX idx_supplier_invoice_lines_purchase_order_item ON supplier_invoice_lines(purchase_order_item_id);

-- Ingredient price history
CREATE INDEX idx_ingredient_price_history_item_effective ON ingredient_price_history(inventory_item_id, effective_at DESC);
CREATE INDEX idx_ingredient_price_history_supplier ON ingredient_price_history(supplier_id);
