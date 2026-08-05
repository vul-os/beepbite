// whatsapplink.js — WhatsApp number ↔ account binding service.
//
// Endpoints (served by internal/handlers/whatsapplink):
//
//   GET  /link-whatsapp/{token}   — public; returns pending phone for token
//   POST /link-whatsapp/{token}   — authed; binds phone → caller's profile
//   GET  /link-whatsapp           — authed; lists all bound numbers

import { api } from '@/lib/api-client';

export interface PendingPhone {
  token: string;
  phone_e164: string;
  expires_at: string;
}

export interface AccountLink {
  id: string;
  profile_id: string;
  phone_e164: string;
  bound_at: string;
}

export interface BoundPhone {
  id: string;
  profile_id: string;
  phone_e164: string;
  bound_at: string;
}

/**
 * Fetch the pending phone number for a link token.
 * Public — no auth required.
 *
 * @param token — the short link token from the URL
 */
export async function fetchPendingPhone(token: string) {
  if (!token) {
    return { data: null, error: { message: 'token is required' } };
  }
  return api.request<PendingPhone>('GET', `/link-whatsapp/${encodeURIComponent(token)}`, { auth: false });
}

/**
 * Bind the phone associated with a token to the authenticated user's profile.
 * Requires the user to be signed in (bearer token sent automatically).
 *
 * @param token — the short link token
 *   error.status === 409  — phone already linked or 3-number cap reached
 *   error.status === 410  — token expired or already consumed
 */
export async function bindPhone(token: string) {
  if (!token) {
    return { data: null, error: { message: 'token is required' } };
  }
  return api.request<BoundPhone>('POST', `/link-whatsapp/${encodeURIComponent(token)}`, {});
}

/**
 * List all WhatsApp numbers bound to the authenticated user's profile.
 * Requires the user to be signed in.
 */
export async function listLinkedNumbers() {
  return api.request<{ links: AccountLink[] }>('GET', '/link-whatsapp', {});
}
