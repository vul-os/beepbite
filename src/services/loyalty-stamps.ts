// loyalty-stamps.js — service layer for the buy-N-get-1-free stamp programme.
//
// Endpoints (all require a valid auth session):
//
//   GET  /loyalty/stamps/config
//        → { organization_id, stamps_enabled, stamps_required, stamp_item_id, updated_at }
//
//   PUT  /loyalty/stamps/config
//        body { stamps_enabled, stamps_required, stamp_item_id? }
//        → same shape
//
//   GET  /customers/:customerId/stamps
//        → { customer_id, organization_id, stamps, stamps_required,
//            stamps_until_free, location_id, updated_at }
//
//   POST /customers/:customerId/stamps/accrue
//        body { count? }   (defaults to 1 when omitted)
//        → same shape + reward_earned: bool
//
// All functions return { data, error } matching the rest of the service layer.

import { api } from '@/lib/api-client';

export interface StampConfig {
  organization_id: string;
  stamps_enabled: boolean;
  stamps_required: number;
  stamp_item_id: string | null;
  updated_at: string;
}

export interface CustomerStamps {
  customer_id: string;
  organization_id: string;
  stamps: number;
  stamps_required: number;
  stamps_until_free: number;
  location_id: string;
  updated_at: string;
}

export interface AccrueResult extends CustomerStamps {
  reward_earned: boolean;
}

/**
 * Fetch the org's stamp programme configuration.
 */
export async function getStampConfig() {
  return api.request<StampConfig>('GET', '/loyalty/stamps/config');
}

/**
 * Save the org's stamp programme configuration.
 */
export async function setStampConfig({ stampsEnabled, stampsRequired, stampItemId }: {
  stampsEnabled: boolean;
  stampsRequired: number;
  stampItemId?: string | null;
}) {
  return api.request<StampConfig>('PUT', '/loyalty/stamps/config', {
    body: {
      stamps_enabled: stampsEnabled,
      stamps_required: stampsRequired,
      stamp_item_id: stampItemId ?? null,
    },
  });
}

/**
 * Fetch the current stamp count for a customer.
 *
 * @param customerId  — UUID of the customer
 */
export async function getCustomerStamps(customerId: string) {
  return api.request<CustomerStamps>('GET', `/customers/${customerId}/stamps`);
}

/**
 * Accrue stamps for a customer.
 *
 * When the running total reaches stamps_required the counter resets to 0 and
 * the response includes `reward_earned: true` — the caller is responsible for
 * issuing the free item or coupon.
 *
 * @param customerId  — UUID of the customer
 * @param count   — number of stamps to add (≥ 1)
 */
export async function accrueStamp(customerId: string, count = 1) {
  return api.request<AccrueResult>('POST', `/customers/${customerId}/stamps/accrue`, {
    body: { count },
  });
}
