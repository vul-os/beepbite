package chatbot

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"
)

const reviewItemsPerPage = 5

type reviewBite struct {
	ID           string
	OrderNumber  string
	Status       string
	CreatedAt    time.Time
	LocationName string
}

func (s *Service) handleReviewFlow(ctx context.Context, chatID, customerID, messageBody string, state ConversationState) string {
	var whatsappNumber string
	_ = s.pool.QueryRow(ctx,
		`SELECT whatsapp_number FROM customers WHERE id = $1`,
		customerID,
	).Scan(&whatsappNumber)

	switch state.Step {
	case "main_menu":
		return s.handleMainMenuReview(ctx, chatID, whatsappNumber, messageBody, state)
	case "review_selection":
		return s.handleReviewSelection(ctx, chatID, whatsappNumber, messageBody, state)
	case "rating":
		return s.handleRatingSelection(ctx, chatID, whatsappNumber, messageBody, state)
	case "comment":
		return s.handleCommentSelection(ctx, chatID, whatsappNumber, messageBody, state)
	case "comment_write":
		return s.handleCommentWrite(ctx, chatID, whatsappNumber, messageBody, state)
	case "anon_selection":
		return s.handleAnonSelection(ctx, chatID, whatsappNumber, messageBody, state)
	case "completed":
		return s.handleCompleted(ctx, chatID, whatsappNumber, messageBody, state)
	default:
		return s.handleMainMenuReview(ctx, chatID, whatsappNumber, messageBody, state)
	}
}

func (s *Service) handleMainMenuReview(ctx context.Context, chatID, whatsappNumber, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)

	incompleteBites := s.getIncompleteBites(ctx, whatsappNumber)
	currentPage := state.ReviewPage
	totalPages := (len(incompleteBites) + reviewItemsPerPage - 1) / reviewItemsPerPage
	startIndex := currentPage * reviewItemsPerPage
	endIndex := startIndex + reviewItemsPerPage
	if endIndex > len(incompleteBites) {
		endIndex = len(incompleteBites)
	}

	if hasNum {
		optionNumber := endIndex + 1
		if currentPage > 0 && selectedNumber == optionNumber {
			prevPage := currentPage - 1
			resp := formatWelcomeMessage(incompleteBites, prevPage)
			newState := state
			newState.Step = "main_menu"
			newState.ReviewPage = prevPage
			s.updateConversationState(ctx, chatID, newState)
			return resp
		} else if currentPage > 0 {
			optionNumber++
		}

		if currentPage < totalPages-1 && selectedNumber == optionNumber {
			nextPage := currentPage + 1
			resp := formatWelcomeMessage(incompleteBites, nextPage)
			newState := state
			newState.Step = "main_menu"
			newState.ReviewPage = nextPage
			s.updateConversationState(ctx, chatID, newState)
			return resp
		}

		// Fallthrough: default welcome
		resp := formatWelcomeMessage(incompleteBites, currentPage)
		newState := state
		newState.Step = "main_menu"
		newState.ReviewPage = currentPage
		s.updateConversationState(ctx, chatID, newState)
		return resp
	}

	// Any non-number input shows reviews menu
	unreviewed := s.getUnreviewedBites(ctx, whatsappNumber)
	if len(unreviewed) == 0 {
		resp := formatWelcomeMessage(incompleteBites, 0)
		newState := state
		newState.Step = "main_menu"
		newState.ReviewPage = 0
		s.updateConversationState(ctx, chatID, newState)
		return resp
	}
	resp := formatBitesForReview(unreviewed, 0)
	newState := state
	newState.Step = "review_selection"
	newState.ReviewPage = 0
	s.updateConversationState(ctx, chatID, newState)
	return resp
}

func (s *Service) handleReviewSelection(ctx context.Context, chatID, whatsappNumber, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	unreviewed := s.getUnreviewedBites(ctx, whatsappNumber)
	currentPage := state.ReviewPage

	if hasNum {
		if selectedNumber >= 1 && selectedNumber <= len(unreviewed) {
			selected := unreviewed[selectedNumber-1]
			resp := formatRatingRequest()
			newState := state
			newState.Step = "rating"
			newState.SelectedBiteID = selected.ID
			s.updateConversationState(ctx, chatID, newState)
			return resp
		}
	}

	return fmt.Sprintf("❌ *Invalid Selection*\n\nPlease select a valid number.\n\n%s",
		formatBitesForReview(unreviewed, currentPage))
}

func (s *Service) handleRatingSelection(ctx context.Context, chatID, whatsappNumber, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	if hasNum {
		if selectedNumber >= 1 && selectedNumber <= 10 {
			resp := formatCommentWriteRequest(selectedNumber)
			newState := state
			newState.Step = "comment_write"
			newState.Rating = intPtr(selectedNumber)
			s.updateConversationState(ctx, chatID, newState)
			return resp
		} else if selectedNumber == 11 {
			incompleteBites := s.getIncompleteBites(ctx, whatsappNumber)
			resp := formatWelcomeMessage(incompleteBites, 0)
			newState := state
			newState.Step = "main_menu"
			newState.ReviewPage = 0
			s.updateConversationState(ctx, chatID, newState)
			return resp
		}
	}

	return fmt.Sprintf("❌ *Invalid Rating*\n\nPlease select a number from 1 to 10, or 11 for main menu.\n\n%s",
		formatRatingRequest())
}

func (s *Service) handleCommentSelection(ctx context.Context, chatID, whatsappNumber, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	rating := 0
	if state.Rating != nil {
		rating = *state.Rating
	}
	if hasNum {
		if selectedNumber == 1 {
			resp := formatCommentWriteRequest(rating)
			newState := state
			newState.Step = "comment_write"
			s.updateConversationState(ctx, chatID, newState)
			return resp
		} else if selectedNumber == 2 {
			resp := formatAnonSelectionMessage(rating, "2")
			newState := state
			newState.Step = "anon_selection"
			newState.Comment = "2"
			s.updateConversationState(ctx, chatID, newState)
			return resp
		} else if selectedNumber == 3 {
			incompleteBites := s.getIncompleteBites(ctx, whatsappNumber)
			resp := formatWelcomeMessage(incompleteBites, 0)
			newState := state
			newState.Step = "main_menu"
			newState.ReviewPage = 0
			s.updateConversationState(ctx, chatID, newState)
			return resp
		}
	}
	return fmt.Sprintf("❌ *Invalid Selection*\n\nPlease select an option:\n\n%s",
		formatCommentRequest(rating))
}

func (s *Service) handleCommentWrite(ctx context.Context, chatID, whatsappNumber, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	rating := 0
	if state.Rating != nil {
		rating = *state.Rating
	}
	if hasNum {
		if selectedNumber == 1 {
			resp := formatAnonSelectionMessage(rating, "2")
			newState := state
			newState.Step = "anon_selection"
			newState.Comment = "2"
			s.updateConversationState(ctx, chatID, newState)
			return resp
		} else if selectedNumber == 2 {
			incompleteBites := s.getIncompleteBites(ctx, whatsappNumber)
			resp := formatWelcomeMessage(incompleteBites, 0)
			newState := state
			newState.Step = "main_menu"
			newState.ReviewPage = 0
			s.updateConversationState(ctx, chatID, newState)
			return resp
		}
	} else {
		comment := strings.TrimSpace(messageBody)
		resp := formatAnonSelectionMessage(rating, comment)
		newState := state
		newState.Step = "anon_selection"
		newState.Comment = comment
		s.updateConversationState(ctx, chatID, newState)
		return resp
	}
	return fmt.Sprintf("❌ *Invalid Selection*\n\nPlease type your comment or select an option:\n\n%s",
		formatCommentWriteRequest(rating))
}

func (s *Service) handleAnonSelection(ctx context.Context, chatID, whatsappNumber, messageBody string, state ConversationState) string {
	selectedNumber, hasNum := parseIntTrim(messageBody)
	rating := 0
	if state.Rating != nil {
		rating = *state.Rating
	}
	comment := state.Comment
	if hasNum {
		if selectedNumber == 1 {
			saved := s.saveReview(ctx, state.SelectedBiteID, rating, comment, false)
			if saved {
				all := s.getUnreviewedBites(ctx, whatsappNumber)
				outstanding := make([]reviewBite, 0, len(all))
				for _, b := range all {
					if b.ID != state.SelectedBiteID {
						outstanding = append(outstanding, b)
					}
				}
				resp := formatThankYouMessage(rating, comment, false, outstanding)
				newState := state
				newState.Step = "completed"
				s.updateConversationState(ctx, chatID, newState)
				return resp
			}
		} else if selectedNumber == 2 {
			saved := s.saveReview(ctx, state.SelectedBiteID, rating, comment, true)
			if saved {
				all := s.getUnreviewedBites(ctx, whatsappNumber)
				outstanding := make([]reviewBite, 0, len(all))
				for _, b := range all {
					if b.ID != state.SelectedBiteID {
						outstanding = append(outstanding, b)
					}
				}
				resp := formatThankYouMessage(rating, comment, true, outstanding)
				newState := state
				newState.Step = "completed"
				s.updateConversationState(ctx, chatID, newState)
				return resp
			}
		}
	}
	return fmt.Sprintf("❌ *Invalid Selection*\n\nPlease select an option:\n\n%s",
		formatAnonSelectionMessage(rating, comment))
}

func (s *Service) handleCompleted(ctx context.Context, chatID, whatsappNumber, messageBody string, state ConversationState) string {
	_ = messageBody
	unreviewed := s.getUnreviewedBites(ctx, whatsappNumber)
	if len(unreviewed) == 0 {
		incompleteBites := s.getIncompleteBites(ctx, whatsappNumber)
		resp := formatWelcomeMessage(incompleteBites, 0)
		newState := state
		newState.Step = "main_menu"
		newState.ReviewPage = 0
		s.updateConversationState(ctx, chatID, newState)
		return resp
	}
	resp := formatBitesForReview(unreviewed, 0)
	newState := state
	newState.Step = "review_selection"
	newState.ReviewPage = 0
	s.updateConversationState(ctx, chatID, newState)
	return resp
}

func (s *Service) getIncompleteBites(ctx context.Context, whatsappNumber string) []reviewBite {
	rows, err := s.pool.Query(ctx,
		`SELECT o.id, o.order_number, o.status, o.created_at, l.name
		 FROM orders o
		 JOIN customers c ON o.customer_id = c.id
		 LEFT JOIN locations l ON o.location_id = l.id
		 WHERE c.whatsapp_number = $1
		   AND o.status IN ('pending','confirmed','preparing','ready','out_for_delivery','delivered')
		 ORDER BY o.created_at DESC
		 LIMIT 20`,
		whatsappNumber,
	)
	if err != nil {
		log.Printf("Error fetching incomplete bites: %v", err)
		return nil
	}
	defer rows.Close()

	var bites []reviewBite
	for rows.Next() {
		b := reviewBite{}
		var name *string
		if err := rows.Scan(&b.ID, &b.OrderNumber, &b.Status, &b.CreatedAt, &name); err != nil {
			log.Printf("Error scanning review bite: %v", err)
			continue
		}
		if name != nil {
			b.LocationName = *name
		}
		bites = append(bites, b)
	}
	return bites
}

func (s *Service) getUnreviewedBites(ctx context.Context, whatsappNumber string) []reviewBite {
	rows, err := s.pool.Query(ctx,
		`SELECT o.id, o.order_number, o.status, o.created_at, l.name
		 FROM orders o
		 JOIN customers c ON o.customer_id = c.id
		 LEFT JOIN locations l ON o.location_id = l.id
		 LEFT JOIN reviews r ON r.order_id = o.id
		 WHERE c.whatsapp_number = $1
		   AND o.status = 'completed'
		   AND r.id IS NULL
		 ORDER BY o.created_at DESC
		 LIMIT 20`,
		whatsappNumber,
	)
	if err != nil {
		log.Printf("Error fetching unreviewed bites: %v", err)
		return nil
	}
	defer rows.Close()

	var bites []reviewBite
	for rows.Next() {
		b := reviewBite{}
		var name *string
		if err := rows.Scan(&b.ID, &b.OrderNumber, &b.Status, &b.CreatedAt, &name); err != nil {
			log.Printf("Error scanning review bite: %v", err)
			continue
		}
		if name != nil {
			b.LocationName = *name
		}
		bites = append(bites, b)
	}
	return bites
}

func (s *Service) saveReview(ctx context.Context, biteID string, rating int, comment string, isAnon bool) bool {
	_ = isAnon // TODO: add anonymous flag if reviews table gets one
	var commentArg interface{}
	if comment != "" && comment != "2" {
		commentArg = comment
	} else {
		commentArg = nil
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO reviews (order_id, rating, comment, created_at) VALUES ($1, $2, $3, NOW())`,
		biteID, rating, commentArg,
	)
	if err != nil {
		log.Printf("Error saving review: %v", err)
		return false
	}
	return true
}

func formatWelcomeMessage(incompleteBites []reviewBite, page int) string {
	startIndex := page * reviewItemsPerPage
	endIndex := startIndex + reviewItemsPerPage
	if endIndex > len(incompleteBites) {
		endIndex = len(incompleteBites)
	}
	totalPages := (len(incompleteBites) + reviewItemsPerPage - 1) / reviewItemsPerPage

	var b strings.Builder
	b.WriteString("🍽️ *Welcome to BeepBite!*\n\n")
	if len(incompleteBites) == 0 {
		b.WriteString("You don't have any active orders at the moment.\n\n")
		b.WriteString("*[1]* 🔄 Check for reviews\n")
		b.WriteString("*[2]* 🏠 Main menu\n\n")
	} else {
		fmt.Fprintf(&b, "*Your Active Orders* (%d):\n\n", len(incompleteBites))
		for i, bite := range incompleteBites[startIndex:endIndex] {
			globalIndex := startIndex + i + 1
			timeAgo := getTimeRemaining(bite.CreatedAt)
			locName := bite.LocationName
			if locName == "" {
				locName = "Restaurant"
			}
			fmt.Fprintf(&b, "*%d.* %s\n", globalIndex, locName)
			fmt.Fprintf(&b, "   Order #%s\n", bite.OrderNumber)
			fmt.Fprintf(&b, "   Status: %s\n", bite.Status)
			fmt.Fprintf(&b, "   %s\n\n", timeAgo)
		}
		optionNumber := endIndex + 1
		if page > 0 {
			fmt.Fprintf(&b, "*[%d]* ⬅️ Previous page\n", optionNumber)
			optionNumber++
		}
		if page < totalPages-1 {
			fmt.Fprintf(&b, "*[%d]* ➡️ Next page\n", optionNumber)
			optionNumber++
		}
		fmt.Fprintf(&b, "*[%d]* 🔄 Check for reviews\n", optionNumber)
		b.WriteString("\n")
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatBitesForReview(bites []reviewBite, page int) string {
	startIndex := page * reviewItemsPerPage
	endIndex := startIndex + reviewItemsPerPage
	if endIndex > len(bites) {
		endIndex = len(bites)
	}
	totalPages := (len(bites) + reviewItemsPerPage - 1) / reviewItemsPerPage

	var b strings.Builder
	b.WriteString("⭐ *Rate Your Experience*\n\n")
	if len(bites) == 0 {
		b.WriteString("All caught up! No orders to review.\n\n")
		b.WriteString("*[1]* 🏠 Main menu\n\n")
	} else {
		b.WriteString("Please rate these completed orders:\n\n")
		for i, bite := range bites {
			locName := bite.LocationName
			if locName == "" {
				locName = "Restaurant"
			}
			fmt.Fprintf(&b, "*[%d]* %s\n", i+1, locName)
			fmt.Fprintf(&b, "   Order #%s\n", bite.OrderNumber)
			fmt.Fprintf(&b, "   %s\n\n", getTimeRemaining(bite.CreatedAt))
		}
		optionNumber := endIndex + 1
		if page > 0 {
			fmt.Fprintf(&b, "*[%d]* ⬅️ Previous page\n", optionNumber)
			optionNumber++
		}
		if page < totalPages-1 {
			fmt.Fprintf(&b, "*[%d]* ➡️ Next page\n", optionNumber)
			optionNumber++
		}
		fmt.Fprintf(&b, "*[%d]* 🏠 Main menu\n", optionNumber)
		b.WriteString("\n")
	}
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatRatingRequest() string {
	var b strings.Builder
	b.WriteString("⭐ *Rate Your Experience*\n\n")
	b.WriteString("How would you rate this order?\n\n")
	for i := 1; i <= 10; i++ {
		var emoji string
		switch {
		case i <= 5:
			emoji = "😞"
		case i <= 7:
			emoji = "😐"
		case i <= 8:
			emoji = "😊"
		default:
			emoji = "🤩"
		}
		fmt.Fprintf(&b, "*[%d]* %s %d/10\n", i, emoji, i)
	}
	b.WriteString("\n*[11]* 🏠 Main menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatCommentRequest(rating int) string {
	var b strings.Builder
	b.WriteString("💬 *Share Your Thoughts*\n\n")
	fmt.Fprintf(&b, "Your rating: %d/10 ⭐\n\n", rating)
	b.WriteString("Would you like to add a comment?\n\n")
	b.WriteString("*[1]* ✍️ Write a comment\n")
	b.WriteString("*[2]* ⏭️ Skip comment\n")
	b.WriteString("*[3]* 🏠 Main menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatCommentWriteRequest(rating int) string {
	var b strings.Builder
	b.WriteString("✍️ *Write Your Comment*\n\n")
	fmt.Fprintf(&b, "Your rating: %d/10 ⭐\n\n", rating)
	b.WriteString("Please type your comment about this order:\n\n")
	b.WriteString("*[1]* ⏭️ Skip comment\n")
	b.WriteString("*[2]* 🏠 Main menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatAnonSelectionMessage(rating int, comment string) string {
	var b strings.Builder
	b.WriteString("🔒 *Privacy Settings*\n\n")
	fmt.Fprintf(&b, "Your rating: %d/10 ⭐\n", rating)
	if comment != "" && comment != "2" {
		fmt.Fprintf(&b, "Your comment: \"%s\"\n", comment)
	}
	b.WriteString("\nWould you like your name shown with this review?\n\n")
	b.WriteString("*[1]* ✅ Yes - Share my name (default)\n")
	b.WriteString("*[2]* 🚫 No - Keep me anonymous\n")
	b.WriteString("*[3]* 🏠 Main menu\n\n")
	b.WriteString("📱 *Powered by BeepBite.io*")
	return b.String()
}

func formatThankYouMessage(rating int, comment string, isAnon bool, outstandingReviews []reviewBite) string {
	var b strings.Builder
	b.WriteString("🙏 *Thank You!*\n\n")
	b.WriteString("Your review has been saved.\n\n")
	fmt.Fprintf(&b, "Rating: %d/10 ⭐\n", rating)
	if comment != "" && comment != "2" {
		fmt.Fprintf(&b, "Comment: \"%s\"\n", comment)
	}
	if isAnon {
		b.WriteString("Privacy: Anonymous\n")
	} else {
		b.WriteString("Privacy: Name will be shown\n")
	}
	if len(outstandingReviews) > 0 {
		plural := ""
		if len(outstandingReviews) > 1 {
			plural = "s"
		}
		fmt.Fprintf(&b, "\n📝 You have %d more order%s to review.\n", len(outstandingReviews), plural)
		b.WriteString("*[1]* ⭐ Review more orders\n")
		b.WriteString("*[2]* 🏠 Main menu\n")
	} else {
		b.WriteString("\n*[1]* 🏠 Main menu\n")
	}
	b.WriteString("\n📱 *Powered by BeepBite.io*")
	return b.String()
}

func parseIntTrim(s string) (int, bool) {
	v, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0, false
	}
	return v, true
}
