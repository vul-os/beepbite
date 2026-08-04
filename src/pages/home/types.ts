// Shared types for the dashboard (/home) surface — mirrors
// backend/migrations/001_baseline.sql tables. Kept local to this page (the
// way kds/types.ts and inventory/types.ts are) since components here read
// bespoke join shapes off supabase-client, not a single backend DTO.

// ---- Customers (joined onto orders) ----------------------------------------

// Mirrors backend/migrations/001_baseline.sql `customers` table (subset
// selected by the `orders` queries in this page).
export interface HomeOrderCustomer {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  whatsapp_number?: string | null;
  email?: string | null;
}

// ---- Orders ------------------------------------------------------------------

// Mirrors backend/migrations/001_baseline.sql `orders` table (subset read via
// `supabase.from('orders').select('*, customers(...)')` across this page).
export interface HomeOrder {
  id: string;
  order_number: string;
  status: string;
  order_type?: string | null;
  delivery_address?: string | null;
  delivery_instructions?: string | null;
  notes?: string | null;
  kitchen_notes?: string | null;
  estimated_prep_time?: number | null;
  created_at: string;
  updated_at?: string;
  subtotal_cents?: number | null;
  tax_cents?: number | null;
  total_cents?: number | null;
  customers?: HomeOrderCustomer | null;
  [key: string]: unknown;
}

// The `items` join alias used by the order_items select (id/name/description
// only — see orders-section.jsx's `items ( id, name, description )`).
export interface HomeOrderItemJoinItem {
  id?: string;
  name?: string;
  description?: string | null;
}

// Mirrors backend/migrations/001_baseline.sql `order_item_modifiers` table.
export interface HomeOrderItemModifier {
  name_snapshot: string;
  price_cents_snapshot: number;
}

// Mirrors backend/migrations/001_baseline.sql `order_items` table, joined
// with `items` and `order_item_modifiers` the way orders-section.jsx,
// order-modal.jsx and return-modal.jsx each independently query it.
//
// NOTE: `total_price` / `unit_price` are NOT real order_items columns — the
// migration only has `total_price_cents` / `unit_price_cents`. All three call
// sites above read the unprefixed names anyway (a pre-existing dead read that
// always falls through to 0 via `toMinor`'s `|| 0`). Flagged, not fixed.
export interface HomeOrderItem {
  id: string;
  order_id?: string;
  item_id?: string;
  quantity: number | string;
  unit_price_cents?: number;
  total_price_cents?: number;
  special_instructions?: string | null;
  items?: HomeOrderItemJoinItem | null;
  order_item_modifiers?: HomeOrderItemModifier[];
  // Dead defensive reads — see NOTE above.
  total_price?: number | string;
  unit_price?: number | string;
  name?: string;
  item_name?: string;
}

export interface HomeOrderDetails extends HomeOrder {
  order_items?: HomeOrderItem[];
}

// Editable fields tracked by OrdersSection's inline edit view.
export interface HomeOrderEditFormData {
  delivery_address?: string;
  delivery_instructions?: string;
  notes?: string;
  kitchen_notes?: string;
  estimated_prep_time?: number;
}

// ---- Menu items / cart (legacy variation system) ----------------------------
//
// `item_variations` / `item_variation_options` predate the modifier_groups
// system (see quick-pos's KioskModifierGroup) and have no backing table in
// backend/migrations/001_baseline.sql — these components
// (cart-section/pos-section/order-modal) are not reachable from home/index.jsx
// or from any other in-scope page; they're dead code kept for the POS
// workspace's own cart flow (out of scope). Typed permissively, not fixed.

export interface HomeItemVariationOption {
  id: string;
  name: string;
  price_modifier: number | string;
}

export interface HomeItemVariation {
  id: string;
  name: string;
  is_required?: boolean;
  item_variation_options?: HomeItemVariationOption[];
}

// Mirrors backend/migrations/001_baseline.sql `items` table (subset), plus
// the legacy `item_variations` and a `categories` join alias.
export interface HomeMenuItem {
  id: string;
  name: string;
  description?: string | null;
  price: number | string;
  item_variations?: HomeItemVariation[];
  categories?: { name?: string } | null;
  [key: string]: unknown;
}

export interface HomeCartVariationDetail {
  variationName: string;
  optionName: string;
  priceModifier: number;
}

// Client-side cart line — built by the POS workspace's own cart state (out of
// scope); shaped here only enough for cart-section/order-modal to render it.
export interface HomeCartItem extends HomeMenuItem {
  cartItemKey: string;
  quantity: number;
  variationDetails?: HomeCartVariationDetail[];
}

// Mirrors backend/migrations/001_baseline.sql `categories` table (subset).
export interface HomeCategory {
  id: string;
  name: string;
  sort_order?: number;
}
