package templates

// WelcomeHTML is the HTML template for the welcome action.
// Data fields: Subject string, Name string.
const WelcomeHTML = htmlHeader + `
            <h1 style="` + h1Style + `">Welcome to BeepBite!</h1>
            <p style="` + bodyStyle + `">Hi {{.Name}},</p>
            <p style="` + bodyStyle + `">
              Your account is confirmed and ready to go. BeepBite gives you a modern,
              fast point-of-sale and payments platform built for restaurants and retail.
            </p>
            <p style="` + bodyStyle + `">Here&apos;s what you can do right away:</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="width:100%;margin:0 0 20px 0;">
              <tr>
                <td style="padding:8px 0;font-size:15px;color:#374151;">
                  &#x2714;&nbsp; Set up your store and menu
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:15px;color:#374151;">
                  &#x2714;&nbsp; Invite your team members and drivers
                </td>
              </tr>
              <tr>
                <td style="padding:8px 0;font-size:15px;color:#374151;">
                  &#x2714;&nbsp; Connect a payment processor and go live
                </td>
              </tr>
            </table>

            <p style="` + noteStyle + `">
              Have questions? Reply to this email or visit our help centre &mdash;
              we&apos;re happy to help.
            </p>
` + htmlFooter

// WelcomeText is the plain-text fallback for welcome.
const WelcomeText = `Hi {{.Name}},

Welcome to BeepBite! Your account is confirmed and ready to go.

Here's what you can do right away:
  - Set up your store and menu
  - Invite your team members and drivers
  - Connect a payment processor and go live

Have questions? Just reply to this email — we're happy to help.

-- BeepBite Team
`
