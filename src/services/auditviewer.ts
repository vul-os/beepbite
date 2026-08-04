// auditviewer.js — service helpers for the org-scoped audit log viewer endpoint.
// Requires a valid JWT (member) with an org membership.

import { api } from '@/lib/api-client';

export interface AuditEntry {
  id: string;
  organization_id: string | null;
  location_id: string | null;
  actor_type: string;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogPage {
  data: AuditEntry[];
  total: number;
  page: number;
  per_page: number;
}

export interface ListAuditLogOpts {
  /** Filter by actor_id (UUID). */
  actor?: string;
  /** Filter by action text (substring match). */
  action?: string;
  /** ISO 8601 start timestamp (inclusive). */
  from?: string;
  /** ISO 8601 end timestamp (inclusive). */
  to?: string;
  /** 1-based page number (default 1). */
  page?: number;
  /** Rows per page (default 50, max 200). */
  per_page?: number;
}

/**
 * List audit log entries for the caller's organisation.
 * All parameters are optional — omit to fetch the latest 50 rows.
 */
export async function listAuditLog({
  actor,
  action,
  from,
  to,
  page = 1,
  per_page = 50,
}: ListAuditLogOpts = {}) {
  const params = new URLSearchParams();
  if (actor) params.set('actor', actor);
  if (action) params.set('action', action);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('page', String(page));
  params.set('per_page', String(per_page));

  const qs = params.toString();
  return api.request<AuditLogPage>('GET', `/manager/audit${qs ? `?${qs}` : ''}`);
}
