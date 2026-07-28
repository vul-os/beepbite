package channel

import (
	"strings"
	"testing"
)

func TestRenderText_Sections(t *testing.T) {
	m := Message{
		To:     "+15551234567",
		Header: "Menu",
		Body:   "Pick something tasty.",
		Footer: "Reply anytime to change your mind.",
		Sections: []Section{
			{
				Title: "Starters",
				Rows: []Row{
					{ID: "row-1", Title: "Samosa"},
					{ID: "row-2", Title: "Bhajia", Description: "Spicy potato fritters"},
				},
			},
			{
				Title: "Mains",
				Rows: []Row{
					{ID: "row-3", Title: "Biryani"},
				},
			},
		},
	}

	body, ids := RenderText(m)

	// Numbering is continuous across sections, not reset per-section — a
	// customer picks "3" for the third row regardless of which section it's
	// in, so the printed number and the id order must agree.
	wantIDs := []string{"row-1", "row-2", "row-3"}
	if len(ids) != len(wantIDs) {
		t.Fatalf("ids = %v, want %v", ids, wantIDs)
	}
	for i, id := range wantIDs {
		if ids[i] != id {
			t.Errorf("ids[%d] = %q, want %q", i, ids[i], id)
		}
	}

	for _, want := range []string{
		"Menu",
		"Pick something tasty.",
		"Starters",
		"1. Samosa",
		// Description is appended with an em-dash separator, not dropped.
		"2. Bhajia — Spicy potato fritters",
		"Mains",
		"3. Biryani",
		"Reply with a number.",
		"Reply anytime to change your mind.",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q\nbody:\n%s", want, body)
		}
	}

	// Header comes before Body, Footer comes after everything else.
	if strings.Index(body, "Menu") > strings.Index(body, "Pick something tasty.") {
		t.Errorf("header did not precede body:\n%s", body)
	}
	if strings.Index(body, "Reply anytime") < strings.Index(body, "3. Biryani") {
		t.Errorf("footer did not come last:\n%s", body)
	}
}

func TestRenderText_Buttons(t *testing.T) {
	m := Message{
		To:   "+15551234567",
		Body: "Confirm your order?",
		Buttons: []Button{
			{ID: "yes", Title: "Yes"},
			{ID: "no", Title: "No"},
		},
	}

	body, ids := RenderText(m)

	if want := []string{"yes", "no"}; len(ids) != len(want) || ids[0] != want[0] || ids[1] != want[1] {
		t.Fatalf("ids = %v, want %v", ids, want)
	}
	for _, want := range []string{"1. Yes", "2. No", "Reply with a number."} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q\nbody:\n%s", want, body)
		}
	}
}

func TestRenderText_Image(t *testing.T) {
	m := Message{
		To:    "+15551234567",
		Body:  "Here's a look at tonight's special.",
		Image: "https://example.com/special.jpg",
	}
	body, ids := RenderText(m)
	if ids != nil {
		t.Errorf("ids = %v, want nil (image carries no selectable options)", ids)
	}
	// The URL must survive degradation — it's the only way the customer can
	// actually see the image on a text-only rail.
	if !strings.Contains(body, "https://example.com/special.jpg") {
		t.Errorf("body dropped the image URL:\n%s", body)
	}
	if !strings.Contains(body, "Here's a look at tonight's special.") {
		t.Errorf("body dropped the caption:\n%s", body)
	}
}

func TestRenderText_Document(t *testing.T) {
	m := Message{
		To:       "+15551234567",
		Body:     "Your receipt.",
		Document: "https://example.com/receipt.pdf",
		Filename: "receipt.pdf",
	}
	body, ids := RenderText(m)
	if ids != nil {
		t.Errorf("ids = %v, want nil", ids)
	}
	for _, want := range []string{"receipt.pdf", "https://example.com/receipt.pdf"} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q:\n%s", want, body)
		}
	}
}

func TestResolveReply(t *testing.T) {
	ids := []string{"row-1", "row-2", "row-3"}

	tests := []struct {
		name   string
		text   string
		ids    []string
		want   string
		wantOK bool
	}{
		{name: "bare number", text: "3", ids: ids, want: "row-3", wantOK: true},
		{name: "trailing dot", text: "3.", ids: ids, want: "row-3", wantOK: true},
		{name: "surrounding whitespace", text: "  3  ", ids: ids, want: "row-3", wantOK: true},
		{name: "trailing paren", text: "3)", ids: ids, want: "row-3", wantOK: true},
		{name: "out of range high", text: "9", ids: ids, want: "", wantOK: false},
		{name: "out of range zero", text: "0", ids: ids, want: "", wantOK: false},
		{name: "non-numeric", text: "biryani please", ids: ids, want: "", wantOK: false},
		{name: "empty ids", text: "1", ids: nil, want: "", wantOK: false},
		{name: "empty text", text: "", ids: ids, want: "", wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := ResolveReply(tt.text, tt.ids)
			if got != tt.want || ok != tt.wantOK {
				t.Errorf("ResolveReply(%q, %v) = (%q, %v), want (%q, %v)", tt.text, tt.ids, got, ok, tt.want, tt.wantOK)
			}
		})
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		m       Message
		wantErr bool
	}{
		{
			name:    "empty message",
			m:       Message{To: "+15551234567"},
			wantErr: true,
		},
		{
			name: "two payload kinds",
			m: Message{
				To:      "+15551234567",
				Body:    "pick one",
				Buttons: []Button{{ID: "a", Title: "A"}},
				Image:   "https://example.com/a.jpg",
			},
			wantErr: true,
		},
		{
			name:    "no recipient",
			m:       Message{Body: "hi"},
			wantErr: true,
		},
		{
			name:    "plain text is fine",
			m:       Message{To: "+15551234567", Body: "hi"},
			wantErr: false,
		},
		{
			name:    "image alone is fine even with empty caption",
			m:       Message{To: "+15551234567", Image: "https://example.com/a.jpg"},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Validate(tt.m)
			if (err != nil) != tt.wantErr {
				t.Errorf("Validate(%+v) err = %v, wantErr %v", tt.m, err, tt.wantErr)
			}
		})
	}
}
