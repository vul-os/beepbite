package whatsappwebhook

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/beepbite/backend/internal/chatbot"
)

// Envelope mirrors the WhatsApp webhook POST payload shape.
type webhookEnvelope struct {
	Object string  `json:"object"`
	Entry  []entry `json:"entry"`
}

type entry struct {
	Changes []change `json:"changes"`
}

type change struct {
	Field string      `json:"field"`
	Value changeValue `json:"value"`
}

type changeValue struct {
	MessagingProduct string     `json:"messaging_product"`
	Metadata         metadata   `json:"metadata"`
	Contacts         []contact  `json:"contacts"`
	Messages         []message  `json:"messages"`
}

type metadata struct {
	DisplayPhoneNumber string `json:"display_phone_number"`
	PhoneNumberID      string `json:"phone_number_id"`
}

type contact struct {
	Profile profile `json:"profile"`
	WaID    string  `json:"wa_id"`
}

type profile struct {
	Name string `json:"name"`
}

type message struct {
	From      string      `json:"from"`
	ID        string      `json:"id"`
	Timestamp string      `json:"timestamp"`
	Type      string      `json:"type"`
	Text      *messageTxt `json:"text,omitempty"`
	Location  *messageLoc `json:"location,omitempty"`
}

type messageTxt struct {
	Body string `json:"body"`
}

type messageLoc struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Name      string  `json:"name,omitempty"`
	Address   string  `json:"address,omitempty"`
}

// NewHandler returns the combined GET/POST handler for the WhatsApp webhook.
// GET performs the verify_token handshake; POST processes incoming messages.
func NewHandler(svc *chatbot.Service, verifyToken string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodOptions:
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("ok"))
			return

		case http.MethodGet:
			mode := r.URL.Query().Get("hub.mode")
			token := r.URL.Query().Get("hub.verify_token")
			challenge := r.URL.Query().Get("hub.challenge")
			if mode == "subscribe" && token == verifyToken {
				log.Printf("Webhook verified successfully")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(challenge))
				return
			}
			log.Printf("Webhook verification failed")
			http.Error(w, "Forbidden", http.StatusForbidden)
			return

		case http.MethodPost:
			raw, err := io.ReadAll(r.Body)
			if err != nil {
				log.Printf("Webhook body read error: %v", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}
			defer r.Body.Close()

			var env webhookEnvelope
			if err := json.Unmarshal(raw, &env); err != nil {
				log.Printf("Webhook JSON decode error: %v", err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
				return
			}

			if env.Object == "whatsapp_business_account" {
				for _, e := range env.Entry {
					for _, ch := range e.Changes {
						if ch.Field != "messages" || len(ch.Value.Messages) == 0 {
							continue
						}
						data := ch.Value
						for _, m := range data.Messages {
							phoneNumberID := data.Metadata.PhoneNumberID
							from := m.From
							messageID := m.ID
							displayName := ""
							if len(data.Contacts) > 0 {
								displayName = data.Contacts[0].Profile.Name
							}

							messageBody := ""
							if m.Type == "text" && m.Text != nil {
								messageBody = m.Text.Body
							} else if m.Type == "location" && m.Location != nil {
								messageBody = fmt.Sprintf("LOCATION:%g,%g", m.Location.Latitude, m.Location.Longitude)
								if m.Location.Name != "" {
									messageBody += ":" + m.Location.Name
								}
								if m.Location.Address != "" {
									messageBody += ":" + m.Location.Address
								}
							}

							if messageBody == "" {
								continue
							}

							log.Printf("Processing message from=%s type=%s body=%q phone=%s displayName=%s",
								from, m.Type, messageBody, phoneNumberID, displayName)

							if err := svc.ProcessMessage(r.Context(), phoneNumberID, from, messageID, messageBody, displayName); err != nil {
								log.Printf("Error processing message: %v", err)
							}
						}
					}
				}
			}

			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("OK"))
			return

		default:
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		}
	})
}
