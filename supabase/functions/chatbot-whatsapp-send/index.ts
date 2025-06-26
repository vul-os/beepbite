import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendSms } from "./sms.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Always use this bot ID for all sending
const SYSTEM_BOT_ID = '46c4426a-9f5d-43d1-914c-d112deaf1d06'

interface SendMessageRequest {
  bite_id: string
  order_status?: 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled'
  message?: string
  whatsapp_number?: string
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

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

  const hasChats = chats && chats.length > 0
  console.log(`Customer ${customerId} has chats: ${hasChats}`)
  
  return hasChats
}

async function getOrCreateChat(customerId: string) {
  // Check if active chat exists for this customer with our bot
  const { data: existingChat, error: fetchError } = await supabase
    .from('chats')
    .select('*')
    .eq('bot_id', SYSTEM_BOT_ID)
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .single()

  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('Error fetching chat:', fetchError)
    return null
  }

  if (existingChat) {
    return existingChat
  }

  // Create new chat
  const { data: newChat, error: createError } = await supabase
    .from('chats')
    .insert({
      bot_id: SYSTEM_BOT_ID,
      customer_id: customerId,
      status: 'active',
      conversation_state: { step: 'welcome' },
      bot_active: true,
      last_message_at: new Date().toISOString()
    })
    .select()
    .single()

  if (createError) {
    console.error('Error creating chat:', createError)
    return null
  }

  return newChat
}

async function saveMessage(chatId: string, direction: 'outbound', content: string, messageId?: string) {
  await supabase
    .from('messages')
    .insert({
      chat_id: chatId,
      whatsapp_message_id: messageId || '',
      direction: direction,
      message_type: 'text',
      content: content,
      status: 'sent'
    })
}

async function getBiteDetails(biteId: string) {
  const { data: bite, error } = await supabase
    .from('bites')
    .select(`
      *,
      bistros(name),
      customers(whatsapp_number)
    `)
    .eq('id', biteId)
    .single()

  if (error) {
    console.error('Error fetching bite details:', error)
    return null
  }

  return bite
}

function formatStatusMessage(bistroName: string, orderNumber: string, status: string): string {
  switch (status) {
    case 'pending':
      return `⏳ *Order Update*\n\n📋 Order #${orderNumber}\n🏪 ${bistroName}\n\n✅ Your order has been received and is being prepared!\n\n📱 *Powered by BeepBite* 🚀`
    case 'preparing':
      return `👨‍🍳 *Order Update*\n\n📋 Order #${orderNumber}\n🏪 ${bistroName}\n\n🔥 Your order is now being prepared! We'll notify you when it's ready.\n\n📱 *Powered by BeepBite* 🚀`
    case 'ready':
      return `🔔 *Order Ready!*\n\n📋 Order #${orderNumber}\n🏪 ${bistroName}\n\n✨ Your order is ready for pickup!\n\n📱 *Powered by BeepBite* 🚀`
    case 'completed':
      return `🎉🎊 *Order Completed!* 🎊🎉\n\n📋 Order #${orderNumber}\n🏪 ${bistroName}\n\n🌟 Thank you for your order! We hope you enjoyed it!\n\n💫 We'd love your feedback - type 'review' to leave a review!\n\n📱 *Powered by BeepBite* 🚀`
    case 'cancelled':
      return `❌ *Order Cancelled*\n\n📋 Order #${orderNumber}\n🏪 ${bistroName}\n\n😔 Your order has been cancelled. If you have any questions, please contact us.\n\n📱 *Powered by BeepBite* 🚀`
    default:
      return `📋 *Order Update*\n\n📋 Order #${orderNumber}\n🏪 ${bistroName}\n\n🔄 Your order status has been updated.\n\n📱 *Powered by BeepBite* 🚀`
  }
}

async function sendConsentSms(phoneNumber: string, bistroName: string, biteId: string): Promise<boolean> {
  // Remove the + if present for SMS
  const cleanNumber = phoneNumber.replace('+', '')
  
  // Create wa.me link with pre-filled consent message including bite ID
  const consentMessage = `Hi there! ${bistroName} wants to send you WhatsApp notifications about your order! Please click this link: https://wa.me/27731136480?text=CONSENT-${biteId}`
  
  try {
    const result = await sendSms({
      phoneNumber: cleanNumber,
      message: consentMessage
    }, 'winsms')
    
    if (result.success) {
      console.log('Consent SMS sent successfully to:', phoneNumber)
      return true
    } else {
      console.error('Failed to send consent SMS:', result.error)
      return false
    }
  } catch (error) {
    console.error('Error sending consent SMS:', error)
    return false
  }
}

async function updateBiteStatus(biteId: string, status: string) {
  const updateData: any = { status }
  
  if (status === 'ready') {
    updateData.order_ready_at = new Date().toISOString()
  }

  const { error } = await supabase
    .from('bites')
    .update(updateData)
    .eq('id', biteId)

  if (error) {
    console.error('Error updating bite status:', error)
    return false
  }

  return true
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405,
      }
    )
  }

  try {
    const body: SendMessageRequest = await req.json()
    console.log('=== SEND MESSAGE REQUEST ===')
    console.log('Request body:', JSON.stringify(body, null, 2))

    // Validate required fields
    if (!body.bite_id && !body.message) {
      console.log('ERROR: Missing required fields')
      return new Response(
        JSON.stringify({ error: 'Missing required fields: bite_id or message' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    let message = ''
    let whatsappNumber = ''
    let orderNumber = ''
    let bistroName = ''

    // If sending a custom message
    if (body.message && body.whatsapp_number) {
      message = body.message
      whatsappNumber = body.whatsapp_number
    }
    // If sending bite status update
    else if (body.bite_id) {
    console.log(`Processing bite status update for bite_id: ${body.bite_id}`)
    
    // Get bite details
    const bite = await getBiteDetails(body.bite_id)
    console.log('Bite details:', JSON.stringify(bite, null, 2))
    
    if (!bite) {
      console.log('ERROR: Bite not found')
      return new Response(
        JSON.stringify({ error: 'Bite not found' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404,
        }
      )
    }

      // Get WhatsApp number from request or bite
      whatsappNumber = body.whatsapp_number || bite.customers?.whatsapp_number
      console.log(`WhatsApp number resolved: request=${body.whatsapp_number}, bite=${bite.customers?.whatsapp_number}, final=${whatsappNumber}`)
      
      if (!whatsappNumber) {
      console.log('ERROR: WhatsApp number not found in request or bite')
      return new Response(
          JSON.stringify({ error: 'WhatsApp number not found' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        }
      )
    }

      orderNumber = bite.order_number
      bistroName = bite.bistros.name
      console.log(`Bite info - Order: ${orderNumber}, Bistro: ${bistroName}`)

      // Update bite status if provided
      if (body.order_status) {
    const statusUpdated = await updateBiteStatus(body.bite_id, body.order_status)
    if (!statusUpdated) {
      return new Response(
        JSON.stringify({ error: 'Failed to update bite status' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

        // Format status message
        message = formatStatusMessage(bistroName, orderNumber, body.order_status)
      } else {
        // Use current status
        message = formatStatusMessage(bistroName, orderNumber, bite.status)
      }

      // Update bite with customer_id if not set
      if (!bite.customer_id) {
        const customer = await getOrCreateCustomer(whatsappNumber)
        if (customer) {
          await supabase
            .from('bites')
            .update({ customer_id: customer.id })
            .eq('id', body.bite_id)
        }
      }
    }

    // Get or create customer first
    const customer = await getOrCreateCustomer(whatsappNumber)
    if (!customer) {
      console.log('ERROR: Failed to create/find customer')
      return new Response(
        JSON.stringify({ error: 'Failed to create/find customer' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

    // Check if customer has any chats - if not, send consent SMS
    console.log(`=== CHAT CHECK ===`)
    console.log(`Checking if customer ${customer.id} has any chats`)
    
    const hasChats = await checkCustomerHasChats(customer.id)
    console.log(`Chat check result - hasChats: ${hasChats}, bistroName: ${bistroName}, bite_id: ${body.bite_id}`)
    
    if (!hasChats && bistroName && body.bite_id) {
      // No chats yet - send SMS to get consent
      console.log('=== NO CHATS - SENDING CONSENT SMS ===')
      console.log(`Sending consent SMS to: ${whatsappNumber} for bistro: ${bistroName}`)
      
      const smsSent = await sendConsentSms(whatsappNumber, bistroName, body.bite_id)
      console.log(`Consent SMS sent result: ${smsSent}`)
      
      // Return early - don't send WhatsApp message yet, wait for consent
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Consent SMS sent - waiting for customer consent before sending WhatsApp notifications',
          data: {
            bite_id: body.bite_id,
            order_number: orderNumber,
            status: body.order_status,
            whatsapp_number: whatsappNumber,
            bistro_name: bistroName,
            consent_sms_sent: smsSent
          }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }
    
    console.log('=== HAS CHATS - PROCEEDING WITH WHATSAPP MESSAGE ===')
    console.log(`Customer has existing chats, proceeding with WhatsApp message to: ${whatsappNumber}`)

    // Get or create chat
    const chat = await getOrCreateChat(customer.id)
    if (!chat) {
      return new Response(
        JSON.stringify({ error: 'Failed to create/find chat' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

    // Send message
    console.log(`=== SENDING WHATSAPP MESSAGE ===`)
    console.log(`Sending to: ${whatsappNumber}`)
    console.log(`Message: ${message.substring(0, 200)}...`)
    
    const sendResult = await sendWhatsAppMessage(whatsappNumber, message)
    console.log(`WhatsApp send result:`, sendResult)
    
    if (!sendResult.success) {
      console.log('ERROR: Failed to send WhatsApp message:', sendResult.error)
      return new Response(
        JSON.stringify({ 
          error: 'Failed to send WhatsApp message',
          details: sendResult.error 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

    // Save message to database
    console.log(`Saving message to chat: ${chat.id}`)
    await saveMessage(chat.id, 'outbound', message, sendResult.messageId)

    // Update chat with last message
    await supabase
      .from('chats')
      .update({
        last_message_at: new Date().toISOString(),
        last_message_preview: message.substring(0, 100)
      })
      .eq('id', chat.id)

    console.log('=== SUCCESS ===')
    console.log(`Message sent successfully to ${whatsappNumber}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Message sent successfully',
        data: {
          bite_id: body.bite_id,
          order_number: orderNumber,
          status: body.order_status,
          whatsapp_number: whatsappNumber,
          message_id: sendResult.messageId,
          bistro_name: bistroName,
          message_preview: message.substring(0, 100)
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Send message error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
}) 