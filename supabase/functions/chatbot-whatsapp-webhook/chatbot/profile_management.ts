import { ConversationState, updateConversationState } from './conversation_state.ts'
import { getCustomerProfile, updateCustomerProfile } from './database_helpers.ts'
import { 
  formatProfileView, 
  formatProfileEdit, 
  formatFieldEdit, 
  formatProfileUpdated,
  formatMainMenu,
  formatError 
} from './message_formatter.ts'

export async function handleProfileManagement(
  chatId: string,
  customerId: string,
  messageBody: string,
  state: ConversationState
): Promise<string> {
  switch (state.step) {
    case 'profile_view':
      return await handleProfileView(chatId, customerId, messageBody, state)
      
    case 'profile_edit':
      return await handleProfileEdit(chatId, customerId, messageBody, state)
      
    case 'profile_field_edit':
      return await handleProfileFieldEdit(chatId, customerId, messageBody, state)
      
    default:
      // Default to profile view
      return await handleProfileView(chatId, customerId, messageBody, state)
  }
}

async function handleProfileView(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Edit Profile
        const customer = await getCustomerProfile(customerId)
        if (!customer) {
          return formatError('Unable to load profile. Please try again.')
        }
        
        await updateConversationState(chatId, {
          ...state,
          step: 'profile_edit',
          previous_step: 'profile_view'
        })
        
        return formatProfileEdit(customer)
        
      case 2: // Back to Main Menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'profile_view'
        })
        
        return formatMainMenu()
        
      default:
        const customerForError = await getCustomerProfile(customerId)
        if (!customerForError) {
          return formatError('Unable to load profile. Please try again.')
        }
        
        const errorMessage = formatError('Please select 1 to edit profile or 2 for main menu')
        const profileView = formatProfileView(customerForError)
        return errorMessage + '\n\n' + profileView
    }
  }
  
  // Default: show profile view
  const customer = await getCustomerProfile(customerId)
  if (!customer) {
    return formatError('Unable to load profile. Please try again.')
  }
  
  return formatProfileView(customer)
}

async function handleProfileEdit(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    const customer = await getCustomerProfile(customerId)
    if (!customer) {
      return formatError('Unable to load profile. Please try again.')
    }
    
    switch (selectedNumber) {
      case 1: // Edit First Name
        await updateConversationState(chatId, {
          ...state,
          step: 'profile_field_edit',
          editing_field: 'first_name',
          previous_step: 'profile_edit'
        })
        
        return formatFieldEdit('First Name', customer.first_name)
        
      case 2: // Edit Last Name
        await updateConversationState(chatId, {
          ...state,
          step: 'profile_field_edit',
          editing_field: 'last_name',
          previous_step: 'profile_edit'
        })
        
        return formatFieldEdit('Last Name', customer.last_name)
        
      case 3: // Edit Email
        await updateConversationState(chatId, {
          ...state,
          step: 'profile_field_edit',
          editing_field: 'email',
          previous_step: 'profile_edit'
        })
        
        return formatFieldEdit('Email Address', customer.email)
        
      case 4: // Back to Profile
        await updateConversationState(chatId, {
          ...state,
          step: 'profile_view',
          previous_step: 'profile_edit'
        })
        
        return formatProfileView(customer)
        
      case 5: // Back to Main Menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'profile_edit'
        })
        
        return formatMainMenu()
        
      default:
        const errorMessage = formatError('Please select a valid option (1-5)')
        const editView = formatProfileEdit(customer)
        return errorMessage + '\n\n' + editView
    }
  }
  
  // If not a number, show error with menu
  const customer = await getCustomerProfile(customerId)
  if (!customer) {
    return formatError('Unable to load profile. Please try again.')
  }
  
  const errorMessage = formatError('Please select a valid option')
  const editView = formatProfileEdit(customer)
  return errorMessage + '\n\n' + editView
}

async function handleProfileFieldEdit(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const input = messageBody.trim()
  
  // Check for cancel
  if (input.toLowerCase() === 'cancel') {
    const customer = await getCustomerProfile(customerId)
    if (!customer) {
      return formatError('Unable to load profile. Please try again.')
    }
    
    await updateConversationState(chatId, {
      ...state,
      step: 'profile_edit',
      editing_field: undefined,
      previous_step: 'profile_field_edit'
    })
    
    return formatProfileEdit(customer)
  }
  
  // Validate input based on field type
  if (state.editing_field === 'email' && input) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(input)) {
      const customer = await getCustomerProfile(customerId)
      const errorMessage = formatError('Please enter a valid email address (e.g., yourname@email.com)')
      const fieldEdit = formatFieldEdit('Email Address', customer?.email)
      return errorMessage + '\n\n' + fieldEdit
    }
  }
  
  if (!input || input.length < 1) {
    const customer = await getCustomerProfile(customerId)
    const fieldName = state.editing_field === 'first_name' ? 'First Name' : 
                     state.editing_field === 'last_name' ? 'Last Name' : 'Email Address'
    const currentValue = state.editing_field === 'first_name' ? customer?.first_name :
                        state.editing_field === 'last_name' ? customer?.last_name : customer?.email
    
    const errorMessage = formatError('Please enter a value or type "cancel" to go back')
    const fieldEdit = formatFieldEdit(fieldName, currentValue)
    return errorMessage + '\n\n' + fieldEdit
  }
  
  // Update the profile
  const updates: any = {}
  let fieldDisplayName = ''
  
  switch (state.editing_field) {
    case 'first_name':
      updates.first_name = input
      fieldDisplayName = 'first name'
      break
    case 'last_name':
      updates.last_name = input
      fieldDisplayName = 'last name'
      break
    case 'email':
      updates.email = input
      fieldDisplayName = 'email'
      break
  }
  
  const result = await updateCustomerProfile(customerId, updates)
  
  if (!result.success) {
    const customer = await getCustomerProfile(customerId)
    const fieldName = state.editing_field === 'first_name' ? 'First Name' : 
                     state.editing_field === 'last_name' ? 'Last Name' : 'Email Address'
    const currentValue = state.editing_field === 'first_name' ? customer?.first_name :
                        state.editing_field === 'last_name' ? customer?.last_name : customer?.email
    
    const errorMessage = formatError('Failed to update profile. Please try again.')
    const fieldEdit = formatFieldEdit(fieldName, currentValue)
    return errorMessage + '\n\n' + fieldEdit
  }
  
  // Success! Show confirmation and return to profile view
  await updateConversationState(chatId, {
    ...state,
    step: 'profile_view',
    editing_field: undefined,
    previous_step: 'profile_field_edit'
  })
  
  const successMessage = formatProfileUpdated(fieldDisplayName, input)
  const updatedCustomer = await getCustomerProfile(customerId)
  
  if (updatedCustomer) {
    return successMessage + '\n\n' + formatProfileView(updatedCustomer)
  } else {
    return successMessage
  }
} 