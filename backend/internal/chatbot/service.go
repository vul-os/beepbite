// Package chatbot implements the BeepBite WhatsApp chatbot. It is the single
// point of entry for all inbound WhatsApp messages: it maintains per-chat
// conversation state in Postgres, routes each message to the correct
// sub-handler (ordering, review, address/billing/profile management), and
// sends responses via the whatsapp integration client.
package chatbot

import (
	"context"
	"log"

	"github.com/beepbite/backend/internal/integrations/mapbox"
	"github.com/beepbite/backend/internal/integrations/whatsapp"
	"github.com/beepbite/backend/internal/locations"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SystemBotID mirrors the TS constant: always used as the bot for all chats.
const SystemBotID = "46c4426a-9f5d-43d1-914c-d112deaf1d06"

// Service is the chatbot entrypoint.
type Service struct {
	pool   *pgxpool.Pool
	wa     *whatsapp.Client
	mapbox *mapbox.Client // nil when MAPBOX_TOKEN is not set
}

// New constructs the Service.
func New(pool *pgxpool.Pool, wa *whatsapp.Client) *Service {
	return &Service{pool: pool, wa: wa}
}

// NewWithMapbox constructs the Service with an optional Mapbox geocoding client.
// Pass nil to fall back to stub geocoding behaviour.
func NewWithMapbox(pool *pgxpool.Pool, wa *whatsapp.Client, mb *mapbox.Client) *Service {
	return &Service{pool: pool, wa: wa, mapbox: mb}
}

// currencySymbolFor returns the currency symbol for a location (e.g. "R" for
// ZAR).  Falls back to "R" on any error so the chatbot never surfaces a DB
// failure to the customer.
func (s *Service) currencySymbolFor(ctx context.Context, locationID string) string {
	if locationID == "" {
		return "R"
	}
	cur, err := locations.CurrencyFor(ctx, s.pool, locationID)
	if err != nil {
		log.Printf("chatbot: currencySymbolFor(%s): %v — falling back to R", locationID, err)
		return "R"
	}
	return cur.Symbol
}
