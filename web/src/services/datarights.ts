// datarights.js — service helpers for Wave 31 data-rights endpoints.

import { api } from '@/lib/api-client';

export interface StatusMessage {
  status: string;
  message: string;
}

export interface DataExportResult {
  job: unknown;
  archive: unknown;
}

/**
 * Soft-delete the caller's organisation (reversible within 30 days).
 */
export async function deleteAccount() {
  return api.request<StatusMessage>('DELETE', '/settings/account', { body: { confirm: true } });
}

/**
 * Cancel a pending soft-delete and restore the organisation.
 */
export async function restoreAccount() {
  return api.request<StatusMessage>('POST', '/settings/account/restore');
}

/**
 * Request a full data export (JSON archive of orders, customers, staff,
 * audit log). The response includes the job metadata and the inline archive.
 */
export async function requestDataExport() {
  return api.request<DataExportResult>('POST', '/settings/data-export');
}

/**
 * Redact PII for a specific customer (right-to-be-forgotten).
 * Order history is retained anonymised.
 *
 * @param customerId  UUID of the customer to forget.
 */
export async function forgetCustomer(customerId: string) {
  return api.request<StatusMessage>('POST', `/customers/${customerId}/forget`);
}
