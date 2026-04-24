package chatbot

import (
	"context"
	"log"
	"strings"
)

func (s *Service) handleMainMenu(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	input := strings.ToLower(strings.TrimSpace(messageBody))

	allCartItems := s.getAllCartItemsForCustomer(ctx, customerID)
	existingCartLocation := ""
	var cartItems []CartItem
	if len(allCartItems) > 0 {
		existingCartLocation = allCartItems[0].LocationID
		cartItems = allCartItems
	}
	cartCount := len(cartItems)

	activeOrderCount := s.getActiveOrdersCount(ctx, customerID)

	cartLocationName := ""
	if existingCartLocation != "" {
		locationInfo := s.getLocationInfo(ctx, existingCartLocation)
		if locationInfo != nil {
			cartLocationName = locationInfo.Name
		}
	}

	switch input {
	case "1":
		if cartCount > 0 {
			cartSummary := s.getCartSummary(ctx, customerID, existingCartLocation)
			newState := state
			newState.Step = "cart_view"
			newState.SelectedLocationID = existingCartLocation
			newState.PreviousStep = "main_menu"
			s.updateConversationState(ctx, chatID, newState)
			return formatCartView(cartItems, cartSummary)
		}
		return formatMainMenu("", cartCount, activeOrderCount, cartLocationName)

	case "a", "make order", "order", "make new order":
		if cartCount > 0 {
			newState := state
			newState.Step = "new_order_warning"
			newState.PreviousStep = "main_menu"
			s.updateConversationState(ctx, chatID, newState)
			return formatNewOrderWarning(cartCount, cartLocationName)
		}
		newState := state
		newState.Step = "order_type"
		newState.PreviousStep = "main_menu"
		s.updateConversationState(ctx, chatID, newState)
		return formatOrderTypeSelection()

	case "b", "previous orders", "orders":
		return s.handlePreviousOrders(ctx, chatID, customerID, state, messageBody)

	case "c", "profile", "my profile":
		return s.handleProfileMenu(ctx, chatID, customerID, state)

	case "d", "billing":
		return s.handleBillingMenu(ctx, chatID, customerID, state)

	case "e", "addresses":
		return s.handleAddressesMenu(ctx, chatID, customerID, state)

	default:
		if _, hasNum := parseIntTrim(input); hasNum {
			return s.handleReviewFlow(ctx, chatID, customerID, messageBody, state)
		}
		return formatMainMenu("", cartCount, activeOrderCount, cartLocationName)
	}
}

func (s *Service) handleNewOrderWarning(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	allCartItems := s.getAllCartItemsForCustomer(ctx, customerID)
	cartCount := len(allCartItems)
	existingCartLocation := ""
	if cartCount > 0 {
		existingCartLocation = allCartItems[0].LocationID
	}

	cartLocationName := ""
	if existingCartLocation != "" {
		locationInfo := s.getLocationInfo(ctx, existingCartLocation)
		if locationInfo != nil {
			cartLocationName = locationInfo.Name
		}
	}

	if !hasNum {
		return formatError("Please select a valid option (1-4)")
	}

	switch selectedNumber {
	case 1:
		if existingCartLocation != "" {
			cartSummary := s.getCartSummary(ctx, customerID, existingCartLocation)
			newState := state
			newState.Step = "cart_view"
			newState.SelectedLocationID = existingCartLocation
			newState.PreviousStep = "new_order_warning"
			s.updateConversationState(ctx, chatID, newState)
			return formatCartView(allCartItems, cartSummary)
		}
		return formatMainMenu("", 0, 0, "")
	case 2:
		if existingCartLocation != "" {
			s.clearCustomerCart(ctx, customerID, existingCartLocation)
		}
		newState := state
		newState.Step = "order_type"
		newState.PreviousStep = "new_order_warning"
		s.updateConversationState(ctx, chatID, newState)
		return formatOrderTypeSelection()
	case 3:
		if existingCartLocation != "" {
			cartSummary := s.getCartSummary(ctx, customerID, existingCartLocation)
			return formatCartView(allCartItems, cartSummary) + "\n\n" + formatNewOrderWarning(cartCount, cartLocationName)
		}
		return formatMainMenu("", 0, 0, "")
	case 4:
		newState := state
		newState.Step = "main_menu"
		newState.PreviousStep = "new_order_warning"
		s.updateConversationState(ctx, chatID, newState)
		return formatMainMenu("", cartCount, 0, cartLocationName)
	default:
		return formatError("Please select option 1, 2, 3, or 4")
	}
}

func (s *Service) getAllCartItemsForCustomer(ctx context.Context, customerID string) []CartItem {
	return s.getCartItems(ctx, customerID, "")
}

func (s *Service) getLocationInfo(ctx context.Context, locationID string) *Location {
	l := &Location{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, name FROM locations WHERE id = $1`,
		locationID,
	).Scan(&l.ID, &l.Name)
	if err != nil {
		log.Printf("Error getting location info: %v", err)
		return nil
	}
	return l
}

func (s *Service) clearCustomerCart(ctx context.Context, customerID, locationID string) bool {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM cart_items WHERE customer_id = $1 AND location_id = $2`,
		customerID, locationID,
	)
	if err != nil {
		log.Printf("Error clearing cart: %v", err)
		return false
	}
	return true
}

func (s *Service) handlePreviousOrders(ctx context.Context, chatID, customerID string, state ConversationState, messageBody string) string {
	// TS redirects to review flow for compatibility.
	return s.handleReviewFlow(ctx, chatID, customerID, "previous orders", state)
}

func (s *Service) handleProfileMenu(ctx context.Context, chatID, customerID string, state ConversationState) string {
	profile := s.getCustomerProfile(ctx, customerID)
	if profile == nil {
		return formatError("Unable to load profile. Please try again.")
	}
	newState := state
	newState.Step = "profile_view"
	newState.PreviousStep = "main_menu"
	s.updateConversationState(ctx, chatID, newState)
	return formatProfileView(profile)
}

func (s *Service) handleBillingMenu(ctx context.Context, chatID, customerID string, state ConversationState) string {
	paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)
	newState := state
	newState.Step = "billing_list"
	newState.PreviousStep = "main_menu"
	s.updateConversationState(ctx, chatID, newState)
	return formatBillingManagement(paymentMethods)
}

func (s *Service) handleAddressesMenu(ctx context.Context, chatID, customerID string, state ConversationState) string {
	addresses := s.getCustomerAddresses(ctx, customerID)
	newState := state
	newState.Step = "address_list"
	newState.PreviousStep = "main_menu"
	s.updateConversationState(ctx, chatID, newState)
	return formatAddressManagement(addresses)
}
