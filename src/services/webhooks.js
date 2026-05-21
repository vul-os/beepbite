// webhooks.js — service helpers for the Webhook Endpoints management endpoints.
// The signing_secret is returned once on creation; deliveries are paginated
// per-endpoint.

import { api } from '@/lib/api-client';

/**
 * List all webhook endpoints for the organisation.
 *
 * @returns {Promise<{ data: Array<{id, url, events, description, is_active, created_at}>, error }>}
 */
export async function listEndpoints() {
  return api.request('GET', '/webhook-endpoints');
}

/**
 * Create a new webhook endpoint. The signing_secret is returned once in the
 * response — show it to the user immediately.
 *
 * @param {{ url: string, events: string[], description?: string }} params
 * @returns {Promise<{ data: { id, url, events, description, is_active, signing_secret, created_at }, error }>}
 */
export async function createEndpoint({ url, events, description }) {
  return api.request('POST', '/webhook-endpoints', {
    body: { url, events, description },
  });
}

/**
 * Update a webhook endpoint (url, events, description, is_active).
 *
 * @param {string} id
 * @param {{ url?: string, events?: string[], description?: string, is_active?: boolean }} changes
 * @returns {Promise<{ data: object, error }>}
 */
export async function updateEndpoint(id, changes) {
  return api.request('PUT', `/webhook-endpoints/${encodeURIComponent(id)}`, {
    body: changes,
  });
}

/**
 * Delete a webhook endpoint permanently.
 *
 * @param {string} id
 * @returns {Promise<{ data: null, error }>}
 */
export async function deleteEndpoint(id) {
  return api.request('DELETE', `/webhook-endpoints/${encodeURIComponent(id)}`);
}

/**
 * Fetch recent deliveries for a webhook endpoint.
 *
 * @param {string} endpointId
 * @returns {Promise<{ data: Array<{id, event, status, response_code, delivered_at, duration_ms}>, error }>}
 */
export async function listDeliveries(endpointId) {
  return api.request(
    'GET',
    `/webhook-endpoints/${encodeURIComponent(endpointId)}/deliveries`,
  );
}
