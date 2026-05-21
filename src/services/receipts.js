// receipts.js — service layer for the receipt reprint feature (Wave 24).
// Wraps the GET /orders/{order_id}/receipt backend endpoint.

import { api } from '@/lib/api-client';

/**
 * Fetch the structured receipt for a past order.
 *
 * @param {string} orderId  - UUID of the order to reprint.
 * @returns {Promise<{ data: import('../types/receipt').Receipt|null, error: object|null }>}
 *
 * Shape of `data` on success:
 * {
 *   store_name:            string,
 *   store_address?:        string | null,
 *   order_id:              string,
 *   order_number:          string,
 *   created_at:            string,   // ISO-8601 timestamptz
 *   line_items: [{
 *     order_item_id:       string,
 *     item_name:           string,
 *     quantity:            number,
 *     unit_price_cents:    number,
 *     total_price_cents:   number,
 *     modifiers: [{
 *       name:                    string,
 *       price_cents_snapshot:    number,
 *     }],
 *   }],
 *   subtotal_cents:        number,
 *   tax_cents:             number,
 *   tip_cents:             number,
 *   total_cents:           number,
 *   currency_code:         string,
 *   payments: [{
 *     payment_id:          string,
 *     method:              string,
 *     amount_paid_cents:   number,
 *     tip_amount_cents:    number,
 *     change_given_cents:  number,
 *     payment_reference?:  string | null,
 *     paid_at:             string,
 *   }],
 *   fiscal_receipt_number?: string | null,
 * }
 */
export async function fetchReceipt(orderId) {
  if (!orderId) {
    return { data: null, error: { message: 'orderId is required' } };
  }
  return api.request('GET', `/orders/${encodeURIComponent(orderId)}/receipt`);
}
