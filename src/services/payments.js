import { api } from '../lib/api-client.js';

/**
 * Payments service — on-delivery settlement helpers.
 *
 * BeepBite does not broker online payments, so there are no gateway
 * credentials to manage. What remains is recording that an order which was
 * handed over unpaid has since been settled in cash or on a card machine.
 */

/**
 * Mark a pending_on_delivery order as paid (staff PIN-gated, capability: can_settle).
 *
 * @param {string} orderId
 * @param {'cash'|'card_machine'} method
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function markPaidOnDelivery(orderId, method) {
  return api.request('POST', `/orders/${encodeURIComponent(orderId)}/mark-paid-on-delivery`, {
    body: { method },
  });
}
