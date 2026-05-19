package paystack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

type createTransferRecipientRequest struct {
	Type          string `json:"type"`
	Name          string `json:"name"`
	AccountNumber string `json:"account_number"`
	BankCode      string `json:"bank_code"`
	Currency      string `json:"currency"`
}

type transferRecipientData struct {
	RecipientCode string `json:"recipient_code"`
}

type createTransferRecipientResponse struct {
	Status  bool                  `json:"status"`
	Message string                `json:"message"`
	Data    transferRecipientData `json:"data"`
}

// CreateTransferRecipient registers a bank account with Paystack and returns
// the recipient_code which is used to reference this account in future
// transfer calls. See https://paystack.com/docs/api/transfer-recipient/#create.
func (c *Client) CreateTransferRecipient(ctx context.Context, name, accountNumber, bankCode, currency string) (string, error) {
	if c.secretKey == "" {
		return "", fmt.Errorf("paystack: secret key not configured")
	}

	body, err := json.Marshal(createTransferRecipientRequest{
		Type:          "nuban",
		Name:          name,
		AccountNumber: accountNumber,
		BankCode:      bankCode,
		Currency:      currency,
	})
	if err != nil {
		return "", fmt.Errorf("paystack: marshal create transfer recipient: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.paystack.co/transferrecipient", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("paystack: build create transfer recipient request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("paystack: create transfer recipient: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData paystackErrorBody
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if jsonErr := json.Unmarshal(respBody, &errData); jsonErr == nil && errData.Message != "" {
			msg = errData.Message
		}
		return "", fmt.Errorf("paystack: create transfer recipient failed: %s", msg)
	}

	var out createTransferRecipientResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", fmt.Errorf("paystack: decode create transfer recipient response: %w", err)
	}
	if out.Data.RecipientCode == "" {
		return "", fmt.Errorf("paystack: create transfer recipient returned empty recipient_code")
	}
	return out.Data.RecipientCode, nil
}

// DeleteTransferRecipient deactivates a Paystack transfer recipient by its
// recipient_code. Errors are non-fatal in most flows — callers should log and
// continue rather than blocking a soft-delete.
func (c *Client) DeleteTransferRecipient(ctx context.Context, recipientCode string) error {
	if c.secretKey == "" {
		return fmt.Errorf("paystack: secret key not configured")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, "https://api.paystack.co/transferrecipient/"+recipientCode, nil)
	if err != nil {
		return fmt.Errorf("paystack: build delete transfer recipient request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("paystack: delete transfer recipient: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		var errData paystackErrorBody
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if jsonErr := json.Unmarshal(respBody, &errData); jsonErr == nil && errData.Message != "" {
			msg = errData.Message
		}
		return fmt.Errorf("paystack: delete transfer recipient failed: %s", msg)
	}
	return nil
}
