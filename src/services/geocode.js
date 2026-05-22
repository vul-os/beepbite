// geocode.js — thin client over the backend geocode proxy.
//
// The backend owns the Mapbox token and biases results toward South Africa.
// We never expose a Mapbox token in the frontend; we only call our own proxy:
//
//   GET /geocode/suggest?q=<query>
//     → { suggestions: [ { place_name, street, suburb, city, postcode, lat, lng }, ... ] }
//
// suggestAddress() is intentionally forgiving: it returns an empty array on any
// error (network, non-2xx, malformed payload) so callers can degrade gracefully
// to plain manual entry.

import { api } from '../lib/api-client.js';

/**
 * Fetch address suggestions for a free-text query.
 * @param {string} query
 * @returns {Promise<Array<{place_name:string, street:string, suburb:string, city:string, postcode:string, lat:number, lng:number}>>}
 */
export async function suggestAddress(query) {
  const q = (query || '').trim();
  if (!q) return [];
  try {
    const { data, error } = await api.request(
      'GET',
      '/geocode/suggest?q=' + encodeURIComponent(q),
      { auth: false },
    );
    if (error || !data) return [];
    const list = Array.isArray(data.suggestions) ? data.suggestions : [];
    return list;
  } catch {
    return [];
  }
}
