/**
 * WinSMS API utility function for sending messages via WinSMS HTTP API
 */

export interface SmsMessage {
  phoneNumber: string;
  message: string;
}

export interface SmsResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

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
 * Send an SMS message using WinSMS HTTP API
 * Expects WINSMS_USER and WINSMS_PASSWORD to be set in environment variables
 * @param smsMessage - Phone number and message content
 * @returns Promise<SmsResult> - Result indicating success/failure
 */
export async function sendSms(smsMessage: SmsMessage): Promise<SmsResult> {
  const { phoneNumber, message } = smsMessage;
  
  const username = getEnvVar('WINSMS_USER');
  const password = getEnvVar('WINSMS_PASSWORD');
  
  if (!username || !password) {
    return {
      success: false,
      error: 'WinSMS credentials not found in environment variables'
    };
  }

  if (!phoneNumber || !message) {
    return {
      success: false,
      error: 'Phone number and message are required'
    };
  }

  // Format phone number - remove + prefix for WinSMS (e164 format without +)
  const formattedNumber = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;

  try {
    // Optional: First authenticate to verify credentials
    const authUrl = new URL('https://api.winsms.co.za/api/auth.asp');
    authUrl.searchParams.set('user', username);
    authUrl.searchParams.set('password', password);
    
    const authResponse = await fetch(authUrl.toString());
    
    if (!authResponse.ok) {
      return {
        success: false,
        error: `WinSMS authentication request failed: ${authResponse.status}`
      };
    }

    const authResult = await authResponse.text();
    
    // Check authentication result
    if (authResult.trim() !== 'Login=OK') {
      let errorMsg = 'WinSMS authentication failed';
      if (authResult.includes('FAIL')) {
        errorMsg = 'Invalid WinSMS credentials';
      } else if (authResult.includes('ACCOUNTLOCKED')) {
        errorMsg = 'WinSMS account is locked';
      }
      return {
        success: false,
        error: errorMsg
      };
    }

    // Send SMS using WinSMS batchmessage API
    const smsUrl = new URL('https://api.winsms.co.za/api/batchmessage.asp');
    smsUrl.searchParams.set('user', username);
    smsUrl.searchParams.set('password', password);
    smsUrl.searchParams.set('message', message);
    smsUrl.searchParams.set('numbers', formattedNumber); // Single number, but API expects semicolon-separated list
    
    const smsResponse = await fetch(smsUrl.toString());

    if (!smsResponse.ok) {
      return {
        success: false,
        error: `WinSMS request failed: ${smsResponse.status}`
      };
    }

    const smsResult = await smsResponse.text();

    // Parse response - format is "number=messageId&" or "number=ERROR&" or "FAIL&"
    if (smsResult.includes('FAIL&')) {
      return {
        success: false,
        error: 'WinSMS request failed - invalid credentials'
      };
    }

    if (smsResult.includes('Error=')) {
      // Extract error message
      const errorMatch = smsResult.match(/Error="([^"]+)"/);
      const errorMsg = errorMatch ? errorMatch[1] : 'Unknown error from WinSMS';
      return {
        success: false,
        error: `WinSMS error: ${errorMsg}`
      };
    }

    // Check for successful response format: "number=messageId&"
    const successMatch = smsResult.match(new RegExp(`${formattedNumber}=(\\d+)`));
    if (successMatch) {
      const messageId = successMatch[1];
      console.log('WinSMS sent successfully. Message ID:', messageId);
      return { 
        success: true, 
        messageId: messageId 
      };
    }

    // Check for specific error responses
    const errorMatch = smsResult.match(new RegExp(`${formattedNumber}=([A-Z\\s]+)`));
    if (errorMatch) {
      const errorCode = errorMatch[1].trim();
      let errorMsg = `WinSMS error: ${errorCode}`;
      
      switch (errorCode) {
        case 'INSUFFICIENT CREDITS':
          errorMsg = 'Insufficient WinSMS credits';
          break;
        case 'ACCOUNTLOCKED':
          errorMsg = 'WinSMS account is locked';
          break;
        case 'TOOLONG':
          errorMsg = 'Message too long (max 918 characters)';
          break;
        case 'BADDEST':
          errorMsg = 'Invalid phone number or number is blacklisted';
          break;
        case 'OPTEDOUT':
          errorMsg = 'Recipient has opted out';
          break;
        case 'WASPADNC':
          errorMsg = 'Number is on Do Not Contact list';
          break;
      }
      
      return {
        success: false,
        error: errorMsg
      };
    }

    // If we get here, the response format was unexpected
    console.error('Unexpected WinSMS response format:', smsResult);
    return {
      success: false,
      error: `Unexpected WinSMS response: ${smsResult}`
    };

  } catch (error) {
    const errorMessage = `WinSMS network error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
} 