// Package chatbot implements the BeepBite ordering chatbot. It is the single
// point of entry for inbound customer messages: it maintains per-chat
// conversation state in Postgres, routes each message to the correct
// sub-handler (ordering, review, address/billing/profile management), and
// replies through the channel seam.
//
// It talks to a channel.Channel, not to WhatsApp. WhatsApp is simply the rail
// that shipped first — the package holds no Meta types, no webhook shapes and
// no rail-specific formatting, so a second rail is an adapter rather than a
// second chatbot. Names below still say "whatsapp" in places where they name a
// customer's handle, because that is what the column is called.
package chatbot

import (
	"context"
	"log"

	"github.com/beepbite/backend/internal/channel"
	"github.com/beepbite/backend/internal/integrations/mapbox"
	"github.com/beepbite/backend/internal/locations"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SystemBotID mirrors the TS constant: always used as the bot for all chats.
const SystemBotID = "46c4426a-9f5d-43d1-914c-d112deaf1d06"

// Service is the chatbot entrypoint.
type Service struct {
	pool   *pgxpool.Pool
	ch     channel.Channel // nil when no ordering rail is configured
	mapbox *mapbox.Client  // nil when MAPBOX_TOKEN is not set
}

// New constructs the Service on an ordering rail. Pass nil for ch when no rail
// is configured: the chatbot then logs and drops replies rather than failing,
// which is what an operator who has not supplied Meta credentials expects.
func New(pool *pgxpool.Pool, ch channel.Channel) *Service {
	return &Service{pool: pool, ch: ch}
}

// NewWithMapbox constructs the Service with an optional Mapbox geocoding client.
// Pass nil to fall back to stub geocoding behaviour.
func NewWithMapbox(pool *pgxpool.Pool, ch channel.Channel, mb *mapbox.Client) *Service {
	return &Service{pool: pool, ch: ch, mapbox: mb}
}

// currencySymbolFor returns the currency symbol configured for a location.
//
// It returns "" — not a guessed symbol — when the location is unknown or the
// lookup fails. The previous "R" fallback quoted every price in the WhatsApp
// ordering flow in rand: a Lisbon customer was shown "R 45.00" for a €45 basket
// and had no way to tell the symbol was invented rather than configured. A
// missing symbol prints a bare "45.00", which is ambiguous but not false, and
// the customer's own context supplies the currency.
//
// Errors are still swallowed (logged, not returned) so a transient DB failure
// degrades the price formatting rather than breaking the conversation.
func (s *Service) currencySymbolFor(ctx context.Context, locationID string) string {
	if locationID == "" {
		return ""
	}
	cur, err := locations.CurrencyFor(ctx, s.pool, locationID)
	if err != nil {
		log.Printf("chatbot: currencySymbolFor(%s): %v — rendering amounts without a symbol", locationID, err)
		return ""
	}
	return cur.Symbol
}
