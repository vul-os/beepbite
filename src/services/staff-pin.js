// staff-pin.js — service layer for the /s/:slug staff PIN login flow.
// Wraps:
//   GET  /stores/:slug          → resolve store display name + location_id
//   POST /pos/pin-verify        → actor-overlay PIN verify (new, preferred)
//   POST /auth/staff/pin-login  → legacy full-session PIN login (kept for /pos/login)

import { api } from '@/lib/api-client';

/**
 * Resolve a store by its public slug.
 *
 * Returns { ok: true, data: { location_id, display_name, ... } }
 *       | { ok: false, notFound: true }   ← slug does not exist (404)
 *       | { ok: false, error: string }    ← network / server error
 *
 * NOTE: Until GET /stores/:slug is deployed, this falls back to a mock that
 * returns a stub response so the frontend can be developed in parallel.
 */
export async function resolveStore(slug) {
  try {
    const { data, error } = await api.request('GET', `/stores/${encodeURIComponent(slug)}`, {
      auth: false,
    });

    if (error) {
      if (error.status === 404) return { ok: false, notFound: true };
      return { ok: false, error: error.message || 'Failed to load store.' };
    }

    return { ok: true, data };
  } catch (err) {
    // Network failure — surface as a generic error rather than leaking slug info.
    return { ok: false, error: 'Unable to reach the server. Check your connection.' };
  }
}

/**
 * Actor-overlay PIN verify — new path used by /s/:slug.
 *
 * Requires the device's existing member bearer token (must be authenticated).
 * Returns a short-lived actor token (15 min) stored in memory only.
 *
 * @param {string} username
 * @param {string} pin         4–6 digit string
 * @param {string} location_id UUID resolved from the slug
 * @param {string} [slug]      Original slug — attached to actor payload for
 *                             "End shift" navigation back to /s/:slug.
 *
 * Returns { ok: true, data: { actor_token, expires_at, staff, capabilities } }
 *       | { ok: false, locked: true }
 *       | { ok: false, error: string }
 */
export async function pinVerifyOverlay(username, pin, location_id, slug) {
  const { data, error } = await api.request('POST', '/pos/pin-verify', {
    auth: true,
    body: { username, pin, location_id },
  });

  if (error) {
    if (error.status === 423) {
      return {
        ok: false,
        locked: true,
        error: 'Account is locked due to too many failed attempts. Please contact your manager.',
      };
    }
    if (error.status === 429) {
      return {
        ok: false,
        error: 'Too many login attempts. Please wait a moment and try again.',
      };
    }
    return { ok: false, error: error.message || 'Invalid username or PIN.' };
  }

  // Attach the slug so the workspace knows where to navigate on End shift.
  return { ok: true, data: { ...data, slug } };
}

/**
 * Legacy full-session PIN login — still used by /pos/login (kitchen tablets).
 *
 * @param {string} username
 * @param {string} pin         4–6 digit string
 * @param {string} location_id UUID of the location resolved from the slug
 *
 * Returns { ok: true, data }
 *       | { ok: false, locked: true }    ← HTTP 423 — account locked
 *       | { ok: false, error: string }
 */
export async function pinLogin(username, pin, location_id) {
  const { data, error } = await api.request('POST', '/auth/staff/pin-login', {
    auth: false,
    body: { username, pin, location_id },
  });

  if (error) {
    if (error.status === 423) {
      return {
        ok: false,
        locked: true,
        error: 'Account is locked due to too many failed attempts. Please contact your manager.',
      };
    }
    if (error.status === 429) {
      return {
        ok: false,
        error: 'Too many login attempts. Please wait a moment and try again.',
      };
    }
    return { ok: false, error: error.message || 'Invalid username or PIN.' };
  }

  return { ok: true, data };
}
