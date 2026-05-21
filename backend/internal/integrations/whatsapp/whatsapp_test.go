package whatsapp

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// captureServer returns a test server that records the last request body and
// always replies 200 with a minimal valid SendResponse JSON.  The returned
// *http.Client is already configured to talk to the server.
func captureServer(t *testing.T, captured *[]byte) (*httptest.Server, *http.Client) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("captureServer: read body: %v", err)
		}
		*captured = body
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"messaging_product":"whatsapp","contacts":[],"messages":[]}`))
	}))
	t.Cleanup(srv.Close)
	return srv, srv.Client()
}

// newTestClient wires a Client to the given test server so no real HTTP is made.
func newTestClient(t *testing.T, srv *httptest.Server, hc *http.Client) *Client {
	t.Helper()
	c := NewClient("test-token", "15550000001")
	c.SetBaseURL(srv.URL)
	c.SetHTTPClient(hc)
	return c
}

// unmarshal is a small helper that decodes captured JSON into a generic map.
func unmarshal(t *testing.T, data []byte) map[string]interface{} {
	t.Helper()
	var m map[string]interface{}
	if err := json.Unmarshal(data, &m); err != nil {
		t.Fatalf("unmarshal: %v\nbody: %s", err, data)
	}
	return m
}

// ----- NewClient / construction -------------------------------------------------

func TestNewClient_Fields(t *testing.T) {
	c := NewClient("mytoken", "1234567890")
	if c.accessToken != "mytoken" {
		t.Errorf("accessToken: got %q, want %q", c.accessToken, "mytoken")
	}
	if c.phoneNumberID != "1234567890" {
		t.Errorf("phoneNumberID: got %q, want %q", c.phoneNumberID, "1234567890")
	}
	if c.baseURL != DefaultBaseURL {
		t.Errorf("baseURL: got %q, want %q", c.baseURL, DefaultBaseURL)
	}
	if c.httpClient == nil {
		t.Error("httpClient should not be nil")
	}
}

func TestDefaultBaseURL(t *testing.T) {
	if DefaultBaseURL != "https://graph.facebook.com/v18.0" {
		t.Errorf("unexpected DefaultBaseURL: %q", DefaultBaseURL)
	}
}

func TestSetBaseURL(t *testing.T) {
	c := NewClient("tok", "pid")
	c.SetBaseURL("https://example.com")
	if c.baseURL != "https://example.com" {
		t.Errorf("SetBaseURL: got %q", c.baseURL)
	}
}

func TestSetBaseURL_EmptyIsNoop(t *testing.T) {
	c := NewClient("tok", "pid")
	c.SetBaseURL("")
	if c.baseURL != DefaultBaseURL {
		t.Errorf("SetBaseURL with empty string should be noop, got %q", c.baseURL)
	}
}

func TestSetHTTPClient_NilIsNoop(t *testing.T) {
	c := NewClient("tok", "pid")
	original := c.httpClient
	c.SetHTTPClient(nil)
	if c.httpClient != original {
		t.Error("SetHTTPClient(nil) should not replace the existing client")
	}
}

// ----- URL construction ---------------------------------------------------------

func TestPost_URL(t *testing.T) {
	var captured []byte
	var capturedURL string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		captured = b
		capturedURL = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"messaging_product":"whatsapp","contacts":[],"messages":[]}`))
	}))
	defer srv.Close()

	c := NewClient("tok", "MY_PHONE_ID")
	c.SetBaseURL(srv.URL)
	c.SetHTTPClient(srv.Client())

	_, err := c.SendText("+27821234567", "hello", false)
	if err != nil {
		t.Fatalf("SendText: %v", err)
	}
	_ = captured

	want := "/MY_PHONE_ID/messages"
	if capturedURL != want {
		t.Errorf("URL path: got %q, want %q", capturedURL, want)
	}
}

func TestPost_AuthHeader(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"messaging_product":"whatsapp","contacts":[],"messages":[]}`))
	}))
	defer srv.Close()

	c := NewClient("SECRET_TOKEN", "pid")
	c.SetBaseURL(srv.URL)
	c.SetHTTPClient(srv.Client())

	_, err := c.SendText("+1", "hi", false)
	if err != nil {
		t.Fatalf("SendText: %v", err)
	}
	want := "Bearer SECRET_TOKEN"
	if gotAuth != want {
		t.Errorf("Authorization header: got %q, want %q", gotAuth, want)
	}
}

// ----- post() validation (no network) ------------------------------------------

func TestPost_MissingToken(t *testing.T) {
	c := NewClient("", "pid")
	_, err := c.SendText("+1", "hi", false)
	if err == nil {
		t.Fatal("expected error for empty access token")
	}
}

func TestPost_MissingPhoneNumberID(t *testing.T) {
	c := NewClient("tok", "")
	_, err := c.SendText("+1", "hi", false)
	if err == nil {
		t.Fatal("expected error for empty phone number id")
	}
}

// ----- SendText payload ---------------------------------------------------------

func TestSendText_Payload(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	to := "+27821234567"
	body := "Hello, world!"
	_, err := c.SendText(to, body, true)
	if err != nil {
		t.Fatalf("SendText: %v", err)
	}

	m := unmarshal(t, captured)

	if got := m["messaging_product"]; got != "whatsapp" {
		t.Errorf("messaging_product: got %v", got)
	}
	if got := m["recipient_type"]; got != "individual" {
		t.Errorf("recipient_type: got %v", got)
	}
	if got := m["to"]; got != to {
		t.Errorf("to: got %v, want %v", got, to)
	}
	if got := m["type"]; got != "text" {
		t.Errorf("type: got %v", got)
	}

	text, ok := m["text"].(map[string]interface{})
	if !ok {
		t.Fatalf("text field is not an object: %T", m["text"])
	}
	if got := text["body"]; got != body {
		t.Errorf("text.body: got %v, want %v", got, body)
	}
	if got := text["preview_url"]; got != true {
		t.Errorf("text.preview_url: got %v, want true", got)
	}
}

func TestSendText_PreviewURLFalse(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	_, err := c.SendText("+1", "msg", false)
	if err != nil {
		t.Fatalf("SendText: %v", err)
	}
	m := unmarshal(t, captured)
	text := m["text"].(map[string]interface{})
	if got := text["preview_url"]; got != false {
		t.Errorf("text.preview_url: got %v, want false", got)
	}
}

// ----- SendTemplate payload -----------------------------------------------------

func TestSendTemplate_PayloadNoComponents(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	to := "+27829999999"
	tmplName := "hello_world"
	langCode := "en_US"
	_, err := c.SendTemplate(to, tmplName, langCode, nil)
	if err != nil {
		t.Fatalf("SendTemplate: %v", err)
	}

	m := unmarshal(t, captured)

	if got := m["messaging_product"]; got != "whatsapp" {
		t.Errorf("messaging_product: got %v", got)
	}
	if got := m["recipient_type"]; got != "individual" {
		t.Errorf("recipient_type: got %v", got)
	}
	if got := m["to"]; got != to {
		t.Errorf("to: got %v", got)
	}
	if got := m["type"]; got != "template" {
		t.Errorf("type: got %v", got)
	}

	tmpl, ok := m["template"].(map[string]interface{})
	if !ok {
		t.Fatalf("template field is not an object: %T", m["template"])
	}
	if got := tmpl["name"]; got != tmplName {
		t.Errorf("template.name: got %v", got)
	}
	lang, ok := tmpl["language"].(map[string]interface{})
	if !ok {
		t.Fatalf("template.language is not an object: %T", tmpl["language"])
	}
	if got := lang["code"]; got != langCode {
		t.Errorf("template.language.code: got %v", got)
	}
	// components should be absent when nil supplied
	if _, exists := tmpl["components"]; exists {
		t.Error("template.components should not be present when nil")
	}
}

func TestSendTemplate_PayloadWithComponents(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	components := []map[string]interface{}{
		{"type": "body", "parameters": []interface{}{
			map[string]interface{}{"type": "text", "text": "John"},
		}},
	}
	_, err := c.SendTemplate("+1", "order_confirm", "en", components)
	if err != nil {
		t.Fatalf("SendTemplate: %v", err)
	}

	m := unmarshal(t, captured)
	tmpl := m["template"].(map[string]interface{})
	comps, ok := tmpl["components"]
	if !ok {
		t.Fatal("template.components should be present when non-empty slice passed")
	}
	arr, ok := comps.([]interface{})
	if !ok {
		t.Fatalf("template.components should be array, got %T", comps)
	}
	if len(arr) != 1 {
		t.Errorf("template.components length: got %d, want 1", len(arr))
	}
}

// ----- SendInteractiveList payload ----------------------------------------------

func TestSendInteractiveList_Payload(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	sections := []InteractiveSection{
		{
			Title: "Starters",
			Rows: []InteractiveRow{
				{ID: "r1", Title: "Spring Rolls", Description: "Crispy"},
			},
		},
	}
	_, err := c.SendInteractiveList("+27821111111", "Pick one", "View Menu", sections, "Our Menu", "Powered by BeepBite")
	if err != nil {
		t.Fatalf("SendInteractiveList: %v", err)
	}

	m := unmarshal(t, captured)
	if got := m["messaging_product"]; got != "whatsapp" {
		t.Errorf("messaging_product: got %v", got)
	}
	if got := m["type"]; got != "interactive" {
		t.Errorf("type: got %v", got)
	}

	interactive, ok := m["interactive"].(map[string]interface{})
	if !ok {
		t.Fatalf("interactive not an object: %T", m["interactive"])
	}
	if got := interactive["type"]; got != "list" {
		t.Errorf("interactive.type: got %v", got)
	}

	bodyObj := interactive["body"].(map[string]interface{})
	if got := bodyObj["text"]; got != "Pick one" {
		t.Errorf("interactive.body.text: got %v", got)
	}

	action := interactive["action"].(map[string]interface{})
	if got := action["button"]; got != "View Menu" {
		t.Errorf("interactive.action.button: got %v", got)
	}

	header := interactive["header"].(map[string]interface{})
	if got := header["text"]; got != "Our Menu" {
		t.Errorf("interactive.header.text: got %v", got)
	}
	footer := interactive["footer"].(map[string]interface{})
	if got := footer["text"]; got != "Powered by BeepBite" {
		t.Errorf("interactive.footer.text: got %v", got)
	}
}

func TestSendInteractiveList_NoHeaderFooter(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	_, err := c.SendInteractiveList("+1", "body", "btn", nil, "", "")
	if err != nil {
		t.Fatalf("SendInteractiveList: %v", err)
	}
	m := unmarshal(t, captured)
	interactive := m["interactive"].(map[string]interface{})
	if _, exists := interactive["header"]; exists {
		t.Error("header should be absent when empty string passed")
	}
	if _, exists := interactive["footer"]; exists {
		t.Error("footer should be absent when empty string passed")
	}
}

// ----- SendInteractiveButtons payload ------------------------------------------

func TestSendInteractiveButtons_Payload(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	buttons := []InteractiveButton{
		{ID: "yes", Title: "Yes"},
		{ID: "no", Title: "No"},
	}
	_, err := c.SendInteractiveButtons("+27822222222", "Confirm order?", buttons, "", "")
	if err != nil {
		t.Fatalf("SendInteractiveButtons: %v", err)
	}

	m := unmarshal(t, captured)
	if got := m["messaging_product"]; got != "whatsapp" {
		t.Errorf("messaging_product: got %v", got)
	}
	if got := m["type"]; got != "interactive" {
		t.Errorf("type: got %v", got)
	}

	interactive := m["interactive"].(map[string]interface{})
	if got := interactive["type"]; got != "button" {
		t.Errorf("interactive.type: got %v", got)
	}

	action := interactive["action"].(map[string]interface{})
	btns, ok := action["buttons"].([]interface{})
	if !ok {
		t.Fatalf("interactive.action.buttons not an array: %T", action["buttons"])
	}
	if len(btns) != 2 {
		t.Fatalf("expected 2 buttons, got %d", len(btns))
	}
	first := btns[0].(map[string]interface{})
	if got := first["type"]; got != "reply" {
		t.Errorf("button[0].type: got %v", got)
	}
	reply := first["reply"].(map[string]interface{})
	if got := reply["id"]; got != "yes" {
		t.Errorf("button[0].reply.id: got %v", got)
	}
	if got := reply["title"]; got != "Yes" {
		t.Errorf("button[0].reply.title: got %v", got)
	}
}

// ----- SendImage payload --------------------------------------------------------

func TestSendImage_Payload(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	imgURL := "https://example.com/photo.jpg"
	caption := "Today's special"
	_, err := c.SendImage("+1", imgURL, caption)
	if err != nil {
		t.Fatalf("SendImage: %v", err)
	}

	m := unmarshal(t, captured)
	if got := m["messaging_product"]; got != "whatsapp" {
		t.Errorf("messaging_product: got %v", got)
	}
	if got := m["type"]; got != "image" {
		t.Errorf("type: got %v", got)
	}
	image := m["image"].(map[string]interface{})
	if got := image["link"]; got != imgURL {
		t.Errorf("image.link: got %v", got)
	}
	if got := image["caption"]; got != caption {
		t.Errorf("image.caption: got %v", got)
	}
}

func TestSendImage_NoCaption(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	_, err := c.SendImage("+1", "https://example.com/img.png", "")
	if err != nil {
		t.Fatalf("SendImage: %v", err)
	}
	m := unmarshal(t, captured)
	image := m["image"].(map[string]interface{})
	if _, exists := image["caption"]; exists {
		t.Error("caption should be absent when empty string passed")
	}
}

// ----- SendDocument payload -----------------------------------------------------

func TestSendDocument_Payload(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	docURL := "https://example.com/menu.pdf"
	filename := "menu.pdf"
	caption := "Our menu"
	_, err := c.SendDocument("+1", docURL, filename, caption)
	if err != nil {
		t.Fatalf("SendDocument: %v", err)
	}

	m := unmarshal(t, captured)
	if got := m["messaging_product"]; got != "whatsapp" {
		t.Errorf("messaging_product: got %v", got)
	}
	if got := m["type"]; got != "document" {
		t.Errorf("type: got %v", got)
	}
	doc := m["document"].(map[string]interface{})
	if got := doc["link"]; got != docURL {
		t.Errorf("document.link: got %v", got)
	}
	if got := doc["filename"]; got != filename {
		t.Errorf("document.filename: got %v", got)
	}
	if got := doc["caption"]; got != caption {
		t.Errorf("document.caption: got %v", got)
	}
}

func TestSendDocument_NoFilenameNoCaption(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	_, err := c.SendDocument("+1", "https://example.com/x.pdf", "", "")
	if err != nil {
		t.Fatalf("SendDocument: %v", err)
	}
	m := unmarshal(t, captured)
	doc := m["document"].(map[string]interface{})
	if _, exists := doc["filename"]; exists {
		t.Error("filename should be absent when empty")
	}
	if _, exists := doc["caption"]; exists {
		t.Error("caption should be absent when empty")
	}
}

// ----- SendReaction payload -----------------------------------------------------

func TestSendReaction_Payload(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	msgID := "wamid.ABC123"
	emoji := "\U0001F44D"
	_, err := c.SendReaction("+1", msgID, emoji)
	if err != nil {
		t.Fatalf("SendReaction: %v", err)
	}

	m := unmarshal(t, captured)
	if got := m["messaging_product"]; got != "whatsapp" {
		t.Errorf("messaging_product: got %v", got)
	}
	if got := m["type"]; got != "reaction" {
		t.Errorf("type: got %v", got)
	}
	reaction := m["reaction"].(map[string]interface{})
	if got := reaction["message_id"]; got != msgID {
		t.Errorf("reaction.message_id: got %v", got)
	}
	if got := reaction["emoji"]; got != emoji {
		t.Errorf("reaction.emoji: got %v", got)
	}
}

// ----- MarkAsRead payload -------------------------------------------------------

func TestMarkAsRead_Payload(t *testing.T) {
	var captured []byte
	srv, hc := captureServer(t, &captured)
	c := newTestClient(t, srv, hc)

	msgID := "wamid.XYZ789"
	err := c.MarkAsRead(msgID)
	if err != nil {
		t.Fatalf("MarkAsRead: %v", err)
	}

	m := unmarshal(t, captured)
	if got := m["messaging_product"]; got != "whatsapp" {
		t.Errorf("messaging_product: got %v", got)
	}
	if got := m["status"]; got != "read" {
		t.Errorf("status: got %v", got)
	}
	if got := m["message_id"]; got != msgID {
		t.Errorf("message_id: got %v", got)
	}
}

// ----- API error response handling ----------------------------------------------

func TestPost_ApiErrorResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(400)
		_, _ = w.Write([]byte(`{"error":{"message":"Invalid OAuth access token","type":"OAuthException","code":190,"fbtrace_id":"abc"}}`))
	}))
	defer srv.Close()

	c := NewClient("bad-token", "pid")
	c.SetBaseURL(srv.URL)
	c.SetHTTPClient(srv.Client())

	_, err := c.SendText("+1", "hi", false)
	if err == nil {
		t.Fatal("expected error for 4xx response")
	}
	if err.Error() != "Invalid OAuth access token" {
		t.Errorf("error message: got %q", err.Error())
	}
}

func TestPost_NonJsonErrorResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		w.WriteHeader(503)
		_, _ = w.Write([]byte(`Service Unavailable`))
	}))
	defer srv.Close()

	c := NewClient("tok", "pid")
	c.SetBaseURL(srv.URL)
	c.SetHTTPClient(srv.Client())

	_, err := c.SendText("+1", "hi", false)
	if err == nil {
		t.Fatal("expected error for 5xx response")
	}
}
