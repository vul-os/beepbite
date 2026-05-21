// idempotency.test.js — unit tests for src/offline/idempotency.js
import { describe, it, expect } from 'vitest';
import { makeIdempotencyKey, attachIdempotencyKey } from '../offline/idempotency.js';

describe('makeIdempotencyKey', () => {
  it('returns a non-empty string', async () => {
    const key = await makeIdempotencyKey('POST', '/data/orders', 'some-logical-id');
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('returns a 64-character lowercase hex string (SHA-256)', async () => {
    const key = await makeIdempotencyKey('POST', '/data/orders', 'some-logical-id');
    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable — same inputs always produce the same key', async () => {
    const method = 'POST';
    const url = '/data/orders';
    const logicalId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

    const key1 = await makeIdempotencyKey(method, url, logicalId);
    const key2 = await makeIdempotencyKey(method, url, logicalId);
    expect(key1).toBe(key2);
  });

  it('is stable across multiple calls with the same inputs', async () => {
    const args = ['DELETE', '/data/items/42', 'stable-id-xyz'];
    const keys = await Promise.all(
      Array.from({ length: 5 }, () => makeIdempotencyKey(args[0], args[1], args[2]))
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(1);
  });

  it('produces different keys for different logicalIds', async () => {
    const key1 = await makeIdempotencyKey('POST', '/data/orders', 'id-aaa');
    const key2 = await makeIdempotencyKey('POST', '/data/orders', 'id-bbb');
    expect(key1).not.toBe(key2);
  });

  it('produces different keys for different HTTP methods', async () => {
    const logicalId = 'same-id';
    const url = '/data/orders';
    const keyPost = await makeIdempotencyKey('POST', url, logicalId);
    const keyPut = await makeIdempotencyKey('PUT', url, logicalId);
    expect(keyPost).not.toBe(keyPut);
  });

  it('produces different keys for different URLs', async () => {
    const logicalId = 'same-id';
    const key1 = await makeIdempotencyKey('POST', '/data/orders', logicalId);
    const key2 = await makeIdempotencyKey('POST', '/data/items', logicalId);
    expect(key1).not.toBe(key2);
  });

  it('is case-insensitive on the HTTP method (normalises to uppercase)', async () => {
    const url = '/data/orders';
    const logicalId = 'test-id';
    const keyUpper = await makeIdempotencyKey('POST', url, logicalId);
    const keyLower = await makeIdempotencyKey('post', url, logicalId);
    expect(keyUpper).toBe(keyLower);
  });
});

describe('attachIdempotencyKey', () => {
  it('sets the Idempotency-Key header on the provided headers object', async () => {
    const headers = {};
    await attachIdempotencyKey(headers, 'POST', '/data/orders', 'logical-123');
    expect(headers['Idempotency-Key']).toBeDefined();
    expect(typeof headers['Idempotency-Key']).toBe('string');
    expect(headers['Idempotency-Key']).toHaveLength(64);
  });

  it('returns the mutated headers object', async () => {
    const headers = { 'Content-Type': 'application/json' };
    const result = await attachIdempotencyKey(headers, 'POST', '/data/orders', 'logical-456');
    expect(result).toBe(headers);
  });

  it('preserves existing headers while adding Idempotency-Key', async () => {
    const headers = { Authorization: 'Bearer token123', 'Content-Type': 'application/json' };
    await attachIdempotencyKey(headers, 'POST', '/data/orders', 'logical-789');
    expect(headers.Authorization).toBe('Bearer token123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toHaveLength(64);
  });

  it('key from attachIdempotencyKey matches makeIdempotencyKey for same inputs', async () => {
    const method = 'PATCH';
    const url = '/data/items/7';
    const logicalId = 'match-test-id';

    const headers = {};
    await attachIdempotencyKey(headers, method, url, logicalId);
    const direct = await makeIdempotencyKey(method, url, logicalId);

    expect(headers['Idempotency-Key']).toBe(direct);
  });

  it('produces a stable key on repeat attach calls with same inputs', async () => {
    const method = 'POST';
    const url = '/data/orders';
    const logicalId = 'stable-attach-id';
    const h1 = {};
    const h2 = {};
    await attachIdempotencyKey(h1, method, url, logicalId);
    await attachIdempotencyKey(h2, method, url, logicalId);
    expect(h1['Idempotency-Key']).toBe(h2['Idempotency-Key']);
  });
});
