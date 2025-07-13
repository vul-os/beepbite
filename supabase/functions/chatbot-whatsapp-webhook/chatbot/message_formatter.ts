// Message formatting utilities for WhatsApp chatbot

const MAX_WHATSAPP_MESSAGE_LENGTH = 4096

export function validateMessageLength(message: string): { valid: boolean; length: number; truncated?: string } {
  const length = message.length
  
  if (length <= MAX_WHATSAPP_MESSAGE_LENGTH) {
    return { valid: true, length }
  }
  
  // Truncate message and add warning
  const truncated = message.substring(0, MAX_WHATSAPP_MESSAGE_LENGTH - 100) + 
    '\n\n⚠️ *Message truncated due to length limit*\n\n📱 *Powered by BeepBite.io*'
  
  return { valid: false, length, truncated }
}

export function formatMainMenu(customerName?: string, cartItemCount: number = 0, activeOrderCount: number = 0, cartLocationName?: string) {
  const greeting = customerName ? `Hello ${customerName}! 👋` : 'Hello! 👋'
  
  let message = `${greeting}\n\n`
  message += `🍽️ *Welcome to BeepBite!*\n\n`
  
  // Show cart and active orders status
  if (cartItemCount > 0) {
    message += `🛒 *Your Plate:* ${cartItemCount} item${cartItemCount > 1 ? 's' : ''}`
    if (cartLocationName) {
      message += ` from ${cartLocationName}`
    }
    message += `\n`
  }
  if (activeOrderCount > 0) {
    message += `📋 *Active Orders:* ${activeOrderCount}\n`
  }
  if (cartItemCount > 0 || activeOrderCount > 0) {
    message += `\n`
  }
  
  message += `*Main Menu:*\n`
  
  // If there's a cart, show continue option first
  if (cartItemCount > 0) {
    message += `*[1]* 🛒 Continue with Plate (${cartItemCount} items)\n`
    message += `*[A]* 🍔 Make New Order\n`
  } else {
    message += `*[A]* 🍔 Make an Order\n`
  }
  
  message += `*[B]* 📜 View Previous Orders\n`
  message += `*[C]* 👤 My Profile\n`
  message += `*[D]* 💳 Billing\n`
  message += `*[E]* 📍 Addresses\n\n`
    
  return message
}

export function formatNewOrderWarning(cartItemCount: number, cartLocationName?: string) {
  let message = `⚠️ *New Order Warning*\n\n`
  message += `You currently have ${cartItemCount} item${cartItemCount > 1 ? 's' : ''} in your plate`
  if (cartLocationName) {
    message += ` from ${cartLocationName}`
  }
  message += `.\n\n`
  message += `Starting a new order will *delete* your current plate.\n\n`
  message += `*What would you like to do?*\n\n`
  message += `*[1]* 🛒 Continue with Current Plate\n`
  message += `*[2]* 🗑️ Delete Plate & Make New Order\n`
  message += `*[3]* 👀 View Current Plate\n`
  message += `*[4]* 🏠 Back to Main Menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatOrderTypeSelection() {
  let message = `🍔 *Make an Order*\n\n`
  message += `How would you like to receive your order?\n\n`
  message += `*[1]* 🚚 Delivery\n`
  message += `*[2]* 🏪 Collection\n`
  message += `*[3]* 🏠 Back to Main Menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatAddressSelection(addresses: any[]) {
  let message = `📍 *Select Delivery Address*\n\n`
  
  if (addresses.length === 0) {
    message += `You don't have any saved addresses.\n\n`
    message += `*[1]* ➕ Add New Address\n`
    message += `*[2]* 🏠 Back to Main Menu\n\n`
  } else {
    message += `Choose from your saved addresses:\n\n`
    
    addresses.forEach((address, index) => {
      const isDefault = address.is_default ? ' (Default)' : ''
      message += `*[${index + 1}]* ${address.address_line_1}${isDefault}\n`
    })
    
    message += `*[${addresses.length + 1}]* ➕ Add New Address\n`
    message += `*[${addresses.length + 2}]* 🏠 Back to Main Menu\n\n`
  }
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatNewAddressPrompt() {
  let message = `📍 *Add New Address*\n\n`
  message += `Please share your location or type your address:\n\n`
  message += `🌍 *Share Location:* Use the location sharing feature\n`
  message += `✍️ *Type Address:* Write your full address\n\n`
  message += `*[1]* 🔙 Back to Address Selection\n`
  message += `*[2]* 🏠 Back to Main Menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatStoreSelection(stores: any[], isNearby: boolean = false) {
  let message = `🏪 *Select Store*\n\n`
  
  if (stores.length === 0) {
    message += `❌ No stores found.\n\n`
    message += `*[1]* 🔍 Search Again\n`
    message += `*[2]* 🏠 Back to Main Menu\n\n`
  } else {
    const storeType = isNearby ? 'nearby stores' : 'stores'
    message += `Found ${stores.length} ${storeType}:\n\n`
    
    stores.forEach((store, index) => {
      message += `*[${index + 1}]* ${store.name}\n`
      if (store.address) {
        message += `   📍 ${store.address}\n`
      }
      if (store.delivery_fee > 0) {
        message += `   🚚 Delivery: R${store.delivery_fee.toFixed(2)}\n`
      }
      message += `\n`
    })
    
    message += `*[${stores.length + 1}]* 🔍 Search for Different Store\n`
    message += `*[${stores.length + 2}]* 🏠 Back to Main Menu\n\n`
  }
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatStoreSearchPrompt() {
  let message = `🔍 *Search for Store*\n\n`
  message += `Type the name of the store you're looking for:\n\n`
  message += `*[1]* 🌍 Share Location (to find nearby stores)\n`
  message += `*[2]* 🔙 Back to Order Type\n`
  message += `*[3]* 🏠 Back to Main Menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatMenuCategories(store: any, categories: any[], cartItemCount: number = 0, page: number = 1, itemsPerPage: number = 8) {
  let message = `🍽️ *${store.name} - Menu Categories*\n\n`
  
  if (cartItemCount > 0) {
    message += `🛒 *Your Plate:* ${cartItemCount} item${cartItemCount > 1 ? 's' : ''}\n\n`
  }
  
  if (categories.length === 0) {
    message += `❌ No menu categories available.\n\n`
    message += `*[1]* 🔙 Back to Store Selection\n`
    message += `*[2]* 🏠 Back to Main Menu\n\n`
  } else {
    // Calculate pagination
    const totalPages = Math.ceil(categories.length / itemsPerPage)
    const startIndex = (page - 1) * itemsPerPage
    const endIndex = Math.min(startIndex + itemsPerPage, categories.length)
    const currentCategories = categories.slice(startIndex, endIndex)
    
    message += `*Select a Category:*\n\n`
    
    currentCategories.forEach((category, index) => {
      const categoryNumber = startIndex + index + 1
      const itemCount = category.items ? category.items.length : 0
      message += `*[${categoryNumber}]* ${category.name} (${itemCount} items)\n`
      if (category.description) {
        message += `   ${category.description}\n`
      }
      message += `\n`
    })
    
    // Navigation options
    let optionNumber = categories.length + 1
    
    // Pagination controls
    if (totalPages > 1) {
      message += `*Navigation:*\n`
      if (page > 1) {
        message += `*[${optionNumber}]* ⬅️ Previous Page\n`
        optionNumber++
      }
      if (page < totalPages) {
        message += `*[${optionNumber}]* ➡️ Next Page\n`
        optionNumber++
      }
      message += `\nPage ${page} of ${totalPages}\n\n`
    }
    
    // Cart and main menu options
    if (cartItemCount > 0) {
      message += `*[${optionNumber}]* 🛒 View Plate (${cartItemCount} items)\n`
      message += `*[${optionNumber + 1}]* 🧾 Checkout\n`
      message += `*[${optionNumber + 2}]* 🏠 Back to Main Menu\n\n`
    } else {
      message += `*[${optionNumber}]* 🏠 Back to Main Menu\n\n`
    }
  }
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatCategoryItems(store: any, category: any, cartItemCount: number = 0, page: number = 1, itemsPerPage: number = 10) {
  let message = `🍽️ *${store.name} - ${category.name}*\n\n`
  
  if (cartItemCount > 0) {
    message += `🛒 *Your Plate:* ${cartItemCount} item${cartItemCount > 1 ? 's' : ''}\n\n`
  }
  
  if (category.description) {
    message += `${category.description}\n\n`
  }
  
  if (!category.items || category.items.length === 0) {
    message += `❌ No items available in this category.\n\n`
    message += `*[1]* 🔙 Back to Categories\n`
    message += `*[2]* 🏠 Back to Main Menu\n\n`
  } else {
    // Calculate pagination
    const totalPages = Math.ceil(category.items.length / itemsPerPage)
    const startIndex = (page - 1) * itemsPerPage
    const endIndex = Math.min(startIndex + itemsPerPage, category.items.length)
    const currentItems = category.items.slice(startIndex, endIndex)
    
    message += `*Select an Item:*\n\n`
    
    currentItems.forEach((item, index) => {
      const itemNumber = startIndex + index + 1
      message += `*[${itemNumber}]* ${item.name} - R${parseFloat(item.price).toFixed(2)}\n`
      if (item.description) {
        // Truncate long descriptions to save space
        const truncatedDesc = item.description.length > 80 
          ? item.description.substring(0, 80) + '...'
          : item.description
        message += `   ${truncatedDesc}\n`
      }
      message += `\n`
    })
    
    // Navigation options
    let optionNumber = category.items.length + 1
    
    // Pagination controls
    if (totalPages > 1) {
      message += `*Navigation:*\n`
      if (page > 1) {
        message += `*[${optionNumber}]* ⬅️ Previous Page\n`
        optionNumber++
      }
      if (page < totalPages) {
        message += `*[${optionNumber}]* ➡️ Next Page\n`
        optionNumber++
      }
      message += `\nPage ${page} of ${totalPages}\n\n`
    }
    
    // Back and menu options
    message += `*[${optionNumber}]* 🔙 Back to Categories\n`
    optionNumber++
    
    if (cartItemCount > 0) {
      message += `*[${optionNumber}]* 🛒 View Plate (${cartItemCount} items)\n`
      message += `*[${optionNumber + 1}]* 🧾 Checkout\n`
      message += `*[${optionNumber + 2}]* 🏠 Back to Main Menu\n\n`
    } else {
      message += `*[${optionNumber}]* 🏠 Back to Main Menu\n\n`
    }
  }
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

// Keep the old formatMenu function for backward compatibility but make it use pagination
export function formatMenu(store: any, categories: any[], cartItemCount: number = 0) {
  // Default to showing categories view
  return formatMenuCategories(store, categories, cartItemCount, 1, 8)
}

export function formatItemDetails(item: any) {
  let message = `🍽️ *${item.name}*\n\n`
  
  if (item.description) {
    message += `${item.description}\n\n`
  }
  
  message += `💰 *Price:* R${parseFloat(item.price).toFixed(2)}\n`
  
  if (item.preparation_time) {
    message += `⏱️ *Prep Time:* ${item.preparation_time} minutes\n`
  }
  
  // Show variations if any
  if (item.item_variations && item.item_variations.length > 0) {
    message += `\n*Customizations Available*\n`
    message += `This item has customization options.\n\n`
    message += `*[1]* ⚙️ Customize & Add to Plate\n`
    message += `*[2]* ➕ Add to Plate (Default)\n`
    message += `*[3]* 🔙 Back to Menu\n\n`
  } else {
    message += `\n*[1]* ➕ Add to Plate\n`
    message += `*[2]* 🔙 Back to Menu\n\n`
  }
  
  return message
}

export function formatItemCustomization(item: any, currentVariationIndex: number, selectedVariations: Record<string, string> = {}) {
  const variation = item.item_variations[currentVariationIndex]
  const totalVariations = item.item_variations.length
  
  let message = `🍽️ *${item.name}*\n`
  message += `⚙️ *Customization ${currentVariationIndex + 1} of ${totalVariations}*\n\n`
  
  message += `*${variation.name}:*\n`
  if (variation.is_required) {
    message += `(Required selection)\n\n`
  } else {
    message += `(Optional)\n\n`
  }
  
  // Show options
  variation.item_variation_options.forEach((option: any, index: number) => {
    const priceModifier = parseFloat(option.price_modifier || 0)
    const priceText = priceModifier > 0 ? ` (+R${priceModifier.toFixed(2)})` : priceModifier < 0 ? ` (R${priceModifier.toFixed(2)})` : ''
    message += `*[${index + 1}]* ${option.name}${priceText}\n`
  })
  
  // Add skip option for optional variations
  if (!variation.is_required) {
    message += `*[${variation.item_variation_options.length + 1}]* ⏭️ Skip (No selection)\n`
  }
  
  // Show progress
  if (Object.keys(selectedVariations).length > 0) {
    message += `\n*Selections so far:*\n`
    for (const [varId, optionId] of Object.entries(selectedVariations)) {
      const selectedVar = item.item_variations.find((v: any) => v.id === varId)
      const selectedOption = selectedVar?.item_variation_options.find((o: any) => o.id === optionId)
      if (selectedVar && selectedOption) {
        message += `• ${selectedVar.name}: ${selectedOption.name}\n`
      }
    }
  }
  
  message += `\n*[0]* 🔙 Back\n\n`
  
  return message
}

export function formatCustomizationSummary(item: any, selectedVariations: Record<string, string>) {
  let basePrice = parseFloat(item.price)
  let totalPrice = basePrice
  
  let message = `🍽️ *${item.name}*\n`
  message += `⚙️ *Customization Summary*\n\n`
  
  message += `*Your Selections:*\n`
  
  for (const [variationId, optionId] of Object.entries(selectedVariations)) {
    const variation = item.item_variations.find((v: any) => v.id === variationId)
    const option = variation?.item_variation_options.find((o: any) => o.id === optionId)
    
    if (variation && option) {
      const priceModifier = parseFloat(option.price_modifier || 0)
      totalPrice += priceModifier
      const priceText = priceModifier > 0 ? ` (+R${priceModifier.toFixed(2)})` : priceModifier < 0 ? ` (R${priceModifier.toFixed(2)})` : ''
      message += `• ${variation.name}: ${option.name}${priceText}\n`
    }
  }
  
  message += `\nBase Price: R${basePrice.toFixed(2)}\n`
  if (totalPrice !== basePrice) {
    message += `Customizations: R${(totalPrice - basePrice).toFixed(2)}\n`
  }
  message += `*Total Price: R${totalPrice.toFixed(2)}*\n\n`
  
  message += `*[1]* ✅ Add to Plate\n`
  message += `*[2]* ✏️ Change Customizations\n`
  message += `*[3]* 🔙 Back to Menu\n\n`
  
  return message
}

export function formatCartView(cartItems: any[], cartSummary: any) {
  let message = `🛒 *Your Plate*\n\n`
  
  if (cartItems.length === 0) {
    message += `Your plate is empty.\n\n`
    message += `*[1]* 🔙 Back to Menu\n`
    message += `*[2]* 🏠 Back to Main Menu\n\n`
  } else {
    cartItems.forEach((cartItem, index) => {
      message += `*${index + 1}.* ${cartItem.items.name} (x${cartItem.quantity})\n`
      message += `   R${parseFloat(cartItem.total_price).toFixed(2)}\n`
      
      // Show variations
      if (cartItem.cart_item_variations && cartItem.cart_item_variations.length > 0) {
        cartItem.cart_item_variations.forEach((variation: any) => {
          message += `   • ${variation.item_variations.name}: ${variation.item_variation_options.name}\n`
        })
      }
      
      if (cartItem.special_instructions) {
        message += `   📝 ${cartItem.special_instructions}\n`
      }
      
      message += `\n`
    })
    
    message += `*Order Summary:*\n`
    message += `Subtotal: R${parseFloat(cartSummary.subtotal).toFixed(2)}\n`
    
    if (cartSummary.delivery_fee_amount > 0) {
      message += `Delivery Fee: R${parseFloat(cartSummary.delivery_fee_amount).toFixed(2)}\n`
    }
    
    message += `*Total: R${parseFloat(cartSummary.total_amount).toFixed(2)}*\n\n`
    
    message += `*Options:*\n`
    message += `*[1]* ✏️ Edit Items\n`
    message += `*[2]* 🧾 Checkout\n`
    message += `*[3]* 🗑️ Clear Plate\n`
    message += `*[4]* 🔙 Back to Menu\n`
    message += `*[5]* 🏠 Back to Main Menu\n\n`
  }
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatCheckout(cartSummary: any, deliveryType?: 'delivery' | 'collection') {
  let message = `🧾 *Checkout*\n\n`
  
  message += `*Order Summary:*\n`
  message += `Subtotal: R${parseFloat(cartSummary.subtotal).toFixed(2)}\n`
  
  if (cartSummary.delivery_fee_amount > 0) {
    message += `Delivery Fee: R${parseFloat(cartSummary.delivery_fee_amount).toFixed(2)}\n`
  }
  
  message += `*Total: R${parseFloat(cartSummary.total_amount).toFixed(2)}*\n\n`
  
  const isCollection = deliveryType === 'collection'
  
  message += `*Payment Options:*\n`
  message += `*[1]* 💳 Pay Online\n`
  
  if (isCollection) {
    message += `*[2]* 💵 Pay on Collection\n`
    message += `*[3]* 🔙 Back to Plate\n`
    message += `*[4]* ❌ Cancel Order\n\n`
  } else {
    message += `*[2]* 💳 Pay on Delivery (Card)\n`
    message += `*[3]* 💵 Pay on Delivery (Cash)\n`
    message += `*[4]* 🔙 Back to Plate\n`
    message += `*[5]* ❌ Cancel Order\n\n`
  }
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatTipSelection(orderTotal: number) {
  let message = `💰 *Add Tip?*\n\n`
  message += `Order Total: R${orderTotal.toFixed(2)}\n\n`
  
  const tip5 = orderTotal * 0.05
  const tip15 = orderTotal * 0.15
  const tip30 = orderTotal * 0.30
  
  message += `*Tip Options:*\n`
  message += `*[1]* 5% - R${tip5.toFixed(2)}\n`
  message += `*[2]* 15% - R${tip15.toFixed(2)}\n`
  message += `*[3]* 30% - R${tip30.toFixed(2)}\n`
  message += `*[4]* 💰 Custom amount (type R amount)\n`
  message += `*[5]* ⏭️ Skip tip\n\n`
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatEmailCollection() {
  let message = `📧 *Email Required*\n\n`
  message += `To pay via card, please provide your email address:\n\n`
  message += `✍️ Type your email address (must contain @)\n\n`
  message += `*[1]* 🔙 Back to Payment Options\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatPaymentMethods(paymentMethods: any[]) {
  let message = `💳 *Select Payment Method*\n\n`
  
  if (paymentMethods.length > 0) {
    message += `*Saved Cards:*\n`
    paymentMethods.forEach((method, index) => {
      message += `*[${index + 1}]* ${method.card_type} ****${method.card_last_four}\n`
    })
    message += `\n`
  }
  
  message += `*[${paymentMethods.length + 1}]* ➕ New Card\n`
  message += `*[${paymentMethods.length + 2}]* 🔙 Back to Payment Options\n\n`
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatPaymentLink(paymentUrl: string, orderTotal: number) {
  let message = `💳 *Payment Link*\n\n`
  message += `Total Amount: R${orderTotal.toFixed(2)}\n\n`
  message += `Click the link below to pay:\n`
  message += `${paymentUrl}\n\n`
  message += `*Options:*\n`
  message += `*[1]* 🔄 Change Payment Method\n`
  message += `*[2]* ❌ Cancel Order\n\n`
  message += `You'll be notified here when payment is complete!\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatOrderConfirmation(orderNumber: string, estimatedTime: number) {
  let message = `✅ *Order Confirmed!*\n\n`
  message += `Order Number: *${orderNumber}*\n`
  message += `Estimated Time: ${estimatedTime} minutes\n\n`
  message += `You'll receive updates here as your order progresses.\n\n`
  message += `*[1]* 🏠 Back to Main Menu\n`
  message += `*[2]* 📋 View My Orders\n\n`
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatError(errorMessage: string) {
  return `❌ *Error*\n\n${errorMessage}\n\n📱 *Powered by BeepBite.io*`
}

export function formatAddressManagement(addresses: any[]) {
  let message = `📍 *My Addresses*\n\n`
  
  if (addresses.length === 0) {
    message += `You don't have any saved addresses yet.\n\n`
    message += `*[1]* ➕ Add New Address\n`
    message += `*[2]* 🏠 Back to Main Menu\n\n`
  } else {
    message += `*Your Saved Addresses:*\n\n`
    
    addresses.forEach((address, index) => {
      const defaultLabel = address.is_default ? ' 🏠 (Default)' : ''
          const fullAddress = address.address_line_1 || 'No address'
    const truncatedAddress = fullAddress.length > 40 
      ? fullAddress.substring(0, 40) + '...'
      : fullAddress
      
      message += `*[${index + 1}]* ${truncatedAddress}${defaultLabel}\n`
    })
    
    message += `\n*[${addresses.length + 1}]* ➕ Add New Address\n`
    message += `*[${addresses.length + 2}]* 🏠 Back to Main Menu\n\n`
  }
  
  message += `📱 *Powered by BeepBite.io*`
  return message
}

export function formatAddressActions(address: any) {
  let message = `📍 *Address Actions*\n\n`
  message += `*Selected Address:*\n`
  message += `${address.address_line_1 || 'No address'}\n\n`
  
  if (address.is_default) {
    message += `🏠 *This is your default address*\n\n`
  }
  
  message += `*What would you like to do?*\n\n`
  
  if (!address.is_default) {
    message += `*[1]* 🏠 Set as Default\n`
    message += `*[2]* 🗑️ Delete Address\n`
    message += `*[3]* 🔙 Back to Address List\n`
    message += `*[4]* 🏠 Main Menu\n\n`
  } else {
    message += `*[1]* 🗑️ Delete Address\n`
    message += `*[2]* 🔙 Back to Address List\n`
    message += `*[3]* 🏠 Main Menu\n\n`
  }
  
  message += `📱 *Powered by BeepBite.io*`
  return message
}

export function formatAddressDeleted() {
  let message = `✅ *Address Deleted Successfully*\n\n`
  message += `The address has been removed from your saved addresses.\n\n`
  return message
}

export function formatAddressSetDefault() {
  let message = `✅ *Default Address Updated*\n\n`
  message += `The address has been set as your default.\n\n`
  message += `*[1]* 📍 Back to Address List\n`
  message += `*[2]* 🏠 Main Menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  return message
}

export function formatAddNewAddressPrompt() {
  let message = `➕ *Add New Address*\n\n`
  message += `Please share your location or type your address:\n\n`
  message += `🌍 *Share Location:* Use the location sharing feature\n`
  message += `✍️ *Type Address:* Write your full address\n\n`
  message += `*[1]* 🔙 Back to Address List\n`
  message += `*[2]* 🏠 Main Menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  return message
}

export function formatAddressAdded(address: any) {
  let message = `✅ *Address Added Successfully*\n\n`
  message += `*New Address:*\n${address.address_line_1 || 'No address'}\n\n`
  message += `*[1]* 🏠 Set as Default\n`
  message += `*[2]* 🗑️ Remove This Address\n`
  message += `*[3]* ➕ Add Another Address\n`
  message += `*[4]* 📍 Back to Address List\n`
  message += `*[5]* 🏠 Main Menu\n\n`
  message += `📱 *Powered by BeepBite.io*`
  return message
}

export function formatLocationSuggestions(suggestions: string[]) {
  let message = `📍 *Address Suggestions*\n\n`
  message += `We found these addresses nearby:\n\n`
  
  suggestions.forEach((suggestion, index) => {
    message += `*[${index + 1}]* ${suggestion}\n`
  })
  
  message += `*[6]* ✏️ Type out address\n`
  message += `*[7]* 🔙 Back to address list\n`
  message += `*[8]* 🏠 Main menu\n\n`
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatProfileView(customer: any) {
  let message = `👤 *My Profile*\n\n`
  
  message += `*Personal Information:*\n`
  message += `First Name: ${customer.first_name || 'Not set'}\n`
  message += `Last Name: ${customer.last_name || 'Not set'}\n`
  message += `Email: ${customer.email || 'Not set'}\n`
  message += `WhatsApp: +${customer.whatsapp_number}\n\n`
  
  message += `*Account Details:*\n`
  message += `Member Since: ${new Date(customer.created_at).toLocaleDateString()}\n\n`
  
  message += `*Options:*\n`
  message += `*[1]* ✏️ Edit Profile\n`
  message += `*[2]* 🏠 Back to Main Menu\n\n`
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatProfileEdit(customer: any) {
  let message = `✏️ *Edit Profile*\n\n`
  
  message += `*Current Information:*\n`
  message += `First Name: ${customer.first_name || 'Not set'}\n`
  message += `Last Name: ${customer.last_name || 'Not set'}\n`
  message += `Email: ${customer.email || 'Not set'}\n\n`
  
  message += `*What would you like to edit?*\n`
  message += `*[1]* First Name\n`
  message += `*[2]* Last Name\n`
  message += `*[3]* Email Address\n`
  message += `*[4]* 🔙 Back to Profile\n`
  message += `*[5]* 🏠 Back to Main Menu\n\n`
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatFieldEdit(fieldName: string, currentValue?: string) {
  let message = `✏️ *Edit ${fieldName}*\n\n`
  
  if (currentValue) {
    message += `Current ${fieldName}: ${currentValue}\n\n`
  } else {
    message += `Current ${fieldName}: Not set\n\n`
  }
  
  if (fieldName === 'Email Address') {
    message += `Please enter your new email address:\n`
    message += `(Example: yourname@email.com)\n\n`
  } else {
    message += `Please enter your new ${fieldName.toLowerCase()}:\n\n`
  }
  
  message += `Type *cancel* to go back without saving.\n\n`
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
}

export function formatProfileUpdated(fieldName: string, newValue: string) {
  let message = `✅ *Profile Updated*\n\n`
  message += `Your ${fieldName.toLowerCase()} has been updated to:\n`
  message += `*${newValue}*\n\n`
  message += `Returning to profile...\n\n`
  
  message += `📱 *Powered by BeepBite.io*`
  
  return message
} 