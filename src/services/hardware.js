// hardware.js — service layer for location_printers (Wave 29 / Now-19).
//
// All requests go to the /hardware prefix on the Go backend, which implements
// printer CRUD and ESC/POS print-job dispatching.
//
// Printer shape:
//   { id, location_id, name, kind, connection, host?, port, station_id?, is_active,
//     created_at, updated_at }
//
// kind:       'receipt' | 'kitchen'
// connection: 'network' | 'usb'

import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Printer CRUD
// ---------------------------------------------------------------------------

/**
 * Fetch all printers for a location.
 * @param {string} locationId
 * @returns {Promise<object[]>}
 */
export async function fetchPrinters(locationId) {
  const { data, error } = await api.request(
    'GET',
    `/hardware/printers?location_id=${encodeURIComponent(locationId)}`,
  );
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Get a single printer by id.
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function getPrinter(id) {
  const { data, error } = await api.request('GET', `/hardware/printers/${id}`);
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Create a new printer.
 * @param {{ location_id: string, name: string, kind: string, connection: string,
 *           host?: string, port?: number, station_id?: string, is_active?: boolean }} payload
 * @returns {Promise<object>}
 */
export async function createPrinter(payload) {
  const { data, error } = await api.request('POST', '/hardware/printers', { body: payload });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Update a printer (partial — only provided fields are changed).
 * @param {string} id
 * @param {Partial<{ name, kind, connection, host, port, station_id, is_active }>} changes
 * @returns {Promise<object>}
 */
export async function updatePrinter(id, changes) {
  const { data, error } = await api.request('PUT', `/hardware/printers/${id}`, { body: changes });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Delete a printer by id.
 * @param {string} id
 */
export async function deletePrinter(id) {
  const { error } = await api.request('DELETE', `/hardware/printers/${id}`);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Test print
// ---------------------------------------------------------------------------

/**
 * Send a test ticket to a printer.
 * Returns { printer_id, sent, error? }.
 * @param {string} id
 * @returns {Promise<{ printer_id: string, sent: boolean, error?: string }>}
 */
export async function testPrinter(id) {
  const { data, error } = await api.request('POST', `/hardware/printers/${id}/test`);
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------------
// Print jobs
// ---------------------------------------------------------------------------

/**
 * Send a receipt print job for an order.
 * Returns an array of per-printer results: [{ printer_id, sent, error? }].
 *
 * @param {{ order_id: string, location_id: string, printer_id?: string }} params
 * @returns {Promise<Array<{ printer_id: string, sent: boolean, error?: string }>>}
 */
export async function printReceipt({ orderId, locationId, printerId }) {
  const body = { order_id: orderId, location_id: locationId };
  if (printerId) body.printer_id = printerId;
  const { data, error } = await api.request('POST', '/hardware/print/receipt', { body });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Send a kitchen print job for an order.
 * Returns an array of per-printer results.
 *
 * @param {{ order_id: string, location_id: string, station_id?: string }} params
 * @returns {Promise<Array<{ printer_id: string, sent: boolean, error?: string }>>}
 */
export async function printKitchen({ orderId, locationId, stationId }) {
  const body = { order_id: orderId, location_id: locationId };
  if (stationId) body.station_id = stationId;
  const { data, error } = await api.request('POST', '/hardware/print/kitchen', { body });
  if (error) throw new Error(error.message);
  return data ?? [];
}
