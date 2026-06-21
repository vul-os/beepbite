package resend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Config struct {
	APIKey     string
	HTTPClient *http.Client
}

type Client struct {
	apiKey     string
	httpClient *http.Client
}

func NewClient(cfg Config) *Client {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{apiKey: cfg.APIKey, httpClient: hc}
}

type EmailMessage struct {
	Email   string `json:"email"`
	Subject string `json:"subject"`
	Message string `json:"message"`
}

type EmailResult struct {
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
	MessageID string `json:"messageId,omitempty"`
}

type resendRequest struct {
	From    string            `json:"from"`
	To      []string          `json:"to"`
	Subject string            `json:"subject"`
	HTML    string            `json:"html"`
	Text    string            `json:"text"`
	ReplyTo string            `json:"reply_to"`
	Headers map[string]string `json:"headers"`
}

type resendResponse struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}

func generateEmailTemplate(message string) string {
	body := strings.ReplaceAll(message, "\n", "<br>")
	return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BeepBite.io</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">

        <!-- Header -->
        <div style="background-color: #F97316; padding: 30px 25px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: normal;">BeepBite.io</h1>
            <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Restaurant Communication</p>
        </div>

        <!-- Content -->
        <div style="padding: 30px 25px;">
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333;">Hi there,</p>

            <div style="font-size: 15px; color: #555; line-height: 1.6; margin-bottom: 25px;">
                ` + body + `
            </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8f8f8; padding: 20px 25px; border-top: 1px solid #e0e0e0; text-align: center;">
            <p style="margin: 0; font-size: 13px; color: #888;">
                <strong style="color: #F97316;">BeepBite.io</strong><br>
                This email was sent regarding your restaurant communication.
            </p>
            <p style="margin: 10px 0 0 0; font-size: 12px; color: #aaa;">
                If you no longer wish to receive these emails, please contact your restaurant directly.
            </p>
        </div>

    </div>

    <!-- Spacer for email clients -->
    <div style="height: 20px;"></div>
</body>
</html>`
}

func generatePlainTextTemplate(message string) string {
	return `BeepBite.io - Restaurant Communication

Hi there,

` + message + `

---
BeepBite.io
This email was sent regarding your restaurant communication.
If you no longer wish to receive these emails, please contact your restaurant directly.`
}

func (c *Client) sendResendRequest(body resendRequest) EmailResult {
	if c.apiKey == "" {
		return EmailResult{Success: false, Error: "Resend API key not found in environment variables"}
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return EmailResult{Success: false, Error: fmt.Sprintf("Resend network error: %v", err)}
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		return EmailResult{Success: false, Error: fmt.Sprintf("Resend network error: %v", err)}
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return EmailResult{Success: false, Error: fmt.Sprintf("Resend network error: %v", err)}
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData resendResponse
		msg := ""
		if err := json.Unmarshal(respBody, &errData); err == nil {
			msg = errData.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("Resend API error: %d", resp.StatusCode)
		}
		return EmailResult{Success: false, Error: msg}
	}

	var result resendResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return EmailResult{Success: false, Error: fmt.Sprintf("Resend network error: %v", err)}
	}

	return EmailResult{Success: true, MessageID: result.ID}
}

func (c *Client) SendConsentEmail(email, subject, consentUrl, bistroName string) EmailResult {
	if c.apiKey == "" {
		return EmailResult{Success: false, Error: "Resend API key not found in environment variables"}
	}

	htmlContent := `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Order Notification Setup</title>
</head>
<body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; border: 1px solid #e0e0e0;">

        <!-- Header -->
        <div style="background-color: #F97316; padding: 25px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: normal;">Order Notification Setup</h1>
            <p style="color: #ffffff; margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Service Configuration Required</p>
        </div>

        <!-- Content -->
        <div style="padding: 30px 25px;">
            <p style="margin: 0 0 20px 0; font-size: 16px; color: #333;">Hello,</p>

            <p style="margin: 0 0 20px 0; font-size: 15px; color: #555;">
                ` + bistroName + ` has requested to send you order status notifications via WhatsApp for faster service.
            </p>

            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #F97316;">
                <h3 style="margin: 0 0 10px 0; color: #F97316; font-size: 16px;">Action Required</h3>
                <p style="margin: 0; font-size: 14px; color: #555;">
                    To receive instant notifications when your order is ready, please enable WhatsApp notifications by clicking the button below.
                </p>
            </div>

            <div style="text-align: center; margin: 25px 0;">
                <a href="` + consentUrl + `" style="background-color: #25D366; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 14px;">
                    Enable WhatsApp Notifications
                </a>
            </div>

            <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #ffc107;">
                <p style="margin: 0; font-size: 13px; color: #856404;">
                    <strong>Can't click the button?</strong> Copy and paste this link into your browser:<br>
                    <span style="word-break: break-all; font-family: monospace; font-size: 12px; color: #F97316;">` + consentUrl + `</span>
                </p>
            </div>

            <div style="margin: 25px 0; font-size: 14px; color: #666;">
                <p style="margin: 0 0 10px 0;"><strong>Benefits of WhatsApp notifications:</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                    <li>Instant alerts when your order is ready</li>
                    <li>Reduces waiting time at the restaurant</li>
                    <li>Ensures you get hot, fresh food</li>
                </ul>
            </div>
        </div>

        <!-- Footer -->
        <div style="background-color: #f8f8f8; padding: 20px 25px; border-top: 1px solid #e0e0e0;">
            <p style="margin: 0; font-size: 12px; color: #888; text-align: center;">
                This is a service notification from ` + bistroName + ` via BeepBite.io<br>
                <span style="color: #aaa;">Order notification setup • Not promotional</span>
            </p>
        </div>

    </div>
</body>
</html>`

	textContent := `Order Notification Setup - ` + bistroName + `

Hello,

` + bistroName + ` has requested to send you order status notifications via WhatsApp for faster service.

ACTION REQUIRED:
To receive instant notifications when your order is ready, please enable WhatsApp notifications by visiting this link:

` + consentUrl + `

Benefits of WhatsApp notifications:
• Instant alerts when your order is ready
• Reduces waiting time at the restaurant
• Ensures you get hot, fresh food

---
This is a service notification from ` + bistroName + ` via BeepBite.io
Order notification setup • Not promotional`

	return c.sendResendRequest(resendRequest{
		From:    "BeepBite.io <noreply@updates.beepbite.io>",
		To:      []string{email},
		Subject: subject,
		HTML:    htmlContent,
		Text:    textContent,
		ReplyTo: "coowner@example.com",
		Headers: map[string]string{
			"List-Unsubscribe": "<mailto:coowner@example.com?subject=Unsubscribe>",
			"X-Entity-Ref-ID":  "beepbite-restaurant-communication",
		},
	})
}

func (c *Client) SendEmail(msg EmailMessage) EmailResult {
	if c.apiKey == "" {
		return EmailResult{Success: false, Error: "Resend API key not found in environment variables"}
	}
	if msg.Email == "" || msg.Subject == "" || msg.Message == "" {
		return EmailResult{Success: false, Error: "Email, subject, and message are required"}
	}

	return c.sendResendRequest(resendRequest{
		From:    "BeepBite.io <noreply@updates.beepbite.io>",
		To:      []string{msg.Email},
		Subject: msg.Subject,
		HTML:    generateEmailTemplate(msg.Message),
		Text:    generatePlainTextTemplate(msg.Message),
		ReplyTo: "coowner@example.com",
		Headers: map[string]string{
			"List-Unsubscribe": "<mailto:coowner@example.com?subject=Unsubscribe>",
			"X-Entity-Ref-ID":  "beepbite-restaurant-communication",
		},
	})
}
