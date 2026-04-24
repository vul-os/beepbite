package chatbot

import (
	"context"
	"fmt"
)

func (s *Service) handleBillingManagement(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	switch state.Step {
	case "billing_list":
		return s.handleBillingList(ctx, chatID, customerID, messageBody, state)
	case "billing_actions":
		return s.handleBillingActions(ctx, chatID, customerID, messageBody, state)
	case "billing_add_email_check":
		return s.handleBillingAddEmailCheck(ctx, chatID, customerID, messageBody, state)
	case "billing_add":
		return s.handleBillingAdd(ctx, chatID, customerID, messageBody, state)
	case "billing_added":
		return s.handleBillingAdded(ctx, chatID, customerID, messageBody, state)
	default:
		return formatError("Invalid billing management step")
	}
}

func (s *Service) handleBillingList(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)

	if hasNum {
		if selectedNumber >= 1 && selectedNumber <= len(paymentMethods) {
			selected := paymentMethods[selectedNumber-1]
			newState := state
			newState.Step = "billing_actions"
			newState.SelectedPaymentMethodID = selected.ID
			newState.PreviousStep = "billing_list"
			s.updateConversationState(ctx, chatID, newState)
			return formatPaymentMethodActions(&selected)
		}
		addOption := len(paymentMethods) + 1
		backOption := len(paymentMethods) + 2

		if selectedNumber == addOption {
			customer := s.getCustomerProfile(ctx, customerID)
			if customer == nil || customer.Email == nil || *customer.Email == "" {
				newState := state
				newState.Step = "billing_add_email_check"
				newState.PreviousStep = "billing_list"
				s.updateConversationState(ctx, chatID, newState)
				return formatAddPaymentMethodEmailRequired()
			}
			newState := state
			newState.Step = "billing_add"
			newState.PreviousStep = "billing_list"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddPaymentMethod()
		} else if selectedNumber == backOption {
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "billing_list"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		}
		maxOption := 2
		if len(paymentMethods) > 0 {
			maxOption = len(paymentMethods) + 2
		}
		return formatError(fmt.Sprintf("Please select a valid option (1-%d)", maxOption)) + "\n\n" + formatBillingManagement(paymentMethods)
	}
	return formatBillingManagement(paymentMethods)
}

func (s *Service) handleBillingActions(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if state.SelectedPaymentMethodID == "" {
		return formatError("Payment method not found. Please try again.")
	}

	paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)
	var selectedMethod *PaymentMethod
	for i := range paymentMethods {
		if paymentMethods[i].ID == state.SelectedPaymentMethodID {
			selectedMethod = &paymentMethods[i]
			break
		}
	}
	if selectedMethod == nil {
		return formatError("Payment method not found. Please try again.")
	}
	isDefault := selectedMethod.IsDefault

	if hasNum {
		if isDefault {
			switch selectedNumber {
			case 1:
				ok, errMsg := s.deletePaymentMethod(ctx, customerID, state.SelectedPaymentMethodID)
				if ok {
					updated := s.getCustomerPaymentMethods(ctx, customerID)
					newState := state
					newState.Step = "billing_list"
					newState.SelectedPaymentMethodID = ""
					newState.PreviousStep = "billing_actions"
					s.updateConversationState(ctx, chatID, newState)
					return formatPaymentMethodDeleted() + "\n\n" + formatBillingManagement(updated)
				}
				if errMsg == "" {
					errMsg = "Failed to remove payment method"
				}
				return formatError(errMsg)
			case 2:
				updated := s.getCustomerPaymentMethods(ctx, customerID)
				newState := state
				newState.Step = "billing_list"
				newState.SelectedPaymentMethodID = ""
				newState.PreviousStep = "billing_actions"
				s.updateConversationState(ctx, chatID, newState)
				return formatBillingManagement(updated)
			case 3:
				newState := state
				newState.Step = "main_menu"
				newState.SelectedPaymentMethodID = ""
				newState.PreviousStep = "billing_actions"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			default:
				return formatError("Please select a valid option (1-3)") + "\n\n" + formatPaymentMethodActions(selectedMethod)
			}
		}
		switch selectedNumber {
		case 1:
			ok, errMsg := s.setDefaultPaymentMethod(ctx, customerID, state.SelectedPaymentMethodID)
			if ok {
				updated := s.getCustomerPaymentMethods(ctx, customerID)
				newState := state
				newState.Step = "billing_list"
				newState.SelectedPaymentMethodID = ""
				newState.PreviousStep = "billing_actions"
				s.updateConversationState(ctx, chatID, newState)
				return formatPaymentMethodSetDefault() + "\n\n" + formatBillingManagement(updated)
			}
			if errMsg == "" {
				errMsg = "Failed to set default payment method"
			}
			return formatError(errMsg)
		case 2:
			ok, errMsg := s.deletePaymentMethod(ctx, customerID, state.SelectedPaymentMethodID)
			if ok {
				updated := s.getCustomerPaymentMethods(ctx, customerID)
				newState := state
				newState.Step = "billing_list"
				newState.SelectedPaymentMethodID = ""
				newState.PreviousStep = "billing_actions"
				s.updateConversationState(ctx, chatID, newState)
				return formatPaymentMethodDeleted() + "\n\n" + formatBillingManagement(updated)
			}
			if errMsg == "" {
				errMsg = "Failed to remove payment method"
			}
			return formatError(errMsg)
		case 3:
			updated := s.getCustomerPaymentMethods(ctx, customerID)
			newState := state
			newState.Step = "billing_list"
			newState.SelectedPaymentMethodID = ""
			newState.PreviousStep = "billing_actions"
			s.updateConversationState(ctx, chatID, newState)
			return formatBillingManagement(updated)
		case 4:
			newState := state
			newState.Step = "main_menu"
			newState.SelectedPaymentMethodID = ""
			newState.PreviousStep = "billing_actions"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatError("Please select a valid option (1-4)") + "\n\n" + formatPaymentMethodActions(selectedMethod)
		}
	}
	return formatError("Please select a valid option") + "\n\n" + formatPaymentMethodActions(selectedMethod)
}

func (s *Service) handleBillingAddEmailCheck(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if hasNum {
		switch selectedNumber {
		case 1:
			customer := s.getCustomerProfile(ctx, customerID)
			if customer == nil {
				return formatError("Unable to load profile. Please try again.")
			}
			newState := state
			newState.Step = "profile_view"
			newState.PreviousStep = "billing_add_email_check"
			s.updateConversationState(ctx, chatID, newState)
			return formatProfileView(customer)
		case 2:
			paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)
			newState := state
			newState.Step = "billing_list"
			newState.PreviousStep = "billing_add_email_check"
			s.updateConversationState(ctx, chatID, newState)
			return formatBillingManagement(paymentMethods)
		case 3:
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "billing_add_email_check"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatError("Please select a valid option (1-3)") + "\n\n" + formatAddPaymentMethodEmailRequired()
		}
	}
	return formatError("Please select a valid option") + "\n\n" + formatAddPaymentMethodEmailRequired()
}

func (s *Service) handleBillingAdd(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if hasNum {
		switch selectedNumber {
		case 1:
			// TODO: PayStack payment link generation. Simulate success for now.
			newState := state
			newState.Step = "billing_added"
			newState.PreviousStep = "billing_add"
			s.updateConversationState(ctx, chatID, newState)
			return formatPaymentMethodAdded()
		case 2:
			paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)
			newState := state
			newState.Step = "billing_list"
			newState.PreviousStep = "billing_add"
			s.updateConversationState(ctx, chatID, newState)
			return formatBillingManagement(paymentMethods)
		case 3:
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "billing_add"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatError("Please select a valid option (1-3)") + "\n\n" + formatAddPaymentMethod()
		}
	}
	return formatError("Please select a valid option") + "\n\n" + formatAddPaymentMethod()
}

func (s *Service) handleBillingAdded(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	_ = messageBody
	paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)
	newState := state
	newState.Step = "billing_list"
	newState.PreviousStep = "billing_added"
	s.updateConversationState(ctx, chatID, newState)
	return formatBillingManagement(paymentMethods)
}
