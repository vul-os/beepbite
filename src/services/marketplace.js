// marketplace.js — public store discovery + store detail API calls.
// No auth required; calls use { auth: false } so no token is attached.

import { api } from '../lib/api-client.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

/**
 * Search / list public stores.
 *
 * @param {{ query?: string, city?: string, distance?: number, lat?: number, lng?: number, page?: number, limit?: number }} params
 * @returns {Promise<{ data: Store[], error: any }>}
 */
export async function getStores(params = {}) {
  const qs = new URLSearchParams();
  if (params.query)    qs.set('q', params.query);
  if (params.city)     qs.set('city', params.city);
  if (params.distance) qs.set('distance_km', String(params.distance));
  if (params.lat)      qs.set('lat', String(params.lat));
  if (params.lng)      qs.set('lng', String(params.lng));
  if (params.page)     qs.set('page', String(params.page));
  if (params.limit)    qs.set('limit', String(params.limit ?? 20));

  const path = `/stores${qs.toString() ? `?${qs.toString()}` : ''}`;
  return api.request('GET', path, { auth: false });
}

/**
 * Fetch a single store with its public menu.
 *
 * @param {string} slug  — URL-friendly store identifier
 * @returns {Promise<{ data: StoreDetail, error: any }>}
 */
export async function getStore(slug) {
  return api.request('GET', `/stores/${encodeURIComponent(slug)}`, { auth: false });
}

/**
 * Place an order for a store.
 * Placeholder until the real checkout endpoint is wired up.
 *
 * @param {object} payload  — { store_slug, items, fulfillment, tip, customer }
 * @returns {Promise<{ data: Order, error: any }>}
 */
export async function createOrder(payload) {
  return api.request('POST', '/orders', { body: payload, auth: false });
}

// ── Cart helpers (localStorage, keyed by store slug) ──────────────────────────

const CART_PREFIX = 'bb.cart.';
const CART_META_PREFIX = 'bb.cartmeta.';

export function cartKey(slug) {
  return `${CART_PREFIX}${slug}`;
}

export function cartMetaKey(slug) {
  return `${CART_META_PREFIX}${slug}`;
}

export function readCart(slug) {
  try {
    const raw = localStorage.getItem(cartKey(slug));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function writeCart(slug, items) {
  if (!items || items.length === 0) {
    localStorage.removeItem(cartKey(slug));
  } else {
    localStorage.setItem(cartKey(slug), JSON.stringify(items));
  }
}

export function clearCart(slug) {
  localStorage.removeItem(cartKey(slug));
}

/**
 * Read fulfillment metadata (fulfillment_type + delivery_address) for a cart.
 *
 * @param {string} slug
 * @returns {{ fulfillment_type: 'delivery'|'collection'|null, delivery_address: string }}
 */
export function readCartMeta(slug) {
  try {
    const raw = localStorage.getItem(cartMetaKey(slug));
    return raw ? JSON.parse(raw) : { fulfillment_type: null, delivery_address: '' };
  } catch {
    return { fulfillment_type: null, delivery_address: '' };
  }
}

/**
 * Write fulfillment metadata for a cart.
 *
 * @param {string} slug
 * @param {{ fulfillment_type: string, delivery_address: string }} meta
 */
export function writeCartMeta(slug, meta) {
  if (!meta || !meta.fulfillment_type) {
    localStorage.removeItem(cartMetaKey(slug));
  } else {
    localStorage.setItem(cartMetaKey(slug), JSON.stringify(meta));
  }
}
