import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendSmartMessage, canUseWhatsApp } from "../../utility/communication.ts"
import { ConversationState, getConversationState, updateConversationState } from './conversation_state.ts'
import { getOrCreateCustomer } from './database_helpers.ts'
import { handleMainMenu } from './main_menu.ts'
import { handleOrdering } from './ordering.ts'
import { handleReviewFlow } from './review_system.ts'
import { formatMainMenu, validateMessageLength } from './message_formatter.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

// Always use this bot ID for all chats
const SYSTEM_BOT_ID = '46c4426a-9f5d-43d1-914c-d112deaf1d06'

export async function processMessage(
  phoneNumberId: string,
  from: string,
  messageId: string,
  messageBody: string,
  displayName?: string
): Promise<void> {
  try {
    // Normalize phone number
    const normalizedFrom = from.startsWith('+') ? from.substring(1) : from
    
    // Check if this is a consent message first
    const isConsentMessage = await handleConsentMessage(messageBody, normalizedFrom)
    if (isConsentMessage) {
      console.log('Consent processed successfully, comprehensive response sent')
      return
    }
    
    // Verify this is our bot
    const bot = await getBotFromPhoneNumber(phoneNumberId)
    if (!bot || bot.id !== SYSTEM_BOT_ID) {
      console.error('Message from unknown bot:', phoneNumberId)
      return
    }

    // Get or create customer
    const customer = await getOrCreateCustomer(normalizedFrom, displayName)
    if (!customer) {
      console.error('Failed to get/create customer')
      return
    }

    // Get or create chat
    const chat = await getOrCreateChat(customer.id)
    if (!chat) {
      console.error('Failed to get/create chat')
      return
    }

    // Save incoming message
    await saveMessage(chat.id, messageId, 'inbound', messageBody)

    // Check if this is a new conversation and handle recent bites
    const { data: previousMessages, error: messageError } = await supabase
      .from('messages')
      .select('id')
      .eq('chat_id', chat.id)
      .limit(1)

    const isNewConversation = !messageError && (!previousMessages || previousMessages.length === 0)

    if (isNewConversation) {
      console.log(`=== CHECKING RECENT BITES FOR NEW CONVERSATION ===`)
      console.log(`Customer ID: ${customer.id}, WhatsApp Number: ${normalizedFrom}`)
      
      const recentBites = await getRecentBitesByWhatsApp(normalizedFrom)
      console.log(`Found ${recentBites.length} recent bites for ${normalizedFrom}`)
      
      if (recentBites.length > 0) {
        console.log('Recent bites found:', recentBites.map(b => ({ id: b.id, order_number: b.order_number, status: b.status })))
        
        const updatesSent = await sendRecentBiteUpdates(normalizedFrom, recentBites)
        if (updatesSent) {
          await saveMessage(chat.id, '', 'outbound', 'Recent order updates')
          await updateChatLastMessage(chat.id, 'Recent order updates sent')
          return // Exit early since we've already responded
        }
      }
    }

    // Get conversation state
    const state = await getConversationState(chat.id)
    
    // Add debug logging for location messages
    if (messageBody.startsWith('LOCATION:')) {
      console.log('=== LOCATION MESSAGE DETECTED ===')
      console.log('Message body:', messageBody)
      console.log('Current conversation state:', state)
      console.log('Will route to handler for step:', state.step)
    }
    
    // Route to appropriate handler based on conversation state
    let responseMessage = ''
    
    try {
      switch (state.step) {
        case 'main_menu':
          responseMessage = await handleMainMenu(chat.id, customer.id, messageBody, state)
          break
          
        case 'new_order_warning':
          const { handleNewOrderWarning } = await import('./main_menu.ts')
          responseMessage = await handleNewOrderWarning(chat.id, customer.id, messageBody, state)
          break
          
        case 'order_type':
        case 'address_selection':
        case 'new_address':
        case 'store_selection':
        case 'store_search':
        case 'menu_display':
        case 'category_items':
        case 'item_details':
        case 'item_customization':
        case 'cart_view':
        case 'checkout':
        case 'tip_selection':
        case 'email_collection':
        case 'payment_method':
        case 'payment':
          responseMessage = await handleOrdering(chat.id, customer.id, messageBody, state)
          break
          
        case 'review_selection':
        case 'rating':
        case 'comment':
        case 'comment_write':
        case 'anon_selection':
        case 'completed':
          responseMessage = await handleReviewFlow(chat.id, customer.id, messageBody, state)
          break
          
        case 'address_list':
        case 'address_actions':
        case 'address_add':
        case 'address_added':
        case 'location_suggestions':
          const { handleAddressManagement } = await import('./address_management.ts')
          responseMessage = await handleAddressManagement(chat.id, customer.id, messageBody, state)
          break
          
        case 'profile_view':
        case 'profile_edit':
        case 'profile_field_edit':
          const { handleProfileManagement } = await import('./profile_management.ts')
          responseMessage = await handleProfileManagement(chat.id, customer.id, messageBody, state)
          break
          
        default:
          // Default to main menu
          responseMessage = formatMainMenu()
          await updateConversationState(chat.id, { step: 'main_menu' })
      }
    } catch (handlerError) {
      console.error('Error in message handler:', handlerError)
      console.error('Context:', { 
        step: state.step, 
        customerId: customer.id, 
        messageBody: messageBody.substring(0, 100) 
      })
      
      // Send generic error message to user instead of actual error
      responseMessage = `❌ *Service Temporarily Unavailable*\n\nWe're experiencing technical difficulties. Please try again in a few moments.\n\nIf the problem persists, please contact support.\n\n📱 *Powered by BeepBite.io*`
      
      // Reset to main menu to prevent user from being stuck
      try {
        await updateConversationState(chat.id, { step: 'main_menu' })
      } catch (resetError) {
        console.error('Error resetting conversation state:', resetError)
      }
    }

    // Send response
    await sendResponse(normalizedFrom, responseMessage, chat.id)

  } catch (error) {
    console.error('Error processing message:', error)
  }
}

export async function handleConsentMessage(messageBody: string, normalizedFrom: string): Promise<boolean> {
  // Regex to match CONSENT-{uuid} format - case insensitive
  const consentRegex = /CONSENT-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  const match = messageBody.match(consentRegex)
  
  if (!match) {
    return false // Not a consent message
  }
  
  const biteId = match[1]
  console.log(`Consent message detected for bite ID: ${biteId} from ${normalizedFrom}`)
  
  try {
    // Get or create customer
    const customer = await getOrCreateCustomer(normalizedFrom)
    if (!customer) {
      console.error('Failed to get/create customer for consent')
      return false
    }

    // Get or create chat
    const chat = await getOrCreateChat(customer.id)
    if (!chat) {
      console.error('Failed to get/create chat for consent')
      return false
    }

    // Find the bite and verify it belongs to this customer
    const { data: bite, error: biteError } = await supabase
      .from('orders')
      .select(`
        *,
        customers!inner(whatsapp_number),
        locations(name)
      `)
      .eq('id', biteId)
      .eq('customers.whatsapp_number', normalizedFrom)
      .single()

    if (biteError || !bite) {
      console.error('Bite not found or does not belong to customer:', biteError)
      return false
    }

    console.log(`Valid consent for bite: ${bite.order_number}`)

    // Send consent confirmation and comprehensive bot introduction
    await sendConsentConfirmation(normalizedFrom, bite, chat.id)
    
    return true // Successfully processed consent
    
  } catch (error) {
    console.error('Error processing consent message:', error)
    return false
  }
}

export async function sendConsentConfirmation(whatsappNumber: string, connectedBite: any, chatId: string) {
  let message = `✅ *Thank you for confirming!*\n\n`
  message += `I found your order #${connectedBite.order_number} from ${connectedBite.locations?.name || 'the restaurant'}.\n\n`
  
  message += `🤖 *I'm your BeepBite assistant!*\n\n`
  message += `I can help you:\n`
  message += `📝 Track your orders\n`
  message += `⭐ Rate your experiences\n`
  message += `💬 Share feedback\n`
  message += `🔔 Get status updates\n\n`
  
  message += `Let me check if you have any orders to review...\n\n`
  message += `📱 *Powered by BeepBite.io*`

  console.log('Sending consent confirmation message')
  
  // Send the consent confirmation first
  const consentResult = await sendSmartMessage({
    whatsapp_number: whatsappNumber,
    message: message,
    subject: 'BeepBite.io - Welcome!'
  })

  if (consentResult.success && consentResult.method === 'whatsapp') {
    await saveMessage(chatId, '', 'outbound', message)
  }

  // Wait a moment then send the review flow
  setTimeout(async () => {
    try {
      // Import review functions
      const { getUnreviewedBites, formatBitesForReview, formatWelcomeMessage, getIncompleteBites } = await import('./review_system.ts')
      
      const unreviewedBites = await getUnreviewedBites(whatsappNumber)
      
      let followUpMessage = ''
      if (unreviewedBites.length > 0) {
        followUpMessage = formatBitesForReview(unreviewedBites, 0)
        // Update conversation state to review selection
        await updateConversationState(chatId, { step: 'review_selection', review_page: 0 })
      } else {
        const incompleteBites = await getIncompleteBites(whatsappNumber)
        followUpMessage = formatWelcomeMessage(incompleteBites, 0)
        // Update conversation state to main menu
        await updateConversationState(chatId, { step: 'main_menu', review_page: 0 })
      }

      const followUpResult = await sendSmartMessage({
        whatsapp_number: whatsappNumber,
        message: followUpMessage,
        subject: 'BeepBite.io - Your Orders'
      })

      if (followUpResult.success && followUpResult.method === 'whatsapp') {
        await saveMessage(chatId, '', 'outbound', followUpMessage)
      }

      await updateChatLastMessage(chatId, followUpMessage)
      
    } catch (error) {
      console.error('Error sending follow-up message:', error)
    }
  }, 2000) // 2 second delay
}

async function getRecentBitesByWhatsApp(whatsappNumber: string) {
  const { data: bites, error } = await supabase
    .from('orders')
    .select(`
      id,
      order_number,
      status,
      created_at,
      customers!inner(whatsapp_number),
      locations(name)
    `)
    .eq('customers.whatsapp_number', whatsappNumber)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // Last 24 hours
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    console.error('Error fetching recent bites:', error)
    return []
  }

  return bites || []
}

async function sendRecentBiteUpdates(whatsappNumber: string, recentBites: any[]): Promise<boolean> {
  try {
    let message = `🔔 *Order Updates*\n\n`
    message += `Here are your recent orders:\n\n`

    recentBites.forEach((bite, index) => {
      message += `*${index + 1}.* ${bite.locations?.name || 'Restaurant'}\n`
      message += `   Order #${bite.order_number}\n`
      message += `   Status: ${bite.status}\n`
      message += `   ${getTimeRemaining(bite.created_at)}\n\n`
    })

    message += `I'll help you track these and collect reviews when ready!\n\n`
    message += `📱 *Powered by BeepBite.io*`

    const result = await sendSmartMessage({
      whatsapp_number: whatsappNumber,
      message: message,
      subject: 'BeepBite.io - Order Updates'
    })

    return result.success
  } catch (error) {
    console.error('Error sending recent bite updates:', error)
    return false
  }
}

function getTimeRemaining(createdAt: string): string {
  const now = new Date()
  const created = new Date(createdAt)
  const diffMs = now.getTime() - created.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  
  if (diffHours > 0) {
    return `${diffHours}h ${diffMinutes}m ago`
  } else {
    return `${diffMinutes}m ago`
  }
}

async function sendResponse(whatsappNumber: string, message: string, chatId: string): Promise<void> {
  console.log('=== SENDING RESPONSE ===')
  
  // Validate message length before sending
  const validation = validateMessageLength(message)
  let messageToSend = message
  
  if (!validation.valid) {
    console.warn(`Message too long (${validation.length} chars), truncating to fit WhatsApp limit`)
    messageToSend = validation.truncated!
  }
  
  try {
    // Check if we can use WhatsApp for this customer
    const whatsappCheck = await canUseWhatsApp(whatsappNumber)
    console.log('WhatsApp capability check:', whatsappCheck)
    
    if (whatsappCheck.canUse) {
      // Can use WhatsApp - send directly
      const messageSent = await sendWhatsAppMessage(whatsappNumber, messageToSend)
      
      if (messageSent) {
        // Save outbound message
        await saveMessage(chatId, '', 'outbound', messageToSend)
        
        // Update chat with last message
        await updateChatLastMessage(chatId, messageToSend)
      } else {
        console.error('Failed to send WhatsApp message to:', whatsappNumber)
        
        // Try to send a fallback message
        try {
          const fallbackMessage = `❌ *Service Error*\n\nWe're having trouble sending your message. Please try again.\n\n📱 *Powered by BeepBite.io*`
          await sendWhatsAppMessage(whatsappNumber, fallbackMessage)
        } catch (fallbackError) {
          console.error('Failed to send fallback message:', fallbackError)
        }
      }
    } else {
      // Cannot use WhatsApp - use smart routing for fallbacks
      console.log('Cannot use WhatsApp for response - using smart routing')
      
      const smartResult = await sendSmartMessage({
        whatsapp_number: whatsappNumber,
        message: messageToSend,
        subject: 'BeepBite.io - Restaurant Chat'
      })
      
      console.log('Smart message result:', smartResult)
      
      // Still update chat state regardless of send method
      await updateChatLastMessage(chatId, messageToSend)
      
      // Only save to messages table if it was sent via WhatsApp
      if (smartResult.method === 'whatsapp') {
        await saveMessage(chatId, '', 'outbound', messageToSend)
      }
    }
  } catch (error) {
    console.error('Error in sendResponse:', error)
    console.error('Failed message details:', {
      whatsappNumber,
      messageLength: messageToSend.length,
      chatId
    })
    
    // Don't expose internal errors to users - they're already handled in processMessage
  }
}

async function getBotFromPhoneNumber(phoneNumberId: string) {
  const { data: bot, error } = await supabase
    .from('bots')
    .select('*')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .eq('is_active', true)
    .single()

  if (error) {
    console.error('Error fetching bot:', error)
    return null
  }

  return bot
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
      conversation_state: { step: 'main_menu' },
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

async function saveMessage(chatId: string, whatsappMessageId: string, direction: 'inbound' | 'outbound', content: string) {
  const { error } = await supabase
    .from('messages')
    .insert({
      chat_id: chatId,
      whatsapp_message_id: whatsappMessageId,
      direction: direction,
      message_type: 'text',
      content: content,
      created_at: new Date().toISOString()
    })

  if (error) {
    console.error('Error saving message:', error)
  }
}

async function updateChatLastMessage(chatId: string, message: string) {
  const { error } = await supabase
    .from('chats')
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: message.substring(0, 100)
    })
    .eq('id', chatId)

  if (error) {
    console.error('Error updating chat last message:', error)
  }
}

export async function sendWhatsAppMessage(to: string, message: string): Promise<boolean> {
  try {
    const accessToken = Deno.env.get('WHATSAPP_API_TOKEN')
    
    if (!accessToken) {
      console.error('WhatsApp access token not configured')
      return false
    }

    // Get phone number ID from bot record instead of environment variable
    const { data: bot, error: botError } = await supabase
      .from('bots')
      .select('whatsapp_phone_number_id')
      .eq('id', SYSTEM_BOT_ID)
      .eq('is_active', true)
      .single()

    if (botError || !bot?.whatsapp_phone_number_id) {
      console.error('Bot not found or phone number ID not configured:', botError)
      return false
    }

    const phoneNumberId = bot.whatsapp_phone_number_id

    const response = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual', // Can send to individual WhatsApp numbers
        to: to,
        type: 'text',
        text: {
          preview_url: false,
          body: message
        }
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('WhatsApp API error:', errorData)
      return false
    }

    console.log(`WhatsApp message sent successfully to ${to} via phone number ID: ${phoneNumberId}`)
    return true
  } catch (error) {
    console.error('Error sending WhatsApp message:', error)
    return false
  }
} 