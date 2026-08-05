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

export interface Printer {
  id: string;
  location_id: string;
  name: string;
  kind: 'receipt' | 'kitchen';
  connection: 'network' | 'usb';
  host?: string;
  port?: number;
  station_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreatePrinterPayload {
  location_id: string;
  name: string;
  kind: string;
  connection: string;
  host?: string;
  port?: number;
  station_id?: string;
  is_active?: boolean;
}

export type UpdatePrinterChanges = Partial<{
  name: string;
  kind: string;
  connection: string;
  host: string;
  port: number;
  station_id: string;
  is_active: boolean;
}>;

export interface PrintResult {
  printer_id: string;
  sent: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Printer CRUD
// ---------------------------------------------------------------------------

/**
 * Fetch all printers for a location.
 */
export async function fetchPrinters(locationId: string): Promise<Printer[]> {
  const { data, error } = await api.request<Printer[]>(
    'GET',
    `/hardware/printers?location_id=${encodeURIComponent(locationId)}`,
  );
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Get a single printer by id.
 */
export async function getPrinter(id: string) {
  const { data, error } = await api.request<Printer>('GET', `/hardware/printers/${id}`);
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Create a new printer.
 */
export async function createPrinter(payload: CreatePrinterPayload) {
  const { data, error } = await api.request<Printer>('POST', '/hardware/printers', { body: payload });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Update a printer (partial — only provided fields are changed).
 */
export async function updatePrinter(id: string, changes: UpdatePrinterChanges) {
  const { data, error } = await api.request<Printer>('PUT', `/hardware/printers/${id}`, { body: changes });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Delete a printer by id.
 */
export async function deletePrinter(id: string) {
  const { error } = await api.request('DELETE', `/hardware/printers/${id}`);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Test print
// ---------------------------------------------------------------------------

/**
 * Send a test ticket to a printer.
 * Returns { printer_id, sent, error? }.
 */
export async function testPrinter(id: string) {
  const { data, error } = await api.request<PrintResult>('POST', `/hardware/printers/${id}/test`);
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------------------
// Print jobs
// ---------------------------------------------------------------------------

/**
 * Send a receipt print job for an order.
 * Returns an array of per-printer results: [{ printer_id, sent, error? }].
 */
export async function printReceipt({ orderId, locationId, printerId }: {
  orderId: string;
  locationId: string;
  printerId?: string;
}) {
  const body: { order_id: string; location_id: string; printer_id?: string } = { order_id: orderId, location_id: locationId };
  if (printerId) body.printer_id = printerId;
  const { data, error } = await api.request<PrintResult[]>('POST', '/hardware/print/receipt', { body });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Send a kitchen print job for an order.
 * Returns an array of per-printer results.
 */
export async function printKitchen({ orderId, locationId, stationId }: {
  orderId: string;
  locationId: string;
  stationId?: string;
}) {
  const body: { order_id: string; location_id: string; station_id?: string } = { order_id: orderId, location_id: locationId };
  if (stationId) body.station_id = stationId;
  const { data, error } = await api.request<PrintResult[]>('POST', '/hardware/print/kitchen', { body });
  if (error) throw new Error(error.message);
  return data ?? [];
}
