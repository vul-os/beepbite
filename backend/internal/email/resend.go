// resend.go — Resend (https://resend.com) adapter.
//
// Resend is the platform default provider.  The platform API key is read from
// RESEND_API_KEY; the default sender is EMAIL_FROM_DEFAULT (or the constant
// fallback below).  Per-location BYO credentials store the API key in the
// encrypted_keys JSON blob under the key "api_key".
//
// Wire format: POST https://api.resend.com/emails
// Docs: https://resend.com/docs/api-reference/emails/send-email
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

const (
	resendEndpoint    = "https://api.resend.com/emails"
	resendDefaultFrom = "BeepBite <noreply@updates.beepbite.io>"
)

// ResendAdapter implements Provider using the Resend HTTP API.
type ResendAdapter struct {
	apiKey     string
	fromAddr   string
	httpClient *http.Client
}

// NewResendAdapter constructs a ResendAdapter.
//   - apiKey    — Resend API key (starts with "re_").
//   - fromAddr  — default From address; falls back to resendDefaultFrom when empty.
//   - hc        — optional HTTP client; a 30-second default is used when nil.
func NewResendAdapter(apiKey, fromAddr string, hc *http.Client) *ResendAdapter {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	if fromAddr == "" {
		fromAddr = resendDefaultFrom
	}
	return &ResendAdapter{apiKey: apiKey, fromAddr: fromAddr, httpClient: hc}
}

// Code implements Provider.
func (a *ResendAdapter) Code() string { return "resend" }

// resendRequest is the JSON body for POST /emails.
type resendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html,omitempty"`
	Text    string   `json:"text,omitempty"`
	ReplyTo string   `json:"reply_to,omitempty"`
}

// resendErrorResponse is the JSON body returned by the Resend API on 4xx/5xx.
type resendErrorResponse struct {
	Name       string `json:"name"`
	Message    string `json:"message"`
	StatusCode int    `json:"statusCode"`
}

// Send implements Provider.
func (a *ResendAdapter) Send(ctx context.Context, msg Message) error {
	from := msg.From
	if from == "" {
		from = a.fromAddr
	}

	payload := resendRequest{
		From:    from,
		To:      []string{msg.To},
		Subject: msg.Subject,
		HTML:    msg.HTML,
		Text:    msg.Text,
		ReplyTo: msg.ReplyTo,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("%w (resend): marshal: %v", ErrSendFailed, err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, resendEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("%w (resend): build request: %v", ErrSendFailed, err)
	}
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w (resend): http: %v", ErrSendFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var apiErr resendErrorResponse
		if json.Unmarshal(raw, &apiErr) == nil && apiErr.Message != "" {
			return fmt.Errorf("%w (resend %d): %s", ErrSendFailed, resp.StatusCode, apiErr.Message)
		}
		return fmt.Errorf("%w (resend): status %d", ErrSendFailed, resp.StatusCode)
	}

	// Drain body so the connection is reused.
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}
