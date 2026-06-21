package chatbot

import (
	"context"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var consentRegex = regexp.MustCompile(`(?i)CONSENT-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})`)

// ProcessMessage is the main entrypoint called by the webhook handler.
func (s *Service) ProcessMessage(ctx context.Context, phoneNumberID, from, messageID, messageBody, displayName string) error {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Panic in ProcessMessage: %v", r)
		}
	}()

	normalizedFrom := from
	if strings.HasPrefix(normalizedFrom, "+") {
		normalizedFrom = normalizedFrom[1:]
	}

	// Consent message shortcut
	isConsent, err := s.handleConsentMessage(ctx, messageBody, normalizedFrom)
	if err != nil {
		log.Printf("Error handling consent: %v", err)
	}
	if isConsent {
		log.Printf("Consent processed successfully, comprehensive response sent")
		return nil
	}

	bot := s.getBotFromPhoneNumber(ctx, phoneNumberID)
	if bot == nil || bot.ID != SystemBotID {
		log.Printf("Message from unknown bot: %s", phoneNumberID)
		return nil
	}

	customer := s.getOrCreateCustomer(ctx, normalizedFrom, displayName)
	if customer == nil {
		log.Printf("Failed to get/create customer")
		return nil
	}

	chat := s.getOrCreateChat(ctx, customer.ID, "")
	if chat == nil {
		log.Printf("Failed to get/create chat")
		return nil
	}

	s.saveMessage(ctx, chat.ID, messageID, "inbound", messageBody)

	// Check new conversation + recent bites
	var msgCount int
	err = s.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM (SELECT id FROM messages WHERE chat_id = $1 LIMIT 1) AS m`,
		chat.ID,
	).Scan(&msgCount)
	isNewConversation := err == nil && msgCount <= 1 // we just inserted one

	if isNewConversation {
		log.Printf("=== CHECKING RECENT BITES FOR NEW CONVERSATION ===")
		recent := s.getRecentBitesByWhatsApp(ctx, normalizedFrom)
		if len(recent) > 0 {
			if s.sendRecentBiteUpdates(normalizedFrom, recent) {
				s.saveMessage(ctx, chat.ID, "", "outbound", "Recent order updates")
				s.updateChatLastMessage(ctx, chat.ID, "Recent order updates sent")
				return nil
			}
		}
	}

	state := s.getConversationState(ctx, chat.ID)

	if strings.HasPrefix(messageBody, "LOCATION:") {
		log.Printf("=== LOCATION MESSAGE DETECTED === body=%s state.step=%s", messageBody, state.Step)
	}

	responseMessage := s.routeMessage(ctx, chat.ID, customer.ID, messageBody, state)

	s.sendResponse(ctx, normalizedFrom, responseMessage, chat.ID)
	return nil
}

func (s *Service) routeMessage(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) (resp string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("Panic in handler (step=%s): %v", state.Step, r)
			resp = "❌ *Service Temporarily Unavailable*\n\nWe're experiencing technical difficulties. Please try again in a few moments.\n\nIf the problem persists, please contact support.\n\n📱 *Powered by BeepBite.io*"
			s.updateConversationState(ctx, chatID, ConversationState{Step: "main_menu"})
		}
	}()

	switch state.Step {
	case "main_menu":
		return s.handleMainMenu(ctx, chatID, customerID, messageBody, state)

	case "new_order_warning":
		return s.handleNewOrderWarning(ctx, chatID, customerID, messageBody, state)

	case "order_type", "address_selection", "new_address", "store_selection",
		"store_search", "menu_display", "category_items", "item_details",
		"item_customization", "cart_view", "checkout", "tip_selection",
		"email_collection", "payment_method", "payment":
		return s.handleOrdering(ctx, chatID, customerID, messageBody, state)

	case "review_selection", "rating", "comment", "comment_write", "anon_selection", "completed":
		return s.handleReviewFlow(ctx, chatID, customerID, messageBody, state)

	case "address_list", "address_actions", "address_add", "address_added", "location_suggestions":
		return s.handleAddressManagement(ctx, chatID, customerID, messageBody, state)

	case "profile_view", "profile_edit", "profile_field_edit":
		return s.handleProfileManagement(ctx, chatID, customerID, messageBody, state)

	case "billing_list", "billing_actions", "billing_add_email_check", "billing_add", "billing_added":
		return s.handleBillingManagement(ctx, chatID, customerID, messageBody, state)

	default:
		s.updateConversationState(ctx, chatID, ConversationState{Step: "main_menu"})
		return formatMainMenu("", 0, 0, "")
	}
}

func (s *Service) handleConsentMessage(ctx context.Context, messageBody, normalizedFrom string) (bool, error) {
	match := consentRegex.FindStringSubmatch(messageBody)
	if len(match) < 2 {
		return false, nil
	}
	biteID := match[1]
	log.Printf("Consent message detected for bite ID: %s from %s", biteID, normalizedFrom)

	customer := s.getOrCreateCustomer(ctx, normalizedFrom, "")
	if customer == nil {
		return false, errors.New("failed to get/create customer for consent")
	}
	chat := s.getOrCreateChat(ctx, customer.ID, "")
	if chat == nil {
		return false, errors.New("failed to get/create chat for consent")
	}

	// Validate bite belongs to customer
	var orderNumber string
	var locationName *string
	err := s.pool.QueryRow(ctx,
		`SELECT o.order_number, l.name
		 FROM orders o
		 JOIN customers c ON o.customer_id = c.id
		 LEFT JOIN locations l ON o.location_id = l.id
		 WHERE o.id = $1 AND c.whatsapp_number = $2`,
		biteID, normalizedFrom,
	).Scan(&orderNumber, &locationName)
	if err != nil {
		log.Printf("Bite not found or does not belong to customer: %v", err)
		return false, nil
	}

	log.Printf("Valid consent for bite: %s", orderNumber)
	s.sendConsentConfirmation(ctx, normalizedFrom, orderNumber, locationName, chat.ID)
	return true, nil
}

func (s *Service) sendConsentConfirmation(ctx context.Context, whatsappNumber, orderNumber string, locationName *string, chatID string) {
	loc := "the restaurant"
	if locationName != nil && *locationName != "" {
		loc = *locationName
	}
	var b strings.Builder
	b.WriteString("✅ *Thank you for confirming!*\n\n")
	fmt.Fprintf(&b, "I found your order #%s from %s.\n\n", orderNumber, loc)
	b.WriteString("🤖 *I'm your BeepBite assistant!*\n\n")
	b.WriteString("I can help you:\n")
	b.WriteString("📝 Track your orders\n")
	b.WriteString("⭐ Rate your experiences\n")
	b.WriteString("💬 Share feedback\n")
	b.WriteString("🔔 Get status updates\n\n")
	b.WriteString("Let me check if you have any orders to review...\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	message := b.String()

	log.Printf("Sending consent confirmation message")
	if s.sendWhatsAppMessage(whatsappNumber, message) {
		s.saveMessage(ctx, chatID, "", "outbound", message)
	}

	// Send follow-up inline (TS uses a 2s timeout; in Go we just send directly).
	unreviewed := s.getUnreviewedBites(ctx, whatsappNumber)
	var followUp string
	if len(unreviewed) > 0 {
		followUp = formatBitesForReview(unreviewed, 0)
		newState := ConversationState{Step: "review_selection", ReviewPage: 0}
		s.updateConversationState(ctx, chatID, newState)
	} else {
		incomplete := s.getIncompleteBites(ctx, whatsappNumber)
		followUp = formatWelcomeMessage(incomplete, 0)
		newState := ConversationState{Step: "main_menu", ReviewPage: 0}
		s.updateConversationState(ctx, chatID, newState)
	}

	if s.sendWhatsAppMessage(whatsappNumber, followUp) {
		s.saveMessage(ctx, chatID, "", "outbound", followUp)
	}
	s.updateChatLastMessage(ctx, chatID, followUp)
}

func (s *Service) getRecentBitesByWhatsApp(ctx context.Context, whatsappNumber string) []reviewBite {
	since := time.Now().Add(-24 * time.Hour)
	rows, err := s.pool.Query(ctx,
		`SELECT o.id, o.order_number, o.status, o.created_at, l.name
		 FROM orders o
		 JOIN customers c ON o.customer_id = c.id
		 LEFT JOIN locations l ON o.location_id = l.id
		 WHERE c.whatsapp_number = $1 AND o.created_at >= $2
		 ORDER BY o.created_at DESC
		 LIMIT 5`,
		whatsappNumber, since,
	)
	if err != nil {
		log.Printf("Error fetching recent bites: %v", err)
		return nil
	}
	defer rows.Close()
	var bites []reviewBite
	for rows.Next() {
		b := reviewBite{}
		var name *string
		if err := rows.Scan(&b.ID, &b.OrderNumber, &b.Status, &b.CreatedAt, &name); err != nil {
			log.Printf("Error scanning recent bite: %v", err)
			continue
		}
		if name != nil {
			b.LocationName = *name
		}
		bites = append(bites, b)
	}
	return bites
}

func (s *Service) sendRecentBiteUpdates(whatsappNumber string, recentBites []reviewBite) bool {
	var b strings.Builder
	b.WriteString("🔔 *Order Updates*\n\n")
	b.WriteString("Here are your recent orders:\n\n")
	for i, bite := range recentBites {
		loc := bite.LocationName
		if loc == "" {
			loc = "Restaurant"
		}
		fmt.Fprintf(&b, "*%d.* %s\n", i+1, loc)
		fmt.Fprintf(&b, "   Order #%s\n", bite.OrderNumber)
		fmt.Fprintf(&b, "   Status: %s\n", bite.Status)
		fmt.Fprintf(&b, "   %s\n\n", getTimeRemaining(bite.CreatedAt))
	}
	b.WriteString("I'll help you track these and collect reviews when ready!\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return s.sendWhatsAppMessage(whatsappNumber, b.String())
}

func (s *Service) sendResponse(ctx context.Context, whatsappNumber, message, chatID string) {
	log.Printf("=== SENDING RESPONSE ===")
	validation := validateMessageLength(message)
	toSend := message
	if !validation.Valid {
		log.Printf("Message too long (%d chars), truncating", validation.Length)
		toSend = validation.Truncated
	}

	if !canUseWhatsApp(whatsappNumber) {
		// Fallback path — no other transport available in this port.
		s.updateChatLastMessage(ctx, chatID, toSend)
		return
	}

	if s.sendWhatsAppMessage(whatsappNumber, toSend) {
		s.saveMessage(ctx, chatID, "", "outbound", toSend)
		s.updateChatLastMessage(ctx, chatID, toSend)
		return
	}

	log.Printf("Failed to send WhatsApp message to: %s", whatsappNumber)
	fallback := "❌ *Service Error*\n\nWe're having trouble sending your message. Please try again.\n\n📱 *Powered by BeepBite.io*"
	_ = s.sendWhatsAppMessage(whatsappNumber, fallback)
}

type botRecord struct {
	ID                    string
	WhatsappPhoneNumberID string
}

func (s *Service) getBotFromPhoneNumber(ctx context.Context, phoneNumberID string) *botRecord {
	b := &botRecord{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, whatsapp_phone_number_id FROM bots
		 WHERE whatsapp_phone_number_id = $1 AND is_active = true`,
		phoneNumberID,
	).Scan(&b.ID, &b.WhatsappPhoneNumberID)
	if err != nil {
		log.Printf("Error fetching bot: %v", err)
		return nil
	}
	return b
}

type chatRecord struct {
	ID         string
	LocationID *string
}

func (s *Service) getOrCreateChat(ctx context.Context, customerID, locationID string) *chatRecord {
	existing := &chatRecord{}
	err := s.pool.QueryRow(ctx,
		`SELECT id, location_id FROM chats
		 WHERE bot_id = $1 AND customer_id = $2 AND status = 'active'
		 LIMIT 1`,
		SystemBotID, customerID,
	).Scan(&existing.ID, &existing.LocationID)

	if err == nil {
		if locationID != "" {
			current := ""
			if existing.LocationID != nil {
				current = *existing.LocationID
			}
			if current != locationID {
				_, updErr := s.pool.Exec(ctx,
					`UPDATE chats SET location_id = $1 WHERE id = $2`,
					locationID, existing.ID,
				)
				if updErr != nil {
					log.Printf("Error updating chat location: %v", updErr)
				}
			}
		}
		return existing
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		log.Printf("Error fetching chat: %v", err)
	}

	// Create new chat
	var locArg interface{}
	if locationID != "" {
		locArg = locationID
	} else {
		locArg = nil
	}
	newChat := &chatRecord{}
	err = s.pool.QueryRow(ctx,
		`INSERT INTO chats
		   (bot_id, customer_id, location_id, status, conversation_state, last_message_at)
		 VALUES ($1, $2, $3, 'active', $4::jsonb, NOW())
		 RETURNING id, location_id`,
		SystemBotID, customerID, locArg, `{"step":"main_menu"}`,
	).Scan(&newChat.ID, &newChat.LocationID)
	if err != nil {
		log.Printf("Error creating chat: %v", err)
		return nil
	}
	return newChat
}

func (s *Service) saveMessage(ctx context.Context, chatID, whatsappMessageID, direction, content string) {
	var msgIDArg interface{}
	if whatsappMessageID != "" {
		msgIDArg = whatsappMessageID
	} else {
		msgIDArg = nil
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO messages (chat_id, whatsapp_message_id, direction, message_type, content, created_at)
		 VALUES ($1, $2, $3, 'text', $4, NOW())`,
		chatID, msgIDArg, direction, content,
	)
	if err != nil {
		log.Printf("Error saving message: %v", err)
	}
}

func (s *Service) updateChatLastMessage(ctx context.Context, chatID, message string) {
	preview := message
	if len(preview) > 100 {
		preview = preview[:100]
	}
	_, err := s.pool.Exec(ctx,
		`UPDATE chats SET last_message_at = NOW(), last_message_preview = $1 WHERE id = $2`,
		preview, chatID,
	)
	if err != nil {
		log.Printf("Error updating chat last message: %v", err)
	}
}

func (s *Service) sendWhatsAppMessage(to, message string) bool {
	if s.wa == nil {
		log.Printf("WhatsApp client not configured")
		return false
	}
	_, err := s.wa.SendText(to, message, false)
	if err != nil {
		log.Printf("Error sending WhatsApp message: %v", err)
		return false
	}
	log.Printf("WhatsApp message sent successfully to %s", to)
	return true
}
