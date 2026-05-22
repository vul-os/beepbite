package templates

// PasswordResetHTML is the HTML template for the password_reset action.
// Data fields: Subject string, Name string, ResetURL string, ExpiresMinutes int.
const PasswordResetHTML = htmlHeader + `
            <h1 style="` + h1Style + `">Reset your password</h1>
            <p style="` + bodyStyle + `">Hi {{.Name}},</p>
            <p style="` + bodyStyle + `">
              We received a request to reset the password for your BeepBite account.
              Click the button below to choose a new password.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:24px auto;">
              <tr>
                <td style="border-radius:6px;background-color:#f97316;">
                  <a href="{{.ResetURL}}"
                     style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;
                            color:#ffffff;text-decoration:none;border-radius:6px;
                            background-color:#f97316;mso-padding-alt:12px 28px;">
                    Reset Password
                  </a>
                </td>
              </tr>
            </table>

            <p style="` + bodyStyle + `">
              Or paste this link into your browser:
            </p>
            <p style="font-size:13px;color:#6b7280;word-break:break-all;margin:0 0 16px 0;">
              {{.ResetURL}}
            </p>
            <p style="` + noteStyle + `">
              This link expires in {{.ExpiresMinutes}} minutes. If you did not request a password
              reset, please ignore this email &mdash; your password will not change.
            </p>
` + htmlFooter

// PasswordResetText is the plain-text fallback for password_reset.
const PasswordResetText = `Hi {{.Name}},

We received a request to reset the password for your BeepBite account.

Reset your password by visiting:

  {{.ResetURL}}

This link expires in {{.ExpiresMinutes}} minutes.

If you did not request a password reset, please ignore this email — your password will not change.

-- BeepBite Team
`
