// twofa.js — service helpers for the TOTP two-factor authentication endpoints.
// All routes require a valid bearer token (JWT from auth flow).

import { api } from '@/lib/api-client';

/**
 * Get the current TOTP status for the authenticated user.
 *
 * @returns {Promise<{ data: { enabled: boolean, enrolled: boolean, backup_codes_remaining: number }, error }>}
 */
export async function getTOTPStatus() {
  return api.request('GET', '/2fa/status');
}

/**
 * Start TOTP enrollment — generates a new TOTP secret and returns the
 * otpauth:// URL that can be rendered as a QR code.
 * The backend stores the encrypted secret as "pending" (not yet enabled).
 *
 * @returns {Promise<{ data: { otpauth_url: string, account_name: string }, error }>}
 */
export async function enrollTOTP() {
  return api.request('POST', '/2fa/enroll');
}

/**
 * Verify a TOTP code from the authenticator app, enabling 2FA.
 * Returns backup codes exactly once — the caller must show them to the user.
 *
 * @param {string} code  6-digit TOTP code from the authenticator app.
 * @returns {Promise<{ data: { backup_codes: string[] }, error }>}
 */
export async function verifyTOTP(code) {
  return api.request('POST', '/2fa/verify', { body: { code } });
}

/**
 * Disable TOTP. Requires either a valid TOTP code or a backup code.
 *
 * @param {{ code?: string, backup_code?: string }} params
 * @returns {Promise<{ data: { status: 'disabled' }, error }>}
 */
export async function disableTOTP({ code, backup_code } = {}) {
  return api.request('POST', '/2fa/disable', { body: { code, backup_code } });
}
