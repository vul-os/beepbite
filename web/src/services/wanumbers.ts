// wanumbers.js — platform-admin API service layer for WhatsApp phone numbers.
// All endpoints require a platform-admin JWT (Bearer token in localStorage,
// sent automatically via api.request).

import { api } from '../lib/api-client';

export interface WANumber {
  id: string;
  meta_phone_number_id: string;
  display_phone: string;
  country: string;
  regions?: string[];
  active?: boolean;
  configured_at?: string;
  [key: string]: unknown;
}

export interface CreateWANumberBody {
  meta_phone_number_id: string;
  display_phone: string;
  country: string;
  regions?: string[];
}

export interface UpdateWANumberBody {
  display_phone?: string;
  country?: string;
  regions?: string[];
  active?: boolean;
}

/**
 * List all WhatsApp phone numbers.
 */
export async function listWANumbers({ activeOnly = false }: { activeOnly?: boolean } = {}) {
  const qs = activeOnly ? '?active_only=true' : '';
  return api.request<WANumber[]>('GET', `/admin/wa-numbers${qs}`);
}

/**
 * Get a single WhatsApp phone number by id.
 */
export async function getWANumber(id: string) {
  return api.request<WANumber>('GET', `/admin/wa-numbers/${encodeURIComponent(id)}`);
}

/**
 * Register a new WhatsApp phone number.
 */
export async function createWANumber(body: CreateWANumberBody) {
  return api.request<WANumber>('POST', '/admin/wa-numbers', { body });
}

/**
 * Partially update a WhatsApp phone number.
 */
export async function updateWANumber(id: string, body: UpdateWANumberBody) {
  return api.request<WANumber>('PATCH', `/admin/wa-numbers/${encodeURIComponent(id)}`, { body });
}

/**
 * Deactivate (soft-delete) a WhatsApp phone number.
 */
export async function deactivateWANumber(id: string) {
  return api.request<WANumber>('POST', `/admin/wa-numbers/${encodeURIComponent(id)}/deactivate`);
}
