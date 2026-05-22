package templates

// DriverInviteHTML is the HTML template for the driver_invite action.
// Data fields: Subject, LogoURL, Preheader, Year (from baseData),
//
//	OrgName string, InviteURL string, InviterName string.
const DriverInviteHTML = htmlHeader + `
            <h1 style="` + h1Style + `">You&apos;ve been invited to drive for {{.OrgName}}</h1>
            <p style="` + bodyStyle + `">Hello!</p>
            <p style="` + bodyStyle + `">
              <strong>{{.InviterName}}</strong> at <strong>{{.OrgName}}</strong> has invited
              you to join their delivery team on BeepBite. As a driver you&apos;ll receive
              orders straight to your phone and track deliveries in real time.
            </p>
            <p style="` + bodyStyle + `">
              Click below to accept the invitation and create your driver account.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:28px auto;">
              <tr>
                <td style="border-radius:6px;background-color:#f97316;
                           box-shadow:0 2px 4px rgba(249,115,22,0.35);">
                  <a href="{{.InviteURL}}"
                     style="display:inline-block;padding:14px 36px;font-size:15px;font-weight:700;
                            color:#ffffff;text-decoration:none;border-radius:6px;
                            background-color:#f97316;mso-padding-alt:14px 36px;
                            letter-spacing:0.01em;">
                    Accept Driver Invitation
                  </a>
                </td>
              </tr>
            </table>

            <p style="` + bodyStyle + `font-size:13px;color:#9ca3af;">
              Or paste this link into your browser:
            </p>
            <p style="` + fallbackLinkStyle + `">
              <a href="{{.InviteURL}}" style="color:#f97316;text-decoration:none;">{{.InviteURL}}</a>
            </p>

            <hr style="` + dividerStyle + `">
            <p style="` + noteStyle + `">
              This invitation expires in <strong>7 days</strong>. If you were not expecting
              this, you can safely ignore this email.
            </p>
` + htmlFooter

// DriverInviteText is the plain-text fallback for driver_invite.
const DriverInviteText = `Hello!

{{.InviterName}} at {{.OrgName}} has invited you to join their delivery team on BeepBite.

Accept the invitation by visiting:

  {{.InviteURL}}

This link expires in 7 days.

If you were not expecting this invitation, you can safely ignore this email.

-- The BeepBite Team
`
