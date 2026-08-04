// api-keys.js — service helpers for the API Keys management endpoints.
// Keys are scoped to the caller's organisation; the full plaintext key is
// returned ONCE on creation and never again.

import { api } from '@/lib/api-client';

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix_visible: string;
  scopes: string[];
  environment: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ApiKeyCreated {
  id: string;
  key: string;
  name: string;
  prefix_visible: string;
  scopes: string[];
  environment: string;
  created_at: string;
}

/**
 * List all API keys for the organisation (no full key — prefix_visible only).
 */
export async function listKeys() {
  return api.request<ApiKeySummary[]>('GET', '/api-keys');
}

/**
 * Create a new API key. The full plaintext key is returned exactly once in
 * the response and is NOT stored by the backend — callers must show it to
 * the user immediately.
 */
export async function createKey({ name, scopes, environment = 'live' }: {
  name: string;
  scopes: string[];
  environment?: 'live' | 'test';
}) {
  return api.request<ApiKeyCreated>('POST', '/api-keys', {
    body: { name, scopes, environment },
  });
}

/**
 * Revoke an API key. The key cannot be used after this call and the action
 * is irreversible.
 *
 * @param id  The API key UUID.
 */
export async function revokeKey(id: string) {
  return api.request('POST', `/api-keys/${encodeURIComponent(id)}/revoke`);
}
