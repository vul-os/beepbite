package templates

// VerifyEmailHTML is the HTML template for the verify_email action.
// Data fields: Subject string, Name string, VerifyURL string.
const VerifyEmailHTML = htmlHeader + `
            <h1 style="` + h1Style + `">Confirm your email address</h1>
            <p style="` + bodyStyle + `">Hi {{.Name}},</p>
            <p style="` + bodyStyle + `">
              Thanks for signing up for BeepBite! Please verify your email address
              so we can activate your account.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:24px auto;">
              <tr>
                <td style="border-radius:6px;background-color:#f97316;">
                  <a href="{{.VerifyURL}}"
                     style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;
                            color:#ffffff;text-decoration:none;border-radius:6px;
                            background-color:#f97316;mso-padding-alt:12px 28px;">
                    Verify Email Address
                  </a>
                </td>
              </tr>
            </table>

            <p style="` + bodyStyle + `">
              If the button above doesn&#39;t work, copy and paste the link below into your browser:
            </p>
            <p style="font-size:13px;color:#6b7280;word-break:break-all;margin:0 0 16px 0;">
              {{.VerifyURL}}
            </p>
            <p style="` + noteStyle + `">
              This link expires in 24 hours. If you did not create a BeepBite account,
              you can safely ignore this email.
            </p>
` + htmlFooter

// VerifyEmailText is the plain-text fallback for verify_email.
const VerifyEmailText = `Hi {{.Name}},

Thanks for signing up for BeepBite! Please verify your email address by visiting the link below:

  {{.VerifyURL}}

This link expires in 24 hours.

If you did not create a BeepBite account, you can safely ignore this email.

-- BeepBite Team
`
