// userprefs.js — user workspace preference service (Wave 35 / Now-27).
//
// Endpoints:
//   GET /me/preferences  → { profile_id, last_view_pos, last_view_kds, updated_at }
//   PUT /me/preferences  → same shape; body: { last_view_pos?, last_view_kds? }
//
// Falls back to localStorage when the server returns a 404 (no row saved yet)
// or when the network is unavailable. The unified workspace reads these helpers
// so preferences travel with the user across devices when connected.

import { api } from '@/lib/api-client';

const LS_KEY_POS = 'bb.workspace.last_view_pos';
const LS_KEY_KDS = 'bb.workspace.last_view_kds';

// ---------------------------------------------------------------------------
// Local-storage helpers
// ---------------------------------------------------------------------------

function lsGet(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    if (value != null) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Fetch preferences
// ---------------------------------------------------------------------------

/**
 * Load user preferences from the server.
 * Falls back to localStorage on 404 (no prefs saved yet) or network error.
 *
 * @returns {Promise<{ lastViewPOS: string, lastViewKDS: string }>}
 */
export async function fetchPrefs() {
  try {
    const { data, error } = await api.request('GET', '/me/preferences');
    if (!error && data) {
      // Sync the server values into localStorage as a cache.
      if (data.last_view_pos) lsSet(LS_KEY_POS, data.last_view_pos);
      if (data.last_view_kds) lsSet(LS_KEY_KDS, data.last_view_kds);
      return {
        lastViewPOS: data.last_view_pos || lsGet(LS_KEY_POS, 'full'),
        lastViewKDS: data.last_view_kds || lsGet(LS_KEY_KDS, 'station'),
      };
    }
  } catch {
    // fall through to localStorage
  }
  // 404 or network error — use localStorage defaults.
  return {
    lastViewPOS: lsGet(LS_KEY_POS, 'full'),
    lastViewKDS: lsGet(LS_KEY_KDS, 'station'),
  };
}

// ---------------------------------------------------------------------------
// Save preferences
// ---------------------------------------------------------------------------

/**
 * Persist a POS view preference.
 * Writes to localStorage immediately (optimistic) then syncs to server.
 *
 * @param {string} view — 'quick' | 'full' | 'floor' | 'orders'
 */
export async function savePOSView(view) {
  lsSet(LS_KEY_POS, view);
  try {
    await api.request('PUT', '/me/preferences', { body: { last_view_pos: view } });
  } catch {
    // localStorage write succeeded — tolerate server error silently.
  }
}

/**
 * Persist a Kitchen view preference.
 * Writes to localStorage immediately (optimistic) then syncs to server.
 *
 * @param {string} view — 'station' | 'expo' | 'bumpbar'
 */
export async function saveKDSView(view) {
  lsSet(LS_KEY_KDS, view);
  try {
    await api.request('PUT', '/me/preferences', { body: { last_view_kds: view } });
  } catch {
    // localStorage write succeeded — tolerate server error silently.
  }
}
