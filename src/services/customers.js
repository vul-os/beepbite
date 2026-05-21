// customers.js — service helpers for the customer lookup endpoints.

import { api } from '@/lib/api-client';

/**
 * Search the caller's org's customers by phone (whatsapp_number) or name.
 *
 * @param {string}  q      Search term; matched with ILIKE against phone and name.
 * @param {number}  [limit=20]  Max results (1-100).
 * @returns {Promise<{ data: Array<{id, name, phone, email, total_orders, last_order_date}>, error }>}
 */
export async function searchCustomers(q, limit = 20) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return api.request('GET', `/customers/search?${params.toString()}`);
}
