// whatsapplink.js — WhatsApp number ↔ account binding service.
//
// Endpoints (served by internal/handlers/whatsapplink):
//
//   GET  /link-whatsapp/{token}   — public; returns pending phone for token
//   POST /link-whatsapp/{token}   — authed; binds phone → caller's profile
//   GET  /link-whatsapp           — authed; lists all bound numbers

import { api } from '@/lib/api-client';

/**
 * Fetch the pending phone number for a link token.
 * Public — no auth required.
 *
 * @param {string} token — the short link token from the URL
 * @returns {Promise<{ data: { token, phone_e164, expires_at } | null, error: any }>}
 */
export async function fetchPendingPhone(token) {
  if (!token) {
    return { data: null, error: { message: 'token is required' } };
  }
  return api.request('GET', `/link-whatsapp/${encodeURIComponent(token)}`, { auth: false });
}

/**
 * Bind the phone associated with a token to the authenticated user's profile.
 * Requires the user to be signed in (bearer token sent automatically).
 *
 * @param {string} token — the short link token
 * @returns {Promise<{ data: { id, profile_id, phone_e164, bound_at } | null, error: any }>}
 *   error.status === 409  — phone already linked or 3-number cap reached
 *   error.status === 410  — token expired or already consumed
 */
export async function bindPhone(token) {
  if (!token) {
    return { data: null, error: { message: 'token is required' } };
  }
  return api.request('POST', `/link-whatsapp/${encodeURIComponent(token)}`, {});
}

/**
 * List all WhatsApp numbers bound to the authenticated user's profile.
 * Requires the user to be signed in.
 *
 * @returns {Promise<{ data: { links: AccountLink[] } | null, error: any }>}
 *
 * @typedef {{ id: string, profile_id: string, phone_e164: string, bound_at: string }} AccountLink
 */
export async function listLinkedNumbers() {
  return api.request('GET', '/link-whatsapp', {});
}
