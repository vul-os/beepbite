package channel

import (
	"fmt"
	"strconv"
	"strings"
)

// This file is the canonical text degradation. Every adapter that cannot render
// a list, buttons or an attachment natively MUST use these helpers rather than
// inventing its own formatting.
//
// The reason is not tidiness. The list-to-text degradation carries a contract
// with the inbound side: rows are printed numbered from 1, so an adapter that
// printed them can map a customer's "3" back to the third row's ID and set
// InboundMessage.Reply. If two adapters number differently — or one starts at
// zero, or one prints a bullet — that mapping silently breaks and the customer
// selects the wrong item. Shared code is how the two halves stay in agreement.

// RenderText produces the plain-text form of a Message for a rail that has only
// CapText. The returned string is complete: header, body, the degraded
// richness, and footer.
//
// It returns the ordered reply IDs alongside, positionally matching the numbers
// printed: ids[0] was printed as "1". An adapter keeps these to resolve a typed
// reply. When the message carries no selectable richness the slice is nil.
func RenderText(m Message) (body string, ids []string) {
	var b strings.Builder

	if m.Header != "" {
		b.WriteString(m.Header)
		b.WriteString("\n\n")
	}
	if m.Body != "" {
		b.WriteString(m.Body)
	}

	switch {
	case len(m.Sections) > 0:
		n := 0
		for _, sec := range m.Sections {
			if sec.Title != "" {
				b.WriteString("\n\n")
				b.WriteString(sec.Title)
			}
			for _, row := range sec.Rows {
				n++
				ids = append(ids, row.ID)
				b.WriteString("\n")
				b.WriteString(strconv.Itoa(n))
				b.WriteString(". ")
				b.WriteString(row.Title)
				if row.Description != "" {
					b.WriteString(" — ")
					b.WriteString(row.Description)
				}
			}
		}
		b.WriteString("\n\nReply with a number.")

	case len(m.Buttons) > 0:
		for i, btn := range m.Buttons {
			ids = append(ids, btn.ID)
			b.WriteString("\n")
			b.WriteString(strconv.Itoa(i + 1))
			b.WriteString(". ")
			b.WriteString(btn.Title)
		}
		b.WriteString("\n\nReply with a number.")

	case m.Image != "":
		// The caption is already in Body. The URL is appended because dropping
		// it would lose the only way the customer can see the image at all.
		b.WriteString("\n")
		b.WriteString(m.Image)

	case m.Document != "":
		b.WriteString("\n")
		if m.Filename != "" {
			b.WriteString(m.Filename)
			b.WriteString(": ")
		}
		b.WriteString(m.Document)
	}

	if m.Footer != "" {
		b.WriteString("\n\n")
		b.WriteString(m.Footer)
	}
	return b.String(), ids
}

// ResolveReply maps a customer's typed answer back onto a reply ID, given the
// ids RenderText returned for the message they are answering.
//
// It accepts a bare number ("3"), a number with punctuation ("3.", "3)") and
// surrounding whitespace, because customers type all of those. Anything else —
// including a number out of range — returns "" and false, and the caller treats
// the message as free text, which is what it is.
func ResolveReply(text string, ids []string) (string, bool) {
	if len(ids) == 0 {
		return "", false
	}
	s := strings.TrimSpace(text)
	s = strings.TrimRight(s, ".):-")
	s = strings.TrimSpace(s)
	if s == "" {
		return "", false
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 || n > len(ids) {
		return "", false
	}
	return ids[n-1], true
}

// Validate reports whether a Message is coherent before an adapter tries to
// send it. Adapters should call it first so a programming error surfaces here
// rather than as a provider 400 three layers down.
func Validate(m Message) error {
	if strings.TrimSpace(m.To) == "" {
		return fmt.Errorf("channel: message has no recipient")
	}
	kinds := 0
	if len(m.Sections) > 0 {
		kinds++
	}
	if len(m.Buttons) > 0 {
		kinds++
	}
	if m.Image != "" {
		kinds++
	}
	if m.Document != "" {
		kinds++
	}
	if m.Template != "" {
		kinds++
	}
	if kinds > 1 {
		return fmt.Errorf("channel: message carries %d payload kinds, want at most 1", kinds)
	}
	if kinds == 0 && strings.TrimSpace(m.Body) == "" {
		return fmt.Errorf("channel: message has neither body nor payload")
	}
	if m.Image != "" && m.Document != "" {
		return fmt.Errorf("channel: message carries both an image and a document")
	}
	return nil
}
