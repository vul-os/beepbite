// Table and table-session service helpers — thin wrappers around the backend
// endpoints used by the POS table-management workspace. Keeping these
// centralised so screens don't reimplement fetch + error handling.

import { api } from '@/lib/api-client';

// ---- Table & section lookups ------------------------------------------------

/**
 * List all tables for a location, ordered by label.
 * Route: GET /data/tables?eq=location_id,X&order=label.asc
 * Note: the tables schema has no `table_number` column — the display field is `label`.
 */
export async function listTables(locationId) {
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
export async function listSections(locationId) {
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
export async function listOpenSessions(locationId) {
  if (!locationId) return [];
  const { data } = await api.request(
    'GET',
    `/data/table_sessions?eq=location_id,${encodeURIComponent(locationId)}&eq=status,open`,
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch a single session with its seats and linked orders.
 * Route: GET /sessions/{session_id}
 */
export async function getSessionDetail(sessionId) {
  if (!sessionId) throw new Error('sessionId required');
  const { data, error } = await api.request(
    'GET',
    `/sessions/${encodeURIComponent(sessionId)}`,
  );
  if (error) {
    const e = new Error(error.message || 'Failed to fetch session');
    e.status = error.status;
    throw e;
  }
  return data;
}

// ---- Session lifecycle ------------------------------------------------------

/**
 * Open a new session on a table.
 * Route: POST /tables/{table_id}/open-session
 */
export async function openTableSession({ tableId, locationId, partySize, openedBy, notes }) {
  if (!tableId) throw new Error('tableId required');
  const body = {
    location_id: locationId,
    party_size: partySize,
    opened_by: openedBy || '',
  };
  if (notes) body.notes = notes;

  const { data, error } = await api.request(
    'POST',
    `/tables/${encodeURIComponent(tableId)}/open-session`,
    { body },
  );
  if (error) {
    const e = new Error(error.message || 'Failed to open table session');
    e.status = error.status;
    throw e;
  }
  return data;
}

/**
 * Close an open session. Optionally update party size and add closing notes.
 * Route: POST /sessions/{session_id}/close
 */
export async function closeTableSession(sessionId, { partySize, notes } = {}) {
  if (!sessionId) throw new Error('sessionId required');
  const body = {};
  if (partySize != null) body.party_size = partySize;
  if (notes) body.notes = notes;

  const { data, error } = await api.request(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/close`,
    { body },
  );
  if (error) {
    const e = new Error(error.message || 'Failed to close session');
    e.status = error.status;
    throw e;
  }
  return data;
}

/**
 * Transfer a session to a different table.
 * Route: POST /sessions/{session_id}/transfer
 */
export async function transferSession(sessionId, { toTableId, openedBy, partySize, notes } = {}) {
  if (!sessionId) throw new Error('sessionId required');
  if (!toTableId) throw new Error('toTableId required');
  const body = {
    to_table_id: toTableId,
    opened_by: openedBy || '',
  };
  if (partySize != null) body.party_size = partySize;
  if (notes) body.notes = notes;

  const { data, error } = await api.request(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/transfer`,
    { body },
  );
  if (error) {
    const e = new Error(error.message || 'Failed to transfer session');
    e.status = error.status;
    throw e;
  }
  return data;
}

// ---- Check splits -----------------------------------------------------------

/**
 * Create check_splits + check_split_items for a session (split-by-seat).
 * Route: POST /sessions/{session_id}/split-check
 *
 * @param {string} sessionId
 * @param {Array<{label: string, items: Array<{order_item_id: string, quantity: number}>}>} splits
 * @param {string} [createdBy]
 * @returns {Promise<{splits: CheckSplit[], items: CheckSplitItem[]}>}
 */
export async function splitCheck(sessionId, splits, createdBy) {
  if (!sessionId) throw new Error('sessionId required');
  const body = { splits, created_by: createdBy || '' };
  const { data, error } = await api.request(
    'POST',
    `/sessions/${encodeURIComponent(sessionId)}/split-check`,
    { body },
  );
  if (error) {
    const e = new Error(error.message || 'Failed to split check');
    e.status = error.status;
    throw e;
  }
  return data;
}

/**
 * List seats for a session.
 * Route: GET /sessions/{session_id}/seats
 */
export async function listSeats(sessionId) {
  if (!sessionId) return [];
  const { data, error } = await api.request(
    'GET',
    `/sessions/${encodeURIComponent(sessionId)}/seats`,
  );
  if (error) {
    const e = new Error(error.message || 'Failed to list seats');
    e.status = error.status;
    throw e;
  }
  return Array.isArray(data) ? data : [];
}
