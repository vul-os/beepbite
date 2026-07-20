package chatbot

import (
	"fmt"
	"strings"
	"time"
)

const maxWhatsAppMessageLength = 4096

type messageValidation struct {
	Valid     bool
	Length    int
	Truncated string
}

func validateMessageLength(message string) messageValidation {
	length := len(message)
	if length <= maxWhatsAppMessageLength {
		return messageValidation{Valid: true, Length: length}
	}
	truncated := message[:maxWhatsAppMessageLength-100] +
		"\n\n⚠️ *Message truncated due to length limit*\n\n📱 *Powered by BeepBite.io*"
	return messageValidation{Valid: false, Length: length, Truncated: truncated}
}

func formatMainMenu(customerName string, cartItemCount, activeOrderCount int, cartLocationName string) string {
	greeting := "Hello! 👋"
	if customerName != "" {
		greeting = fmt.Sprintf("Hello %s! 👋", customerName)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "%s\n\n", greeting)
	b.WriteString("🍽️ *Welcome to BeepBite!*\n\n")

	if cartItemCount > 0 {
		plural := ""
		if cartItemCount > 1 {
			plural = "s"
		}
		fmt.Fprintf(&b, "🛒 *Your Plate:* %d item%s", cartItemCount, plural)
		if cartLocationName != "" {
			fmt.Fprintf(&b, " from %s", cartLocationName)
		}
		b.WriteString("\n")
	}
	if activeOrderCount > 0 {
		fmt.Fprintf(&b, "📋 *Active Orders:* %d\n", activeOrderCount)
	}
	if cartItemCount > 0 || activeOrderCount > 0 {
		b.WriteString("\n")
	}

	b.WriteString("*Main Menu:*\n")

	if cartItemCount > 0 {
		fmt.Fprintf(&b, "*[1]* 🛒 Continue with Plate (%d items)\n", cartItemCount)
		b.WriteString("*[A]* 🍔 Make New Order\n")
	} else {
		b.WriteString("*[A]* 🍔 Make an Order\n")
	}
	b.WriteString("*[B]* 📜 View Previous Orders\n")
	b.WriteString("*[C]* 👤 My Profile\n")
	b.WriteString("*[E]* 📍 Addresses\n\n")
	return b.String()
}

func formatNewOrderWarning(cartItemCount int, cartLocationName string) string {
	var b strings.Builder
	b.WriteString("⚠️ *New Order Warning*\n\n")
	plural := ""
	if cartItemCount > 1 {
		plural = "s"
	}
	fmt.Fprintf(&b, "You currently have %d item%s in your plate", cartItemCount, plural)
	if cartLocationName != "" {
		fmt.Fprintf(&b, " from %s", cartLocationName)
	}
	b.WriteString(".\n\n")
	b.WriteString("Starting a new order will *delete* your current plate.\n\n")
	b.WriteString("*What would you like to do?*\n\n")
	b.WriteString("*[1]* 🛒 Continue with Current Plate\n")
	b.WriteString("*[2]* 🗑️ Delete Plate & Make New Order\n")
	b.WriteString("*[3]* 👀 View Current Plate\n")
	b.WriteString("*[4]* 🏠 Back to Main Menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatOrderTypeSelection() string {
	return "🍔 *Make an Order*\n\n" +
		"How would you like to receive your order?\n\n" +
		"*[1]* 🚚 Delivery\n" +
		"*[2]* 🏪 Collection\n" +
		"*[3]* 🏠 Back to Main Menu\n\n" +
		"📱 *Powered by BeepBite.io*"
}

func formatAddressSelection(addresses []CustomerAddress) string {
	var b strings.Builder
	b.WriteString("📍 *Select Delivery Address*\n\n")

	if len(addresses) == 0 {
		b.WriteString("You don't have any saved addresses.\n\n")
		b.WriteString("*[1]* ➕ Add New Address\n")
		b.WriteString("*[2]* 🏠 Back to Main Menu\n\n")
	} else {
		b.WriteString("Choose from your saved addresses:\n\n")
		for i, a := range addresses {
			suffix := ""
			if a.IsDefault {
				suffix = " (Default)"
			}
			line1 := ""
			if a.AddressLine1 != nil {
				line1 = *a.AddressLine1
			}
			fmt.Fprintf(&b, "*[%d]* %s%s\n", i+1, line1, suffix)
		}
		fmt.Fprintf(&b, "*[%d]* ➕ Add New Address\n", len(addresses)+1)
		fmt.Fprintf(&b, "*[%d]* 🏠 Back to Main Menu\n\n", len(addresses)+2)
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatNewAddressPrompt() string {
	return "📍 *Add New Address*\n\n" +
		"Please share your location or type your address:\n\n" +
		"🌍 *Share Location:* Use the location sharing feature\n" +
		"✍️ *Type Address:* Write your full address\n\n" +
		"*[1]* 🔙 Back to Address Selection\n" +
		"*[2]* 🏠 Back to Main Menu\n\n" +
		"📱 *Powered by BeepBite.io*"
}

func formatStoreSelection(stores []Location, isNearby bool) string {
	var b strings.Builder
	b.WriteString("🏪 *Select Store*\n\n")
	if len(stores) == 0 {
		b.WriteString("❌ No stores found.\n\n")
		b.WriteString("*[1]* 🔍 Search Again\n")
		b.WriteString("*[2]* 🏠 Back to Main Menu\n\n")
	} else {
		storeType := "stores"
		if isNearby {
			storeType = "nearby stores"
		}
		fmt.Fprintf(&b, "Found %d %s:\n\n", len(stores), storeType)
		for i, s := range stores {
			fmt.Fprintf(&b, "*[%d]* %s\n", i+1, s.Name)
			if s.Address != nil && *s.Address != "" {
				fmt.Fprintf(&b, "   📍 %s\n", *s.Address)
			}
			if s.DeliveryFee > 0 {
				fmt.Fprintf(&b, "   🚚 Delivery: R%.2f\n", s.DeliveryFee)
			}
			b.WriteString("\n")
		}
		fmt.Fprintf(&b, "*[%d]* 🔍 Search for Different Store\n", len(stores)+1)
		fmt.Fprintf(&b, "*[%d]* 🏠 Back to Main Menu\n\n", len(stores)+2)
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatStoreSearchPrompt() string {
	return "🔍 *Search for Store*\n\n" +
		"Type the name of the store you're looking for:\n\n" +
		"*[1]* 🌍 Share Location (to find nearby stores)\n" +
		"*[2]* 🔙 Back to Order Type\n" +
		"*[3]* 🏠 Back to Main Menu\n\n" +
		"📱 *Powered by BeepBite.io*"
}

func formatMenuCategories(store *Location, categories []Category, cartItemCount, page, itemsPerPage int) string {
	var b strings.Builder
	storeName := ""
	if store != nil {
		storeName = store.Name
	}
	fmt.Fprintf(&b, "🍽️ *%s - Menu Categories*\n\n", storeName)
	if cartItemCount > 0 {
		plural := ""
		if cartItemCount > 1 {
			plural = "s"
		}
		fmt.Fprintf(&b, "🛒 *Your Plate:* %d item%s\n\n", cartItemCount, plural)
	}

	if len(categories) == 0 {
		b.WriteString("❌ No menu categories available.\n\n")
		b.WriteString("*[1]* 🔙 Back to Store Selection\n")
		b.WriteString("*[2]* 🏠 Back to Main Menu\n\n")
	} else {
		totalPages := (len(categories) + itemsPerPage - 1) / itemsPerPage
		startIndex := (page - 1) * itemsPerPage
		endIndex := startIndex + itemsPerPage
		if endIndex > len(categories) {
			endIndex = len(categories)
		}
		current := categories[startIndex:endIndex]

		b.WriteString("*Select a Category:*\n\n")
		for i, c := range current {
			categoryNumber := startIndex + i + 1
			itemCount := len(c.Items)
			fmt.Fprintf(&b, "*[%d]* %s (%d items)\n", categoryNumber, c.Name, itemCount)
			if c.Description != nil && *c.Description != "" {
				fmt.Fprintf(&b, "   %s\n", *c.Description)
			}
			b.WriteString("\n")
		}

		optionNumber := len(categories) + 1
		if totalPages > 1 {
			b.WriteString("*Navigation:*\n")
			if page > 1 {
				fmt.Fprintf(&b, "*[%d]* ⬅️ Previous Page\n", optionNumber)
				optionNumber++
			}
			if page < totalPages {
				fmt.Fprintf(&b, "*[%d]* ➡️ Next Page\n", optionNumber)
				optionNumber++
			}
			fmt.Fprintf(&b, "\nPage %d of %d\n\n", page, totalPages)
		}

		if cartItemCount > 0 {
			fmt.Fprintf(&b, "*[%d]* 🛒 View Plate (%d items)\n", optionNumber, cartItemCount)
			fmt.Fprintf(&b, "*[%d]* 🧾 Checkout\n", optionNumber+1)
			fmt.Fprintf(&b, "*[%d]* 🏠 Back to Main Menu\n\n", optionNumber+2)
		} else {
			fmt.Fprintf(&b, "*[%d]* 🏠 Back to Main Menu\n\n", optionNumber)
		}
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatCategoryItems(store *Location, category *Category, cartItemCount, page, itemsPerPage int) string {
	var b strings.Builder
	storeName := ""
	if store != nil {
		storeName = store.Name
	}
	fmt.Fprintf(&b, "🍽️ *%s - %s*\n\n", storeName, category.Name)
	if cartItemCount > 0 {
		plural := ""
		if cartItemCount > 1 {
			plural = "s"
		}
		fmt.Fprintf(&b, "🛒 *Your Plate:* %d item%s\n\n", cartItemCount, plural)
	}
	if category.Description != nil && *category.Description != "" {
		fmt.Fprintf(&b, "%s\n\n", *category.Description)
	}

	if len(category.Items) == 0 {
		b.WriteString("❌ No items available in this category.\n\n")
		b.WriteString("*[1]* 🔙 Back to Categories\n")
		b.WriteString("*[2]* 🏠 Back to Main Menu\n\n")
	} else {
		totalPages := (len(category.Items) + itemsPerPage - 1) / itemsPerPage
		startIndex := (page - 1) * itemsPerPage
		endIndex := startIndex + itemsPerPage
		if endIndex > len(category.Items) {
			endIndex = len(category.Items)
		}
		current := category.Items[startIndex:endIndex]

		b.WriteString("*Select an Item:*\n\n")
		for i, it := range current {
			itemNumber := startIndex + i + 1
			fmt.Fprintf(&b, "*[%d]* %s - R%.2f\n", itemNumber, it.Name, it.Price)
			if it.Description != nil && *it.Description != "" {
				desc := *it.Description
				if len(desc) > 80 {
					desc = desc[:80] + "..."
				}
				fmt.Fprintf(&b, "   %s\n", desc)
			}
			b.WriteString("\n")
		}

		optionNumber := len(category.Items) + 1
		if totalPages > 1 {
			b.WriteString("*Navigation:*\n")
			if page > 1 {
				fmt.Fprintf(&b, "*[%d]* ⬅️ Previous Page\n", optionNumber)
				optionNumber++
			}
			if page < totalPages {
				fmt.Fprintf(&b, "*[%d]* ➡️ Next Page\n", optionNumber)
				optionNumber++
			}
			fmt.Fprintf(&b, "\nPage %d of %d\n\n", page, totalPages)
		}

		fmt.Fprintf(&b, "*[%d]* 🔙 Back to Categories\n", optionNumber)
		optionNumber++

		if cartItemCount > 0 {
			fmt.Fprintf(&b, "*[%d]* 🛒 View Plate (%d items)\n", optionNumber, cartItemCount)
			fmt.Fprintf(&b, "*[%d]* 🧾 Checkout\n", optionNumber+1)
			fmt.Fprintf(&b, "*[%d]* 🏠 Back to Main Menu\n\n", optionNumber+2)
		} else {
			fmt.Fprintf(&b, "*[%d]* 🏠 Back to Main Menu\n\n", optionNumber)
		}
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatItemDetails(item *Item) string {
	var b strings.Builder
	fmt.Fprintf(&b, "🍽️ *%s*\n\n", item.Name)
	if item.Description != nil && *item.Description != "" {
		fmt.Fprintf(&b, "%s\n\n", *item.Description)
	}
	fmt.Fprintf(&b, "💰 *Price:* R%.2f\n", item.Price)
	if item.PreparationTime != nil {
		fmt.Fprintf(&b, "⏱️ *Prep Time:* %d minutes\n", *item.PreparationTime)
	}
	if len(item.ItemVariations) > 0 {
		b.WriteString("\n*Customizations Available*\n")
		b.WriteString("This item has customization options.\n\n")
		b.WriteString("*[1]* ⚙️ Customize & Add to Plate\n")
		b.WriteString("*[2]* ➕ Add to Plate (Default)\n")
		b.WriteString("*[3]* 🔙 Back to Menu\n\n")
	} else {
		b.WriteString("\n*[1]* ➕ Add to Plate\n")
		b.WriteString("*[2]* 🔙 Back to Menu\n\n")
	}
	return b.String()
}

func formatItemCustomization(item *Item, currentVariationIndex int, selectedVariations map[string]string) string {
	variation := item.ItemVariations[currentVariationIndex]
	totalVariations := len(item.ItemVariations)

	var b strings.Builder
	fmt.Fprintf(&b, "🍽️ *%s*\n", item.Name)
	fmt.Fprintf(&b, "⚙️ *Customization %d of %d*\n\n", currentVariationIndex+1, totalVariations)

	fmt.Fprintf(&b, "*%s:*\n", variation.Name)
	if variation.IsRequired {
		b.WriteString("(Required selection)\n\n")
	} else {
		b.WriteString("(Optional)\n\n")
	}

	for i, o := range variation.ItemVariationOptions {
		priceText := ""
		if o.PriceModifier > 0 {
			priceText = fmt.Sprintf(" (+R%.2f)", o.PriceModifier)
		} else if o.PriceModifier < 0 {
			priceText = fmt.Sprintf(" (R%.2f)", o.PriceModifier)
		}
		fmt.Fprintf(&b, "*[%d]* %s%s\n", i+1, o.Name, priceText)
	}

	if !variation.IsRequired {
		fmt.Fprintf(&b, "*[%d]* ⏭️ Skip (No selection)\n", len(variation.ItemVariationOptions)+1)
	}

	if len(selectedVariations) > 0 {
		b.WriteString("\n*Selections so far:*\n")
		for varID, optionID := range selectedVariations {
			for _, v := range item.ItemVariations {
				if v.ID == varID {
					for _, o := range v.ItemVariationOptions {
						if o.ID == optionID {
							fmt.Fprintf(&b, "• %s: %s\n", v.Name, o.Name)
						}
					}
				}
			}
		}
	}

	b.WriteString("\n*[0]* 🔙 Back\n\n")
	return b.String()
}

func formatCustomizationSummary(item *Item, selectedVariations map[string]string) string {
	basePrice := item.Price
	totalPrice := basePrice

	var b strings.Builder
	fmt.Fprintf(&b, "🍽️ *%s*\n", item.Name)
	b.WriteString("⚙️ *Customization Summary*\n\n")
	b.WriteString("*Your Selections:*\n")

	for variationID, optionID := range selectedVariations {
		for _, v := range item.ItemVariations {
			if v.ID == variationID {
				for _, o := range v.ItemVariationOptions {
					if o.ID == optionID {
						totalPrice += o.PriceModifier
						priceText := ""
						if o.PriceModifier > 0 {
							priceText = fmt.Sprintf(" (+R%.2f)", o.PriceModifier)
						} else if o.PriceModifier < 0 {
							priceText = fmt.Sprintf(" (R%.2f)", o.PriceModifier)
						}
						fmt.Fprintf(&b, "• %s: %s%s\n", v.Name, o.Name, priceText)
					}
				}
			}
		}
	}

	fmt.Fprintf(&b, "\nBase Price: R%.2f\n", basePrice)
	if totalPrice != basePrice {
		fmt.Fprintf(&b, "Customizations: R%.2f\n", totalPrice-basePrice)
	}
	fmt.Fprintf(&b, "*Total Price: R%.2f*\n\n", totalPrice)

	b.WriteString("*[1]* ✅ Add to Plate\n")
	b.WriteString("*[2]* ✏️ Change Customizations\n")
	b.WriteString("*[3]* 🔙 Back to Menu\n\n")
	return b.String()
}

func formatCartView(cartItems []CartItem, cartSummary *CartSummary, currencySymbol string) string {
	sym := currencySymbol
	if sym == "" {
		sym = "R"
	}
	var b strings.Builder
	b.WriteString("🛒 *Your Plate*\n\n")
	if len(cartItems) == 0 {
		b.WriteString("Your plate is empty.\n\n")
		b.WriteString("*[1]* 🔙 Back to Menu\n")
		b.WriteString("*[2]* 🏠 Back to Main Menu\n\n")
	} else {
		for i, ci := range cartItems {
			name := ""
			if ci.Items != nil {
				name = ci.Items.Name
			}
			fmt.Fprintf(&b, "*%d.* %s (x%d)\n", i+1, name, ci.Quantity)
			fmt.Fprintf(&b, "   %s%.2f\n", sym, ci.TotalPrice)
			for _, v := range ci.CartItemVariations {
				fmt.Fprintf(&b, "   • %s: %s\n", v.ItemVariations.Name, v.ItemVariationOptions.Name)
			}
			if ci.SpecialInstructions != nil && *ci.SpecialInstructions != "" {
				fmt.Fprintf(&b, "   📝 %s\n", *ci.SpecialInstructions)
			}
			b.WriteString("\n")
		}
		b.WriteString("*Order Summary:*\n")
		subtotal := 0.0
		deliveryFee := 0.0
		total := 0.0
		if cartSummary != nil {
			subtotal = cartSummary.Subtotal
			deliveryFee = cartSummary.DeliveryFeeAmount
			total = cartSummary.TotalAmount
		}
		fmt.Fprintf(&b, "Subtotal: %s%.2f\n", sym, subtotal)
		if deliveryFee > 0 {
			fmt.Fprintf(&b, "Delivery Fee: %s%.2f\n", sym, deliveryFee)
		}
		fmt.Fprintf(&b, "*Total: %s%.2f*\n\n", sym, total)

		b.WriteString("*Options:*\n")
		b.WriteString("*[1]* ✏️ Edit Items\n")
		b.WriteString("*[2]* 🧾 Checkout\n")
		b.WriteString("*[3]* 🗑️ Clear Plate\n")
		b.WriteString("*[4]* 🔙 Back to Menu\n")
		b.WriteString("*[5]* 🏠 Back to Main Menu\n\n")
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatCheckout(cartSummary *CartSummary, deliveryType string, currencySymbol string) string {
	sym := currencySymbol
	if sym == "" {
		sym = "R"
	}
	var b strings.Builder
	b.WriteString("🧾 *Checkout*\n\n")
	b.WriteString("*Order Summary:*\n")
	subtotal := 0.0
	deliveryFee := 0.0
	total := 0.0
	if cartSummary != nil {
		subtotal = cartSummary.Subtotal
		deliveryFee = cartSummary.DeliveryFeeAmount
		total = cartSummary.TotalAmount
	}
	fmt.Fprintf(&b, "Subtotal: %s%.2f\n", sym, subtotal)
	if deliveryFee > 0 {
		fmt.Fprintf(&b, "Delivery Fee: %s%.2f\n", sym, deliveryFee)
	}
	fmt.Fprintf(&b, "*Total: %s%.2f*\n\n", sym, total)

	isCollection := deliveryType == "collection"
	b.WriteString("*Payment Options:*\n")
	b.WriteString("*[1]* 💳 Pay Online\n")
	if isCollection {
		b.WriteString("*[2]* 💵 Pay on Collection\n")
		b.WriteString("*[3]* 🔙 Back to Plate\n")
		b.WriteString("*[4]* ❌ Cancel Order\n\n")
	} else {
		b.WriteString("*[2]* 💳 Pay on Delivery (Card)\n")
		b.WriteString("*[3]* 💵 Pay on Delivery (Cash)\n")
		b.WriteString("*[4]* 🔙 Back to Plate\n")
		b.WriteString("*[5]* ❌ Cancel Order\n\n")
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatTipSelection(orderTotal float64, currencySymbol string) string {
	sym := currencySymbol
	if sym == "" {
		sym = "R"
	}
	var b strings.Builder
	b.WriteString("💰 *Add Tip?*\n\n")
	fmt.Fprintf(&b, "Order Total: %s%.2f\n\n", sym, orderTotal)
	tip5 := orderTotal * 0.05
	tip15 := orderTotal * 0.15
	tip30 := orderTotal * 0.30
	b.WriteString("*Tip Options:*\n")
	fmt.Fprintf(&b, "*[1]* 5%% - %s%.2f\n", sym, tip5)
	fmt.Fprintf(&b, "*[2]* 15%% - %s%.2f\n", sym, tip15)
	fmt.Fprintf(&b, "*[3]* 30%% - %s%.2f\n", sym, tip30)
	fmt.Fprintf(&b, "*[4]* 💰 Custom amount (type %s amount)\n", sym)
	b.WriteString("*[5]* ⏭️ Skip tip\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatEmailCollection() string {
	return "📧 *Email Required*\n\n" +
		"To pay via card, please provide your email address:\n\n" +
		"✍️ Type your email address (must contain @)\n\n" +
		"*[1]* 🔙 Back to Payment Options\n\n" +
		"📱 *Powered by BeepBite.io*"
}

// formatPaymentMethods lists how the customer can pay on collection or
// delivery. There are no saved cards: BeepBite holds no card data and there is
// no gateway to tokenise against.
func formatPaymentMethods() string {
	var b strings.Builder
	b.WriteString("💳 *Select Payment Method*\n\n")
	b.WriteString("*[1]* 💵 Cash on delivery / collection\n")
	b.WriteString("*[2]* 🔙 Back to Payment Options\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatPaymentLink(paymentURL string, orderTotal float64, currencySymbol string) string {
	sym := currencySymbol
	if sym == "" {
		sym = "R"
	}
	var b strings.Builder
	b.WriteString("💳 *Payment Link*\n\n")
	fmt.Fprintf(&b, "Total Amount: %s%.2f\n\n", sym, orderTotal)
	b.WriteString("Click the link below to pay:\n")
	fmt.Fprintf(&b, "%s\n\n", paymentURL)
	b.WriteString("*Options:*\n")
	b.WriteString("*[1]* 🔄 Change Payment Method\n")
	b.WriteString("*[2]* ❌ Cancel Order\n\n")
	b.WriteString("You'll be notified here when payment is complete!\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatOrderConfirmation(orderNumber string, estimatedTime int) string {
	var b strings.Builder
	b.WriteString("✅ *Order Confirmed!*\n\n")
	fmt.Fprintf(&b, "Order Number: *%s*\n", orderNumber)
	fmt.Fprintf(&b, "Estimated Time: %d minutes\n\n", estimatedTime)
	b.WriteString("You'll receive updates here as your order progresses.\n\n")
	b.WriteString("*[1]* 🏠 Back to Main Menu\n")
	b.WriteString("*[2]* 📋 View My Orders\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatError(errorMessage string) string {
	return fmt.Sprintf("❌ *Error*\n\n%s\n\n📱 *Powered by BeepBite.io*", errorMessage)
}

func formatAddressManagement(addresses []CustomerAddress) string {
	var b strings.Builder
	b.WriteString("📍 *My Addresses*\n\n")
	if len(addresses) == 0 {
		b.WriteString("You don't have any saved addresses yet.\n\n")
		b.WriteString("*[1]* ➕ Add New Address\n")
		b.WriteString("*[2]* 🏠 Back to Main Menu\n\n")
	} else {
		b.WriteString("*Your Saved Addresses:*\n\n")
		for i, a := range addresses {
			suffix := ""
			if a.IsDefault {
				suffix = " 🏠 (Default)"
			}
			full := "No address"
			if a.AddressLine1 != nil && *a.AddressLine1 != "" {
				full = *a.AddressLine1
			}
			trunc := full
			if len(trunc) > 40 {
				trunc = trunc[:40] + "..."
			}
			fmt.Fprintf(&b, "*[%d]* %s%s\n", i+1, trunc, suffix)
		}
		fmt.Fprintf(&b, "\n*[%d]* ➕ Add New Address\n", len(addresses)+1)
		fmt.Fprintf(&b, "*[%d]* 🏠 Back to Main Menu\n\n", len(addresses)+2)
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatAddressActions(address *CustomerAddress) string {
	var b strings.Builder
	b.WriteString("📍 *Address Actions*\n\n")
	b.WriteString("*Selected Address:*\n")
	line1 := "No address"
	if address.AddressLine1 != nil && *address.AddressLine1 != "" {
		line1 = *address.AddressLine1
	}
	fmt.Fprintf(&b, "%s\n\n", line1)

	if address.IsDefault {
		b.WriteString("🏠 *This is your default address*\n\n")
	}
	b.WriteString("*What would you like to do?*\n\n")
	if !address.IsDefault {
		b.WriteString("*[1]* 🏠 Set as Default\n")
		b.WriteString("*[2]* 🗑️ Delete Address\n")
		b.WriteString("*[3]* 🔙 Back to Address List\n")
		b.WriteString("*[4]* 🏠 Main Menu\n\n")
	} else {
		b.WriteString("*[1]* 🗑️ Delete Address\n")
		b.WriteString("*[2]* 🔙 Back to Address List\n")
		b.WriteString("*[3]* 🏠 Main Menu\n\n")
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatAddressDeleted() string {
	return "✅ *Address Deleted Successfully*\n\nThe address has been removed from your saved addresses.\n\n"
}

func formatAddressSetDefault() string {
	return "✅ *Default Address Updated*\n\n" +
		"The address has been set as your default.\n\n" +
		"*[1]* 📍 Back to Address List\n" +
		"*[2]* 🏠 Main Menu\n\n" +
		"📱 *Powered by BeepBite.io*"
}

func formatAddNewAddressPrompt() string {
	return "➕ *Add New Address*\n\n" +
		"Please share your location or type your address:\n\n" +
		"🌍 *Share Location:* Use the location sharing feature\n" +
		"✍️ *Type Address:* Write your full address\n\n" +
		"*[1]* 🔙 Back to Address List\n" +
		"*[2]* 🏠 Main Menu\n\n" +
		"📱 *Powered by BeepBite.io*"
}

func formatAddressAdded(address *CustomerAddress) string {
	line1 := "No address"
	if address != nil && address.AddressLine1 != nil && *address.AddressLine1 != "" {
		line1 = *address.AddressLine1
	}
	var b strings.Builder
	b.WriteString("✅ *Address Added Successfully*\n\n")
	fmt.Fprintf(&b, "*New Address:*\n%s\n\n", line1)
	b.WriteString("*[1]* 🏠 Set as Default\n")
	b.WriteString("*[2]* 🗑️ Remove This Address\n")
	b.WriteString("*[3]* ➕ Add Another Address\n")
	b.WriteString("*[4]* 📍 Back to Address List\n")
	b.WriteString("*[5]* 🏠 Main Menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatLocationSuggestions(suggestions []string) string {
	var b strings.Builder
	b.WriteString("📍 *Address Suggestions*\n\n")
	b.WriteString("We found these addresses nearby:\n\n")
	for i, s := range suggestions {
		fmt.Fprintf(&b, "*[%d]* %s\n", i+1, s)
	}
	b.WriteString("*[6]* ✏️ Type out address\n")
	b.WriteString("*[7]* 🔙 Back to address list\n")
	b.WriteString("*[8]* 🏠 Main menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatProfileView(customer *Customer) string {
	var b strings.Builder
	b.WriteString("👤 *My Profile*\n\n")
	b.WriteString("*Personal Information:*\n")
	firstName := "Not set"
	if customer.FirstName != nil && *customer.FirstName != "" {
		firstName = *customer.FirstName
	}
	lastName := "Not set"
	if customer.LastName != nil && *customer.LastName != "" {
		lastName = *customer.LastName
	}
	email := "Not set"
	if customer.Email != nil && *customer.Email != "" {
		email = *customer.Email
	}
	fmt.Fprintf(&b, "First Name: %s\n", firstName)
	fmt.Fprintf(&b, "Last Name: %s\n", lastName)
	fmt.Fprintf(&b, "Email: %s\n", email)
	fmt.Fprintf(&b, "WhatsApp: +%s\n\n", customer.WhatsappNumber)

	b.WriteString("*Account Details:*\n")
	fmt.Fprintf(&b, "Member Since: %s\n\n", customer.CreatedAt.Format("1/2/2006"))
	b.WriteString("*Options:*\n")
	b.WriteString("*[1]* ✏️ Edit Profile\n")
	b.WriteString("*[2]* 🏠 Back to Main Menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatProfileEdit(customer *Customer) string {
	var b strings.Builder
	b.WriteString("✏️ *Edit Profile*\n\n")
	b.WriteString("*Current Information:*\n")
	firstName := "Not set"
	if customer.FirstName != nil && *customer.FirstName != "" {
		firstName = *customer.FirstName
	}
	lastName := "Not set"
	if customer.LastName != nil && *customer.LastName != "" {
		lastName = *customer.LastName
	}
	email := "Not set"
	if customer.Email != nil && *customer.Email != "" {
		email = *customer.Email
	}
	fmt.Fprintf(&b, "First Name: %s\n", firstName)
	fmt.Fprintf(&b, "Last Name: %s\n", lastName)
	fmt.Fprintf(&b, "Email: %s\n\n", email)
	b.WriteString("*What would you like to edit?*\n")
	b.WriteString("*[1]* First Name\n")
	b.WriteString("*[2]* Last Name\n")
	b.WriteString("*[3]* Email Address\n")
	b.WriteString("*[4]* 🔙 Back to Profile\n")
	b.WriteString("*[5]* 🏠 Back to Main Menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatFieldEdit(fieldName string, currentValue string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "✏️ *Edit %s*\n\n", fieldName)
	if currentValue != "" {
		fmt.Fprintf(&b, "Current %s: %s\n\n", fieldName, currentValue)
	} else {
		fmt.Fprintf(&b, "Current %s: Not set\n\n", fieldName)
	}
	if fieldName == "Email Address" {
		b.WriteString("Please enter your new email address:\n")
		b.WriteString("(Example: yourname@email.com)\n\n")
	} else {
		fmt.Fprintf(&b, "Please enter your new %s:\n\n", strings.ToLower(fieldName))
	}
	b.WriteString("Type *cancel* to go back without saving.\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatProfileUpdated(fieldName, newValue string) string {
	var b strings.Builder
	b.WriteString("✅ *Profile Updated*\n\n")
	fmt.Fprintf(&b, "Your %s has been updated to:\n", strings.ToLower(fieldName))
	fmt.Fprintf(&b, "*%s*\n\n", newValue)
	b.WriteString("Returning to profile...\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

// getTimeRemaining matches the TS helper.
func getTimeRemaining(createdAt time.Time) string {
	now := time.Now()
	diff := now.Sub(createdAt)
	hours := int(diff.Hours())
	mins := int(diff.Minutes()) - hours*60
	if hours > 0 {
		return fmt.Sprintf("%dh %dm ago", hours, mins)
	}
	return fmt.Sprintf("%dm ago", mins)
}
