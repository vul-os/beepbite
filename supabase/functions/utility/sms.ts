/**
 * SMS wrapper utility that supports multiple SMS providers
 */

import { sendSms as sendSmsPortal } from './smsportal.ts';
import { sendSms as sendWinSms } from './winsms.ts';

export interface SmsMessage {
  phoneNumber: string;
  message: string;
}

export interface SmsResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

export type SmsProvider = 'smsportal' | 'winsms';

/**
 * Get environment variable from either Node.js or Deno environment
 */
function getEnvVar(name: string): string | undefined {
  // Try Node.js environment first
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name];
  }
  
  // Try Deno environment
  try {
    return (globalThis as any).Deno?.env?.get(name);
  } catch {
    return undefined;
  }
}

/**
 * Send an SMS message using the specified SMS provider
 * 
 * For SMS Portal: requires SMS_PORTAL_API_KEY and SMS_PORTAL_API_SECRET
 * For WinSMS: requires WINSMS_USER and WINSMS_PASSWORD
 * 
 * @param smsMessage - Phone number and message content
 * @param provider - SMS provider to use ('smsportal' or 'winsms')
 * @returns Promise<SmsResult> - Result indicating success/failure
 */
export async function sendSms(smsMessage: SmsMessage, provider: SmsProvider): Promise<SmsResult> {
  console.log(`Sending SMS via ${provider} provider`);
  
  try {
    switch (provider) {
      case 'winsms':
        return await sendWinSms(smsMessage);
      
      case 'smsportal':
        return await sendSmsPortal(smsMessage);
      
      default:
        return {
          success: false,
          error: `Unknown SMS provider: ${provider}. Supported providers: smsportal, winsms`
        };
    }
  } catch (error) {
    const errorMessage = `SMS provider ${provider} error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Check which SMS providers are configured and available
 * @returns Object with provider availability status
 */
export function getAvailableProviders(): { [key in SmsProvider]: boolean } {
  return {
    smsportal: !!(getEnvVar('SMS_PORTAL_API_KEY') && getEnvVar('SMS_PORTAL_API_SECRET')),
    winsms: !!(getEnvVar('WINSMS_USER') && getEnvVar('WINSMS_PASSWORD'))
  };
}
