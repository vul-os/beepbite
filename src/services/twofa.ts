// twofa.js — service helpers for the TOTP two-factor authentication endpoints.
// All routes require a valid bearer token (JWT from auth flow).

import { api } from '@/lib/api-client';

export interface TOTPStatus {
  enabled: boolean;
  enrolled: boolean;
  backup_codes_remaining: number;
}

export interface TOTPEnrollment {
  otpauth_url: string;
  account_name: string;
}

export interface TOTPBackupCodes {
  backup_codes: string[];
}

export interface TOTPDisabled {
  status: 'disabled';
}

/**
 * Get the current TOTP status for the authenticated user.
 */
export async function getTOTPStatus() {
  return api.request<TOTPStatus>('GET', '/2fa/status');
}

/**
 * Start TOTP enrollment — generates a new TOTP secret and returns the
 * otpauth:// URL that can be rendered as a QR code.
 * The backend stores the encrypted secret as "pending" (not yet enabled).
 */
export async function enrollTOTP() {
  return api.request<TOTPEnrollment>('POST', '/2fa/enroll');
}

/**
 * Verify a TOTP code from the authenticator app, enabling 2FA.
 * Returns backup codes exactly once — the caller must show them to the user.
 *
 * @param code  6-digit TOTP code from the authenticator app.
 */
export async function verifyTOTP(code: string) {
  return api.request<TOTPBackupCodes>('POST', '/2fa/verify', { body: { code } });
}

/**
 * Disable TOTP. Requires either a valid TOTP code or a backup code.
 */
export async function disableTOTP({ code, backup_code }: { code?: string; backup_code?: string } = {}) {
  return api.request<TOTPDisabled>('POST', '/2fa/disable', { body: { code, backup_code } });
}
