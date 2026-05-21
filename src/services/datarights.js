// datarights.js — service helpers for Wave 31 data-rights endpoints.

import { api } from '@/lib/api-client';

/**
 * Soft-delete the caller's organisation (reversible within 30 days).
 *
 * @returns {Promise<{ data: { status: string, message: string }, error }>}
 */
export async function deleteAccount() {
  return api.request('DELETE', '/settings/account', { body: { confirm: true } });
}

/**
 * Cancel a pending soft-delete and restore the organisation.
 *
 * @returns {Promise<{ data: { status: string, message: string }, error }>}
 */
export async function restoreAccount() {
  return api.request('POST', '/settings/account/restore');
}

/**
 * Request a full data export (JSON archive of orders, customers, staff,
 * audit log). The response includes the job metadata and the inline archive.
 *
 * @returns {Promise<{ data: { job: object, archive: object }, error }>}
 */
export async function requestDataExport() {
  return api.request('POST', '/settings/data-export');
}

/**
 * Redact PII for a specific customer (right-to-be-forgotten).
 * Order history is retained anonymised.
 *
 * @param {string} customerId  UUID of the customer to forget.
 * @returns {Promise<{ data: { status: string, message: string }, error }>}
 */
export async function forgetCustomer(customerId) {
  return api.request('POST', `/customers/${customerId}/forget`);
}
