// locale-data.js — the reference lists the locale settings UI needs to offer:
// currencies, countries and IANA timezones.
//
// Two of the three are derived from Intl at runtime rather than hand-listed,
// because the browser already ships CLDR and a hand-maintained table of country
// names goes stale and is only ever written in one language. Currencies are the
// exception, and the reason matters — see CURRENCY_CODES below.

/**
 * Selectable currency codes.
 *
 * This list is NOT free-form and must not be replaced with
 * Intl.supportedValuesOf('currency') (~300 codes), tempting as that is:
 * `locations.currency_code` carries a foreign key to the `currencies` table, so
 * offering a code that is not seeded there produces a constraint violation at
 * save time rather than a working location.
 *
 * It therefore mirrors the seeded contents of that table: the original eight
 * plus the ~52 added by migration 056. Zero-decimal (JPY, KRW, VND, XOF) and
 * three-decimal (KWD, BHD, OMR) currencies are deliberately included — they are
 * what make the minor-unit handling load-bearing instead of a coincidence.
 *
 * KNOWN GAP: the backend exposes no endpoint that lists the `currencies` table,
 * so this must be kept in sync with migration 056 by hand. Once an endpoint
 * exists, fetch it and keep this only as an offline fallback.
 *
 * Sorted alphabetically by code: any other ordering — most obviously putting one
 * country's currency first — is a statement about whose deployment is the
 * default one.
 */
export const CURRENCY_CODES = [
  'AED', 'ARS', 'AUD', 'BDT', 'BHD', 'BRL', 'BWP', 'CAD', 'CHF', 'CLP',
  'CNY', 'COP', 'CZK', 'DKK', 'EGP', 'EUR', 'GBP', 'GHS', 'HKD', 'HUF',
  'IDR', 'ILS', 'INR', 'ISK', 'JOD', 'JPY', 'KES', 'KRW', 'KWD', 'LKR',
  'MAD', 'MUR', 'MXN', 'MYR', 'NAD', 'NGN', 'NOK', 'NZD', 'OMR', 'PEN',
  'PHP', 'PKR', 'PLN', 'RON', 'RUB', 'RWF', 'SAR', 'SEK', 'SGD', 'THB',
  'TND', 'TRY', 'TZS', 'UAH', 'UGX', 'USD', 'VND', 'XAF', 'XOF', 'ZAR',
  'ZMW',
];

/**
 * ISO 3166-1 alpha-2 country codes.
 *
 * Codes only — the display NAME is resolved per-reader through Intl.DisplayNames
 * below, so a Portuguese operator reads "Japão" and a Japanese one reads "日本"
 * without this module carrying either string.
 */
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AW',
  'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BM', 'BN',
  'BO', 'BR', 'BS', 'BT', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH',
  'CI', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CY', 'CZ', 'DE', 'DJ',
  'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ',
  'FM', 'FR', 'GA', 'GB', 'GD', 'GE', 'GH', 'GI', 'GL', 'GM', 'GN', 'GQ',
  'GR', 'GT', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL',
  'IN', 'IQ', 'IR', 'IS', 'IT', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI',
  'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK',
  'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MG', 'MH',
  'MK', 'ML', 'MM', 'MN', 'MO', 'MR', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY',
  'MZ', 'NA', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NZ', 'OM', 'PA',
  'PE', 'PG', 'PH', 'PK', 'PL', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RO',
  'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SI', 'SK', 'SL',
  'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SY', 'SZ', 'TD', 'TG', 'TH',
  'TJ', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG',
  'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VN', 'VU', 'WS', 'YE', 'ZA', 'ZM',
  'ZW',
];

/**
 * A conservative timezone list, used only when
 * `Intl.supportedValuesOf('timeZone')` is unavailable.
 *
 * It is a spread of representative zones across every inhabited continent, not
 * a complete database. Anything comprehensive belongs to the runtime, which has
 * the real tzdata; this exists so the field is still usable on an old browser.
 */
const FALLBACK_TIMEZONES = [
  'UTC',
  'Africa/Abidjan', 'Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos',
  'Africa/Nairobi',
  'America/Bogota', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Mexico_City', 'America/New_York', 'America/Sao_Paulo',
  'America/Toronto',
  'Asia/Bangkok', 'Asia/Dubai', 'Asia/Hong_Kong', 'Asia/Jakarta',
  'Asia/Karachi', 'Asia/Kolkata', 'Asia/Manila', 'Asia/Riyadh', 'Asia/Seoul',
  'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Melbourne', 'Australia/Perth', 'Australia/Sydney',
  'Europe/Amsterdam', 'Europe/Berlin', 'Europe/Istanbul', 'Europe/Lisbon',
  'Europe/London', 'Europe/Madrid', 'Europe/Paris', 'Europe/Warsaw',
  'Pacific/Auckland',
];

/**
 * Every IANA timezone the runtime knows, sorted.
 *
 * `Intl.supportedValuesOf` is the correct source — it reflects the browser's
 * own tzdata, so it stays current without this file being redeployed. It is
 * absent on older engines, hence the fallback.
 *
 * @returns {string[]}
 */
export function timezoneOptions() {
  try {
    const zones = Intl.supportedValuesOf?.('timeZone');
    if (Array.isArray(zones) && zones.length) {
      // 'UTC' is not always present in the IANA list but is the neutral value
      // an unconfigured location carries, so it must be selectable.
      return zones.includes('UTC') ? zones : ['UTC', ...zones];
    }
  } catch {
    // Fall through to the static list.
  }
  return FALLBACK_TIMEZONES;
}

/**
 * The reader's own timezone, for a "use my timezone" affordance.
 *
 * @returns {string}
 */
export function detectedTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Country display name for a code, in the reader's language.
 *
 * @param {string} code   ISO 3166-1 alpha-2
 * @param {string} [locale]
 * @returns {string} the localised name, or the code itself if Intl cannot name it
 */
export function countryName(code, locale) {
  if (!code) return '';
  try {
    const names = new Intl.DisplayNames([locale || undefined].filter(Boolean), {
      type: 'region',
    });
    return names.of(code) || code;
  } catch {
    return code;
  }
}

/**
 * Currency display name for a code, in the reader's language.
 *
 * @param {string} code   ISO 4217
 * @param {string} [locale]
 * @returns {string}
 */
export function currencyName(code, locale) {
  if (!code) return '';
  try {
    const names = new Intl.DisplayNames([locale || undefined].filter(Boolean), {
      type: 'currency',
    });
    return names.of(code) || code;
  } catch {
    return code;
  }
}

/**
 * Countries as {code, name}, sorted by name in the reader's own language.
 *
 * Sorting by localised name rather than by code is what makes the list
 * navigable: an operator scanning for their country looks for its name.
 * Intl.Collator is used rather than a plain string compare so that accented and
 * non-Latin names order correctly.
 *
 * @param {string} [locale]
 * @returns {{code: string, name: string}[]}
 */
export function countryOptions(locale) {
  const collator = new Intl.Collator(locale || undefined);
  return COUNTRY_CODES
    .map((code) => ({ code, name: countryName(code, locale) }))
    .sort((a, b) => collator.compare(a.name, b.name));
}

/**
 * Currencies as {code, name}, ordered by CODE.
 *
 * Unlike countries, these stay in code order: operators pick a currency by its
 * three-letter code far more often than by its name, and the codes are what
 * appear on every downstream report.
 *
 * @param {string} [locale]
 * @returns {{code: string, name: string}[]}
 */
export function currencyOptions(locale) {
  return CURRENCY_CODES.map((code) => ({ code, name: currencyName(code, locale) }));
}
