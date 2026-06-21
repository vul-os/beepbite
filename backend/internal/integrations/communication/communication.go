package communication

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/beepbite/backend/internal/integrations/resend"
)

const SystemBotID = "46c4426a-9f5d-43d1-914c-d112deaf1d06"

type Config struct {
	Pool            *pgxpool.Pool
	WhatsAppToken   string
	WhatsAppBaseURL string
	ResendAPIKey    string
	HTTPClient      *http.Client
}

type Client struct {
	pool            *pgxpool.Pool
	whatsappToken   string
	whatsappBaseURL string
	httpClient      *http.Client
	resend          *resend.Client
}

func NewClient(cfg Config) *Client {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	baseURL := cfg.WhatsAppBaseURL
	if baseURL == "" {
		baseURL = "https://graph.facebook.com/v18.0"
	}
	return &Client{
		pool:            cfg.Pool,
		whatsappToken:   cfg.WhatsAppToken,
		whatsappBaseURL: baseURL,
		httpClient:      hc,
		resend: resend.NewClient(resend.Config{
			APIKey:     cfg.ResendAPIKey,
			HTTPClient: hc,
		}),
	}
}

type SmartMessageRequest struct {
	WhatsappNumber string `json:"whatsapp_number"`
	Message        string `json:"message"`
	Subject        string `json:"subject,omitempty"`
	LocationName   string `json:"location_name,omitempty"`
	OrderNumber    string `json:"order_number,omitempty"`
	OrderID        string `json:"order_id,omitempty"`
	CustomerID     string `json:"customer_id,omitempty"`
}

type SmartMessageDetails struct {
	CustomerID        string `json:"customer_id,omitempty"`
	EmailSent         *bool  `json:"email_sent,omitempty"`
	WhatsappSent      *bool  `json:"whatsapp_sent,omitempty"`
	HasRecentActivity *bool  `json:"has_recent_activity,omitempty"`
	HasChats          *bool  `json:"has_chats,omitempty"`
	CustomerEmail     string `json:"customer_email,omitempty"`
}

type SmartMessageResult struct {
	Success bool                 `json:"success"`
	Method  string               `json:"method"`
	Error   string               `json:"error,omitempty"`
	Details *SmartMessageDetails `json:"details,omitempty"`
}

type Customer struct {
	ID             string `json:"id"`
	WhatsappNumber string `json:"whatsapp_number,omitempty"`
	Email          string `json:"email,omitempty"`
	LastSeenAt     string `json:"last_seen_at,omitempty"`
}

type CanUseWhatsAppResult struct {
	CanUse            bool      `json:"canUse"`
	HasChats          bool      `json:"hasChats"`
	HasRecentActivity bool      `json:"hasRecentActivity"`
	Customer          *Customer `json:"customer,omitempty"`
}

type whatsappSendResult struct {
	success   bool
	messageID string
	errMsg    string
}

func boolPtr(v bool) *bool { return &v }

func (c *Client) sendWhatsAppMessage(ctx context.Context, to, message string) whatsappSendResult {
	if c.whatsappToken == "" || c.pool == nil {
		return whatsappSendResult{success: false, errMsg: "WhatsApp not configured"}
	}

	var phoneNumberID string
	err := c.pool.QueryRow(ctx,
		`SELECT whatsapp_phone_number_id FROM bots WHERE id = $1`,
		SystemBotID,
	).Scan(&phoneNumberID)
	if err != nil || phoneNumberID == "" {
		return whatsappSendResult{success: false, errMsg: "System bot not configured"}
	}

	payload, err := json.Marshal(map[string]interface{}{
		"messaging_product": "whatsapp",
		"to":                to,
		"type":              "text",
		"text":              map[string]interface{}{"body": message},
	})
	if err != nil {
		return whatsappSendResult{success: false, errMsg: err.Error()}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/%s/messages", c.whatsappBaseURL, phoneNumberID),
		bytes.NewReader(payload))
	if err != nil {
		return whatsappSendResult{success: false, errMsg: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+c.whatsappToken)
	req.Header.Set("Content-Type", "application/json")

	waResp, err := c.httpClient.Do(req)
	if err != nil {
		return whatsappSendResult{success: false, errMsg: err.Error()}
	}
	defer waResp.Body.Close()
	body, _ := io.ReadAll(waResp.Body)

	var result struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	_ = json.Unmarshal(body, &result)

	if waResp.StatusCode < 200 || waResp.StatusCode >= 300 {
		msg := result.Error.Message
		if msg == "" {
			msg = "WhatsApp API error"
		}
		return whatsappSendResult{success: false, errMsg: msg}
	}
	msgID := ""
	if len(result.Messages) > 0 {
		msgID = result.Messages[0].ID
	}
	return whatsappSendResult{success: true, messageID: msgID}
}

func (c *Client) getOrCreateCustomer(ctx context.Context, whatsappNumber string) *Customer {
	if c.pool == nil {
		return nil
	}
	var cust Customer
	var email, lastSeen *string
	err := c.pool.QueryRow(ctx, `
SELECT id, whatsapp_number, email, to_char(last_seen_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
FROM customers WHERE whatsapp_number = $1
`, whatsappNumber).Scan(&cust.ID, &cust.WhatsappNumber, &email, &lastSeen)

	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Insert fresh customer.
		err = c.pool.QueryRow(ctx, `
INSERT INTO customers (whatsapp_number, last_seen_at)
VALUES ($1, now())
RETURNING id, whatsapp_number, email, to_char(last_seen_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
`, whatsappNumber).Scan(&cust.ID, &cust.WhatsappNumber, &email, &lastSeen)
		if err != nil {
			return nil
		}
	case err != nil:
		return nil
	default:
		// Touch last_seen_at.
		_, _ = c.pool.Exec(ctx, `UPDATE customers SET last_seen_at = now() WHERE id = $1`, cust.ID)
	}
	if email != nil {
		cust.Email = *email
	}
	if lastSeen != nil {
		cust.LastSeenAt = *lastSeen
	}
	return &cust
}

func (c *Client) checkCustomerHasChats(ctx context.Context, customerID string) bool {
	if c.pool == nil {
		return false
	}
	var exists bool
	err := c.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM chats WHERE customer_id = $1)`,
		customerID,
	).Scan(&exists)
	return err == nil && exists
}

func (c *Client) checkRecentChatActivity(ctx context.Context, customerID string) bool {
	if c.pool == nil {
		return false
	}
	var exists bool
	err := c.pool.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1
  FROM messages m
  JOIN chats ch ON ch.id = m.chat_id
  WHERE ch.customer_id = $1 AND m.created_at >= now() - interval '24 hours'
)`, customerID).Scan(&exists)
	return err == nil && exists
}

func (c *Client) sendConsentEmail(email, locationName, orderID string) bool {
	consentURL := fmt.Sprintf("https://wa.me/27731136480?text=CONSENT-%s", orderID)
	result := c.resend.SendConsentEmail(
		email,
		fmt.Sprintf("Order Notification Setup - %s", locationName),
		consentURL,
		locationName,
	)
	return result.Success
}

var (
	asteriskRe  = regexp.MustCompile(`\*`)
	footerRe    = regexp.MustCompile(`📱 \*Powered by BeepBite\* 🚀`)
	altFooterRe = regexp.MustCompile(`📱 \*Powered by BeepBite\.io\* 🚀`)
)

func cleanMessageForFallback(message string) string {
	out := altFooterRe.ReplaceAllString(message, "")
	out = footerRe.ReplaceAllString(out, "")
	out = asteriskRe.ReplaceAllString(out, "")
	return strings.TrimSpace(out)
}

func (c *Client) SendSmartMessage(request SmartMessageRequest) SmartMessageResult {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	customer := c.getOrCreateCustomer(ctx, request.WhatsappNumber)
	if customer == nil {
		return SmartMessageResult{
			Success: false,
			Method:  "none",
			Error:   "Failed to create/find customer",
		}
	}

	hasChats := c.checkCustomerHasChats(ctx, customer.ID)

	if !hasChats && request.LocationName != "" && request.OrderID != "" {
		if customer.Email != "" {
			emailSent := c.sendConsentEmail(customer.Email, request.LocationName, request.OrderID)
			if emailSent {
				return SmartMessageResult{
					Success: true,
					Method:  "consent_email",
					Details: &SmartMessageDetails{
						CustomerID:    customer.ID,
						EmailSent:     boolPtr(true),
						CustomerEmail: customer.Email,
						HasChats:      boolPtr(false),
					},
				}
			}
			return SmartMessageResult{
				Success: false,
				Method:  "none",
				Error:   "Consent email failed and no other fallback available",
				Details: &SmartMessageDetails{
					CustomerID: customer.ID,
					HasChats:   boolPtr(false),
				},
			}
		}
		return SmartMessageResult{
			Success: false,
			Method:  "none",
			Error:   "No email available for new customer consent",
			Details: &SmartMessageDetails{
				CustomerID: customer.ID,
				HasChats:   boolPtr(false),
			},
		}
	}

	hasRecentActivity := c.checkRecentChatActivity(ctx, customer.ID)

	if hasRecentActivity {
		waResult := c.sendWhatsAppMessage(ctx, request.WhatsappNumber, request.Message)
		if waResult.success {
			return SmartMessageResult{
				Success: true,
				Method:  "whatsapp",
				Details: &SmartMessageDetails{
					CustomerID:        customer.ID,
					WhatsappSent:      boolPtr(true),
					HasRecentActivity: boolPtr(true),
					HasChats:          boolPtr(hasChats),
				},
			}
		}
	}

	if customer.Email != "" {
		emailSubject := request.Subject
		if emailSubject == "" {
			if request.OrderNumber != "" {
				locName := request.LocationName
				if locName == "" {
					locName = "Restaurant"
				}
				emailSubject = fmt.Sprintf("Order Update from %s", locName)
			} else {
				emailSubject = "Notification"
			}
		}
		cleanMessage := cleanMessageForFallback(request.Message)

		emailResult := c.resend.SendEmail(resend.EmailMessage{
			Email:   customer.Email,
			Subject: emailSubject,
			Message: cleanMessage,
		})

		if emailResult.Success {
			return SmartMessageResult{
				Success: true,
				Method:  "email",
				Details: &SmartMessageDetails{
					CustomerID:        customer.ID,
					EmailSent:         boolPtr(true),
					CustomerEmail:     customer.Email,
					HasRecentActivity: boolPtr(hasRecentActivity),
					HasChats:          boolPtr(hasChats),
				},
			}
		}
	}

	return SmartMessageResult{
		Success: false,
		Method:  "none",
		Error:   "All communication methods failed or unavailable",
		Details: &SmartMessageDetails{
			CustomerID:        customer.ID,
			HasRecentActivity: boolPtr(hasRecentActivity),
			HasChats:          boolPtr(hasChats),
			CustomerEmail:     customer.Email,
		},
	}
}

func (c *Client) CanUseWhatsApp(whatsappNumber string) CanUseWhatsAppResult {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	customer := c.getOrCreateCustomer(ctx, whatsappNumber)
	if customer == nil {
		return CanUseWhatsAppResult{}
	}
	hasChats := c.checkCustomerHasChats(ctx, customer.ID)
	hasRecentActivity := c.checkRecentChatActivity(ctx, customer.ID)
	return CanUseWhatsAppResult{
		CanUse:            hasChats && hasRecentActivity,
		HasChats:          hasChats,
		HasRecentActivity: hasRecentActivity,
		Customer:          customer,
	}
}
