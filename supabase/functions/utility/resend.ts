/**
 * Resend API utility function for sending emails with BeepBite.io theme
 */

export interface EmailMessage {
  email: string;
  subject: string;
  message: string;
}

export interface EmailResult {
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
 * Generate HTML email template with BeepBite.io theme - optimized for deliverability
 */
function generateEmailTemplate(message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BeepBite.io</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">
        
        <!-- Header -->
        <div style="background-color: #F97316; padding: 30px 25px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: normal;">BeepBite.io</h1>
            <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Restaurant Communication</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 30px 25px;">
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333;">Hi there,</p>
            
            <div style="font-size: 15px; color: #555; line-height: 1.6; margin-bottom: 25px;">
                ${message.replace(/\n/g, '<br>')}
            </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f8f8f8; padding: 20px 25px; border-top: 1px solid #e0e0e0; text-align: center;">
            <p style="margin: 0; font-size: 13px; color: #888;">
                <strong style="color: #F97316;">BeepBite.io</strong><br>
                This email was sent regarding your restaurant communication.
            </p>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #aaa;">
                If you no longer wish to receive these emails, please contact your restaurant directly.
            </p>
        </div>
        
    </div>
    
    <!-- Spacer for email clients -->
    <div style="height: 20px;"></div>
</body>
</html>`;
}

/**
 * Generate plain text version of email for better deliverability
 */
function generatePlainTextTemplate(message: string): string {
  return `BeepBite.io - Restaurant Communication

Hi there,

${message}

---
BeepBite.io
This email was sent regarding your restaurant communication.
If you no longer wish to receive these emails, please contact your restaurant directly.`;
}

/**
 * Send a consent email with proper HTML formatting
 * @param email - Recipient email
 * @param subject - Email subject
 * @param consentUrl - WhatsApp consent URL
 * @param bistroName - Restaurant name
 * @returns Promise<EmailResult> - Result indicating success/failure
 */
export async function sendConsentEmail(email: string, subject: string, consentUrl: string, bistroName: string): Promise<EmailResult> {
  const apiKey = getEnvVar('RESEND_API_KEY');
  
  if (!apiKey) {
    return {
      success: false,
      error: 'Resend API key not found in environment variables'
    };
  }

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Notification Setup</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">
        
        <!-- Header -->
        <div style="background-color: #F97316; padding: 25px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: normal;">Order Notification Setup</h1>
            <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Service Configuration Required</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 30px 25px;">
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333;">Hello,</p>
            
            <p style="margin: 0 0 20px 0; font-size: 15px; color: #555;">
                ${bistroName} has requested to send you order status notifications via WhatsApp for faster service.
            </p>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #F97316;">
                <h3 style="margin: 0 0 10px 0; color: #F97316; font-size: 16px;">Action Required</h3>
                <p style="margin: 0; font-size: 14px; color: #555;">
                    To receive instant notifications when your order is ready, please enable WhatsApp notifications by clicking the button below.
                </p>
            </div>
            
            <div style="text-align: center; margin: 25px 0;">
                <a href="${consentUrl}" style="background-color: #25D366; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 14px;">
                    Enable WhatsApp Notifications
                </a>
            </div>
            
            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
                <p style="margin: 0; font-size: 13px; color: #856404;">
                    <strong>Can't click the button?</strong> Copy and paste this link into your browser:<br>
                    <span style="word-break: break-all; font-family: monospace; font-size: 12px; color: #F97316;">${consentUrl}</span>
                </p>
            </div>
            
            <div style="margin: 25px 0; font-size: 14px; color: #666;">
                <p style="margin: 0 0 10px 0;"><strong>Benefits of WhatsApp notifications:</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                    <li>Instant alerts when your order is ready</li>
                    <li>Reduces waiting time at the restaurant</li>
                    <li>Ensures you get hot, fresh food</li>
                </ul>
            </div>
        </div>
        
        <!-- Footer -->
        <div style="background-color: #f8f8f8; padding: 20px 25px; border-top: 1px solid #e0e0e0;">
            <p style="margin: 0; font-size: 12px; color: #888; text-align: center;">
                This is a service notification from ${bistroName} via BeepBite.io<br>
                <span style="color: #aaa;">Order notification setup • Not promotional</span>
            </p>
        </div>
        
    </div>
</body>
</html>`;

  const textContent = `Order Notification Setup - ${bistroName}

Hello,

${bistroName} has requested to send you order status notifications via WhatsApp for faster service.

ACTION REQUIRED:
To receive instant notifications when your order is ready, please enable WhatsApp notifications by visiting this link:

${consentUrl}

Benefits of WhatsApp notifications:
• Instant alerts when your order is ready
• Reduces waiting time at the restaurant  
• Ensures you get hot, fresh food

---
This is a service notification from ${bistroName} via BeepBite.io
Order notification setup • Not promotional`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'BeepBite.io <noreply@updates.beepbite.io>',
        to: [email],
        subject: subject,
        html: htmlContent,
        text: textContent,
        reply_to: 'coowner@example.com',
        headers: {
          'List-Unsubscribe': '<mailto:coowner@example.com?subject=Unsubscribe>',
          'X-Entity-Ref-ID': 'beepbite-restaurant-communication'
        }
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.message || `Resend API error: ${response.status}`;
      return {
        success: false,
        error: errorMessage
      };
    }

    const result = await response.json();
    
    console.log('Consent email sent successfully via Resend. Message ID:', result.id);
    return {
      success: true,
      messageId: result.id
    };

  } catch (error) {
    const errorMessage = `Resend network error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Send an email using Resend API
 * Expects RESEND_API_KEY to be set in environment variables
 * @param emailMessage - Email details including recipient, subject, and content
 * @returns Promise<EmailResult> - Result indicating success/failure
 */
export async function sendEmail(emailMessage: EmailMessage): Promise<EmailResult> {
  const { email, subject, message } = emailMessage;
  
  const apiKey = getEnvVar('RESEND_API_KEY');
  
  if (!apiKey) {
    return {
      success: false,
      error: 'Resend API key not found in environment variables'
    };
  }

  if (!email || !subject || !message) {
    return {
      success: false,
      error: 'Email, subject, and message are required'
    };
  }

  try {
    const htmlContent = generateEmailTemplate(message);
    const textContent = generatePlainTextTemplate(message);
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'BeepBite.io <noreply@updates.beepbite.io>',
        to: [email],
        subject: subject,
        html: htmlContent,
        text: textContent,
        reply_to: 'coowner@example.com',
        headers: {
          'List-Unsubscribe': '<mailto:coowner@example.com?subject=Unsubscribe>',
          'X-Entity-Ref-ID': 'beepbite-restaurant-communication'
        }
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const errorMessage = errorData?.message || `Resend API error: ${response.status}`;
      return {
        success: false,
        error: errorMessage
      };
    }

    const result = await response.json();
    
    console.log('Email sent successfully via Resend. Message ID:', result.id);
    return {
      success: true,
      messageId: result.id
    };

  } catch (error) {
    const errorMessage = `Resend network error: ${error}`;
    console.error(errorMessage);
    return { success: false, error: errorMessage };
  }
} 