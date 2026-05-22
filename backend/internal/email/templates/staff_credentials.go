package templates

// StaffCredentialsHTML is the HTML template for the staff_credentials action.
// Data fields: Subject string, Name string, StoreName string, Username string,
//
//	TempPassword string, LoginURL string, MustChange bool.
const StaffCredentialsHTML = htmlHeader + `
            <h1 style="` + h1Style + `">Your BeepBite staff account is ready</h1>
            <p style="` + bodyStyle + `">Hi {{.Name}},</p>
            <p style="` + bodyStyle + `">
              An account has been created for you at <strong>{{.StoreName}}</strong> on BeepBite.
              Use the credentials below to sign in for the first time.
            </p>

            <!-- Credentials box -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="width:100%;background-color:#f9fafb;border:1px solid #e5e7eb;
                          border-radius:6px;margin:0 0 24px 0;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 10px 0;font-size:14px;color:#6b7280;font-weight:600;
                             text-transform:uppercase;letter-spacing:0.05em;">
                    Your login details
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                         style="width:100%;">
                    <tr>
                      <td style="font-size:14px;color:#374151;padding:4px 0;
                                 font-weight:600;width:140px;">Username</td>
                      <td style="font-size:14px;color:#111827;padding:4px 0;font-family:monospace;">
                        {{.Username}}
                      </td>
                    </tr>
                    <tr>
                      <td style="font-size:14px;color:#374151;padding:4px 0;font-weight:600;">
                        Password
                      </td>
                      <td style="font-size:14px;color:#111827;padding:4px 0;font-family:monospace;">
                        {{.TempPassword}}
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            {{if .MustChange}}
            <p style="font-size:14px;color:#b45309;background-color:#fffbeb;
                       border:1px solid #fde68a;border-radius:6px;
                       padding:12px 16px;margin:0 0 20px 0;">
              <strong>Action required:</strong> You will be prompted to set a new password
              the first time you sign in.
            </p>
            {{end}}

            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:24px auto;">
              <tr>
                <td style="border-radius:6px;background-color:#f97316;">
                  <a href="{{.LoginURL}}"
                     style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;
                            color:#ffffff;text-decoration:none;border-radius:6px;
                            background-color:#f97316;mso-padding-alt:12px 28px;">
                    Sign In Now
                  </a>
                </td>
              </tr>
            </table>

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

-- BeepBite Team
`
