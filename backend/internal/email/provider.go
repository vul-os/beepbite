// Package email defines the provider-agnostic email abstraction used across
// BeepBite (Wave 19).
//
// Each concrete email provider (SMTP, SendGrid, Mailgun, SES) ships a
// thin adapter that implements the Provider interface.  The Registry in
// registry.go resolves the right provider + credentials per location,
// preferring per-store BYO keys (location_email_credentials) over the
// platform default (env-var-backed Resend).
//
// Table layout (migration 024):
//
//	email_providers(code PK, name, is_active)
//	location_email_credentials(id, location_id, provider_code,
//	                            encrypted_keys, sender_domain,
//	                            sender_email, is_active)
//
// UUID values are plain strings (codebase convention — pgx scans them directly
// from text/uuid columns without a uuid library).
package email

import (
	"context"
	"errors"
)

// ErrProviderNotConfigured is returned by Registry.For when neither a
// per-location BYO credential nor a platform default is available.
var ErrProviderNotConfigured = errors.New("email: no provider configured for location")

// defaultFromAddress is used when EMAIL_FROM_DEFAULT is unset. Self-hosters are
// expected to override it; there is no vendor default to fall back on.
const defaultFromAddress = "no-reply@localhost"

// ErrSendFailed wraps a provider-level send error to distinguish transient
// delivery failures from configuration failures.
var ErrSendFailed = errors.New("email: send failed")

// ─── Message ─────────────────────────────────────────────────────────────────

// Message is the provider-agnostic email envelope.  Callers construct a Message
// and pass it to Provider.Send; adapters translate it into the wire format
// required by their upstream API.
type Message struct {
	// From is the RFC 5321 sender address, e.g. "BeepBite <noreply@beepbite.io>".
	// When empty, the adapter falls back to the configured sender_email /
	// sender_domain for the credential row, or the platform EMAIL_FROM_DEFAULT.
	From string

	// To is the primary recipient address (plain address or "Name <addr>" form).
	To string

	// Subject is the email subject line (plain text).
	Subject string

	// HTML is the HTML body.  If empty, providers that require HTML will fall
	// back to Text (wrapped in a minimal <pre> block).
	HTML string

	// Text is the plain-text body.  At least one of HTML or Text must be set.
	Text string

	// ReplyTo, if non-empty, sets the Reply-To header.
	ReplyTo string
}

// ─── Provider interface ───────────────────────────────────────────────────────

// Provider is the single interface every email adapter must satisfy.
// Implementations must be safe for concurrent use by multiple goroutines.
type Provider interface {
	// Code returns the stable, lowercase provider identifier that matches the
	// email_providers.code column in the database.
	// Examples: "smtp", "sendgrid", "mailgun", "ses".
	Code() string

	// Send delivers msg via the provider.  It returns a non-nil error (wrapping
	// ErrSendFailed) on delivery failure so callers can distinguish provider
	// errors from configuration errors.
	Send(ctx context.Context, msg Message) error
}
