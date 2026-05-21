// ulid.test.js — unit tests for src/offline/ulid.js
import { describe, it, expect } from 'vitest';
import { ulid } from '../offline/ulid.js';

const CROCKFORD_CHARSET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_RE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]+$/;

describe('ulid', () => {
  it('generates a 26-character string', () => {
    expect(ulid()).toHaveLength(26);
  });

  it('uses only Crockford base-32 characters', () => {
    for (let i = 0; i < 50; i++) {
      expect(ulid()).toMatch(CROCKFORD_RE);
    }
  });

  it('returns a string', () => {
    expect(typeof ulid()).toBe('string');
  });

  it('two consecutive calls produce different values', () => {
    const a = ulid();
    const b = ulid();
    expect(a).not.toBe(b);
  });

  it('is lexicographically non-decreasing across calls (monotone property)', () => {
    // Within the same millisecond the module increments the random portion,
    // so the second ULID must be >= the first.
    const ids = Array.from({ length: 20 }, () => ulid());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] >= ids[i - 1]).toBe(true);
    }
  });

  it('generates ULIDs with a later timestamp prefix after a 2 ms delay', async () => {
    const before = ulid();
    // Wait at least 2 ms so Date.now() returns a strictly larger value.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const after = ulid();
    // Later timestamp => lexicographically greater (time part is the prefix).
    expect(after > before).toBe(true);
  });

  it('produces only uppercase characters (no lowercase)', () => {
    for (let i = 0; i < 30; i++) {
      const id = ulid();
      expect(id).toBe(id.toUpperCase());
    }
  });

  it('does not contain ambiguous characters (I, L, O, U)', () => {
    const ambiguous = /[ILOU]/;
    for (let i = 0; i < 50; i++) {
      expect(ulid()).not.toMatch(ambiguous);
    }
  });

  it('generates 100 ULIDs all unique', () => {
    const ids = new Set(Array.from({ length: 100 }, () => ulid()));
    expect(ids.size).toBe(100);
  });
});
