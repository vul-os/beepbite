// api-keys.js — service helpers for the API Keys management endpoints.
// Keys are scoped to the caller's organisation; the full plaintext key is
// returned ONCE on creation and never again.

import { api } from '@/lib/api-client';

/**
 * List all API keys for the organisation (no full key — prefix_visible only).
 *
 * @returns {Promise<{ data: Array<{id, name, prefix_visible, scopes, environment, last_used_at, revoked_at, created_at}>, error }>}
 */
export async function listKeys() {
  return api.request('GET', '/api-keys');
}

/**
 * Create a new API key. The full plaintext key is returned exactly once in
 * the response and is NOT stored by the backend — callers must show it to
 * the user immediately.
 *
 * @param {{ name: string, scopes: string[], environment?: 'live' | 'test' }} params
 * @returns {Promise<{ data: { id, key, name, prefix_visible, scopes, environment, created_at }, error }>}
 */
export async function createKey({ name, scopes, environment = 'live' }) {
  return api.request('POST', '/api-keys', {
    body: { name, scopes, environment },
  });
}

/**
 * Revoke an API key. The key cannot be used after this call and the action
 * is irreversible.
 *
 * @param {string} id  The API key UUID.
 * @returns {Promise<{ data: null, error }>}
 */
export async function revokeKey(id) {
  return api.request('POST', `/api-keys/${encodeURIComponent(id)}/revoke`);
}
