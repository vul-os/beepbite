// quick-coupon.js — service helpers for the quick coupon generation endpoints.

import { api } from '@/lib/api-client';

export interface QuickCouponPayload {
  customer_id?: string;
  percent_off?: number;
  amount_off_cents?: number;
  expires_in_days?: number;
}

export interface QuickCoupon {
  id: string;
  promotion_id: string;
  code: string;
  percent_off: number | null;
  fixed_off_cents: number | null;
  customer_id: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Create a quick coupon for (optionally) a specific customer.
 */
export async function createQuickCoupon(payload: QuickCouponPayload) {
  return api.request<QuickCoupon>('POST', '/quick-coupons/', { body: payload });
}

/**
 * List quick coupons issued by this org, optionally filtered by customer.
 *
 * @param customerId  UUID of the customer, or omit for all.
 */
export async function listQuickCoupons(customerId?: string | null) {
  const qs = customerId ? `?customer_id=${encodeURIComponent(customerId)}` : '';
  return api.request<QuickCoupon[]>('GET', `/quick-coupons/${qs}`);
}
