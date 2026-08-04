// admin.js — platform-admin API service layer.
// All endpoints require a platform-admin JWT (the same Bearer token stored
// in localStorage by api-client is sent automatically via api.request).

import { api } from '../lib/api-client.js';

export interface TenantSummary {
  org_id: string;
  name: string;
  slug: string;
  owner_email: string;
  status: string;
  created_at: string;
}

export interface TenantDetail {
  org: unknown;
  alarms: unknown;
}

/**
 * Search tenants by name/slug/email.
 * @param q  - search query (may be empty for all)
 */
export async function searchTenants(q = '') {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return api.request<TenantSummary[]>('GET', `/admin/tenants${qs}`);
}

/**
 * Fetch full detail for a single tenant.
 */
export async function getTenant(orgId: string) {
  return api.request<TenantDetail>('GET', `/admin/tenants/${encodeURIComponent(orgId)}`);
}

/**
 * Pause a tenant (suspend all activity).
 */
export async function pauseTenant(orgId: string) {
  return api.request('POST', `/admin/tenants/${encodeURIComponent(orgId)}/pause`);
}

/**
 * Un-pause (resume) a previously paused tenant.
 */
export async function unpauseTenant(orgId: string) {
  return api.request('POST', `/admin/tenants/${encodeURIComponent(orgId)}/unpause`);
}
