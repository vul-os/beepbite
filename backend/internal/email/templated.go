// templated.go — branded email template renderer for BeepBite.
//
// Use Render(name, data) to build a provider-agnostic Message for any of the
// supported template names.  The caller can pass the result directly to
// Provider.Send after setting msg.To (and optionally msg.ReplyTo).
//
// Environment:
//
//	APP_URL — base URL used to build absolute links passed in data["path"]
//	          fields (e.g. "/auth/verify?token=…").  When unset, falls back
//	          to the safe placeholder https://app.beepbite.io.
//
// Supported template names and their required data keys:
//
//	verify_email      — name, verifyURL (or path which is joined to APP_URL)
//	password_reset    — name, resetURL (or path), expiresMinutes
//	welcome           — name
//	member_invite     — orgName, role, inviteURL (or path), inviterName
//	driver_invite     — orgName, inviteURL (or path), inviterName
//	staff_credentials — name, storeName, username, tempPassword, loginURL (or path), mustChange
//
// Data keys are case-insensitive at the map level — the renderer maps them to
// exported struct fields, so callers may pass either "name" or "Name".
package email

import (
	"bytes"
	"fmt"
	htmltpl "html/template"
	"os"
	"strings"
	texttpl "text/template"

	"github.com/beepbite/backend/internal/email/templates"
)

// appBaseURL returns the configured APP_URL or the safe placeholder default.
func appBaseURL() string {
	if u := os.Getenv("APP_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return "https://app.beepbite.io"
}

// absURL builds an absolute URL from the base and a caller-supplied path or
// pre-formed absolute URL.  If urlOrPath already starts with "http" it is
// returned as-is; otherwise it is joined to APP_URL.
func absURL(urlOrPath string) string {
	if urlOrPath == "" {
		return appBaseURL()
	}
	if strings.HasPrefix(urlOrPath, "http://") || strings.HasPrefix(urlOrPath, "https://") {
		return urlOrPath
	}
	base := appBaseURL()
	if !strings.HasPrefix(urlOrPath, "/") {
		urlOrPath = "/" + urlOrPath
	}
	return base + urlOrPath
}

// strVal extracts a string from a map[string]any, trying the key as-is first
// then with Title-case first letter (e.g. "name" → "Name").  Returns "" when
// the key is absent or the value is not a string.
func strVal(data map[string]any, key string) string {
	if v, ok := data[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	// try capitalised form
	if len(key) == 0 {
		return ""
	}
	cap := strings.ToUpper(key[:1]) + key[1:]
	if v, ok := data[cap]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// boolVal extracts a bool from a map[string]any, trying both forms.
func boolVal(data map[string]any, key string) bool {
	if v, ok := data[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	if len(key) == 0 {
		return false
	}
	cap := strings.ToUpper(key[:1]) + key[1:]
	if v, ok := data[cap]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

// intVal extracts an int from a map[string]any (accepts int, int64, float64).
func intVal(data map[string]any, key string) int {
	tryKey := func(k string) (int, bool) {
		v, ok := data[k]
		if !ok {
			return 0, false
		}
		switch t := v.(type) {
		case int:
			return t, true
		case int64:
			return int(t), true
		case float64:
			return int(t), true
		}
		return 0, false
	}
	if v, ok := tryKey(key); ok {
		return v
	}
	if len(key) == 0 {
		return 0
	}
	cap := strings.ToUpper(key[:1]) + key[1:]
	if v, ok := tryKey(cap); ok {
		return v
	}
	return 0
}

// renderHTML parses and executes an html/template string.
func renderHTML(tmplSrc string, tplData any) (string, error) {
	t, err := htmltpl.New("email").Parse(tmplSrc)
	if err != nil {
		return "", fmt.Errorf("email/template parse: %w", err)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, tplData); err != nil {
		return "", fmt.Errorf("email/template execute: %w", err)
	}
	return buf.String(), nil
}

// renderText parses and executes a text/template string.
func renderText(tmplSrc string, tplData any) (string, error) {
	t, err := texttpl.New("email").Parse(tmplSrc)
	if err != nil {
		return "", fmt.Errorf("email/text template parse: %w", err)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, tplData); err != nil {
		return "", fmt.Errorf("email/text template execute: %w", err)
	}
	return buf.String(), nil
}

// ─── Template data structs ─────────────────────────────────────────────────────
// Each struct carries both the computed Subject (used by htmlHeader's
// {{.Subject}} reference) and the template-specific fields.

type verifyEmailData struct {
	Subject   string
	Name      string
	VerifyURL string
}

type passwordResetData struct {
	Subject        string
	Name           string
	ResetURL       string
	ExpiresMinutes int
}

type welcomeData struct {
	Subject string
	Name    string
}

type memberInviteData struct {
	Subject     string
	OrgName     string
	Role        string
	InviteURL   string
	InviterName string
}

type driverInviteData struct {
	Subject     string
	OrgName     string
	InviteURL   string
	InviterName string
}

type staffCredentialsData struct {
	Subject      string
	Name         string
	StoreName    string
	Username     string
	TempPassword string
	LoginURL     string
	MustChange   bool
}

// ─── Render ───────────────────────────────────────────────────────────────────

// Render builds a provider-agnostic Message for the named template using the
// supplied data map.
//
// The From field is pre-populated as "BeepBite <noreply@beepbite.io>"; callers
// may override it before passing the Message to Provider.Send.
//
// URL fields accept either a full absolute URL (https://…) or a path that will
// be joined to APP_URL.  Key aliases (lower-case or Title-case) are both
// accepted in data.
func Render(name string, data map[string]any) (Message, error) {
	const fromAddr = "BeepBite <noreply@beepbite.io>"

	switch name {
	// ── verify_email ──────────────────────────────────────────────────────────
	case "verify_email":
		url := strVal(data, "verifyURL")
		if url == "" {
			url = strVal(data, "path")
		}
		url = absURL(url)

		d := verifyEmailData{
			Subject:   "Verify your BeepBite email",
			Name:      strVal(data, "name"),
			VerifyURL: url,
		}
		html, err := renderHTML(templates.VerifyEmailHTML, d)
		if err != nil {
			return Message{}, err
		}
		text, err := renderText(templates.VerifyEmailText, d)
		if err != nil {
			return Message{}, err
		}
		return Message{From: fromAddr, Subject: d.Subject, HTML: html, Text: text}, nil

	// ── password_reset ────────────────────────────────────────────────────────
	case "password_reset":
		url := strVal(data, "resetURL")
		if url == "" {
			url = strVal(data, "path")
		}
		url = absURL(url)

		exp := intVal(data, "expiresMinutes")
		if exp == 0 {
			exp = 60
		}

		d := passwordResetData{
			Subject:        "Reset your BeepBite password",
			Name:           strVal(data, "name"),
			ResetURL:       url,
			ExpiresMinutes: exp,
		}
		html, err := renderHTML(templates.PasswordResetHTML, d)
		if err != nil {
			return Message{}, err
		}
		text, err := renderText(templates.PasswordResetText, d)
		if err != nil {
			return Message{}, err
		}
		return Message{From: fromAddr, Subject: d.Subject, HTML: html, Text: text}, nil

	// ── welcome ───────────────────────────────────────────────────────────────
	case "welcome":
		d := welcomeData{
			Subject: "Welcome to BeepBite!",
			Name:    strVal(data, "name"),
		}
		html, err := renderHTML(templates.WelcomeHTML, d)
		if err != nil {
			return Message{}, err
		}
		text, err := renderText(templates.WelcomeText, d)
		if err != nil {
			return Message{}, err
		}
		return Message{From: fromAddr, Subject: d.Subject, HTML: html, Text: text}, nil

	// ── member_invite ─────────────────────────────────────────────────────────
	case "member_invite":
		url := strVal(data, "inviteURL")
		if url == "" {
			url = strVal(data, "path")
		}
		url = absURL(url)

		orgName := strVal(data, "orgName")
		d := memberInviteData{
			Subject:     fmt.Sprintf("You're invited to %s on BeepBite", orgName),
			OrgName:     orgName,
			Role:        strVal(data, "role"),
			InviteURL:   url,
			InviterName: strVal(data, "inviterName"),
		}
		html, err := renderHTML(templates.MemberInviteHTML, d)
		if err != nil {
			return Message{}, err
		}
		text, err := renderText(templates.MemberInviteText, d)
		if err != nil {
			return Message{}, err
		}
		return Message{From: fromAddr, Subject: d.Subject, HTML: html, Text: text}, nil

	// ── driver_invite ─────────────────────────────────────────────────────────
	case "driver_invite":
		url := strVal(data, "inviteURL")
		if url == "" {
			url = strVal(data, "path")
		}
		url = absURL(url)

		orgName := strVal(data, "orgName")
		d := driverInviteData{
			Subject:     fmt.Sprintf("You're invited to drive for %s on BeepBite", orgName),
			OrgName:     orgName,
			InviteURL:   url,
			InviterName: strVal(data, "inviterName"),
		}
		html, err := renderHTML(templates.DriverInviteHTML, d)
		if err != nil {
			return Message{}, err
		}
		text, err := renderText(templates.DriverInviteText, d)
		if err != nil {
			return Message{}, err
		}
		return Message{From: fromAddr, Subject: d.Subject, HTML: html, Text: text}, nil

	// ── staff_credentials ─────────────────────────────────────────────────────
	case "staff_credentials":
		url := strVal(data, "loginURL")
		if url == "" {
			url = strVal(data, "path")
		}
		url = absURL(url)

		d := staffCredentialsData{
			Subject:      "Your BeepBite staff account details",
			Name:         strVal(data, "name"),
			StoreName:    strVal(data, "storeName"),
			Username:     strVal(data, "username"),
			TempPassword: strVal(data, "tempPassword"),
			LoginURL:     url,
			MustChange:   boolVal(data, "mustChange"),
		}
		html, err := renderHTML(templates.StaffCredentialsHTML, d)
		if err != nil {
			return Message{}, err
		}
		text, err := renderText(templates.StaffCredentialsText, d)
		if err != nil {
			return Message{}, err
		}
		return Message{From: fromAddr, Subject: d.Subject, HTML: html, Text: text}, nil

	default:
		return Message{}, fmt.Errorf("email: unknown template %q", name)
	}
}
