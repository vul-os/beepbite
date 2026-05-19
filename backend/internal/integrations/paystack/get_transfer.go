package paystack

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// TransferDetail is the relevant portion of Paystack's GET /transfer/:id
// response data object.
type TransferDetail struct {
	TransferCode string `json:"transfer_code"`
	Reference    string `json:"reference"`
	// Status values from Paystack: "success", "failed", "reversed",
	// "pending", "otp", "processing".
	Status  string `json:"status"`
	// Reason holds the human-readable failure description when Status=="failed".
	Reason  string `json:"reason"`
	Failures []struct {
		Reason string `json:"reason"`
	} `json:"failures"`
}

type getTransferResponse struct {
	Status  bool           `json:"status"`
	Message string         `json:"message"`
	Data    TransferDetail `json:"data"`
}

// GetTransfer fetches the current state of a Paystack transfer by its
// transfer_code (e.g. "TRF_...").  It returns the TransferDetail on success.
func (c *Client) GetTransfer(ctx context.Context, transferCode string) (*TransferDetail, error) {
	if c.secretKey == "" {
		return nil, fmt.Errorf("paystack: secret key not configured")
	}
	if transferCode == "" {
		return nil, fmt.Errorf("paystack: transferCode must not be empty")
	}

	url := "https://api.paystack.co/transfer/" + transferCode
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("paystack: read GetTransfer response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData paystackErrorBody
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		if json.Unmarshal(respBody, &errData) == nil && errData.Message != "" {
			msg = errData.Message
		}
		return nil, fmt.Errorf("paystack: GetTransfer %s: %s", transferCode, msg)
	}

	var out getTransferResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, fmt.Errorf("paystack: decode GetTransfer response: %w", err)
	}
	return &out.Data, nil
}
