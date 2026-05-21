import { api } from '../lib/api-client.js';

/**
 * Wallet service — wraps the /wallet endpoints.
 *
 * Endpoints:
 *   GET  /wallet                        → { balance_cents, hold_cents, currency_code,
 *                                           auto_refill_enabled, auto_refill_threshold_cents,
 *                                           auto_refill_target_cents, payment_method_token }
 *   GET  /wallet/transactions?limit=N   → array of { id, kind, amount_cents, reason,
 *                                           balance_after_cents, created_at }
 *   POST /wallet/topup                  body { amount_cents } → { id, status, amount_cents }
 *   PUT  /wallet/auto-refill            body { enabled, threshold_cents, target_cents }
 */

/**
 * Fetch the current wallet state for the authenticated org.
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function fetchWallet() {
  return api.request('GET', '/wallet');
}

/**
 * Fetch recent wallet transactions.
 * @param {number} [limit=50]
 * @returns {Promise<{ data: Array, error: object }>}
 */
export async function fetchTransactions(limit = 50) {
  const qs = new URLSearchParams({ limit: String(limit) });
  return api.request('GET', `/wallet/transactions?${qs.toString()}`);
}

/**
 * Top up the wallet by the given amount.
 * @param {number} amountCents  — integer cents
 * @returns {Promise<{ data: { id, status, amount_cents }, error: object }>}
 */
export async function topup(amountCents) {
  return api.request('POST', '/wallet/topup', { body: { amount_cents: amountCents } });
}

/**
 * Update auto-refill settings.
 * @param {{ enabled: boolean, thresholdCents: number, targetCents: number }} opts
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function setAutoRefill({ enabled, thresholdCents, targetCents }) {
  return api.request('PUT', '/wallet/auto-refill', {
    body: {
      enabled,
      threshold_cents: thresholdCents,
      target_cents: targetCents,
    },
  });
}
