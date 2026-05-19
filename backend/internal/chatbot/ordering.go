package chatbot

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
)

func (s *Service) handleOrdering(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	switch state.Step {
	case "order_type":
		return s.handleOrderType(ctx, chatID, customerID, messageBody, state)
	case "address_selection":
		return s.handleAddressSelection(ctx, chatID, customerID, messageBody, state)
	case "new_address":
		return s.handleNewAddress(ctx, chatID, customerID, messageBody, state)
	case "store_selection":
		return s.handleStoreSelection(ctx, chatID, customerID, messageBody, state)
	case "store_search":
		return s.handleStoreSearch(ctx, chatID, customerID, messageBody, state)
	case "menu_display":
		return s.handleMenuDisplay(ctx, chatID, customerID, messageBody, state)
	case "category_items":
		return s.handleCategoryItems(ctx, chatID, customerID, messageBody, state)
	case "item_details":
		return s.handleItemDetails(ctx, chatID, customerID, messageBody, state)
	case "item_customization":
		return s.handleItemCustomization(ctx, chatID, customerID, messageBody, state)
	case "cart_view":
		return s.handleCartView(ctx, chatID, customerID, messageBody, state)
	case "checkout":
		return s.handleCheckout(ctx, chatID, customerID, messageBody, state)
	case "tip_selection":
		return s.handleTipSelection(ctx, chatID, customerID, messageBody, state)
	case "email_collection":
		return s.handleEmailCollection(ctx, chatID, customerID, messageBody, state)
	case "payment_method":
		return s.handlePaymentMethod(ctx, chatID, customerID, messageBody, state)
	case "payment":
		return s.handlePayment(ctx, chatID, customerID, messageBody, state)
	default:
		return formatError("Invalid ordering step")
	}
}

func (s *Service) handleOrderType(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if hasNum {
		switch selectedNumber {
		case 1: // Delivery
			addresses := s.getCustomerAddresses(ctx, customerID)
			newState := state
			newState.Step = "address_selection"
			newState.DeliveryType = "delivery"
			newState.PreviousStep = "order_type"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddressSelection(addresses)
		case 2: // Collection
			newState := state
			newState.Step = "store_selection"
			newState.DeliveryType = "collection"
			newState.PreviousStep = "order_type"
			s.updateConversationState(ctx, chatID, newState)
			return formatStoreSearchPrompt()
		case 3: // Main menu
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "order_type"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatError("Please select 1 for Delivery, 2 for Collection, or 3 for Main Menu")
		}
	}
	return formatError("Please select a valid option (1-3)")
}

func (s *Service) handleAddressSelection(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	addresses := s.getCustomerAddresses(ctx, customerID)

	if hasNum {
		if selectedNumber >= 1 && selectedNumber <= len(addresses) {
			selected := addresses[selectedNumber-1]
			lat, lng := 0.0, 0.0
			if selected.Latitude != nil {
				lat, _ = strconv.ParseFloat(*selected.Latitude, 64)
			}
			if selected.Longitude != nil {
				lng, _ = strconv.ParseFloat(*selected.Longitude, 64)
			}
			nearby := s.getNearbyStores(ctx, lat, lng)

			newState := state
			newState.Step = "store_selection"
			newState.SelectedAddressID = selected.ID
			newState.PreviousStep = "address_selection"
			s.updateConversationState(ctx, chatID, newState)
			return formatStoreSelection(nearby, true)
		} else if selectedNumber == len(addresses)+1 {
			newState := state
			newState.Step = "new_address"
			newState.PreviousStep = "address_selection"
			s.updateConversationState(ctx, chatID, newState)
			return formatNewAddressPrompt()
		} else if selectedNumber == len(addresses)+2 {
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "address_selection"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		}
	}
	return formatError("Please select a valid address option")
}

func (s *Service) handleNewAddress(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	input := strings.TrimSpace(messageBody)
	selectedNumber, hasNum := parseIntTrim(input)

	if hasNum {
		switch selectedNumber {
		case 1:
			addresses := s.getCustomerAddresses(ctx, customerID)
			newState := state
			newState.Step = "address_selection"
			newState.PreviousStep = "new_address"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddressSelection(addresses)
		case 2:
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "new_address"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatError("Please share your location or type your address")
		}
	}

	if strings.HasPrefix(input, "LOCATION:") {
		lat, lng, ok := parseLocationMessage(input)
		if ok {
			log.Printf("Location parsed successfully: %g, %g", lat, lng)
			nearby := s.getNearbyStores(ctx, lat, lng)
			newState := state
			newState.Step = "store_selection"
			newState.TempAddressData = &TempAddress{
				AddressLine1: fmt.Sprintf("%g, %g", lat, lng),
				Coordinates:  &Coordinates{Latitude: lat, Longitude: lng},
			}
			newState.PreviousStep = "new_address"
			s.updateConversationState(ctx, chatID, newState)
			return formatStoreSelection(nearby, true)
		}
		log.Printf("Failed to parse location coordinates: %s", input)
		return formatError("Unable to process your location. Please try again or type your address.")
	}

	geo := geocodeAddress(input)
	if geo.Success && geo.Coordinates != nil {
		nearby := s.getNearbyStores(ctx, geo.Coordinates.Latitude, geo.Coordinates.Longitude)
		newState := state
		newState.Step = "store_selection"
		newState.TempAddressData = &TempAddress{
			AddressLine1: geo.Address,
			Coordinates:  geo.Coordinates,
		}
		newState.PreviousStep = "new_address"
		s.updateConversationState(ctx, chatID, newState)
		return formatStoreSelection(nearby, true)
	}

	return formatError("Could not find that address. Please try again or share your location.")
}

func (s *Service) handleStoreSelection(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	input := strings.TrimSpace(messageBody)
	selectedNumber, hasNum := parseIntTrim(input)

	var stores []Location

	switch state.DeliveryType {
	case "delivery":
		if state.SelectedAddressID != "" {
			addrs := s.getCustomerAddresses(ctx, customerID)
			for _, a := range addrs {
				if a.ID == state.SelectedAddressID {
					lat, lng := 0.0, 0.0
					if a.Latitude != nil {
						lat, _ = strconv.ParseFloat(*a.Latitude, 64)
					}
					if a.Longitude != nil {
						lng, _ = strconv.ParseFloat(*a.Longitude, 64)
					}
					stores = s.getNearbyStores(ctx, lat, lng)
					break
				}
			}
		} else if state.TempAddressData != nil && state.TempAddressData.Coordinates != nil {
			stores = s.getNearbyStores(ctx, state.TempAddressData.Coordinates.Latitude, state.TempAddressData.Coordinates.Longitude)
		}
	case "collection":
		if !hasNum {
			stores = s.getStoresBySearch(ctx, input)
			return formatStoreSelection(stores, false)
		}
		stores = s.getStoresBySearch(ctx, "")
	}

	if hasNum {
		if len(stores) == 0 {
			switch selectedNumber {
			case 1:
				if state.DeliveryType == "collection" {
					newState := state
					newState.Step = "store_search"
					newState.PreviousStep = "store_selection"
					s.updateConversationState(ctx, chatID, newState)
					return formatStoreSearchPrompt()
				}
				addresses := s.getCustomerAddresses(ctx, customerID)
				newState := state
				newState.Step = "address_selection"
				newState.PreviousStep = "store_selection"
				s.updateConversationState(ctx, chatID, newState)
				return formatAddressSelection(addresses)
			case 2:
				newState := state
				newState.Step = "main_menu"
				newState.PreviousStep = "store_selection"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			default:
				return formatStoreSelection(stores, state.DeliveryType == "delivery")
			}
		}

		if selectedNumber >= 1 && selectedNumber <= len(stores) {
			selectedStore := stores[selectedNumber-1]
			categories := s.getStoreMenu(ctx, selectedStore.ID)
			s.updateChatLocation(ctx, chatID, selectedStore.ID)

			newState := state
			newState.Step = "menu_display"
			newState.SelectedLocationID = selectedStore.ID
			newState.MenuPage = 1
			newState.MenuViewType = "categories"
			newState.PreviousStep = "store_selection"
			s.updateConversationState(ctx, chatID, newState)
			return formatMenuCategories(&selectedStore, categories, 0, 1, 8)
		} else if selectedNumber == len(stores)+1 {
			if state.DeliveryType == "collection" {
				newState := state
				newState.Step = "store_search"
				newState.PreviousStep = "store_selection"
				s.updateConversationState(ctx, chatID, newState)
				return formatStoreSearchPrompt()
			}
			addresses := s.getCustomerAddresses(ctx, customerID)
			newState := state
			newState.Step = "address_selection"
			newState.PreviousStep = "store_selection"
			s.updateConversationState(ctx, chatID, newState)
			return formatAddressSelection(addresses)
		} else if selectedNumber == len(stores)+2 {
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "store_selection"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		}
	}
	return formatStoreSelection(stores, state.DeliveryType == "delivery")
}

func (s *Service) handleStoreSearch(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	input := strings.TrimSpace(messageBody)
	selectedNumber, hasNum := parseIntTrim(input)

	if hasNum {
		switch selectedNumber {
		case 1:
			newState := state
			newState.Step = "new_address"
			newState.DeliveryType = "delivery"
			newState.PreviousStep = "store_search"
			s.updateConversationState(ctx, chatID, newState)
			return formatNewAddressPrompt()
		case 2:
			newState := state
			newState.Step = "order_type"
			newState.PreviousStep = "store_search"
			s.updateConversationState(ctx, chatID, newState)
			return formatOrderTypeSelection()
		case 3:
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "store_search"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatStoreSearchPrompt()
		}
	}

	stores := s.getStoresBySearch(ctx, input)
	newState := state
	newState.Step = "store_selection"
	newState.PreviousStep = "store_search"
	s.updateConversationState(ctx, chatID, newState)
	_ = customerID
	return formatStoreSelection(stores, false)
}

func (s *Service) updateChatLocation(ctx context.Context, chatID, locationID string) {
	_, err := s.pool.Exec(ctx,
		`UPDATE chats SET location_id = $1 WHERE id = $2`,
		locationID, chatID,
	)
	if err != nil {
		log.Printf("Error updating chat location: %v", err)
	}
}

func (s *Service) handleMenuDisplay(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	categories := s.getStoreMenu(ctx, state.SelectedLocationID)
	cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
	currentPage := state.MenuPage
	if currentPage <= 0 {
		currentPage = 1
	}
	itemsPerPage := 8

	// First-time display
	if state.PreviousStep == "store_selection" && !hasNum {
		store := s.getStoreInfo(ctx, state.SelectedLocationID)
		return formatMenuCategories(store, categories, len(cartItems), currentPage, itemsPerPage)
	}

	if hasNum {
		totalPages := (len(categories) + itemsPerPage - 1) / itemsPerPage
		startIndex := (currentPage - 1) * itemsPerPage
		endIndex := startIndex + itemsPerPage
		if endIndex > len(categories) {
			endIndex = len(categories)
		}

		if selectedNumber >= 1 && selectedNumber <= endIndex {
			selectedCategory := categories[selectedNumber-1]
			newState := state
			newState.Step = "category_items"
			newState.CurrentCategoryID = selectedCategory.ID
			newState.MenuPage = 1
			newState.MenuViewType = "items"
			newState.PreviousStep = "menu_display"
			s.updateConversationState(ctx, chatID, newState)
			store := s.getStoreInfo(ctx, state.SelectedLocationID)
			return formatCategoryItems(store, &selectedCategory, len(cartItems), 1, 10)
		}

		optionNumber := len(categories) + 1

		if totalPages > 1 {
			if currentPage > 1 && selectedNumber == optionNumber {
				newState := state
				newState.MenuPage = currentPage - 1
				s.updateConversationState(ctx, chatID, newState)
				store := s.getStoreInfo(ctx, state.SelectedLocationID)
				return formatMenuCategories(store, categories, len(cartItems), currentPage-1, itemsPerPage)
			}
			if currentPage > 1 {
				optionNumber++
			}
			if currentPage < totalPages && selectedNumber == optionNumber {
				newState := state
				newState.MenuPage = currentPage + 1
				s.updateConversationState(ctx, chatID, newState)
				store := s.getStoreInfo(ctx, state.SelectedLocationID)
				return formatMenuCategories(store, categories, len(cartItems), currentPage+1, itemsPerPage)
			}
			if currentPage < totalPages {
				optionNumber++
			}
		}

		if len(cartItems) > 0 {
			if selectedNumber == optionNumber {
				cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
				newState := state
				newState.Step = "cart_view"
				newState.PreviousStep = "menu_display"
				s.updateConversationState(ctx, chatID, newState)
				return formatCartView(cartItems, cartSummary)
			}
			optionNumber++
			if selectedNumber == optionNumber {
				cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
				newState := state
				newState.Step = "checkout"
				newState.PreviousStep = "menu_display"
				s.updateConversationState(ctx, chatID, newState)
				return formatCheckout(cartSummary, state.DeliveryType)
			}
			optionNumber++
			if selectedNumber == optionNumber {
				newState := state
				newState.Step = "main_menu"
				newState.PreviousStep = "menu_display"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			}
		} else {
			if selectedNumber == optionNumber {
				newState := state
				newState.Step = "main_menu"
				newState.PreviousStep = "menu_display"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			}
		}
	}

	store := s.getStoreInfo(ctx, state.SelectedLocationID)
	return formatMenuCategories(store, categories, len(cartItems), currentPage, itemsPerPage)
}

func (s *Service) handleCartView(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if !hasNum {
		return formatError("Please select a valid option (1-5)")
	}
	switch selectedNumber {
	case 1:
		categories := s.getStoreMenu(ctx, state.SelectedLocationID)
		cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
		newState := state
		newState.Step = "menu_display"
		newState.PreviousStep = "cart_view"
		s.updateConversationState(ctx, chatID, newState)
		store := s.getStoreInfo(ctx, state.SelectedLocationID)
		return formatMenuCategories(store, categories, len(cartItems), 1, 8)
	case 2:
		cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
		newState := state
		newState.Step = "checkout"
		newState.PreviousStep = "cart_view"
		s.updateConversationState(ctx, chatID, newState)
		return formatCheckout(cartSummary, state.DeliveryType)
	case 3:
		s.clearCart(ctx, customerID, state.SelectedLocationID)
		newState := state
		newState.Step = "main_menu"
		newState.PreviousStep = "cart_view"
		s.updateConversationState(ctx, chatID, newState)
		return formatMainMenu("", 0, 0, "")
	case 4:
		categories := s.getStoreMenu(ctx, state.SelectedLocationID)
		cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
		newState := state
		newState.Step = "menu_display"
		newState.PreviousStep = "cart_view"
		s.updateConversationState(ctx, chatID, newState)
		store := s.getStoreInfo(ctx, state.SelectedLocationID)
		return formatMenuCategories(store, categories, len(cartItems), 1, 8)
	case 5:
		newState := state
		newState.Step = "main_menu"
		newState.PreviousStep = "cart_view"
		s.updateConversationState(ctx, chatID, newState)
		return formatMainMenu("", 0, 0, "")
	default:
		return formatError("Please select a valid option (1-5)")
	}
}

func (s *Service) handleCategoryItems(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	categories := s.getStoreMenu(ctx, state.SelectedLocationID)
	var currentCategory *Category
	for i := range categories {
		if categories[i].ID == state.CurrentCategoryID {
			currentCategory = &categories[i]
			break
		}
	}
	if currentCategory == nil {
		return formatError("Category not found")
	}

	cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
	currentPage := state.MenuPage
	if currentPage <= 0 {
		currentPage = 1
	}
	itemsPerPage := 10

	if hasNum {
		totalPages := (len(currentCategory.Items) + itemsPerPage - 1) / itemsPerPage
		startIndex := (currentPage - 1) * itemsPerPage
		endIndex := startIndex + itemsPerPage
		if endIndex > len(currentCategory.Items) {
			endIndex = len(currentCategory.Items)
		}

		if selectedNumber >= 1 && selectedNumber <= endIndex {
			selectedItem := currentCategory.Items[selectedNumber-1]
			newState := state
			newState.Step = "item_details"
			newState.CurrentItemID = selectedItem.ID
			newState.PreviousStep = "category_items"
			s.updateConversationState(ctx, chatID, newState)
			return formatItemDetails(&selectedItem)
		}

		optionNumber := len(currentCategory.Items) + 1

		if totalPages > 1 {
			if currentPage > 1 && selectedNumber == optionNumber {
				newState := state
				newState.MenuPage = currentPage - 1
				s.updateConversationState(ctx, chatID, newState)
				store := s.getStoreInfo(ctx, state.SelectedLocationID)
				return formatCategoryItems(store, currentCategory, len(cartItems), currentPage-1, itemsPerPage)
			}
			if currentPage > 1 {
				optionNumber++
			}
			if currentPage < totalPages && selectedNumber == optionNumber {
				newState := state
				newState.MenuPage = currentPage + 1
				s.updateConversationState(ctx, chatID, newState)
				store := s.getStoreInfo(ctx, state.SelectedLocationID)
				return formatCategoryItems(store, currentCategory, len(cartItems), currentPage+1, itemsPerPage)
			}
			if currentPage < totalPages {
				optionNumber++
			}
		}

		// Back to categories
		if selectedNumber == optionNumber {
			newState := state
			newState.Step = "menu_display"
			newState.CurrentCategoryID = ""
			newState.MenuPage = 1
			newState.MenuViewType = "categories"
			newState.PreviousStep = "category_items"
			s.updateConversationState(ctx, chatID, newState)
			store := s.getStoreInfo(ctx, state.SelectedLocationID)
			return formatMenuCategories(store, categories, len(cartItems), 1, 8)
		}
		optionNumber++

		if len(cartItems) > 0 {
			if selectedNumber == optionNumber {
				cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
				newState := state
				newState.Step = "cart_view"
				newState.PreviousStep = "category_items"
				s.updateConversationState(ctx, chatID, newState)
				return formatCartView(cartItems, cartSummary)
			}
			optionNumber++
			if selectedNumber == optionNumber {
				cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
				newState := state
				newState.Step = "checkout"
				newState.PreviousStep = "category_items"
				s.updateConversationState(ctx, chatID, newState)
				return formatCheckout(cartSummary, state.DeliveryType)
			}
			optionNumber++
			if selectedNumber == optionNumber {
				newState := state
				newState.Step = "main_menu"
				newState.PreviousStep = "category_items"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			}
		} else {
			if selectedNumber == optionNumber {
				newState := state
				newState.Step = "main_menu"
				newState.PreviousStep = "category_items"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			}
		}
	}
	return formatError("Please select a valid option")
}

func (s *Service) handleItemDetails(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	item := s.getMenuItem(ctx, state.CurrentItemID)
	if item == nil {
		return formatError("Item not found")
	}
	hasVariations := len(item.ItemVariations) > 0

	if !hasNum {
		return formatError("Please select a valid option")
	}

	if hasVariations {
		switch selectedNumber {
		case 1:
			idx := 0
			newState := state
			newState.Step = "item_customization"
			newState.TempItemVariations = map[string]string{}
			newState.CurrentVariationIndex = &idx
			newState.PreviousStep = "item_details"
			s.updateConversationState(ctx, chatID, newState)
			return formatItemCustomization(item, 0, map[string]string{})
		case 2:
			ok := s.addToCart(ctx, customerID, state.SelectedLocationID, state.CurrentItemID, 1, map[string]string{}, "")
			if ok {
				categories := s.getStoreMenu(ctx, state.SelectedLocationID)
				cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
				newState := state
				newState.Step = "menu_display"
				newState.PreviousStep = "item_details"
				s.updateConversationState(ctx, chatID, newState)
				store := s.getStoreInfo(ctx, state.SelectedLocationID)
				return formatMenuCategories(store, categories, len(cartItems), 1, 8)
			}
			return formatError("Failed to add item to cart")
		case 3:
			categories := s.getStoreMenu(ctx, state.SelectedLocationID)
			cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
			newState := state
			newState.Step = "menu_display"
			newState.PreviousStep = "item_details"
			s.updateConversationState(ctx, chatID, newState)
			store := s.getStoreInfo(ctx, state.SelectedLocationID)
			return formatMenuCategories(store, categories, len(cartItems), 1, 8)
		default:
			return formatError("Please select 1 to customize, 2 to add with defaults, or 3 to go back")
		}
	}

	switch selectedNumber {
	case 1:
		ok := s.addToCart(ctx, customerID, state.SelectedLocationID, state.CurrentItemID, 1, map[string]string{}, "")
		if ok {
			categories := s.getStoreMenu(ctx, state.SelectedLocationID)
			cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
			newState := state
			newState.Step = "menu_display"
			newState.PreviousStep = "item_details"
			s.updateConversationState(ctx, chatID, newState)
			store := s.getStoreInfo(ctx, state.SelectedLocationID)
			return formatMenuCategories(store, categories, len(cartItems), 1, 8)
		}
		return formatError("Failed to add item to cart")
	case 2:
		categories := s.getStoreMenu(ctx, state.SelectedLocationID)
		cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
		newState := state
		newState.Step = "menu_display"
		newState.PreviousStep = "item_details"
		s.updateConversationState(ctx, chatID, newState)
		store := s.getStoreInfo(ctx, state.SelectedLocationID)
		return formatMenuCategories(store, categories, len(cartItems), 1, 8)
	default:
		return formatError("Please select 1 to add to cart or 2 to go back")
	}
}

func (s *Service) handleItemCustomization(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	item := s.getMenuItem(ctx, state.CurrentItemID)
	if item == nil {
		return formatError("Item not found")
	}

	currentIdx := 0
	if state.CurrentVariationIndex != nil {
		currentIdx = *state.CurrentVariationIndex
	}
	selectedVariations := state.TempItemVariations
	if selectedVariations == nil {
		selectedVariations = map[string]string{}
	}

	if state.CurrentVariationIndex == nil {
		// Summary stage
		return s.handleCustomizationSummary(ctx, chatID, customerID, messageBody, state, item)
	}

	if currentIdx >= len(item.ItemVariations) {
		return formatError("Please select a valid option")
	}
	currentVariation := item.ItemVariations[currentIdx]

	if hasNum {
		if selectedNumber == 0 {
			newState := state
			newState.Step = "item_details"
			newState.TempItemVariations = nil
			newState.CurrentVariationIndex = nil
			newState.PreviousStep = "item_customization"
			s.updateConversationState(ctx, chatID, newState)
			return formatItemDetails(item)
		}

		maxOption := len(currentVariation.ItemVariationOptions)
		if !currentVariation.IsRequired {
			maxOption++
		}

		if selectedNumber >= 1 && selectedNumber <= maxOption {
			newSelected := make(map[string]string, len(selectedVariations)+1)
			for k, v := range selectedVariations {
				newSelected[k] = v
			}
			if selectedNumber <= len(currentVariation.ItemVariationOptions) {
				selectedOption := currentVariation.ItemVariationOptions[selectedNumber-1]
				newSelected[currentVariation.ID] = selectedOption.ID
			}
			nextIdx := currentIdx + 1
			if nextIdx < len(item.ItemVariations) {
				newState := state
				newState.TempItemVariations = newSelected
				newIdx := nextIdx
				newState.CurrentVariationIndex = &newIdx
				s.updateConversationState(ctx, chatID, newState)
				return formatItemCustomization(item, nextIdx, newSelected)
			}
			newState := state
			newState.TempItemVariations = newSelected
			newState.CurrentVariationIndex = nil
			s.updateConversationState(ctx, chatID, newState)
			return formatCustomizationSummary(item, newSelected)
		}
		return formatError(fmt.Sprintf("Please select a valid option (0-%d)", maxOption))
	}

	return formatError("Please select a valid option")
}

func (s *Service) handleCustomizationSummary(ctx context.Context, chatID, customerID, messageBody string, state ConversationState, item *Item) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if !hasNum {
		return formatError("Please select a valid option (1-3)")
	}
	switch selectedNumber {
	case 1:
		variations := state.TempItemVariations
		if variations == nil {
			variations = map[string]string{}
		}
		ok := s.addToCart(ctx, customerID, state.SelectedLocationID, state.CurrentItemID, 1, variations, "")
		if ok {
			categories := s.getStoreMenu(ctx, state.SelectedLocationID)
			cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
			newState := state
			newState.Step = "menu_display"
			newState.TempItemVariations = nil
			newState.CurrentVariationIndex = nil
			newState.PreviousStep = "item_customization"
			s.updateConversationState(ctx, chatID, newState)
			store := s.getStoreInfo(ctx, state.SelectedLocationID)
			return formatMenuCategories(store, categories, len(cartItems), 1, 8)
		}
		return formatError("Failed to add item to cart")
	case 2:
		newState := state
		newState.TempItemVariations = map[string]string{}
		idx := 0
		newState.CurrentVariationIndex = &idx
		s.updateConversationState(ctx, chatID, newState)
		return formatItemCustomization(item, 0, map[string]string{})
	case 3:
		categories := s.getStoreMenu(ctx, state.SelectedLocationID)
		cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
		newState := state
		newState.Step = "menu_display"
		newState.TempItemVariations = nil
		newState.CurrentVariationIndex = nil
		newState.PreviousStep = "item_customization"
		s.updateConversationState(ctx, chatID, newState)
		store := s.getStoreInfo(ctx, state.SelectedLocationID)
		return formatMenuCategories(store, categories, len(cartItems), 1, 8)
	default:
		return formatError("Please select 1 to add to cart, 2 to change customizations, or 3 to go back to menu")
	}
}

func (s *Service) handleCheckout(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	isCollection := state.DeliveryType == "collection"

	if hasNum {
		switch selectedNumber {
		case 1:
			cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
			newState := state
			newState.Step = "tip_selection"
			newState.PaymentMethod = "online"
			newState.PreviousStep = "checkout"
			s.updateConversationState(ctx, chatID, newState)
			total := 0.0
			if cartSummary != nil {
				total = cartSummary.TotalAmount
			}
			return formatTipSelection(total)
		case 2:
			if isCollection {
				newState := state
				newState.PaymentMethod = "collection"
				newState.TipAmount = floatPtr(0)
				newState.CustomerEmail = ""
				return s.processPayment(ctx, chatID, customerID, newState)
			}
			newState := state
			newState.PaymentMethod = "delivery_card"
			newState.TipAmount = floatPtr(0)
			newState.CustomerEmail = ""
			return s.processPayment(ctx, chatID, customerID, newState)
		case 3:
			if isCollection {
				cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
				cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
				newState := state
				newState.Step = "cart_view"
				newState.PreviousStep = "checkout"
				s.updateConversationState(ctx, chatID, newState)
				return formatCartView(cartItems, cartSummary)
			}
			newState := state
			newState.PaymentMethod = "delivery_cash"
			newState.TipAmount = floatPtr(0)
			newState.CustomerEmail = ""
			return s.processPayment(ctx, chatID, customerID, newState)
		case 4:
			if isCollection {
				s.clearCart(ctx, customerID, state.SelectedLocationID)
				newState := state
				newState.Step = "main_menu"
				newState.PreviousStep = "checkout"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			}
			cartItems := s.getCartItems(ctx, customerID, state.SelectedLocationID)
			cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
			newState := state
			newState.Step = "cart_view"
			newState.PreviousStep = "checkout"
			s.updateConversationState(ctx, chatID, newState)
			return formatCartView(cartItems, cartSummary)
		case 5:
			if !isCollection {
				s.clearCart(ctx, customerID, state.SelectedLocationID)
				newState := state
				newState.Step = "main_menu"
				newState.PreviousStep = "checkout"
				s.updateConversationState(ctx, chatID, newState)
				return formatMainMenu("", 0, 0, "")
			}
			return formatError("Please select a valid option (1-4)")
		default:
			maxOption := 5
			if isCollection {
				maxOption = 4
			}
			cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
			return formatError(fmt.Sprintf("Please select a valid payment option (1-%d)", maxOption)) + "\n\n" + formatCheckout(cartSummary, state.DeliveryType)
		}
	}

	cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
	return formatError("Please select a valid option number") + "\n\n" + formatCheckout(cartSummary, state.DeliveryType)
}

func (s *Service) handleTipSelection(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	input := strings.TrimSpace(messageBody)
	selectedNumber, hasNum := parseIntTrim(input)
	cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
	orderTotal := 0.0
	if cartSummary != nil {
		orderTotal = cartSummary.TotalAmount
	}

	if hasNum {
		var tipAmount float64
		switch selectedNumber {
		case 1:
			tipAmount = orderTotal * 0.05
		case 2:
			tipAmount = orderTotal * 0.15
		case 3:
			tipAmount = orderTotal * 0.30
		case 4:
			return formatError(`Please type your custom tip amount like "R25"`)
		case 5:
			tipAmount = 0
		default:
			return formatError("Please select a valid tip option (1-5)")
		}
		newState := state
		newState.Step = "email_collection"
		newState.TipAmount = &tipAmount
		newState.PreviousStep = "tip_selection"
		s.updateConversationState(ctx, chatID, newState)
		return formatEmailCollection()
	}

	// Custom "R25" format
	if strings.HasPrefix(strings.ToLower(input), "r") {
		amountStr := input[1:]
		amount, err := strconv.ParseFloat(amountStr, 64)
		if err == nil && amount >= 0 {
			newState := state
			newState.Step = "email_collection"
			newState.TipAmount = &amount
			newState.PreviousStep = "tip_selection"
			s.updateConversationState(ctx, chatID, newState)
			return formatEmailCollection()
		}
		return formatError(`Please enter a valid tip amount like "R25"`)
	}

	return formatError(`Please select a tip option (1-5) or enter a custom amount like "R25"`)
}

func (s *Service) handleEmailCollection(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	input := strings.TrimSpace(messageBody)
	selectedNumber, hasNum := parseIntTrim(input)
	if hasNum && selectedNumber == 1 {
		cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
		newState := state
		newState.Step = "checkout"
		newState.PreviousStep = "email_collection"
		s.updateConversationState(ctx, chatID, newState)
		return formatCheckout(cartSummary, state.DeliveryType)
	}
	if strings.Contains(input, "@") && strings.Contains(input, ".") {
		newState := state
		newState.Step = "payment_method"
		newState.CustomerEmail = input
		newState.PreviousStep = "email_collection"
		s.updateConversationState(ctx, chatID, newState)
		paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)
		return formatPaymentMethods(paymentMethods)
	}
	return formatError("Please enter a valid email address or select 1 to go back")
}

func (s *Service) handlePaymentMethod(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)

	if hasNum {
		if selectedNumber >= 1 && selectedNumber <= len(paymentMethods) {
			selectedMethod := paymentMethods[selectedNumber-1]
			newState := state
			newState.Step = "payment"
			newState.PaymentAuthorizationID = selectedMethod.ID
			newState.PreviousStep = "payment_method"
			s.updateConversationState(ctx, chatID, newState)
			return s.processPayment(ctx, chatID, customerID, newState)
		} else if selectedNumber == len(paymentMethods)+1 {
			newState := state
			newState.Step = "payment"
			newState.PaymentAuthorizationID = ""
			newState.PreviousStep = "payment_method"
			s.updateConversationState(ctx, chatID, newState)
			return s.processPayment(ctx, chatID, customerID, newState)
		} else if selectedNumber == len(paymentMethods)+2 {
			cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
			newState := state
			newState.Step = "checkout"
			newState.PreviousStep = "payment_method"
			s.updateConversationState(ctx, chatID, newState)
			return formatCheckout(cartSummary, state.DeliveryType)
		}
	}
	return formatError("Please select a valid payment method")
}

func (s *Service) handlePayment(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if hasNum {
		switch selectedNumber {
		case 1:
			paymentMethods := s.getCustomerPaymentMethods(ctx, customerID)
			newState := state
			newState.Step = "payment_method"
			newState.PreviousStep = "payment"
			s.updateConversationState(ctx, chatID, newState)
			return formatPaymentMethods(paymentMethods)
		case 2:
			s.clearCart(ctx, customerID, state.SelectedLocationID)
			newState := state
			newState.Step = "main_menu"
			newState.PreviousStep = "payment"
			s.updateConversationState(ctx, chatID, newState)
			return formatMainMenu("", 0, 0, "")
		default:
			return formatError("Please select 1 to change payment method or 2 to cancel order")
		}
	}
	return formatError("Please select a valid option (1-2)")
}

func (s *Service) processPayment(ctx context.Context, chatID, customerID string, state ConversationState) string {
	log.Printf("=== PROCESSING PAYMENT ===")
	log.Printf("Chat ID: %s Customer ID: %s Payment Method: %s", chatID, customerID, state.PaymentMethod)

	if state.SelectedLocationID == "" {
		log.Printf("Cannot process payment: No location selected")
		return formatError("Order session expired. Please start a new order.")
	}
	if state.DeliveryType == "" {
		log.Printf("Cannot process payment: No delivery type selected")
		return formatError("Order session expired. Please start a new order.")
	}

	cartSummary := s.getCartSummary(ctx, customerID, state.SelectedLocationID)
	if cartSummary == nil {
		return formatError("Unable to load cart summary. Please try again.")
	}

	tipAmount := 0.0
	if state.TipAmount != nil {
		tipAmount = *state.TipAmount
	}
	_ = cartSummary.TotalAmount + tipAmount // totalAmount — computed for logging parity

	var addressData *orderAddressData
	if state.DeliveryType == "delivery" {
		if state.SelectedAddressID != "" {
			addrs := s.getCustomerAddresses(ctx, customerID)
			for _, a := range addrs {
				if a.ID == state.SelectedAddressID {
					var lat, lng *float64
					if a.Latitude != nil {
						v, err := strconv.ParseFloat(*a.Latitude, 64)
						if err == nil {
							lat = &v
						}
					}
					if a.Longitude != nil {
						v, err := strconv.ParseFloat(*a.Longitude, 64)
						if err == nil {
							lng = &v
						}
					}
					addr := ""
					if a.AddressLine1 != nil {
						addr = *a.AddressLine1
					}
					addressData = &orderAddressData{
						Address:      addr,
						Latitude:     lat,
						Longitude:    lng,
						Instructions: a.DeliveryInstructions,
					}
					break
				}
			}
		} else if state.TempAddressData != nil {
			addr := state.TempAddressData.AddressLine1
			if addr == "" {
				addr = state.TempAddressData.Address
			}
			var lat, lng *float64
			if state.TempAddressData.Coordinates != nil {
				l := state.TempAddressData.Coordinates.Latitude
				ln := state.TempAddressData.Coordinates.Longitude
				lat = &l
				lng = &ln
			}
			addressData = &orderAddressData{Address: addr, Latitude: lat, Longitude: lng}
		}
	}

	orderType := "pickup"
	if state.DeliveryType == "delivery" {
		orderType = "delivery"
	}

	result := s.createOrder(ctx, customerID, state.SelectedLocationID, orderType, addressData, tipAmount, state.CustomerEmail)
	if !result.Success {
		if result.Error == "" {
			result.Error = "Failed to create order"
		}
		return formatError(result.Error)
	}
	if result.OrderNumber == "" {
		return formatError("Order created but failed to generate order number")
	}

	newState := ConversationState{Step: "main_menu", PreviousStep: "payment"}
	s.updateConversationState(ctx, chatID, newState)

	return formatOrderConfirmation(result.OrderNumber, 30)
}
