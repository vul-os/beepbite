// customers.js — service helpers for the customer lookup endpoints.

import { api } from '@/lib/api-client';

export interface CustomerSearchResult {
  id: string;
  name: string;
  phone: string;
  email: string;
  total_orders: number;
  last_order_date: string | null;
}

/**
 * Search the caller's org's customers by phone (whatsapp_number) or name.
 *
 * @param q      Search term; matched with ILIKE against phone and name.
 * @param limit  Max results (1-100).
 */
export async function searchCustomers(q: string, limit = 20) {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return api.request<CustomerSearchResult[]>('GET', `/customers/search?${params.toString()}`);
}
