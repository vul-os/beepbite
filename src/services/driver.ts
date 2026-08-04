// driver.js — thin wrappers around the driver portal backend endpoints.
// All calls go through the shared api client so auth/refresh is handled
// automatically.

import { api } from '@/lib/api-client';

// Mirrors backend/internal/handlers/driver/store.go Assignment. NOTE: the
// UI (assignment-card.tsx) has always read `customer_address`, but the real
// field the backend sends is `delivery_address` — `customer_address` does
// not exist anywhere in the Go backend. Pre-existing mismatch, flagged not
// fixed; the index signature below preserves that defensive (always
// undefined) read.
export interface Assignment {
  id: string;
  order_id: string;
  driver_member_id: string;
  status: string;
  offered_at: string;
  accepted_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  canceled_reason?: string | null;
  created_at: string;
  updated_at: string;
  delivery_address?: string | null;
  total_cents: number;
  store_name: string;
  [key: string]: unknown;
}

interface FetchError extends Error {
  status?: number;
}

/**
 * Fetch all active delivery assignments for this driver across every restaurant
 * that has invited them.
 *
 * GET /driver/assignments
 * Response: Assignment[]  (empty array when user is not a driver anywhere —
 *   the backend may also return 403 which the api client surfaces as an error)
 */
export async function fetchAssignments(): Promise<Assignment[]> {
  const { data, error } = await api.request<Assignment[]>('GET', '/driver/assignments');
  if (error) {
    // Surface 403 so the page can show the "not a driver" explainer.
    const e: FetchError = new Error(error.message || 'Failed to fetch assignments');
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
 * @param id      - assignment UUID
 * @param action  - 'accept' | 'pickup' | 'deliver' | 'cancel'
 */
export async function transitionAssignment(id: string, action: string) {
  if (!id) throw new Error('assignment id required');
  if (!action) throw new Error('action required');

  const { data, error } = await api.request<Assignment>(
    'POST',
    `/driver/assignments/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
  );
  if (error) {
    const e: FetchError = new Error(error.message || `Failed to ${action} assignment`);
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
 */
export async function setShiftStatus(status: 'online' | 'offline') {
  if (status !== 'online' && status !== 'offline') {
    throw new Error('status must be "online" or "offline"');
  }
  const { data, error } = await api.request(
    'POST',
    `/driver/shifts/${encodeURIComponent(status)}`,
  );
  if (error) {
    const e: FetchError = new Error(error.message || `Failed to go ${status}`);
    e.status = error.status;
    throw e;
  }
  return data;
}

export interface PingPayload {
  lat: number;
  lng: number;
  accuracy?: number;
  assignment_id?: string;
}

/**
 * Send a location ping while the driver is on an active delivery.
 *
 * POST /driver/pings
 * Body: { lat, lng, accuracy?, assignment_id? }
 */
export async function sendPing({ lat, lng, accuracy, assignment_id }: Partial<PingPayload> = {}) {
  const body: { lat?: number; lng?: number; accuracy?: number; assignment_id?: string } = { lat, lng };
  if (accuracy != null) body.accuracy = accuracy;
  if (assignment_id) body.assignment_id = assignment_id;

  const { data, error } = await api.request('POST', '/driver/pings', { body });
  if (error) {
    // Pings are best-effort — throw so the caller can log but the loop
    // should continue unless the error is permanent (e.g. 401).
    const e: FetchError = new Error(error.message || 'Ping failed');
    e.status = error.status;
    throw e;
  }
  return data;
}
