package paystack

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Config struct {
	SecretKey   string
	FrontendURL string
	Pool        *pgxpool.Pool
	HTTPClient  *http.Client
}

type Client struct {
	secretKey   string
	frontendURL string
	pool        *pgxpool.Pool
	httpClient  *http.Client
}

func NewClient(cfg Config) *Client {
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		secretKey:   cfg.SecretKey,
		frontendURL: cfg.FrontendURL,
		pool:        cfg.Pool,
		httpClient:  hc,
	}
}

type PaymentCalculation struct {
	OrderTotalCents     int64 `json:"order_total_cents"`
	DriverTipCents      int64 `json:"driver_tip_cents"`
	ProcessingFeeCents  int64 `json:"processing_fee_cents"`
	GatewayFeeCents     int64 `json:"gateway_fee_cents"`
	PlatformFeeCents    int64 `json:"platform_fee_cents"`
	TotalAmountCents    int64 `json:"total_amount_cents"`
	MerchantAmountCents int64 `json:"merchant_amount_cents"`
}

type PaymentResult struct {
	Success          bool               `json:"success"`
	Error            string             `json:"error,omitempty"`
	PaymentMethod    string             `json:"payment_method"`
	TransactionID    string             `json:"transaction_id,omitempty"`
	PaymentLink      string             `json:"payment_link,omitempty"`
	AuthorizationURL string             `json:"authorization_url,omitempty"`
	Reference        string             `json:"reference,omitempty"`
	AmountCents      int64              `json:"amount_cents"`
	Calculation      PaymentCalculation `json:"calculation"`
}

type OrderPaymentData struct {
	OrderID          string `json:"order_id"`
	CustomerID       string `json:"customer_id"`
	LocationID       string `json:"location_id"`
	TotalAmountCents int64  `json:"total_amount_cents"`
	DriverTipCents   int64  `json:"driver_tip_cents"`
	CustomerEmail    string `json:"customer_email"`
	CustomerPhone    string `json:"customer_phone,omitempty"`
	CustomerName     string `json:"customer_name,omitempty"`
}

type SavedPaymentMethod struct {
	ID                string `json:"id"`
	AuthorizationCode string `json:"authorization_code"`
	GatewayProvider   string `json:"gateway_provider"`
	CustomerID        string `json:"customer_id"`
	PaymentMethodCode string `json:"payment_method_code"`
	CardLastFour      string `json:"card_last_four,omitempty"`
	CardType          string `json:"card_type,omitempty"`
}

type CardDetails struct {
	Last4    string `json:"last4"`
	CardType string `json:"card_type"`
	ExpMonth string `json:"exp_month"`
	ExpYear  string `json:"exp_year"`
}

func (c *Client) CalculatePaymentAmount(orderTotalCents, driverTipCents int64, locationID string) (PaymentCalculation, error) {
	baseAmount := orderTotalCents + driverTipCents

	const gatewayFeePercentage = 3.1
	const gatewayFixedFeeCents = int64(100)

	gatewayFee := gatewayFixedFeeCents + int64(math.Round(float64(baseAmount)*gatewayFeePercentage/100))

	const processingFeePercentage = 0.65
	const processingFixedFeeCents = int64(100)

	processingFee := processingFixedFeeCents + int64(math.Round(float64(baseAmount)*processingFeePercentage/100))

	platformFee := processingFee - gatewayFee
	if platformFee < 0 {
		platformFee = 0
	}

	total := baseAmount + processingFee
	merchant := baseAmount - processingFee

	return PaymentCalculation{
		OrderTotalCents:     orderTotalCents,
		DriverTipCents:      driverTipCents,
		ProcessingFeeCents:  processingFee,
		GatewayFeeCents:     gatewayFee,
		PlatformFeeCents:    platformFee,
		TotalAmountCents:    total,
		MerchantAmountCents: merchant,
	}, nil
}

type chargeAuthorizationRequest struct {
	AuthorizationCode string `json:"authorization_code"`
	Email             string `json:"email"`
	Amount            int64  `json:"amount"`
	Reference         string `json:"reference"`
	Currency          string `json:"currency"`
}

type paystackErrorBody struct {
	Message string `json:"message"`
}

type chargeData struct {
	ID        json.RawMessage `json:"id"`
	Reference string          `json:"reference"`
}

type ChargeResponse struct {
	Status  string     `json:"status"`
	Message string     `json:"message"`
	Data    chargeData `json:"data"`
}

func (c *Client) chargeExistingPaymentMethod(authCode string, amountCents int64, reference, email string) (*ChargeResponse, error) {
	if c.secretKey == "" {
		return nil, fmt.Errorf("PayStack secret key not found in environment variables")
	}

	body, err := json.Marshal(chargeAuthorizationRequest{
		AuthorizationCode: authCode,
		Email:             email,
		Amount:            amountCents,
		Reference:         reference,
		Currency:          "ZAR",
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.paystack.co/transaction/charge_authorization", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData paystackErrorBody
		msg := ""
		if err := json.Unmarshal(respBody, &errData); err == nil {
			msg = errData.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("%d", resp.StatusCode)
		}
		return nil, fmt.Errorf("PayStack charge failed: %s", msg)
	}

	var out ChargeResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type initializeRequest struct {
	Email       string                 `json:"email"`
	Amount      int64                  `json:"amount"`
	Reference   string                 `json:"reference"`
	Currency    string                 `json:"currency"`
	CallbackURL string                 `json:"callback_url"`
	Metadata    map[string]interface{} `json:"metadata"`
	Channels    []string               `json:"channels"`
	Plan        *string                `json:"plan"`
}

type initializeData struct {
	AccessCode       string `json:"access_code"`
	AuthorizationURL string `json:"authorization_url"`
	Reference        string `json:"reference"`
}

type InitializeResponse struct {
	Status  string         `json:"status"`
	Message string         `json:"message"`
	Data    initializeData `json:"data"`
}

func (c *Client) generatePaymentLink(amountCents int64, reference, email, customerName string) (*InitializeResponse, error) {
	if c.secretKey == "" {
		return nil, fmt.Errorf("PayStack secret key not found in environment variables")
	}

	callback := c.frontendURL + "/payment-success"

	body, err := json.Marshal(initializeRequest{
		Email:       email,
		Amount:      amountCents,
		Reference:   reference,
		Currency:    "ZAR",
		CallbackURL: callback,
		Metadata: map[string]interface{}{
			"customer_name": customerName,
			"payment_type":  "order_payment",
		},
		Channels: []string{"card"},
		Plan:     nil,
	})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.paystack.co/transaction/initialize", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData paystackErrorBody
		msg := ""
		if err := json.Unmarshal(respBody, &errData); err == nil {
			msg = errData.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("%d", resp.StatusCode)
		}
		return nil, fmt.Errorf("PayStack initialization failed: %s", msg)
	}

	var out InitializeResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) getOrderPaymentData(orderID string) (*OrderPaymentData, error) {
	if c.pool == nil {
		return nil, fmt.Errorf("paystack: pgx pool not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var (
		o         OrderPaymentData
		email     *string
		phone     *string
		firstName *string
		lastName  *string
	)
	// order_financial_details was dropped in the Wave 0 consolidation (migration 008).
	// Financial totals are now integer-cent columns directly on orders:
	//   subtotal_cents, tax_cents, total_cents (bigint, already in minor units / cents).
	// Paystack's ZAR amount field expects cents (100 = R1.00), so total_cents maps
	// directly with no multiplication. The old code read ofd.total_amount (a decimal
	// rands value) via a LEFT JOIN that silently returned NULL → COALESCE → 0, then
	// multiplied by 100. That join is removed here.
	err := c.pool.QueryRow(ctx, `
SELECT o.id, o.customer_id, o.location_id,
       o.total_cents,
       c.email, c.whatsapp_number, c.first_name, c.last_name
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
WHERE o.id = $1
`, orderID).Scan(&o.OrderID, &o.CustomerID, &o.LocationID, &o.TotalAmountCents, &email, &phone, &firstName, &lastName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("Order not found")
		}
		return nil, err
	}
	// Driver tip is not yet stored per-order; default to zero.
	o.DriverTipCents = 0
	if email != nil {
		o.CustomerEmail = *email
	}
	if phone != nil {
		o.CustomerPhone = *phone
	}
	name := ""
	if firstName != nil {
		name = *firstName
	}
	if lastName != nil {
		if name != "" {
			name += " "
		}
		name += *lastName
	}
	o.CustomerName = name
	return &o, nil
}

func (c *Client) getSavedPaymentMethod(authID string) (*SavedPaymentMethod, error) {
	if c.pool == nil {
		return nil, fmt.Errorf("paystack: pgx pool not configured")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var m SavedPaymentMethod
	err := c.pool.QueryRow(ctx, `
SELECT id, customer_id, authorization_code, card_last_four, card_type
FROM customer_payment_authorizations
WHERE id = $1 AND is_active = true
`, authID).Scan(&m.ID, &m.CustomerID, &m.AuthorizationCode, &m.CardLastFour, &m.CardType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("Payment method not found or inactive")
		}
		return nil, err
	}
	return &m, nil
}

func generatePaymentReference(orderID string) string {
	ts := time.Now().UnixMilli()
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return fmt.Sprintf("beepbite_%s_%d_%s", orderID, ts, hex.EncodeToString(b)[:6])
}

func (c *Client) ProcessOrderPayment(orderID string, customerPaymentAuthorizationID string) PaymentResult {
	paymentMethodLabel := "new_card"
	if customerPaymentAuthorizationID != "" {
		paymentMethodLabel = "existing"
	}

	failure := func(errMsg string) PaymentResult {
		return PaymentResult{
			Success:       false,
			Error:         errMsg,
			PaymentMethod: paymentMethodLabel,
			AmountCents:   0,
			Calculation:   PaymentCalculation{},
		}
	}

	orderData, err := c.getOrderPaymentData(orderID)
	if err != nil {
		return failure(fmt.Sprintf("Payment processing failed: %v", err))
	}

	calc, err := c.CalculatePaymentAmount(orderData.TotalAmountCents, orderData.DriverTipCents, orderData.LocationID)
	if err != nil {
		return failure(fmt.Sprintf("Payment processing failed: %v", err))
	}

	reference := generatePaymentReference(orderID)

	if customerPaymentAuthorizationID != "" {
		saved, err := c.getSavedPaymentMethod(customerPaymentAuthorizationID)
		if err == nil {
			if saved.CustomerID != orderData.CustomerID {
				// fall through to new card
			} else {
				chargeResult, err := c.chargeExistingPaymentMethod(saved.AuthorizationCode, calc.TotalAmountCents, reference, orderData.CustomerEmail)
				if err == nil && chargeResult.Status == "success" {
					txID := ""
					if len(chargeResult.Data.ID) > 0 {
						_ = json.Unmarshal(chargeResult.Data.ID, &txID)
						if txID == "" {
							txID = string(chargeResult.Data.ID)
						}
					}
					return PaymentResult{
						Success:       true,
						PaymentMethod: "existing",
						TransactionID: txID,
						Reference:     chargeResult.Data.Reference,
						AmountCents:   calc.TotalAmountCents,
						Calculation:   calc,
					}
				}
			}
		}
	}

	paymentLink, err := c.generatePaymentLink(calc.TotalAmountCents, reference, orderData.CustomerEmail, orderData.CustomerName)
	if err != nil {
		return failure(fmt.Sprintf("Payment processing failed: %v", err))
	}

	if paymentLink.Status == "success" {
		return PaymentResult{
			Success:          true,
			PaymentMethod:    "new_card",
			PaymentLink:      paymentLink.Data.AccessCode,
			AuthorizationURL: paymentLink.Data.AuthorizationURL,
			Reference:        paymentLink.Data.Reference,
			AmountCents:      calc.TotalAmountCents,
			Calculation:      calc,
		}
	}

	return failure(fmt.Sprintf("Payment processing failed: Payment link generation failed: %s", paymentLink.Message))
}

func (c *Client) VerifyPayStackTransaction(reference string) (map[string]interface{}, error) {
	if c.secretKey == "" {
		return nil, fmt.Errorf("PayStack secret key not found in environment variables")
	}

	req, err := http.NewRequest(http.MethodGet, "https://api.paystack.co/transaction/verify/"+reference, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errData paystackErrorBody
		msg := ""
		if err := json.Unmarshal(respBody, &errData); err == nil {
			msg = errData.Message
		}
		if msg == "" {
			msg = fmt.Sprintf("%d", resp.StatusCode)
		}
		return nil, fmt.Errorf("PayStack verification failed: %s", msg)
	}

	var out map[string]interface{}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *Client) SavePaymentAuthorization(customerID, authorizationCode string, card CardDetails) bool {
	if c.pool == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := c.pool.Exec(ctx, `
INSERT INTO customer_payment_authorizations
  (customer_id, payment_method_code, gateway_provider, authorization_code,
   card_last_four, card_type, card_exp_month, card_exp_year, is_active, last_used_at)
VALUES ($1, 'paystack', 'paystack', $2, $3, $4, $5, $6, true, now())
`, customerID, authorizationCode, card.Last4, card.CardType, card.ExpMonth, card.ExpYear)
	return err == nil
}
