// timeclock.js — service layer for the timeclock endpoints.
//
// Routes backed by handlers/timeclock:
//   POST  /timeclock/clock-in
//   POST  /timeclock/clock-out
//   GET   /timeclock/entries
//   PATCH /timeclock/entries/:id

import { api } from '@/lib/api-client';

/**
 * Clock a staff member in.
 *
 * @param {string} staffId  — UUID of the staff being clocked in.
 * @param {string} [notes]  — Optional notes.
 *
 * Returns { ok: true, data: TimeEntry } | { ok: false, error: string }
 */
export async function clockIn(staffId, notes = '') {
  const { data, error } = await api.request('POST', '/timeclock/clock-in', {
    auth: true,
    body: { staff_id: staffId, notes },
  });
  if (error) return { ok: false, error: error.message || 'Clock-in failed.' };
  return { ok: true, data };
}

/**
 * Clock a staff member out.
 *
 * @param {string} staffId  — UUID of the staff being clocked out.
 * @param {string} [notes]  — Optional notes.
 *
 * Returns { ok: true, data: TimeEntry } | { ok: false, error: string }
 */
export async function clockOut(staffId, notes = '') {
  const { data, error } = await api.request('POST', '/timeclock/clock-out', {
    auth: true,
    body: { staff_id: staffId, notes },
  });
  if (error) return { ok: false, error: error.message || 'Clock-out failed.' };
  return { ok: true, data };
}

/**
 * List time entries (manager).
 *
 * @param {{ staffId?: string, limit?: number }} [opts]
 *
 * Returns { ok: true, data: TimeEntry[] } | { ok: false, error: string }
 */
export async function listEntries({ staffId, limit } = {}) {
  const params = new URLSearchParams();
  if (staffId) params.set('staff_id', staffId);
  if (limit) params.set('limit', String(limit));

  const qs = params.toString();
  const path = `/timeclock/entries${qs ? '?' + qs : ''}`;

  const { data, error } = await api.request('GET', path, { auth: true });
  if (error) return { ok: false, error: error.message || 'Failed to load entries.' };
  return { ok: true, data: data || [] };
}

/**
 * Manager edit of a time entry.
 *
 * @param {string} entryId
 * @param {{ entryType?: string, timestamp?: string, notes?: string, reason?: string }} patch
 *
 * Returns { ok: true, data: TimeEntry } | { ok: false, error: string }
 */
export async function editEntry(entryId, patch) {
  const body = {};
  if (patch.entryType) body.entry_type = patch.entryType;
  if (patch.timestamp) body.timestamp = patch.timestamp;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.reason) body.reason = patch.reason;

  const { data, error } = await api.request('PATCH', `/timeclock/entries/${entryId}`, {
    auth: true,
    body,
  });
  if (error) return { ok: false, error: error.message || 'Edit failed.' };
  return { ok: true, data };
}

/**
 * Format a timestamp for display.
 *
 * @param {string} isoString — ISO 8601 timestamp from the API.
 * @returns {string} Human-friendly date-time string.
 */
export function formatTimestamp(isoString) {
  if (!isoString) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

/**
 * Returns a short label for an entry_type value.
 *
 * @param {string} entryType
 * @returns {string}
 */
export function entryTypeLabel(entryType) {
  const labels = {
    clock_in: 'Clock In',
    clock_out: 'Clock Out',
    break_start: 'Break Start',
    break_end: 'Break End',
  };
  return labels[entryType] || entryType;
}
