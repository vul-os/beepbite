// tracking.js — public order-tracking service.
// The /track/{token} endpoint is token-scoped and does NOT require a bearer
// token — the tracking token itself is the access key. We pass auth:false so
// no Authorization header is attached.

import { api } from '@/lib/api-client';

/**
 * Raw response shape returned by GET /track/{token}
 * (see backend/internal/handlers/tracking/store.go — OrderInfo):
 * {
 *   token: string, order_id: string,
 *   status: 'pending'|'confirmed'|'preparing'|'ready'|'out_for_delivery'
 *         |'delivered'|'completed'|'cancelled',
 *   fulfillment_type: string,
 *   estimated_delivery_time?: string,      // ISO timestamp, nullable
 *   store_lat?: number, store_lng?: number,
 *   delivery_address?: string,             // text label, always present when set
 *   delivery_lat?: number, delivery_lng?: number,  // only once out_for_delivery
 *   driver?: { lat: number, lng: number, recorded_at: string }
 * }
 *
 * The UI (track/index.jsx and friends) wants a friendlier normalised shape:
 * { status, eta_minutes, store: {lat,lng}|null,
 *   delivery_address: {lat,lng,label}|null, driver }
 * normalizeTracking() bridges the two so the page never has to know about
 * the flat wire format.
 */
function normalizeTracking(raw) {
  if (!raw) return raw;

  const hasStoreCoords = raw.store_lat != null && raw.store_lng != null;
  const hasDeliveryCoords = raw.delivery_lat != null && raw.delivery_lng != null;

  let etaMinutes = null;
  if (raw.estimated_delivery_time) {
    const diffMs = new Date(raw.estimated_delivery_time).getTime() - Date.now();
    if (Number.isFinite(diffMs)) etaMinutes = Math.max(0, Math.round(diffMs / 60000));
  }

  return {
    status: raw.status,
    fulfillmentType: raw.fulfillment_type,
    eta_minutes: etaMinutes,
    // The backend never sends a store name/address — only coordinates — so
    // there's no name/address field to carry through here.
    store: hasStoreCoords ? { lat: raw.store_lat, lng: raw.store_lng } : null,
    delivery_address: {
      lat: hasDeliveryCoords ? raw.delivery_lat : null,
      lng: hasDeliveryCoords ? raw.delivery_lng : null,
      label: raw.delivery_address || null,
    },
    driver: raw.driver ? { lat: raw.driver.lat, lng: raw.driver.lng } : null,
  };
}

/**
 * Fetch live tracking data for an order by its tracking token.
 *
 * @param {string} token  — URL-safe tracking token from the customer link
 * @returns {Promise<{ data: TrackingPayload | null, error: { message: string, status: number } | null }>}
 */
export async function fetchTracking(token) {
  if (!token) {
    return { data: null, error: { message: 'No tracking token provided', status: 400 } };
  }
  const { data, error } = await api.request('GET', `/track/${encodeURIComponent(token)}`, { auth: false });
  if (error) return { data: null, error };
  return { data: normalizeTracking(data), error: null };
}
