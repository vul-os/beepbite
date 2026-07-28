package whatsapp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/beepbite/backend/internal/channel"
	integrations_whatsapp "github.com/beepbite/backend/internal/integrations/whatsapp"
)

// capturedRequest holds the last request body a test server received, so a
// test can decode it and assert on the JSON Meta would actually get.
type capturedRequest struct {
	mu   sync.Mutex
	body []byte
}

func (c *capturedRequest) set(b []byte) {
	c.mu.Lock()
	c.body = b
	c.mu.Unlock()
}

func (c *capturedRequest) decode(t *testing.T) map[string]interface{} {
	t.Helper()
	c.mu.Lock()
	b := c.body
	c.mu.Unlock()
	if b == nil {
		t.Fatal("no request was captured")
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("captured body is not JSON: %v\nbody: %s", err, b)
	}
	return out
}

// newTestAdapter spins up a stub Graph API server that always accepts the
// send and reports message id "wamid.TEST", and returns an Adapter wired to
// it via the client's SetBaseURL/SetHTTPClient test seams.
func newTestAdapter(t *testing.T) (*Adapter, *capturedRequest) {
	t.Helper()
	captured := &capturedRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		captured.set(b)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"messaging_product":"whatsapp","messages":[{"id":"wamid.TEST"}]}`))
	}))
	t.Cleanup(srv.Close)

	c := integrations_whatsapp.NewClient("test-token", "123456")
	c.SetBaseURL(srv.URL)
	c.SetHTTPClient(srv.Client())
	return New(c), captured
}

func TestSend_Text(t *testing.T) {
	a, captured := newTestAdapter(t)
	res, err := a.Send(context.Background(), channel.Message{To: "+15551234567", Body: "hello"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.ID != "wamid.TEST" {
		t.Errorf("SendResult.ID = %q, want wamid.TEST", res.ID)
	}
	got := captured.decode(t)
	if got["type"] != "text" {
		t.Errorf("type = %v, want text", got["type"])
	}
	text, _ := got["text"].(map[string]interface{})
	if text["body"] != "hello" {
		t.Errorf("text.body = %v, want hello", text["body"])
	}
}

func TestSend_Buttons(t *testing.T) {
	a, captured := newTestAdapter(t)
	m := channel.Message{
		To:   "+15551234567",
		Body: "Confirm?",
		Buttons: []channel.Button{
			{ID: "yes", Title: "Yes"},
			{ID: "no", Title: "No"},
		},
	}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}
	got := captured.decode(t)
	if got["type"] != "interactive" {
		t.Fatalf("type = %v, want interactive", got["type"])
	}
	interactive := got["interactive"].(map[string]interface{})
	if interactive["type"] != "button" {
		t.Errorf("interactive.type = %v, want button", interactive["type"])
	}
	action := interactive["action"].(map[string]interface{})
	buttons := action["buttons"].([]interface{})
	if len(buttons) != 2 {
		t.Fatalf("got %d buttons, want 2", len(buttons))
	}
	first := buttons[0].(map[string]interface{})["reply"].(map[string]interface{})
	if first["id"] != "yes" || first["title"] != "Yes" {
		t.Errorf("first button = %v", first)
	}
}

func TestSend_Sections(t *testing.T) {
	a, captured := newTestAdapter(t)
	m := channel.Message{
		To:         "+15551234567",
		Body:       "Pick a dish",
		ListButton: "Menu",
		Sections: []channel.Section{
			{Title: "Mains", Rows: []channel.Row{
				{ID: "row-1", Title: "Biryani", Description: "Spiced rice"},
			}},
		},
	}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}
	got := captured.decode(t)
	interactive := got["interactive"].(map[string]interface{})
	if interactive["type"] != "list" {
		t.Fatalf("interactive.type = %v, want list", interactive["type"])
	}
	action := interactive["action"].(map[string]interface{})
	if action["button"] != "Menu" {
		t.Errorf("action.button = %v, want Menu", action["button"])
	}
	sections := action["sections"].([]interface{})
	rows := sections[0].(map[string]interface{})["rows"].([]interface{})
	row := rows[0].(map[string]interface{})
	if row["id"] != "row-1" || row["title"] != "Biryani" || row["description"] != "Spiced rice" {
		t.Errorf("row = %v", row)
	}
}

func TestSend_SectionsEmptyListButtonDefaults(t *testing.T) {
	// Meta rejects an empty button label outright; the adapter must not pass
	// one through even though the seam allows ListButton to be empty.
	a, captured := newTestAdapter(t)
	m := channel.Message{
		To:   "+15551234567",
		Body: "Pick one",
		Sections: []channel.Section{
			{Rows: []channel.Row{{ID: "row-1", Title: "Biryani"}}},
		},
	}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}
	got := captured.decode(t)
	action := got["interactive"].(map[string]interface{})["action"].(map[string]interface{})
	if action["button"] != defaultListButton {
		t.Errorf("action.button = %v, want %q", action["button"], defaultListButton)
	}
}

func TestSend_Image(t *testing.T) {
	a, captured := newTestAdapter(t)
	m := channel.Message{To: "+15551234567", Body: "caption", Image: "https://example.com/a.jpg"}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}
	got := captured.decode(t)
	if got["type"] != "image" {
		t.Fatalf("type = %v, want image", got["type"])
	}
	image := got["image"].(map[string]interface{})
	if image["link"] != "https://example.com/a.jpg" || image["caption"] != "caption" {
		t.Errorf("image = %v", image)
	}
}

func TestSend_Document(t *testing.T) {
	a, captured := newTestAdapter(t)
	m := channel.Message{To: "+15551234567", Body: "receipt", Document: "https://example.com/r.pdf", Filename: "r.pdf"}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}
	got := captured.decode(t)
	if got["type"] != "document" {
		t.Fatalf("type = %v, want document", got["type"])
	}
	doc := got["document"].(map[string]interface{})
	if doc["link"] != "https://example.com/r.pdf" || doc["filename"] != "r.pdf" || doc["caption"] != "receipt" {
		t.Errorf("document = %v", doc)
	}
}

func TestSend_Template(t *testing.T) {
	a, captured := newTestAdapter(t)
	m := channel.Message{
		To:           "+15551234567",
		Template:     "order_confirm",
		TemplateLang: "en_US",
		TemplateVars: []string{"Jane", "#42"},
	}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}
	got := captured.decode(t)
	if got["type"] != "template" {
		t.Fatalf("type = %v, want template", got["type"])
	}
	tmpl := got["template"].(map[string]interface{})
	if tmpl["name"] != "order_confirm" {
		t.Errorf("template.name = %v", tmpl["name"])
	}
	lang := tmpl["language"].(map[string]interface{})
	if lang["code"] != "en_US" {
		t.Errorf("template.language.code = %v", lang["code"])
	}
	components := tmpl["components"].([]interface{})
	body := components[0].(map[string]interface{})
	params := body["parameters"].([]interface{})
	if len(params) != 2 {
		t.Fatalf("got %d template params, want 2", len(params))
	}
}

func TestSend_ListOverLimitDegradesInsteadOfTruncating(t *testing.T) {
	a, captured := newTestAdapter(t)
	rows := make([]channel.Row, 0, 11)
	for i := 0; i < 11; i++ {
		rows = append(rows, channel.Row{ID: idFor(i), Title: titleFor(i)})
	}
	m := channel.Message{
		To:       "+15551234567",
		Body:     "Pick one",
		Sections: []channel.Section{{Rows: rows}},
	}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}
	got := captured.decode(t)
	if got["type"] != "text" {
		t.Fatalf("type = %v, want text (over-limit list must degrade, not truncate)", got["type"])
	}
	text := got["text"].(map[string]interface{})["body"].(string)
	for i := 0; i < 11; i++ {
		if !strings.Contains(text, titleFor(i)) {
			t.Errorf("degraded text dropped row %d (%s):\n%s", i, titleFor(i), text)
		}
	}
}

func TestSend_ButtonsOverLimitDegrades(t *testing.T) {
	a, captured := newTestAdapter(t)
	m := channel.Message{
		To:   "+15551234567",
		Body: "Pick one",
		Buttons: []channel.Button{
			{ID: "a", Title: "A"}, {ID: "b", Title: "B"},
			{ID: "c", Title: "C"}, {ID: "d", Title: "D"},
		},
	}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}
	got := captured.decode(t)
	if got["type"] != "text" {
		t.Fatalf("type = %v, want text (over-limit buttons must degrade, not truncate)", got["type"])
	}
	text := got["text"].(map[string]interface{})["body"].(string)
	for _, title := range []string{"A", "B", "C", "D"} {
		if !strings.Contains(text, title) {
			t.Errorf("degraded text dropped button %q:\n%s", title, text)
		}
	}
}

func idFor(i int) string    { return "row-" + itoa(i) }
func titleFor(i int) string { return "Dish " + itoa(i) }
func itoa(i int) string {
	digits := "0123456789"
	if i < 10 {
		return string(digits[i])
	}
	return string(digits[i/10]) + string(digits[i%10])
}

func TestSend_NilClientNotConfigured(t *testing.T) {
	a := New(nil)
	if _, err := a.Send(context.Background(), channel.Message{To: "+1", Body: "hi"}); err != channel.ErrNotConfigured {
		t.Errorf("err = %v, want ErrNotConfigured", err)
	}
	if err := a.MarkRead(context.Background(), "id"); err != channel.ErrNotConfigured {
		t.Errorf("MarkRead err = %v, want ErrNotConfigured", err)
	}
	if err := a.React(context.Background(), "+1", "id", "😀"); err != channel.ErrNotConfigured {
		t.Errorf("React err = %v, want ErrNotConfigured", err)
	}
}

func TestSend_UnconfiguredClientNotConfigured(t *testing.T) {
	// A client built with no credentials fails inside the underlying
	// integrations client, not the adapter; the adapter must still translate
	// that into channel.ErrNotConfigured rather than a bare error string.
	c := integrations_whatsapp.NewClient("", "")
	a := New(c)
	if _, err := a.Send(context.Background(), channel.Message{To: "+1", Body: "hi"}); err != channel.ErrNotConfigured {
		t.Errorf("err = %v, want ErrNotConfigured", err)
	}
}

func TestSend_ValidateErrorBeforeSending(t *testing.T) {
	a, captured := newTestAdapter(t)
	_, err := a.Send(context.Background(), channel.Message{})
	if err == nil {
		t.Fatal("want an error for a message with no recipient and no body")
	}
	captured.mu.Lock()
	got := captured.body
	captured.mu.Unlock()
	if got != nil {
		t.Errorf("Send made a request despite failing Validate: %s", got)
	}
}

// ─── Parse ──────────────────────────────────────────────────────────────────

func TestParse_Text(t *testing.T) {
	a := New(nil)
	body := []byte(`{
		"object": "whatsapp_business_account",
		"entry": [{"changes": [{"field": "messages", "value": {
			"messages": [{"from": "15551234567", "id": "wamid.1", "timestamp": "1700000000", "type": "text", "text": {"body": "hi there"}}]
		}}]}]
	}`)
	msgs, err := a.Parse(body)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("got %d messages, want 1", len(msgs))
	}
	m := msgs[0]
	if m.From != "15551234567" || m.ID != "wamid.1" || m.Text != "hi there" || m.Timestamp != 1700000000 {
		t.Errorf("got %+v", m)
	}
	if m.Reply != "" {
		t.Errorf("Reply = %q, want empty (no degraded list was pending)", m.Reply)
	}
}

func TestParse_TextResolvesDegradedReply(t *testing.T) {
	a, _ := newTestAdapter(t)
	m := channel.Message{
		To:   "15551234567",
		Body: "Pick one",
		Sections: []channel.Section{{Rows: []channel.Row{
			{ID: "row-1", Title: "A"}, {ID: "row-2", Title: "B"}, {ID: "row-3", Title: "C"},
			{ID: "row-4", Title: "D"}, {ID: "row-5", Title: "E"}, {ID: "row-6", Title: "F"},
			{ID: "row-7", Title: "G"}, {ID: "row-8", Title: "H"}, {ID: "row-9", Title: "I"},
			{ID: "row-10", Title: "J"}, {ID: "row-11", Title: "K"},
		}}},
	}
	if _, err := a.Send(context.Background(), m); err != nil {
		t.Fatalf("Send: %v", err)
	}

	body := []byte(`{"object":"whatsapp_business_account","entry":[{"changes":[{"field":"messages","value":{
		"messages":[{"from":"15551234567","id":"wamid.2","timestamp":"1700000001","type":"text","text":{"body":"3"}}]
	}}]}]}`)
	msgs, err := a.Parse(body)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Reply != "row-3" {
		t.Fatalf("got %+v, want Reply=row-3", msgs)
	}
}

func TestParse_ListReply(t *testing.T) {
	a := New(nil)
	body := []byte(`{
		"object": "whatsapp_business_account",
		"entry": [{"changes": [{"field": "messages", "value": {
			"messages": [{"from": "15551234567", "id": "wamid.3", "timestamp": "1700000002", "type": "interactive",
				"interactive": {"type": "list_reply", "list_reply": {"id": "row-2", "title": "Bhajia"}}}]
		}}]}]
	}`)
	msgs, err := a.Parse(body)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Reply != "row-2" {
		t.Fatalf("got %+v, want Reply=row-2", msgs)
	}
}

func TestParse_ButtonReply(t *testing.T) {
	a := New(nil)
	body := []byte(`{
		"object": "whatsapp_business_account",
		"entry": [{"changes": [{"field": "messages", "value": {
			"messages": [{"from": "15551234567", "id": "wamid.4", "timestamp": "1700000003", "type": "interactive",
				"interactive": {"type": "button_reply", "button_reply": {"id": "yes", "title": "Yes"}}}]
		}}]}]
	}`)
	msgs, err := a.Parse(body)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(msgs) != 1 || msgs[0].Reply != "yes" {
		t.Fatalf("got %+v, want Reply=yes", msgs)
	}
}

func TestParse_StatusOnlyCallbackReturnsEmptyNotError(t *testing.T) {
	a := New(nil)
	body := []byte(`{
		"object": "whatsapp_business_account",
		"entry": [{"changes": [{"field": "messages", "value": {
			"statuses": [{"id": "wamid.5", "status": "delivered", "timestamp": "1700000004"}]
		}}]}]
	}`)
	msgs, err := a.Parse(body)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("got %d messages, want 0", len(msgs))
	}
}
