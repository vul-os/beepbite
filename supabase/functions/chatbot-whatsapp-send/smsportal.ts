/**
 * SMS Portal API utility function for sending messages via SMS Portal API
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
 * Send an SMS message using SMS Portal API
 * Expects SMS_PORTAL_API_KEY and SMS_PORTAL_API_SECRET to be set in environment variables
 * @param smsMessage - Phone number and message content
 * @returns Promise<SmsResult> - Result indicating success/failure
 */
export async function sendSms(smsMessage: SmsMessage): Promise<SmsResult> {
  const { phoneNumber, message } = smsMessage;
  
  const apiKey = getEnvVar('SMS_PORTAL_API_KEY');
  const apiSecret = getEnvVar('SMS_PORTAL_API_SECRET');
  
  if (!apiKey || !apiSecret) {
    return {
      success: false,
      error: 'SMS Portal credentials not found in environment variables'
    };
  }

  if (!phoneNumber || !message) {
    return {
      success: false,
      error: 'Phone number and message are required'
    };
  }

  // Encode credentials for basic auth
  const credentials = btoa(`${apiKey}:${apiSecret}`);
  
  // Add + prefix if not present (numbers in DB don't have + sign)
  const formattedNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
  
  const requestBody = {
    messages: [
      {
        content: message,
        destination: formattedNumber
      }
    ]
  };

  try {
    const response = await fetch('https://rest.smsportal.com/bulkmessages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`
      },
      body: JSON.stringify(requestBody)
    });

    const responseBody = await response.text();

    if (response.status === 200) {
      console.log('SMS Portal sent successfully:', responseBody);
      
      // Try to extract message ID from response if available
      let messageId: string | undefined;
      try {
        const responseJson = JSON.parse(responseBody);
        // SMS Portal might return message IDs in different formats, adjust as needed
        if (responseJson.messageId) {
          messageId = responseJson.messageId;
        } else if (responseJson.messages && responseJson.messages[0]?.id) {
          messageId = responseJson.messages[0].id;
        }
      } catch {
        // Response might not be JSON, that's okay
      }
      
      return { success: true, messageId };
    } else {
      const error = `SMS Portal sending failed: ${response.status} ${responseBody}`;
      console.error(error);
      return { success: false, error };
    }
  } catch (error) {
    const errorMessage = `SMS Portal network error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
} 