import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendSmartMessage } from "../utility/communication.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Always use this bot ID for all sending
const SYSTEM_BOT_ID = '46c4426a-9f5d-43d1-914c-d112deaf1d06'

interface SendMessageRequest {
  order_id: string
  order_status?: 'pending' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'completed' | 'cancelled'
  message?: string
  whatsapp_number?: string
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

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

async function getOrCreateChat(customerId: string, locationId?: string) {
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
    // Update location_id if provided and different
    if (locationId && existingChat.location_id !== locationId) {
      const { error: updateError } = await supabase
        .from('chats')
        .update({ location_id: locationId })
        .eq('id', existingChat.id)
        
      if (updateError) {
        console.error('Error updating chat location:', updateError)
      }
    }
    return existingChat
  }

  // Create new chat
  const { data: newChat, error: createError } = await supabase
    .from('chats')
    .insert({
      bot_id: SYSTEM_BOT_ID,
      customer_id: customerId,
      location_id: locationId || null, // Can be null initially
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

async function getOrderDetails(orderId: string) {
  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      *,
      locations(name),
      customers(whatsapp_number)
    `)
    .eq('id', orderId)
    .single()

  if (error) {
    console.error('Error fetching order details:', error)
    return null
  }

  return order
}

function formatStatusMessage(locationName: string, orderNumber: string, status: string): string {
  switch (status) {
    case 'pending':
      return `⏳ *Order Update*\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n✅ Your order has been received and is being prepared!\n\n📱 *Powered by BeepBite* 🚀`
    case 'confirmed':
      return `✅ *Order Confirmed*\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n🔥 Your order has been confirmed and will be prepared shortly!\n\n📱 *Powered by BeepBite* 🚀`
    case 'preparing':
      return `👨‍🍳 *Order Update*\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n🔥 Your order is now being prepared! We'll notify you when it's ready.\n\n📱 *Powered by BeepBite* 🚀`
    case 'ready':
      return `🔔 *Order Ready!*\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n✨ Your order is ready for pickup!\n\n📱 *Powered by BeepBite* 🚀`
    case 'out_for_delivery':
      return `🚗 *Out for Delivery*\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n🛵 Your order is on its way to you!\n\n📱 *Powered by BeepBite* 🚀`
    case 'delivered':
      return `📦 *Order Delivered*\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n✅ Your order has been delivered!\n\n📱 *Powered by BeepBite* 🚀`
    case 'completed':
      return `🎉🎊 *Order Completed!* 🎊🎉\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n🌟 Thank you for your order! We hope you enjoyed it!\n\n💫 We'd love your feedback - type 'review' to leave a review!\n\n📱 *Powered by BeepBite* 🚀`
    case 'cancelled':
      return `❌ *Order Cancelled*\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n😔 Your order has been cancelled. If you have any questions, please contact us.\n\n📱 *Powered by BeepBite* 🚀`
    default:
      return `📋 *Order Update*\n\n📋 Order #${orderNumber}\n🏪 ${locationName}\n\n🔄 Your order status has been updated.\n\n📱 *Powered by BeepBite* 🚀`
  }
}

async function updateOrderStatus(orderId: string, status: string) {
  const updateData: any = { status }
  
  // Update order details if specific status
  if (status === 'ready') {
    // Update ready_at in order_details table
    await supabase
      .from('order_details')
      .update({ ready_at: new Date().toISOString() })
      .eq('order_id', orderId)
  }

  const { error } = await supabase
    .from('orders')
    .update(updateData)
    .eq('id', orderId)

  if (error) {
    console.error('Error updating order status:', error)
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
    if (!body.order_id && !body.message) {
      console.log('ERROR: Missing required fields')
      return new Response(
        JSON.stringify({ error: 'Missing required fields: order_id or message' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      )
    }

    let message = ''
    let whatsappNumber = ''
    let orderNumber = ''
    let locationName = ''
    let locationId = ''

    // If sending a custom message
    if (body.message && body.whatsapp_number) {
      message = body.message
      whatsappNumber = body.whatsapp_number
      // For custom messages, we don't have a specific location context
      // We'll need to handle this case differently in getOrCreateChat
    }
    // If sending order status update
    else if (body.order_id) {
    console.log(`Processing order status update for order_id: ${body.order_id}`)
    
    // Get order details
    const order = await getOrderDetails(body.order_id)
    console.log('Order details:', JSON.stringify(order, null, 2))
    
    if (!order) {
      console.log('ERROR: Order not found')
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404,
        }
      )
    }

      // Get WhatsApp number from request or order
      whatsappNumber = body.whatsapp_number || order.customers?.whatsapp_number
      console.log(`WhatsApp number resolved: request=${body.whatsapp_number}, order=${order.customers?.whatsapp_number}, final=${whatsappNumber}`)
      
      if (!whatsappNumber) {
      console.log('ERROR: WhatsApp number not found in request or order')
      return new Response(
          JSON.stringify({ error: 'WhatsApp number not found' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 400,
        }
      )
    }

      orderNumber = order.order_number
      locationName = order.locations.name
      locationId = order.location_id
      console.log(`Order info - Number: ${orderNumber}, Location: ${locationName}`)

      // Update order status if provided
      if (body.order_status) {
    const statusUpdated = await updateOrderStatus(body.order_id, body.order_status)
    if (!statusUpdated) {
      return new Response(
        JSON.stringify({ error: 'Failed to update order status' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

        // Format status message
        message = formatStatusMessage(locationName, orderNumber, body.order_status)
      } else {
        // Use current status
        message = formatStatusMessage(locationName, orderNumber, order.status)
      }

      // Update order with customer_id if not set
      if (!order.customer_id) {
        const customer = await getOrCreateCustomer(whatsappNumber)
        if (customer) {
          await supabase
            .from('orders')
            .update({ customer_id: customer.id })
            .eq('id', body.order_id)
        }
      }
    }

    // Use smart message routing to handle 24-hour rule and fallbacks
    console.log('=== USING SMART MESSAGE ROUTING ===')
    console.log(`Sending to: ${whatsappNumber}`)
    console.log(`Message: ${message.substring(0, 200)}...`)
    
    const smartResult = await sendSmartMessage({
      whatsapp_number: whatsappNumber,
      message: message,
      subject: `Order Update from ${locationName}`,
      location_name: locationName,
      order_number: orderNumber,
      order_id: body.order_id
    })
    
    console.log('Smart message result:', smartResult)
    
    if (!smartResult.success) {
      console.log('ERROR: Smart message failed:', smartResult.error)
      return new Response(
        JSON.stringify({ 
          error: 'Failed to send notification',
          details: smartResult.error 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 500,
        }
      )
    }

    // Handle database updates for WhatsApp messages
    if (smartResult.method === 'whatsapp' && smartResult.details?.customer_id && locationId) {
      // Get or create chat for WhatsApp messages only (requires location context)
      const chat = await getOrCreateChat(smartResult.details.customer_id, locationId)
      if (chat) {
        // Save message to database
        await saveMessage(chat.id, 'outbound', message)
        
        // Update chat with last message
        await supabase
          .from('chats')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: message.substring(0, 100)
          })
          .eq('id', chat.id)
      }
    }

    console.log('=== SUCCESS ===')
    console.log(`Message sent successfully to ${whatsappNumber} via ${smartResult.method}`)

    return new Response(
      JSON.stringify({
        success: true,
        message: `Message sent successfully via ${smartResult.method}`,
        data: {
          order_id: body.order_id,
          order_number: orderNumber,
          status: body.order_status,
          whatsapp_number: whatsappNumber,
          location_name: locationName,
          message_preview: message.substring(0, 100),
          method: smartResult.method,
          details: smartResult.details
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