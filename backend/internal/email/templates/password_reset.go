package templates

// PasswordResetHTML is the HTML template for the password_reset action.
// Data fields: Subject, LogoURL, Preheader, Year (from baseData),
//
//	Name string, ResetURL string, ExpiresMinutes int.
const PasswordResetHTML = htmlHeader + `
            <h1 style="` + h1Style + `">Reset your password</h1>
            <p style="` + bodyStyle + `">Hi {{.Name}},</p>
            <p style="` + bodyStyle + `">
              We received a request to reset the password for your BeepBite account.
              Click the button below to choose a new password.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:28px auto;">
              <tr>
                <td style="border-radius:6px;background-color:#f97316;
                           box-shadow:0 2px 4px rgba(249,115,22,0.35);">
                  <a href="{{.ResetURL}}"
                     style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;
                            color:#ffffff;text-decoration:none;border-radius:6px;
                            background-color:#f97316;mso-padding-alt:14px 36px;
                            letter-spacing:0.01em;">
                    Reset Password
                  </a>
                </td>
              </tr>
            </table>

            <p style="` + bodyStyle + `font-size:13px;color:#9ca3af;">
              Button not working?
              Copy and paste the link below into your browser:
            </p>
            <p style="` + fallbackLinkStyle + `">
              <a href="{{.ResetURL}}" style="color:#f97316;text-decoration:none;">{{.ResetURL}}</a>
            </p>

            <hr style="` + dividerStyle + `">
            <p style="` + noteStyle + `">
              This link expires in <strong>{{.ExpiresMinutes}} minutes</strong>.
              If you did not request a password reset, please ignore this email &mdash;
              your password will not change.
            </p>
` + htmlFooter

// PasswordResetText is the plain-text fallback for password_reset.
const PasswordResetText = `Hi {{.Name}},

We received a request to reset the password for your BeepBite account.

Reset your password by visiting:

  {{.ResetURL}}

This link expires in {{.ExpiresMinutes}} minutes.

If you did not request a password reset, please ignore this email — your password will not change.

-- The BeepBite Team
`
