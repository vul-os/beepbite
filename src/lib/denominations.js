// denominations.js — the cash denominations a drawer can actually contain.
//
// WHY THIS EXISTS
//
// Three separate components had the South African note-and-coin set typed into
// them as literal data (`{ key: 'R200', label: 'R200', cents: 20000 }`, and two
// more copies besides). A till in Tokyo counting its drawer was offered R5 and
// 50c tiles; a till in New York had no $1 bill. The denominations a drawer holds
// are a property of the CURRENCY, not of the application.
//
// The fix is one table, keyed by currency, plus an algorithmic fallback — so an
// unlisted currency gets usable buttons rather than either no buttons at all or
// somebody else's banknotes.
//
// LABELS ARE NOT STORED HERE
//
// The old tables carried a hardcoded `label: 'R200'`. Labels are produced at
// render time by formatMoney/useMoney().format, which knows both the currency's
// symbol and the reader's locale — so the same 20000 renders as "R200,00" to a
// South African and "ZAR 200.00" in a multi-currency report. Storing the label
// as data is how "R" got baked into the UI in the first place.
//
// KEYS ARE CURRENCY-NEUTRAL
//
// Counts are persisted to `cash_drawer_counts.denominations` as an opaque JSON
// object, so the key only has to be stable. It is `d<minor units>` — 'd20000'
// — rather than 'R200', which was both currency-specific and ambiguous once a
// second currency existed (R200 and $200 are not the same drawer slot).

import { currencyScale } from '@/lib/currency';

/**
 * Circulating notes and coins, in MAJOR units, per currency.
 *
 * Only what a retail drawer plausibly holds: notes plus the coins an operator
 * would bother counting. Very high notes and sub-cent coins are omitted because
 * a grid of twenty tiles is slower to use than one of ten.
 */
const MAJOR_DENOMINATIONS = {
  ZAR: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
  USD: [100, 50, 20, 10, 5, 1, 0.25, 0.1, 0.05, 0.01],
  EUR: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
  GBP: [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
  JPY: [10000, 5000, 1000, 500, 100, 50, 10, 5, 1],
  NGN: [1000, 500, 200, 100, 50, 20, 10],
  KES: [1000, 500, 200, 100, 50, 20, 10, 5],
  GHS: [200, 100, 50, 20, 10, 5, 2, 1],
  INR: [500, 200, 100, 50, 20, 10, 5, 2, 1],
  AUD: [100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
  CAD: [100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05],
  KWD: [20, 10, 5, 1, 0.5, 0.25, 0.1, 0.05],
};

/**
 * The fallback ladder for a currency we have no table for, in MINOR units.
 *
 * Two guesses are baked in. The shape is a 1-2-5 ladder, which is what every
 * cash economy converges on. The range is anchored to the MINOR unit rather
 * than the major one, which is the counter-intuitive part but the more robust
 * choice: the major unit's worth varies by orders of magnitude between
 * currencies (a yen is not a pound), whereas the minor unit is roughly
 * value-stable across them — precisely because a currency drops its minor unit
 * once it has become too worthless to mint, which is why JPY has none and KWD
 * has three. So "10 to 20000 minor units" lands on a usable retail range in
 * cents, yen and fils alike, where "0.1 to 200 major units" would offer a
 * Japanese till a ¥1 tile and no note above ¥200.
 *
 * This is a guess, and is meant to be replaced by a real entry in
 * MAJOR_DENOMINATIONS the moment a store actually trades in the currency.
 */
const FALLBACK_MINOR = [
  20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10,
];

/**
 * Cash denominations for a currency, as integer MINOR units, largest first.
 *
 * @param {string} [currency] ISO 4217 code. When absent there is no currency to
 *   describe denominations of, so the caller gets an empty list and should
 *   render no tiles — the same "visibly unconfigured" posture formatMoney takes.
 * @returns {number[]} minor-unit amounts, descending, never fractional
 */
export function denominationValues(currency) {
  if (!currency) return [];
  const code = String(currency).toUpperCase();
  const major = MAJOR_DENOMINATIONS[code];
  if (!major) return [...FALLBACK_MINOR];

  const scale = currencyScale(code);
  return major
    // The tables are written in major units because that is how the notes are
    // named and read; the app counts in minor units, and a fractional minor
    // unit is not a thing that exists.
    .map((m) => Math.round(m * scale))
    .filter((minor) => minor >= 1)
    .sort((a, b) => b - a);
}

/**
 * Denominations as `{ key, minor }` rows for a counting grid.
 *
 * The key is stable across renders and currencies and is what gets persisted;
 * see the note on key naming at the top of this file.
 *
 * @param {string} [currency]
 * @returns {{key: string, minor: number}[]}
 */
export function denominationRows(currency) {
  return denominationValues(currency).map((minor) => ({
    key: `d${minor}`,
    minor,
  }));
}

/**
 * Total a `{key: count}` map against a currency's denominations.
 *
 * Stays in integer minor units throughout — counts are integers and
 * denominations are integers, so the product never needs a float.
 *
 * @param {Record<string, number>} counts
 * @param {string} [currency]
 * @returns {number} total in minor units
 */
export function denominationTotal(counts, currency) {
  return denominationRows(currency).reduce(
    (sum, d) => sum + (Number(counts?.[d.key]) || 0) * d.minor,
    0,
  );
}

/**
 * The handful of note values offered as quick-tender buttons on a cash screen.
 *
 * Notes only: nobody hands over a fistful of coins to settle a bill, and a
 * 10-tile row of coins pushes the useful notes off the screen. "Notes" is
 * approximated as the largest values in the ladder, which is what they are.
 *
 * @param {string} [currency]
 * @param {number} [limit] how many to return
 * @returns {number[]} minor-unit amounts, ASCENDING (a tender row reads small
 *   to large, unlike a counting grid which reads large to small)
 */
export function quickTenderValues(currency, limit = 5) {
  return denominationValues(currency).slice(0, limit).reverse();
}
