package chatbot

import (
	"context"
	"fmt"
	"log"
	"strings"
)

func (s *Service) handleAddressManagement(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	switch state.Step {
	case "address_list":
		return s.handleAddressList(ctx, chatID, customerID, messageBody, state)
	case "address_actions":
		return s.handleAddressActions(ctx, chatID, customerID, messageBody, state)
	case "address_add":
		return s.handleAddressAdd(ctx, chatID, customerID, messageBody, state)
	case "address_added":
		return s.handleAddressAdded(ctx, chatID, customerID, messageBody, state)
	case "location_suggestions":
		return s.handleLocationSuggestions(ctx, chatID, customerID, messageBody, state)
	default:
		return formatError("Invalid address management step")
	}
}

func (s *Service) handleAddressList(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	addresses := s.getCustomerAddresses(ctx, customerID)

	if hasNum {
		if selectedNumber >= 1 && selectedNumber <= len(addresses) {
			selected := addresses[selectedNumber-1]
			newState := state
			newState.Step = "address_actions"
			newState.SelectedAddressID = selected.ID
			newState.PreviousStep = "address_list"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddressActions(&selected)
		} else if selectedNumber == len(addresses)+1 {
			newState := state
			newState.Step = "address_add"
			newState.PreviousStep = "address_list"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddNewAddressPrompt()
		} else if selectedNumber == len(addresses)+2 {
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "address_list"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		}
	}
	return formatError("Please select a valid option")
}

func (s *Service) handleAddressActions(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if state.SelectedAddressID == "" {
		return formatError("No address selected")
	}
	address := s.getCustomerAddress(ctx, customerID, state.SelectedAddressID)
	if address == nil {
		return formatError("Address not found")
	}

	if hasNum {
		if !address.IsDefault {
			switch selectedNumber {
			case 1:
				ok, errMsg := s.setDefaultAddress(ctx, customerID, state.SelectedAddressID)
				if ok {
					newState := state
					newState.Step = "address_list"
					newState.SelectedAddressID = ""
					newState.PreviousStep = "address_actions"
					s.updateConversationState(ctx, chatID, newState)
					return formatAddressSetDefault()
				}
				if errMsg == "" {
					errMsg = "Failed to set default address"
				}
				return formatError(errMsg)
			case 2:
				ok, errMsg := s.deleteCustomerAddress(ctx, customerID, state.SelectedAddressID)
				if ok {
					addrs := s.getCustomerAddresses(ctx, customerID)
					newState := state
					newState.Step = "address_list"
					newState.SelectedAddressID = ""
					newState.PreviousStep = "address_actions"
					s.updateConversationState(ctx, chatID, newState)
					return formatAddressDeleted() + "\n\n" + formatAddressManagement(addrs)
				}
				if errMsg == "" {
					errMsg = "Failed to delete address"
				}
				return formatError(errMsg)
			case 3:
				addrs := s.getCustomerAddresses(ctx, customerID)
				newState := state
				newState.Step = "address_list"
				newState.SelectedAddressID = ""
				newState.PreviousStep = "address_actions"
				s.updateConversationState(ctx, chatID, newState)
				return formatAddressManagement(addrs)
			case 4:
				newState := state
				newState.Step = "main_menu"
				newState.SelectedAddressID = ""
				newState.PreviousStep = "address_actions"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			}
		} else {
			switch selectedNumber {
			case 1:
				ok, errMsg := s.deleteCustomerAddress(ctx, customerID, state.SelectedAddressID)
				if ok {
					addrs := s.getCustomerAddresses(ctx, customerID)
					newState := state
					newState.Step = "address_list"
					newState.SelectedAddressID = ""
					newState.PreviousStep = "address_actions"
					s.updateConversationState(ctx, chatID, newState)
					return formatAddressDeleted() + "\n\n" + formatAddressManagement(addrs)
				}
				if errMsg == "" {
					errMsg = "Failed to delete address"
				}
				return formatError(errMsg)
			case 2:
				addrs := s.getCustomerAddresses(ctx, customerID)
				newState := state
				newState.Step = "address_list"
				newState.SelectedAddressID = ""
				newState.PreviousStep = "address_actions"
				s.updateConversationState(ctx, chatID, newState)
				return formatAddressManagement(addrs)
			case 3:
				newState := state
				newState.Step = "main_menu"
				newState.SelectedAddressID = ""
				newState.PreviousStep = "address_actions"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			}
		}
	}
	return formatError("Please select a valid option")
}

func (s *Service) handleAddressAdd(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	input := strings.TrimSpace(messageBody)
	selectedNumber, hasNum := parseIntTrim(input)

	if hasNum {
		switch selectedNumber {
		case 1:
			addrs := s.getCustomerAddresses(ctx, customerID)
			newState := state
			newState.Step = "address_list"
			newState.PreviousStep = "address_add"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddressManagement(addrs)
		case 2:
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "address_add"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatError("Please share your location or type your address")
		}
	}

	if strings.HasPrefix(input, "LOCATION:") {
		lat, lng, ok := parseLocationMessage(input)
		if !ok {
			log.Printf("Failed to parse location coordinates in address management: %s", input)
			return formatError("Unable to process your location. Please try typing your address instead.")
		}
		suggestions := s.getNearbyAddressSuggestions(ctx, lat, lng)
		newState := state
		newState.Step = "location_suggestions"
		newState.TempAddressData = &TempAddress{
			Coordinates: &Coordinates{Latitude: lat, Longitude: lng},
			Suggestions: suggestions,
		}
		newState.PreviousStep = "address_add"
		s.updateConversationState(ctx, chatID, newState)
		return formatLocationSuggestions(suggestions)
	}

	// Geocoding (stubbed — returns error, matching TS fallback behavior)
	geo := geocodeAddress(input)
	if geo.Success && geo.Coordinates != nil {
		res := s.addCustomerAddress(ctx, customerID, geo.Address, geo.Coordinates.Latitude, geo.Coordinates.Longitude, false)
		if res.Success && res.Address != nil {
			newState := state
			newState.Step = "address_added"
			newState.SelectedAddressID = res.Address.ID
			newState.PreviousStep = "address_add"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddressAdded(res.Address)
		}
		return formatError("Unable to save address. Please try again.")
	}
	return formatError("Could not find that address. Please try again or share your location.")
}

func (s *Service) getNearbyAddressSuggestions(ctx context.Context, latitude, longitude float64) []string {
	_ = ctx
	// Reverse geocoding is stubbed — provide fallback suggestions to preserve flow.
	rev := reverseGeocode(latitude, longitude)
	if rev.Success && rev.Address != "" {
		base := rev.Address
		suggestions := []string{
			base,
			fmt.Sprintf("%s (Main entrance)", base),
			fmt.Sprintf("%s (Side entrance)", base),
			fmt.Sprintf("%s (Back entrance)", base),
			fmt.Sprintf("%s (Parking area)", base),
		}
		if len(suggestions) > 5 {
			suggestions = suggestions[:5]
		}
		return suggestions
	}
	base := fmt.Sprintf("%g, %g", latitude, longitude)
	return []string{
		fmt.Sprintf("%s (Current location)", base),
		fmt.Sprintf("%s (Main entrance)", base),
		fmt.Sprintf("%s (Side entrance)", base),
		fmt.Sprintf("%s (Back entrance)", base),
		fmt.Sprintf("%s (Parking area)", base),
	}
}

func (s *Service) handleLocationSuggestions(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if !hasNum {
		return formatError("Please select a valid option")
	}
	var suggestions []string
	var coords *Coordinates
	if state.TempAddressData != nil {
		suggestions = state.TempAddressData.Suggestions
		coords = state.TempAddressData.Coordinates
	}

	if selectedNumber >= 1 && selectedNumber <= 5 && selectedNumber-1 < len(suggestions) {
		selectedAddress := suggestions[selectedNumber-1]
		if coords == nil {
			return formatError("Unable to save address. Please try again.")
		}
		res := s.addCustomerAddress(ctx, customerID, selectedAddress, coords.Latitude, coords.Longitude, false)
		if res.Success && res.Address != nil {
			newState := state
			newState.Step = "address_added"
			newState.SelectedAddressID = res.Address.ID
			newState.PreviousStep = "location_suggestions"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddressAdded(res.Address)
		}
		return formatError("Unable to save address. Please try again.")
	} else if selectedNumber == 6 {
		newState := state
		newState.Step = "address_add"
		newState.PreviousStep = "location_suggestions"
		s.updateConversationState(ctx, chatID, newState)
		return formatAddNewAddressPrompt()
	} else if selectedNumber == 7 {
		addrs := s.getCustomerAddresses(ctx, customerID)
		newState := state
		newState.Step = "address_list"
		newState.PreviousStep = "location_suggestions"
		s.updateConversationState(ctx, chatID, newState)
		return formatAddressManagement(addrs)
	} else if selectedNumber == 8 {
		newState := state
		newState.Step = "main_menu"
		newState.PreviousStep = "location_suggestions"
		s.updateConversationState(ctx, chatID, newState)
		return formatMainMenu("", 0, 0, "")
	}
	return formatError("Please select a valid option")
}

func (s *Service) handleAddressAdded(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if !hasNum {
		return formatError("Please select a valid option")
	}

	switch selectedNumber {
	case 1:
		if state.SelectedAddressID != "" {
			ok, errMsg := s.setDefaultAddress(ctx, customerID, state.SelectedAddressID)
			if ok {
				newState := state
				newState.Step = "address_list"
				newState.SelectedAddressID = ""
				newState.PreviousStep = "address_added"
				s.updateConversationState(ctx, chatID, newState)
				return formatAddressSetDefault()
			}
			if errMsg == "" {
				errMsg = "Failed to set default address"
			}
			return formatError(errMsg)
		}
	case 2:
		if state.SelectedAddressID != "" {
			ok, errMsg := s.deleteCustomerAddress(ctx, customerID, state.SelectedAddressID)
			if ok {
				addrs := s.getCustomerAddresses(ctx, customerID)
				newState := state
				newState.Step = "address_list"
				newState.SelectedAddressID = ""
				newState.PreviousStep = "address_added"
				s.updateConversationState(ctx, chatID, newState)
				return formatAddressDeleted() + "\n\n" + formatAddressManagement(addrs)
			}
			if errMsg == "" {
				errMsg = "Failed to delete address"
			}
			return formatError(errMsg)
		}
	case 3:
		newState := state
		newState.Step = "address_add"
		newState.SelectedAddressID = ""
		newState.PreviousStep = "address_added"
		s.updateConversationState(ctx, chatID, newState)
		return formatAddNewAddressPrompt()
	case 4:
		addrs := s.getCustomerAddresses(ctx, customerID)
		newState := state
		newState.Step = "address_list"
		newState.SelectedAddressID = ""
		newState.PreviousStep = "address_added"
		s.updateConversationState(ctx, chatID, newState)
		return formatAddressManagement(addrs)
	case 5:
		newState := state
		newState.Step = "main_menu"
		newState.SelectedAddressID = ""
		newState.PreviousStep = "address_added"
		s.updateConversationState(ctx, chatID, newState)
		return formatMainMenu("", 0, 0, "")
	}
	return formatError("Please select a valid option")
}
