// currency.test.js — unit tests for src/lib/currency.js
import { describe, it, expect } from 'vitest';
import { formatPrice, currencySymbol } from '../lib/currency.js';

describe('formatPrice', () => {
  it('formats USD cents correctly', () => {
    expect(formatPrice(1250, 'USD')).toBe('$12.50');
  });

  it('formats ZAR with a space after the symbol', () => {
    expect(formatPrice(1250, 'ZAR')).toBe('R 12.50');
  });

  it('formats NGN', () => {
    expect(formatPrice(50000, 'NGN')).toBe('₦500.00');
  });

  it('formats KES', () => {
    expect(formatPrice(100, 'KES')).toBe('KSh1.00');
  });

  it('formats GBP', () => {
    expect(formatPrice(999, 'GBP')).toBe('£9.99');
  });

  it('formats EUR', () => {
    expect(formatPrice(0, 'EUR')).toBe('€0.00');
  });

  it('defaults to USD when no currency supplied', () => {
    expect(formatPrice(500)).toBe('$5.00');
  });

  it('handles string input for cents', () => {
    expect(formatPrice('1000', 'USD')).toBe('$10.00');
  });

  it('handles NaN-like string gracefully (treats as 0)', () => {
    expect(formatPrice('abc', 'USD')).toBe('$0.00');
  });

  it('handles zero cents', () => {
    expect(formatPrice(0, 'ZAR')).toBe('R 0.00');
  });

  it('falls back to currency code as symbol for unknown currency', () => {
    expect(formatPrice(1000, 'XYZ')).toBe('XYZ10.00');
  });

  it('rounds fractional cents to 2 decimal places', () => {
    // 1 cent → $0.01
    expect(formatPrice(1, 'USD')).toBe('$0.01');
  });
});

describe('currencySymbol', () => {
  it('returns the correct symbol for known currencies', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('ZAR')).toBe('R');
    expect(currencySymbol('NGN')).toBe('₦');
    expect(currencySymbol('GBP')).toBe('£');
  });

  it('returns the currency code itself for unknown codes', () => {
    expect(currencySymbol('XYZ')).toBe('XYZ');
  });
});
