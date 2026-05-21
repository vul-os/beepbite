// pickup-slots.js — public API calls for pickup time slot availability.
// No authentication required; the endpoint is intentionally public so the
// checkout page can call it before a customer logs in.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

/**
 * Fetch available pickup time slots for a location on a given date.
 *
 * @param {string} locationId   — UUID of the location
 * @param {string} date         — ISO date string "YYYY-MM-DD"
 * @returns {Promise<{ data: PickupSlot[], error: { message: string } | null }>}
 *
 * @typedef {Object} PickupSlot
 * @property {string}  slot_time   — ISO-8601 UTC timestamp of slot start
 * @property {number}  capacity    — max orders (0 = unlimited)
 * @property {number}  scheduled   — orders already booked in this slot
 * @property {boolean} is_full     — true when capacity > 0 && scheduled >= capacity
 */
export async function fetchPickupSlots(locationId, date) {
  if (!locationId || !date) {
    return { data: null, error: { message: 'locationId and date are required' } };
  }

  const url = `${API_URL}/locations/${encodeURIComponent(locationId)}/pickup-slots?date=${encodeURIComponent(date)}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const text = await res.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }

    if (!res.ok) {
      const msg = (payload && payload.error) || res.statusText || 'failed to fetch pickup slots';
      return { data: null, error: { message: msg, status: res.status } };
    }

    return { data: payload, error: null };
  } catch (err) {
    return { data: null, error: { message: err.message || 'network error' } };
  }
}
