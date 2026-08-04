// pickup-slots.js — public API calls for pickup time slot availability.
// No authentication required; the endpoint is intentionally public so the
// checkout page can call it before a customer logs in.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export interface PickupSlot {
  /** ISO-8601 UTC timestamp of slot start */
  slot_time: string;
  /** max orders (0 = unlimited) */
  capacity: number;
  /** orders already booked in this slot */
  scheduled: number;
  /** true when capacity > 0 && scheduled >= capacity */
  is_full: boolean;
}

/**
 * Fetch available pickup time slots for a location on a given date.
 *
 * @param locationId   — UUID of the location
 * @param date         — ISO date string "YYYY-MM-DD"
 */
export async function fetchPickupSlots(
  locationId: string,
  date: string,
): Promise<{ data: PickupSlot[] | null; error: { message: string; status?: number } | null }> {
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
    let payload: any = null;
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }

    if (!res.ok) {
      const msg = (payload && payload.error) || res.statusText || 'failed to fetch pickup slots';
      return { data: null, error: { message: msg, status: res.status } };
    }

    return { data: payload, error: null };
  } catch (err) {
    return { data: null, error: { message: (err as Error)?.message || 'network error' } };
  }
}
