// locale-context.test.tsx — unit tests for src/context/locale-context.tsx
//
// This context is the single place the app resolves "what currency/locale/
// timezone/tax posture is active", replacing ~60 call sites that used to
// each guess a field name (currency vs currency_code vs default_currency_code)
// or hardcode a locale. Every one of those resolution rules is a real bug
// class if it regresses, so each is asserted here directly against the hook
// output rather than through a rendered component's markup — which keeps
// these tests unaffected by any unrelated UI changes elsewhere in the app.

import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  LocaleProvider,
  useLocale,
  useMoney,
  useDateTime,
  type LocaleContextValue,
  type LocationLike,
} from '../context/locale-context';

function wrapperFor(props: { location?: LocationLike | null; value?: Partial<LocaleContextValue> }) {
  // eslint-disable-next-line react/prop-types
  return function Wrapper({ children }: { children: ReactNode }) {
    return <LocaleProvider {...props}>{children}</LocaleProvider>;
  };
}

describe('useLocale — neutral baseline with no provider value', () => {
  it('has no default currency or country', () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current.currency).toBe('');
    expect(result.current.country).toBe('');
  });

  it('defaults timezone to UTC and taxLabel to "Tax"', () => {
    const { result } = renderHook(() => useLocale());
    expect(result.current.timezone).toBe('UTC');
    expect(result.current.taxLabel).toBe('Tax');
  });
});

describe('LocaleProvider — currency field-name resolution', () => {
  it('reads `currency_code` when present', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ location: { currency_code: 'kes' } }),
    });
    expect(result.current.currency).toBe('KES');
  });

  it('falls back to `currency` when `currency_code` is absent', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ location: { currency: 'gbp' } }),
    });
    expect(result.current.currency).toBe('GBP');
  });

  it('falls back to `default_currency_code` when neither of the above is present', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ location: { default_currency_code: 'jpy' } }),
    });
    expect(result.current.currency).toBe('JPY');
  });

  it('prefers `currency_code` over the other two when multiple are present', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({
        location: { currency_code: 'usd', currency: 'eur', default_currency_code: 'zar' },
      }),
    });
    expect(result.current.currency).toBe('USD');
  });

  it('is empty (not a guessed default) when no location is provided', () => {
    const { result } = renderHook(() => useLocale(), { wrapper: wrapperFor({}) });
    expect(result.current.currency).toBe('');
  });
});

describe('LocaleProvider — tax posture is read verbatim from the location', () => {
  it('reads taxRate, taxInclusive and taxLabel from the record', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({
        location: { tax_rate: 15, tax_inclusive: false, tax_label: 'VAT' },
      }),
    });
    expect(result.current.taxRate).toBe(15);
    expect(result.current.taxInclusive).toBe(false);
    expect(result.current.taxLabel).toBe('VAT');
  });

  it('defaults taxInclusive to true only when the field is genuinely absent', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ location: {} }),
    });
    expect(result.current.taxInclusive).toBe(true);
  });

  it('respects an explicit tax_inclusive: false rather than overriding it with the default', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ location: { tax_inclusive: false } }),
    });
    expect(result.current.taxInclusive).toBe(false);
  });

  it('coerces a non-numeric tax_rate to 0 instead of propagating NaN', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ location: { tax_rate: 'not-a-number' } }),
    });
    expect(result.current.taxRate).toBe(0);
  });
});

describe('LocaleProvider — phoneCountryCode strips a leading +', () => {
  it('strips a leading +', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ location: { phone_country_code: '+27' } }),
    });
    expect(result.current.phoneCountryCode).toBe('27');
  });

  it('is empty when unset', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ location: {} }),
    });
    expect(result.current.phoneCountryCode).toBe('');
  });
});

describe('LocaleProvider — an explicit `value` override wins over `location`', () => {
  it('uses `value` even when `location` is also passed', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({
        location: { currency_code: 'usd' },
        value: { currency: 'EUR' },
      }),
    });
    expect(result.current.currency).toBe('EUR');
  });

  it('still fills unspecified fields from the neutral baseline', () => {
    const { result } = renderHook(() => useLocale(), {
      wrapper: wrapperFor({ value: { currency: 'EUR' } }),
    });
    expect(result.current.timezone).toBe('UTC');
    expect(result.current.taxLabel).toBe('Tax');
  });
});

describe('useMoney — formatting derives from the active currency/locale', () => {
  it('formats using the provider currency and locale', () => {
    const { result } = renderHook(() => useMoney(), {
      wrapper: wrapperFor({ value: { currency: 'USD', locale: 'en-US' } }),
    });
    expect(result.current.format(1250)).toContain('12.50');
  });

  it('respects per-call overrides without touching the provider currency', () => {
    const { result } = renderHook(() => useMoney({ currency: 'JPY', locale: 'ja-JP' }), {
      wrapper: wrapperFor({ value: { currency: 'USD', locale: 'en-US' } }),
    });
    expect(result.current.currency).toBe('JPY');
    expect(result.current.format(1000)).not.toContain('10.00');
  });

  it('exposes scale/decimals consistent with the currency (not a hardcoded 100/2)', () => {
    const { result } = renderHook(() => useMoney(), {
      wrapper: wrapperFor({ value: { currency: 'KWD', locale: 'en-US' } }),
    });
    expect(result.current.decimals).toBe(3);
    expect(result.current.scale).toBe(1000);
  });

  it('parse() uses the active currency\'s decimal precision', () => {
    const { result } = renderHook(() => useMoney(), {
      wrapper: wrapperFor({ value: { currency: 'JPY', locale: 'en-US' } }),
    });
    expect(result.current.parse('1000')).toBe(1000);
    // JPY has 0 decimals: a fractional amount is a typo, not silently truncated.
    expect(result.current.parse('10.5')).toBeNull();
  });

  it('formatWithCode renders the ISO code rather than a possibly-ambiguous symbol', () => {
    const { result } = renderHook(() => useMoney(), {
      wrapper: wrapperFor({ value: { currency: 'USD', locale: 'en-US' } }),
    });
    expect(result.current.formatWithCode(1250)).toContain('USD');
  });
});

describe('useDateTime().today() — uses the STORE\'S timezone, not the UTC date', () => {
  // This mirrors the exact bug class documented in locale-context.jsx:
  // `new Date().toISOString().slice(0, 10)` returns the UTC date, which
  // disagrees with the local trading day near midnight in any non-UTC zone.

  beforeEach(() => {
    vi.useFakeTimers();
    // 00:30 UTC — already the next UTC day, but still the previous day on
    // the US west coast (UTC-8).
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the UTC date for an unconfigured (UTC) location', () => {
    const { result } = renderHook(() => useDateTime(), { wrapper: wrapperFor({}) });
    expect(result.current.today()).toBe('2026-01-01');
  });

  it('returns the PREVIOUS calendar date for a location behind UTC at this instant', () => {
    const { result } = renderHook(() => useDateTime(), {
      wrapper: wrapperFor({ value: { timezone: 'America/Los_Angeles' } }),
    });
    expect(result.current.today()).toBe('2025-12-31');
  });

  it('returns the current calendar date for a location ahead of UTC at this instant', () => {
    const { result } = renderHook(() => useDateTime(), {
      wrapper: wrapperFor({ value: { timezone: 'Asia/Tokyo' } }),
    });
    expect(result.current.today()).toBe('2026-01-01');
  });
});

describe('useDateTime — formatDate/formatTime respect locale and timezone', () => {
  it('formatDate renders in the configured timezone', () => {
    const { result } = renderHook(() => useDateTime(), {
      wrapper: wrapperFor({ value: { locale: 'en-US', timezone: 'UTC' } }),
    });
    const out = result.current.formatDate('2026-06-15T12:00:00.000Z');
    expect(out).toContain('2026');
  });

  it('does not throw for an unconfigured (empty-string) locale', () => {
    const { result } = renderHook(() => useDateTime(), { wrapper: wrapperFor({}) });
    expect(() => result.current.formatDate('2026-06-15T12:00:00.000Z')).not.toThrow();
  });
});
