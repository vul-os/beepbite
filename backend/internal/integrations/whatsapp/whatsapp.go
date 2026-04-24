package whatsapp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const DefaultBaseURL = "https://graph.facebook.com/v18.0"

type Client struct {
	accessToken   string
	phoneNumberID string
	baseURL       string
	httpClient    *http.Client
}

func NewClient(accessToken, phoneNumberID string) *Client {
	return &Client{
		accessToken:   accessToken,
		phoneNumberID: phoneNumberID,
		baseURL:       DefaultBaseURL,
		httpClient:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) SetBaseURL(baseURL string) {
	if baseURL != "" {
		c.baseURL = baseURL
	}
}

func (c *Client) SetHTTPClient(hc *http.Client) {
	if hc != nil {
		c.httpClient = hc
	}
}

type SendResponse struct {
	MessagingProduct string `json:"messaging_product,omitempty"`
	Contacts         []struct {
		Input string `json:"input"`
		WaID  string `json:"wa_id"`
	} `json:"contacts,omitempty"`
	Messages []struct {
		ID string `json:"id"`
	} `json:"messages,omitempty"`
}

type apiError struct {
	Error struct {
		Message   string `json:"message"`
		Type      string `json:"type"`
		Code      int    `json:"code"`
		FBTraceID string `json:"fbtrace_id"`
	} `json:"error"`
}

func (c *Client) post(payload map[string]interface{}) (*SendResponse, error) {
	if c.accessToken == "" {
		return nil, fmt.Errorf("whatsapp: access token not configured")
	}
	if c.phoneNumberID == "" {
		return nil, fmt.Errorf("whatsapp: phone number id not configured")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/%s/messages", c.baseURL, c.phoneNumberID)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiErr apiError
		_ = json.Unmarshal(raw, &apiErr)
		msg := apiErr.Error.Message
		if msg == "" {
			msg = fmt.Sprintf("whatsapp api error: status %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("%s", msg)
	}

	var out SendResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// SendText sends a plain text message.
func (c *Client) SendText(to, body string, previewURL bool) (*SendResponse, error) {
	return c.post(map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "text",
		"text": map[string]interface{}{
			"preview_url": previewURL,
			"body":        body,
		},
	})
}

type InteractiveRow struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
}

type InteractiveSection struct {
	Title string           `json:"title,omitempty"`
	Rows  []InteractiveRow `json:"rows"`
}

// SendInteractiveList sends a WhatsApp interactive list message.
func (c *Client) SendInteractiveList(to, bodyText, buttonText string, sections []InteractiveSection, header, footer string) (*SendResponse, error) {
	interactive := map[string]interface{}{
		"type": "list",
		"body": map[string]interface{}{"text": bodyText},
		"action": map[string]interface{}{
			"button":   buttonText,
			"sections": sections,
		},
	}
	if header != "" {
		interactive["header"] = map[string]interface{}{"type": "text", "text": header}
	}
	if footer != "" {
		interactive["footer"] = map[string]interface{}{"text": footer}
	}

	return c.post(map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "interactive",
		"interactive":       interactive,
	})
}

type InteractiveButton struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// SendInteractiveButtons sends a reply-buttons interactive message.
func (c *Client) SendInteractiveButtons(to, bodyText string, buttons []InteractiveButton, header, footer string) (*SendResponse, error) {
	btns := make([]map[string]interface{}, 0, len(buttons))
	for _, b := range buttons {
		btns = append(btns, map[string]interface{}{
			"type": "reply",
			"reply": map[string]interface{}{
				"id":    b.ID,
				"title": b.Title,
			},
		})
	}
	interactive := map[string]interface{}{
		"type":   "button",
		"body":   map[string]interface{}{"text": bodyText},
		"action": map[string]interface{}{"buttons": btns},
	}
	if header != "" {
		interactive["header"] = map[string]interface{}{"type": "text", "text": header}
	}
	if footer != "" {
		interactive["footer"] = map[string]interface{}{"text": footer}
	}

	return c.post(map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "interactive",
		"interactive":       interactive,
	})
}

// SendImage sends an image message by URL (or id via separate field).
func (c *Client) SendImage(to, imageURL, caption string) (*SendResponse, error) {
	image := map[string]interface{}{"link": imageURL}
	if caption != "" {
		image["caption"] = caption
	}
	return c.post(map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "image",
		"image":             image,
	})
}

// SendDocument sends a document by URL.
func (c *Client) SendDocument(to, docURL, filename, caption string) (*SendResponse, error) {
	doc := map[string]interface{}{"link": docURL}
	if filename != "" {
		doc["filename"] = filename
	}
	if caption != "" {
		doc["caption"] = caption
	}
	return c.post(map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "document",
		"document":          doc,
	})
}

// SendTemplate sends a pre-approved template message.
func (c *Client) SendTemplate(to, name, languageCode string, components []map[string]interface{}) (*SendResponse, error) {
	tmpl := map[string]interface{}{
		"name":     name,
		"language": map[string]interface{}{"code": languageCode},
	}
	if len(components) > 0 {
		tmpl["components"] = components
	}
	return c.post(map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "template",
		"template":          tmpl,
	})
}

// SendReaction reacts to a previously received message.
func (c *Client) SendReaction(to, messageID, emoji string) (*SendResponse, error) {
	return c.post(map[string]interface{}{
		"messaging_product": "whatsapp",
		"recipient_type":    "individual",
		"to":                to,
		"type":              "reaction",
		"reaction": map[string]interface{}{
			"message_id": messageID,
			"emoji":      emoji,
		},
	})
}

// MarkAsRead marks an inbound message as read.
func (c *Client) MarkAsRead(messageID string) error {
	_, err := c.post(map[string]interface{}{
		"messaging_product": "whatsapp",
		"status":            "read",
		"message_id":        messageID,
	})
	return err
}
