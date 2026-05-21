// domains.js — service helpers for the Custom Domains management endpoints.
// Endpoints are documented in backend/internal/handlers/customdomains/handler.go.

import { api } from '@/lib/api-client';

/**
 * List all custom domains for a location.
 *
 * @param {string} locationId
 * @returns {Promise<{ data: Array<Domain>, error }>}
 */
export async function listDomains(locationId) {
  return api.request('GET', `/domains?location_id=${encodeURIComponent(locationId)}`);
}

/**
 * Add a custom domain to a location.
 *
 * @param {{ locationId: string, hostname: string }} params
 * @returns {Promise<{ data: Domain, error }>}
 */
export async function addDomain({ locationId, hostname }) {
  return api.request('POST', '/domains', {
    body: { location_id: locationId, hostname },
  });
}

/**
 * Soft-remove a custom domain.
 *
 * @param {string} id  The domain UUID.
 * @returns {Promise<{ data: null, error }>}
 */
export async function removeDomain(id) {
  return api.request('DELETE', `/domains/${encodeURIComponent(id)}`);
}

/**
 * Trigger DNS verification and cert issuance for a domain.
 * The backend probes DNS synchronously; call this after the merchant has
 * added the TXT and CNAME records.
 *
 * @param {string} id  The domain UUID.
 * @returns {Promise<{ data: Domain, error }>}
 */
export async function verifyDomain(id) {
  return api.request('POST', `/domains/${encodeURIComponent(id)}/verify`);
}

/**
 * @typedef {Object} Domain
 * @property {string}      id
 * @property {string}      location_id
 * @property {string}      hostname
 * @property {string}      status          — pending|verifying|verified|cert_issuing|live|failed
 * @property {string}      verification_token
 * @property {string|null} verified_at
 * @property {string|null} cert_issued_at
 * @property {string|null} removed_at
 * @property {string}      created_at
 */
