// Package payments defines the provider-agnostic payment abstraction used
// across BeepBite (Wave 8).
//
// Each concrete payment gateway (Paystack, Stripe, PayFast …) ships a thin
// adapter that implements the Provider interface.  The Registry in registry.go
// resolves the right provider + credentials per location, preferring per-store
// BYO keys (location_payment_credentials) over platform-region env-var creds.
//
// UUID values are represented as plain strings (codebase convention; pgx scans
// them directly from text/uuid columns without a uuid library).
package payments

import (
	"context"
	"errors"
	"time"
)

// ErrProviderNotConfigured is returned by Registry.For when neither a
// per-location BYO credential nor a platform-region fallback is available for
// the requested location.
var ErrProviderNotConfigured = errors.New("payments: no provider configured for location")

// ErrWebhookSignatureInvalid is returned by Provider.VerifyWebhook when the
// HMAC / signature check fails.  Webhook handlers should return HTTP 401 on
// this error without logging provider internals.
var ErrWebhookSignatureInvalid = errors.New("payments: webhook signature invalid")

// ─── Event kind constants ─────────────────────────────────────────────────────

const (
	EventCheckoutCompleted = "checkout.completed"
	EventCheckoutFailed    = "checkout.failed"
	EventRefundSucceeded   = "refund.succeeded"
	EventRefundFailed      = "refund.failed"
	EventTransferSucceeded = "transfer.succeeded"
	EventTransferFailed    = "transfer.failed"
)

// ─── Core value types ─────────────────────────────────────────────────────────

// Amount pairs an integer cent value with an ISO-4217 currency code.
// Keeping them together prevents silently mixing ZAR cents with USD cents.
type Amount struct {
	Cents        int64
	CurrencyCode string // ISO 4217, e.g. "ZAR", "USD"
}

// CheckoutParams carries everything a provider needs to initialise a hosted
// checkout session.
type CheckoutParams struct {
	// OrderID is the BeepBite order UUID (string).  Stored in provider metadata
	// so the webhook handler can resolve it on async callback.
	OrderID string

	AmountCents   int64
	CurrencyCode  string // ISO 4217
	CustomerEmail string
	CustomerName  string

	// MetadataJSON is an arbitrary JSON blob forwarded to the provider.
	// Adapters should merge their own required fields (order_id, location_id)
	// into this before transmitting.
	MetadataJSON []byte

	// CallbackURL is the success redirect after the hosted checkout completes.
	CallbackURL string

	// WebhookURL is where the provider should push async event notifications.
	WebhookURL string
}

// Event is the normalised representation of a payment event received from any
// provider via webhook or polling.
type Event struct {
	// Kind is one of the EventXxx string constants defined above.
	Kind string

	// ProviderTxnID is the provider's own identifier for the transaction
	// (e.g. Paystack reference, Stripe PaymentIntent ID).
	ProviderTxnID string

	// OrderID is the BeepBite order UUID resolved from the provider metadata.
	// Empty string when the event is not associated with an order (e.g. wallet
	// top-up initiated outside an order context).
	OrderID string

	AmountCents  int64
	CurrencyCode string // ISO 4217

	// RawPayload is the unmodified request body bytes received from the
	// provider.  Stored verbatim in webhook_event_log for audit purposes.
	RawPayload []byte

	// Signature is the raw value of the provider's signature header, preserved
	// for downstream re-verification or logging.
	Signature string

	OccurredAt time.Time
}

// Credentials is the decrypted credential bundle resolved for a specific
// location.  Returned alongside the Provider by Registry.For so callers can
// inspect metadata (currency, test mode, …) without an extra DB round-trip.
type Credentials struct {
	// ProviderCode matches Provider.Code(), e.g. "paystack".
	ProviderCode string

	// LocationID is the location these credentials belong to.
	// Empty when these are platform-region env-var creds (not BYO).
	LocationID string

	// RegionCode is the ISO-3166 alpha-2 region code, e.g. "ZA".
	RegionCode string

	PublicKey     string
	SecretKey     string
	WebhookSecret string
	Currency      string // ISO 4217 preferred currency for this location
	IsTestMode    bool

	// IsBYO is true when the credentials came from location_payment_credentials
	// (merchant's own keys) and false when they are platform-region fallback.
	IsBYO bool
}

// ─── Provider interface ───────────────────────────────────────────────────────

// Provider is the single interface every payment gateway adapter must satisfy.
// Adapters translate BeepBite types into provider-SDK calls and map responses
// back.  All gateway-specific details (retry policy, idempotency nonces, …)
// are encapsulated inside each adapter.
//
// Implementations must be safe for concurrent use by multiple goroutines.
type Provider interface {
	// Code returns the stable, lowercase provider identifier that matches the
	// payment_providers.code column in the database.
	// Examples: "paystack", "stripe", "payfast".
	Code() string

	// InitCheckout creates a hosted payment page.  Returns the URL to redirect
	// the customer to and the provider's own transaction identifier.
	InitCheckout(ctx context.Context, params CheckoutParams) (hostedURL string, providerTxnID string, err error)

	// VerifyWebhook authenticates an inbound provider webhook.
	// rawBody is the unmodified request body; signature is the value of the
	// provider's custom signature header.  webhookSecret is supplied by the
	// caller (already decrypted by the Registry).
	// Returns ErrWebhookSignatureInvalid when the HMAC check fails.
	VerifyWebhook(ctx context.Context, signature string, rawBody []byte, webhookSecret []byte) (Event, error)

	// Refund issues a refund for a completed transaction.
	// Returns the provider-specific refund reference for audit storage.
	Refund(ctx context.Context, providerTxnID string, amount Amount) (refundID string, err error)

	// ChargeSaved charges a previously saved payment method (token / mandate).
	// idempotencyKey must be unique per charge attempt so the provider can
	// safely de-duplicate retries.
	ChargeSaved(ctx context.Context, paymentMethodToken string, amount Amount, idempotencyKey string) (providerTxnID string, err error)
}
