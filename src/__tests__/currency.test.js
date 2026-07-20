// currency.test.js — unit tests for src/lib/currency.js
//
// The point of these tests is that the same integer means different amounts in
// different currencies. The module they replaced had a DECIMALS table where
// every entry was 2 — so it looked as though decimals were handled while
// encoding no information at all — and divided by a literal 100 regardless.
//
// Assertions avoid pinning exact symbol placement and separator characters,
// because those come from the runtime's CLDR data and legitimately differ
// between Node versions. What is asserted is the part that must never drift:
// the digits, and the number of them.

import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatPrice,
  currencySymbol,
  currencyDecimals,
  currencyScale,
  parseMoney,
} from '../lib/currency.js';

// Intl inserts U+00A0 / U+202F around currency symbols; normalise for matching.
const norm = (s) => s.replace(/[  ]/g, ' ');

describe('currencyDecimals — the minor-unit exponent', () => {
  it('is 0 for zero-decimal currencies', () => {
    for (const code of ['JPY', 'KRW', 'ISK', 'CLP', 'VND', 'XOF', 'XAF', 'RWF', 'UGX']) {
      expect(currencyDecimals(code)).toBe(0);
    }
  });

  it('is 3 for the Gulf dinars', () => {
    for (const code of ['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD']) {
      expect(currencyDecimals(code)).toBe(3);
    }
  });

  it('is 2 for everything else', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'ZAR', 'NGN', 'KES', 'INR', 'BRL']) {
      expect(currencyDecimals(code)).toBe(2);
    }
  });

  it('is case-insensitive', () => {
    expect(currencyDecimals('jpy')).toBe(0);
    expect(currencyDecimals('kwd')).toBe(3);
  });

  it('falls back to 2 for an unknown or missing code', () => {
    expect(currencyDecimals('XYZ')).toBe(2);
    expect(currencyDecimals('')).toBe(2);
    expect(currencyDecimals(undefined)).toBe(2);
  });
});

describe('currencyScale — minor units per major unit', () => {
  it('is the exponent applied, not a constant 100', () => {
    expect(currencyScale('JPY')).toBe(1);
    expect(currencyScale('USD')).toBe(100);
    expect(currencyScale('KWD')).toBe(1000);
  });
});

describe('formatMoney — the same integer, three currencies', () => {
  // This is the direct anti-`/100` test.
  it('renders 1000 minor units according to the currency exponent', () => {
    // JPY has no minor unit: 1000 IS ¥1000. A /100 would show ¥10.
    const jpy = norm(formatMoney(1000, { currency: 'JPY', locale: 'ja-JP' }));
    expect(jpy).toContain('1,000');
    expect(jpy).not.toContain('10.00');

    // USD: 1000 cents is $10.00.
    expect(norm(formatMoney(1000, { currency: 'USD', locale: 'en-US' }))).toContain('10.00');

    // KWD has 1000 fils: 1000 is KD 1.000. A /100 would show KD 10.00.
    const kwd = norm(formatMoney(1000, { currency: 'KWD', locale: 'en-US' }));
    expect(kwd).toContain('1.000');
    expect(kwd).not.toContain('10.00');
  });

  it('prints exactly the currency’s number of fraction digits', () => {
    expect(norm(formatMoney(1234, { currency: 'JPY', locale: 'en-US' }))).toContain('1,234');
    expect(norm(formatMoney(1234, { currency: 'USD', locale: 'en-US' }))).toContain('12.34');
    expect(norm(formatMoney(1234, { currency: 'KWD', locale: 'en-US' }))).toContain('1.234');
  });
});

describe('formatMoney — locale and currency are independent axes', () => {
  it('uses the locale’s separators', () => {
    // en-US groups with , and separates decimals with .
    expect(norm(formatMoney(123456, { currency: 'USD', locale: 'en-US' }))).toContain('1,234.56');
    // de-DE is the mirror image.
    expect(norm(formatMoney(123456, { currency: 'EUR', locale: 'de-DE' }))).toContain('1.234,56');
  });

  it('does not let the locale change the currency', () => {
    // A German-locale reader of a Japanese store's figures sees yen, written
    // the German way — not euros.
    const out = norm(formatMoney(1000, { currency: 'JPY', locale: 'de-DE' }));
    expect(out).toContain('1.000');
    expect(out).not.toContain('€');
  });

  it('renders the ISO code on demand, for reports that mix currencies', () => {
    // $ alone is ambiguous across USD, CAD, AUD, SGD and more.
    const out = norm(formatMoney(1250, { currency: 'USD', locale: 'en-US', showCode: true }));
    expect(out).toContain('USD');
    expect(out).toContain('12.50');
  });
});

describe('formatMoney — no country is ever assumed', () => {
  it('renders a bare number when no currency is configured', () => {
    const out = norm(formatMoney(1250, { locale: 'en-US' }));
    expect(out).toContain('12.50');
    // Specifically: it must not fall back to rand, or to anything else.
    expect(out).not.toContain('R');
    expect(out).not.toContain('$');
  });

  it('does not default a missing currency to USD', () => {
    // The old formatPrice signature defaulted to USD. An unconfigured location
    // should look unconfigured.
    expect(norm(formatMoney(500))).not.toContain('$');
  });

  it('keeps an unrecognised code visible rather than dropping it', () => {
    const out = norm(formatMoney(1000, { currency: 'XYZ', locale: 'en-US' }));
    expect(out).toContain('XYZ');
    expect(out).toContain('10.00');
  });

  it('survives a malformed locale instead of throwing', () => {
    expect(() => formatMoney(1250, { currency: 'USD', locale: 'not a locale!!' })).not.toThrow();
  });
});

describe('formatMoney — edge values', () => {
  it('handles zero', () => {
    expect(norm(formatMoney(0, { currency: 'USD', locale: 'en-US' }))).toContain('0.00');
    expect(norm(formatMoney(0, { currency: 'JPY', locale: 'en-US' }))).toContain('0');
  });

  it('handles negatives (refunds, drawer shortfalls)', () => {
    const out = norm(formatMoney(-1250, { currency: 'USD', locale: 'en-US' }));
    expect(out).toContain('12.50');
    expect(out).toMatch(/-|\(/);
  });

  it('accepts numeric strings', () => {
    expect(norm(formatMoney('1000', { currency: 'USD', locale: 'en-US' }))).toContain('10.00');
  });

  it('treats unparseable input as zero rather than rendering NaN', () => {
    const out = norm(formatMoney('abc', { currency: 'USD', locale: 'en-US' }));
    expect(out).toContain('0.00');
    expect(out).not.toContain('NaN');
  });

  it('groups large amounts', () => {
    expect(norm(formatMoney(123456789, { currency: 'USD', locale: 'en-US' }))).toContain('1,234,567.89');
  });
});

describe('currencySymbol', () => {
  it('comes from Intl, so it covers every ISO code — not just a table of eight', () => {
    expect(currencySymbol('USD', 'en-US')).toBe('$');
    expect(currencySymbol('GBP', 'en-GB')).toBe('£');
    expect(currencySymbol('EUR', 'de-DE')).toBe('€');
    // Currencies the old 8-entry table did not have:
    expect(currencySymbol('JPY', 'ja-JP')).toBeTruthy();
    expect(currencySymbol('BRL', 'pt-BR')).toBeTruthy();
    expect(currencySymbol('PLN', 'pl-PL')).toBeTruthy();
  });

  it('is locale-relative, because the same currency is written differently', () => {
    // CAD is "$" at home and disambiguated abroad — both correct for their reader.
    expect(currencySymbol('CAD', 'en-CA')).toBeTruthy();
    expect(currencySymbol('CAD', 'en-US')).toBeTruthy();
  });

  it('falls back to the code for an unknown currency', () => {
    expect(currencySymbol('XYZ', 'en-US')).toBe('XYZ');
  });

  it('returns empty for a missing currency rather than guessing', () => {
    expect(currencySymbol('', 'en-US')).toBe('');
    expect(currencySymbol(undefined)).toBe('');
  });
});

describe('parseMoney', () => {
  it('parses to minor units using the currency exponent', () => {
    expect(parseMoney('12.50', 'USD')).toBe(1250);
    expect(parseMoney('1000', 'JPY')).toBe(1000);
    expect(parseMoney('1.234', 'KWD')).toBe(1234);
  });

  it('accepts either separator, because operators type what they were taught', () => {
    expect(parseMoney('12,50', 'USD')).toBe(1250);
    expect(parseMoney('12.50', 'USD')).toBe(1250);
  });

  it('treats the last separator as the decimal one', () => {
    expect(parseMoney('1,234.50', 'USD')).toBe(123450);
    expect(parseMoney('1.234,50', 'USD')).toBe(123450);
  });

  it('ignores grouping marks and stray symbols', () => {
    expect(parseMoney('1 000,50', 'USD')).toBe(100050);
    expect(parseMoney('$12.50', 'USD')).toBe(1250);
    expect(parseMoney('R 12.50', 'ZAR')).toBe(1250);
  });

  it('rejects rather than truncating too many decimals', () => {
    // Silently truncating would charge somebody the wrong price.
    expect(parseMoney('12.345', 'USD')).toBeNull();
    expect(parseMoney('1000.5', 'JPY')).toBeNull();
  });

  it('handles negatives and empty input', () => {
    expect(parseMoney('-12.50', 'USD')).toBe(-1250);
    expect(parseMoney('', 'USD')).toBeNull();
    expect(parseMoney('abc', 'USD')).toBeNull();
  });

  it('round-trips the classic float-rounding victim', () => {
    expect(parseMoney('0.29', 'USD')).toBe(29);
  });
});

describe('formatPrice — legacy shim', () => {
  it('still formats existing call sites', () => {
    expect(norm(formatPrice(1250, 'USD', 'en-US'))).toContain('12.50');
    expect(norm(formatPrice(1250, 'ZAR', 'en-ZA'))).toContain('12,50');
  });

  it('no longer defaults to USD when the currency is missing', () => {
    // The behaviour change is deliberate: a missing currency is a
    // configuration gap, and rendering it as dollars hides that.
    expect(norm(formatPrice(500))).not.toContain('$');
  });

  it('respects the currency exponent, unlike the version it replaces', () => {
    expect(norm(formatPrice(1000, 'JPY', 'en-US'))).not.toContain('10.00');
  });
});
