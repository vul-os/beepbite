import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { sendSmartMessage, canUseWhatsApp } from "../utility/communication.ts"

// Always use this bot ID for all chats
const SYSTEM_BOT_ID = '46c4426a-9f5d-43d1-914c-d112deaf1d06'

interface ConversationState {
  step: 'welcome' | 'menu' | 'review_selection' | 'rating' | 'comment' | 'comment_write' | 'anon_selection' | 'completed'
  selected_bite_id?: string
  rating?: number
  comment?: string
  review_page?: number
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const ITEMS_PER_PAGE = 5
const REVIEW_WINDOW_HOURS = 24

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
    // Find the bite
    const { data: bite, error: biteError } = await supabase
      .from('bites')
      .select(`
        id,
        customer_id,
        order_number,
        bistro_id,
        whatsapp_number,
        created_at,
        status,
        bistros(name)
      `)
      .eq('id', biteId)
      .single()
    
    if (biteError || !bite) {
      console.error('Bite not found for consent:', biteError)
      return false
    }
    
    console.log(`Original bite customer_id: ${bite.customer_id}, whatsapp_number: ${bite.whatsapp_number}`)
    
    // Find or create customer with the consenting number
    const consentingCustomer = await getOrCreateCustomer(normalizedFrom)
    if (!consentingCustomer) {
      console.error('Failed to get/create consenting customer')
      return false
    }
    
    console.log(`Consenting customer ID: ${consentingCustomer.id}, number: ${normalizedFrom}`)
    
    // Update bite's original_number and customer_id to the consenting customer
    const originalNumberWithPrefix = normalizedFrom.startsWith('27') ? `+${normalizedFrom}` : normalizedFrom
    const { error: biteUpdateError } = await supabase
      .from('bites')
      .update({ 
        customer_id: consentingCustomer.id,
        original_number: originalNumberWithPrefix,
        whatsapp_number: normalizedFrom
      })
      .eq('id', biteId)
    
    if (biteUpdateError) {
      console.error('Error updating bite with consenting customer:', biteUpdateError)
      return false
    }
    
    console.log(`Successfully processed consent for bite ${biteId}:`)
    console.log(`- Updated customer_id from ${bite.customer_id} to ${consentingCustomer.id}`)
    console.log(`- Set original_number to ${originalNumberWithPrefix}`)
    console.log(`- Set whatsapp_number to ${normalizedFrom}`)
    
    // Create chat for the consenting customer
    const chat = await getOrCreateChat(consentingCustomer.id)
    if (chat) {
      console.log(`Chat created/found for consenting customer: ${chat.id}`)
      
      // Save the consent message as inbound
      await saveMessage(chat.id, '', 'inbound', messageBody)
      
      // Send comprehensive consent confirmation with orders overview
      await sendConsentConfirmation(normalizedFrom, bite, chat.id)
      
      console.log('Consent processed successfully with comprehensive response sent')
    } else {
      console.error('Failed to create chat for consenting customer')
      
      // If chat creation fails, send a simple confirmation
      const fallbackMessage = `✅ Consent received! Thank you for joining WhatsApp notifications.`
      await sendWhatsAppMessage(normalizedFrom, fallbackMessage)
    }
    
    return true
  } catch (error) {
    console.error('Error processing consent message:', error)
    return false
  }
}

export async function handleMessage(phoneNumberId: string, from: string, messageId: string, messageBody: string, displayName?: string) {
  // Normalize phone number by removing + prefix if present
  const normalizedFrom = from.startsWith('+') ? from.substring(1) : from
  
  // Check if this is a consent message first
  const isConsentMessage = await handleConsentMessage(messageBody, normalizedFrom)
  if (isConsentMessage) {
    // Consent has been processed and comprehensive response sent - exit early
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

  // Check if this is a new conversation (no previous messages in this chat)
  const { data: previousMessages, error: messageError } = await supabase
    .from('messages')
    .select('id')
    .eq('chat_id', chat.id)
    .limit(1)

  const isNewConversation = !messageError && (!previousMessages || previousMessages.length === 0)

  // Save incoming message
  await saveMessage(chat.id, messageId, 'inbound', messageBody)

  // If this is a new conversation, check for recent bites and send updates
  if (isNewConversation) {
    console.log(`=== CHECKING RECENT BITES FOR NEW CONVERSATION ===`)
    console.log(`Customer ID: ${customer.id}, WhatsApp Number: ${normalizedFrom}`)
    
    const recentBites = await getRecentBitesByWhatsApp(normalizedFrom)
    console.log(`Found ${recentBites.length} recent bites for ${normalizedFrom}`)
    
    if (recentBites.length > 0) {
      console.log('Recent bites found:', recentBites.map(b => ({ id: b.id, order_number: b.order_number, status: b.status })))
      
      const updatesSent = await sendRecentBiteUpdates(normalizedFrom, recentBites)
      if (updatesSent) {
        // Save the updates message
        await saveMessage(chat.id, '', 'outbound', 'Recent order updates')
        // Update chat with the updates message
        await updateChatState(chat.id, { step: 'welcome' }, 'Recent order updates sent')
        return // Exit early since we've already responded
      }
    } else {
      console.log(`No recent bites found for ${normalizedFrom}, checking unreviewed bites instead`)
      
      // Also check unreviewed bites for this customer
      const unreviewedBites = await getUnreviewedBites(normalizedFrom)
      console.log(`Found ${unreviewedBites.length} unreviewed bites for ${normalizedFrom}`)
      
      if (unreviewedBites.length > 0) {
        console.log('Unreviewed bites found:', unreviewedBites.map(b => ({ id: b.id, order_number: b.order_number })))
      }
    }
  }

  const currentState: ConversationState = chat.conversation_state || { step: 'welcome' }
  const selectedNumber = parseInt(messageBody.trim())

  let responseMessage = ''
  let newState: ConversationState = { ...currentState }

  // Handle conversation flow based on current step
  if (currentState.step === 'welcome' || currentState.step === 'menu') {
    const incompleteBites = await getIncompleteBites(normalizedFrom)
    const currentPage = currentState.review_page || 0
    const totalPages = Math.ceil(incompleteBites.length / 5) // ITEMS_PER_PAGE = 5
    const startIndex = currentPage * 5
    const endIndex = Math.min(startIndex + 5, incompleteBites.length)
    
    if (!isNaN(selectedNumber)) {
      // Check if it's pagination or navigation
      let optionNumber = endIndex + 1
      let handled = false
      
      // Previous page option
      if (currentPage > 0 && selectedNumber === optionNumber) {
        const prevPage = currentPage - 1
        responseMessage = formatWelcomeMessage(incompleteBites, prevPage)
        newState = { step: 'welcome', review_page: prevPage }
        handled = true
      } else if (currentPage > 0) {
        optionNumber++
      }
      
      // Next page option
      if (!handled && currentPage < totalPages - 1 && selectedNumber === optionNumber) {
        const nextPage = currentPage + 1
        responseMessage = formatWelcomeMessage(incompleteBites, nextPage)
        newState = { step: 'welcome', review_page: nextPage }
        handled = true
      }
      
      // If not handled, show default welcome
      if (!handled) {
        responseMessage = formatWelcomeMessage(incompleteBites, currentPage)
        newState = { step: 'welcome', review_page: currentPage }
      }
    } else {
      // Any non-number input shows reviews menu
      const unreviewedBites = await getUnreviewedBites(normalizedFrom)
      if (unreviewedBites.length === 0) {
        responseMessage = formatWelcomeMessage(incompleteBites, 0)
        newState = { step: 'welcome', review_page: 0 }
      } else {
        responseMessage = formatBitesForReview(unreviewedBites, 0)
        newState = { step: 'review_selection', review_page: 0 }
      }
    }
  }
  else if (currentState.step === 'review_selection') {
    const unreviewedBites = await getUnreviewedBites(normalizedFrom)
    const currentPage = currentState.review_page || 0
    const totalPages = Math.ceil(unreviewedBites.length / 5)
    const startIndex = currentPage * 5
    const endIndex = Math.min(startIndex + 5, unreviewedBites.length)
    
    if (!isNaN(selectedNumber)) {
      // Check if it's a bite selection (1 to total bites)
      if (selectedNumber >= 1 && selectedNumber <= unreviewedBites.length) {
        const selectedBite = unreviewedBites[selectedNumber - 1]
        responseMessage = formatRatingRequest()
        newState = { step: 'rating', selected_bite_id: selectedBite.id }
      }
      // Check if it's pagination or navigation
      else {
        let optionNumber = endIndex + 1
        let handled = false
        
        // Previous page option
        if (currentPage > 0 && selectedNumber === optionNumber) {
          const prevPage = currentPage - 1
          responseMessage = formatBitesForReview(unreviewedBites, prevPage)
          newState = { step: 'review_selection', review_page: prevPage }
          handled = true
        } else if (currentPage > 0) {
          optionNumber++
        }
        
        // Next page option
        if (!handled && currentPage < totalPages - 1 && selectedNumber === optionNumber) {
          const nextPage = currentPage + 1
          responseMessage = formatBitesForReview(unreviewedBites, nextPage)
          newState = { step: 'review_selection', review_page: nextPage }
          handled = true
        } else if (!handled && currentPage < totalPages - 1) {
          optionNumber++
        }
        
        // Main menu option
        if (!handled && selectedNumber === optionNumber) {
          const incompleteBites = await getIncompleteBites(normalizedFrom)
          responseMessage = formatWelcomeMessage(incompleteBites, 0)
          newState = { step: 'welcome', review_page: 0 }
          handled = true
        }
        
        // If not handled, show error
        if (!handled) {
          responseMessage = `❌ *Invalid Selection*\n\nPlease select a valid number.\n\n${formatBitesForReview(unreviewedBites, currentPage)}`
          // Stay in same state
        }
      }
    } else {
      responseMessage = `❌ *Invalid Selection*\n\nPlease select a valid number.\n\n${formatBitesForReview(unreviewedBites, currentPage)}`
      // Stay in same state
    }
  }
  else if (currentState.step === 'rating') {
    if (!isNaN(selectedNumber)) {
      // Check if it's a rating (1-10)
      if (selectedNumber >= 1 && selectedNumber <= 10) {
        responseMessage = formatCommentWriteRequest(selectedNumber)
        newState = { ...currentState, step: 'comment_write', rating: selectedNumber }
      }
      // Check if it's main menu (11)
      else if (selectedNumber === 11) {
        const incompleteBites = await getIncompleteBites(normalizedFrom)
        responseMessage = formatWelcomeMessage(incompleteBites, 0)
        newState = { step: 'welcome', review_page: 0 }
      }
      else {
        responseMessage = `❌ *Invalid Rating*\n\nPlease select a number from 1 to 10, or 11 for main menu.\n\n${formatRatingRequest()}`
        // Stay in same state
      }
    } else {
      responseMessage = `❌ *Invalid Rating*\n\nPlease select a number from 1 to 10, or 11 for main menu.\n\n${formatRatingRequest()}`
      // Stay in same state
    }
  }
    else if (currentState.step === 'comment') {
    if (!isNaN(selectedNumber)) {
      // Check if it's write comment (1)
      if (selectedNumber === 1) {
        responseMessage = formatCommentWriteRequest(currentState.rating!)
        newState = { ...currentState, step: 'comment_write' }
      }
      // Check if it's skip (2) 
      else if (selectedNumber === 2) {
        responseMessage = formatAnonSelectionMessage(currentState.rating!, '2')
        newState = { ...currentState, step: 'anon_selection', comment: '2' }
      }
      // Check if it's main menu (3)
      else if (selectedNumber === 3) {
        const incompleteBites = await getIncompleteBites(normalizedFrom)
        responseMessage = formatWelcomeMessage(incompleteBites, 0)
        newState = { step: 'welcome', review_page: 0 }
      }
      else {
        responseMessage = `❌ *Invalid Selection*\n\nPlease select an option:\n\n${formatCommentRequest(currentState.rating!)}`
        // Stay in same state
      }
    } else {
      responseMessage = `❌ *Invalid Selection*\n\nPlease select an option:\n\n${formatCommentRequest(currentState.rating!)}`
      // Stay in same state
    }
  }
  else if (currentState.step === 'comment_write') {
    if (!isNaN(selectedNumber)) {
      // Check if it's skip (1)
      if (selectedNumber === 1) {
        responseMessage = formatAnonSelectionMessage(currentState.rating!, '2')
        newState = { ...currentState, step: 'anon_selection', comment: '2' }
      }
      // Check if it's main menu (2)
      else if (selectedNumber === 2) {
        const incompleteBites = await getIncompleteBites(normalizedFrom)
        responseMessage = formatWelcomeMessage(incompleteBites, 0)
        newState = { step: 'welcome', review_page: 0 }
      }
      else {
        responseMessage = `❌ *Invalid Selection*\n\nPlease type your comment or select an option:\n\n${formatCommentWriteRequest(currentState.rating!)}`
        // Stay in same state
      }
    } else {
      // It's a text comment
      const comment = messageBody.trim()
      responseMessage = formatAnonSelectionMessage(currentState.rating!, comment)
      newState = { ...currentState, step: 'anon_selection', comment: comment }
    }
  }
  else if (currentState.step === 'anon_selection') {
    if (!isNaN(selectedNumber)) {
      // Check if it's Yes - Share my name (1)
      if (selectedNumber === 1) {
        const reviewSaved = await saveReview(currentState.selected_bite_id!, currentState.rating!, currentState.comment!, false)
        if (reviewSaved) {
          // Get remaining outstanding reviews (excluding the one just completed)
          const allUnreviewedBites = await getUnreviewedBites(normalizedFrom)
          const outstandingReviews = allUnreviewedBites.filter(bite => bite.id !== currentState.selected_bite_id)
          
          responseMessage = formatThankYouMessage(currentState.rating!, currentState.comment!, false, outstandingReviews)
          newState = { step: 'completed' }
        } else {
          responseMessage = `❌ *Error Saving Review*\n\nPlease try again.\n\n*[1]* ✅ Yes - Share my name (default)\n*[2]* 🚫 No - Keep me anonymous\n*[3]* 🏠 Main menu\n\n📱 *Powered by BeepBite.io*`
          // Stay in same state
        }
      }
      // Check if it's No - Keep me anonymous (2)
      else if (selectedNumber === 2) {
        const reviewSaved = await saveReview(currentState.selected_bite_id!, currentState.rating!, currentState.comment!, true)
        if (reviewSaved) {
          // Get remaining outstanding reviews (excluding the one just completed)
          const allUnreviewedBites = await getUnreviewedBites(normalizedFrom)
          const outstandingReviews = allUnreviewedBites.filter(bite => bite.id !== currentState.selected_bite_id)
          
          responseMessage = formatThankYouMessage(currentState.rating!, currentState.comment!, true, outstandingReviews)
          newState = { step: 'completed' }
        } else {
          responseMessage = `❌ *Error Saving Review*\n\nPlease try again.\n\n*[1]* ✅ Yes - Share my name (default)\n*[2]* 🚫 No - Keep me anonymous\n*[3]* 🏠 Main menu\n\n📱 *Powered by BeepBite.io*`
          // Stay in same state
        }
      }
      // Check if it's main menu (3)
      else if (selectedNumber === 3) {
        const incompleteBites = await getIncompleteBites(normalizedFrom)
        responseMessage = formatWelcomeMessage(incompleteBites, 0)
        newState = { step: 'welcome', review_page: 0 }
      }
      else {
        responseMessage = `❌ *Invalid Selection*\n\nPlease select an option:\n\n${formatAnonSelectionMessage(currentState.rating!, currentState.comment!)}`
        // Stay in same state
      }
    } else {
      responseMessage = `❌ *Invalid Selection*\n\nPlease select an option:\n\n${formatAnonSelectionMessage(currentState.rating!, currentState.comment!)}`
      // Stay in same state
    }
  }
  else if (currentState.step === 'completed') {
    // Any input goes to reviews menu
    const unreviewedBites = await getUnreviewedBites(normalizedFrom)
    if (unreviewedBites.length === 0) {
      const incompleteBites = await getIncompleteBites(normalizedFrom)
      responseMessage = formatWelcomeMessage(incompleteBites, 0)
      newState = { step: 'welcome', review_page: 0 }
    } else {
      responseMessage = formatBitesForReview(unreviewedBites, 0)
      newState = { step: 'review_selection', review_page: 0 }
    }
  }
  else {
    // Default fallback - always show menu
    const incompleteBites = await getIncompleteBites(normalizedFrom)
    responseMessage = formatWelcomeMessage(incompleteBites, 0)
    newState = { step: 'welcome', review_page: 0 }
  }

  // Send response using smart routing
  console.log('=== WEBHOOK SENDING RESPONSE ===')
  
  // Check if we can use WhatsApp for this customer
  const whatsappCheck = await canUseWhatsApp(normalizedFrom)
  console.log('WhatsApp capability check:', whatsappCheck)
  
  if (whatsappCheck.canUse) {
    // Can use WhatsApp - send directly
    const messageSent = await sendWhatsAppMessage(normalizedFrom, responseMessage)
    
    if (messageSent) {
      // Save outbound message
      await saveMessage(chat.id, '', 'outbound', responseMessage)
      
      // Update chat state
      await updateChatState(chat.id, newState, responseMessage.substring(0, 100))
    }
  } else {
    // Cannot use WhatsApp - use smart routing for fallbacks
    console.log('Cannot use WhatsApp for response - using smart routing')
    
    const smartResult = await sendSmartMessage({
      whatsapp_number: normalizedFrom,
      message: responseMessage,
      subject: 'BeepBite.io - Restaurant Chat'
    })
    
    console.log('Smart message result for webhook response:', smartResult)
    
    // Still update chat state regardless of send method
    await updateChatState(chat.id, newState, responseMessage.substring(0, 100))
    
    // Only save to messages table if it was sent via WhatsApp
    if (smartResult.method === 'whatsapp') {
      await saveMessage(chat.id, '', 'outbound', responseMessage)
    }
  }
}

export function getTimeRemaining(createdAt: string): string {
  const now = new Date()
  const orderTime = new Date(createdAt)
  const expiryTime = new Date(orderTime.getTime() + (REVIEW_WINDOW_HOURS * 60 * 60 * 1000))
  const timeLeft = expiryTime.getTime() - now.getTime()
  
  const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60))
  const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hoursLeft > 0) {
    return `⏰ ${hoursLeft}h ${minutesLeft}m left`
  } else {
    return `⏰ ${minutesLeft}m left`
  }
}

export async function sendWhatsAppMessage(to: string, message: string): Promise<boolean> {
  const whatsappToken = Deno.env.get('WHATSAPP_API_TOKEN')
  const whatsappBaseUrl = Deno.env.get('WHATSAPP_API_BASE_URL') || 'https://graph.facebook.com/v18.0'
  
  if (!whatsappToken) {
    console.error('WhatsApp token not configured')
    return false
  }

  // Get bot phone number ID
  const { data: bot, error: botError } = await supabase
    .from('bots')
    .select('whatsapp_phone_number_id')
    .eq('id', SYSTEM_BOT_ID)
    .single()

  if (botError || !bot) {
    console.error('Bot not found:', botError)
    return false
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
      return false
    }

    return true
  } catch (error) {
    console.error('WhatsApp send error:', error)
    return false
  }
}

export async function getOrCreateCustomer(whatsappNumber: string, displayName?: string) {
  // Normalize phone number by removing + prefix if present
  const normalizedNumber = whatsappNumber.startsWith('+') ? whatsappNumber.substring(1) : whatsappNumber
  
  // Check if customer exists
  const { data: existingCustomer, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('whatsapp_number', normalizedNumber)
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
      whatsapp_number: normalizedNumber,
      display_name: displayName,
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

export async function getOrCreateChat(customerId: string) {
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

export async function saveMessage(chatId: string, whatsappMessageId: string, direction: 'inbound' | 'outbound', content: string) {
  await supabase
    .from('messages')
    .insert({
      chat_id: chatId,
      whatsapp_message_id: whatsappMessageId,
      direction: direction,
      message_type: 'text',
      content: content,
      status: 'sent'
    })
}

export async function updateChatState(chatId: string, state: ConversationState, lastMessage: string) {
  await supabase
    .from('chats')
    .update({
      conversation_state: state,
      last_message_at: new Date().toISOString(),
      last_message_preview: lastMessage
    })
    .eq('id', chatId)
}

export async function getUnreviewedBites(whatsappNumber: string) {
  // Normalize phone number by removing + prefix if present
  const normalizedNumber = whatsappNumber.startsWith('+') ? whatsappNumber.substring(1) : whatsappNumber
  
  // Use the SQL function for reliable filtering
  const { data, error } = await supabase.rpc('get_unreviewed_bites', {
    whatsapp_num: normalizedNumber
  })

  if (error) {
    console.error('Error fetching unreviewed bites:', error)
    return []
  }

  // Transform the data to match expected format
  const bites = data?.map((bite: any) => ({
    id: bite.bite_id,
    order_number: bite.order_number,
    created_at: bite.created_at,
    bistros: { name: bite.bistro_name }
  })) || []

  console.log(`Found ${bites.length} unreviewed bites for ${normalizedNumber}`)
  
  return bites
}

export async function getIncompleteBites(whatsappNumber: string) {
  // Normalize phone number by removing + prefix if present
  const normalizedNumber = whatsappNumber.startsWith('+') ? whatsappNumber.substring(1) : whatsappNumber
  
  console.log(`=== QUERYING INCOMPLETE BITES ===`)
  console.log(`Input number: "${whatsappNumber}", Normalized: "${normalizedNumber}"`)
  
  // Get bites that are not completed (pending, preparing, ready, cancelled)
  const { data: bites, error } = await supabase
    .from('bites')
    .select(`
      id,
      order_number,
      status,
      created_at,
      whatsapp_number,
      bistros(name)
    `)
    .eq('whatsapp_number', normalizedNumber)
    .neq('status', 'completed')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching incomplete bites:', error)
    return []
  }

  console.log(`Found ${bites?.length || 0} incomplete bites for ${normalizedNumber}`)
  if (bites && bites.length > 0) {
    console.log('Incomplete bites details:', bites.map(b => ({
      id: b.id,
      order_number: b.order_number,
      status: b.status,
      created_at: b.created_at
    })))
  }

  return bites || []
}

export async function getRecentBitesByWhatsApp(whatsappNumber: string) {
  // Normalize phone number by removing + prefix if present
  const normalizedNumber = whatsappNumber.startsWith('+') ? whatsappNumber.substring(1) : whatsappNumber
  
  console.log(`=== QUERYING RECENT BITES ===`)
  console.log(`Input number: "${whatsappNumber}", Normalized: "${normalizedNumber}"`)
  
  // Get bites from last 12 hours
  const twelveHoursAgo = new Date()
  twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12)
  
  console.log(`Querying bites since: ${twelveHoursAgo.toISOString()}`)
  
  const { data: bites, error } = await supabase
    .from('bites')
    .select(`
      id,
      order_number,
      status,
      created_at,
      whatsapp_number,
      bistros(name)
    `)
    .eq('whatsapp_number', normalizedNumber)
    .gte('created_at', twelveHoursAgo.toISOString())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching recent bites:', error)
    return []
  }

  console.log(`Query returned ${bites?.length || 0} bites`)
  if (bites && bites.length > 0) {
    console.log('Recent bites details:', bites.map(b => ({
      id: b.id,
      order_number: b.order_number,
      whatsapp_number: b.whatsapp_number,
      status: b.status,
      created_at: b.created_at
    })))
  }

  return bites || []
}

export async function sendRecentBiteUpdates(whatsappNumber: string, recentBites: any[]) {
  if (recentBites.length === 0) return false

  // Normalize phone number by removing + prefix if present
  const normalizedNumber = whatsappNumber.startsWith('+') ? whatsappNumber.substring(1) : whatsappNumber

  let message = ''
  
  if (recentBites.length === 1) {
    const bite = recentBites[0]
    const statusEmoji = {
      'pending': '⏳',
      'preparing': '👨‍🍳', 
      'ready': '🔔',
      'completed': '🎉',
      'cancelled': '❌'
    }
    
    const orderDate = new Date(bite.created_at).toLocaleString()
    message = `👋 *Welcome back!*\n\n`
    message += `I see you have a recent order:\n\n`
    message += `${statusEmoji[bite.status] || '📋'} Order #${bite.order_number}\n`
    message += `🏪 ${bite.bistros.name}\n`
    message += `📅 ${orderDate}\n`
    message += `🔄 Status: *${bite.status.charAt(0).toUpperCase() + bite.status.slice(1)}*\n\n`
    
    if (bite.status === 'ready') {
      message += `✨ *Your order is ready for pickup!*\n\n`
    } else if (bite.status === 'preparing') {
      message += `🔥 *Your order is being prepared!*\n\n`
    } else if (bite.status === 'completed') {
      message += `🌟 *Your order was completed!* We hope you enjoyed it!\n\n`
      message += `💫 Type anything to leave feedback!\n\n`
    }
    
    message += `📱 *Powered by BeepBite.io* 🚀\n\n`
    message += `💬 Type anything to chat with me!`
  } else {
    message = `👋 *Welcome back!*\n\n`
    message += `I see you have ${recentBites.length} recent orders:\n\n`
    
    recentBites.forEach((bite, index) => {
      const statusEmoji = {
        'pending': '⏳',
        'preparing': '👨‍🍳',
        'ready': '🔔', 
        'completed': '🎉',
        'cancelled': '❌'
      }
      const orderDate = new Date(bite.created_at).toLocaleString()
      
      message += `${index + 1}. ${statusEmoji[bite.status] || '📋'} Order #${bite.order_number}\n`
      message += `   🏪 ${bite.bistros.name} - *${bite.status.charAt(0).toUpperCase() + bite.status.slice(1)}*\n`
      message += `   📅 ${orderDate}\n\n`
    })
    
    message += `📱 *Powered by BeepBite.io* 🚀\n\n`
    message += `💬 Type anything to chat with me!`
  }

  const success = await sendWhatsAppMessage(normalizedNumber, message)
  
  if (success) {
    console.log(`Recent bite updates sent to ${normalizedNumber} for ${recentBites.length} orders`)
  }
  
  return success
}

export async function sendBiteStatusMessage(biteId: string) {
  // Get bite details with customer info
  const { data: bite, error } = await supabase
    .from('bites')
    .select(`
      *,
      customers(whatsapp_number),
      bistros(name)
    `)
    .eq('id', biteId)
    .single()

  if (error || !bite) {
    console.error('Error fetching bite:', error)
    return false
  }

  let message = ''
  const bistroName = bite.bistros.name
  const orderNumber = bite.order_number

  switch (bite.status) {
    case 'pending':
      message = `⏳ *Order Received*\n\n🏪 *${bistroName}*\n📋 Order #${orderNumber}\n\n✅ Your order has been received and is being prepared!\n\n📱 *Powered by BeepBite.io*`
      break
    case 'preparing':
      message = `👨‍🍳 *Order Being Prepared*\n\n🏪 *${bistroName}*\n📋 Order #${orderNumber}\n\n🔥 Your order is now being prepared! We'll notify you when it's ready.\n\n📱 *Powered by BeepBite.io*`
      break
    case 'ready':
      message = `🔔 *Order Ready!*\n\n🏪 *${bistroName}*\n📋 Order #${orderNumber}\n\n✨ Your order is ready for pickup!\n\n📱 *Powered by BeepBite.io*`
      break
    case 'completed':
      message = `🎉 *Order Completed!*\n\n🏪 *${bistroName}*\n📋 Order #${orderNumber}\n\n🌟 Thank you for your order! We hope you enjoyed it!\n\n💫 Type anything to leave a review!\n\n📱 *Powered by BeepBite.io*`
      break
    case 'cancelled':
      message = `❌ *Order Cancelled*\n\n🏪 *${bistroName}*\n📋 Order #${orderNumber}\n\n😔 Your order has been cancelled. If you have any questions, please contact us.\n\n📱 *Powered by BeepBite.io*`
      break
    default:
      return false
  }

  // Normalize phone number by removing + prefix if present
  const normalizedNumber = bite.customers.whatsapp_number.startsWith('+') 
    ? bite.customers.whatsapp_number.substring(1) 
    : bite.customers.whatsapp_number

  const success = await sendWhatsAppMessage(normalizedNumber, message)
  
  if (success) {
    console.log(`Status message sent for bite ${biteId}: ${bite.status}`)
  }
  
  return success
}

export function formatWelcomeMessage(incompleteBites: any[], page: number = 0): string {
  if (incompleteBites.length === 0) {
    return `👋 *Welcome to BeepBite!*\n\n😊 You have no active orders at the moment.\n\n💬 *Say anything to get reviews menu*\n\n📱 *Powered by BeepBite.io*`
  }

  const totalPages = Math.ceil(incompleteBites.length / ITEMS_PER_PAGE)
  const startIndex = page * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, incompleteBites.length)
  const currentPageBites = incompleteBites.slice(startIndex, endIndex)

  let message = `👋 *Welcome to BeepBite!*\n\n📋 *Your Active Orders:*\n\n`
  
  currentPageBites.forEach((bite, index) => {
    const globalIndex = startIndex + index + 1
    const date = new Date(bite.created_at).toLocaleString()
    const statusEmoji = {
      'pending': '⏳',
      'preparing': '👨‍🍳',
      'ready': '🔔',
      'cancelled': '❌'
    }
    
    message += `*[${globalIndex}]* 📋 #${bite.order_number}\n`
    message += `      🏪 ${bite.bistros.name}\n`
    message += `      📅 ${date}\n`
    message += `      ${statusEmoji[bite.status] || '📋'} Status: *${bite.status.charAt(0).toUpperCase() + bite.status.slice(1)}*\n\n`
  })

  message += `💬 *Say anything to get reviews menu*\n\n`

  // Add pagination controls if needed
  let nextOptionNumber = endIndex + 1
  if (totalPages > 1) {
    const controls: string[] = []
    if (page > 0) {
      controls.push(`*[${nextOptionNumber}]* ◀️ Previous page`)
      nextOptionNumber++
    }
    if (page < totalPages - 1) {
      controls.push(`*[${nextOptionNumber}]* ▶️ Next page`)
      nextOptionNumber++
    }
    
    if (controls.length > 0) {
      message += controls.join('\n') + '\n\n'
    }
    
    message += `📄 Page ${page + 1} of ${totalPages}\n\n`
  }

  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatBitesForReview(bites: any[], page: number = 0): string {
  const totalPages = Math.ceil(bites.length / ITEMS_PER_PAGE)
  const startIndex = page * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, bites.length)
  const currentPageBites = bites.slice(startIndex, endIndex)

  let message = `🍽️ *Orders to Review:*\n\n`
  
  currentPageBites.forEach((bite, index) => {
    const globalIndex = startIndex + index + 1
    const date = new Date(bite.created_at).toLocaleString()
    const timeRemaining = getTimeRemaining(bite.created_at)
    message += `*[${globalIndex}]* 📋 #${bite.order_number}\n`
    message += `        🏪 ${bite.bistros.name}\n`
    message += `        📅 ${date}\n`
    message += `        ${timeRemaining}\n\n`
  })

  message += `✨ *Select a number to review*\n\n`

  // Add pagination controls if needed
  let nextOptionNumber = endIndex + 1
  if (totalPages > 1) {
    const controls: string[] = []
    if (page > 0) {
      controls.push(`*[${nextOptionNumber}]* ◀️ Previous page`)
      nextOptionNumber++
    }
    if (page < totalPages - 1) {
      controls.push(`*[${nextOptionNumber}]* ▶️ Next page`)
      nextOptionNumber++
    }
    controls.push(`*[${nextOptionNumber}]* 🏠 Main menu`)
    
    message += controls.join('\n') + '\n\n'
    message += `📄 Page ${page + 1} of ${totalPages}\n\n`
  } else {
    message += `*[${endIndex + 1}]* 🏠 Main menu\n\n`
  }

  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatRatingRequest(): string {
  return `⭐ *Rate Your Experience*\n\nPlease rate from 1 to 10:\n\n😞 1-3 = Poor\n😐 4-7 = Average\n😊 8-10 = Excellent\n\n✨ *Select a number from 1 to 10*\n\n*[11]* 🏠 Main menu\n\n📱 *Powered by BeepBite.io*`
}

export function formatCommentRequest(rating: number): string {
  const emoji = rating >= 8 ? '😊' : rating >= 6 ? '😐' : '😞'
  
  return `💬 *Share Your Experience*\n\nThank you for the ${rating}/10 rating! ${emoji}\n\n✍️ *Select an option:*\n\n*[1]* 💬 Write a comment\n*[2]* ⏭️ Skip this step\n*[3]* 🏠 Main menu\n\n📱 *Powered by BeepBite.io*`
}

export function formatCommentWriteRequest(rating: number): string {
  const emoji = rating >= 8 ? '😊' : rating >= 6 ? '😐' : '😞'
  
  return `💬 *Write Your Comment*\n\nRating: ${rating}/10 ${emoji}\n\n✍️ *Type your comment below:*\n\n*[1]* ⏭️ Skip this step\n*[2]* 🏠 Main menu\n\n📱 *Powered by BeepBite.io*`
}

export function formatAnonSelectionMessage(rating: number, comment?: string): string {
  const emoji = rating >= 8 ? '😊' : rating >= 6 ? '😐' : '😞'
  
  let message = `✅ *Review Submitted!*\n\nRating: ${rating}/10 ${emoji}\n`
  
  if (comment && comment !== '2') {
    message += `Comment: "${comment}"\n`
  }
  
  message += `\n🔒 *Privacy Setting*\n\n*Would you like to share your WhatsApp name with this review?*\n\n*[1]* ✅ Yes - Share my name (default)\n*[2]* 🚫 No - Keep me anonymous\n*[3]* 🏠 Main menu\n\n📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatThankYouMessage(rating: number, comment?: string, isAnon?: boolean, outstandingReviews?: any[]): string {
  const emoji = rating >= 8 ? '🎉' : rating >= 6 ? '👍' : '💪'
  
  let message = `${emoji} *Thank You!*\n\n*Rating: ${rating}/10*\n`
  
  if (comment && comment !== '2') {
    message += `*Comment: "${comment}"*\n`
  }
  
  if (isAnon) {
    message += `🕵️ Anonymous: Yes\n`
  }
  
  message += `\n🙏 Your feedback helps us improve!\n\n`
  
  // Show outstanding reviews if any
  if (outstandingReviews && outstandingReviews.length > 0) {
    message += `📋 *You still have ${outstandingReviews.length} more review${outstandingReviews.length > 1 ? 's' : ''} to complete:*\n\n`
    
    outstandingReviews.slice(0, 3).forEach((bite, index) => {
      const date = new Date(bite.created_at).toLocaleString()
      const timeRemaining = getTimeRemaining(bite.created_at)
      message += `• 📋 #${bite.order_number} - ${bite.bistros.name}\n`
      message += `  📅 ${date} | ${timeRemaining}\n`
    })
    
    if (outstandingReviews.length > 3) {
      message += `• ... and ${outstandingReviews.length - 3} more\n`
    }
    
    message += `\n✨ *Keep the reviews coming!*\n\n`
  }
  
  message += `💬 *Type anything to continue reviewing*\n\n📱 *Powered by BeepBite.io*`
  
  return message
}

export async function saveReview(biteId: string, rating: number, comment?: string, isAnon?: boolean) {
  // Use upsert to handle both insert and update cases
  const { error } = await supabase
    .from('reviews')
    .upsert({
      bite_id: biteId,
      rating: rating,
      comment: comment && comment !== '2' ? comment : null,
      anon: isAnon || false
    }, {
      onConflict: 'bite_id'
    })

  if (error) {
    console.error('Error saving/updating review:', error)
    return false
  }

  console.log(`Review saved/updated for bite ${biteId}: ${rating}/10 rating, anonymous: ${isAnon}`)
  return true
}

export async function sendConsentConfirmation(whatsappNumber: string, connectedBite: any, chatId: string) {
  // Get all incomplete bites for comprehensive overview
  const incompleteBites = await getIncompleteBites(whatsappNumber)
  
  // Get unreviewed bites
  const unreviewedBites = await getUnreviewedBites(whatsappNumber)
  
  let message = `✅ *Connected Successfully!*\n\n`
  message += `🔗 You've been connected to order:\n`
  message += `📋 #${connectedBite.order_number}\n`
  message += `🏪 ${connectedBite.bistros.name}\n`
  message += `📅 ${new Date(connectedBite.created_at).toLocaleString()}\n`
  
  const statusEmoji = {
    'pending': '⏳',
    'preparing': '👨‍🍳',
    'ready': '🔔',
    'completed': '🎉',
    'cancelled': '❌'
  }
  message += `${statusEmoji[connectedBite.status] || '📋'} Status: *${connectedBite.status.charAt(0).toUpperCase() + connectedBite.status.slice(1)}*\n\n`
  
  // Show active orders if any
  if (incompleteBites.length > 0) {
    message += `📋 *Your Active Orders (${incompleteBites.length}):*\n\n`
    
    incompleteBites.slice(0, 5).forEach((bite, index) => {
      const date = new Date(bite.created_at).toLocaleString()
      message += `*[${index + 1}]* 📋 #${bite.order_number}\n`
      message += `        🏪 ${bite.bistros.name}\n`
      message += `        📅 ${date}\n`
      message += `        ${statusEmoji[bite.status] || '📋'} Status: *${bite.status.charAt(0).toUpperCase() + bite.status.slice(1)}*\n\n`
    })
    
    if (incompleteBites.length > 5) {
      message += `        ... and ${incompleteBites.length - 5} more active orders\n\n`
    }
  }
  
  // Show orders to review if any
  if (unreviewedBites.length > 0) {
    message += `⭐ *Orders to Review (${unreviewedBites.length}):*\n\n`
    
    unreviewedBites.slice(0, 3).forEach((bite, index) => {
      const date = new Date(bite.created_at).toLocaleString()
      const timeRemaining = getTimeRemaining(bite.created_at)
      message += `• 📋 #${bite.order_number} - ${bite.bistros.name}\n`
      message += `  📅 ${date} | ${timeRemaining}\n`
    })
    
    if (unreviewedBites.length > 3) {
      message += `• ... and ${unreviewedBites.length - 3} more to review\n`
    }
    
    message += `\n💫 *Type anything to start reviewing!*\n\n`
  } else {
    message += `💬 *Type anything to chat with me!*\n\n`
  }
  
  message += `📱 *Powered by BeepBite.io* 🚀`
  
  // Send the message
  const success = await sendWhatsAppMessage(whatsappNumber, message)
  
  if (success) {
    // Save outbound message
    await saveMessage(chatId, '', 'outbound', message)
    
    // Update chat state to welcome with comprehensive info shown
    await updateChatState(chatId, { step: 'welcome' }, 'Consent confirmation sent')
  }
  
  return success
}

// Export types and constants that might be needed
export { ConversationState, SYSTEM_BOT_ID } 