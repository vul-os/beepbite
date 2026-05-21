// mailgun.go — Mailgun adapter.
//
// Uses the Mailgun v3 Messages API (form-encoded, not JSON).
// Docs: https://documentation.mailgun.com/docs/mailgun/api-reference/openapi-final/tag/Messages/
//
// BYO credential keys (encrypted_keys JSON):
//
//	"api_key"    — Mailgun private API key (starts with "key-")
//	"domain"     — sending domain (e.g. "mg.yourdomain.com")
//	"from_email" — optional sender override
//	"region"     — "us" (default) or "eu" — selects the API base URL
//
// TODO(heavy): add batch sending, recipient variables, tracking flags, and
// tag support for per-location analytics.
package email

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	mailgunUSBase = "https://api.mailgun.net/v3"
	mailgunEUBase = "https://api.eu.mailgun.net/v3"
)

// MailgunAdapter implements Provider using the Mailgun v3 Messages API.
type MailgunAdapter struct {
	apiKey     string
	domain     string
	fromAddr   string
	baseURL    string // mailgunUSBase or mailgunEUBase
	httpClient *http.Client
}

// NewMailgunAdapter constructs a MailgunAdapter.
//   - apiKey   — Mailgun private API key.
//   - domain   — verified sending domain.
//   - fromAddr — default sender address (e.g. "name@domain.com").
//   - region   — "eu" for EU infrastructure; anything else uses US.
//   - hc       — optional HTTP client.
func NewMailgunAdapter(apiKey, domain, fromAddr, region string, hc *http.Client) *MailgunAdapter {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	base := mailgunUSBase
	if strings.EqualFold(region, "eu") {
		base = mailgunEUBase
	}
	return &MailgunAdapter{
		apiKey:     apiKey,
		domain:     domain,
		fromAddr:   fromAddr,
		baseURL:    base,
		httpClient: hc,
	}
}

// Code implements Provider.
func (a *MailgunAdapter) Code() string { return "mailgun" }

// Send implements Provider.
func (a *MailgunAdapter) Send(ctx context.Context, msg Message) error {
	from := msg.From
	if from == "" {
		from = a.fromAddr
	}

	// Mailgun's Messages API accepts multipart/form-data; we use url.Values
	// (application/x-www-form-urlencoded) which Mailgun also accepts.
	form := url.Values{}
	form.Set("from", from)
	form.Set("to", msg.To)
	form.Set("subject", msg.Subject)
	if msg.Text != "" {
		form.Set("text", msg.Text)
	}
	if msg.HTML != "" {
		form.Set("html", msg.HTML)
	}
	if msg.ReplyTo != "" {
		form.Set("h:Reply-To", msg.ReplyTo)
	}

	endpoint := fmt.Sprintf("%s/%s/messages", a.baseURL, url.PathEscape(a.domain))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
		strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("%w (mailgun): build request: %v", ErrSendFailed, err)
	}
	req.SetBasicAuth("api", a.apiKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("%w (mailgun): http: %v", ErrSendFailed, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("%w (mailgun %d): %s", ErrSendFailed, resp.StatusCode, raw)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}
