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

export interface Special {
  id: string;
  name: string;
  location_id: string;
  price_cents: number;
  special_price_cents: number | null;
  special_date: string | null;
  image_url: string | null;
}

export interface SetItemSpecialPayload {
  is_daily_special: boolean;
  special_price_cents?: number | null;
  special_date?: string | null;
}

interface FetchError extends Error {
  status?: number;
}

/**
 * Fetch today's specials for a location.
 *
 * @param locationId  - UUID of the location to fetch specials for
 * @throws {Error}     - On HTTP error or network failure
 */
export async function fetchSpecials(locationId: string): Promise<Special[]> {
  if (!locationId) throw new Error('locationId is required');

  const qs = new URLSearchParams({ location_id: locationId });
  const { data, error } = await api.request<Special[]>('GET', `/specials?${qs}`);

  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to fetch specials');
    e.status = error.status;
    throw e;
  }

  return Array.isArray(data) ? data : [];
}

/**
 * Toggle or update an item's daily-special status.
 * Requires the caller to have owner or manager role.
 *
 * @param itemId - UUID of the item to update
 * @throws {Error} - On HTTP error or network failure
 */
export async function setItemSpecial(itemId: string, payload: SetItemSpecialPayload) {
  if (!itemId) throw new Error('itemId is required');

  const { data, error } = await api.request<{ item_id: string; is_daily_special: boolean }>(
    'PUT', `/items/${encodeURIComponent(itemId)}/special`,
    { body: payload },
  );

  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to update special');
    e.status = error.status;
    throw e;
  }

  return data;
}
