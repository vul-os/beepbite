// specials.js — service helpers for the daily-specials feature (Wave 32).
//
// Backend endpoints:
//   GET  /specials?location_id=<uuid>   — list today's specials (any auth'd member)
//   PUT  /items/<item_id>/special       — toggle item as a special (owner/manager)
//
// Response shape for GET /specials (array of):
//   {
//     id:                  string,   // item UUID
//     name:                string,
//     location_id:         string,
//     price_cents:         number,   // base price in cents
//     special_price_cents: number | null,  // promotional price; null = regular price
//     special_date:        string | null,  // ISO date or null (always-on)
//     image_url:           string | null,
//   }

import { api } from '@/lib/api-client';

/**
 * Fetch today's specials for a location.
 *
 * @param {string} locationId  - UUID of the location to fetch specials for
 * @returns {Promise<Array>}   - Array of Special objects (empty when none)
 * @throws {Error}             - On HTTP error or network failure
 */
export async function fetchSpecials(locationId) {
  if (!locationId) throw new Error('locationId is required');

  const qs = new URLSearchParams({ location_id: locationId });
  const { data, error } = await api.request('GET', `/specials?${qs}`);

  if (error) {
    const e = new Error(error.message || 'Failed to fetch specials');
    e.status = error.status;
    throw e;
  }

  return Array.isArray(data) ? data : [];
}

/**
 * Toggle or update an item's daily-special status.
 * Requires the caller to have owner or manager role.
 *
 * @param {string} itemId - UUID of the item to update
 * @param {{ is_daily_special: boolean, special_price_cents?: number|null, special_date?: string|null }} payload
 * @returns {Promise<{ item_id: string, is_daily_special: boolean }>}
 * @throws {Error} - On HTTP error or network failure
 */
export async function setItemSpecial(itemId, payload) {
  if (!itemId) throw new Error('itemId is required');

  const { data, error } = await api.request('PUT', `/items/${encodeURIComponent(itemId)}/special`, {
    body: payload,
  });

  if (error) {
    const e = new Error(error.message || 'Failed to update special');
    e.status = error.status;
    throw e;
  }

  return data;
}
