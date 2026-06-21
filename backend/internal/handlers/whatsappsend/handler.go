package whatsappsend

import (
	"encoding/json"
	"net/http"

	"github.com/beepbite/backend/internal/integrations/whatsapp"
)

type Request struct {
	To             string `json:"to,omitempty"`
	WhatsappNumber string `json:"whatsapp_number,omitempty"`
	Message        string `json:"message,omitempty"`
	PreviewURL     bool   `json:"preview_url,omitempty"`

	// Optional extended fields for other message types. When Type is empty
	// or "text", the handler treats the request as a text send.
	Type string `json:"type,omitempty"`

	// Interactive list
	BodyText   string                        `json:"body_text,omitempty"`
	ButtonText string                        `json:"button_text,omitempty"`
	Sections   []whatsapp.InteractiveSection `json:"sections,omitempty"`
	Buttons    []whatsapp.InteractiveButton  `json:"buttons,omitempty"`
	Header     string                        `json:"header,omitempty"`
	Footer     string                        `json:"footer,omitempty"`

	// Media
	ImageURL string `json:"image_url,omitempty"`
	DocURL   string `json:"doc_url,omitempty"`
	Filename string `json:"filename,omitempty"`
	Caption  string `json:"caption,omitempty"`

	// Template
	TemplateName string                   `json:"template_name,omitempty"`
	LanguageCode string                   `json:"language_code,omitempty"`
	Components   []map[string]interface{} `json:"components,omitempty"`

	// Reaction / mark as read
	MessageID string `json:"message_id,omitempty"`
	Emoji     string `json:"emoji,omitempty"`
}

type Response struct {
	Success bool                   `json:"success"`
	Data    *whatsapp.SendResponse `json:"data,omitempty"`
	Error   string                 `json:"error,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func NewHandler(wa *whatsapp.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, Response{Success: false, Error: "Method not allowed"})
			return
		}

		var req Request
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, Response{Success: false, Error: "Invalid JSON"})
			return
		}

		to := req.To
		if to == "" {
			to = req.WhatsappNumber
		}

		var (
			resp *whatsapp.SendResponse
			err  error
		)

		switch req.Type {
		case "", "text":
			if to == "" || req.Message == "" {
				writeJSON(w, http.StatusBadRequest, Response{Success: false, Error: "Missing required fields: to (or whatsapp_number) and message"})
				return
			}
			resp, err = wa.SendText(to, req.Message, req.PreviewURL)
		case "interactive_list":
			resp, err = wa.SendInteractiveList(to, req.BodyText, req.ButtonText, req.Sections, req.Header, req.Footer)
		case "interactive_buttons":
			resp, err = wa.SendInteractiveButtons(to, req.BodyText, req.Buttons, req.Header, req.Footer)
		case "image":
			resp, err = wa.SendImage(to, req.ImageURL, req.Caption)
		case "document":
			resp, err = wa.SendDocument(to, req.DocURL, req.Filename, req.Caption)
		case "template":
			resp, err = wa.SendTemplate(to, req.TemplateName, req.LanguageCode, req.Components)
		case "reaction":
			resp, err = wa.SendReaction(to, req.MessageID, req.Emoji)
		case "mark_as_read":
			if mErr := wa.MarkAsRead(req.MessageID); mErr != nil {
				writeJSON(w, http.StatusBadGateway, Response{Success: false, Error: mErr.Error()})
				return
			}
			writeJSON(w, http.StatusOK, Response{Success: true})
			return
		default:
			writeJSON(w, http.StatusBadRequest, Response{Success: false, Error: "Unsupported type: " + req.Type})
			return
		}

		if err != nil {
			writeJSON(w, http.StatusBadGateway, Response{Success: false, Error: err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, Response{Success: true, Data: resp})
	}
}
