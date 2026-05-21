// reorder.js — service helpers for the "quick re-order / the usual?" feature.
//
// Wraps the backend endpoint:
//   GET /customers/{customer_id}/recent-orders?limit=N
//
// Each order in the response has the shape:
//   {
//     id, order_number, created_at, total_cents,
//     items: [
//       { item_id, item_name, quantity, modifiers: [{ modifier_id, name, price_cents }] }
//     ]
//   }

import { api } from '@/lib/api-client';

/**
 * Fetch the most recent orders for a customer so staff can clone one into cart.
 *
 * @param {string} customerId  - UUID of the customer
 * @param {number} [limit=3]   - Number of past orders to return (1–20)
 * @returns {Promise<Array>}   - Array of RecentOrder objects, newest first
 * @throws {Error}             - On HTTP error or network failure
 */
export async function fetchRecentOrders(customerId, limit = 3) {
  if (!customerId) throw new Error('customerId is required');

  const qs = new URLSearchParams({ limit: String(limit) });
  const { data, error } = await api.request(
    'GET',
    `/customers/${encodeURIComponent(customerId)}/recent-orders?${qs}`,
  );

  if (error) {
    const e = new Error(error.message || 'Failed to fetch recent orders');
    e.status = error.status;
    throw e;
  }

  return Array.isArray(data) ? data : [];
}
