// currency.js — the single source of truth for rendering money in the UI.
//
// Two rules, both of which the previous version broke:
//
//  1. Amounts are integers in the currency's MINOR unit (cents, sen, fils).
//     How many minor units make one major unit is a property of the currency,
//     not the constant 100. JPY, KRW, ISK, CLP, VND and the CFA francs have 0
//     decimals; KWD, BHD, OMR, JOD and TND have 3. A literal `/100` renders
//     ¥1000 as ¥10 and KD 1.000 as KD 10.00.
//
//  2. How a number is written — grouping mark, decimal mark, where the symbol
//     sits — is a property of the reader's LOCALE, not of the currency. A
//     German reading a Japanese store's report should see "1.000 ¥": yen,
//     written the German way. The two axes are independent and this module
//     keeps them that way.
//
// Both jobs are delegated to Intl, which ships CLDR data in every browser we
// support. The old module hand-maintained an 8-entry symbol table (so any
// currency outside it rendered as a bare code), a DECIMALS table in which every
// entry was 2 (so it encoded no information at all while looking as though
// decimals were handled), and a special case branching on `currency === 'ZAR'`
// for the space after the symbol.
//
// Usage:
//   formatMoney(1250, { currency: 'USD', locale: 'en-US' })  → '$12.50'
//   formatMoney(1000, { currency: 'JPY', locale: 'ja-JP' })  → '￥1,000'
//   formatMoney(1250, { currency: 'EUR', locale: 'de-DE' })  → '12,50 €'
//
// Prefer the useMoney() hook from @/context/locale-context, which supplies the
// active location's currency and locale so call sites do not have to.

/**
 * ISO 4217 minor-unit exponents that are NOT 2.
 *
 * Only the exceptions are listed; everything absent is 2. Intl knows these too,
 * but we need the number itself — not just the formatted output — to convert
 * integer minor units into the major-unit value Intl wants, and to round
 * correctly. Keeping the list explicit also documents the cases that a `/100`
 * silently breaks.
 */
const EXPONENTS = {
  // Zero-decimal: the major unit IS the minor unit. ¥1000 is 1000, not 100000.
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // Three-decimal: 1000 fils to the dinar. KD 1.000 is 1000, not 100.
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/** The ISO 4217 majority. Used when a code is absent from EXPONENTS. */
const DEFAULT_EXPONENT = 2;

/**
 * Number of decimal places for a currency.
 *
 * @param {string} currency ISO 4217 code
 * @returns {number} 0, 2 or 3
 */
export function currencyDecimals(currency) {
  if (!currency) return DEFAULT_EXPONENT;
  const code = String(currency).toUpperCase();
  return Object.prototype.hasOwnProperty.call(EXPONENTS, code)
    ? EXPONENTS[code]
    : DEFAULT_EXPONENT;
}

/**
 * Number of minor units in one major unit — 1 for JPY, 100 for USD, 1000 for KWD.
 *
 * @param {string} currency ISO 4217 code
 * @returns {number}
 */
export function currencyScale(currency) {
  return 10 ** currencyDecimals(currency);
}

// Intl.NumberFormat construction is not free and money is rendered in tight
// loops (every line of a ticket, every row of a report), so formatters are
// memoised per locale+currency+style.
const formatterCache = new Map();

function getFormatter(locale, currency, options) {
  const key = `${locale}|${currency}|${JSON.stringify(options)}`;
  let fmt = formatterCache.get(key);
  if (fmt) return fmt;
  try {
    fmt = new Intl.NumberFormat(locale || undefined, options);
  } catch {
    // An unparseable locale or an unsupported currency code must not take a
    // till offline. Fall back to the runtime default locale and plain decimal
    // formatting; the caller's own fallback then prefixes the code.
    fmt = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: options.minimumFractionDigits,
      maximumFractionDigits: options.maximumFractionDigits,
    });
  }
  formatterCache.set(key, fmt);
  return fmt;
}

/**
 * Convert integer minor units to the major-unit number Intl formats.
 *
 * This is the only place a float touches money in the UI, and it is the last
 * step before rendering: the division is exact for every amount below
 * 2^53 minor units, and nothing is computed from the result.
 *
 * @param {number|string} minor
 * @param {string} currency
 * @returns {number}
 */
function toMajor(minor, currency) {
  const n = typeof minor === 'number' ? minor : Number(minor);
  if (!Number.isFinite(n)) return 0;
  return n / currencyScale(currency);
}

/**
 * Format an integer minor-unit amount as localised currency.
 *
 * @param {number|string} minor    amount in the currency's smallest unit
 * @param {object}        [opts]
 * @param {string}        [opts.currency] ISO 4217 code. When absent or unknown
 *   the amount renders as a bare localised number — deliberately, so an
 *   unconfigured location looks unfinished rather than confidently priced in
 *   some currency nobody chose.
 * @param {string}        [opts.locale]   BCP-47 tag. When absent, the runtime's
 *   own locale is used. There is no hardcoded fallback locale: 'en-ZA' as a
 *   default is exactly the bug this module exists to remove.
 * @param {boolean}       [opts.showCode] render the ISO code instead of the
 *   symbol ("USD 12.50" not "$12.50"). Use in multi-currency reports, where $
 *   is ambiguous across USD, CAD, AUD, SGD and a dozen more.
 * @returns {string}
 */
export function formatMoney(minor, opts = {}) {
  const { currency, locale, showCode = false } = opts;
  const decimals = currencyDecimals(currency);
  const major = toMajor(minor, currency);

  if (!currency) {
    // No currency configured. Show the number, invent nothing.
    return getFormatter(locale, '', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(major);
  }

  const code = String(currency).toUpperCase();

  try {
    return getFormatter(locale, code, {
      style: 'currency',
      currency: code,
      currencyDisplay: showCode ? 'code' : 'symbol',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(major);
  } catch {
    // A code Intl does not recognise (a private or crypto unit). Keep it
    // legible and unambiguous rather than dropping it.
    const num = getFormatter(locale, '', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(major);
    return `${code} ${num}`;
  }
}

/**
 * The currency symbol on its own, for compact UI (an input adornment, a column
 * header) where the amount is rendered separately.
 *
 * Derived from Intl rather than a hand-maintained table, so it is correct for
 * every ISO 4217 code and correct *per locale* — CAD is "$" to a Canadian and
 * "CA$" to an American, and both are right for their reader.
 *
 * @param {string} currency
 * @param {string} [locale]
 * @returns {string}
 */
export function currencySymbol(currency, locale) {
  if (!currency) return '';
  const code = String(currency).toUpperCase();
  try {
    const parts = new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'symbol',
    }).formatToParts(0);
    const sym = parts.find((p) => p.type === 'currency');
    return sym ? sym.value : code;
  } catch {
    return code;
  }
}

/**
 * Parse a typed major-unit string into integer minor units.
 *
 * Accepts '.' or ',' as the decimal separator, because operators type prices
 * the way their locale taught them. When both appear ('1,234.50' /
 * '1.234,50') the LAST is the decimal separator — true in every locale CLDR
 * describes. Spaces and apostrophes are dropped as grouping marks.
 *
 * More fractional digits than the currency has returns null rather than
 * truncating: '12.345' in a 2-decimal currency is a typo worth surfacing, not
 * 1234 cents charged to somebody.
 *
 * @param {string} input
 * @param {string} currency
 * @returns {number|null} integer minor units, or null if unparseable
 */
export function parseMoney(input, currency) {
  const decimals = currencyDecimals(currency);
  let raw = String(input ?? '').trim();
  if (!raw) return null;

  let negative = false;
  if (raw[0] === '-') {
    negative = true;
    raw = raw.slice(1);
  } else if (raw[0] === '+') {
    raw = raw.slice(1);
  }

  let digits = '';
  let sepIndex = -1;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      digits += ch;
    } else if (ch === '.' || ch === ',') {
      // A later separator supersedes an earlier one, which was grouping.
      sepIndex = digits.length;
    }
    // Everything else (spaces, NBSP, apostrophes, symbols) carries no value.
  }
  if (!digits) return null;

  const intPart = sepIndex >= 0 ? digits.slice(0, sepIndex) : digits;
  const fracPart = sepIndex >= 0 ? digits.slice(sepIndex) : '';
  if (fracPart.length > decimals) return null;

  const scaled =
    Number(intPart || '0') * 10 ** decimals +
    Number(fracPart.padEnd(decimals, '0') || '0');

  if (!Number.isFinite(scaled)) return null;
  return negative ? -scaled : scaled;
}

/**
 * Legacy shim for the old `formatPrice(cents, currency)` signature.
 *
 * Kept so the ~70 existing call sites keep working while they migrate to
 * formatMoney/useMoney. It differs from the original in two ways, both
 * deliberate: it no longer defaults to USD when the currency is missing (it
 * renders a bare number), and it derives decimals from the currency instead of
 * always printing two.
 *
 * @deprecated Use formatMoney, or the useMoney() hook.
 * @param {number|string} minor
 * @param {string}        [currency]
 * @param {string}        [locale]
 * @returns {string}
 */
export function formatPrice(minor, currency, locale) {
  return formatMoney(minor, { currency, locale });
}
