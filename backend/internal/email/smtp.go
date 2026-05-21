// smtp.go — SMTP adapter (generic relay / self-hosted MTA).
//
// Uses the stdlib net/smtp package with STARTTLS where the server advertises it.
// Works with any RFC 5321 SMTP relay: Postfix, Exim, Mailtrap, Gmail SMTP, etc.
//
// BYO credential keys (encrypted_keys JSON):
//
//	"host"     — SMTP host (e.g. "smtp.example.com")
//	"port"     — SMTP port as string (e.g. "587", "465", "25")
//	"username" — SMTP AUTH username (empty → skip AUTH)
//	"password" — SMTP AUTH password
//	"from"     — default From address
//
// TODO(heavy): add TLS-first (implicit TLS / port 465) mode using
// crypto/tls.Dial instead of STARTTLS upgrade.  Current implementation uses
// STARTTLS (port 587) which covers the majority of relay providers.
package email

import (
	"context"
	"crypto/tls"
	"fmt"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// SMTPAdapter implements Provider using a generic SMTP relay.
type SMTPAdapter struct {
	host     string
	port     string
	username string
	password string
	fromAddr string
	// dialTimeout controls the TCP connection deadline.
	dialTimeout time.Duration
}

// NewSMTPAdapter constructs a SMTPAdapter.
//   - host     — SMTP host.
//   - port     — SMTP port (e.g. "587").
//   - username — AUTH username; empty skips authentication.
//   - password — AUTH password.
//   - fromAddr — default From address.
func NewSMTPAdapter(host, port, username, password, fromAddr string) *SMTPAdapter {
	if port == "" {
		port = "587"
	}
	return &SMTPAdapter{
		host:        host,
		port:        port,
		username:    username,
		password:    password,
		fromAddr:    fromAddr,
		dialTimeout: 20 * time.Second,
	}
}

// Code implements Provider.
func (a *SMTPAdapter) Code() string { return "smtp" }

// Send implements Provider.
//
// Connects to host:port, upgrades to TLS via STARTTLS, authenticates with
// PLAIN AUTH if credentials are present, then sends the message as a
// quoted-printable MIME email.
func (a *SMTPAdapter) Send(ctx context.Context, msg Message) error {
	from := msg.From
	if from == "" {
		from = a.fromAddr
	}

	addr := net.JoinHostPort(a.host, a.port)

	// Respect ctx deadline for dialling.
	dialer := &net.Dialer{Timeout: a.dialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("%w (smtp): dial %s: %v", ErrSendFailed, addr, err)
	}

	c, err := smtp.NewClient(conn, a.host)
	if err != nil {
		conn.Close()
		return fmt.Errorf("%w (smtp): new client: %v", ErrSendFailed, err)
	}
	defer c.Close()

	// Attempt STARTTLS.
	if ok, _ := c.Extension("STARTTLS"); ok {
		tlsCfg := &tls.Config{ServerName: a.host}
		if err := c.StartTLS(tlsCfg); err != nil {
			return fmt.Errorf("%w (smtp): starttls: %v", ErrSendFailed, err)
		}
	}

	// Authenticate if credentials are provided.
	if a.username != "" {
		auth := smtp.PlainAuth("", a.username, a.password, a.host)
		if err := c.Auth(auth); err != nil {
			return fmt.Errorf("%w (smtp): auth: %v", ErrSendFailed, err)
		}
	}

	// Envelope.
	if err := c.Mail(extractAddr(from)); err != nil {
		return fmt.Errorf("%w (smtp): MAIL FROM: %v", ErrSendFailed, err)
	}
	if err := c.Rcpt(extractAddr(msg.To)); err != nil {
		return fmt.Errorf("%w (smtp): RCPT TO: %v", ErrSendFailed, err)
	}

	// DATA.
	wc, err := c.Data()
	if err != nil {
		return fmt.Errorf("%w (smtp): DATA: %v", ErrSendFailed, err)
	}

	raw := buildSMTPMessage(from, msg)
	if _, err := wc.Write([]byte(raw)); err != nil {
		wc.Close()
		return fmt.Errorf("%w (smtp): write: %v", ErrSendFailed, err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("%w (smtp): close data: %v", ErrSendFailed, err)
	}

	return c.Quit()
}

// buildSMTPMessage constructs a minimal RFC 5322 MIME message.
// When both HTML and Text are present it emits a multipart/alternative body.
// When only one is present it emits a single-part message.
func buildSMTPMessage(from string, msg Message) string {
	var sb strings.Builder

	sb.WriteString("From: " + from + "\r\n")
	sb.WriteString("To: " + msg.To + "\r\n")
	sb.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", msg.Subject) + "\r\n")
	if msg.ReplyTo != "" {
		sb.WriteString("Reply-To: " + msg.ReplyTo + "\r\n")
	}
	sb.WriteString("MIME-Version: 1.0\r\n")

	hasHTML := msg.HTML != ""
	hasText := msg.Text != ""

	switch {
	case hasHTML && hasText:
		boundary := "bbmime_alt_boundary"
		sb.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n")
		sb.WriteString("--" + boundary + "\r\n")
		sb.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
		sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		sb.WriteString(qpEncode(msg.Text))
		sb.WriteString("\r\n--" + boundary + "\r\n")
		sb.WriteString("Content-Type: text/html; charset=utf-8\r\n")
		sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		sb.WriteString(qpEncode(msg.HTML))
		sb.WriteString("\r\n--" + boundary + "--\r\n")
	case hasHTML:
		sb.WriteString("Content-Type: text/html; charset=utf-8\r\n")
		sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		sb.WriteString(qpEncode(msg.HTML))
	default:
		sb.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
		sb.WriteString("Content-Transfer-Encoding: quoted-printable\r\n\r\n")
		sb.WriteString(qpEncode(msg.Text))
	}

	return sb.String()
}

// qpEncode returns the quoted-printable encoding of s.
func qpEncode(s string) string {
	var buf strings.Builder
	w := quotedprintable.NewWriter(&buf)
	_, _ = w.Write([]byte(s))
	_ = w.Close()
	return buf.String()
}

// extractAddr strips a "Display Name <addr>" wrapper and returns the bare
// address so it can be used in SMTP envelope commands.
func extractAddr(addr string) string {
	addr = strings.TrimSpace(addr)
	if start := strings.LastIndex(addr, "<"); start >= 0 {
		if end := strings.Index(addr[start:], ">"); end >= 0 {
			return addr[start+1 : start+end]
		}
	}
	return addr
}
