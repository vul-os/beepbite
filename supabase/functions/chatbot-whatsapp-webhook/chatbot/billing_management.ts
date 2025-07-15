import { ConversationState, updateConversationState } from './conversation_state.ts'
import { 
  getCustomerPaymentMethods,
  deletePaymentMethod,
  setDefaultPaymentMethod,
  getCustomerProfile
} from './database_helpers.ts'
import { 
  formatBillingManagement,
  formatPaymentMethodActions,
  formatPaymentMethodDeleted,
  formatPaymentMethodSetDefault,
  formatAddPaymentMethodEmailRequired,
  formatAddPaymentMethod,
  formatPaymentMethodAdded,
  formatMainMenu,
  formatProfileView,
  formatError 
} from './message_formatter.ts'

export async function handleBillingManagement(
  chatId: string,
  customerId: string,
  messageBody: string,
  state: ConversationState
): Promise<string> {
  switch (state.step) {
    case 'billing_list':
      return await handleBillingList(chatId, customerId, messageBody, state)
      
    case 'billing_actions':
      return await handleBillingActions(chatId, customerId, messageBody, state)
      
    case 'billing_add_email_check':
      return await handleBillingAddEmailCheck(chatId, customerId, messageBody, state)
      
    case 'billing_add':
      return await handleBillingAdd(chatId, customerId, messageBody, state)
      
    case 'billing_added':
      return await handleBillingAdded(chatId, customerId, messageBody, state)
      
    default:
      return formatError('Invalid billing management step')
  }
}

async function handleBillingList(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  // Get payment methods
  const paymentMethods = await getCustomerPaymentMethods(customerId)
  
  if (!isNaN(selectedNumber)) {
    // Check if user selected a payment method
    if (selectedNumber >= 1 && selectedNumber <= paymentMethods.length) {
      const selectedMethod = paymentMethods[selectedNumber - 1]
      
      await updateConversationState(chatId, {
        ...state,
        step: 'billing_actions',
        selected_payment_method_id: selectedMethod.id,
        previous_step: 'billing_list'
      })
      
      return formatPaymentMethodActions(selectedMethod)
    }
    
    // Handle options (Add Payment Method, Back to Main Menu)
    const addOptionNumber = paymentMethods.length + 1
    const backOptionNumber = paymentMethods.length + 2
    
    if (selectedNumber === addOptionNumber) {
      // Add Payment Method - check for email first
      const customer = await getCustomerProfile(customerId)
      if (!customer?.email) {
        await updateConversationState(chatId, {
          ...state,
          step: 'billing_add_email_check',
          previous_step: 'billing_list'
        })
        return formatAddPaymentMethodEmailRequired()
      } else {
        await updateConversationState(chatId, {
          ...state,
          step: 'billing_add',
          previous_step: 'billing_list'
        })
        return formatAddPaymentMethod()
      }
    } else if (selectedNumber === backOptionNumber) {
      // Back to Main Menu
      await updateConversationState(chatId, {
        ...state,
        step: 'main_menu',
        previous_step: 'billing_list'
      })
      return formatMainMenu()
    } else {
      // Invalid selection
      const maxOption = paymentMethods.length === 0 ? 2 : paymentMethods.length + 2
      const errorMessage = formatError(`Please select a valid option (1-${maxOption})`)
      const billingView = formatBillingManagement(paymentMethods)
      return errorMessage + '\n\n' + billingView
    }
  }
  
  // Default: show billing list
  return formatBillingManagement(paymentMethods)
}

async function handleBillingActions(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!state.selected_payment_method_id) {
    return formatError('Payment method not found. Please try again.')
  }
  
  // Get the payment method details
  const paymentMethods = await getCustomerPaymentMethods(customerId)
  const selectedMethod = paymentMethods.find(method => method.id === state.selected_payment_method_id)
  
  if (!selectedMethod) {
    return formatError('Payment method not found. Please try again.')
  }
  
  const isDefault = selectedMethod.is_default
  
  if (!isNaN(selectedNumber)) {
    if (isDefault) {
      // Default card actions: Remove, Back, Main Menu
      switch (selectedNumber) {
        case 1: // Remove Card
          const deleteResult = await deletePaymentMethod(customerId, state.selected_payment_method_id)
          if (deleteResult.success) {
            const updatedPaymentMethods = await getCustomerPaymentMethods(customerId)
            await updateConversationState(chatId, {
              ...state,
              step: 'billing_list',
              selected_payment_method_id: undefined,
              previous_step: 'billing_actions'
            })
            
            const successMessage = formatPaymentMethodDeleted()
            const billingView = formatBillingManagement(updatedPaymentMethods)
            return successMessage + '\n\n' + billingView
          } else {
            return formatError(deleteResult.error || 'Failed to remove payment method')
          }
          
        case 2: // Back to Payment Methods
          const paymentMethodsBack = await getCustomerPaymentMethods(customerId)
          await updateConversationState(chatId, {
            ...state,
            step: 'billing_list',
            selected_payment_method_id: undefined,
            previous_step: 'billing_actions'
          })
          return formatBillingManagement(paymentMethodsBack)
          
        case 3: // Main Menu
          await updateConversationState(chatId, {
            ...state,
            step: 'main_menu',
            selected_payment_method_id: undefined,
            previous_step: 'billing_actions'
          })
          return formatMainMenu()
          
        default:
          const errorMessage = formatError('Please select a valid option (1-3)')
          const actionsView = formatPaymentMethodActions(selectedMethod)
          return errorMessage + '\n\n' + actionsView
      }
    } else {
      // Non-default card actions: Set Default, Remove, Back, Main Menu
      switch (selectedNumber) {
        case 1: // Set as Default
          const setDefaultResult = await setDefaultPaymentMethod(customerId, state.selected_payment_method_id)
          if (setDefaultResult.success) {
            const updatedPaymentMethods = await getCustomerPaymentMethods(customerId)
            await updateConversationState(chatId, {
              ...state,
              step: 'billing_list',
              selected_payment_method_id: undefined,
              previous_step: 'billing_actions'
            })
            
            const successMessage = formatPaymentMethodSetDefault()
            const billingView = formatBillingManagement(updatedPaymentMethods)
            return successMessage + '\n\n' + billingView
          } else {
            return formatError(setDefaultResult.error || 'Failed to set default payment method')
          }
          
        case 2: // Remove Card
          const deleteResult = await deletePaymentMethod(customerId, state.selected_payment_method_id)
          if (deleteResult.success) {
            const updatedPaymentMethods = await getCustomerPaymentMethods(customerId)
            await updateConversationState(chatId, {
              ...state,
              step: 'billing_list',
              selected_payment_method_id: undefined,
              previous_step: 'billing_actions'
            })
            
            const successMessage = formatPaymentMethodDeleted()
            const billingView = formatBillingManagement(updatedPaymentMethods)
            return successMessage + '\n\n' + billingView
          } else {
            return formatError(deleteResult.error || 'Failed to remove payment method')
          }
          
        case 3: // Back to Payment Methods
          const paymentMethodsBack = await getCustomerPaymentMethods(customerId)
          await updateConversationState(chatId, {
            ...state,
            step: 'billing_list',
            selected_payment_method_id: undefined,
            previous_step: 'billing_actions'
          })
          return formatBillingManagement(paymentMethodsBack)
          
        case 4: // Main Menu
          await updateConversationState(chatId, {
            ...state,
            step: 'main_menu',
            selected_payment_method_id: undefined,
            previous_step: 'billing_actions'
          })
          return formatMainMenu()
          
        default:
          const errorMessage = formatError('Please select a valid option (1-4)')
          const actionsView = formatPaymentMethodActions(selectedMethod)
          return errorMessage + '\n\n' + actionsView
      }
    }
  }
  
  // If not a number, show error with menu
  const errorMessage = formatError('Please select a valid option')
  const actionsView = formatPaymentMethodActions(selectedMethod)
  return errorMessage + '\n\n' + actionsView
}

async function handleBillingAddEmailCheck(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Go to Profile
        const customer = await getCustomerProfile(customerId)
        if (!customer) {
          return formatError('Unable to load profile. Please try again.')
        }
        
        await updateConversationState(chatId, {
          ...state,
          step: 'profile_view',
          previous_step: 'billing_add_email_check'
        })
        
        return formatProfileView(customer)
        
      case 2: // Back to Payment Methods
        const paymentMethods = await getCustomerPaymentMethods(customerId)
        await updateConversationState(chatId, {
          ...state,
          step: 'billing_list',
          previous_step: 'billing_add_email_check'
        })
        return formatBillingManagement(paymentMethods)
        
      case 3: // Back to Main Menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'billing_add_email_check'
        })
        return formatMainMenu()
        
      default:
        const errorMessage = formatError('Please select a valid option (1-3)')
        const emailRequiredView = formatAddPaymentMethodEmailRequired()
        return errorMessage + '\n\n' + emailRequiredView
    }
  }
  
  // If not a number, show error with menu
  const errorMessage = formatError('Please select a valid option')
  const emailRequiredView = formatAddPaymentMethodEmailRequired()
  return errorMessage + '\n\n' + emailRequiredView
}

async function handleBillingAdd(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  const selectedNumber = parseInt(messageBody.trim())
  
  if (!isNaN(selectedNumber)) {
    switch (selectedNumber) {
      case 1: // Get Payment Link
        // TODO: Implement PayStack payment link generation
        // For now, simulate successful addition
        await updateConversationState(chatId, {
          ...state,
          step: 'billing_added',
          previous_step: 'billing_add'
        })
        return formatPaymentMethodAdded()
        
      case 2: // Back to Payment Methods
        const paymentMethods = await getCustomerPaymentMethods(customerId)
        await updateConversationState(chatId, {
          ...state,
          step: 'billing_list',
          previous_step: 'billing_add'
        })
        return formatBillingManagement(paymentMethods)
        
      case 3: // Back to Main Menu
        await updateConversationState(chatId, {
          ...state,
          step: 'main_menu',
          previous_step: 'billing_add'
        })
        return formatMainMenu()
        
      default:
        const errorMessage = formatError('Please select a valid option (1-3)')
        const addPaymentView = formatAddPaymentMethod()
        return errorMessage + '\n\n' + addPaymentView
    }
  }
  
  // If not a number, show error with menu
  const errorMessage = formatError('Please select a valid option')
  const addPaymentView = formatAddPaymentMethod()
  return errorMessage + '\n\n' + addPaymentView
}

async function handleBillingAdded(chatId: string, customerId: string, messageBody: string, state: ConversationState): Promise<string> {
  // After payment method is added, show the updated billing list
  const paymentMethods = await getCustomerPaymentMethods(customerId)
  await updateConversationState(chatId, {
    ...state,
    step: 'billing_list',
    previous_step: 'billing_added'
  })
  return formatBillingManagement(paymentMethods)
} 