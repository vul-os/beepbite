import { ConversationState, updateConversationState } from './conversation_state.ts'
import { 
  getCustomerAddresses, 
  getNearbyStores, 
  getStoresBySearch, 
  getStoreMenu, 
  getMenuItem,
  addToCart,
  getCartItems,
  getCartSummary,
  clearCart,
  getCustomerPaymentMethods,
  getStoreInfo,
  createOrder
} from './database_helpers.ts'
import { 
  formatOrderTypeSelection,
  formatAddressSelection,
  formatNewAddressPrompt,
  formatStoreSelection,
  formatStoreSearchPrompt,
  formatMenuCategories,
  formatCategoryItems,
  formatItemDetails,
  formatItemCustomization,
  formatCustomizationSummary,
  formatCartView,
  formatCheckout,
  formatTipSelection,
  formatEmailCollection,
  formatPaymentMethods,
  formatPaymentLink,
  formatOrderConfirmation,
  formatMainMenu,
  formatError
} from './message_formatter.ts'
import { geocodeAddress } from '../../utility/mapbox.ts'
import { processOrderPayment } from '../../utility/paystack.ts'

export async function handleOrdering(
  chatId: string,
  customerId: string,
  messageBody: string,
  state: ConversationState
): Promise<string> {
  switch (state.step) {
    case 'order_type':
      return await handleOrderType(chatId, customerId, messageBody, state)
      
    case 'address_selection':
      return await handleAddressSelection(chatId, customerId, messageBody, state)
      
    case 'new_address':
      return await handleNewAddress(chatId, customerId, messageBody, state)
      
    case 'store_selection':
      return await handleStoreSelection(chatId, customerId, messageBody, state)
      
    case 'store_search':
      return await handleStoreSearch(chatId, customerId, messageBody, state)
      
    case 'menu_display':
      return await handleMenuDisplay(chatId, customerId, messageBody, state)
      
    case 'category_items':
      return await handleCategoryItems(chatId, customerId, messageBody, state)
      
    case 'item_details':
      return await handleItemDetails(chatId, customerId, messageBody, state)
      
    case 'item_customization':
      return await handleItemCustomization(chatId, customerId, messageBody, state)
      
    case 'cart_view':
      return await handleCartView(chatId, customerId, messageBody, state)
      
    case 'checkout':
      return await handleCheckout(chatId, customerId, messageBody, state)
      
    case 'tip_selection':
      return await handleTipSelection(chatId, customerId, messageBody, state)
      
    case 'email_collection':
      return await handleEmailCollection(chatId, customerId, messageBody, state)
      
    case 'payment_method':
      return await handlePaymentMethod(chatId, customerId, messageBody, state)
      
    case 'payment':
      return await handlePayment(chatId, customerId, messageBody, state)
      
    default:
      return formatError('Invalid ordering step')
  }
}

async function handleOrderType(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Delivery
        const addresses = await getCustomerAddresses(customerId)
        await updateConversationState(chatId, {
          ...state,
          step: 'address_selection',
          delivery_type: 'delivery',
          previous_step: 'order_type'
        })
        return formatAddressSelection(addresses)
        
      case 2: // Collection
        await updateConversationState(chatId, {
          ...state,
          step: 'store_selection',
          delivery_type: 'collection',
          previous_step: 'order_type'
        })
        return formatStoreSearchPrompt()
        
      case 3: // Back to main menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'order_type'
        })
        return formatMainMenu()
        
      default:
        return formatError('Please select 1 for Delivery, 2 for Collection, or 3 for Main Menu')
    }
  }
  
  return formatError('Please select a valid option (1-3)')
}

async function handleAddressSelection(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  const addresses = await getCustomerAddresses(customerId)
  
  if (!isNaN(selectedNumber)) {
    if (selectedNumber >= 1 && selectedNumber <= addresses.length) {
      // Selected existing address
      const selectedAddress = addresses[selectedNumber - 1]
      
      // Find nearby stores
      const nearbyStores = await getNearbyStores(
        parseFloat(selectedAddress.latitude),
        parseFloat(selectedAddress.longitude)
      )
      
      await updateConversationState(chatId, {
        ...state,
        step: 'store_selection',
        selected_address_id: selectedAddress.id,
        previous_step: 'address_selection'
      })
      
      return formatStoreSelection(nearbyStores, true)
      
    } else if (selectedNumber === addresses.length + 1) {
      // Add new address
      await updateConversationState(chatId, {
        ...state,
        step: 'new_address',
        previous_step: 'address_selection'
      })
      return formatNewAddressPrompt()
      
    } else if (selectedNumber === addresses.length + 2) {
      // Back to main menu
      await updateConversationState(chatId, {
        ...state,
        step: 'main_menu',
        previous_step: 'address_selection'
      })
      return formatMainMenu()
    }
  }
  
  return formatError('Please select a valid address option')
}

async function handleNewAddress(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const input = messageBody.trim()
  const selectedNumber = parseInt(input)
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Back to address selection
        const addresses = await getCustomerAddresses(customerId)
        await updateConversationState(chatId, {
          ...state,
          step: 'address_selection',
          previous_step: 'new_address'
        })
        return formatAddressSelection(addresses)
        
      case 2: // Back to main menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'new_address'
        })
        return formatMainMenu()
        
      default:
        return formatError('Please share your location or type your address')
    }
  }
  
  // Check if this is a location message
  if (input.startsWith('LOCATION:')) {
    const locationData = input.substring(9) // Remove 'LOCATION:' prefix
    const locationParts = locationData.split(':')
    
    let latitude, longitude, name, address
    
    if (locationParts.length === 1) {
      // Format: LOCATION:lat,lng
      const coords = locationParts[0].split(',')
      latitude = parseFloat(coords[0])
      longitude = parseFloat(coords[1])
      name = undefined
      address = undefined
    } else {
      // Format: LOCATION:lat:lng:name:address (legacy format)
      const [latStr, lngStr, nameStr, addressStr] = locationParts
      latitude = parseFloat(latStr)
      longitude = parseFloat(lngStr)
      name = nameStr
      address = addressStr
    }
    
    if (!isNaN(latitude) && !isNaN(longitude)) {
      console.log('Location parsed successfully:', { latitude, longitude, name, address })
      
      // Use the shared location coordinates
      const nearbyStores = await getNearbyStores(latitude, longitude)
      
      await updateConversationState(chatId, {
        ...state,
        step: 'store_selection',
        temp_address_data: {
          address_line_1: address || name || `${latitude}, ${longitude}`,
          coordinates: { latitude, longitude }
        },
        previous_step: 'new_address'
      })
      
      return formatStoreSelection(nearbyStores, true)
    } else {
      console.error('Failed to parse location coordinates:', { latitude, longitude, locationData })
    }
  }
  
  // Try to geocode the address text (only if it's not a location message)
  if (input.startsWith('LOCATION:')) {
    console.error('Location message fell through to geocoding - this should not happen:', input)
    return formatError('Unable to process your location. Please try again or type your address.')
  }
  
  const geocodeResult = await geocodeAddress(input)
  
  if (geocodeResult.success && geocodeResult.coordinates) {
    // TODO: Save the address to database
    // For now, just use it to find nearby stores
    const nearbyStores = await getNearbyStores(
      geocodeResult.coordinates.latitude,
      geocodeResult.coordinates.longitude
    )
    
    await updateConversationState(chatId, {
      ...state,
      step: 'store_selection',
      temp_address_data: {
        address_line_1: geocodeResult.address,
        coordinates: geocodeResult.coordinates
      },
      previous_step: 'new_address'
    })
    
    return formatStoreSelection(nearbyStores, true)
  }
  
  return formatError('Could not find that address. Please try again or share your location.')
}

async function handleStoreSelection(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const input = messageBody.trim()
  const selectedNumber = parseInt(input)
  
  // Get stores based on delivery type and current state
  let stores: any[] = []
  if (state.delivery_type === 'delivery') {
    // Get nearby stores using coordinates from selected address or temp address
    if (state.selected_address_id) {
      // Get coordinates from selected address
      const addresses = await getCustomerAddresses(customerId)
      const selectedAddress = addresses.find(addr => addr.id === state.selected_address_id)
      if (selectedAddress) {
        stores = await getNearbyStores(
          parseFloat(selectedAddress.latitude),
          parseFloat(selectedAddress.longitude)
        )
      }
    } else if (state.temp_address_data?.coordinates) {
      // Use temp address coordinates
      stores = await getNearbyStores(
        state.temp_address_data.coordinates.latitude,
        state.temp_address_data.coordinates.longitude
      )
    }
  } else if (state.delivery_type === 'collection') {
    // For collection, handle search or show all stores
    if (isNaN(selectedNumber)) {
      // It's a search term
      stores = await getStoresBySearch(input)
      return formatStoreSelection(stores, false)
    } else {
      // Get all stores for collection
      stores = await getStoresBySearch('') // Empty search returns all stores
    }
  }
  
  // Handle numbered selections
  if (!isNaN(selectedNumber)) {
    // Check if no stores were found and handle those options
    if (stores.length === 0) {
      switch (selectedNumber) {
        case 1: // Search Again
          if (state.delivery_type === 'collection') {
            await updateConversationState(chatId, {
              ...state,
              step: 'store_search',
              previous_step: 'store_selection'
            })
            return formatStoreSearchPrompt()
          } else {
            // For delivery, go back to address selection
            const addresses = await getCustomerAddresses(customerId)
            await updateConversationState(chatId, {
              ...state,
              step: 'address_selection',
              previous_step: 'store_selection'
            })
            return formatAddressSelection(addresses)
          }
          
        case 2: // Back to Main Menu
          await updateConversationState(chatId, {
            ...state,
            step: 'main_menu',
            previous_step: 'store_selection'
          })
          return formatMainMenu()
          
        default:
          return formatStoreSelection(stores, state.delivery_type === 'delivery')
      }
    }
    
    // Handle store selection or navigation options when stores are available
    if (selectedNumber >= 1 && selectedNumber <= stores.length) {
      // Selected a store
      const selectedStore = stores[selectedNumber - 1]
      
      // Get store menu
      const categories = await getStoreMenu(selectedStore.id)
      
      // Update chat with location context now that store is selected
      await updateChatLocation(chatId, selectedStore.id)
      
      await updateConversationState(chatId, {
        ...state,
        step: 'menu_display',
        selected_location_id: selectedStore.id,
        menu_page: 1,
        menu_view_type: 'categories',
        previous_step: 'store_selection'
      })
      
      return formatMenuCategories(selectedStore, categories, 0, 1, 8)
      
    } else if (selectedNumber === stores.length + 1) {
      // Search for Different Store
      if (state.delivery_type === 'collection') {
        await updateConversationState(chatId, {
          ...state,
          step: 'store_search',
          previous_step: 'store_selection'
        })
        return formatStoreSearchPrompt()
      } else {
        // For delivery, go back to address selection
        const addresses = await getCustomerAddresses(customerId)
        await updateConversationState(chatId, {
          ...state,
          step: 'address_selection',
          previous_step: 'store_selection'
        })
        return formatAddressSelection(addresses)
      }
      
    } else if (selectedNumber === stores.length + 2) {
      // Back to Main Menu
      await updateConversationState(chatId, {
        ...state,
        step: 'main_menu',
        previous_step: 'store_selection'
      })
      return formatMainMenu()
    }
  }
  
  // Default case - show the stores again
  return formatStoreSelection(stores, state.delivery_type === 'delivery')
}

async function handleStoreSearch(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const input = messageBody.trim()
  const selectedNumber = parseInt(input)
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Share Location (to find nearby stores)
        await updateConversationState(chatId, {
          ...state,
          step: 'new_address',
          delivery_type: 'delivery',
          previous_step: 'store_search'
        })
        return formatNewAddressPrompt()
        
      case 2: // Back to Order Type
        await updateConversationState(chatId, {
          ...state,
          step: 'order_type',
          previous_step: 'store_search'
        })
        return formatOrderTypeSelection()
        
      case 3: // Back to Main Menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'store_search'
        })
        return formatMainMenu()
        
      default:
        return formatStoreSearchPrompt()
    }
  }
  
  // It's a search term - search for stores
  const stores = await getStoresBySearch(input)
  
  await updateConversationState(chatId, {
    ...state,
    step: 'store_selection',
    previous_step: 'store_search'
  })
  
  return formatStoreSelection(stores, false)
}

async function updateChatLocation(chatId: string, locationId: string) {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2")
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )
    
    const { error } = await supabase
      .from('chats')
      .update({ location_id: locationId })
      .eq('id', chatId)
      
    if (error) {
      console.error('Error updating chat location:', error)
    }
  } catch (error) {
    console.error('Error in updateChatLocation:', error)
  }
}

async function handleMenuDisplay(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  // Get store menu categories
  const categories = await getStoreMenu(state.selected_location_id!)
  const cartItems = await getCartItems(customerId, state.selected_location_id!)
  const currentPage = state.menu_page || 1
  const itemsPerPage = 8
  
  // If this is the first time showing the menu (coming from store selection), just display it
  if (state.previous_step === 'store_selection' && isNaN(selectedNumber)) {
    const store = await getStoreInfo(state.selected_location_id!)
    return formatMenuCategories(store, categories, cartItems.length, currentPage, itemsPerPage)
  }
  
  if (!isNaN(selectedNumber)) {
    // Calculate total pages
    const totalPages = Math.ceil(categories.length / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = Math.min(startIndex + itemsPerPage, categories.length)
    
    // Check if user selected a category (within current page range)
    if (selectedNumber >= 1 && selectedNumber <= Math.min(categories.length, endIndex)) {
      const selectedCategory = categories[selectedNumber - 1]
      
      await updateConversationState(chatId, {
        ...state,
        step: 'category_items',
        current_category_id: selectedCategory.id,
        menu_page: 1, // Reset to first page of items
        menu_view_type: 'items',
        previous_step: 'menu_display'
      })
      
      // Get store info for formatting
      const store = await getStoreInfo(state.selected_location_id!)
      
      return formatCategoryItems(store, selectedCategory, cartItems.length, 1, 10)
    }
    
    // Handle navigation options
    let optionNumber = categories.length + 1
    
    // Check pagination controls
    if (totalPages > 1) {
      if (currentPage > 1 && selectedNumber === optionNumber) {
        // Previous page
        await updateConversationState(chatId, {
          ...state,
          menu_page: currentPage - 1
        })
        
        const store = await getStoreInfo(state.selected_location_id!)
        
        return formatMenuCategories(store, categories, cartItems.length, currentPage - 1, itemsPerPage)
      }
      
      if (currentPage > 1) optionNumber++
      
      if (currentPage < totalPages && selectedNumber === optionNumber) {
        // Next page
        await updateConversationState(chatId, {
          ...state,
          menu_page: currentPage + 1
        })
        
        const store = await getStoreInfo(state.selected_location_id!)
        
        return formatMenuCategories(store, categories, cartItems.length, currentPage + 1, itemsPerPage)
      }
      
      if (currentPage < totalPages) optionNumber++
    }
    
    // Handle cart and menu options
    if (cartItems.length > 0) {
      if (selectedNumber === optionNumber) {
        // View cart
        const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
        await updateConversationState(chatId, {
          ...state,
          step: 'cart_view',
          previous_step: 'menu_display'
        })
        return formatCartView(cartItems, cartSummary)
      }
      optionNumber++
      
      if (selectedNumber === optionNumber) {
        // Checkout
        const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
        await updateConversationState(chatId, {
          ...state,
          step: 'checkout',
          previous_step: 'menu_display'
        })
        return formatCheckout(cartSummary, state.delivery_type)
      }
      optionNumber++
      
      if (selectedNumber === optionNumber) {
        // Back to main menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'menu_display'
        })
        return formatMainMenu()
      }
    } else {
      if (selectedNumber === optionNumber) {
        // Back to main menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'menu_display'
        })
        return formatMainMenu()
      }
    }
  }
  
  // Default fallback - show the menu
  const store = await getStoreInfo(state.selected_location_id!)
  return formatMenuCategories(store, categories, cartItems.length, currentPage, itemsPerPage)
}

async function handleCartView(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Edit Items - go back to menu
        const categories = await getStoreMenu(state.selected_location_id!)
        const cartItems = await getCartItems(customerId, state.selected_location_id!)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'menu_display',
          previous_step: 'cart_view'
        })
        
        const store = await getStoreInfo(state.selected_location_id!)
        return formatMenuCategories(store, categories, cartItems.length, 1, 8)
        
      case 2: // Checkout
        const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'checkout',
          previous_step: 'cart_view'
        })
        
        return formatCheckout(cartSummary, state.delivery_type)
        
      case 3: // Clear Plate
        await clearCart(customerId, state.selected_location_id!)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'cart_view'
        })
        
        return formatMainMenu()
        
      case 4: // Back to Menu
        const categoriesBack = await getStoreMenu(state.selected_location_id!)
        const cartItemsBack = await getCartItems(customerId, state.selected_location_id!)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'menu_display',
          previous_step: 'cart_view'
        })
        
        const storeBack = await getStoreInfo(state.selected_location_id!)
        return formatMenuCategories(storeBack, categoriesBack, cartItemsBack.length, 1, 8)
        
      case 5: // Back to Main Menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'cart_view'
        })
        
        return formatMainMenu()
        
      default:
        return formatError('Please select a valid option (1-5)')
    }
  }
  
  return formatError('Please select a valid option (1-5)')
}

async function handleCategoryItems(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  // Get current category
  const categories = await getStoreMenu(state.selected_location_id!)
  const currentCategory = categories.find(cat => cat.id === state.current_category_id)
  
  if (!currentCategory) {
    return formatError('Category not found')
  }
  
  const cartItems = await getCartItems(customerId, state.selected_location_id!)
  const currentPage = state.menu_page || 1
  const itemsPerPage = 10
  
  if (!isNaN(selectedNumber)) {
    // Calculate pagination
    const totalPages = Math.ceil(currentCategory.items.length / itemsPerPage)
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = Math.min(startIndex + itemsPerPage, currentCategory.items.length)
    
    // Check if user selected an item (within current page range)
    if (selectedNumber >= 1 && selectedNumber <= Math.min(currentCategory.items.length, endIndex)) {
      const selectedItem = currentCategory.items[selectedNumber - 1]
      
      await updateConversationState(chatId, {
        ...state,
        step: 'item_details',
        current_item_id: selectedItem.id,
        previous_step: 'category_items'
      })
      
      return formatItemDetails(selectedItem)
    }
    
    // Handle navigation options
    let optionNumber = currentCategory.items.length + 1
    
    // Check pagination controls
    if (totalPages > 1) {
      if (currentPage > 1 && selectedNumber === optionNumber) {
        // Previous page
        await updateConversationState(chatId, {
          ...state,
          menu_page: currentPage - 1
        })
        
        const store = await getStoreInfo(state.selected_location_id!)
        
        return formatCategoryItems(store, currentCategory, cartItems.length, currentPage - 1, itemsPerPage)
      }
      
      if (currentPage > 1) optionNumber++
      
      if (currentPage < totalPages && selectedNumber === optionNumber) {
        // Next page
        await updateConversationState(chatId, {
          ...state,
          menu_page: currentPage + 1
        })
        
        const store = await getStoreInfo(state.selected_location_id!)
        
        return formatCategoryItems(store, currentCategory, cartItems.length, currentPage + 1, itemsPerPage)
      }
      
      if (currentPage < totalPages) optionNumber++
    }
    
    // Handle back to categories
    if (selectedNumber === optionNumber) {
      await updateConversationState(chatId, {
        ...state,
        step: 'menu_display',
        current_category_id: undefined,
        menu_page: 1,
        menu_view_type: 'categories',
        previous_step: 'category_items'
      })
      
      const store = await getStoreInfo(state.selected_location_id!)
      
      return formatMenuCategories(store, categories, cartItems.length, 1, 8)
    }
    optionNumber++
    
    // Handle cart and menu options
    if (cartItems.length > 0) {
      if (selectedNumber === optionNumber) {
        // View cart
        const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
        await updateConversationState(chatId, {
          ...state,
          step: 'cart_view',
          previous_step: 'category_items'
        })
        return formatCartView(cartItems, cartSummary)
      }
      optionNumber++
      
      if (selectedNumber === optionNumber) {
        // Checkout
        const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
        await updateConversationState(chatId, {
          ...state,
          step: 'checkout',
          previous_step: 'category_items'
        })
        return formatCheckout(cartSummary, state.delivery_type)
      }
      optionNumber++
      
      if (selectedNumber === optionNumber) {
        // Back to main menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'category_items'
        })
        return formatMainMenu()
      }
    } else {
      if (selectedNumber === optionNumber) {
        // Back to main menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'category_items'
        })
        return formatMainMenu()
      }
    }
  }
  
  return formatError('Please select a valid option')
}

async function handleItemDetails(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  // Get the current item
  const item = await getMenuItem(state.current_item_id!)
  if (!item) {
    return formatError('Item not found')
  }
  
  const hasVariations = item.item_variations && item.item_variations.length > 0
  
  if (!isNaN(selectedNumber)) {
    if (hasVariations) {
      // Item has variations - 3 options
      switch (selectedNumber) {
        case 1: // Customize & Add to Plate
          await updateConversationState(chatId, {
            ...state,
            step: 'item_customization',
            temp_item_variations: {},
            current_variation_index: 0,
            previous_step: 'item_details'
          })
          return formatItemCustomization(item, 0, {})
          
        case 2: // Add to Plate (Default)
          const success = await addToCart(
            customerId,
            state.selected_location_id!,
            state.current_item_id!,
            1,
            {} // No variations selected
          )
          
          if (success) {
            const categories = await getStoreMenu(state.selected_location_id!)
            const cartItems = await getCartItems(customerId, state.selected_location_id!)
            
            await updateConversationState(chatId, {
              ...state,
              step: 'menu_display',
              previous_step: 'item_details'
            })
            
            const store = await getStoreInfo(state.selected_location_id!)
            return formatMenuCategories(store, categories, cartItems.length, 1, 8)
          }
          
          return formatError('Failed to add item to cart')
          
                case 3: // Back to menu
          const categories = await getStoreMenu(state.selected_location_id!)
          const cartItems = await getCartItems(customerId, state.selected_location_id!)
          
          await updateConversationState(chatId, {
            ...state,
            step: 'menu_display',
            previous_step: 'item_details'
          })
          
          const store = await getStoreInfo(state.selected_location_id!)
          return formatMenuCategories(store, categories, cartItems.length, 1, 8)
          
        default:
          return formatError('Please select 1 to customize, 2 to add with defaults, or 3 to go back')
    }
    } else {
      // Item has no variations - 2 options
      switch (selectedNumber) {
        case 1: // Add to Plate
          const success = await addToCart(
            customerId,
            state.selected_location_id!,
            state.current_item_id!,
            1,
            {} // No variations
          )
          
          if (success) {
            const categories = await getStoreMenu(state.selected_location_id!)
            const cartItems = await getCartItems(customerId, state.selected_location_id!)
            
            await updateConversationState(chatId, {
              ...state,
              step: 'menu_display',
              previous_step: 'item_details'
            })
            
            const store = await getStoreInfo(state.selected_location_id!)
            return formatMenuCategories(store, categories, cartItems.length, 1, 8)
          }
          
          return formatError('Failed to add item to cart')
          
        case 2: // Back to menu
          const categoriesBack = await getStoreMenu(state.selected_location_id!)
          const cartItemsBack = await getCartItems(customerId, state.selected_location_id!)
          
          await updateConversationState(chatId, {
            ...state,
            step: 'menu_display',
            previous_step: 'item_details'
          })
          
          const storeBack = await getStoreInfo(state.selected_location_id!)
          return formatMenuCategories(storeBack, categoriesBack, cartItemsBack.length, 1, 8)
          
        default:
          return formatError('Please select 1 to add to cart or 2 to go back')
      }
    }
  }
  
  return formatError('Please select a valid option')
}

async function handleItemCustomization(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  // Get the current item
  const item = await getMenuItem(state.current_item_id!)
  if (!item) {
    return formatError('Item not found')
  }
  
  const currentVariationIndex = state.current_variation_index || 0
  const selectedVariations = state.temp_item_variations || {}
  const currentVariation = item.item_variations[currentVariationIndex]

  if (!isNaN(selectedNumber)) {
    if (selectedNumber === 0) {
      // Back to item details
      await updateConversationState(chatId, {
        ...state,
        step: 'item_details',
        temp_item_variations: undefined,
        current_variation_index: undefined,
        previous_step: 'item_customization'
      })
      return formatItemDetails(item)
    }
    
    // Check if it's a valid option for current variation
    const maxOption = currentVariation.item_variation_options.length + (currentVariation.is_required ? 0 : 1)
    
    if (selectedNumber >= 1 && selectedNumber <= maxOption) {
      let newSelectedVariations = { ...selectedVariations }
      
      if (selectedNumber <= currentVariation.item_variation_options.length) {
        // User selected an option
        const selectedOption = currentVariation.item_variation_options[selectedNumber - 1]
        newSelectedVariations[currentVariation.id] = selectedOption.id
      }
      // If selectedNumber > item_variation_options.length, it means "Skip" for optional variations
      
      // Check if there are more variations to process
      const nextVariationIndex = currentVariationIndex + 1
      
      if (nextVariationIndex < item.item_variations.length) {
        // Move to next variation
        await updateConversationState(chatId, {
          ...state,
          temp_item_variations: newSelectedVariations,
          current_variation_index: nextVariationIndex
        })
        return formatItemCustomization(item, nextVariationIndex, newSelectedVariations)
      } else {
        // All variations processed - show summary
        await updateConversationState(chatId, {
          ...state,
          temp_item_variations: newSelectedVariations,
          current_variation_index: undefined
        })
        return formatCustomizationSummary(item, newSelectedVariations)
      }
    }
    
    return formatError(`Please select a valid option (0-${maxOption})`)
  }
  
  // Check if we're at the summary stage (no current_variation_index)
  if (state.current_variation_index === undefined) {
    return await handleCustomizationSummary(chatId, customerId, messageBody, state, item)
  }
  
  return formatError('Please select a valid option')
}

async function handleCustomizationSummary(chatId: string, customerId: string, messageBody: string, state: ConversationState, item: any): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Add to Plate
        const success = await addToCart(
          customerId,
          state.selected_location_id!,
          state.current_item_id!,
          1,
          state.temp_item_variations || {}
        )
        
        if (success) {
          const categories = await getStoreMenu(state.selected_location_id!)
          const cartItems = await getCartItems(customerId, state.selected_location_id!)
          
          await updateConversationState(chatId, {
            ...state,
            step: 'menu_display',
            temp_item_variations: undefined,
            current_variation_index: undefined,
            previous_step: 'item_customization'
          })
          
          const store = await getStoreInfo(state.selected_location_id!)
          return formatMenuCategories(store, categories, cartItems.length, 1, 8)
        }
        
        return formatError('Failed to add item to cart')
        
      case 2: // Change Customizations
        await updateConversationState(chatId, {
          ...state,
          temp_item_variations: {},
          current_variation_index: 0
        })
        return formatItemCustomization(item, 0, {})
        
      case 3: // Back to Menu
        const categories = await getStoreMenu(state.selected_location_id!)
        const cartItems = await getCartItems(customerId, state.selected_location_id!)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'menu_display',
          temp_item_variations: undefined,
          current_variation_index: undefined,
          previous_step: 'item_customization'
        })
        
        const store = await getStoreInfo(state.selected_location_id!)
        return formatMenuCategories(store, categories, cartItems.length, 1, 8)
        
      default:
        return formatError('Please select 1 to add to cart, 2 to change customizations, or 3 to go back to menu')
    }
  }
  
  return formatError('Please select a valid option (1-3)')
}

async function handleCheckout(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  const isCollection = state.delivery_type === 'collection'
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Pay Online - Only online payments get tip selection and email collection
        console.log('User selected Pay Online - showing tip selection')
        const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'tip_selection',
          payment_method: 'online',
          previous_step: 'checkout'
        })
        
        return formatTipSelection(cartSummary.total_amount)
        
      case 2:
        if (isCollection) {
          // Pay on Collection - Skip tip and email collection
          console.log('Collection order - Pay on Collection selected, processing directly')
          return await processPayment(chatId, customerId, {
            ...state,
            payment_method: 'collection',
            tip_amount: 0,
            customer_email: undefined // No email needed for collection
          })
        } else {
          // Pay on Delivery (Card) - Skip tip and email collection
          console.log('Delivery order - Pay on Delivery (Card) selected, processing directly')
          return await processPayment(chatId, customerId, {
            ...state,
            payment_method: 'delivery_card',
            tip_amount: 0,
            customer_email: undefined // No email needed for delivery card
          })
        }
        
      case 3:
        if (isCollection) {
          // Back to cart
          const cartItems = await getCartItems(customerId, state.selected_location_id!)
          const cartSummary3 = await getCartSummary(customerId, state.selected_location_id!)
          
          await updateConversationState(chatId, {
            ...state,
            step: 'cart_view',
            previous_step: 'checkout'
          })
          
          return formatCartView(cartItems, cartSummary3)
        } else {
          // Pay on Delivery (Cash) - Skip tip and email collection
          console.log('Delivery order - Pay on Delivery (Cash) selected, processing directly')
          return await processPayment(chatId, customerId, {
            ...state,
            payment_method: 'delivery_cash',
            tip_amount: 0,
            customer_email: undefined // No email needed for delivery cash
          })
        }
        
      case 4:
        if (isCollection) {
          // Cancel order
          await clearCart(customerId, state.selected_location_id!)
          
          await updateConversationState(chatId, {
            ...state,
            step: 'main_menu',
            previous_step: 'checkout'
          })
          
          return formatMainMenu()
        } else {
          // Back to cart
          const cartItems = await getCartItems(customerId, state.selected_location_id!)
          const cartSummary4 = await getCartSummary(customerId, state.selected_location_id!)
          
          await updateConversationState(chatId, {
            ...state,
            step: 'cart_view',
            previous_step: 'checkout'
          })
          
          return formatCartView(cartItems, cartSummary4)
        }
        
      case 5:
        if (!isCollection) {
          // Cancel order (only for delivery - collection has 4 options)
          await clearCart(customerId, state.selected_location_id!)
          
          await updateConversationState(chatId, {
            ...state,
            step: 'main_menu',
            previous_step: 'checkout'
          })
          
          return formatMainMenu()
        } else {
          return formatError('Please select a valid option (1-4)')
        }
        break
        
      default:
        const maxOption = isCollection ? 4 : 5
        return formatError(`Please select a valid payment option (1-${maxOption})`)
    }
  }
  
  return formatError('Please select a valid option (1-5)')
}

async function handleTipSelection(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  console.log('=== HANDLING TIP SELECTION ===')
  console.log('Payment Method:', state.payment_method)
  console.log('Message Body:', messageBody)
  
  const input = messageBody.trim()
  const selectedNumber = parseInt(input)
  
  const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
  const orderTotal = cartSummary.total_amount
  
  if (!isNaN(selectedNumber)) {
    let tipAmount = 0
    let tipDescription = ''
    
    switch (selectedNumber) {
      case 1: // 5%
        tipAmount = orderTotal * 0.05
        tipDescription = '5%'
        break
        
      case 2: // 15%
        tipAmount = orderTotal * 0.15
        tipDescription = '15%'
        break
        
      case 3: // 30%
        tipAmount = orderTotal * 0.30
        tipDescription = '30%'
        break
        
      case 4: // Custom amount - this would need special handling
        return formatError('Please type your custom tip amount like "R25"')
        
      case 5: // Skip tip
        tipAmount = 0
        tipDescription = 'No tip'
        break
        
      default:
        return formatError('Please select a valid tip option (1-5)')
    }
    
    console.log(`User selected tip: ${tipDescription} (R${tipAmount.toFixed(2)})`)
    
    await updateConversationState(chatId, {
      ...state,
      step: 'email_collection',
      tip_amount: tipAmount,
      previous_step: 'tip_selection'
    })
    
    console.log('Proceeding to email collection for online payment')
    return formatEmailCollection()
  }
  
  // Check for custom tip amount (R25 format)
  if (input.toLowerCase().startsWith('r')) {
    const customAmount = parseFloat(input.substring(1))
    if (!isNaN(customAmount) && customAmount >= 0) {
      console.log(`User entered custom tip: R${customAmount.toFixed(2)}`)
      
      await updateConversationState(chatId, {
        ...state,
        step: 'email_collection',
        tip_amount: customAmount,
        previous_step: 'tip_selection'
      })
      
      console.log('Proceeding to email collection for online payment with custom tip')
      return formatEmailCollection()
    } else {
      return formatError('Please enter a valid tip amount like "R25"')
    }
  }
  
  return formatError('Please select a tip option (1-5) or enter a custom amount like "R25"')
}

async function handleEmailCollection(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const input = messageBody.trim()
  const selectedNumber = parseInt(input)
  
  if (!isNaN(selectedNumber)) {
    if (selectedNumber === 1) {
      // Back to payment options
      const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
      
      await updateConversationState(chatId, {
        ...state,
        step: 'checkout',
        previous_step: 'email_collection'
      })
      
      return formatCheckout(cartSummary, state.delivery_type)
    }
  }
  
  // Check if it's a valid email
  if (input.includes('@') && input.includes('.')) {
    // TODO: Save email to customer record
    
    await updateConversationState(chatId, {
      ...state,
      step: 'payment_method',
      customer_email: input,
      previous_step: 'email_collection'
    })
    
    // Get saved payment methods
    const paymentMethods = await getCustomerPaymentMethods(customerId)
    return formatPaymentMethods(paymentMethods)
  }
  
  return formatError('Please enter a valid email address or select 1 to go back')
}

async function handlePaymentMethod(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  const paymentMethods = await getCustomerPaymentMethods(customerId)
  
  if (!isNaN(selectedNumber)) {
    if (selectedNumber >= 1 && selectedNumber <= paymentMethods.length) {
      // Selected saved payment method
      const selectedMethod = paymentMethods[selectedNumber - 1]
      
      await updateConversationState(chatId, {
        ...state,
        step: 'payment',
        payment_authorization_id: selectedMethod.id,
        previous_step: 'payment_method'
      })
      
      return await processPayment(chatId, customerId, state)
      
    } else if (selectedNumber === paymentMethods.length + 1) {
      // New card
      await updateConversationState(chatId, {
        ...state,
        step: 'payment',
        payment_authorization_id: undefined,
        previous_step: 'payment_method'
      })
      
      return await processPayment(chatId, customerId, state)
      
    } else if (selectedNumber === paymentMethods.length + 2) {
      // Back to payment options
      const cartSummary = await getCartSummary(customerId, state.selected_location_id!)
      
      await updateConversationState(chatId, {
        ...state,
        step: 'checkout',
        previous_step: 'payment_method'
      })
      
      return formatCheckout(cartSummary, state.delivery_type)
    }
  }
  
  return formatError('Please select a valid payment method')
}

async function handlePayment(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Change payment method
        const paymentMethods = await getCustomerPaymentMethods(customerId)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'payment_method',
          previous_step: 'payment'
        })
        
        return formatPaymentMethods(paymentMethods)
        
      case 2: // Cancel order
        await clearCart(customerId, state.selected_location_id!)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'payment'
        })
        
        return formatMainMenu()
        
      default:
        return formatError('Please select 1 to change payment method or 2 to cancel order')
    }
  }
  
  return formatError('Please select a valid option (1-2)')
}

async function processPayment(chatId: string, customerId: string, state: ConversationState): Promise<string> {
  console.log('=== PROCESSING PAYMENT ===')
  console.log('Chat ID:', chatId)
  console.log('Customer ID:', customerId)
  console.log('Payment Method:', state.payment_method)
  console.log('Tip Amount:', state.tip_amount || 0)
  console.log('State:', {
    delivery_type: state.delivery_type,
    selected_location_id: state.selected_location_id,
    selected_address_id: state.selected_address_id,
    customer_email: state.customer_email,
    payment_authorization_id: state.payment_authorization_id,
    temp_address_data: state.temp_address_data
  })
  
  // Defensive checks
  if (!state.selected_location_id) {
    console.error('Cannot process payment: No location selected')
    return formatError('Order session expired. Please start a new order.')
  }
  
  if (!state.delivery_type) {
    console.error('Cannot process payment: No delivery type selected')
    return formatError('Order session expired. Please start a new order.')
  }
  
  try {
    // Get cart summary
    const cartSummary = await getCartSummary(customerId, state.selected_location_id)
    console.log('Cart Summary for Payment:', cartSummary)
    
    const tipAmount = state.tip_amount || 0
    const totalAmount = cartSummary.total_amount + tipAmount
    
    console.log('Payment Breakdown:')
    console.log('- Subtotal:', cartSummary.subtotal)
    console.log('- Delivery Fee:', cartSummary.delivery_fee_amount || 0)
    console.log('- Tip Amount:', tipAmount)
    console.log('- Total Amount:', totalAmount)
    
    // Log payment method context
    if (state.payment_method === 'online') {
      console.log('Processing ONLINE payment (tips allowed)')
    } else if (state.payment_method === 'collection') {
      console.log('Processing PAY ON COLLECTION payment (no tips)')
    } else if (state.payment_method === 'delivery_card') {
      console.log('Processing PAY ON DELIVERY (CARD) payment (no tips)')
    } else if (state.payment_method === 'delivery_cash') {
      console.log('Processing PAY ON DELIVERY (CASH) payment (no tips)')
    }
    
    // Prepare address data for order creation
    let addressData: any = undefined
    
    if (state.delivery_type === 'delivery') {
      if (state.selected_address_id) {
        // Get saved address
        const addresses = await getCustomerAddresses(customerId)
        const selectedAddress = addresses.find(addr => addr.id === state.selected_address_id)
        if (selectedAddress) {
          addressData = {
            address: selectedAddress.address_line_1,
            latitude: parseFloat(selectedAddress.latitude),
            longitude: parseFloat(selectedAddress.longitude),
            instructions: selectedAddress.delivery_instructions
          }
          console.log('Using saved address:', addressData)
        }
      } else if (state.temp_address_data) {
        // Use temporary address data
        addressData = {
          address: state.temp_address_data.address_line_1 || state.temp_address_data.address,
          latitude: state.temp_address_data.coordinates?.latitude,
          longitude: state.temp_address_data.coordinates?.longitude
        }
        console.log('Using temporary address:', addressData)
      }
    } else {
      console.log('Collection order - no address needed')
    }
    
    // Create the order in database
    console.log('Creating order in database...')
    const orderResult = await createOrder(
      customerId,
      state.selected_location_id,
      state.delivery_type === 'delivery' ? 'delivery' : 'pickup',
      addressData,
      tipAmount,
      state.customer_email
    )
    
    console.log('Order creation result:', orderResult)
    
    if (!orderResult.success) {
      console.error('Order creation failed:', orderResult.error)
      return formatError(orderResult.error || 'Failed to create order')
    }
    
    if (!orderResult.orderNumber) {
      console.error('Order created but no order number returned')
      return formatError('Order created but failed to generate order number')
    }
    
    // For now, skip payment processing and go straight to confirmation
    // TODO: Implement actual PayStack payment processing
    console.log('Order created successfully, proceeding to confirmation')
    
    await updateConversationState(chatId, {
      step: 'main_menu',
      previous_step: 'payment'
    })
    
    // Return order confirmation
    const estimatedTime = 30 // minutes
    console.log('=== PAYMENT PROCESSING COMPLETED ===')
    console.log('Final Order Number:', orderResult.orderNumber)
    console.log('Final Total Amount:', orderResult.totalAmount)
    console.log('Final Payment Method:', state.payment_method)
    console.log('Final Tip Amount:', tipAmount)
    return formatOrderConfirmation(orderResult.orderNumber, estimatedTime)
    
  } catch (error) {
    console.error('=== PAYMENT PROCESSING ERROR ===')
    console.error('Unexpected error:', error)
    return formatError('Payment processing failed. Please try again.')
  }
}

async function finalizeOrder(chatId: string, customerId: string, state: ConversationState): Promise<string> {
  console.log('=== FINALIZING ORDER ===')
  console.log('Note: This function should not be called anymore as order creation happens in processPayment')
  
  // This function is now deprecated since we create orders directly in processPayment
  // Redirect to processPayment
  return await processPayment(chatId, customerId, state)
} 