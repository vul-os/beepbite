// marketplace.js — public store discovery + store detail API calls.
// No auth required; calls use { auth: false } so no token is attached.

import { api } from '../lib/api-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

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
// real shape GET /stores/{slug} returns. NOTE: checkout (pages/checkout/
// index.tsx) reads `on_delivery_payment_methods` (array) and
// `payment_credentials` (array of {is_active}) to decide the payment mode —
// NEITHER field exists on this DTO. The only payment-related field the
// backend actually sends is `online_payment_available: boolean`
// (deployment-wide, not per-method). Since those two fields are always
// undefined, checkout's `paymentMode` resolves to 'none' for every store in
// production — a pre-existing defect, flagged not fixed. The index
// signature preserves that exact (dead) read.
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
// the real response of POST /stores/{slug}/orders. NOTE: this page's
// createOrder() actually POSTs to `/orders` (see below), a route that is
// NOT registered anywhere in the Go backend — confirmed by grepping every
// `r.Post(...)` route table. That 404 is expected and already handled by
// checkout/index.tsx's own "Placeholder success for dev — real endpoint not
// yet wired up" fallback (its comment, not this one). Even if `/orders`
// were later pointed at this handler, checkout reads `data?.id`, but the
// real field is `order_id` — another latent mismatch preserved via the
// index signature rather than fixed.
export interface Order {
  order_id: string;
  order_number: string;
  status: string;
  payment_method: string;
  total: number;
  pay_url?: string;
  [key: string]: unknown;
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
 * Placeholder until the real checkout endpoint is wired up.
 *
 * @param payload  — { store_slug, items, fulfillment, tip, customer }
 */
export async function createOrder(payload: unknown) {
  return api.request<Order>('POST', '/orders', { body: payload, auth: false });
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
