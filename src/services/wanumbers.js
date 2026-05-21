// wanumbers.js — platform-admin API service layer for WhatsApp phone numbers.
// All endpoints require a platform-admin JWT (Bearer token in localStorage,
// sent automatically via api.request).

import { api } from '../lib/api-client.js';

/**
 * List all WhatsApp phone numbers.
 * @param {{ activeOnly?: boolean }} opts
 * @returns {Promise<{ data: Array, error: object }>}
 */
export async function listWANumbers({ activeOnly = false } = {}) {
  const qs = activeOnly ? '?active_only=true' : '';
  return api.request('GET', `/admin/wa-numbers${qs}`);
}

/**
 * Get a single WhatsApp phone number by id.
 * @param {string} id
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function getWANumber(id) {
  return api.request('GET', `/admin/wa-numbers/${encodeURIComponent(id)}`);
}

/**
 * Register a new WhatsApp phone number.
 * @param {{ meta_phone_number_id: string, display_phone: string, country: string, regions?: string[] }} body
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function createWANumber(body) {
  return api.request('POST', '/admin/wa-numbers', { body });
}

/**
 * Partially update a WhatsApp phone number.
 * @param {string} id
 * @param {{ display_phone?: string, country?: string, regions?: string[], active?: boolean }} body
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function updateWANumber(id, body) {
  return api.request('PATCH', `/admin/wa-numbers/${encodeURIComponent(id)}`, { body });
}

/**
 * Deactivate (soft-delete) a WhatsApp phone number.
 * @param {string} id
 * @returns {Promise<{ data: object, error: object }>}
 */
export async function deactivateWANumber(id) {
  return api.request('POST', `/admin/wa-numbers/${encodeURIComponent(id)}/deactivate`);
}
