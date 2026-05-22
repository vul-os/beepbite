package templates

// StaffCredentialsHTML is the HTML template for the staff_credentials action.
// Data fields: Subject, LogoURL, Preheader, Year (from baseData),
//
//	Name string, StoreName string, Username string,
//	TempPassword string, LoginURL string, MustChange bool.
const StaffCredentialsHTML = htmlHeader + `
            <h1 style="` + h1Style + `">Your staff account is ready</h1>
            <p style="` + bodyStyle + `">Hi {{.Name}},</p>
            <p style="` + bodyStyle + `">
              An account has been created for you at <strong>{{.StoreName}}</strong> on
              BeepBite. Use the credentials below to sign in for the first time.
            </p>

            <!-- Credentials box -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="width:100%;background-color:#f9fafb;border:1px solid #e5e7eb;
                          border-radius:8px;margin:0 0 24px 0;">
              <tr>
                <td style="padding:24px 28px;">
                  <p style="margin:0 0 14px 0;font-size:12px;color:#9ca3af;font-weight:700;
                             text-transform:uppercase;letter-spacing:0.07em;">
                    Your login details
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                         style="width:100%;border-collapse:separate;border-spacing:0;">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0 8px 0;
                                 font-weight:600;width:130px;vertical-align:top;">
                        Username
                      </td>
                      <td style="font-size:15px;color:#111827;padding:8px 0;
                                 font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;
                                 font-weight:600;vertical-align:top;">
                        {{.Username}}
                      </td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;padding:8px 0 8px 0;
                                 font-weight:600;vertical-align:top;">
                        Password
                      </td>
                      <td style="font-size:15px;color:#111827;padding:8px 0;
                                 font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;
                                 font-weight:600;vertical-align:top;letter-spacing:0.03em;">
                        {{.TempPassword}}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            {{if .MustChange}}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="width:100%;margin:0 0 24px 0;">
              <tr>
                <td style="font-size:14px;color:#92400e;background-color:#fffbeb;
                           border:1px solid #fcd34d;border-radius:8px;
                           padding:14px 18px;line-height:1.6;">
                  <strong>Action required:</strong> You will be prompted to set a new password
                  the first time you sign in.
                </td>
              </tr>
            </table>
            {{end}}

            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:28px auto;">
              <tr>
                <td style="border-radius:6px;background-color:#f97316;
                           box-shadow:0 2px 4px rgba(249,115,22,0.35);">
                  <a href="{{.LoginURL}}"
                     style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;
                            color:#ffffff;text-decoration:none;border-radius:6px;
                            background-color:#f97316;mso-padding-alt:14px 36px;
                            letter-spacing:0.01em;">
                    Sign In to BeepBite
                  </a>
                </td>
              </tr>
            </table>

            <p style="` + bodyStyle + `font-size:13px;color:#9ca3af;">
              Or paste this link into your browser:
            </p>
            <p style="` + fallbackLinkStyle + `">
              <a href="{{.LoginURL}}" style="color:#f97316;text-decoration:none;">{{.LoginURL}}</a>
            </p>

            <hr style="` + dividerStyle + `">
            <p style="` + noteStyle + `">
              Keep these credentials safe. If you have any trouble signing in, contact your
              store manager at <strong>{{.StoreName}}</strong>.
            </p>
` + htmlFooter

// StaffCredentialsText is the plain-text fallback for staff_credentials.
const StaffCredentialsText = `Hi {{.Name}},

An account has been created for you at {{.StoreName}} on BeepBite.

Your login details:
  Username: {{.Username}}
  Password: {{.TempPassword}}
{{if .MustChange}}
IMPORTANT: You will be prompted to set a new password when you first sign in.
{{end}}
Sign in at: {{.LoginURL}}

Keep these credentials safe. If you have any trouble signing in, contact your store manager.

-- The BeepBite Team
`
