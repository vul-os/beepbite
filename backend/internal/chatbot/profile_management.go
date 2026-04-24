package chatbot

import (
	"context"
	"regexp"
	"strings"
)

var emailRegex = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func (s *Service) handleProfileManagement(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	switch state.Step {
	case "profile_view":
		return s.handleProfileView(ctx, chatID, customerID, messageBody, state)
	case "profile_edit":
		return s.handleProfileEdit(ctx, chatID, customerID, messageBody, state)
	case "profile_field_edit":
		return s.handleProfileFieldEdit(ctx, chatID, customerID, messageBody, state)
	default:
		return s.handleProfileView(ctx, chatID, customerID, messageBody, state)
	}
}

func (s *Service) handleProfileView(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if hasNum {
		switch selectedNumber {
		case 1:
			customer := s.getCustomerProfile(ctx, customerID)
			if customer == nil {
				return formatError("Unable to load profile. Please try again.")
			}
			newState := state
			newState.Step = "profile_edit"
			newState.PreviousStep = "profile_view"
			s.updateConversationState(ctx, chatID, newState)
			return formatProfileEdit(customer)
		case 2:
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "profile_view"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			customerForError := s.getCustomerProfile(ctx, customerID)
			if customerForError == nil {
				return formatError("Unable to load profile. Please try again.")
			}
			return formatError("Please select 1 to edit profile or 2 for main menu") + "\n\n" + formatProfileView(customerForError)
		}
	}
	customer := s.getCustomerProfile(ctx, customerID)
	if customer == nil {
		return formatError("Unable to load profile. Please try again.")
	}
	return formatProfileView(customer)
}

func (s *Service) handleProfileEdit(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if hasNum {
		customer := s.getCustomerProfile(ctx, customerID)
		if customer == nil {
			return formatError("Unable to load profile. Please try again.")
		}
		switch selectedNumber {
		case 1:
			newState := state
			newState.Step = "profile_field_edit"
			newState.EditingField = "first_name"
			newState.PreviousStep = "profile_edit"
			s.updateConversationState(ctx, chatID, newState)
			current := ""
			if customer.FirstName != nil {
				current = *customer.FirstName
			}
			return formatFieldEdit("First Name", current)
		case 2:
			newState := state
			newState.Step = "profile_field_edit"
			newState.EditingField = "last_name"
			newState.PreviousStep = "profile_edit"
			s.updateConversationState(ctx, chatID, newState)
			current := ""
			if customer.LastName != nil {
				current = *customer.LastName
			}
			return formatFieldEdit("Last Name", current)
		case 3:
			newState := state
			newState.Step = "profile_field_edit"
			newState.EditingField = "email"
			newState.PreviousStep = "profile_edit"
			s.updateConversationState(ctx, chatID, newState)
			current := ""
			if customer.Email != nil {
				current = *customer.Email
			}
			return formatFieldEdit("Email Address", current)
		case 4:
			newState := state
			newState.Step = "profile_view"
			newState.PreviousStep = "profile_edit"
			s.updateConversationState(ctx, chatID, newState)
			return formatProfileView(customer)
		case 5:
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "profile_edit"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatError("Please select a valid option (1-5)") + "\n\n" + formatProfileEdit(customer)
		}
	}
	customer := s.getCustomerProfile(ctx, customerID)
	if customer == nil {
		return formatError("Unable to load profile. Please try again.")
	}
	return formatError("Please select a valid option") + "\n\n" + formatProfileEdit(customer)
}

func (s *Service) handleProfileFieldEdit(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	input := strings.TrimSpace(messageBody)

	if strings.EqualFold(input, "cancel") {
		customer := s.getCustomerProfile(ctx, customerID)
		if customer == nil {
			return formatError("Unable to load profile. Please try again.")
		}
		newState := state
		newState.Step = "profile_edit"
		newState.EditingField = ""
		newState.PreviousStep = "profile_field_edit"
		s.updateConversationState(ctx, chatID, newState)
		return formatProfileEdit(customer)
	}

	if state.EditingField == "email" && input != "" {
		if !emailRegex.MatchString(input) {
			customer := s.getCustomerProfile(ctx, customerID)
			current := ""
			if customer != nil && customer.Email != nil {
				current = *customer.Email
			}
			return formatError("Please enter a valid email address (e.g., yourname@email.com)") + "\n\n" + formatFieldEdit("Email Address", current)
		}
	}

	if input == "" {
		customer := s.getCustomerProfile(ctx, customerID)
		fieldName := "Email Address"
		switch state.EditingField {
		case "first_name":
			fieldName = "First Name"
		case "last_name":
			fieldName = "Last Name"
		}
		var current string
		if customer != nil {
			switch state.EditingField {
			case "first_name":
				if customer.FirstName != nil {
					current = *customer.FirstName
				}
			case "last_name":
				if customer.LastName != nil {
					current = *customer.LastName
				}
			case "email":
				if customer.Email != nil {
					current = *customer.Email
				}
			}
		}
		return formatError(`Please enter a value or type "cancel" to go back`) + "\n\n" + formatFieldEdit(fieldName, current)
	}

	updates := profileUpdates{}
	fieldDisplayName := ""
	switch state.EditingField {
	case "first_name":
		updates.FirstName = &input
		fieldDisplayName = "first name"
	case "last_name":
		updates.LastName = &input
		fieldDisplayName = "last name"
	case "email":
		updates.Email = &input
		fieldDisplayName = "email"
	}

	result := s.updateCustomerProfile(ctx, customerID, updates)
	if !result.Success {
		customer := s.getCustomerProfile(ctx, customerID)
		fieldName := "Email Address"
		switch state.EditingField {
		case "first_name":
			fieldName = "First Name"
		case "last_name":
			fieldName = "Last Name"
		}
		var current string
		if customer != nil {
			switch state.EditingField {
			case "first_name":
				if customer.FirstName != nil {
					current = *customer.FirstName
				}
			case "last_name":
				if customer.LastName != nil {
					current = *customer.LastName
				}
			case "email":
				if customer.Email != nil {
					current = *customer.Email
				}
			}
		}
		return formatError("Failed to update profile. Please try again.") + "\n\n" + formatFieldEdit(fieldName, current)
	}

	newState := state
	newState.Step = "profile_view"
	newState.EditingField = ""
	newState.PreviousStep = "profile_field_edit"
	s.updateConversationState(ctx, chatID, newState)

	successMsg := formatProfileUpdated(fieldDisplayName, input)
	updatedCustomer := s.getCustomerProfile(ctx, customerID)
	if updatedCustomer != nil {
		return successMsg + "\n\n" + formatProfileView(updatedCustomer)
	}
	return successMsg
}
