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

export interface StoreDetail {
  [key: string]: unknown;
}

export interface Order {
  [key: string]: unknown;
}

export interface CartItem {
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
