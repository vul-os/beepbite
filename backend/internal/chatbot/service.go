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
