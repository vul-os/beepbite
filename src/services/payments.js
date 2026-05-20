import { api } from '../lib/api-client.js';

/**
 * Payments service — wraps the /payment-credentials endpoints.
 *
 * Endpoints (T8.4a):
 *   GET    /payment-credentials?location_id=<id>
 *   POST   /payment-credentials
 *   DELETE /payment-credentials/:id
 *   POST   /payment-credentials/:id/test
 */

/**
 * List all payment credentials for a location.
 * Returns an array of credential records (secrets are NOT returned).
 */
export async function listPaymentCredentials(locationId) {
  const params = new URLSearchParams({ location_id: locationId });
  return api.request('GET', `/payment-credentials?${params.toString()}`);
}

/**
 * Create / update payment credentials for a provider at a location.
 * @param {Object} payload
 * @param {string} payload.location_id
 * @param {string} payload.provider   — "paystack" | "stripe" | "payfast"
 * @param {string} payload.secret_key
 * @param {string} payload.public_key
 * @param {string} [payload.webhook_secret]
 */
export async function savePaymentCredentials(payload) {
  return api.request('POST', '/payment-credentials', { body: payload });
}

/**
 * Delete / disconnect a payment credential by ID.
 */
export async function deletePaymentCredentials(credentialId) {
  return api.request('DELETE', `/payment-credentials/${credentialId}`);
}

/**
 * Test the connection for an existing payment credential.
 * Returns { ok: boolean, message: string }.
 */
export async function testPaymentCredentials(credentialId) {
  return api.request('POST', `/payment-credentials/${credentialId}/test`);
}

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
