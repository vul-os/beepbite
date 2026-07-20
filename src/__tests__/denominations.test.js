// denominations.test.js
//
// Pins the two properties the cash-drawer UI depends on and that a regression
// would silently break: denominations are integer MINOR units (a fractional
// one would make a drawer count unbalanceable), and an unlisted currency still
// gets usable tiles instead of either nothing or somebody else's banknotes.

import { describe, it, expect } from 'vitest';
import {
  denominationValues,
  denominationRows,
  denominationTotal,
  quickTenderValues,
} from '@/lib/denominations';

describe('denominationValues', () => {
  it('returns integer minor units, largest first', () => {
    const zar = denominationValues('ZAR');
    expect(zar[0]).toBe(20000); // R200
    expect(zar).toEqual([...zar].sort((a, b) => b - a));
    for (const v of zar) expect(Number.isInteger(v)).toBe(true);
  });

  it('scales by the currency, not by 100', () => {
    // JPY has no minor unit: ¥1000 is 1000, not 100000.
    expect(denominationValues('JPY')).toContain(1000);
    expect(denominationValues('JPY')).not.toContain(100000);
    // KWD has three: KD 1.000 is 1000 fils.
    expect(denominationValues('KWD')).toContain(1000);
  });

  it('has no default currency', () => {
    // An unconfigured location must render no tiles rather than rand ones.
    expect(denominationValues('')).toEqual([]);
    expect(denominationValues(undefined)).toEqual([]);
  });

  it('falls back algorithmically for a currency with no table', () => {
    // CHF is not in the table; it must still get a usable ladder.
    const chf = denominationValues('CHF');
    expect(chf.length).toBeGreaterThan(4);
    for (const v of chf) expect(Number.isInteger(v)).toBe(true);
    expect(chf).toEqual([...chf].sort((a, b) => b - a));
  });

  it('anchors the fallback to the minor unit, not the major one', () => {
    // The minor unit is the value-stable anchor across currencies, so the
    // fallback ladder is the same regardless of how many decimals a currency
    // has. Anchoring to the major unit instead would offer a zero-decimal
    // currency a ladder topping out at 200 of its smallest coin.
    const isk = denominationValues('ISK'); // zero-decimal, no table
    const chf = denominationValues('CHF'); // two-decimal, no table
    expect(isk).toEqual(chf);
    expect(isk[0]).toBe(20000);
  });
});

describe('denominationRows / denominationTotal', () => {
  it('keys are currency-neutral and stable', () => {
    const rows = denominationRows('USD');
    expect(rows[0]).toEqual({ key: 'd10000', minor: 10000 });
  });

  it('totals counts in integer minor units', () => {
    // 2 x R200 + 3 x R50 = 55000 cents.
    expect(denominationTotal({ d20000: 2, d5000: 3 }, 'ZAR')).toBe(55000);
    expect(denominationTotal({}, 'ZAR')).toBe(0);
    expect(denominationTotal(null, 'ZAR')).toBe(0);
  });

  it('ignores counts for denominations the currency does not have', () => {
    expect(denominationTotal({ d20000: 1, dNonsense: 9 }, 'USD')).toBe(0);
  });
});

describe('quickTenderValues', () => {
  it('offers the largest notes, ascending for a tender row', () => {
    const usd = quickTenderValues('USD', 5);
    expect(usd).toEqual([...usd].sort((a, b) => a - b));
    expect(usd).toHaveLength(5);
    expect(usd[usd.length - 1]).toBe(10000); // $100
  });

  it('offers nothing when no currency is configured', () => {
    expect(quickTenderValues('')).toEqual([]);
  });
});
