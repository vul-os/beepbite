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

export interface RecentOrderModifier {
  modifier_id: string;
  name: string;
  price_cents: number;
}

export interface RecentOrderItem {
  item_id: string;
  item_name: string;
  quantity: number;
  modifiers: RecentOrderModifier[];
}

export interface RecentOrder {
  id: string;
  order_number: string;
  created_at: string;
  total_cents: number;
  items: RecentOrderItem[];
}

interface FetchError extends Error {
  status?: number;
}

/**
 * Fetch the most recent orders for a customer so staff can clone one into cart.
 *
 * @param customerId  - UUID of the customer
 * @param limit   - Number of past orders to return (1–20)
 * @throws {Error} - On HTTP error or network failure
 */
export async function fetchRecentOrders(customerId: string, limit = 3): Promise<RecentOrder[]> {
  if (!customerId) throw new Error('customerId is required');

  const qs = new URLSearchParams({ limit: String(limit) });
  const { data, error } = await api.request<RecentOrder[]>(
    'GET',
    `/customers/${encodeURIComponent(customerId)}/recent-orders?${qs}`,
  );

  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to fetch recent orders');
    e.status = error.status;
    throw e;
  }

  return Array.isArray(data) ? data : [];
}
