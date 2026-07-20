// Payment service helpers — thin wrappers around POS charge endpoints and
// client-side currency utilities. Used by the POS workspace checkout flow.

import { api } from '@/lib/api-client';

// ---- Payment method catalogue -----------------------------------------------

/**
 * Ordered list of payment methods rendered in the checkout UI.
 *
 * These codes must exist in the backend's payment_methods table — order_payments
 * has a foreign key to it, so an unknown code is rejected outright.
 *
 * 'card_in_person' means the shop ran the card on its OWN machine. BeepBite
 * records the amount and the slip reference; it never processes a card.
 */
export const PAYMENT_METHODS = [
  { code: 'cash',           label: 'Cash', icon: '💵' },
  { code: 'card_in_person', label: 'Card', icon: '💳' },
  { code: 'eft',            label: 'Transfer', icon: '🏦' },
];

// ---- Charge -----------------------------------------------------------------

/**
 * Charge a POS order. Supports both single-payment (legacy) and split-tender
 * (multi-leg) modes.
 *
 * Single-payment (legacy):
 *   chargeOrder({ orderId, paymentMethodCode, amountPaidCents, ... })
 *
 * Split-tender (pass `payments` array):
 *   chargeOrder({ orderId, processedByStaffId, payments: [{ payment_method_code, amount_paid_cents, ... }] })
 *
 * Route: POST /pos/orders/{order_id}/charge
 * Returns: { order_id, payment_id, payment_ids, payment_status, session_closed }
 */
export async function chargeOrder({
  orderId,
  paymentMethodCode,
  amountPaidCents,
  tipAmountCents,
  changeGivenCents,
  paymentReference,
  processedByStaffId,
  // Split-tender: array of { payment_method_code, amount_paid_cents, ... }
  payments,
}) {
  if (!orderId) throw new Error('orderId required');

  let body;
  if (payments && payments.length > 0) {
    // Split-tender path
    body = {
      payments,
      processed_by_staff_id: processedByStaffId || undefined,
    };
  } else {
    // Single-payment (backwards-compatible)
    if (!paymentMethodCode) throw new Error('paymentMethodCode required');
    body = {
      payment_method_code: paymentMethodCode,
      amount_paid_cents: amountPaidCents,
    };
    if (tipAmountCents != null)   body.tip_amount_cents      = tipAmountCents;
    if (changeGivenCents != null) body.change_given_cents    = changeGivenCents;
    if (paymentReference)         body.payment_reference     = paymentReference;
    if (processedByStaffId)       body.processed_by_staff_id = processedByStaffId;
  }

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

/**
 * Charge all unpaid orders on a ticket using an array of TenderLegs
 * (produced by TenderModal). Each leg becomes a payment_method_code + amount.
 *
 * @param {Object} params
 * @param {Array<{id: string, total_cents: number}>} params.orders  — unpaid orders
 * @param {Array<{method: string, amountCents: number, reference?: string, changeCents?: number}>} params.legs
 * @param {string} [params.processedByStaffId]
 * @returns {Promise<Array>} array of charge responses (one per order)
 */
export async function chargeOrdersWithLegs({ orders, legs, processedByStaffId }) {
  if (!orders || orders.length === 0) throw new Error('No orders to charge');
  if (!legs || legs.length === 0) throw new Error('No payment legs provided');

  const results = [];

  if (orders.length === 1) {
    // Simple case: one order, pass all legs directly
    const r = await chargeOrder({
      orderId: orders[0].id,
      processedByStaffId,
      payments: legs.map((leg) => ({
        payment_method_code: leg.method,
        amount_paid_cents: leg.amountCents,
        change_given_cents: leg.changeCents || 0,
        payment_reference: leg.reference || '',
      })),
    });
    results.push(r);
    return results;
  }

  // Multiple orders: distribute legs proportionally by order total.
  const totalOrderCents = orders.reduce((s, o) => s + (o.total_cents || 0), 0);
  for (const order of orders) {
    const ratio = totalOrderCents > 0 ? (order.total_cents || 0) / totalOrderCents : 1 / orders.length;
    const orderPayments = legs.map((leg) => ({
      payment_method_code: leg.method,
      amount_paid_cents: Math.round(leg.amountCents * ratio),
      change_given_cents: leg.changeCents ? Math.round(leg.changeCents * ratio) : 0,
      payment_reference: leg.reference || '',
    }));
    // eslint-disable-next-line no-await-in-loop
    const r = await chargeOrder({
      orderId: order.id,
      processedByStaffId,
      payments: orderPayments,
    });
    results.push(r);
  }

  return results;
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
