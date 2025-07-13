import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

export async function getOrCreateCustomer(whatsappNumber: string, displayName?: string) {
  const normalizedNumber = whatsappNumber.startsWith('+') ? whatsappNumber.substring(1) : whatsappNumber
  
  const { data: existingCustomer, error } = await supabase
    .from('customers')
    .select('*')
    .eq('whatsapp_number', normalizedNumber)
    .single()
    
  if (existingCustomer && !error) {
    // If existing customer doesn't have a first_name but we have displayName, update it
    if (!existingCustomer.first_name && displayName) {
      console.log(`Updating customer ${existingCustomer.id} with first_name: ${displayName}`)
      const { data: updatedCustomer, error: updateError } = await supabase
        .from('customers')
        .update({ 
          first_name: displayName,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingCustomer.id)
        .select('*')
        .single()
        
      if (!updateError && updatedCustomer) {
        return updatedCustomer
      } else {
        console.error('Error updating customer name:', updateError)
        return existingCustomer // Return original if update fails
      }
    }
    return existingCustomer
  }
  
  const { data: newCustomer, error: createError } = await supabase
    .from('customers')
    .insert({
      whatsapp_number: normalizedNumber,
      first_name: displayName || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select('*')
    .single()
    
  if (createError) {
    console.error('Error creating customer:', createError)
    return null
  }
  
  return newCustomer
}

export async function getCustomerAddresses(customerId: string) {
  const { data: addresses, error } = await supabase
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', customerId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false })
    
  if (error) {
    console.error('Error getting customer addresses:', error)
    return []
  }
  
  return addresses || []
}

export async function getNearbyStores(latitude: number, longitude: number, maxDistance: number = 10) {
  // Calculate approximate lat/lng bounds for the distance
  const latDelta = maxDistance / 111  // Roughly 111 km per degree latitude
  const lngDelta = maxDistance / (111 * Math.cos(latitude * Math.PI / 180))
  
  const { data: stores, error } = await supabase
    .from('locations')
    .select('*')
    .gte('latitude', latitude - latDelta)
    .lte('latitude', latitude + latDelta)
    .gte('longitude', longitude - lngDelta)
    .lte('longitude', longitude + lngDelta)
    .eq('is_active', true)
    .order('name')
    
  if (error) {
    console.error('Error getting nearby stores:', error)
    return []
  }
  
  return stores || []
}

export async function getStoresBySearch(searchTerm: string) {
  const { data: stores, error } = await supabase
    .from('locations')
    .select('*')
    .ilike('name', `%${searchTerm}%`)
    .eq('is_active', true)
    .order('name')
    .limit(10)
    
  if (error) {
    console.error('Error searching stores:', error)
    return []
  }
  
  return stores || []
}

export async function getStoreMenu(locationId: string) {
  const { data: categories, error } = await supabase
    .from('categories')
    .select(`
      *,
      items (
        *,
        item_variations (
          *,
          item_variation_options (*)
        )
      )
    `)
    .eq('location_id', locationId)
    .eq('is_active', true)
    .order('sort_order')
    
  if (error) {
    console.error('Error getting store menu:', error)
    return []
  }
  
  return categories || []
}

export async function getMenuItem(itemId: string) {
  const { data: item, error } = await supabase
    .from('items')
    .select(`
      *,
      item_variations (
        *,
        item_variation_options (*)
      )
    `)
    .eq('id', itemId)
    .eq('is_active', true)
    .single()
    
  if (error) {
    console.error('Error getting menu item:', error)
    return null
  }
  
  return item
}

export async function addToCart(customerId: string, locationId: string, itemId: string, quantity: number = 1, variations: any = {}, specialInstructions?: string) {
  const { data: item, error: itemError } = await supabase
    .from('items')
    .select('price')
    .eq('id', itemId)
    .single()
    
  if (itemError || !item) {
    console.error('Error getting item for cart:', itemError)
    return false
  }
  
  let totalPrice = parseFloat(item.price) * quantity
  
  // Add variation price modifiers
  for (const [variationId, optionId] of Object.entries(variations)) {
    const { data: option, error: optionError } = await supabase
      .from('item_variation_options')
      .select('price_modifier')
      .eq('id', optionId)
      .single()
      
    if (!optionError && option) {
      totalPrice += parseFloat(option.price_modifier || 0) * quantity
    }
  }
  
  const { data: cartItem, error } = await supabase
    .from('cart_items')
    .insert({
      customer_id: customerId,
      location_id: locationId,
      item_id: itemId,
      quantity: quantity,
      unit_price: item.price,
      total_price: totalPrice,
      special_instructions: specialInstructions
    })
    .select('id')
    .single()
    
  if (error) {
    console.error('Error adding to cart:', error)
    return false
  }
  
  // Add variations
  for (const [variationId, optionId] of Object.entries(variations)) {
    const { data: option, error: optionError } = await supabase
      .from('item_variation_options')
      .select('price_modifier')
      .eq('id', optionId)
      .single()
      
    if (!optionError && option) {
      await supabase
        .from('cart_item_variations')
        .insert({
          cart_item_id: cartItem.id,
          variation_id: variationId,
          option_id: optionId,
          price_modifier: option.price_modifier || 0
        })
    }
  }
  
  return true
}

export async function getCartItems(customerId: string, locationId: string) {
  let query = supabase
    .from('cart_items')
    .select(`
      *,
      items (
        id,
        name,
        description,
        price
      ),
      cart_item_variations (
        *,
        item_variations (
          name
        ),
        item_variation_options (
          name,
          price_modifier
        )
      )
    `)
    .eq('customer_id', customerId)
    .order('created_at')
    
  // If locationId is provided and not empty, filter by location
  if (locationId && locationId.trim() !== '') {
    query = query.eq('location_id', locationId)
  }
    
  const { data: cartItems, error } = await query
    
  if (error) {
    console.error('Error getting cart items:', error)
    return []
  }
  
  return cartItems || []
}

export async function clearCart(customerId: string, locationId: string) {
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
}

export async function getCartSummary(customerId: string, locationId: string) {
  const { data: summary, error } = await supabase
    .from('cart_summary')
    .select('*')
    .eq('customer_id', customerId)
    .eq('location_id', locationId)
    .single()
    
  if (error) {
    console.error('Error getting cart summary:', error)
    return null
  }
  
  return summary
}

export async function getCustomerPaymentMethods(customerId: string) {
  const { data: paymentMethods, error } = await supabase
    .rpc('get_customer_payment_methods', { customer_uuid: customerId })
    
  if (error) {
    console.error('Error getting customer payment methods:', error)
    return []
  }
  
  return paymentMethods || []
}

export async function deletePaymentMethod(customerId: string, paymentMethodId: string) {
  const { data, error } = await supabase
    .rpc('deactivate_payment_method', { 
      customer_uuid: customerId, 
      authorization_uuid: paymentMethodId 
    })
    
  if (error) {
    console.error('Error deleting payment method:', error)
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

export async function setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
  const { data, error } = await supabase
    .rpc('set_default_payment_method', { 
      customer_uuid: customerId, 
      authorization_uuid: paymentMethodId 
    })
    
  if (error) {
    console.error('Error setting default payment method:', error)
    return { success: false, error: error.message }
  }
  
  return { success: true }
}

export async function addPaymentMethod(customerId: string, paymentData: {
  gateway_provider: string
  authorization_code: string
  card_last_four?: string
  card_type?: string
  card_exp_month?: string
  card_exp_year?: string
  nickname?: string
}) {
  const { data: paymentMethod, error } = await supabase
    .from('customer_payment_authorizations')
    .insert({
      customer_id: customerId,
      payment_method_code: 'card', // Assuming card payment
      gateway_provider: paymentData.gateway_provider,
      authorization_code: paymentData.authorization_code,
      card_last_four: paymentData.card_last_four,
      card_type: paymentData.card_type,
      card_exp_month: paymentData.card_exp_month,
      card_exp_year: paymentData.card_exp_year,
      nickname: paymentData.nickname,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select('*')
    .single()
    
  if (error) {
    console.error('Error adding payment method:', error)
    return { success: false, error: error.message }
  }
  
  return { success: true, paymentMethod }
}

export async function getStoreInfo(locationId: string) {
  const { data: store, error } = await supabase
    .from('locations')
    .select('*')
    .eq('id', locationId)
    .single()
    
  if (error) {
    console.error('Error getting store info:', error)
    return null
  }
  
  return store
}

export async function createOrder(
  customerId: string,
  locationId: string,
  orderType: 'delivery' | 'pickup' | 'whatsapp',
  addressData?: {
    address: string,
    latitude?: number,
    longitude?: number,
    instructions?: string
  },
  tipAmount: number = 0,
  customerEmail?: string
) {
  console.log('=== CREATING ORDER ===')
  console.log('Customer ID:', customerId)
  console.log('Location ID:', locationId)
  console.log('Order Type:', orderType)
  console.log('Address Data:', addressData)
  console.log('Tip Amount:', tipAmount)
  console.log('Customer Email:', customerEmail)
  
  try {
    // Get cart items
    const cartItems = await getCartItems(customerId, locationId)
    console.log('Cart Items:', cartItems.length)
    
    if (cartItems.length === 0) {
      console.error('Cannot create order: Cart is empty')
      return { success: false, error: 'Cart is empty' }
    }
    
    // Get cart summary for pricing
    const cartSummary = await getCartSummary(customerId, locationId)
    console.log('Cart Summary:', cartSummary)
    
    // Generate order number
    const orderNumber = `WA${Date.now().toString().slice(-8)}` // WhatsApp order with last 8 digits of timestamp
    console.log('Generated Order Number:', orderNumber)
    
    // Calculate financial details
    const subtotal = cartSummary.subtotal
    const deliveryFee = cartSummary.delivery_fee || 0
    const taxRate = 15.00 // VAT percentage
    const taxAmount = subtotal * (taxRate / 100)
    const totalAmount = subtotal + deliveryFee + tipAmount
    
    console.log('Financial Details:', {
      subtotal,
      deliveryFee,
      taxRate,
      taxAmount,
      tipAmount,
      totalAmount
    })
    
    // Step 1: Create main order record
    console.log('Step 1: Creating main order record...')
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        location_id: locationId,
        customer_id: customerId,
        order_number: orderNumber,
        order_type: orderType,
        status: 'pending'
      })
      .select('*')
      .single()
    
    if (orderError) {
      console.error('Error creating order:', orderError)
      return { success: false, error: 'Failed to create order' }
    }
    
    console.log('Order created successfully:', order.id)
    
    // Step 2: Create order details
    console.log('Step 2: Creating order details...')
    const orderDetailsData: any = {
      order_id: order.id,
      estimated_prep_time: 30, // Default 30 minutes
      notes: customerEmail ? `Customer email: ${customerEmail}` : null
    }
    
    if (orderType === 'delivery' && addressData) {
      orderDetailsData.delivery_address = addressData.address
      orderDetailsData.delivery_latitude = addressData.latitude
      orderDetailsData.delivery_longitude = addressData.longitude
      orderDetailsData.delivery_instructions = addressData.instructions
    }
    
    const { error: detailsError } = await supabase
      .from('order_details')
      .insert(orderDetailsData)
    
    if (detailsError) {
      console.error('Error creating order details:', detailsError)
      // Try to clean up main order
      await supabase.from('orders').delete().eq('id', order.id)
      return { success: false, error: 'Failed to create order details' }
    }
    
    console.log('Order details created successfully')
    
    // Step 3: Create financial details
    console.log('Step 3: Creating financial details...')
    const { error: financialError } = await supabase
      .from('order_financial_details')
      .insert({
        order_id: order.id,
        subtotal: subtotal,
        delivery_fee: deliveryFee,
        total_amount: totalAmount,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        tax_inclusive: true,
        payment_status: 'pending',
        payment_method: 'card' // Assume card payment for WhatsApp orders
      })
    
    if (financialError) {
      console.error('Error creating financial details:', financialError)
      // Try to clean up
      await supabase.from('order_details').delete().eq('order_id', order.id)
      await supabase.from('orders').delete().eq('id', order.id)
      return { success: false, error: 'Failed to create financial details' }
    }
    
    console.log('Financial details created successfully')
    
    // Step 4: Create order items
    console.log('Step 4: Creating order items...')
    for (const cartItem of cartItems) {
      console.log('Processing cart item:', cartItem.id)
      
      const { error: itemError } = await supabase
        .from('order_items')
        .insert({
          order_id: order.id,
          item_id: cartItem.item_id,
          quantity: cartItem.quantity,
          unit_price: cartItem.unit_price,
          total_price: cartItem.total_price,
          special_instructions: cartItem.special_instructions
        })
      
      if (itemError) {
        console.error('Error creating order item:', itemError)
        // Clean up everything
        await supabase.from('order_financial_details').delete().eq('order_id', order.id)
        await supabase.from('order_details').delete().eq('order_id', order.id)
        await supabase.from('orders').delete().eq('id', order.id)
        return { success: false, error: 'Failed to create order items' }
      }
      
      // TODO: Handle item variations if needed
    }
    
    console.log('Order items created successfully')
    
    // Step 5: Clear the cart
    console.log('Step 5: Clearing cart...')
    await clearCart(customerId, locationId)
    console.log('Cart cleared successfully')
    
    console.log('=== ORDER CREATION COMPLETED ===')
    console.log('Order ID:', order.id)
    console.log('Order Number:', orderNumber)
    
    return {
      success: true,
      orderId: order.id,
      orderNumber: orderNumber,
      totalAmount: totalAmount
    }
    
  } catch (error) {
    console.error('=== ORDER CREATION FAILED ===')
    console.error('Unexpected error:', error)
    return { success: false, error: 'Unexpected error during order creation' }
  }
}

export async function addCustomerAddress(
  customerId: string,
  address: string,
  latitude: number,
  longitude: number,
  isDefault: boolean = false
) {
  try {
    // If this is being set as default, remove default from all other addresses
    if (isDefault) {
      await supabase
        .from('customer_addresses')
        .update({ is_default: false })
        .eq('customer_id', customerId)
    }
    
    const { data: newAddress, error } = await supabase
      .from('customer_addresses')
      .insert({
        customer_id: customerId,
        address_line_1: address,
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        is_default: isDefault
      })
      .select('*')
      .single()
      
    if (error) {
      console.error('Error adding customer address:', error)
      return { success: false, error: error.message }
    }
    
    return { success: true, address: newAddress }
  } catch (error) {
    console.error('Error adding customer address:', error)
    return { success: false, error: 'Failed to add address' }
  }
}

export async function deleteCustomerAddress(customerId: string, addressId: string) {
  try {
    const { error } = await supabase
      .from('customer_addresses')
      .delete()
      .eq('customer_id', customerId)
      .eq('id', addressId)
      
    if (error) {
      console.error('Error deleting customer address:', error)
      return { success: false, error: error.message }
    }
    
    return { success: true }
  } catch (error) {
    console.error('Error deleting customer address:', error)
    return { success: false, error: 'Failed to delete address' }
  }
}

export async function getCustomerAddress(customerId: string, addressId: string) {
  const { data: address, error } = await supabase
    .from('customer_addresses')
    .select('*')
    .eq('customer_id', customerId)
    .eq('id', addressId)
    .single()
    
  if (error) {
    console.error('Error getting customer address:', error)
    return null
  }
  
  return address
}

export async function setDefaultAddress(customerId: string, addressId: string) {
  // First, remove default from all other addresses
  await supabase
    .from('customer_addresses')
    .update({ is_default: false })
    .eq('customer_id', customerId)
  
  // Then set the new default
  const { error } = await supabase
    .from('customer_addresses')
    .update({ is_default: true })
    .eq('id', addressId)
    .eq('customer_id', customerId)
  
  if (error) {
    console.error('Error setting default address:', error)
    return { success: false, error: 'Failed to set default address' }
  }
  
  return { success: true }
}

export async function getActiveOrdersCount(customerId: string): Promise<number> {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id')
    .eq('customer_id', customerId)
    .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'])
  
  if (error) {
    console.error('Error getting active orders count:', error)
    return 0
  }
  
  return orders?.length || 0
}

export async function getCustomerProfile(customerId: string) {
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id, whatsapp_number, first_name, last_name, email, created_at')
    .eq('id', customerId)
    .single()
    
  if (error) {
    console.error('Error getting customer profile:', error)
    return null
  }
  
  return customer
}

export async function updateCustomerProfile(customerId: string, updates: {
  first_name?: string
  last_name?: string  
  email?: string
}) {
  const { data: customer, error } = await supabase
    .from('customers')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', customerId)
    .select('*')
    .single()
    
  if (error) {
    console.error('Error updating customer profile:', error)
    return { success: false, error: error.message }
  }
  
  return { success: true, customer }
} 