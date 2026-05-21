// invoicing.js — service layer for Wave 34 / Now-26: Invoicing
// Wraps the /invoicing/* backend endpoints.

import { api } from '@/lib/api-client';

// ── Tax profile ──────────────────────────────────────────────────────────────

/**
 * Fetch the org's tax profile.
 * @returns {{ data: TaxProfile|null, error: object|null }}
 *
 * TaxProfile shape:
 * {
 *   org_id:             string,
 *   legal_name:         string,
 *   registered_address: string,
 *   country:            string,
 *   vat_number:         string|null,
 *   company_number:     string|null,
 *   contact_email:      string|null,
 *   contact_phone:      string|null,
 *   updated_at:         string,
 * }
 */
export async function getTaxProfile() {
  return api.request('GET', '/invoicing/tax-profile');
}

/**
 * Create or update the org's tax profile.
 * @param {Partial<TaxProfile>} profile
 * @returns {{ data: TaxProfile|null, error: object|null }}
 */
export async function saveTaxProfile(profile) {
  return api.request('PUT', '/invoicing/tax-profile', { body: profile });
}

// ── Invoice list / get ───────────────────────────────────────────────────────

/**
 * List all invoices for the org, newest first.
 * @returns {{ data: Invoice[], error: object|null }}
 *
 * Invoice shape (no lines):
 * {
 *   id:                string,  // UUID
 *   invoice_number:    string,  // human-readable display number
 *   issuer:            'platform'|'tenant',
 *   issuer_org_id:     string,
 *   recipient_name:    string,
 *   recipient_address: string,
 *   currency:          string,
 *   subtotal_cents:    number,
 *   vat_cents:         number,
 *   vat_applied:       boolean,
 *   vat_rate_percent:  number,
 *   total_cents:       number,
 *   status:            'draft'|'sent'|'paid'|'overdue'|'cancelled'|'void',
 *   issued_at:         string|null,
 *   created_at:        string,
 *   updated_at:        string,
 * }
 */
export async function listInvoices() {
  return api.request('GET', '/invoicing/invoices');
}

/**
 * Fetch a single invoice with its line items.
 * @param {string} invoiceId
 * @returns {{ data: Invoice & { lines: InvoiceLine[] }|null, error: object|null }}
 *
 * InvoiceLine shape (top-level inv.lines):
 * {
 *   description:     string,
 *   qty:             number,
 *   unit_cents:      number,
 *   line_total_cents:number,
 * }
 */
export async function getInvoice(invoiceId) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request('GET', `/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
}

// ── Create / update / delete ─────────────────────────────────────────────────

/**
 * Create a new draft invoice.
 * @param {{
 *   issuer:            'platform'|'tenant',
 *   recipient_name:    string,
 *   recipient_address: string,
 *   currency?:         string,
 *   vat_rate_pct?:     number,
 *   lines:             Array<{ description: string, qty: number, unit_cents: number }>,
 * }} body
 * @returns {{ data: Invoice & { lines: InvoiceLine[] }|null, error: object|null }}
 */
export async function createInvoice(body) {
  return api.request('POST', '/invoicing/invoices', { body });
}

/**
 * Update a draft invoice (partial — only send fields you want to change).
 * Sending `lines` replaces all existing lines.
 * @param {string} invoiceId
 * @param {{
 *   recipient_name?:    string,
 *   recipient_address?: string,
 *   currency?:          string,
 *   vat_rate_pct?:      number,
 *   lines?:             Array<{ description: string, qty: number, unit_cents: number }>,
 * }} changes
 * @returns {{ data: Invoice & { lines: InvoiceLine[] }|null, error: object|null }}
 */
export async function updateInvoice(invoiceId, changes) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request('PATCH', `/invoicing/invoices/${encodeURIComponent(invoiceId)}`, { body: changes });
}

/**
 * Delete a draft invoice.
 * @param {string} invoiceId
 * @returns {{ data: null, error: object|null }}
 */
export async function deleteInvoice(invoiceId) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request('DELETE', `/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
}

// ── Status transitions ───────────────────────────────────────────────────────

/**
 * Transition a draft invoice to sent (canonical status: "sent").
 * @param {string} invoiceId
 * @returns {{ data: Invoice|null, error: object|null }}
 */
export async function issueInvoice(invoiceId) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request('POST', `/invoicing/invoices/${encodeURIComponent(invoiceId)}/issue`);
}

/**
 * Transition an issued invoice to paid.
 * @param {string} invoiceId
 * @returns {{ data: Invoice|null, error: object|null }}
 */
export async function markInvoicePaid(invoiceId) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request('POST', `/invoicing/invoices/${encodeURIComponent(invoiceId)}/pay`);
}

/**
 * Void a draft or issued invoice.
 * @param {string} invoiceId
 * @returns {{ data: Invoice|null, error: object|null }}
 */
export async function voidInvoice(invoiceId) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request('POST', `/invoicing/invoices/${encodeURIComponent(invoiceId)}/void`);
}

// ── PDF download ─────────────────────────────────────────────────────────────

/**
 * Open (or download) the PDF for an invoice in a new browser tab.
 * The PDF endpoint returns Content-Disposition: attachment, so the browser
 * will prompt a save dialog. We use a direct window.open so the auth header
 * is not sent — instead we pass the access token as a query param since
 * the browser cannot set Authorization on a raw navigation.
 *
 * NOTE: the backend must accept ?token=<jwt> on this endpoint OR the caller
 * can fetch as blob and create an object URL. This implementation does the
 * blob approach so the Bearer token is always sent.
 *
 * @param {string} invoiceId
 * @returns {Promise<void>}
 */
export async function downloadInvoicePDF(invoiceId) {
  if (!invoiceId) return;

  // api.request parses JSON; for PDF we need the raw binary blob.
  // Use a direct fetch with the stored Bearer token.
  const STORAGE_KEY = 'bb.auth';
  let token = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) token = JSON.parse(raw)?.access_token;
  } catch {
    /* ignore */
  }

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
  const fetchRes = await fetch(
    `${API_URL}/invoicing/invoices/${encodeURIComponent(invoiceId)}.pdf`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    },
  );

  if (!fetchRes.ok) {
    throw new Error(`PDF download failed: ${fetchRes.status}`);
  }

  const blob = await fetchRes.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `invoice-${invoiceId.slice(0, 8)}.pdf`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 1000);
}
