// Payment service helpers — thin wrappers around POS charge endpoints and
// client-side currency utilities. Used by the POS workspace checkout flow.

import { api } from '@/lib/api-client';

// ---- Payment method catalogue -----------------------------------------------

/**
 * Ordered list of payment methods rendered in the v1 checkout UI.
 * The backend supports additional codes (eft, gift_card, store_credit, etc.);
 * extend this array to expose them in future UI versions.
 */
export const PAYMENT_METHODS = [
  { code: 'cash',           label: 'Cash', icon: '💵' },
  { code: 'card_in_person', label: 'Card', icon: '💳' },
];

// ---- Charge -----------------------------------------------------------------

/**
 * Charge a POS order. Throws an Error with .status on non-2xx.
 * Route: POST /pos/orders/{order_id}/charge
 * Returns: { order_id, payment_id, payment_status, session_closed }
 */
export async function chargeOrder({
  orderId,
  paymentMethodCode,
  amountPaidCents,
  tipAmountCents,
  changeGivenCents,
  paymentReference,
  processedByStaffId,
}) {
  if (!orderId) throw new Error('orderId required');
  if (!paymentMethodCode) throw new Error('paymentMethodCode required');

  const body = {
    payment_method_code: paymentMethodCode,
    amount_paid_cents: amountPaidCents,
  };
  if (tipAmountCents != null)       body.tip_amount_cents       = tipAmountCents;
  if (changeGivenCents != null)     body.change_given_cents     = changeGivenCents;
  if (paymentReference)             body.payment_reference      = paymentReference;
  if (processedByStaffId)           body.processed_by_staff_id  = processedByStaffId;

  const { data, error } = await api.request(
    'POST',
    `/pos/orders/${encodeURIComponent(orderId)}/charge`,
    { body },
  );
  if (error) {
    const e = new Error(error.message || 'Failed to charge order');
    e.status = error.status;
    throw e;
  }
  return data;
}

// ---- Currency utilities -----------------------------------------------------

/**
 * Convert integer cents to a "R XX.XX" display string.
 * e.g. 1250 → "R 12.50"
 */
export function formatRand(cents) {
  const n = typeof cents === 'number' ? cents : Number(cents) || 0;
  return `R ${(n / 100).toFixed(2)}`;
}

/**
 * Parse a Rand value (number or string) to integer cents.
 * e.g. "12.50" → 1250, "12" → 1200, 12.5 → 1250. Negative input returns 0.
 */
export function centsFromRand(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  if (isNaN(n) || n < 0) return 0;
  return Math.round(n * 100);
}
