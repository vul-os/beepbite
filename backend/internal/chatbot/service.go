// Package chatbot implements the BeepBite WhatsApp chatbot. It is the single
// point of entry for all inbound WhatsApp messages: it maintains per-chat
// conversation state in Postgres, routes each message to the correct
// sub-handler (ordering, review, address/billing/profile management), and
// sends responses via the whatsapp integration client.
package chatbot

import (
	"github.com/beepbite/backend/internal/integrations/whatsapp"
	"github.com/jackc/pgx/v5/pgxpool"
)

// SystemBotID mirrors the TS constant: always used as the bot for all chats.
const SystemBotID = "46c4426a-9f5d-43d1-914c-d112deaf1d06"

// Service is the chatbot entrypoint.
type Service struct {
	pool *pgxpool.Pool
	wa   *whatsapp.Client
}

// New constructs the Service.
func New(pool *pgxpool.Pool, wa *whatsapp.Client) *Service {
	return &Service{pool: pool, wa: wa}
}
