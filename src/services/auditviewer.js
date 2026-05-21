// auditviewer.js — service helpers for the org-scoped audit log viewer endpoint.
// Requires a valid JWT (member) with an org membership.

import { api } from '@/lib/api-client';

/**
 * List audit log entries for the caller's organisation.
 * All parameters are optional — omit to fetch the latest 50 rows.
 *
 * @param {object} opts
 * @param {string} [opts.actor]    Filter by actor_id (UUID).
 * @param {string} [opts.action]   Filter by action text (substring match).
 * @param {string} [opts.from]     ISO 8601 start timestamp (inclusive).
 * @param {string} [opts.to]       ISO 8601 end timestamp (inclusive).
 * @param {number} [opts.page]     1-based page number (default 1).
 * @param {number} [opts.per_page] Rows per page (default 50, max 200).
 * @returns {Promise<{ data: { data: AuditEntry[], total: number, page: number, per_page: number }, error }>}
 *
 * @typedef {object} AuditEntry
 * @property {string}  id
 * @property {string|null} organization_id
 * @property {string|null} location_id
 * @property {string}  actor_type
 * @property {string|null} actor_id
 * @property {string|null} actor_label
 * @property {string}  action
 * @property {string}  entity_type
 * @property {string|null} entity_id
 * @property {object|null} before_state
 * @property {object|null} after_state
 * @property {string}  created_at
 */
export async function listAuditLog({
  actor,
  action,
  from,
  to,
  page = 1,
  per_page = 50,
} = {}) {
  const params = new URLSearchParams();
  if (actor) params.set('actor', actor);
  if (action) params.set('action', action);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('page', String(page));
  params.set('per_page', String(per_page));

  const qs = params.toString();
  return api.request('GET', `/manager/audit${qs ? `?${qs}` : ''}`);
}
