// timeclock.js — service layer for the timeclock endpoints.
//
// Routes backed by handlers/timeclock:
//   POST  /timeclock/clock-in
//   POST  /timeclock/clock-out
//   GET   /timeclock/entries
//   PATCH /timeclock/entries/:id

import { api } from '@/lib/api-client';

export interface TimeEntry {
  id: string;
  staff_id: string;
  entry_type: string;
  timestamp: string;
  notes?: string;
  [key: string]: unknown;
}

export interface EditEntryPatch {
  entryType?: string;
  timestamp?: string;
  notes?: string;
  reason?: string;
}

/**
 * Clock a staff member in.
 *
 * @param staffId  — UUID of the staff being clocked in.
 * @param notes  — Optional notes.
 */
export async function clockIn(staffId: string, notes = '') {
  const { data, error } = await api.request<TimeEntry>('POST', '/timeclock/clock-in', {
    auth: true,
    body: { staff_id: staffId, notes },
  });
  if (error) return { ok: false as const, error: error.message || 'Clock-in failed.' };
  return { ok: true as const, data };
}

/**
 * Clock a staff member out.
 *
 * @param staffId  — UUID of the staff being clocked out.
 * @param notes  — Optional notes.
 */
export async function clockOut(staffId: string, notes = '') {
  const { data, error } = await api.request<TimeEntry>('POST', '/timeclock/clock-out', {
    auth: true,
    body: { staff_id: staffId, notes },
  });
  if (error) return { ok: false as const, error: error.message || 'Clock-out failed.' };
  return { ok: true as const, data };
}

/**
 * List time entries (manager).
 */
export async function listEntries({ staffId, limit }: { staffId?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (staffId) params.set('staff_id', staffId);
  if (limit) params.set('limit', String(limit));

  const qs = params.toString();
  const path = `/timeclock/entries${qs ? '?' + qs : ''}`;

  const { data, error } = await api.request<TimeEntry[]>('GET', path, { auth: true });
  if (error) return { ok: false as const, error: error.message || 'Failed to load entries.' };
  return { ok: true as const, data: data || [] };
}

/**
 * Manager edit of a time entry.
 */
export async function editEntry(entryId: string, patch: EditEntryPatch) {
  const body: { entry_type?: string; timestamp?: string; notes?: string; reason?: string } = {};
  if (patch.entryType) body.entry_type = patch.entryType;
  if (patch.timestamp) body.timestamp = patch.timestamp;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.reason) body.reason = patch.reason;

  const { data, error } = await api.request<TimeEntry>('PATCH', `/timeclock/entries/${entryId}`, {
    auth: true,
    body,
  });
  if (error) return { ok: false as const, error: error.message || 'Edit failed.' };
  return { ok: true as const, data };
}

/**
 * Format a timestamp for display.
 *
 * @param isoString — ISO 8601 timestamp from the API.
 * @returns Human-friendly date-time string.
 */
export function formatTimestamp(isoString: string): string {
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
 */
export function entryTypeLabel(entryType: string): string {
  const labels: Record<string, string> = {
    clock_in: 'Clock In',
    clock_out: 'Clock Out',
    break_start: 'Break Start',
    break_end: 'Break End',
  };
  return labels[entryType] || entryType;
}
