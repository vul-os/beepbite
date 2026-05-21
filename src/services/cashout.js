// cashout.js — cash-out report service
//
// Thin wrapper around GET /cash-out/{session_id}. Returns the full shift
// reconciliation: opening float, cash sales, movements, expected vs counted,
// and the over/short variance.

import { api } from '@/lib/api-client';

/**
 * Fetch the cash-out report for a cash drawer session.
 *
 * @param {string} sessionId - UUID of the cash_drawer_session
 * @returns {Promise<{ data: import('./cashout').CashOutReport|null, error: Error|null }>}
 */
export async function fetchCashOut(sessionId) {
  const { data, error } = await api.request('GET', `/cash-out/${sessionId}`);
  return { data: data ?? null, error: error ?? null };
}
