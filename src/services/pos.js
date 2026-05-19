// POS service helpers — thin wrappers around backend endpoints used by the
// cashier-facing pages. Keeping these centralised so screens don't reimplement
// fetch + error handling for the same routes.

import { api } from '@/lib/api-client';

const STORAGE_KEY = 'bb.auth';
const REGISTER_SESSION_KEY = 'pos.register_session_id';
const REGISTER_DRAWER_KEY = 'pos.register_drawer_id';
const REGISTER_OPENED_AT_KEY = 'pos.register_opened_at';

// ---- Staff session helpers --------------------------------------------------

/**
 * Read the currently-logged-in staff session from localStorage.
 * The staff PIN/password login persists this under `bb.auth`.
 * Returns shape: { staff: { id, first_name, last_name, role, location_id }, access_token, ... }
 */
export function readStaffSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Convenience: extract just the staff record (or null).
 */
export function getStaff() {
  const session = readStaffSession();
  return session?.staff || null;
}

/**
 * Convenience: return a display name for the staff member.
 */
export function getStaffDisplayName() {
  const staff = getStaff();
  if (!staff) return '';
  const first = staff.first_name || '';
  const last = staff.last_name || '';
  const full = `${first} ${last}`.trim();
  return full || staff.username || staff.id || '';
}

// ---- Register-session persistence ------------------------------------------

export function readStoredRegister() {
  try {
    const sessionId = localStorage.getItem(REGISTER_SESSION_KEY) || null;
    const drawerId = localStorage.getItem(REGISTER_DRAWER_KEY) || null;
    const openedAt = localStorage.getItem(REGISTER_OPENED_AT_KEY) || null;
    if (!sessionId) return null;
    return { sessionId, drawerId, openedAt };
  } catch {
    return null;
  }
}

export function persistRegister({ sessionId, drawerId, openedAt }) {
  try {
    if (sessionId) localStorage.setItem(REGISTER_SESSION_KEY, sessionId);
    else localStorage.removeItem(REGISTER_SESSION_KEY);
    if (drawerId) localStorage.setItem(REGISTER_DRAWER_KEY, drawerId);
    else localStorage.removeItem(REGISTER_DRAWER_KEY);
    if (openedAt) localStorage.setItem(REGISTER_OPENED_AT_KEY, openedAt);
    else localStorage.removeItem(REGISTER_OPENED_AT_KEY);
  } catch {
    // ignore quota errors — register-session ID will simply re-prompt on refresh.
  }
}

export function clearStoredRegister() {
  persistRegister({ sessionId: null, drawerId: null, openedAt: null });
}

// ---- Cash drawer / register-session API ------------------------------------

/**
 * List active drawers for a location.
 */
export async function listDrawers(locationId) {
  if (!locationId) return [];
  const { data } = await api.request(
    'GET',
    `/data/cash_drawers?eq=location_id,${encodeURIComponent(locationId)}&eq=is_active,true`,
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch the open session (if any) for a drawer.
 * Backend route: GET /cash-drawers/{drawer_id}/sessions?status=open
 */
export async function getOpenSession(drawerId) {
  if (!drawerId) return null;
  const { data, error } = await api.request(
    'GET',
    `/cash-drawers/${encodeURIComponent(drawerId)}/sessions?status=open`,
  );
  if (error) throw new Error(error.message || 'Failed to fetch session');
  const sessions = Array.isArray(data) ? data : data ? [data] : [];
  return sessions[0] || null;
}

/**
 * Open a session on a drawer. denominations is a {key: count} map from the
 * DenominationGrid component.
 */
export async function openRegisterSession({
  drawerId,
  openingFloatCents,
  openedByStaffId,
  denominations,
  isBlindClose = false,
  note = '',
}) {
  if (!drawerId) throw new Error('drawerId required');
  const { data, error } = await api.request(
    'POST',
    `/cash-drawers/${encodeURIComponent(drawerId)}/sessions/open`,
    {
      body: {
        opening_float_cents: openingFloatCents,
        opened_by_staff_id: openedByStaffId || '',
        is_blind_close: isBlindClose,
        denominations: denominations || {},
        notes: note || undefined,
      },
    },
  );
  if (error) throw new Error(error.message || 'Failed to open register');
  return data;
}

// ---- POS order checkout -----------------------------------------------------

/**
 * Submit a cart as a POS order. Contract:
 *   POST /pos/orders
 *   { location_id, order_type, table_number?, register_session_id, items: [...] }
 *   response: { order_id, order_number, total, kds_ticket_ids: [] }
 */
export async function submitPosOrder({
  locationId,
  orderType = 'dine_in',
  tableNumber,
  registerSessionId,
  items,
  notes,
}) {
  const body = {
    location_id: locationId,
    order_type: orderType,
    register_session_id: registerSessionId,
    items,
  };
  if (tableNumber) body.table_number = tableNumber;
  if (notes) body.notes = notes;

  const { data, error } = await api.request('POST', '/pos/orders', { body });
  if (error) {
    const e = new Error(error.message || 'Failed to place order');
    e.status = error.status;
    throw e;
  }
  return data;
}

// ---- Adjustment endpoints (return / void) ----------------------------------

/**
 * Apply a return-style adjustment against an order. The backend exposes
 * separate endpoints per adjustment type (void / refund / comp / price-override).
 * Resolves the route from `reason` so callers don't have to think about it.
 *
 * Body sent matches the adjustments handler:
 *   { reason_code, applied_by_staff_id, approver_staff_id, approver_pin }
 */
export async function applyOrderAdjustment({
  orderId,
  reason,            // 'refund' | 'void' | 'comp' | 'manager_discount'
  appliedByStaffId,
  approverStaffId,
  approverPin,
  itemId,            // required for comp
}) {
  if (!orderId) throw new Error('orderId required');

  let endpoint;
  switch (reason) {
    case 'void':
      endpoint = `/orders/${encodeURIComponent(orderId)}/void`;
      break;
    case 'refund':
    case 'manager_discount':
      endpoint = `/orders/${encodeURIComponent(orderId)}/refund`;
      break;
    case 'comp':
      if (!itemId) throw new Error('itemId required for comp adjustment');
      endpoint = `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/comp`;
      break;
    default:
      // Fallback to refund — keeps the UI working if a new reason is added
      // before this switch is updated.
      endpoint = `/orders/${encodeURIComponent(orderId)}/refund`;
  }

  const body = {
    reason_code: reason,
    applied_by_staff_id: appliedByStaffId || '',
    approver_staff_id: approverStaffId || '',
    approver_pin: approverPin || '',
  };

  const { data, error } = await api.request('POST', endpoint, { body });
  if (error) {
    const e = new Error(error.message || 'Adjustment failed');
    e.status = error.status;
    throw e;
  }
  return data;
}
