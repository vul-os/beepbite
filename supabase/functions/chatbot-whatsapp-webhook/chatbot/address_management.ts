import { ConversationState, updateConversationState } from './conversation_state.ts'
import { 
  getCustomerAddresses, 
  addCustomerAddress,
  deleteCustomerAddress,
  getCustomerAddress,
  setDefaultAddress
} from './database_helpers.ts'
import { 
  formatAddressManagement,
  formatAddressActions,
  formatAddressDeleted,
  formatAddressSetDefault,
  formatAddNewAddressPrompt,
  formatAddressAdded,
  formatMainMenu,
  formatError,
  formatLocationSuggestions
} from './message_formatter.ts'
import { geocodeAddress, reverseGeocode } from '../../utility/mapbox.ts'

export async function handleAddressManagement(
  chatId: string,
  customerId: string,
  messageBody: string,
  state: ConversationState
): Promise<string> {
  switch (state.step) {
    case 'address_list':
      return await handleAddressList(chatId, customerId, messageBody, state)
      
    case 'address_actions':
      return await handleAddressActions(chatId, customerId, messageBody, state)
      
    case 'address_add':
      return await handleAddressAdd(chatId, customerId, messageBody, state)
      
    case 'address_added':
      return await handleAddressAdded(chatId, customerId, messageBody, state)
      
    case 'location_suggestions':
      return await handleLocationSuggestions(chatId, customerId, messageBody, state)
      
    default:
      return formatError('Invalid address management step')
  }
}

async function handleAddressList(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  const addresses = await getCustomerAddresses(customerId)
  
  if (!isNaN(selectedNumber)) {
    if (selectedNumber >= 1 && selectedNumber <= addresses.length) {
      // Selected an existing address
      const selectedAddress = addresses[selectedNumber - 1]
      
      await updateConversationState(chatId, {
        ...state,
        step: 'address_actions',
        selected_address_id: selectedAddress.id,
        previous_step: 'address_list'
      })
      
      return formatAddressActions(selectedAddress)
      
    } else if (selectedNumber === addresses.length + 1) {
      // Add new address
      await updateConversationState(chatId, {
        ...state,
        step: 'address_add',
        previous_step: 'address_list'
      })
      return formatAddNewAddressPrompt()
      
    } else if (selectedNumber === addresses.length + 2) {
      // Back to main menu
      await updateConversationState(chatId, {
        ...state,
        step: 'main_menu',
        previous_step: 'address_list'
      })
      return formatMainMenu()
    }
  }
  
  return formatError('Please select a valid option')
}

async function handleAddressActions(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!state.selected_address_id) {
    return formatError('No address selected')
  }
  
  const address = await getCustomerAddress(customerId, state.selected_address_id)
  if (!address) {
    return formatError('Address not found')
  }
  
  if (!isNaN(selectedNumber)) {
    if (!address.is_default) {
      // Non-default address options
      switch (selectedNumber) {
        case 1: // Set as default
          const defaultResult = await setDefaultAddress(customerId, state.selected_address_id)
          if (defaultResult.success) {
            await updateConversationState(chatId, {
              ...state,
              step: 'address_list',
              selected_address_id: undefined,
              previous_step: 'address_actions'
            })
            return formatAddressSetDefault()
          } else {
            return formatError(defaultResult.error || 'Failed to set default address')
          }
          
        case 2: // Delete address (direct deletion, no confirmation)
          const deleteResult = await deleteCustomerAddress(customerId, state.selected_address_id)
          if (deleteResult.success) {
            // Show success message then address list
            const addresses = await getCustomerAddresses(customerId)
            await updateConversationState(chatId, {
              ...state,
              step: 'address_list',
              selected_address_id: undefined,
              previous_step: 'address_actions'
            })
            
            // Return combined message: success + address list
            const successMessage = formatAddressDeleted()
            const addressListMessage = formatAddressManagement(addresses)
            return successMessage + '\n\n' + addressListMessage
          } else {
            return formatError(deleteResult.error || 'Failed to delete address')
          }
          
        case 3: // Back to address list
          const addresses = await getCustomerAddresses(customerId)
          await updateConversationState(chatId, {
            ...state,
            step: 'address_list',
            selected_address_id: undefined,
            previous_step: 'address_actions'
          })
          return formatAddressManagement(addresses)
          
        case 4: // Main menu
          await updateConversationState(chatId, {
            ...state,
            step: 'main_menu',
            selected_address_id: undefined,
            previous_step: 'address_actions'
          })
          return formatMainMenu()
      }
    } else {
      // Default address options
      switch (selectedNumber) {
        case 1: // Delete address (direct deletion, no confirmation)
          const deleteResult = await deleteCustomerAddress(customerId, state.selected_address_id)
          if (deleteResult.success) {
            // Show success message then address list
            const addresses = await getCustomerAddresses(customerId)
            await updateConversationState(chatId, {
              ...state,
              step: 'address_list',
              selected_address_id: undefined,
              previous_step: 'address_actions'
            })
            
            // Return combined message: success + address list
            const successMessage = formatAddressDeleted()
            const addressListMessage = formatAddressManagement(addresses)
            return successMessage + '\n\n' + addressListMessage
          } else {
            return formatError(deleteResult.error || 'Failed to delete address')
          }
          
        case 2: // Back to address list
          const addresses = await getCustomerAddresses(customerId)
          await updateConversationState(chatId, {
            ...state,
            step: 'address_list',
            selected_address_id: undefined,
            previous_step: 'address_actions'
          })
          return formatAddressManagement(addresses)
          
        case 3: // Main menu
          await updateConversationState(chatId, {
            ...state,
            step: 'main_menu',
            selected_address_id: undefined,
            previous_step: 'address_actions'
          })
          return formatMainMenu()
      }
    }
  }
  
  return formatError('Please select a valid option')
}

async function handleAddressAdd(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const input = messageBody.trim()
  const selectedNumber = parseInt(input)
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Back to address list
        try {
          const addresses = await getCustomerAddresses(customerId)
          await updateConversationState(chatId, {
            ...state,
            step: 'address_list',
            previous_step: 'address_add'
          })
          return formatAddressManagement(addresses)
        } catch (error) {
          console.error('Error getting addresses:', error)
          return formatError('Unable to load addresses. Please try again.')
        }
        
      case 2: // Back to main menu
        try {
          await updateConversationState(chatId, {
            ...state,
            step: 'main_menu',
            previous_step: 'address_add'
          })
          return formatMainMenu()
        } catch (error) {
          console.error('Error returning to main menu:', error)
          return formatError('Unable to return to main menu. Please try again.')
        }
        
      default:
        return formatError('Please share your location or type your address')
    }
  }
  
  // Check if this is a location message
  if (input.startsWith('LOCATION:')) {
    try {
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
        console.log('Address management - Location parsed successfully:', { latitude, longitude, name, address })
        
        // Get 5 nearby address suggestions
        const suggestions = await getNearbyAddressSuggestions(latitude, longitude)
        
        await updateConversationState(chatId, {
          ...state,
          step: 'location_suggestions',
          temp_address_data: {
            coordinates: { latitude, longitude },
            suggestions: suggestions
          },
          previous_step: 'address_add'
        })
        
        return formatLocationSuggestions(suggestions)
      } else {
        console.error('Failed to parse location coordinates in address management:', { latitude, longitude, locationData })
        return formatError('Unable to process your location. Please try typing your address instead.')
      }
    } catch (error) {
      console.error('Error processing location:', error)
      return formatError('Unable to process your location. Please try typing your address instead.')
    }
  }
  
  // Try to geocode the address text
  try {
    const geocodeResult = await geocodeAddress(input)
    
    if (geocodeResult.success && geocodeResult.coordinates) {
      const addResult = await addCustomerAddress(
        customerId,
        geocodeResult.address!,
        geocodeResult.coordinates.latitude,
        geocodeResult.coordinates.longitude
      )
      
      if (addResult.success) {
        await updateConversationState(chatId, {
          ...state,
          step: 'address_added',
          selected_address_id: addResult.address.id,
          previous_step: 'address_add'
        })
        return formatAddressAdded(addResult.address)
      } else {
        console.error('Error adding address:', addResult.error)
        return formatError('Unable to save address. Please try again.')
      }
    }
  } catch (error) {
    console.error('Error geocoding address:', error)
  }
  
  return formatError('Could not find that address. Please try again or share your location.')
}

// New function to get nearby address suggestions
async function getNearbyAddressSuggestions(latitude: number, longitude: number): Promise<string[]> {
  console.log('Getting address suggestions for coordinates:', { latitude, longitude })
  
  try {
    // Use reverse geocoding to get nearby addresses
    const reverseResult = await reverseGeocode(latitude, longitude)
    console.log('Reverse geocoding result:', reverseResult)
    
    if (reverseResult.success) {
      const suggestions: string[] = []
      
      // Add the main address
      if (reverseResult.address) {
        suggestions.push(reverseResult.address)
      }
      
      // Add some generic nearby options (you can enhance this with actual nearby address lookup)
      const baseAddress = reverseResult.address || `${latitude}, ${longitude}`
      suggestions.push(
        `${baseAddress} (Main entrance)`,
        `${baseAddress} (Side entrance)`,
        `${baseAddress} (Back entrance)`,
        `${baseAddress} (Parking area)`
      )
      
      const finalSuggestions = suggestions.slice(0, 5) // Return max 5 suggestions
      console.log('Generated address suggestions:', finalSuggestions)
      return finalSuggestions
    }
  } catch (error) {
    console.error('Error getting address suggestions:', error)
  }
  
  // Fallback suggestions
  const fallbackSuggestions: string[] = [
    `${latitude}, ${longitude} (Current location)`,
    `${latitude}, ${longitude} (Main entrance)`,
    `${latitude}, ${longitude} (Side entrance)`,
    `${latitude}, ${longitude} (Back entrance)`,
    `${latitude}, ${longitude} (Parking area)`
  ]
  
  console.log('Using fallback address suggestions:', fallbackSuggestions)
  return fallbackSuggestions
}

async function handleLocationSuggestions(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    const suggestions = state.temp_address_data?.suggestions || []
    const coordinates = state.temp_address_data?.coordinates
    
    if (selectedNumber >= 1 && selectedNumber <= 5 && suggestions[selectedNumber - 1]) {
      // User selected one of the 5 address suggestions
      const selectedAddress = suggestions[selectedNumber - 1]
      
      try {
        const addResult = await addCustomerAddress(
          customerId,
          selectedAddress,
          coordinates.latitude,
          coordinates.longitude
        )
        
        if (addResult.success) {
          await updateConversationState(chatId, {
            ...state,
            step: 'address_added',
            selected_address_id: addResult.address.id,
            previous_step: 'location_suggestions'
          })
          return formatAddressAdded(addResult.address)
        } else {
          console.error('Error adding selected address:', addResult.error)
          return formatError('Unable to save address. Please try again.')
        }
      } catch (error) {
        console.error('Error saving selected address:', error)
        return formatError('Unable to save address. Please try again.')
      }
      
    } else if (selectedNumber === 6) {
      // Type out address
      await updateConversationState(chatId, {
        ...state,
        step: 'address_add',
        previous_step: 'location_suggestions'
      })
      return formatAddNewAddressPrompt()
      
    } else if (selectedNumber === 7) {
      // Back to address list
      try {
        const addresses = await getCustomerAddresses(customerId)
        await updateConversationState(chatId, {
          ...state,
          step: 'address_list',
          previous_step: 'location_suggestions'
        })
        return formatAddressManagement(addresses)
      } catch (error) {
        console.error('Error getting addresses:', error)
        return formatError('Unable to load addresses. Please try again.')
      }
      
    } else if (selectedNumber === 8) {
      // Main menu
      await updateConversationState(chatId, {
        ...state,
        step: 'main_menu',
        previous_step: 'location_suggestions'
      })
      return formatMainMenu()
    }
  }
  
  return formatError('Please select a valid option')
}

async function handleAddressAdded(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Set as default
        if (state.selected_address_id) {
          const defaultResult = await setDefaultAddress(customerId, state.selected_address_id)
          if (defaultResult.success) {
            const addresses = await getCustomerAddresses(customerId)
            await updateConversationState(chatId, {
              ...state,
              step: 'address_list',
              selected_address_id: undefined,
              previous_step: 'address_added'
            })
            return formatAddressSetDefault()
          } else {
            return formatError(defaultResult.error || 'Failed to set default address')
          }
        }
        break
        
      case 2: // Remove this address
        if (state.selected_address_id) {
          const deleteResult = await deleteCustomerAddress(customerId, state.selected_address_id)
          if (deleteResult.success) {
            // Show success message then address list
            const addresses = await getCustomerAddresses(customerId)
            await updateConversationState(chatId, {
              ...state,
              step: 'address_list',
              selected_address_id: undefined,
              previous_step: 'address_added'
            })
            
            // Return combined message: success + address list
            const successMessage = formatAddressDeleted()
            const addressListMessage = formatAddressManagement(addresses)
            return successMessage + '\n\n' + addressListMessage
          } else {
            return formatError(deleteResult.error || 'Failed to delete address')
          }
        }
        break
        
      case 3: // Add another address
        await updateConversationState(chatId, {
          ...state,
          step: 'address_add',
          selected_address_id: undefined,
          previous_step: 'address_added'
        })
        return formatAddNewAddressPrompt()
        
      case 4: // Back to address list
        const addresses = await getCustomerAddresses(customerId)
        await updateConversationState(chatId, {
          ...state,
          step: 'address_list',
          selected_address_id: undefined,
          previous_step: 'address_added'
        })
        return formatAddressManagement(addresses)
        
      case 5: // Main menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          selected_address_id: undefined,
          previous_step: 'address_added'
        })
        return formatMainMenu()
    }
  }
  
  return formatError('Please select a valid option')
} 