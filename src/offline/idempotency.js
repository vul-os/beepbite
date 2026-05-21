/**
 * idempotency.js — helpers to generate and attach an Idempotency-Key header.
 *
 * The server reads the `Idempotency-Key` HTTP header (see
 * backend/internal/idempotency/middleware.go) and returns the cached response
 * for any duplicate request that carries the same key, preventing double-writes
 * even when a client retries after a network error.
 *
 * A key is stable per logical mutation: the same mutation intent always
 * produces the same key so that the offline queue can retry safely.  Keys are
 * derived from a caller-supplied logical ID (typically a ULID generated at the
 * moment the user initiates the action) combined with the HTTP method + URL,
 * producing a deterministic 64-character hex digest via SHA-256.
 *
 * Usage:
 *   import { makeIdempotencyKey, attachIdempotencyKey } from '@/offline/idempotency.js';
 *
 *   // Generate a stable key for a logical mutation:
 *   const key = await makeIdempotencyKey('POST', '/data/orders', logicalId);
 *
 *   // Attach to a headers object (mutates + returns it):
 *   const headers = {};
 *   await attachIdempotencyKey(headers, 'POST', '/data/orders', logicalId);
 *   // headers['Idempotency-Key'] === key
 */

/**
 * Derive a stable idempotency key from a logical mutation identity.
 *
 * @param {string} method      - HTTP method, e.g. 'POST'
 * @param {string} url         - Full or relative URL, e.g. '/data/orders'
 * @param {string} logicalId   - Caller-supplied stable ID (e.g. a ULID).
 * @returns {Promise<string>}  - 64-char lowercase hex SHA-256 digest
 */
export async function makeIdempotencyKey(method, url, logicalId) {
  const raw = `${method.toUpperCase()}|${url}|${logicalId}`;
  const encoded = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Attach an `Idempotency-Key` header to an existing headers object.
 * Mutates `headers` in-place and also returns it for convenience.
 *
 * @param {Record<string, string>} headers
 * @param {string} method
 * @param {string} url
 * @param {string} logicalId
 * @returns {Promise<Record<string, string>>}
 */
export async function attachIdempotencyKey(headers, method, url, logicalId) {
  headers['Idempotency-Key'] = await makeIdempotencyKey(method, url, logicalId);
  return headers;
}
