// webhooks.js — service helpers for the Webhook Endpoints management endpoints.
// The signing_secret is returned once on creation; deliveries are paginated
// per-endpoint.

import { api } from '@/lib/api-client';

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  description?: string;
  is_active: boolean;
  created_at: string;
}

export interface WebhookEndpointCreated extends WebhookEndpoint {
  signing_secret: string;
}

export interface WebhookEndpointChanges {
  url?: string;
  events?: string[];
  description?: string;
  is_active?: boolean;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  status: string;
  response_code: number;
  delivered_at: string;
  duration_ms: number;
}

/**
 * List all webhook endpoints for the organisation.
 */
export async function listEndpoints() {
  return api.request<WebhookEndpoint[]>('GET', '/webhook-endpoints');
}

/**
 * Create a new webhook endpoint. The signing_secret is returned once in the
 * response — show it to the user immediately.
 */
export async function createEndpoint({ url, events, description }: { url: string; events: string[]; description?: string }) {
  return api.request<WebhookEndpointCreated>('POST', '/webhook-endpoints', {
    body: { url, events, description },
  });
}

/**
 * Update a webhook endpoint (url, events, description, is_active).
 */
export async function updateEndpoint(id: string, changes: WebhookEndpointChanges) {
  return api.request<WebhookEndpoint>('PUT', `/webhook-endpoints/${encodeURIComponent(id)}`, {
    body: changes,
  });
}

/**
 * Delete a webhook endpoint permanently.
 */
export async function deleteEndpoint(id: string) {
  return api.request('DELETE', `/webhook-endpoints/${encodeURIComponent(id)}`);
}

/**
 * Fetch recent deliveries for a webhook endpoint.
 */
export async function listDeliveries(endpointId: string) {
  return api.request<WebhookDelivery[]>(
    'GET',
    `/webhook-endpoints/${encodeURIComponent(endpointId)}/deliveries`,
  );
}
