// cashout.js — cash-out report service
//
// Thin wrapper around GET /cash-out/{session_id}. Returns the full shift
// reconciliation: opening float, cash sales, movements, expected vs counted,
// and the over/short variance.

import { api } from '@/lib/api-client';

export interface CashOutReport {
  opening_float: number;
  cash_sales: number;
  movements: unknown[];
  expected: number;
  counted: number;
  variance: number;
  [key: string]: unknown;
}

/**
 * Fetch the cash-out report for a cash drawer session.
 *
 * @param sessionId - UUID of the cash_drawer_session
 */
export async function fetchCashOut(sessionId: string) {
  const { data, error } = await api.request<CashOutReport>('GET', `/cash-out/${sessionId}`);
  return { data: data ?? null, error: error ?? null };
}
