import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendEmail, sendConsentEmail as sendConsentEmailResend } from "./resend.ts"

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

// Always use this bot ID for all sending
const SYSTEM_BOT_ID = '46c4426a-9f5d-43d1-914c-d112deaf1d06'

export interface SmartMessageRequest {
  whatsapp_number: string
  message: string
  subject?: string // For email
  location_name?: string
  order_number?: string
  order_id?: string
  customer_id?: string
}

export interface SmartMessageResult {
  success: boolean
  method: 'whatsapp' | 'email' | 'consent_email' | 'none'
  error?: string
  details?: {
    customer_id?: string
    email_sent?: boolean
    whatsapp_sent?: boolean
    has_recent_activity?: boolean
    has_chats?: boolean
    customer_email?: string
  }
}

async function sendWhatsAppMessage(to: string, message: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const whatsappToken = Deno.env.get('WHATSAPP_API_TOKEN')
  const whatsappBaseUrl = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://graph.facebook.com/v18.0'
  
  if (!whatsappToken) {
    console.error('WhatsApp token not configured')
    return { success: false, error: 'WhatsApp token not configured' }
  }

  // Get bot phone number ID
  const { data: bot, error: botError } = await supabase
    .from('bots')
    .select('whatsapp_phone_number_id')
    .eq('id', SYSTEM_BOT_ID)
    .single()

  if (botError || !bot) {
    console.error('Bot not found:', botError)
    return { success: false, error: 'System bot not configured' }
  }

  const phoneNumberId = bot.whatsapp_phone_number_id

  try {
    const response = await fetch(`${whatsappBaseUrl}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
          body: message
        }
      }),
    })

    const result = await response.json()
    
    if (!response.ok) {
      console.error('WhatsApp message error:', result)
      return { 
        success: false, 
        error: result.error?.message || 'WhatsApp API error' 
      }
    }

    return { 
      success: true, 
      messageId: result.messages?.[0]?.id 
    }
  } catch (error) {
    console.error('WhatsApp send error:', error)
    return { 
      success: false, 
      error: error.message 
    }
  }
}

async function getOrCreateCustomer(whatsappNumber: string) {
  // Check if customer exists
  const { data: existingCustomer, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('Error fetching customer:', fetchError)
    return null
  }

  if (existingCustomer) {
    // Update last seen
    await supabase
      .from('customers')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', existingCustomer.id)
    
    return existingCustomer
  }

  // Create new customer
  const { data: newCustomer, error: createError } = await supabase
    .from('customers')
    .insert({
      whatsapp_number: whatsappNumber,
      last_seen_at: new Date().toISOString()
    })
    .select()
    .single()

  if (createError) {
    console.error('Error creating customer:', createError)
    return null
  }

  return newCustomer
}

async function checkCustomerHasChats(customerId: string): Promise<boolean> {
  const { data: chats, error } = await supabase
    .from('chats')
    .select('id')
    .eq('customer_id', customerId)
    .limit(1)

  if (error) {
    console.error('Error checking customer chats:', error)
    return false
  }

  return chats && chats.length > 0
}

async function checkRecentChatActivity(customerId: string): Promise<boolean> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  
  const { data: recentMessages, error } = await supabase
    .from('messages')
    .select(`
      id,
      chats!inner(
        customer_id
      )
    `)
    .eq('chats.customer_id', customerId)
    .gte('created_at', twentyFourHoursAgo)
    .limit(1)

  if (error) {
    console.error('Error checking recent chat activity:', error)
    return false
  }

  return recentMessages && recentMessages.length > 0
}

async function sendConsentEmail(email: string, locationName: string, orderId: string): Promise<boolean> {
  // Create wa.me link with pre-filled consent message including order ID
  const consentUrl = `https://wa.me/27731136480?text=CONSENT-${orderId}`
  
  try {
    const result = await sendConsentEmailResend(
      email,
      `Order Notification Setup - ${locationName}`,
      consentUrl,
      locationName
    )
    
    if (result.success) {
      console.log('Consent email sent successfully to:', email)
      return true
    } else {
      console.error('Failed to send consent email:', result.error)
      return false
    }
  } catch (error) {
    console.error('Error sending consent email:', error)
    return false
  }
}

function cleanMessageForFallback(message: string): string {
  return message
    .replace(/\*/g, '') // Remove WhatsApp formatting
    .replace(/📱 \*Powered by BeepBite\* 🚀/g, '') // Remove WhatsApp-specific footer
    .replace(/📱 \*Powered by BeepBite\.io\* 🚀/g, '') // Remove alternative footer
    .trim()
}

/**
 * Smart message sending that respects WhatsApp's 24-hour rule
 * Falls back to email as needed
 */
export async function sendSmartMessage(request: SmartMessageRequest): Promise<SmartMessageResult> {
  console.log('=== SMART MESSAGE ROUTING ===')
  console.log('Request:', JSON.stringify(request, null, 2))

  const { whatsapp_number, message, subject, location_name, order_number, order_id } = request

  // Get or create customer
  const customer = await getOrCreateCustomer(whatsapp_number)
  if (!customer) {
    return {
      success: false,
      method: 'none',
      error: 'Failed to create/find customer'
    }
  }

  // Check if customer has any chats
  const hasChats = await checkCustomerHasChats(customer.id)
  console.log(`Customer ${customer.id} has chats: ${hasChats}`)

  // If no chats, send consent email
  if (!hasChats && location_name && order_id) {
    console.log('=== NO CHATS - SENDING CONSENT EMAIL ===')
    
    // Try consent email if available
    if (customer.email) {
      console.log(`Customer has email: ${customer.email}, sending consent email`)
      
      const emailSent = await sendConsentEmail(customer.email, location_name, order_id)
      
      if (emailSent) {
        return {
          success: true,
          method: 'consent_email',
          details: {
            customer_id: customer.id,
            email_sent: true,
            customer_email: customer.email,
            has_chats: false
          }
        }
      } else {
        console.error('Consent email failed for new customer')
        return {
          success: false,
          method: 'none',
          error: 'Consent email failed and no other fallback available',
          details: {
            customer_id: customer.id,
            has_chats: false
          }
        }
      }
    } else {
      console.log('No email available for new customer - cannot send consent')
      return {
        success: false,
        method: 'none',
        error: 'No email available for new customer consent',
        details: {
          customer_id: customer.id,
          has_chats: false
        }
      }
    }
  }

  // Check if we can send WhatsApp (24-hour window rule)
  const hasRecentActivity = await checkRecentChatActivity(customer.id)
  console.log(`Customer has recent chat activity (24h): ${hasRecentActivity}`)

  if (hasRecentActivity) {
    // Can send WhatsApp
    console.log('=== SENDING WHATSAPP MESSAGE ===')
    
    const whatsappResult = await sendWhatsAppMessage(whatsapp_number, message)
    
    if (whatsappResult.success) {
      return {
        success: true,
        method: 'whatsapp',
        details: {
          customer_id: customer.id,
          whatsapp_sent: true,
          has_recent_activity: true,
          has_chats: hasChats
        }
      }
    } else {
      console.error('WhatsApp failed, falling back:', whatsappResult.error)
      // Fall through to email fallback
    }
  }

  // WhatsApp not available - try email
  console.log('=== WHATSAPP NOT AVAILABLE - CHECKING EMAIL FALLBACK ===')
  
  if (customer.email) {
    console.log(`Customer has email: ${customer.email}, sending email`)
    
    const emailSubject = subject || (order_number ? `Order Update from ${location_name || 'Restaurant'}` : 'Notification')
    const cleanMessage = cleanMessageForFallback(message)
    
    const emailResult = await sendEmail({
      email: customer.email,
      subject: emailSubject,
      message: cleanMessage
    })
    
    if (emailResult.success) {
      return {
        success: true,
        method: 'email',
        details: {
          customer_id: customer.id,
          email_sent: true,
          customer_email: customer.email,
          has_recent_activity: hasRecentActivity,
          has_chats: hasChats
        }
      }
    } else {
      console.error('Email failed:', emailResult.error)
    }
  }

  // No communication method available
  console.log('=== NO COMMUNICATION METHOD AVAILABLE ===')
  
  return {
    success: false,
    method: 'none',
    error: 'All communication methods failed or unavailable',
    details: {
      customer_id: customer.id,
      has_recent_activity: hasRecentActivity,
      has_chats: hasChats,
      customer_email: customer.email
    }
  }
}

/**
 * Check if WhatsApp can be used for a customer (within 24-hour window)
 */
export async function canUseWhatsApp(whatsappNumber: string): Promise<{
  canUse: boolean
  hasChats: boolean
  hasRecentActivity: boolean
  customer?: any
}> {
  const customer = await getOrCreateCustomer(whatsappNumber)
  if (!customer) {
    return { canUse: false, hasChats: false, hasRecentActivity: false }
  }

  const hasChats = await checkCustomerHasChats(customer.id)
  const hasRecentActivity = await checkRecentChatActivity(customer.id)

  return {
    canUse: hasChats && hasRecentActivity,
    hasChats,
    hasRecentActivity,
    customer
  }
} 