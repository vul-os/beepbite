// marketplace.js — public store discovery + store detail API calls.
// No auth required; calls use { auth: false } so no token is attached.

import { api } from '../lib/api-client';

export interface GetStoresParams {
  query?: string;
  city?: string;
  distance?: number;
  lat?: number;
  lng?: number;
  page?: number;
  limit?: number;
}

// Mirrors backend/internal/handlers/marketplace/store.go StoreListItem — the
// real shape of each element GET /stores actually returns. NOTE: several
// fields the discover-page UI reads (cuisine_type, rating, review_count,
// distance_km, is_open, cover_image_url, logo_url, currency variants,
// min/max_price_cents, delivery_time_min/max) do NOT exist on this DTO —
// the backend never sends them (avg_rating is the closest analog to
// `rating`, and is `null` whenever no visible reviews exist). This mismatch
// predates this migration; the index signature below preserves the existing
// defensive reads (always `unknown`/undefined at runtime) without asserting
// they're real, per project policy (flag, don't fix).
export interface Store {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  description: string | null;
  avg_rating: number | null;
  [key: string]: unknown;
}

export interface MarketplaceVariationOption {
  id: string;
  name: string;
  price_modifier: number;
}

export interface MarketplaceItemVariation {
  id: string;
  name: string;
  is_required: boolean;
  options: MarketplaceVariationOption[];
}

export interface MarketplaceMenuItem {
  id: string;
  name: string;
  description?: string | null;
  /** decimal string, e.g. "12.50" — kept as a string to avoid float noise. */
  price: string;
  image_url?: string | null;
  preparation_time_minutes: number;
  calories?: number | null;
  spice_level?: number | null;
  sort_order: number;
  remaining_today?: number | null;
}

export interface MarketplaceMenuCategory {
  id: string;
  name: string;
  description?: string | null;
  sort_order: number;
  items: MarketplaceMenuItem[];
}

// Mirrors backend/internal/handlers/marketplace/store.go StoreProfile — the
// real shape GET /stores/{slug} returns. checkout (pages/checkout/index.tsx)
// used to read `on_delivery_payment_methods` (array) and
// `payment_credentials` (array of {is_active}) to decide the payment mode —
// NEITHER field exists on this DTO, so `paymentMode` was permanently stuck
// on 'none' in production. Fixed: checkout now reads the field the backend
// actually sends, `online_payment_available: boolean` (deployment-wide, not
// per-method) — true selects the online flow, false falls back to
// on-delivery, mirroring checkout.go's own fallback behaviour.
export interface StoreDetail {
  id: string;
  name: string;
  slug: string | null;
  city: string | null;
  country: string | null;
  address: string | null;
  description: string | null;
  offers_delivery: boolean;
  offers_collection: boolean;
  estimated_prep_time_minutes: number;
  currency_code: string | null;
  avg_rating: number | null;
  review_count: number;
  categories: MarketplaceMenuCategory[];
  online_payment_available: boolean;
  [key: string]: unknown;
}

// Mirrors backend/internal/handlers/marketplace/checkout.go CheckoutResp —
// the real response of POST /stores/{slug}/orders.
export interface Order {
  order_id: string;
  order_number: string;
  status: string;
  payment_method: string;
  total: number;
  pay_url?: string;
  [key: string]: unknown;
}

// Mirrors backend/internal/handlers/marketplace/checkout.go CheckoutReq —
// the real request body POST /stores/{slug}/orders expects. customer_id is
// a reference to an existing customers row; guest checkout (no logged-in
// marketplace customer) must omit it rather than send an arbitrary string,
// since the backend inserts it verbatim as a foreign key.
export interface CheckoutOrderPayload {
  customer_id?: string;
  fulfillment_type: 'delivery' | 'collection' | 'dine_in';
  on_delivery_method?: string;
  delivery_address?: string;
  items: { item_id: string; quantity: number; notes?: string }[];
}

// Client-only concept (localStorage cart) — no backend schema. Derived from
// actual usage: pages/store/[slug]/components/cart-widget.jsx and
// checkout/index.tsx read {id, name, price, quantity}, but
// favorites-row.jsx's quick-add instead pushes {item_id, name, price_cents,
// image_url} — a different shape under the same array. Both are typed
// permissively (index signature) since neither call site validates a cart
// item's shape before use.
export interface CartItem {
  id?: string;
  item_id?: string;
  name?: string;
  price?: number;
  price_cents?: number;
  quantity?: number;
  [key: string]: unknown;
}

export interface CartMeta {
  fulfillment_type: 'delivery' | 'collection' | null;
  delivery_address: string;
}

/**
 * Search / list public stores.
 */
export async function getStores(params: GetStoresParams = {}) {
  const qs = new URLSearchParams();
  if (params.query)    qs.set('q', params.query);
  if (params.city)     qs.set('city', params.city);
  if (params.distance) qs.set('distance_km', String(params.distance));
  if (params.lat)      qs.set('lat', String(params.lat));
  if (params.lng)      qs.set('lng', String(params.lng));
  if (params.page)     qs.set('page', String(params.page));
  if (params.limit)    qs.set('limit', String(params.limit ?? 20));

  const path = `/stores${qs.toString() ? `?${qs.toString()}` : ''}`;
  return api.request<Store[]>('GET', path, { auth: false });
}

/**
 * Fetch a single store with its public menu.
 *
 * @param slug  — URL-friendly store identifier
 */
export async function getStore(slug: string) {
  return api.request<StoreDetail>('GET', `/stores/${encodeURIComponent(slug)}`, { auth: false });
}

/**
 * Place an order for a store.
 *
 * POST /stores/{slug}/orders — backend/internal/handlers/marketplace/
 * checkout.go createCheckoutOrder. There is no top-level `/orders` route;
 * the store slug is part of the path, not the body.
 *
 * @param slug     — the store's URL-friendly identifier
 * @param payload  — CheckoutReq-shaped body (see CheckoutOrderPayload)
 */
export async function createOrder(slug: string, payload: CheckoutOrderPayload) {
  return api.request<Order>('POST', `/stores/${encodeURIComponent(slug)}/orders`, { body: payload, auth: false });
}

// ── Cart helpers (localStorage, keyed by store slug) ──────────────────────────

const CART_PREFIX = 'bb.cart.';
const CART_META_PREFIX = 'bb.cartmeta.';

export function cartKey(slug: string) {
  return `${CART_PREFIX}${slug}`;
}

export function cartMetaKey(slug: string) {
  return `${CART_META_PREFIX}${slug}`;
}

export function readCart(slug: string): CartItem[] {
  try {
    const raw = localStorage.getItem(cartKey(slug));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function writeCart(slug: string, items: CartItem[] | null | undefined) {
  if (!items || items.length === 0) {
    localStorage.removeItem(cartKey(slug));
  } else {
    localStorage.setItem(cartKey(slug), JSON.stringify(items));
  }
}

export function clearCart(slug: string) {
  localStorage.removeItem(cartKey(slug));
}

/**
 * Read fulfillment metadata (fulfillment_type + delivery_address) for a cart.
 */
export function readCartMeta(slug: string): CartMeta {
  try {
    const raw = localStorage.getItem(cartMetaKey(slug));
    return raw ? JSON.parse(raw) : { fulfillment_type: null, delivery_address: '' };
  } catch {
    return { fulfillment_type: null, delivery_address: '' };
  }
}

/**
 * Write fulfillment metadata for a cart.
 */
export function writeCartMeta(slug: string, meta: CartMeta | null | undefined) {
  if (!meta || !meta.fulfillment_type) {
    localStorage.removeItem(cartMetaKey(slug));
  } else {
    localStorage.setItem(cartMetaKey(slug), JSON.stringify(meta));
  }
}
