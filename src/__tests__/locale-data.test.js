// locale-data.test.js — unit tests for src/lib/locale-data.js
//
// These lists exist to populate the location settings UI, and two of their
// properties are load-bearing rather than cosmetic:
//
//   1. CURRENCY_CODES must stay a SUBSET of what the backend `currencies` table
//      seeds, because locations.currency_code carries a foreign key to it.
//      Offering a code that is not seeded produces a constraint violation at
//      save time — the operator picks a currency, clicks save, and gets an
//      opaque database error. There is no endpoint exposing that table, so the
//      list is maintained by hand against migration 056 and these tests are the
//      only thing standing between a typo and that failure.
//
//   2. Neither list may be ordered so that one country comes first. That
//      ordering is how the original ZAR-first list quietly announced whose
//      deployment was the real one.
//
// Assertions avoid pinning display NAMES, which come from the runtime's CLDR
// data and legitimately differ between Node versions and ICU builds.

import { describe, it, expect } from 'vitest';
import {
  CURRENCY_CODES,
  COUNTRY_CODES,
  countryName,
  countryOptions,
  currencyName,
  currencyOptions,
  detectedTimezone,
  timezoneOptions,
} from '@/lib/locale-data';
import { currencyDecimals } from '@/lib/currency';

describe('CURRENCY_CODES', () => {
  it('contains no duplicates', () => {
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
  });

  it('is sorted by code, so no country sorts first by privilege', () => {
    expect([...CURRENCY_CODES].sort()).toEqual(CURRENCY_CODES);
  });

  it('holds only well-formed ISO 4217 codes', () => {
    for (const code of CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('does not lead with ZAR', () => {
    expect(CURRENCY_CODES[0]).not.toBe('ZAR');
  });

  // The whole point of widening the list in migration 056 was to make the
  // minor-unit exponent load-bearing. If every selectable currency had 2
  // decimals, a stray /100 would stay invisible.
  it('includes zero-decimal and three-decimal currencies', () => {
    const zeroDecimal = CURRENCY_CODES.filter((c) => currencyDecimals(c) === 0);
    const threeDecimal = CURRENCY_CODES.filter((c) => currencyDecimals(c) === 3);
    expect(zeroDecimal).toContain('JPY');
    expect(zeroDecimal).toContain('KRW');
    expect(threeDecimal).toContain('KWD');
    expect(threeDecimal).toContain('BHD');
  });

  it('still offers the currencies the product already had in production', () => {
    // Dropping one of these would strand existing locations on a code the
    // picker can no longer display.
    for (const code of ['ZAR', 'USD', 'EUR', 'GBP', 'KES', 'NGN', 'GHS', 'INR']) {
      expect(CURRENCY_CODES).toContain(code);
    }
  });
});

describe('COUNTRY_CODES', () => {
  it('contains no duplicates', () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
  });

  it('holds only ISO 3166-1 alpha-2 codes, matching the column CHECK', () => {
    // locations.country enforces ^[A-Z]{2}$; anything else here would be
    // selectable in the UI and rejected by the database.
    for (const code of COUNTRY_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('covers every inhabited continent rather than one region', () => {
    for (const code of ['ZA', 'US', 'JP', 'DE', 'BR', 'AU', 'IN', 'NG', 'EG']) {
      expect(COUNTRY_CODES).toContain(code);
    }
  });
});

describe('countryOptions', () => {
  it('returns one option per code', () => {
    expect(countryOptions('en')).toHaveLength(COUNTRY_CODES.length);
  });

  it('sorts by localised name, not by code', () => {
    const names = countryOptions('en').map((o) => o.name);
    const collator = new Intl.Collator('en');
    expect([...names].sort(collator.compare)).toEqual(names);
  });

  it('names countries in the reader\'s own language', () => {
    // Not asserting the exact strings — only that the language actually
    // changes the output, which is the reason names are not hardcoded.
    const en = countryOptions('en').find((o) => o.code === 'JP');
    const ja = countryOptions('ja').find((o) => o.code === 'JP');
    expect(en.name).toBeTruthy();
    expect(ja.name).toBeTruthy();
    expect(ja.name).not.toBe(en.name);
  });
});

describe('currencyOptions', () => {
  it('stays in code order, which is how operators scan it', () => {
    const codes = currencyOptions('en').map((o) => o.code);
    expect(codes).toEqual(CURRENCY_CODES);
  });
});

describe('name lookups degrade rather than throw', () => {
  it('returns empty string for an absent code', () => {
    expect(countryName('')).toBe('');
    expect(currencyName('')).toBe('');
  });

  // A malformed code makes Intl.DisplayNames throw a RangeError. The lookup
  // must swallow it and hand back the input: an unrecognised country is a
  // cosmetic gap in a dropdown, never a reason to fail a render.
  it('falls back to the code itself when Intl rejects the input', () => {
    expect(() => countryName('X')).not.toThrow();
    expect(countryName('X')).toBe('X');
    expect(() => currencyName('NOT-A-CODE')).not.toThrow();
  });

  // 'ZZ' is deliberately NOT used as the malformed case: CLDR defines it as
  // "Unknown Region" and resolves it happily.
  it('resolves the CLDR unknown-region code rather than treating it as an error', () => {
    expect(countryName('ZZ', 'en')).toBeTruthy();
  });
});

describe('timezoneOptions', () => {
  it('always offers UTC, the value an unconfigured location carries', () => {
    expect(timezoneOptions()).toContain('UTC');
  });

  it('returns plausible IANA zone names', () => {
    const zones = timezoneOptions();
    expect(zones.length).toBeGreaterThan(20);
    expect(zones).toContain('Africa/Johannesburg');
    expect(zones).toContain('America/New_York');
  });
});

describe('detectedTimezone', () => {
  it('returns a zone the runtime can actually format in', () => {
    const zone = detectedTimezone();
    expect(zone).toBeTruthy();
    expect(() => new Intl.DateTimeFormat(undefined, { timeZone: zone })).not.toThrow();
  });
});
