package chatbot

import (
	"context"
	"encoding/json"
	"log"
)

// ConversationState mirrors the TS ConversationState interface.
// Pointer fields are used for nullable primitives so we can distinguish
// "unset" from the zero value — matching JS `undefined` behavior.
type ConversationState struct {
	Step string `json:"step"`

	// Order flow data
	DeliveryType       string `json:"delivery_type,omitempty"`
	SelectedAddressID  string `json:"selected_address_id,omitempty"`
	SelectedLocationID string `json:"selected_location_id,omitempty"`
	CurrentCategoryID  string `json:"current_category_id,omitempty"`
	CurrentItemID      string `json:"current_item_id,omitempty"`

	// Menu pagination data
	MenuPage     int    `json:"menu_page,omitempty"`
	MenuViewType string `json:"menu_view_type,omitempty"`

	// Item customization data
	TempItemVariations    map[string]string `json:"temp_item_variations,omitempty"`
	CurrentVariationIndex *int              `json:"current_variation_index,omitempty"`

	// Payment data
	TipAmount              *float64 `json:"tip_amount,omitempty"`
	CustomerEmail          string   `json:"customer_email,omitempty"`
	PaymentMethod          string   `json:"payment_method,omitempty"`
	PaymentAuthorizationID string   `json:"payment_authorization_id,omitempty"`

	// Review data
	SelectedBiteID string `json:"selected_bite_id,omitempty"`
	Rating         *int   `json:"rating,omitempty"`
	Comment        string `json:"comment,omitempty"`
	ReviewPage     int    `json:"review_page,omitempty"`

	// Profile data
	EditingField string `json:"editing_field,omitempty"`

	// Billing data
	SelectedPaymentMethodID string `json:"selected_payment_method_id,omitempty"`

	// Navigation
	PreviousStep    string      `json:"previous_step,omitempty"`
	TempAddressData *TempAddress `json:"temp_address_data,omitempty"`
}

// TempAddress matches the loose TS temp_address_data shape.
type TempAddress struct {
	AddressLine1 string       `json:"address_line_1,omitempty"`
	Address      string       `json:"address,omitempty"`
	Coordinates  *Coordinates `json:"coordinates,omitempty"`
	Suggestions  []string     `json:"suggestions,omitempty"`
}

type Coordinates struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

func (s *Service) getConversationState(ctx context.Context, chatID string) ConversationState {
	var raw []byte
	err := s.pool.QueryRow(ctx,
		`SELECT conversation_state FROM chats WHERE id = $1`,
		chatID,
	).Scan(&raw)
	if err != nil {
		log.Printf("Error getting conversation state: %v", err)
		return ConversationState{Step: "main_menu"}
	}
	if len(raw) == 0 {
		return ConversationState{Step: "main_menu"}
	}
	var state ConversationState
	if err := json.Unmarshal(raw, &state); err != nil {
		log.Printf("Error decoding conversation state: %v", err)
		return ConversationState{Step: "main_menu"}
	}
	if state.Step == "" {
		state.Step = "main_menu"
	}
	return state
}

func (s *Service) updateConversationState(ctx context.Context, chatID string, newState ConversationState) {
	raw, err := json.Marshal(newState)
	if err != nil {
		log.Printf("Error encoding conversation state: %v", err)
		return
	}
	_, err = s.pool.Exec(ctx,
		`UPDATE chats SET conversation_state = $1::jsonb, updated_at = NOW() WHERE id = $2`,
		string(raw), chatID,
	)
	if err != nil {
		log.Printf("Error updating conversation state: %v", err)
	}
}

func (s *Service) resetConversationState(ctx context.Context, chatID string) {
	s.updateConversationState(ctx, chatID, ConversationState{Step: "main_menu"})
}

// intPtr and floatPtr are small helpers used across handlers.
func intPtr(v int) *int          { return &v }
func floatPtr(v float64) *float64 { return &v }
