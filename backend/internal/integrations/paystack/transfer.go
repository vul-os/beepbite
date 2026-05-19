package paystack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type createTransferRequest struct {
	Source    string `json:"source"`
	Amount    int64  `json:"amount"`
	Recipient string `json:"recipient"`
	Reason    string `json:"reason,omitempty"`
}

type transferData struct {
	TransferCode string `json:"transfer_code"`
}

type createTransferResponse struct {
	Status  bool         `json:"status"`
	Message string       `json:"message"`
	Data    transferData `json:"data"`
}

// CreateTransfer initiates a Paystack transfer from the integration's balance
// to a pre-registered recipient.
//
// amountCents is in the currency's smallest unit (kobo for NGN, cents for ZAR
// — Paystack accepts the smallest unit regardless of what they call it).
// recipientCode is the provider_recipient_id stored in bank_accounts.
// reason is a human-readable description surfaced in transfer dashboards.
//
// Returns the transfer_code assigned by Paystack, which callers should store
// as provider_transfer_id on the merchant_payouts row.
func (c *Client) CreateTransfer(ctx context.Context, amountCents int64, recipientCode, reason string) (string, error) {
	if c.secretKey == "" {
		return "", fmt.Errorf("paystack: CreateTransfer: secret key not configured")
	}

	body, err := json.Marshal(createTransferRequest{
		Source:    "balance",
		Amount:    amountCents,
		Recipient: recipientCode,
		Reason:    reason,
	})
	if err != nil {
		return "", fmt.Errorf("paystack: CreateTransfer: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.paystack.co/transfer", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("paystack: CreateTransfer: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("paystack: CreateTransfer: http: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData paystackErrorBody
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if jsonErr := json.Unmarshal(respBody, &errData); jsonErr == nil && errData.Message != "" {
			msg = errData.Message
		}
		return "", fmt.Errorf("paystack: CreateTransfer: %s", msg)
	}

	var out createTransferResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", fmt.Errorf("paystack: CreateTransfer: decode response: %w", err)
	}
	if !out.Status {
		return "", fmt.Errorf("paystack: CreateTransfer: %s", out.Message)
	}
	if out.Data.TransferCode == "" {
		return "", fmt.Errorf("paystack: CreateTransfer: empty transfer_code in response")
	}
	return out.Data.TransferCode, nil
}
