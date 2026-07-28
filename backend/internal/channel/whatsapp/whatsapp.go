// Package whatsapp adapts the existing WhatsApp Business API client onto the
// channel.Channel and channel.Inbound seams.
//
// WhatsApp is the rail every other capability in the channel package was
// designed around, so this adapter is mostly a straight mapping: every
// Message kind has a matching Meta API call. The two places that are not
// straight mapping are the reasons the seam has a degradation contract at
// all — Meta caps an interactive list at 10 rows and reply buttons at 3, and
// a shop's menu section routinely has more than either. An adapter that sent
// the first 10 rows and dropped the rest would look correct in a demo and
// lose menu items in production, so both limits fall back to
// channel.RenderText instead.
package whatsapp

import (
	"context"
	"encoding/json"
	"strconv"
	"sync"

	"github.com/beepbite/backend/internal/channel"
	integrations_whatsapp "github.com/beepbite/backend/internal/integrations/whatsapp"
)

// metaMaxListRows and metaMaxButtons are Meta's own limits on the WhatsApp
// interactive message types, not a BeepBite choice. Exceeding either is a
// degrade, not an error: see the package doc.
const (
	metaMaxListRows = 10
	metaMaxButtons  = 3
)

// defaultListButton is used when a Message asks for a list but leaves
// ListButton empty. Meta rejects an empty button label outright, so sending
// it as given would turn a degradable situation into a hard failure.
const defaultListButton = "Choose"

// Adapter wraps an *integrations_whatsapp.Client to satisfy channel.Channel
// and channel.Inbound.
type Adapter struct {
	c *integrations_whatsapp.Client

	// mu guards replies. The chatbot serves inbound webhooks concurrently and
	// shares one Adapter across them (see channel.Channel's concurrency note).
	mu sync.Mutex
	// replies holds, per recipient, the ids from the most recent list/button
	// message that got degraded to numbered text. Only the latest entry per
	// recipient is kept — a customer only ever answers the question they were
	// just asked — so this cannot grow into a full conversation history no
	// matter how long the process runs.
	replies map[string][]string
}

// New wraps c. c may be nil (a build with the channel compiled in but no
// WhatsApp credentials configured); every method reports channel.ErrNotConfigured
// in that case rather than panicking.
func New(c *integrations_whatsapp.Client) *Adapter {
	return &Adapter{c: c, replies: make(map[string][]string)}
}

func (a *Adapter) Name() string { return "whatsapp" }

func (a *Adapter) Caps() channel.Capability {
	return channel.CapText | channel.CapButtons | channel.CapList | channel.CapImage |
		channel.CapDocument | channel.CapTemplate | channel.CapReadReceipt | channel.CapReaction
}

func (a *Adapter) Send(ctx context.Context, m channel.Message) (channel.SendResult, error) {
	if err := channel.Validate(m); err != nil {
		return channel.SendResult{}, err
	}
	if a == nil || a.c == nil {
		return channel.SendResult{}, channel.ErrNotConfigured
	}

	switch {
	case len(m.Sections) > 0:
		if rowCount(m.Sections) > metaMaxListRows {
			return a.sendDegraded(m)
		}
		return a.result(a.c.SendInteractiveList(m.To, m.Body, listButton(m.ListButton), toInteractiveSections(m.Sections), m.Header, m.Footer))

	case len(m.Buttons) > 0:
		if len(m.Buttons) > metaMaxButtons {
			return a.sendDegraded(m)
		}
		return a.result(a.c.SendInteractiveButtons(m.To, m.Body, toInteractiveButtons(m.Buttons), m.Header, m.Footer))

	case m.Image != "":
		return a.result(a.c.SendImage(m.To, m.Image, m.Body))

	case m.Document != "":
		return a.result(a.c.SendDocument(m.To, m.Document, m.Filename, m.Body))

	case m.Template != "":
		return a.result(a.c.SendTemplate(m.To, m.Template, m.TemplateLang, templateComponents(m.TemplateVars)))

	default:
		return a.result(a.c.SendText(m.To, m.Body, false))
	}
}

// sendDegraded renders m as numbered text and remembers the row/button ids
// under m.To so a later plain-text reply can be resolved back onto one of
// them by Parse.
func (a *Adapter) sendDegraded(m channel.Message) (channel.SendResult, error) {
	body, ids := channel.RenderText(m)
	a.rememberReply(m.To, ids)
	return a.result(a.c.SendText(m.To, body, false))
}

// result turns the underlying client's response into a channel.SendResult.
//
// "The operator has not turned this rail on" is reported as
// channel.ErrNotConfigured, which a caller tells apart from a rejected send:
// one is worth logging once, the other is worth retrying. The check asks the
// client via Configured() rather than matching the text of its error, so
// rewording that error cannot silently turn a dark rail into a hard failure.
func (a *Adapter) result(resp *integrations_whatsapp.SendResponse, err error) (channel.SendResult, error) {
	if err != nil {
		if !a.c.Configured() {
			return channel.SendResult{}, channel.ErrNotConfigured
		}
		return channel.SendResult{}, err
	}
	var id string
	if resp != nil && len(resp.Messages) > 0 {
		id = resp.Messages[0].ID
	}
	return channel.SendResult{ID: id}, nil
}

func (a *Adapter) MarkRead(ctx context.Context, messageID string) error {
	if a == nil || a.c == nil {
		return channel.ErrNotConfigured
	}
	if err := a.c.MarkAsRead(messageID); err != nil {
		if !a.c.Configured() {
			return channel.ErrNotConfigured
		}
		return err
	}
	return nil
}

func (a *Adapter) React(ctx context.Context, to, messageID, emoji string) error {
	if a == nil || a.c == nil {
		return channel.ErrNotConfigured
	}
	_, err := a.c.SendReaction(to, messageID, emoji)
	if err != nil && !a.c.Configured() {
		return channel.ErrNotConfigured
	}
	return err
}

func (a *Adapter) rememberReply(to string, ids []string) {
	if len(ids) == 0 {
		return
	}
	a.mu.Lock()
	a.replies[to] = ids
	a.mu.Unlock()
}

func (a *Adapter) lastReply(from string) ([]string, bool) {
	a.mu.Lock()
	ids, ok := a.replies[from]
	a.mu.Unlock()
	return ids, ok
}

func rowCount(sections []channel.Section) int {
	n := 0
	for _, sec := range sections {
		n += len(sec.Rows)
	}
	return n
}

func listButton(want string) string {
	if want == "" {
		return defaultListButton
	}
	return want
}

func toInteractiveSections(sections []channel.Section) []integrations_whatsapp.InteractiveSection {
	out := make([]integrations_whatsapp.InteractiveSection, 0, len(sections))
	for _, sec := range sections {
		rows := make([]integrations_whatsapp.InteractiveRow, 0, len(sec.Rows))
		for _, r := range sec.Rows {
			rows = append(rows, integrations_whatsapp.InteractiveRow{ID: r.ID, Title: r.Title, Description: r.Description})
		}
		out = append(out, integrations_whatsapp.InteractiveSection{Title: sec.Title, Rows: rows})
	}
	return out
}

func toInteractiveButtons(buttons []channel.Button) []integrations_whatsapp.InteractiveButton {
	out := make([]integrations_whatsapp.InteractiveButton, 0, len(buttons))
	for _, b := range buttons {
		out = append(out, integrations_whatsapp.InteractiveButton{ID: b.ID, Title: b.Title})
	}
	return out
}

// templateComponents turns the flat TemplateVars list into Meta's component
// shape: one body component carrying positional text parameters. BeepBite has
// no need yet for header/button template parameters, so this is deliberately
// the minimal shape rather than a general template-component builder.
func templateComponents(vars []string) []map[string]interface{} {
	if len(vars) == 0 {
		return nil
	}
	params := make([]map[string]interface{}, 0, len(vars))
	for _, v := range vars {
		params = append(params, map[string]interface{}{"type": "text", "text": v})
	}
	return []map[string]interface{}{
		{"type": "body", "parameters": params},
	}
}

// ─── Inbound ─────────────────────────────────────────────────────────────────

// webhookEnvelope, entry, change and waValue mirror the shape decoded in
// handlers/whatsappwebhook/handler.go. That handler is not reused directly —
// it calls straight into chatbot.Service rather than returning normalised
// messages — but the wire shape it already trusts is the one to match.
type webhookEnvelope struct {
	Object string  `json:"object"`
	Entry  []entry `json:"entry"`
}

type entry struct {
	Changes []change `json:"changes"`
}

type change struct {
	Field string  `json:"field"`
	Value waValue `json:"value"`
}

type waValue struct {
	Messages []waMessage `json:"messages"`
}

type waMessage struct {
	From        string         `json:"from"`
	ID          string         `json:"id"`
	Timestamp   string         `json:"timestamp"`
	Type        string         `json:"type"`
	Text        *waText        `json:"text,omitempty"`
	Interactive *waInteractive `json:"interactive,omitempty"`
}

type waText struct {
	Body string `json:"body"`
}

// waInteractive covers the two reply shapes Meta sends for a tap: a list row
// pick and a button pick. Exactly one of ListReply/ButtonReply is set,
// matching which widget the customer answered.
type waInteractive struct {
	Type        string   `json:"type"`
	ListReply   *waReply `json:"list_reply,omitempty"`
	ButtonReply *waReply `json:"button_reply,omitempty"`
}

type waReply struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Parse turns one WhatsApp webhook POST body into normalised inbound
// messages. Status callbacks (delivered/read receipts) carry no "messages"
// array and correctly parse to zero results, not an error — see
// channel.Inbound's doc.
func (a *Adapter) Parse(body []byte) ([]channel.InboundMessage, error) {
	var env webhookEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}

	out := []channel.InboundMessage{}
	for _, e := range env.Entry {
		for _, ch := range e.Changes {
			for _, m := range ch.Value.Messages {
				im := channel.InboundMessage{
					From: m.From,
					ID:   m.ID,
					Raw:  body,
				}
				if ts, err := strconv.ParseInt(m.Timestamp, 10, 64); err == nil {
					im.Timestamp = ts
				}

				switch m.Type {
				case "text":
					if m.Text != nil {
						im.Text = m.Text.Body
					}
					// A typed reply to a degraded list/buttons message looks
					// exactly like any other text message on the wire; only
					// the adapter's memory of what it last asked this sender
					// can tell "3" apart from an ordinary chat message.
					if a != nil {
						if ids, ok := a.lastReply(m.From); ok {
							if id, ok := channel.ResolveReply(im.Text, ids); ok {
								im.Reply = id
							}
						}
					}
				case "interactive":
					if m.Interactive != nil {
						switch {
						case m.Interactive.ListReply != nil:
							im.Reply = m.Interactive.ListReply.ID
						case m.Interactive.ButtonReply != nil:
							im.Reply = m.Interactive.ButtonReply.ID
						}
					}
				}

				out = append(out, im)
			}
		}
	}
	return out, nil
}
