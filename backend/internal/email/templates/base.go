// Package templates holds BeepBite branded email templates.
//
// Every template is defined as a Go string constant so the entire sub-package
// compiles without external files, keeping the binary fully self-contained.
// html/template and text/template are used by the parent renderer (templated.go).
//
// HTML emails use table-based layouts with inline CSS for maximum email-client
// compatibility (Gmail, Outlook, Apple Mail).  Max-width is 600 px.
// Brand colour: orange #f97316 (Tailwind orange-500 equivalent).
package templates

import (
	"os"
	"strings"
)

// LogoURL returns the URL to use for the header logo image.
//
// Resolution order:
//  1. EMAIL_LOGO_URL env var (explicit override)
//  2. APP_URL + "/icon.png"  (the app serves public/icon.png)
//  3. "" — no image; the wordmark text alone will render in the header.
func LogoURL() string {
	if u := os.Getenv("EMAIL_LOGO_URL"); u != "" {
		return u
	}
	if base := os.Getenv("APP_URL"); base != "" {
		return strings.TrimRight(base, "/") + "/icon.png"
	}
	return ""
}

// htmlHeader is the common opening of every HTML email.
// The caller injects Subject (title) and LogoURL via the template data struct.
const htmlHeader = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>{{.Subject}}</title>
  <!--[if mso]>
  <noscript>
    <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;">

<!-- Preheader: hidden snippet that shows in inbox preview -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;
            font-size:1px;color:#f4f4f5;line-height:1px;">
  {{.Preheader}}&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;&nbsp;&#847;
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#f4f4f5;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <!-- Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;background-color:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 2px 8px rgba(0,0,0,0.10);">

        <!-- Orange header bar -->
        <tr>
          <td style="background-color:#f97316;padding:20px 32px;" align="left">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                {{if .LogoURL}}
                <td style="vertical-align:middle;padding-right:12px;">
                  <img src="{{.LogoURL}}"
                       alt="BeepBite"
                       width="40" height="40"
                       style="display:block;border-radius:6px;width:40px;height:40px;border:0;">
                </td>
                {{end}}
                <td style="vertical-align:middle;">
                  <span style="font-size:22px;font-weight:800;color:#ffffff;
                               letter-spacing:-0.5px;line-height:1;">
                    BeepBite
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px 36px;">
`

// htmlFooter closes the card and adds the standard footer.
const htmlFooter = `
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color:#f9fafb;padding:24px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0 0 6px 0;font-size:13px;font-weight:700;color:#6b7280;
                       text-align:center;letter-spacing:0.02em;">
              BeepBite
            </p>
            <p style="margin:0 0 12px 0;font-size:12px;color:#9ca3af;text-align:center;
                       line-height:1.5;">
              Modern POS &amp; WhatsApp ordering
            </p>
            <p style="margin:0;font-size:11px;color:#d1d5db;text-align:center;line-height:1.7;">
              You received this email because an action was taken on your BeepBite account.<br>
              If you did not request this, you can safely ignore this message.<br>
              &copy; {{.Year}} BeepBite. All rights reserved.
            </p>
          </td>
        </tr>

      </table>
      <!-- /Card -->
    </td>
  </tr>
</table>
</body>
</html>
`

// buttonHTML renders a centred orange CTA button.
// Embed directly as a string constant in templates using the data's ButtonURL/ButtonLabel fields.
const buttonHTML = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
       style="margin:28px auto;">
  <tr>
    <td style="border-radius:6px;background-color:#f97316;
               box-shadow:0 2px 4px rgba(249,115,22,0.35);">
      <a href="{{.ButtonURL}}"
         style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;
                color:#ffffff;text-decoration:none;border-radius:6px;
                background-color:#f97316;mso-padding-alt:14px 32px;
                letter-spacing:0.01em;">
        {{.ButtonLabel}}
      </a>
    </td>
  </tr>
</table>`

// bodyStyle is the default prose paragraph style.
const bodyStyle = `font-size:15px;line-height:1.75;color:#374151;margin:0 0 18px 0;`

// h1Style is the default heading style inside the card body.
const h1Style = `font-size:24px;font-weight:800;color:#111827;margin:0 0 20px 0;line-height:1.3;`

// noteStyle is for secondary/muted text inside the card body.
const noteStyle = `font-size:13px;color:#6b7280;line-height:1.6;margin:20px 0 0 0;`

// fallbackLinkStyle is the "or paste this link" URL line style.
const fallbackLinkStyle = `font-size:13px;color:#6b7280;word-break:break-all;margin:0 0 16px 0;`

// dividerStyle is a subtle visual separator.
const dividerStyle = `border:0;border-top:1px solid #f3f4f6;margin:24px 0;`
