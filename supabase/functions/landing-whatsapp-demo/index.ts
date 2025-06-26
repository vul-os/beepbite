import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface RecaptchaVerifyResponse {
  success: boolean
  score: number
  action: string
  challenge_ts: string
  hostname: string
  'error-codes'?: string[]
}

interface WhatsAppDemoRequest {
  recaptcha_token: string
  action: string
  cell_number: string
}

interface WhatsAppAPIResponse {
  success: boolean
  message_id?: string
  error?: string
}

async function verifyRecaptcha(token: string, expectedAction: string): Promise<{
  success: boolean
  score: number
  error?: string
}> {
  const secretKey = Deno.env.get('RECAPTCHA_SECRET_KEY')
  
  if (!secretKey) {
    return { success: false, score: 0, error: 'reCAPTCHA secret key not configured' }
  }

  try {
    // reCAPTCHA v3 verification (current implementation)
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        secret: secretKey,
        response: token,
      }),
    })

    /* 
    // reCAPTCHA Enterprise alternative (if you want to switch):
    const projectId = 'beepbite-io'
    const apiKey = Deno.env.get('GOOGLE_CLOUD_API_KEY')
    
    const response = await fetch(`https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: {
          token: token,
          expectedAction: expectedAction,
          siteKey: 'your-enterprise-site-key'
        }
      })
    })
    */

    const result: RecaptchaVerifyResponse = await response.json()

    if (!result.success) {
      return { 
        success: false, 
        score: 0, 
        error: `reCAPTCHA verification failed: ${result['error-codes']?.join(', ') || 'Unknown error'}` 
      }
    }

    // Verify the action matches what we expect
    if (result.action !== expectedAction) {
      return { 
        success: false, 
        score: result.score, 
        error: `Action mismatch. Expected: ${expectedAction}, Got: ${result.action}` 
      }
    }

    return {
      success: true,
      score: result.score
    }

  } catch (error) {
    return { 
      success: false, 
      score: 0, 
      error: `reCAPTCHA verification error: ${error.message}` 
    }
  }
}

function validateCellNumber(cellNumber: string): { valid: boolean, error?: string } {
  // Remove all non-digit characters except +
  const cleaned = cellNumber.replace(/[^\d+]/g, '')
  
  // Check if it's empty after cleaning
  if (!cleaned) {
    return { valid: false, error: 'Cell number is required' }
  }
  
  // Check if it starts with + (international format)
  if (cleaned.startsWith('+')) {
    // International format: +1234567890 (minimum 10 digits after +)
    if (cleaned.length < 11) {
      return { valid: false, error: 'Invalid international cell number format' }
    }
  } else {
    // Domestic format: should be 10 digits
    if (cleaned.length !== 10) {
      return { valid: false, error: 'Domestic cell number must be 10 digits' }
    }
  }
  
  return { valid: true }
}

function formatCellNumber(cellNumber: string): string {
  // Remove all non-digit characters except +
  const cleaned = cellNumber.replace(/[^\d+]/g, '')
  
  // If it doesn't start with +, assume it's US and add +1
  if (!cleaned.startsWith('+')) {
    return `+1${cleaned}`
  }
  
  return cleaned
}

async function sendWhatsAppMessage(cellNumber: string, message: string): Promise<WhatsAppAPIResponse> {
  const whatsappToken = Deno.env.get('WHATSAPP_API_TOKEN')
  const whatsappPhoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const whatsappBaseUrl = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://graph.facebook.com/v18.0'
  
  console.log('WhatsApp Debug Info:', {
    hasToken: !!whatsappToken,
    hasPhoneNumberId: !!whatsappPhoneNumberId,
    phoneNumberId: whatsappPhoneNumberId ? whatsappPhoneNumberId.substring(0, 5) + '...' : 'missing',
    cellNumber,
    baseUrl: whatsappBaseUrl
  })
  
  if (!whatsappToken || !whatsappPhoneNumberId) {
    console.error('WhatsApp credentials missing:', {
      hasToken: !!whatsappToken,
      hasPhoneNumberId: !!whatsappPhoneNumberId
    })
    return { 
      success: false, 
      error: 'WhatsApp API credentials not configured' 
    }
  }

  try {
    // Use hello_world template (pre-approved and always works)
    const requestBody = {
      messaging_product: 'whatsapp',
      to: cellNumber,
      type: 'template',
      template: {
        name: 'hello_world',
        language: {
          code: 'en_US'
        }
      }
    }
    
    console.log('Sending WhatsApp template message:', {
      url: `${whatsappBaseUrl}/${whatsappPhoneNumberId}/messages`,
      to: cellNumber,
      template: 'hello_world',
      language: 'en_US'
    })

    const response = await fetch(
      `${whatsappBaseUrl}/${whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      }
    )

    const result = await response.json()
    
    console.log('WhatsApp Template Response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      result: result,
      messageId: result.messages?.[0]?.id,
      waId: result.contacts?.[0]?.wa_id
    })

    if (!response.ok) {
      console.error('WhatsApp template error details:', result)
      return {
        success: false,
        error: `WhatsApp template error: ${result.error?.message || result.error?.error_user_msg || 'Unknown error'}`
      }
    }

    // Template message success
    if (result.messages?.[0]?.id) {
      console.log('✅ Template message sent successfully! Message ID:', result.messages[0].id)
      console.log('📱 You should receive: "Hello World" message')
      console.log('🎯 Template messages have much higher delivery rates!')
    }

    return {
      success: true,
      message_id: result.messages?.[0]?.id
    }

  } catch (error) {
    console.error('WhatsApp template request failed:', error)
    return {
      success: false,
      error: `WhatsApp template request failed: ${error.message}`
    }
  }
}

function getScoreThreshold(action: string): number {
  // Fixed threshold of 0.7 for all actions
  return 0.7
}

function generateOrderNumber(): string {
  // Generate a random 6-digit order number
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function createBeepbiteMessage(orderNumber: string): string {
  return `🎉 BeepBite DEMO - Your Order is Ready! 🎉

📋 Demo Order #${orderNumber}
✅ Status: Ready for pickup/delivery

🔥 DEMO MESSAGE 🔥
🍔 Thank you for trying our BeepBite demo!
📱 This is a sample notification showing how you'll receive real-time updates about your food orders.

🚀 Experience seamless food ordering with WhatsApp notifications!

---
BeepBite Demo - Bite into the Future! 🚀🍕

⚠️ This is a demonstration message only`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 405,
        }
      )
    }

    const body: WhatsAppDemoRequest = await req.json()

    // Validate required fields - reCAPTCHA token optional for testing
    if (!body.action || !body.cell_number) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: action and cell_number (recaptcha_token bypassed for testing)' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    // Validate cell number
    const cellValidation = validateCellNumber(body.cell_number)
    if (!cellValidation.valid) {
      return new Response(
        JSON.stringify({ error: cellValidation.error }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    // Verify reCAPTCHA - COMMENTED OUT FOR TESTING
    /*
    const recaptchaResult = await verifyRecaptcha(body.recaptcha_token, body.action)
    
    if (!recaptchaResult.success) {
      console.error('reCAPTCHA verification failed:', recaptchaResult.error)
      return new Response(
        JSON.stringify({ 
          error: 'Security verification failed',
          details: recaptchaResult.error 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      )
    }

    // Check if score meets threshold
    const threshold = getScoreThreshold(body.action)
    
    if (recaptchaResult.score < threshold) {
      console.warn(`Low reCAPTCHA score: ${recaptchaResult.score} (threshold: ${threshold})`)
      
      return new Response(
        JSON.stringify({ 
          error: 'Security check failed',
          message: 'Your request appears to be automated. Please try again later.' 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      )
    }

    // Log successful verification (for monitoring)
    console.log(`reCAPTCHA verified successfully. Action: ${body.action}, Score: ${recaptchaResult.score}`)
    */

    // Skip reCAPTCHA for testing - using dummy score
    const recaptchaResult = { success: true, score: 0.9 }
    console.log('⚠️ reCAPTCHA check BYPASSED for testing')

    // Format cell number and generate order details
    const formattedCellNumber = formatCellNumber(body.cell_number)
    const orderNumber = generateOrderNumber()
    const demoMessage = createBeepbiteMessage(orderNumber)

    // Send WhatsApp message
    const whatsappResult = await sendWhatsAppMessage(formattedCellNumber, demoMessage)
    
    if (!whatsappResult.success) {
      console.error('WhatsApp message failed:', whatsappResult.error)
      return new Response(
        JSON.stringify({ 
          error: 'Failed to send WhatsApp message',
          details: whatsappResult.error 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'BeepBite demo message sent successfully',
        data: {
          cell_number: formattedCellNumber,
          order_number: orderNumber,
          message_id: whatsappResult.message_id,
          message_sent: demoMessage
        },
        security: {
          score: recaptchaResult.score,
          action: body.action,
          note: 'reCAPTCHA bypassed for testing'
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('API Error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
})
