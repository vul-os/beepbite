// tracking.js — public order-tracking service.
// The /track/{token} endpoint is token-scoped and does NOT require a bearer
// token — the tracking token itself is the access key. We pass auth:false so
// no Authorization header is attached.

import { api } from '@/lib/api-client';

/**
 * Fetch live tracking data for an order by its tracking token.
 *
 * Expected response shape (partial — backend controls exact fields):
 * {
 *   status: 'placed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'canceled',
 *   store:  { lat: number, lng: number, name: string, address?: string },
 *   delivery_address: { lat: number, lng: number, label?: string },
 *   eta_minutes: number | null,
 *   driver?: { lat: number, lng: number }   // omitted unless privacy gate passes
 * }
 *
 * @param {string} token  — URL-safe tracking token from the customer link
 * @returns {Promise<{ data: TrackingPayload | null, error: { message: string, status: number } | null }>}
 */
export async function fetchTracking(token) {
  if (!token) {
    return { data: null, error: { message: 'No tracking token provided', status: 400 } };
  }
  return api.request('GET', `/track/${encodeURIComponent(token)}`, { auth: false });
}
