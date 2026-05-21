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

/**
 * Fetch the org's stamp programme configuration.
 *
 * @returns {Promise<{ data: StampConfig, error: object }>}
 *   StampConfig: { organization_id, stamps_enabled, stamps_required, stamp_item_id, updated_at }
 */
export async function getStampConfig() {
  return api.request('GET', '/loyalty/stamps/config');
}

/**
 * Save the org's stamp programme configuration.
 *
 * @param {{ stampsEnabled: boolean, stampsRequired: number, stampItemId?: string|null }} opts
 * @returns {Promise<{ data: StampConfig, error: object }>}
 */
export async function setStampConfig({ stampsEnabled, stampsRequired, stampItemId }) {
  return api.request('PUT', '/loyalty/stamps/config', {
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
 * @param {string} customerId  — UUID of the customer
 * @returns {Promise<{ data: CustomerStamps, error: object }>}
 *   CustomerStamps: { customer_id, organization_id, stamps, stamps_required,
 *                     stamps_until_free, location_id, updated_at }
 */
export async function getCustomerStamps(customerId) {
  return api.request('GET', `/customers/${customerId}/stamps`);
}

/**
 * Accrue stamps for a customer.
 *
 * When the running total reaches stamps_required the counter resets to 0 and
 * the response includes `reward_earned: true` — the caller is responsible for
 * issuing the free item or coupon.
 *
 * @param {string} customerId  — UUID of the customer
 * @param {number} [count=1]   — number of stamps to add (≥ 1)
 * @returns {Promise<{ data: AccrueResult, error: object }>}
 *   AccrueResult: CustomerStamps & { reward_earned: boolean }
 */
export async function accrueStamp(customerId, count = 1) {
  return api.request('POST', `/customers/${customerId}/stamps/accrue`, {
    body: { count },
  });
}
