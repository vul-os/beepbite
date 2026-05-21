// driver.js — thin wrappers around the driver portal backend endpoints.
// All calls go through the shared api client so auth/refresh is handled
// automatically.

import { api } from '@/lib/api-client';

/**
 * Fetch all active delivery assignments for this driver across every restaurant
 * that has invited them.
 *
 * GET /driver/assignments
 * Response: Assignment[]  (empty array when user is not a driver anywhere —
 *   the backend may also return 403 which the api client surfaces as an error)
 */
export async function fetchAssignments() {
  const { data, error } = await api.request('GET', '/driver/assignments');
  if (error) {
    // Surface 403 so the page can show the "not a driver" explainer.
    const e = new Error(error.message || 'Failed to fetch assignments');
    e.status = error.status;
    throw e;
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Transition an assignment to the next status.
 *
 * POST /driver/assignments/{id}/accept
 * POST /driver/assignments/{id}/pickup
 * POST /driver/assignments/{id}/deliver
 * POST /driver/assignments/{id}/cancel
 *
 * @param {string} id      - assignment UUID
 * @param {string} action  - 'accept' | 'pickup' | 'deliver' | 'cancel'
 */
export async function transitionAssignment(id, action) {
  if (!id) throw new Error('assignment id required');
  if (!action) throw new Error('action required');

  const { data, error } = await api.request(
    'POST',
    `/driver/assignments/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
  );
  if (error) {
    const e = new Error(error.message || `Failed to ${action} assignment`);
    e.status = error.status;
    throw e;
  }
  return data;
}

/**
 * Set driver shift status (online / offline).
 *
 * POST /driver/shifts/online
 * POST /driver/shifts/offline
 *
 * @param {'online'|'offline'} status
 */
export async function setShiftStatus(status) {
  if (status !== 'online' && status !== 'offline') {
    throw new Error('status must be "online" or "offline"');
  }
  const { data, error } = await api.request(
    'POST',
    `/driver/shifts/${encodeURIComponent(status)}`,
  );
  if (error) {
    const e = new Error(error.message || `Failed to go ${status}`);
    e.status = error.status;
    throw e;
  }
  return data;
}

/**
 * Send a location ping while the driver is on an active delivery.
 *
 * POST /driver/pings
 * Body: { lat, lng, accuracy?, assignment_id? }
 *
 * @param {{ lat: number, lng: number, accuracy?: number, assignment_id?: string }} payload
 */
export async function sendPing({ lat, lng, accuracy, assignment_id } = {}) {
  const body = { lat, lng };
  if (accuracy != null) body.accuracy = accuracy;
  if (assignment_id) body.assignment_id = assignment_id;

  const { data, error } = await api.request('POST', '/driver/pings', { body });
  if (error) {
    // Pings are best-effort — throw so the caller can log but the loop
    // should continue unless the error is permanent (e.g. 401).
    const e = new Error(error.message || 'Ping failed');
    e.status = error.status;
    throw e;
  }
  return data;
}
