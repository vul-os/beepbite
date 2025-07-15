import { ConversationState, updateConversationState } from './conversation_state.ts'
import { getOrCreateCustomer, getCartItems, getCartSummary, getCustomerAddresses, getActiveOrdersCount, getCustomerProfile, getCustomerPaymentMethods } from './database_helpers.ts'
import { formatMainMenu, formatOrderTypeSelection, formatNewOrderWarning, formatCartView, formatError, formatAddressManagement, formatProfileView, formatBillingManagement } from './message_formatter.ts'
import { handleReviewFlow } from './review_system.ts'

export async function handleMainMenu(
  chatId: string,
  customerId: string,
  messageBody: string,
  state: ConversationState
): Promise<string> {
  const input = messageBody.trim().toLowerCase()
  
  // Check for existing cart across all locations
  let existingCartLocation = null
  let cartItems: any[] = []
  
  // Find any existing cart (check all possible locations or use a general query)
  const allCartItems = await getAllCartItemsForCustomer(customerId)
  if (allCartItems.length > 0) {
    existingCartLocation = allCartItems[0].location_id
    cartItems = allCartItems
  }
  
  const cartCount = cartItems.length
  
  // Get active orders count
  const activeOrderCount = await getActiveOrdersCount(customerId)
  
  // Get location name for cart display
  let cartLocationName = ''
  if (existingCartLocation) {
    const locationInfo = await getLocationInfo(existingCartLocation)
    cartLocationName = locationInfo?.name || ''
  }
  
  // Handle different menu options
  switch (input) {
    case '1':
      // Continue with existing cart (only if cart exists)
      if (cartCount > 0) {
        const cartSummary = await getCartSummary(customerId, existingCartLocation!)
        await updateConversationState(chatId, {
          ...state,
          step: 'cart_view',
          selected_location_id: existingCartLocation,
          previous_step: 'main_menu'
        })
        return formatCartView(cartItems, cartSummary)
      } else {
        return formatMainMenu(undefined, cartCount, activeOrderCount, cartLocationName)
      }
      
    case 'a':
    case 'make order':
    case 'order':
    case 'make new order':
      // Check if there's an existing cart
      if (cartCount > 0) {
        await updateConversationState(chatId, {
          ...state,
          step: 'new_order_warning',
          previous_step: 'main_menu'
        })
        return formatNewOrderWarning(cartCount, cartLocationName)
      } else {
        await updateConversationState(chatId, {
          ...state,
          step: 'order_type',
          previous_step: 'main_menu'
        })
        return formatOrderTypeSelection()
      }
      
    case 'b':
    case 'previous orders':
    case 'orders':
      // Handle previous orders view
      return await handlePreviousOrders(chatId, customerId, state)
      
    case 'c':
    case 'profile':
    case 'my profile':
      // Handle profile view
      return await handleProfile(chatId, customerId, state)
      
    case 'd':
    case 'billing':
      // Handle billing view
      return await handleBilling(chatId, customerId, state)
      
    case 'e':
    case 'addresses':
      // Handle addresses view
      return await handleAddresses(chatId, customerId, state)
      
    default:
      // Check if it's a number for review flow compatibility
      const selectedNumber = parseInt(input)
      if (!isNaN(selectedNumber)) {
        // Try to handle as review flow
        return await handleReviewFlow(chatId, customerId, messageBody, state)
      }
      
      // Default: show main menu
      return formatMainMenu(undefined, cartCount, activeOrderCount, cartLocationName)
  }
}

export async function handleNewOrderWarning(
  chatId: string,
  customerId: string,
  messageBody: string,
  state: ConversationState
): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  // Get existing cart info
  const allCartItems = await getAllCartItemsForCustomer(customerId)
  const cartCount = allCartItems.length
  const existingCartLocation = allCartItems.length > 0 ? allCartItems[0].location_id : null
  
  // Get location name for display
  let cartLocationName = ''
  if (existingCartLocation) {
    const locationInfo = await getLocationInfo(existingCartLocation)
    cartLocationName = locationInfo?.name || ''
  }
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Continue with current plate
        if (existingCartLocation) {
          const cartSummary = await getCartSummary(customerId, existingCartLocation)
          await updateConversationState(chatId, {
            ...state,
            step: 'cart_view',
            selected_location_id: existingCartLocation,
            previous_step: 'new_order_warning'
          })
          return formatCartView(allCartItems, cartSummary)
        } else {
          return formatMainMenu(undefined, 0, 0)
        }
        
      case 2: // Delete plate & make new order
        if (existingCartLocation) {
          // Clear the existing cart
          await clearCustomerCart(customerId, existingCartLocation)
        }
        await updateConversationState(chatId, {
          ...state,
          step: 'order_type',
          previous_step: 'new_order_warning'
        })
        return formatOrderTypeSelection()
        
      case 3: // View current plate
        if (existingCartLocation) {
          const cartSummary = await getCartSummary(customerId, existingCartLocation)
          // Don't change step, just show cart then return to warning
          return formatCartView(allCartItems, cartSummary) + '\n\n' + formatNewOrderWarning(cartCount, cartLocationName)
        } else {
          return formatMainMenu(undefined, 0, 0)
        }
        
      case 4: // Back to main menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'new_order_warning'
        })
        return formatMainMenu(undefined, cartCount, 0, cartLocationName)
        
      default:
        return formatError('Please select option 1, 2, 3, or 4')
    }
  }
  
  return formatError('Please select a valid option (1-4)')
}

async function getAllCartItemsForCustomer(customerId: string) {
  // This is a simplified version - in the actual implementation you'd query all cart items
  // regardless of location to find any existing cart
  const { data: cartItems, error } = await import('./database_helpers.ts')
    .then(module => module.getCartItems(customerId, '')) // Empty location to get all
    .catch(() => [])
  
  return cartItems || []
}

async function getLocationInfo(locationId: string) {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2")
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    const { data: location, error } = await supabase
      .from('locations')
      .select('id, name')
      .eq('id', locationId)
      .single()
      
    if (error) {
      console.error('Error getting location info:', error)
      return null
    }
    
    return location
  } catch (error) {
    console.error('Error in getLocationInfo:', error)
    return null
  }
}

async function clearCustomerCart(customerId: string, locationId: string) {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2")
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('customer_id', customerId)
      .eq('location_id', locationId)
      
    if (error) {
      console.error('Error clearing cart:', error)
      return false
    }
    
    return true
  } catch (error) {
    console.error('Error in clearCustomerCart:', error)
    return false
  }
}

async function handlePreviousOrders(chatId: string, customerId: string, state: ConversationState): Promise<string> {
  // TODO: Implement previous orders view
  // For now, redirect to review flow for compatibility
  return await handleReviewFlow(chatId, customerId, 'previous orders', state)
}

async function handleProfile(chatId: string, customerId: string, state: ConversationState): Promise<string> {
  const profile = await getCustomerProfile(customerId)
  if (!profile) {
    return formatError('Unable to load profile. Please try again.')
  }
  
  await updateConversationState(chatId, {
    ...state,
    step: 'profile_view',
    previous_step: 'main_menu'
  })
  return formatProfileView(profile)
}

async function handleBilling(chatId: string, customerId: string, state: ConversationState): Promise<string> {
  const paymentMethods = await getCustomerPaymentMethods(customerId)
  
  await updateConversationState(chatId, {
    ...state,
    step: 'billing_list',
    previous_step: 'main_menu'
  })
  return formatBillingManagement(paymentMethods)
}

async function handleAddresses(chatId: string, customerId: string, state: ConversationState): Promise<string> {
  const addresses = await getCustomerAddresses(customerId)
  
  await updateConversationState(chatId, {
    ...state,
    step: 'address_list',
    previous_step: 'main_menu'
  })
  
  return formatAddressManagement(addresses)
} 