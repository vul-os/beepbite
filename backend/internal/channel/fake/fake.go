// Package fake is a test double for the channel.Channel seam.
//
// Its point is not to stand in for a real rail in production — it is to let a
// test assert what the seam is actually for: that a caller gets the same
// SendResult contract regardless of rail, and that a Channel with fewer caps
// than WhatsApp degrades rather than silently drops richness. Real adapters
// (whatsapp.Adapter and whoever comes next) are exercised against their own
// wire format; this one is exercised against channel.RenderText, which is the
// shared part.
package fake

import (
	"context"
	"sync"

	"github.com/beepbite/backend/internal/channel"
)

// Channel records what it was sent instead of delivering it anywhere.
type Channel struct {
	caps channel.Capability

	// Err, when set, is returned by every method instead of doing anything.
	// It exists so a caller-side test can assert its handling of a failed
	// rail without needing a real one to fail.
	Err error

	mu   sync.Mutex
	sent []channel.Message
}

// New returns a Channel that claims caps. A zero caps defaults to CapText —
// every rail has at least that much, per Capability's own doc, so a fake with
// none would not be modelling a channel at all.
func New(caps channel.Capability) *Channel {
	if caps == 0 {
		caps = channel.CapText
	}
	return &Channel{caps: caps}
}

func (c *Channel) Name() string { return "fake" }

func (c *Channel) Caps() channel.Capability { return c.caps }

// SetErr sets the error every subsequent method call returns, until cleared
// with SetErr(nil).
func (c *Channel) SetErr(err error) { c.Err = err }

// Send degrades m to what Caps() claims, exactly as a real adapter must, so a
// test can assert on the degraded form it recorded rather than trusting that
// the fake got it right by construction.
func (c *Channel) Send(ctx context.Context, m channel.Message) (channel.SendResult, error) {
	if c.Err != nil {
		return channel.SendResult{}, c.Err
	}
	if err := channel.Validate(m); err != nil {
		return channel.SendResult{}, err
	}

	switch {
	case m.Template != "" && !c.caps.Has(channel.CapTemplate):
		return channel.SendResult{}, channel.ErrUnsupported
	case len(m.Sections) > 0 && !c.caps.Has(channel.CapList):
		m = degrade(m)
	case len(m.Buttons) > 0 && !c.caps.Has(channel.CapButtons):
		m = degrade(m)
	case m.Image != "" && !c.caps.Has(channel.CapImage):
		m = degrade(m)
	case m.Document != "" && !c.caps.Has(channel.CapDocument):
		m = degrade(m)
	}

	c.mu.Lock()
	c.sent = append(c.sent, m)
	c.mu.Unlock()
	return channel.SendResult{}, nil
}

// degrade replaces m's richness with its channel.RenderText rendering, so
// what Sent() shows a test is a plain-text Message — the same shape a rail
// with only CapText would have ended up sending for real.
func degrade(m channel.Message) channel.Message {
	body, _ := channel.RenderText(m)
	return channel.Message{To: m.To, Body: body}
}

func (c *Channel) MarkRead(ctx context.Context, messageID string) error { return c.Err }

func (c *Channel) React(ctx context.Context, to, messageID, emoji string) error { return c.Err }

// Sent returns every Message accepted by Send so far, in order.
func (c *Channel) Sent() []channel.Message {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]channel.Message, len(c.sent))
	copy(out, c.sent)
	return out
}
