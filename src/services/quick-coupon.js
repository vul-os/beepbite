// quick-coupon.js — service helpers for the quick coupon generation endpoints.

import { api } from '@/lib/api-client';

/**
 * Create a quick coupon for (optionally) a specific customer.
 *
 * @param {{ customer_id?: string, percent_off?: number, amount_off_cents?: number, expires_in_days?: number }} payload
 * @returns {Promise<{ data: { id, promotion_id, code, percent_off, fixed_off_cents, customer_id, expires_at, is_active, created_at } | null, error: any }>}
 */
export async function createQuickCoupon(payload) {
  return api.request('POST', '/quick-coupons/', { body: payload });
}

/**
 * List quick coupons issued by this org, optionally filtered by customer.
 *
 * @param {string | null | undefined} customerId  UUID of the customer, or omit for all.
 * @returns {Promise<{ data: Array | null, error: any }>}
 */
export async function listQuickCoupons(customerId) {
  const qs = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : '';
  return api.request('GET', `/quick-coupons/${qs}`);
}
