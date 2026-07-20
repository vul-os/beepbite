// admin.js — platform-admin API service layer.
// All endpoints require a platform-admin JWT (the same Bearer token stored
// in localStorage by api-client is sent automatically via api.request).

import { api } from '../lib/api-client.js';

/**
 * Search tenants by name/slug/email.
 * @param {string} q  - search query (may be empty for all)
 * @returns {Promise<{ data: Array, error: object }>}
 *   Each item: { org_id, name, slug, owner_email, status, created_at }
 */
export async function searchTenants(q = '') {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return api.request('GET', `/admin/tenants${qs}`);
}

/**
 * Fetch full detail for a single tenant.
 * @param {string} orgId
 * @returns {Promise<{ data: { org, alarms }, error: object }>}
 */
export async function getTenant(orgId) {
  return api.request('GET', `/admin/tenants/${encodeURIComponent(orgId)}`);
}

/**
 * Pause a tenant (suspend all activity).
 * @param {string} orgId
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function pauseTenant(orgId) {
  return api.request('POST', `/admin/tenants/${encodeURIComponent(orgId)}/pause`);
}

/**
 * Un-pause (resume) a previously paused tenant.
 * @param {string} orgId
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function unpauseTenant(orgId) {
  return api.request('POST', `/admin/tenants/${encodeURIComponent(orgId)}/unpause`);
}
