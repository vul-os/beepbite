package templates

// MemberInviteHTML is the HTML template for the member_invite action.
// Data fields: Subject string, OrgName string, Role string, InviteURL string, InviterName string.
const MemberInviteHTML = htmlHeader + `
            <h1 style="` + h1Style + `">You&apos;ve been invited to {{.OrgName}}</h1>
            <p style="` + bodyStyle + `">
              <strong>{{.InviterName}}</strong> has invited you to join
              <strong>{{.OrgName}}</strong> on BeepBite as a <strong>{{.Role}}</strong>.
            </p>
            <p style="` + bodyStyle + `">
              Click the button below to accept the invitation and set up your account.
            </p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin:24px auto;">
              <tr>
                <td style="border-radius:6px;background-color:#f97316;">
                  <a href="{{.InviteURL}}"
                     style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;
                            color:#ffffff;text-decoration:none;border-radius:6px;
                            background-color:#f97316;mso-padding-alt:12px 28px;">
                    Accept Invitation
                  </a>
                </td>
              </tr>
            </table>

            <p style="` + bodyStyle + `">Or paste this link into your browser:</p>
            <p style="font-size:13px;color:#6b7280;word-break:break-all;margin:0 0 16px 0;">
              {{.InviteURL}}
            </p>
            <p style="` + noteStyle + `">
              This invitation link expires in 7 days. If you were not expecting this invitation,
              you can safely ignore this email.
            </p>
` + htmlFooter

// MemberInviteText is the plain-text fallback for member_invite.
const MemberInviteText = `{{.InviterName}} has invited you to join {{.OrgName}} on BeepBite as a {{.Role}}.

Accept the invitation by visiting:

  {{.InviteURL}}

This link expires in 7 days.

If you were not expecting this invitation, you can safely ignore this email.

-- BeepBite Team
`
