package templates

// VerifyEmailHTML is the HTML template for the verify_email action.
// Data fields: Subject, LogoURL, Preheader, Year string/int (from baseData),
//
//	Name string, VerifyURL string.
const VerifyEmailHTML = htmlHeader + `
            <h1 style="` + h1Style + `">Confirm your email address</h1>
            <p style="` + bodyStyle + `">Hi {{.Name}},</p>
            <p style="` + bodyStyle + `">
              Thanks for signing up for BeepBite! Please verify your email address
              so we can activate your account and get you up and running.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:28px auto;">
              <tr>
                <td style="border-radius:6px;background-color:#f97316;
                           box-shadow:0 2px 4px rgba(249,115,22,0.35);">
                  <a href="{{.VerifyURL}}"
                     style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;
                            color:#ffffff;text-decoration:none;border-radius:6px;
                            background-color:#f97316;mso-padding-alt:14px 36px;
                            letter-spacing:0.01em;">
                    Verify Email Address
                  </a>
                </td>
              </tr>
            </table>

            <p style="` + bodyStyle + `font-size:13px;color:#9ca3af;">
              Button not working?
              Copy and paste the link below into your browser:
            </p>
            <p style="` + fallbackLinkStyle + `">
              <a href="{{.VerifyURL}}" style="color:#f97316;text-decoration:none;">{{.VerifyURL}}</a>
            </p>

            <hr style="` + dividerStyle + `">
            <p style="` + noteStyle + `">
              This link expires in <strong>24 hours</strong>. If you did not create a BeepBite
              account, you can safely ignore this email &mdash; no action is required.
            </p>
` + htmlFooter

// VerifyEmailText is the plain-text fallback for verify_email.
const VerifyEmailText = `Hi {{.Name}},

Thanks for signing up for BeepBite! Please verify your email address by visiting the link below:

  {{.VerifyURL}}

This link expires in 24 hours.

If you did not create a BeepBite account, you can safely ignore this email.

-- The BeepBite Team
`
