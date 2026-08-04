// domains.js — service helpers for the Custom Domains management endpoints.
// Endpoints are documented in backend/internal/handlers/customdomains/handler.go.

import { api } from '@/lib/api-client';

export interface Domain {
  id: string;
  location_id: string;
  hostname: string;
  /** pending|verifying|verified|cert_issuing|live|failed */
  status: string;
  verification_token: string;
  verified_at: string | null;
  cert_issued_at: string | null;
  removed_at: string | null;
  created_at: string;
}

/**
 * List all custom domains for a location.
 */
export async function listDomains(locationId: string) {
  return api.request<Domain[]>('GET', `/domains?location_id=${encodeURIComponent(locationId)}`);
}

/**
 * Add a custom domain to a location.
 */
export async function addDomain({ locationId, hostname }: { locationId: string; hostname: string }) {
  return api.request<Domain>('POST', '/domains', {
    body: { location_id: locationId, hostname },
  });
}

/**
 * Soft-remove a custom domain.
 *
 * @param id  The domain UUID.
 */
export async function removeDomain(id: string) {
  return api.request('DELETE', `/domains/${encodeURIComponent(id)}`);
}

/**
 * Trigger DNS verification and cert issuance for a domain.
 * The backend probes DNS synchronously; call this after the merchant has
 * added the TXT and CNAME records.
 *
 * @param id  The domain UUID.
 */
export async function verifyDomain(id: string) {
  return api.request<Domain>('POST', `/domains/${encodeURIComponent(id)}/verify`);
}
