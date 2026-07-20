// locale-context.jsx — supplies the active location's currency, locale,
// timezone and tax posture to the whole component tree.
//
// WHY THIS EXISTS
//
// Before this, no component had any way to find out what currency it was
// rendering. There was no context, no hook, and no agreed field name on the
// data — so consumers guessed, with a defensive chain repeated verbatim in four
// files:
//
//   store?.currency || store?.default_currency_code || store?.currency_code || 'USD'
//
// and roughly sixty other call sites gave up entirely and hardcoded `R`. That
// is not sixty acts of carelessness; it is the predictable result of asking
// components for a value the application never offered them. Thirteen separate
// private `fmt(cents)` helpers exist in this codebase for the same reason.
//
// The fix is to make the value available once, here, so that formatting money
// correctly is easier than formatting it wrongly.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It has no default country. An unresolved location yields an empty currency,
// which formatMoney renders as a bare number — visibly unconfigured, rather
// than confidently priced in somebody's currency. `locale` defaults to the
// browser's own, not to 'en-ZA' or 'en-US'. `timezone` defaults to UTC, which
// is neutral and is what the backend uses for an unconfigured location.

// prop-types are not used anywhere in this codebase (25 other files carry the
// same disable); `location` here is whatever shape the locations API returned,
// which is precisely the thing this module exists to normalise.
/* eslint-disable react/prop-types */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
} from 'react';
import {
  currencyDecimals,
  currencySymbol as symbolFor,
  formatMoney,
  parseMoney,
} from '@/lib/currency';

/**
 * The neutral baseline. Every field is empty or UTC — no country is assumed.
 */
const NEUTRAL = {
  currency: '',
  locale: '',
  timezone: 'UTC',
  country: '',
  taxRate: 0,
  taxInclusive: true,
  taxLabel: 'Tax',
  phoneCountryCode: '',
};

const LocaleContext = createContext(NEUTRAL);

/**
 * Read the currency code off whatever shape the API happened to return.
 *
 * The backend has published this field under three different names over time
 * (`currency`, `currency_code`, `default_currency_code`). Rather than leaving
 * every consumer to try all three — which is what they were doing — the
 * normalisation happens once, here.
 */
function readCurrency(source) {
  if (!source) return '';
  return (
    source.currency_code ||
    source.currency ||
    source.default_currency_code ||
    ''
  ).toUpperCase();
}

/**
 * LocaleProvider — wrap the app (or a location-scoped subtree) in this.
 *
 * @param {object} props
 * @param {object} [props.location] the active location/store record, in
 *   whatever shape the API returned it. Currency, locale, timezone, tax and
 *   dial code are read off it defensively.
 * @param {object} [props.value] an explicit override, for tests and for
 *   subtrees that render another location's data (a consolidated report row).
 */
export function LocaleProvider({ location, value, children }) {
  const resolved = useMemo(() => {
    if (value) return { ...NEUTRAL, ...value };
    if (!location) return NEUTRAL;
    return {
      ...NEUTRAL,
      currency: readCurrency(location),
      // An empty locale means "use the reader's own", which Intl handles
      // natively. That is the right default: the operator's number formatting
      // preference is expressed by their browser unless they overrode it.
      locale: location.locale || '',
      timezone: location.timezone || 'UTC',
      country: (location.country || '').toUpperCase(),
      taxRate: Number(location.tax_rate ?? 0) || 0,
      // Defaults to true only because that is the backend's own default for
      // existing rows; it is always read from the record when present.
      taxInclusive: location.tax_inclusive ?? true,
      taxLabel: location.tax_label || 'Tax',
      phoneCountryCode: String(location.phone_country_code || '').replace(/^\+/, ''),
    };
  }, [location, value]);

  return (
    <LocaleContext.Provider value={resolved}>{children}</LocaleContext.Provider>
  );
}

/**
 * useLocale — the active location's full locale posture.
 *
 * @returns {{currency: string, locale: string, timezone: string, country: string,
 *   taxRate: number, taxInclusive: boolean, taxLabel: string,
 *   phoneCountryCode: string}}
 */
export function useLocale() {
  return useContext(LocaleContext);
}

/**
 * useMoney — the hook nearly every component actually wants.
 *
 * Replaces the thirteen private `fmt(cents)` helpers and the ~52 inline
 * `R{(x / 100).toFixed(2)}` expressions.
 *
 *   const { format } = useMoney();
 *   <span>{format(order.total_cents)}</span>
 *
 * @param {object} [overrides] force a currency/locale, for a row that shows
 *   another location's money (a consolidated report). Never needed on the
 *   normal single-location path.
 */
export function useMoney(overrides) {
  const ctx = useLocale();
  const currency = overrides?.currency ?? ctx.currency;
  const locale = overrides?.locale ?? ctx.locale;

  const format = useCallback(
    (minor) => formatMoney(minor, { currency, locale }),
    [currency, locale],
  );

  // Renders "USD 12.50" rather than "$12.50". For any view that puts two
  // currencies in one column, where $ alone is ambiguous.
  const formatWithCode = useCallback(
    (minor) => formatMoney(minor, { currency, locale, showCode: true }),
    [currency, locale],
  );

  const parse = useCallback((text) => parseMoney(text, currency), [currency]);

  return useMemo(
    () => ({
      format,
      formatWithCode,
      parse,
      currency,
      locale,
      symbol: symbolFor(currency, locale),
      /** Minor units per major unit — use instead of a literal 100. */
      scale: 10 ** currencyDecimals(currency),
      /** 0 for JPY, 2 for most, 3 for KWD — use instead of a literal 2. */
      decimals: currencyDecimals(currency),
    }),
    [format, formatWithCode, parse, currency, locale],
  );
}

/**
 * useDateTime — date and time formatting in the location's timezone and locale.
 *
 * The app currently renders dates three different ways: one screen hardcodes
 * 'en-ZA', another hardcodes 'en-US', and ~60 call sites pass no locale at all.
 * More seriously, several places derive "today" from
 * `new Date().toISOString().slice(0, 10)` — which is the UTC date. In
 * Johannesburg that disagrees with the local date only between midnight and
 * 02:00; in the Americas it disagrees for most of the evening, so a store in
 * Los Angeles sees tomorrow's specials from 16:00.
 */
export function useDateTime() {
  const { locale, timezone } = useLocale();

  const formatDate = useCallback(
    (value, options) =>
      new Date(value).toLocaleDateString(locale || undefined, {
        timeZone: timezone || 'UTC',
        ...options,
      }),
    [locale, timezone],
  );

  const formatTime = useCallback(
    (value, options) =>
      new Date(value).toLocaleTimeString(locale || undefined, {
        timeZone: timezone || 'UTC',
        ...options,
      }),
    [locale, timezone],
  );

  const formatDateTime = useCallback(
    (value, options) =>
      new Date(value).toLocaleString(locale || undefined, {
        timeZone: timezone || 'UTC',
        ...options,
      }),
    [locale, timezone],
  );

  /**
   * The current LOCAL trading date as 'YYYY-MM-DD'.
   *
   * This is the correct replacement for
   * `new Date().toISOString().slice(0, 10)`, which returns the UTC date.
   * 'en-CA' is used purely as a formatting trick — it is the locale whose
   * short date format IS ISO 8601 — while `timeZone` does the real work.
   */
  const today = useCallback(
    () =>
      new Date().toLocaleDateString('en-CA', {
        timeZone: timezone || 'UTC',
      }),
    [timezone],
  );

  return useMemo(
    () => ({ formatDate, formatTime, formatDateTime, today, locale, timezone }),
    [formatDate, formatTime, formatDateTime, today, locale, timezone],
  );
}

export default LocaleContext;
