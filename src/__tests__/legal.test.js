// legal.test.js — unit tests for generateStorePolicyMd() in src/services/legal.js
//
// generateStorePolicyMd is a pure string-template function (no network), so it
// is tested directly rather than through a mocked api-client. The system
// clock is frozen throughout, both because the "Effective date" line is
// derived from `new Date()` and because that derivation is the same
// timezone-correctness pattern documented on useDateTime().today() in
// locale-context.jsx: taking the UTC date instead of the store's local date
// shows the wrong day near midnight in every timezone that isn't UTC.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateStorePolicyMd } from '../services/legal.js';

beforeEach(() => {
  vi.useFakeTimers();
  // 00:30 UTC on New Year's Day — chosen because it falls on a DIFFERENT
  // calendar date in UTC-8 (still Dec 31) than in UTC, which is exactly the
  // condition that catches a stray toISOString()-style UTC date bug.
  vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('generateStorePolicyMd — required input', () => {
  it('throws when organization is missing', () => {
    expect(() => generateStorePolicyMd(null)).toThrow(/organization.name is required/);
  });

  it('throws when organization.name is missing', () => {
    expect(() => generateStorePolicyMd({})).toThrow(/organization.name is required/);
  });
});

describe('generateStorePolicyMd — effective date uses the STORE\'S timezone, not UTC', () => {
  it('renders the UTC calendar date when no timezone is passed (default UTC)', () => {
    const md = generateStorePolicyMd({ name: 'Acme Cafe' });
    expect(md).toContain('**Effective date:** 2026-01-01');
  });

  it('renders the PREVIOUS calendar date for a timezone still on 31 Dec', () => {
    const md = generateStorePolicyMd({ name: 'Acme Cafe' }, null, 'America/Los_Angeles');
    expect(md).toContain('**Effective date:** 2025-12-31');
    expect(md).not.toContain('**Effective date:** 2026-01-01');
  });

  it('renders the correct date for a timezone ahead of UTC', () => {
    // Asia/Tokyo is UTC+9: 00:30 UTC on Jan 1 is already 09:30 on Jan 1 there,
    // so this case stays on the same date — asserting it guards against a
    // fix that overcorrects and always subtracts a day.
    const md = generateStorePolicyMd({ name: 'Acme Cafe' }, null, 'Asia/Tokyo');
    expect(md).toContain('**Effective date:** 2026-01-01');
  });
});

describe('generateStorePolicyMd — taxProfile takes priority over organization fields', () => {
  const org = {
    name: 'Acme Cafe',
    address: 'org fallback address',
    country: 'ZA',
    contact_email: 'org@fallback.example',
    default_currency_code: 'ZAR',
  };
  const taxProfile = {
    legal_name: 'Acme Cafe (Pty) Ltd',
    registered_address: '1 Tax Street',
    country: 'US',
    vat_number: 'VAT123456',
    contact_email: 'tax@acme.example',
  };

  it('prefers taxProfile.legal_name, address, country and contact_email', () => {
    const md = generateStorePolicyMd(org, taxProfile, 'UTC');
    expect(md).toContain('Acme Cafe (Pty) Ltd ("we", "us", "our")');
    expect(md).toContain('**Registered address:** 1 Tax Street');
    expect(md).toContain('**Country:** US');
    expect(md).toContain('tax@acme.example');
    expect(md).not.toContain('org fallback address');
  });

  it('renders the VAT/Tax registration line only when a vat_number is present', () => {
    const withVat = generateStorePolicyMd(org, taxProfile, 'UTC');
    expect(withVat).toContain('**VAT/Tax registration:** VAT123456');

    const withoutVat = generateStorePolicyMd(org, { ...taxProfile, vat_number: undefined }, 'UTC');
    expect(withoutVat).not.toContain('VAT/Tax registration');
  });
});

describe('generateStorePolicyMd — degrades gracefully with no taxProfile', () => {
  it('falls back to organization fields when taxProfile is absent', () => {
    const md = generateStorePolicyMd(
      { name: 'Acme Cafe', address: '9 Org Ave', country: 'KE', contact_email: 'hi@acme.example' },
      null,
      'UTC',
    );
    expect(md).toContain('**Registered address:** 9 Org Ave');
    expect(md).toContain('**Country:** KE');
    expect(md).toContain('hi@acme.example');
    // Legal name falls back to the store name itself.
    expect(md).toContain('Acme Cafe ("we", "us", "our")');
  });

  it('uses "address on file" when neither source has an address', () => {
    const md = generateStorePolicyMd({ name: 'Acme Cafe' }, null, 'UTC');
    expect(md).toContain('**Registered address:** address on file');
  });

  it('uses the platform default contact email when neither source has one', () => {
    const md = generateStorePolicyMd({ name: 'Acme Cafe' }, null, 'UTC');
    expect(md).toContain('privacy@beepbite.io');
  });

  it('omits the Country line entirely when no country is known (invents nothing)', () => {
    const md = generateStorePolicyMd({ name: 'Acme Cafe' }, null, 'UTC');
    expect(md).not.toContain('**Country:**');
  });
});

describe('generateStorePolicyMd — currency and hosting-location mentions', () => {
  it('mentions the currency in the order-information bullet when configured', () => {
    const md = generateStorePolicyMd({ name: 'Acme Cafe', default_currency_code: 'KES' }, null, 'UTC');
    expect(md).toContain('transaction amounts (in KES)');
  });

  it('omits the currency parenthetical when unconfigured, rather than inventing one', () => {
    const md = generateStorePolicyMd({ name: 'Acme Cafe' }, null, 'UTC');
    expect(md).toContain('transaction amounts,');
    expect(md).not.toContain('(in )');
  });

  it('names the org-configured data residency when present', () => {
    const md = generateStorePolicyMd(
      { name: 'Acme Cafe', data_residency: 'a data center in Frankfurt, Germany' },
      null,
      'UTC',
    );
    expect(md).toContain('a data center in Frankfurt, Germany');
  });

  it('falls back to a non-committal hosting description when unconfigured', () => {
    // VITE_DATA_RESIDENCY is unset in the test environment, so this exercises
    // the final fallback rather than the env-var branch.
    const md = generateStorePolicyMd({ name: 'Acme Cafe' }, null, 'UTC');
    expect(md).toContain('see your BeepBite hosting agreement');
  });
});

describe('generateStorePolicyMd — store name always appears in the title', () => {
  it('titles the document with the organization name, independent of legal_name', () => {
    const md = generateStorePolicyMd(
      { name: 'Acme Cafe' },
      { legal_name: 'Acme Holdings (Pty) Ltd' },
      'UTC',
    );
    expect(md).toContain('# Privacy Policy — Acme Cafe');
    expect(md).toContain('for **Acme Cafe** using the BeepBite platform');
  });
});
