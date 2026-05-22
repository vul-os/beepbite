package templates

// WelcomeHTML is the HTML template for the welcome action.
// Data fields: Subject, LogoURL, Preheader, Year (from baseData), Name string.
const WelcomeHTML = htmlHeader + `
            <h1 style="` + h1Style + `">Welcome to BeepBite! &#127881;</h1>
            <p style="` + bodyStyle + `">Hi {{.Name}},</p>
            <p style="` + bodyStyle + `">
              Your account is confirmed and ready to go. BeepBite gives you a modern,
              fast point-of-sale and WhatsApp ordering platform built for restaurants
              and retail &mdash; so you can focus on serving great food.
            </p>

            <!-- Feature checklist -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="width:100%;background-color:#fff7ed;border-radius:8px;
                          border:1px solid #fed7aa;margin:0 0 24px 0;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 12px 0;font-size:13px;font-weight:700;color:#9a3412;
                             text-transform:uppercase;letter-spacing:0.05em;">
                    Get started in minutes
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                         style="width:100%;">
                    <tr>
                      <td style="padding:6px 0;font-size:15px;color:#374151;line-height:1.5;">
                        <span style="color:#f97316;font-weight:700;margin-right:8px;">&#10003;</span>
                        Set up your store and menu
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;font-size:15px;color:#374151;line-height:1.5;">
                        <span style="color:#f97316;font-weight:700;margin-right:8px;">&#10003;</span>
                        Invite your team members and drivers
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;font-size:15px;color:#374151;line-height:1.5;">
                        <span style="color:#f97316;font-weight:700;margin-right:8px;">&#10003;</span>
                        Connect a payment processor and go live
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;font-size:15px;color:#374151;line-height:1.5;">
                        <span style="color:#f97316;font-weight:700;margin-right:8px;">&#10003;</span>
                        Enable WhatsApp ordering for your customers
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <hr style="` + dividerStyle + `">
            <p style="` + noteStyle + `">
              Have questions? Just reply to this email &mdash; we&apos;re happy to help you
              get up and running.
            </p>
` + htmlFooter

// WelcomeText is the plain-text fallback for welcome.
const WelcomeText = `Hi {{.Name}},

Welcome to BeepBite! Your account is confirmed and ready to go.

Here's what you can do right away:
  - Set up your store and menu
  - Invite your team members and drivers
  - Connect a payment processor and go live
  - Enable WhatsApp ordering for your customers

Have questions? Just reply to this email — we're happy to help.

-- The BeepBite Team
`
