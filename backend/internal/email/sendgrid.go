// sendgrid.go — SendGrid (https://sendgrid.com) adapter.
//
// Uses the SendGrid v3 Mail Send API.
// Docs: https://docs.sendgrid.com/api-reference/mail-send/mail-send
//
// BYO credential keys (encrypted_keys JSON):
//
//	"api_key"    — SendGrid API key (starts with "SG.")
//	"from_email" — optional sender override
//
// TODO(heavy): add support for SendGrid categories, custom args, and
// unsubscribe group IDs needed for transactional vs marketing separation.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const sendgridEndpoint = "https://api.sendgrid.com/v3/mail/send"

// SendGridAdapter implements Provider using the SendGrid v3 API.
type SendGridAdapter struct {
	apiKey     string
	fromAddr   string
	fromName   string
	httpClient *http.Client
}

// NewSendGridAdapter constructs a SendGridAdapter.
//   - apiKey    — SendGrid API key.
//   - fromAddr  — verified sender email address.
//   - fromName  — display name for the From header.
//   - hc        — optional HTTP client.
func NewSendGridAdapter(apiKey, fromAddr, fromName string, hc *http.Client) *SendGridAdapter {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &SendGridAdapter{
		apiKey:     apiKey,
		fromAddr:   fromAddr,
		fromName:   fromName,
		httpClient: hc,
	}
}

// Code implements Provider.
func (a *SendGridAdapter) Code() string { return "sendgrid" }

// sendgridMailBody is the minimal v3 mail send payload.
type sendgridMailBody struct {
	Personalizations []sendgridPersonalization `json:"personalizations"`
	From             sendgridAddress           `json:"from"`
	Subject          string                    `json:"subject"`
	Content          []sendgridContent         `json:"content"`
	ReplyToList      []sendgridAddress         `json:"reply_to_list,omitempty"`
}

type sendgridPersonalization struct {
	To []sendgridAddress `json:"to"`
}

type sendgridAddress struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type sendgridContent struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// Send implements Provider.
func (a *SendGridAdapter) Send(ctx context.Context, msg Message) error {
	content := make([]sendgridContent, 0, 2)
	if msg.Text != "" {
		content = append(content, sendgridContent{Type: "text/plain", Value: msg.Text})
	}
	if msg.HTML != "" {
		content = append(content, sendgridContent{Type: "text/html", Value: msg.HTML})
	}
	if len(content) == 0 {
		return fmt.Errorf("%w (sendgrid): message has no text or html body", ErrSendFailed)
	}

	payload := sendgridMailBody{
		Personalizations: []sendgridPersonalization{
			{To: []sendgridAddress{{Email: msg.To}}},
		},
		From:    sendgridAddress{Email: a.fromAddr, Name: a.fromName},
		Subject: msg.Subject,
		Content: content,
	}
	if msg.ReplyTo != "" {
		payload.ReplyToList = []sendgridAddress{{Email: msg.ReplyTo}}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("%w (sendgrid): marshal: %v", ErrSendFailed, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sendgridEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("%w (sendgrid): build request: %v", ErrSendFailed, err)
	}
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w (sendgrid): http: %v", ErrSendFailed, err)
	}
	defer resp.Body.Close()

	// SendGrid returns 202 Accepted on success.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("%w (sendgrid %d): %s", ErrSendFailed, resp.StatusCode, raw)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}
