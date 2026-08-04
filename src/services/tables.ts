// Table and table-session service helpers — thin wrappers around the backend
// endpoints used by the POS table-management workspace. Keeping these
// centralised so screens don't reimplement fetch + error handling.

import { api } from '@/lib/api-client';

interface FetchError extends Error {
  status?: number;
}

// Mirrors backend/internal/handlers/tables/types.go CheckSplit. The previous
// version of this type declared a `label` field that the wire never actually
// sends (the real field is `split_label`, see below) — callers already read
// `split_label`/`id` correctly, so this is a type-only correction.
export interface CheckSplit {
  id: string;
  table_session_id: string;
  split_label: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors backend/internal/handlers/tables/types.go CheckSplitItem.
export interface CheckSplitItem {
  id: string;
  check_split_id: string;
  order_item_id: string;
  quantity: number;
}

// Mirrors backend/migrations/001_baseline.sql public.tables.
export interface RestaurantTable {
  id: string;
  location_id: string;
  section_id: string | null;
  label: string;
  capacity: number;
  status: 'available' | 'occupied' | 'reserved' | 'out_of_service';
  pos_x: number | null;
  pos_y: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

// Mirrors backend/migrations/001_baseline.sql public.sections.
export interface Section {
  id: string;
  location_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

// Mirrors backend/internal/handlers/tables/types.go TableSession.
export interface TableSession {
  id: string;
  table_id: string;
  location_id: string;
  opened_by: string | null;
  party_size: number;
  status: string;
  opened_at: string;
  closed_at: string | null;
  transferred_to_session_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

// Mirrors backend/internal/handlers/tables/types.go Seat.
export interface Seat {
  id: string;
  table_session_id: string;
  seat_number: number;
  guest_name: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

// ---- Table & section lookups ------------------------------------------------

/**
 * List all tables for a location, ordered by label.
 * Route: GET /data/tables?eq=location_id,X&order=label.asc
 * Note: the tables schema has no `table_number` column — the display field is `label`.
 */
export async function listTables(locationId: string): Promise<RestaurantTable[]> {
  if (!locationId) return [];
  const { data } = await api.request(
    'GET',
    `/data/tables?eq=location_id,${encodeURIComponent(locationId)}&order=label.asc`,
  );
  return Array.isArray(data) ? data : [];
}

/**
 * List all floor sections for a location.
 * Route: GET /data/sections?eq=location_id,X
 */
export async function listSections(locationId: string): Promise<Section[]> {
  if (!locationId) return [];
  const { data } = await api.request(
    'GET',
    `/data/sections?eq=location_id,${encodeURIComponent(locationId)}`,
  );
  return Array.isArray(data) ? data : [];
}

// ---- Session lookups --------------------------------------------------------

/**
 * List all currently-open table sessions for a location.
 * Route: GET /data/table_sessions?eq=location_id,X&eq=status,open
 */
export async function listOpenSessions(locationId: string): Promise<TableSession[]> {
  if (!locationId) return [];
  const { data } = await api.request(
    'GET',
    `/data/table_sessions?eq=location_id,${encodeURIComponent(locationId)}&eq=status,open`,
  );
  return Array.isArray(data) ? data : [];
}

// Mirrors backend/internal/handlers/tables/types.go Order — the LIGHTWEIGHT
// view returned as SessionDetail.orders (see store.go's GetSessionDetail,
// which SELECTs only these 5 columns). It does NOT carry order_number,
// payment_status, total_amount_cents/total, or items — callers hydrating a
// ticket from this must not assume those fields exist (see workspace.tsx).
export interface SessionOrderLite {
  id: string;
  order_type: string;
  status: string;
  course_number: number | null;
  created_at: string;
}

// Mirrors backend/internal/handlers/tables/types.go SessionDetail, which Go
// struct-embeds TableSession — its fields are flattened at the JSON top level
// alongside `seats`/`orders`, not nested under a `session` key.
export interface SessionDetail extends TableSession {
  seats: Seat[];
  orders: SessionOrderLite[];
}

/**
 * Fetch a single session with its seats and linked orders.
 * Route: GET /sessions/{session_id}
 */
export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  if (!sessionId) throw new Error('sessionId required');
  const { data, error } = await api.request<SessionDetail>(
    'GET',
    `/sessions/${encodeURIComponent(sessionId)}`,
  );
  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to fetch session');
    e.status = error.status;
    throw e;
  }
  return data!;
}

// ---- Session lifecycle ------------------------------------------------------

/**
 * Open a new session on a table.
 * Route: POST /tables/{table_id}/open-session
 */
export async function openTableSession({ tableId, locationId, partySize, openedBy, notes }: {
  tableId: string;
  locationId: string;
  partySize: number;
  openedBy?: string;
  notes?: string;
}): Promise<TableSession> {
  if (!tableId) throw new Error('tableId required');
  const body: { location_id: string; party_size: number; opened_by: string; notes?: string } = {
    location_id: locationId,
    party_size: partySize,
    opened_by: openedBy || '',
  };
  if (notes) body.notes = notes;

  const { data, error } = await api.request<TableSession>(
    'POST',
    `/tables/${encodeURIComponent(tableId)}/open-session`,
    { body },
  );
  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to open table session');
    e.status = error.status;
    throw e;
  }
  return data!;
}

/**
 * Close an open session. Optionally update party size and add closing notes.
 * Route: POST /sessions/{session_id}/close
 */
export async function closeTableSession(sessionId: string, { partySize, notes }: { partySize?: number; notes?: string } = {}) {
  if (!sessionId) throw new Error('sessionId required');
  const body: { party_size?: number; notes?: string } = {};
  if (partySize != null) body.party_size = partySize;
  if (notes) body.notes = notes;

  const { data, error } = await api.request(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/close`,
    { body },
  );
  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to close session');
    e.status = error.status;
    throw e;
  }
  return data;
}

/**
 * Transfer a session to a different table.
 * Route: POST /sessions/{session_id}/transfer
 */
export async function transferSession(sessionId: string, { toTableId, openedBy, partySize, notes }: {
  toTableId?: string;
  openedBy?: string;
  partySize?: number;
  notes?: string;
} = {}): Promise<TableSession> {
  if (!sessionId) throw new Error('sessionId required');
  if (!toTableId) throw new Error('toTableId required');
  const body: { to_table_id: string; opened_by: string; party_size?: number; notes?: string } = {
    to_table_id: toTableId,
    opened_by: openedBy || '',
  };
  if (partySize != null) body.party_size = partySize;
  if (notes) body.notes = notes;

  const { data, error } = await api.request<TableSession>(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/transfer`,
    { body },
  );
  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to transfer session');
    e.status = error.status;
    throw e;
  }
  return data!;
}

// ---- Check splits -----------------------------------------------------------

/**
 * Create check_splits + check_split_items for a session (split-by-seat).
 * Route: POST /sessions/{session_id}/split-check
 */
export async function splitCheck(
  sessionId: string,
  splits: Array<{ label: string; items: Array<{ order_item_id: string; quantity: number }> }>,
  createdBy?: string,
): Promise<{ splits: CheckSplit[]; items: CheckSplitItem[] }> {
  if (!sessionId) throw new Error('sessionId required');
  const body = { splits, created_by: createdBy || '' };
  const { data, error } = await api.request<{ splits: CheckSplit[]; items: CheckSplitItem[] }>(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/split-check`,
    { body },
  );
  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to split check');
    e.status = error.status;
    throw e;
  }
  return data!;
}

/**
 * List seats for a session.
 * Route: GET /sessions/{session_id}/seats
 */
export async function listSeats(sessionId: string): Promise<Seat[]> {
  if (!sessionId) return [];
  const { data, error } = await api.request(
    'GET',
    `/sessions/${encodeURIComponent(sessionId)}/seats`,
  );
  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to list seats');
    e.status = error.status;
    throw e;
  }
  return Array.isArray(data) ? data : [];
}
