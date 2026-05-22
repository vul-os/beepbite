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

// htmlHeader is the common opening of every HTML email.
// The caller injects the <title> value.
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
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background-color:#f4f4f5;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <!-- Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;
                    box-shadow:0 1px 3px rgba(0,0,0,0.08);">

        <!-- Orange header bar -->
        <tr>
          <td style="background-color:#f97316;padding:24px 32px;" align="left">
            <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
              BeepBite
            </span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px 32px;">
`

// htmlFooter closes the card and adds the standard footer.
const htmlFooter = `
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background-color:#f9fafb;padding:20px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.6;">
              &copy; BeepBite &mdash; Modern POS &amp; Payments<br>
              You are receiving this email because an action was taken on your BeepBite account.<br>
              If you did not request this, you can safely ignore this message.
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
// Usage: embed {{template "button" .}} — see individual templates that
// define a "button" named block.
const buttonHTML = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
       style="margin:24px auto;">
  <tr>
    <td style="border-radius:6px;background-color:#f97316;">
      <a href="{{.ButtonURL}}"
         style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;
                color:#ffffff;text-decoration:none;border-radius:6px;
                background-color:#f97316;mso-padding-alt:12px 28px;">
        {{.ButtonLabel}}
      </a>
    </td>
  </tr>
</table>`

// bodyStyle is the default prose paragraph style.
const bodyStyle = `font-size:15px;line-height:1.7;color:#374151;margin:0 0 16px 0;`

// h1Style is the default heading style inside the card body.
const h1Style = `font-size:22px;font-weight:700;color:#111827;margin:0 0 16px 0;line-height:1.3;`

// noteStyle is for secondary/muted text inside the card body.
const noteStyle = `font-size:13px;color:#6b7280;line-height:1.6;margin:16px 0 0 0;`
