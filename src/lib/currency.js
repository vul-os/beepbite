// currency.js — single source of truth for price formatting across the app.
// Usage: formatPrice(cents, currency)  e.g. formatPrice(1250, 'ZAR') → 'R 12.50'
//                                           formatPrice(1250, 'USD') → '$12.50'
//
// Prices in the DB are stored as integer cents (major-unit × 100).
// Pass the store / order's currency field explicitly — no global state.

const SYMBOLS = {
  USD: '$',
  ZAR: 'R',
  NGN: '₦',
  KES: 'KSh',
  GHS: '₵',
  EUR: '€',
  GBP: '£',
  INR: '₹',
};

const DECIMALS = {
  USD: 2,
  ZAR: 2,
  NGN: 2,
  KES: 2,
  GHS: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
};

/**
 * Format an integer-cents value as a localised price string.
 *
 * @param {number|string} cents   - amount in smallest currency unit (e.g. 1250)
 * @param {string}        currency - ISO 4217 code (default 'USD')
 * @returns {string}  e.g. 'R 12.50', '$12.50', '₦12.50'
 */
export function formatPrice(cents, currency = 'USD') {
  const n = typeof cents === 'number' ? cents : Number(cents) || 0;
  const d = DECIMALS[currency] ?? 2;
  const symbol = SYMBOLS[currency] ?? currency;
  const amount = (n / 100).toFixed(d);
  // ZAR uses a space after the symbol for readability (R 12.50); others don't.
  return currency === 'ZAR' ? `${symbol} ${amount}` : `${symbol}${amount}`;
}

/**
 * Return just the symbol for a currency code.
 * @param {string} currency
 * @returns {string}
 */
export function currencySymbol(currency) {
  return SYMBOLS[currency] ?? currency;
}
