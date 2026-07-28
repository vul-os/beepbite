// Package channel defines the ordering-channel seam.
//
// # Why this exists
//
// BeepBite's stated intent is that a shop turns on whichever channels its
// customers already use, and that every one of them lands in the same order
// stream. Until this package existed that was an intent and not an
// architecture: the chatbot held a *whatsapp.Client directly, so "add Discord"
// meant writing a second integration beside the first rather than an adapter
// behind a shared interface. docs/features.md said so in as many words.
//
// The seam is deliberately the same shape as the ones already in this tree —
// payments.PaymentProvider, email.Provider, llm.Provider: one interface, a
// default implementation, and no registry, plugin loader or vendor list.
//
// # The hard part is capability, not plumbing
//
// WhatsApp can render an interactive list and a template. Discord has buttons
// and embeds but no WhatsApp template. Email and SMS have neither. An interface
// that assumes every rail can do what WhatsApp does is not an abstraction — it
// is WhatsApp with extra steps, and the second implementation is where you find
// that out.
//
// So a Channel declares what it can render, and every rich send has a defined
// text degradation. A caller never asks "is this WhatsApp?" — it sends the rich
// form and the adapter renders it as well as its rail allows. A list becomes a
// numbered list on a rail that has no list widget; the reply IDs the caller
// depends on still come back, because the adapter maps the customer's "3" onto
// the row ID it printed as 3.
//
// That rule — the caller never branches on the rail, the adapter never drops
// information silently — is the whole contract. Everything else is types.
package channel

import "context"

// Capability is a bitmask of what a rail can render natively. A caller may read
// it to make a *cosmetic* choice (a shorter prompt when buttons exist, say). A
// caller must never read it to decide whether it may call a method: every
// method on Channel is safe to call on every implementation, because the
// adapter is responsible for degrading.
type Capability uint32

const (
	// CapText is the floor. Every rail has it; a rail that does not is not a
	// channel.
	CapText Capability = 1 << iota
	// CapButtons — tappable quick replies that return a stable ID.
	CapButtons
	// CapList — a selectable list of rows, each with a stable ID and an
	// optional description.
	CapList
	// CapImage — an image with an optional caption.
	CapImage
	// CapDocument — a file attachment with a filename.
	CapDocument
	// CapTemplate — a pre-registered, provider-approved message that may be
	// sent outside a customer-initiated service window. WhatsApp has these
	// because Meta requires them; most rails do not have the concept at all.
	CapTemplate
	// CapReadReceipt — the rail can be told a message was read.
	CapReadReceipt
	// CapReaction — the rail can attach an emoji reaction to a message.
	CapReaction
)

// Has reports whether every capability in want is present.
func (c Capability) Has(want Capability) bool { return c&want == want }

// ─── Outbound ────────────────────────────────────────────────────────────────

// Row is one selectable option. ID is what comes back in an InboundMessage's
// Reply field when the customer picks it, and it must survive degradation: on a
// rail with no list widget the adapter prints the rows numbered and maps the
// customer's reply back onto this ID.
type Row struct {
	ID          string
	Title       string
	Description string // optional; rails without a description slot append it
}

// Section groups rows. Rails with no grouping concept render Title as a plain
// line above its rows.
type Section struct {
	Title string
	Rows  []Row
}

// Button is a quick reply. Same ID contract as Row.
type Button struct {
	ID    string
	Title string
}

// Message is one outbound message in rail-independent form.
//
// Exactly one of Text, Sections, Buttons, Image, Document or Template carries
// the payload; Body is the accompanying prose and is required for every kind
// except Image and Document, where it is the caption.
type Message struct {
	// To is the rail-specific recipient handle: an E.164 number for WhatsApp,
	// a channel or user snowflake for Discord, an address for email. Adapters
	// own the interpretation; nothing above this package parses it.
	To string

	// Body is the prose. On a rail that cannot render whatever richness is
	// attached below, Body plus the degraded rendering is what gets sent.
	Body string

	// Header and Footer are optional decorations. Rails without them fold the
	// text into Body rather than dropping it.
	Header string
	Footer string

	// Sections, when non-empty, asks for a selectable list. ListButton is the
	// label of the control that opens it on rails that have one.
	Sections   []Section
	ListButton string

	// Buttons, when non-empty, asks for quick replies.
	Buttons []Button

	// Image and Document are URLs. Filename applies to Document.
	Image    string
	Document string
	Filename string

	// Template names a pre-registered template and its variables. Rails
	// without templates MUST NOT silently send nothing: an adapter that
	// cannot render a template returns ErrUnsupported so the caller can fall
	// back to an ordinary Message rather than believing it notified somebody.
	// This is the one case where degradation is refused, because a template
	// is used precisely when the rail will not accept a free-form message.
	Template     string
	TemplateLang string
	TemplateVars []string
}

// SendResult identifies the message the rail accepted, so a later reaction or
// read-receipt can name it. ID is opaque and rail-specific.
type SendResult struct {
	ID string
}

// ─── Inbound ─────────────────────────────────────────────────────────────────

// InboundMessage is a customer message normalised out of a rail's own webhook
// or socket payload. The chatbot consumes only this.
type InboundMessage struct {
	// From is the rail-specific sender handle, in the same form Message.To
	// takes, so a reply is addressed by echoing it back.
	From string

	// ID is the rail's message ID, for read receipts and reactions.
	ID string

	// Text is the plain body, empty when the customer tapped rather than typed.
	Text string

	// Reply is the ID of the Row or Button the customer selected, empty when
	// they typed. An adapter that degraded a list to numbered text is
	// responsible for mapping "3" back to the third row's ID and setting this
	// — from the caller's side a tap and a typed number are the same event.
	Reply string

	// Timestamp is the rail's own send time when it supplies one.
	Timestamp int64

	// Raw is the undecoded payload, kept so an adapter-specific handler can
	// reach past the normalised form without widening this struct. Nothing in
	// the chatbot may read it.
	Raw []byte
}

// ─── The seam ────────────────────────────────────────────────────────────────

// Channel is one ordering rail.
//
// Implementations must be safe for concurrent use: the chatbot handles inbound
// webhooks concurrently and shares one Channel across them.
type Channel interface {
	// Name identifies the rail for logs, audit rows and the order's channel
	// column: "whatsapp", "discord", "web". Stable; it is persisted.
	Name() string

	// Caps reports what this rail renders natively. See Capability — this is
	// for cosmetic choices, never for deciding whether a call is legal.
	Caps() Capability

	// Send delivers a message, degrading it to what the rail supports. It
	// returns ErrUnsupported only for a Template on a rail without templates.
	Send(ctx context.Context, m Message) (SendResult, error)

	// MarkRead acknowledges an inbound message. Rails without read receipts
	// return nil — an unacknowledged read is not an error worth propagating
	// into an ordering flow.
	MarkRead(ctx context.Context, messageID string) error

	// React attaches an emoji to a message. Rails without reactions return
	// nil, for the same reason as MarkRead.
	React(ctx context.Context, to, messageID, emoji string) error
}

// Inbound is implemented by adapters that receive over a webhook. It is
// separate from Channel because a rail can be send-only (SMS notifications, an
// email receipt) and because a socket-mode rail delivers inbound without an
// HTTP handler at all.
type Inbound interface {
	// Parse turns one raw webhook body into zero or more normalised messages.
	// Zero is normal and not an error: rails deliver status callbacks and
	// delivery receipts down the same pipe as customer messages.
	Parse(body []byte) ([]InboundMessage, error)
}
