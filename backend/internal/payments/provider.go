// Package payments defines the payment seam used by BeepBite.
//
// BeepBite records tenders; it does not process cards. The shop already has a
// card machine on the counter, an EFT reference in its bank statement, or a
// cash drawer. There is no facilitator, no rake, no PCI scope and no
// money-transmitter exposure.
//
// The seam exists so a self-hoster can bolt on a real gateway later without
// touching the POS. It has exactly one implementation: ManualTender.
//
// UUID values are represented as plain strings (codebase convention; pgx scans
// them directly from text/uuid columns without a uuid library).
package payments

import (
	"context"
	"errors"
	"strings"
	"time"
)

// ErrUnknownTender is returned when a charge names a tender type the provider
// does not accept.
var ErrUnknownTender = errors.New("payments: unknown tender type")

// ErrNotFound is returned by GetStatus when the reference is unknown to the
// provider.
var ErrNotFound = errors.New("payments: charge not found")

// ─── Tender types ─────────────────────────────────────────────────────────────

// Tender identifies how the money actually moved. These values are exactly the
// payment_methods.code column seeded by migration 014 — order_payments has a FK
// to it, so anything not in this list is rejected by the database too.
//
// TenderCard means the shop ran the customer on its OWN card machine. No card
// data ever reaches BeepBite.
const (
	TenderCash         = "cash"
	TenderCard         = "card_in_person"
	TenderTransfer     = "eft"
	TenderGiftCard     = "gift_card"
	TenderHouseAccount = "house_account"
	TenderStoreCredit  = "store_credit"

	// On-delivery variants: the driver collected at the door, either in notes
	// or on a portable card machine. Kept distinct from the counter tenders so
	// drawer reconciliation does not expect the money to be in the till.
	TenderCashOnDelivery = "cash_on_delivery"
	TenderCardOnDelivery = "card_on_delivery"
)

// ValidTender reports whether code is a tender this build can record.
func ValidTender(code string) bool {
	switch strings.ToLower(strings.TrimSpace(code)) {
	case TenderCash, TenderCard, TenderTransfer,
		TenderGiftCard, TenderHouseAccount, TenderStoreCredit,
		TenderCashOnDelivery, TenderCardOnDelivery:
		return true
	}
	return false
}

// ─── Core value types ─────────────────────────────────────────────────────────

// Amount pairs an integer cent value with an ISO-4217 currency code.
// Keeping them together prevents silently mixing ZAR cents with USD cents.
type Amount struct {
	Cents        int64
	CurrencyCode string // ISO 4217, e.g. "ZAR", "USD"
}

// Status is the lifecycle state of a charge or refund.
type Status string

const (
	// StatusSettled means the money has changed hands. Manual tender is always
	// settled the instant it is recorded — the note is in the drawer, the card
	// machine printed its slip.
	StatusSettled Status = "settled"

	// StatusPending is never produced by ManualTender. It exists so a future
	// asynchronous adapter (poll-first, never webhooks) has a state to report.
	StatusPending Status = "pending"

	// StatusFailed means the tender was declined or reversed.
	StatusFailed Status = "failed"
)

// ChargeRequest describes a tender being recorded against an order.
type ChargeRequest struct {
	// OrderID is the BeepBite order UUID.
	OrderID string

	// Tender is one of the TenderXxx constants.
	Tender string

	Amount Amount

	// Reference is the operator-supplied external identifier: card-machine
	// batch/slip number, EFT reference, voucher serial. Free text, may be empty
	// for cash.
	Reference string

	// IdempotencyKey is the caller's Idempotency-Key header value. Replays of
	// the same key must not produce a second tender. Enforcement lives in the
	// shared idempotency middleware (internal/idempotency); providers receive
	// the key so an external gateway can de-duplicate on its own side too.
	IdempotencyKey string

	// ReturnURL is where the customer's OWN browser should land after paying
	// on a hosted/redirect gateway (Stripe Checkout, Yoco, Payfast, ...).
	// ManualTender ignores it entirely (there is nothing to redirect from —
	// the money already moved at the counter).
	//
	// This is beepbite's side of the "verify-on-return" settlement model:
	// beepbite has no inbound webhook (see PaymentProvider's doc comment
	// below), so instead of a poll loop it builds this URL itself (a
	// signed, time-limited token binding it to one order — see
	// SignReturnToken/VerifyReturnToken) and hands it to the gateway at
	// Charge time. The processor's hosted page redirects the BUYER's
	// browser back to it when they finish paying; that redirect is the one
	// and only settlement signal beepbite acts on (see SettleOnlinePayment).
	// The provider itself never calls beepbite — only the customer's
	// browser does, and it already had to reach beepbite once already to
	// place the order.
	//
	// Whether a given rail actually honours this is provider-specific and,
	// for the generic patala adapter (patala_gateway.go), UNVERIFIED beyond
	// what each patala-fiat rail's own source documents — see that file's
	// Charge doc comment for the concrete gap (some rails reinterpret their
	// one opaque "destination" field as a callback URL, at least one
	// reinterprets it as the buyer's email instead, and there is no
	// per-field slot in patala_core::PayRequest for "return URL" at all
	// today). Leave empty for a rail/flow that has no meaningful return
	// leg (e.g. a static QR/invoice-style rail with no redirect at all).
	ReturnURL string
}

// RefundRequest describes money going back to the customer.
type RefundRequest struct {
	// ChargeID is the identifier previously returned in Receipt.ID.
	ChargeID string

	Amount Amount

	Reason string

	IdempotencyKey string
}

// Receipt is the normalised outcome of a Charge, Refund or GetStatus call.
type Receipt struct {
	// ID identifies the movement inside the provider. For ManualTender this is
	// the order_payments (or refunds) row UUID assigned by the caller.
	ID string

	// Tender echoes the tender type the money moved as.
	Tender string

	Amount Amount

	Status Status

	// Reference echoes the operator-supplied external identifier.
	Reference string

	OccurredAt time.Time
}

// ─── Provider seam ────────────────────────────────────────────────────────────

// PaymentProvider is the single interface any payment backend must satisfy.
//
// Implementations must be safe for concurrent use by multiple goroutines.
//
// Deliberately absent: any webhook entry point. A POS charge is synchronous at
// the counter, and GetStatus (outbound-only, an ordinary API call FROM
// beepbite) works behind CGNAT with no port forwarding, static IP, DNS or any
// box operated by anyone else.
//
// GetStatus is not driven by a polling loop, though. The marketplace checkout
// path (internal/handlers/marketplace) triggers it exactly once, on demand:
// the customer's own browser, redirected back from the gateway's hosted pay
// page to a beepbite return URL (ChargeRequest.ReturnURL), IS the settlement
// event. See internal/handlers/marketplace/payreturn.go and
// payments.SettleOnlinePayment. A single staff-triggered "recheck payment"
// action (internal/handlers/pos) is the only other caller, as a backstop for
// the rare case the buyer closes the tab before the redirect completes. There
// is no background poll loop anywhere in this seam.
type PaymentProvider interface {
	// Code returns the stable, lowercase provider identifier.
	Code() string

	// Charge records money taken from the customer. It returns a Receipt whose
	// Status reflects the state at the moment of the call.
	Charge(ctx context.Context, req ChargeRequest) (Receipt, error)

	// Refund returns money to the customer for a previously recorded charge.
	Refund(ctx context.Context, req RefundRequest) (Receipt, error)

	// GetStatus re-reads the current state of a charge by its Receipt.ID.
	GetStatus(ctx context.Context, chargeID string) (Receipt, error)
}
