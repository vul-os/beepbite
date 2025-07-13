import { ConversationState, updateConversationState } from './conversation_state.ts'
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const ITEMS_PER_PAGE = 5
const REVIEW_WINDOW_HOURS = 168 // 7 days (7 * 24 hours)

export async function handleReviewFlow(
  chatId: string,
  customerId: string,
  messageBody: string,
  state: ConversationState
): Promise<string> {
  // Get current whatsapp number for review functions
  const { data: customer } = await supabase
    .from('customers')
    .select('whatsapp_number')
    .eq('id', customerId)
    .single()
    
  const whatsappNumber = customer?.whatsapp_number || ''
  
  // Handle different review flow steps
  switch (state.step) {
    case 'main_menu':
      return await handleMainMenuReview(chatId, whatsappNumber, messageBody, state)
      
    case 'review_selection':
      return await handleReviewSelection(chatId, whatsappNumber, messageBody, state)
      
    case 'rating':
      return await handleRatingSelection(chatId, whatsappNumber, messageBody, state)
      
    case 'comment':
      return await handleCommentSelection(chatId, whatsappNumber, messageBody, state)
      
    case 'comment_write':
      return await handleCommentWrite(chatId, whatsappNumber, messageBody, state)
      
    case 'anon_selection':
      return await handleAnonSelection(chatId, whatsappNumber, messageBody, state)
      
    case 'completed':
      return await handleCompleted(chatId, whatsappNumber, messageBody, state)
      
    default:
      // Default to showing reviews if available
      return await handleMainMenuReview(chatId, whatsappNumber, messageBody, state)
  }
}

async function handleMainMenuReview(chatId: string, whatsappNumber: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  // Get incomplete orders (for status display)
  const incompleteBites = await getIncompleteBites(whatsappNumber)
  const currentPage = state.review_page || 0
  const totalPages = Math.ceil(incompleteBites.length / ITEMS_PER_PAGE)
  const startIndex = currentPage * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, incompleteBites.length)
  
  if (!isNaN(selectedNumber)) {
    // Check if it's pagination
    let optionNumber = endIndex + 1
    let handled = false
    
    // Previous page option
    if (currentPage > 0 && selectedNumber === optionNumber) {
      const prevPage = currentPage - 1
      const responseMessage = formatWelcomeMessage(incompleteBites, prevPage)
      await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: prevPage })
      return responseMessage
    } else if (currentPage > 0) {
      optionNumber++
    }
    
    // Next page option
    if (!handled && currentPage < totalPages - 1 && selectedNumber === optionNumber) {
      const nextPage = currentPage + 1
      const responseMessage = formatWelcomeMessage(incompleteBites, nextPage)
      await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: nextPage })
      return responseMessage
    }
    
    // If not handled, show default welcome
    if (!handled) {
      const responseMessage = formatWelcomeMessage(incompleteBites, currentPage)
      await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: currentPage })
      return responseMessage
    }
  } else {
    // Any non-number input shows reviews menu
    const unreviewedBites = await getUnreviewedBites(whatsappNumber)
    if (unreviewedBites.length === 0) {
      const responseMessage = formatWelcomeMessage(incompleteBites, 0)
      await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: 0 })
      return responseMessage
    } else {
      const responseMessage = formatBitesForReview(unreviewedBites, 0)
      await updateConversationState(chatId, { ...state, step: 'review_selection', review_page: 0 })
      return responseMessage
    }
  }
  
  // Default fallback
  const responseMessage = formatWelcomeMessage(incompleteBites, 0)
  await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: 0 })
  return responseMessage
}

async function handleReviewSelection(chatId: string, whatsappNumber: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  const unreviewedBites = await getUnreviewedBites(whatsappNumber)
  const currentPage = state.review_page || 0
  const totalPages = Math.ceil(unreviewedBites.length / ITEMS_PER_PAGE)
  const startIndex = currentPage * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, unreviewedBites.length)
  
  if (!isNaN(selectedNumber)) {
    // Check if it's a bite selection
    if (selectedNumber >= 1 && selectedNumber <= unreviewedBites.length) {
      const selectedBite = unreviewedBites[selectedNumber - 1]
      const responseMessage = formatRatingRequest()
      await updateConversationState(chatId, { ...state, step: 'rating', selected_bite_id: selectedBite.id })
      return responseMessage
    }
    // Handle pagination and navigation...
  }
  
  // Default error handling
  const responseMessage = `❌ *Invalid Selection*\n\nPlease select a valid number.\n\n${formatBitesForReview(unreviewedBites, currentPage)}`
  return responseMessage
}

async function handleRatingSelection(chatId: string, whatsappNumber: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    if (selectedNumber >= 1 && selectedNumber <= 10) {
      const responseMessage = formatCommentWriteRequest(selectedNumber)
      await updateConversationState(chatId, { ...state, step: 'comment_write', rating: selectedNumber })
      return responseMessage
    } else if (selectedNumber === 11) {
      const incompleteBites = await getIncompleteBites(whatsappNumber)
      const responseMessage = formatWelcomeMessage(incompleteBites, 0)
      await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: 0 })
      return responseMessage
    }
  }
  
  const responseMessage = `❌ *Invalid Rating*\n\nPlease select a number from 1 to 10, or 11 for main menu.\n\n${formatRatingRequest()}`
  return responseMessage
}

async function handleCommentSelection(chatId: string, whatsappNumber: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    if (selectedNumber === 1) {
      const responseMessage = formatCommentWriteRequest(state.rating!)
      await updateConversationState(chatId, { ...state, step: 'comment_write' })
      return responseMessage
    } else if (selectedNumber === 2) {
      const responseMessage = formatAnonSelectionMessage(state.rating!, '2')
      await updateConversationState(chatId, { ...state, step: 'anon_selection', comment: '2' })
      return responseMessage
    } else if (selectedNumber === 3) {
      const incompleteBites = await getIncompleteBites(whatsappNumber)
      const responseMessage = formatWelcomeMessage(incompleteBites, 0)
      await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: 0 })
      return responseMessage
    }
  }
  
  const responseMessage = `❌ *Invalid Selection*\n\nPlease select an option:\n\n${formatCommentRequest(state.rating!)}`
  return responseMessage
}

async function handleCommentWrite(chatId: string, whatsappNumber: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    if (selectedNumber === 1) {
      const responseMessage = formatAnonSelectionMessage(state.rating!, '2')
      await updateConversationState(chatId, { ...state, step: 'anon_selection', comment: '2' })
      return responseMessage
    } else if (selectedNumber === 2) {
      const incompleteBites = await getIncompleteBites(whatsappNumber)
      const responseMessage = formatWelcomeMessage(incompleteBites, 0)
      await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: 0 })
      return responseMessage
    }
  } else {
    // It's a text comment
    const comment = messageBody.trim()
    const responseMessage = formatAnonSelectionMessage(state.rating!, comment)
    await updateConversationState(chatId, { ...state, step: 'anon_selection', comment: comment })
    return responseMessage
  }
  
  const responseMessage = `❌ *Invalid Selection*\n\nPlease type your comment or select an option:\n\n${formatCommentWriteRequest(state.rating!)}`
  return responseMessage
}

async function handleAnonSelection(chatId: string, whatsappNumber: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    if (selectedNumber === 1) {
      const reviewSaved = await saveReview(state.selected_bite_id!, state.rating!, state.comment!, false)
      if (reviewSaved) {
        const allUnreviewedBites = await getUnreviewedBites(whatsappNumber)
        const outstandingReviews = allUnreviewedBites.filter(bite => bite.id !== state.selected_bite_id)
        const responseMessage = formatThankYouMessage(state.rating!, state.comment!, false, outstandingReviews)
        await updateConversationState(chatId, { ...state, step: 'completed' })
        return responseMessage
      }
    } else if (selectedNumber === 2) {
      const reviewSaved = await saveReview(state.selected_bite_id!, state.rating!, state.comment!, true)
      if (reviewSaved) {
        const allUnreviewedBites = await getUnreviewedBites(whatsappNumber)
        const outstandingReviews = allUnreviewedBites.filter(bite => bite.id !== state.selected_bite_id)
        const responseMessage = formatThankYouMessage(state.rating!, state.comment!, true, outstandingReviews)
        await updateConversationState(chatId, { ...state, step: 'completed' })
        return responseMessage
      }
    }
  }
  
  const responseMessage = `❌ *Invalid Selection*\n\nPlease select an option:\n\n${formatAnonSelectionMessage(state.rating!, state.comment!)}`
  return responseMessage
}

async function handleCompleted(chatId: string, whatsappNumber: string, messageBody: string, state: ConversationState): Promise<string> {
  const unreviewedBites = await getUnreviewedBites(whatsappNumber)
  if (unreviewedBites.length === 0) {
    const incompleteBites = await getIncompleteBites(whatsappNumber)
    const responseMessage = formatWelcomeMessage(incompleteBites, 0)
    await updateConversationState(chatId, { ...state, step: 'main_menu', review_page: 0 })
    return responseMessage
  } else {
    const responseMessage = formatBitesForReview(unreviewedBites, 0)
    await updateConversationState(chatId, { ...state, step: 'review_selection', review_page: 0 })
    return responseMessage
  }
}

// Database functions for reviews
export async function getIncompleteBites(whatsappNumber: string) {
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
    .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'])
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error fetching incomplete bites:', error)
    return []
  }

  return bites || []
}

export async function getUnreviewedBites(whatsappNumber: string) {
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
    .eq('status', 'completed')
    .is('reviews.id', null) // No review exists
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error fetching unreviewed bites:', error)
    return []
  }

  return bites || []
}

export async function saveReview(biteId: string, rating: number, comment?: string, isAnon?: boolean) {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .insert({
        order_id: biteId,
        rating: rating,
        comment: comment || null,
        // TODO: Add anonymous flag to reviews table if needed
        created_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving review:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error in saveReview:', error)
    return false
  }
}

// Message formatting functions
export function formatWelcomeMessage(incompleteBites: any[], page: number = 0): string {
  const startIndex = page * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, incompleteBites.length)
  const totalPages = Math.ceil(incompleteBites.length / ITEMS_PER_PAGE)
  
  let message = `🍽️ *Welcome to BeepBite!*\n\n`
  
  if (incompleteBites.length === 0) {
    message += `You don't have any active orders at the moment.\n\n`
    message += `*[1]* 🔄 Check for reviews\n`
    message += `*[2]* 🏠 Main menu\n\n`
  } else {
    message += `*Your Active Orders* (${incompleteBites.length}):\n\n`
    
    const currentPageBites = incompleteBites.slice(startIndex, endIndex)
    currentPageBites.forEach((bite, index) => {
      const globalIndex = startIndex + index + 1
      const timeAgo = getTimeRemaining(bite.created_at)
      message += `*${globalIndex}.* ${bite.locations?.name || 'Restaurant'}\n`
      message += `   Order #${bite.order_number}\n`
      message += `   Status: ${bite.status}\n`
      message += `   ${timeAgo}\n\n`
    })
    
    // Navigation options
    let optionNumber = endIndex + 1
    
    if (page > 0) {
      message += `*[${optionNumber}]* ⬅️ Previous page\n`
      optionNumber++
    }
    
    if (page < totalPages - 1) {
      message += `*[${optionNumber}]* ➡️ Next page\n`
      optionNumber++
    }
    
    message += `*[${optionNumber}]* 🔄 Check for reviews\n`
    message += `\n`
  }
  
  message += `📱 *Powered by BeepBite.io*`
  return message
}

export function formatBitesForReview(bites: any[], page: number = 0): string {
  const startIndex = page * ITEMS_PER_PAGE
  const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, bites.length)
  const totalPages = Math.ceil(bites.length / ITEMS_PER_PAGE)
  
  let message = `⭐ *Rate Your Experience*\n\n`
  
  if (bites.length === 0) {
    message += `All caught up! No orders to review.\n\n`
    message += `*[1]* 🏠 Main menu\n\n`
  } else {
    message += `Please rate these completed orders:\n\n`
    
    bites.forEach((bite, index) => {
      message += `*[${index + 1}]* ${bite.locations?.name || 'Restaurant'}\n`
      message += `   Order #${bite.order_number}\n`
      message += `   ${getTimeRemaining(bite.created_at)}\n\n`
    })
    
    // Navigation options
    let optionNumber = endIndex + 1
    
    if (page > 0) {
      message += `*[${optionNumber}]* ⬅️ Previous page\n`
      optionNumber++
    }
    
    if (page < totalPages - 1) {
      message += `*[${optionNumber}]* ➡️ Next page\n`
      optionNumber++
    }
    
    message += `*[${optionNumber}]* 🏠 Main menu\n`
    message += `\n`
  }
  
  message += `📱 *Powered by BeepBite.io*`
  return message
}

export function formatRatingRequest(): string {
  let message = `⭐ *Rate Your Experience*\n\n`
  message += `How would you rate this order?\n\n`
  
  for (let i = 1; i <= 10; i++) {
    const emoji = i <= 5 ? '😞' : i <= 7 ? '😐' : i <= 8 ? '😊' : '🤩'
    message += `*[${i}]* ${emoji} ${i}/10\n`
  }
  
  message += `\n*[11]* 🏠 Main menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatCommentRequest(rating: number): string {
  let message = `💬 *Share Your Thoughts*\n\n`
  message += `Your rating: ${rating}/10 ⭐\n\n`
  message += `Would you like to add a comment?\n\n`
  message += `*[1]* ✍️ Write a comment\n`
  message += `*[2]* ⏭️ Skip comment\n`
  message += `*[3]* 🏠 Main menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatCommentWriteRequest(rating: number): string {
  let message = `✍️ *Write Your Comment*\n\n`
  message += `Your rating: ${rating}/10 ⭐\n\n`
  message += `Please type your comment about this order:\n\n`
  message += `*[1]* ⏭️ Skip comment\n`
  message += `*[2]* 🏠 Main menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatAnonSelectionMessage(rating: number, comment?: string): string {
  let message = `🔒 *Privacy Settings*\n\n`
  message += `Your rating: ${rating}/10 ⭐\n`
  
  if (comment && comment !== '2') {
    message += `Your comment: "${comment}"\n`
  }
  
  message += `\nWould you like your name shown with this review?\n\n`
  message += `*[1]* ✅ Yes - Share my name (default)\n`
  message += `*[2]* 🚫 No - Keep me anonymous\n`
  message += `*[3]* 🏠 Main menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatThankYouMessage(rating: number, comment?: string, isAnon?: boolean, outstandingReviews?: any[]): string {
  let message = `🙏 *Thank You!*\n\n`
  message += `Your review has been saved.\n\n`
  message += `Rating: ${rating}/10 ⭐\n`
  
  if (comment && comment !== '2') {
    message += `Comment: "${comment}"\n`
  }
  
  if (isAnon) {
    message += `Privacy: Anonymous\n`
  } else {
    message += `Privacy: Name will be shown\n`
  }
  
  if (outstandingReviews && outstandingReviews.length > 0) {
    message += `\n📝 You have ${outstandingReviews.length} more order${outstandingReviews.length > 1 ? 's' : ''} to review.\n`
    message += `*[1]* ⭐ Review more orders\n`
    message += `*[2]* 🏠 Main menu\n`
  } else {
    message += `\n*[1]* 🏠 Main menu\n`
  }
  
  message += `\n📱 *Powered by BeepBite.io*`
  return message
}

export function getTimeRemaining(createdAt: string): string {
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