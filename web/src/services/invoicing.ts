// invoicing.js — service layer for Wave 34 / Now-26: Invoicing
// Wraps the /invoicing/* backend endpoints.

import { api } from '@/lib/api-client';

export interface TaxProfile {
  org_id: string;
  legal_name: string;
  registered_address: string;
  country: string;
  vat_number: string | null;
  company_number: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  updated_at: string;
}

export interface InvoiceLine {
  description: string;
  qty: number;
  unit_cents: number;
  line_total_cents: number;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  issuer: 'platform' | 'tenant';
  issuer_org_id: string;
  // See backend/internal/handlers/invoicing/store.go Invoice struct —
  // both are `,omitempty` pointer fields (nil when the invoice was linked
  // via the other recipient kind, or platform-issued).
  recipient_org_id?: string | null;
  recipient_customer_id?: string | null;
  recipient_name: string;
  recipient_address: string;
  currency: string;
  subtotal_cents: number;
  vat_cents: number;
  vat_applied: boolean;
  vat_rate_percent: number;
  total_cents: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | 'void';
  issued_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInvoiceBody {
  issuer: 'platform' | 'tenant';
  // Required for tenant-issued invoices unless the other is set (see Go
  // CreateInvoiceReq — RecipientOrgID / RecipientCustomerID).
  recipient_org_id?: string;
  recipient_customer_id?: string;
  recipient_name: string;
  recipient_address: string;
  currency?: string;
  vat_rate_pct?: number;
  lines: Array<{ description: string; qty: number; unit_cents: number }>;
}

export interface UpdateInvoiceChanges {
  recipient_name?: string;
  recipient_address?: string;
  currency?: string;
  vat_rate_pct?: number;
  lines?: Array<{ description: string; qty: number; unit_cents: number }>;
}

// ── Tax profile ──────────────────────────────────────────────────────────────

/**
 * Fetch the org's tax profile.
 */
export async function getTaxProfile() {
  return api.request<TaxProfile>('GET', '/invoicing/tax-profile');
}

/**
 * Create or update the org's tax profile.
 */
export async function saveTaxProfile(profile: Partial<TaxProfile>) {
  return api.request<TaxProfile>('PUT', '/invoicing/tax-profile', { body: profile });
}

// ── Invoice list / get ───────────────────────────────────────────────────────

/**
 * List all invoices for the org, newest first.
 */
export async function listInvoices() {
  return api.request<Invoice[]>('GET', '/invoicing/invoices');
}

/**
 * Fetch a single invoice with its line items.
 */
export async function getInvoice(invoiceId: string) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request<Invoice & { lines: InvoiceLine[] }>('GET', `/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
}

// ── Create / update / delete ─────────────────────────────────────────────────

/**
 * Create a new draft invoice.
 */
export async function createInvoice(body: CreateInvoiceBody) {
  return api.request<Invoice & { lines: InvoiceLine[] }>('POST', '/invoicing/invoices', { body });
}

/**
 * Update a draft invoice (partial — only send fields you want to change).
 * Sending `lines` replaces all existing lines.
 */
export async function updateInvoice(invoiceId: string, changes: UpdateInvoiceChanges) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request<Invoice & { lines: InvoiceLine[] }>('PATCH', `/invoicing/invoices/${encodeURIComponent(invoiceId)}`, { body: changes });
}

/**
 * Delete a draft invoice.
 */
export async function deleteInvoice(invoiceId: string) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request('DELETE', `/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
}

// ── Status transitions ───────────────────────────────────────────────────────

/**
 * Transition a draft invoice to sent (canonical status: "sent").
 */
export async function issueInvoice(invoiceId: string) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request<Invoice>('POST', `/invoicing/invoices/${encodeURIComponent(invoiceId)}/issue`);
}

/**
 * Transition an issued invoice to paid.
 */
export async function markInvoicePaid(invoiceId: string) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request<Invoice>('POST', `/invoicing/invoices/${encodeURIComponent(invoiceId)}/pay`);
}

/**
 * Void a draft or issued invoice.
 */
export async function voidInvoice(invoiceId: string) {
  if (!invoiceId) return { data: null, error: { message: 'invoiceId required' } };
  return api.request<Invoice>('POST', `/invoicing/invoices/${encodeURIComponent(invoiceId)}/void`);
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
 */
export async function downloadInvoicePDF(invoiceId: string): Promise<void> {
  if (!invoiceId) return;

  // api.request parses JSON; for PDF we need the raw binary blob.
  // Use a direct fetch with the stored Bearer token.
  const STORAGE_KEY = 'bb.auth';
  let token: string | null = null;
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
