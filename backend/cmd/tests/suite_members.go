package main

// Members + invite RPCs. check_invites / send_invitation / cancel_invitation
// round-trip.

func suiteMembers(r *Runner) {
	if !r.ensureSession() {
		return
	}

	// check_invites with our user_id — should return [] for a fresh account.
	resp := r.POST("/rpc/check_invites",
		map[string]any{"p_user_id": r.userID},
		withBearer(r.token))
	r.CheckStatus(resp.status, 200, "check_invites 200")

	// Send an invite to a fake email. Expect success=true in the JSON scalar.
	inviteeEmail := randomEmail()
	resp = r.POST("/rpc/send_invitation",
		map[string]any{
			"p_user_id":         r.userID,
			"p_organization_id": r.orgID,
			"p_email":           inviteeEmail,
			"p_role":            "staff",
		},
		withBearer(r.token))
	r.CheckStatus(resp.status, 200, "send_invitation 200")
	var payload map[string]any
	_ = resp.JSON(&payload)
	r.CheckEq(payload["success"], true, "send_invitation success=true")

	// list_organization_invitations should now contain that email.
	resp = r.POST("/rpc/list_organization_invitations",
		map[string]any{"p_user_id": r.userID, "p_organization_id": r.orgID},
		withBearer(r.token))
	r.CheckStatus(resp.status, 200, "list_organization_invitations 200")
	var rows []map[string]any
	_ = resp.JSON(&rows)
	found := ""
	for _, row := range rows {
		if row["email"] == inviteeEmail {
			if id, ok := row["invite_id"].(string); ok {
				found = id
			}
		}
	}
	r.Check(found != "", "sent invite visible in list")

	// cancel_invitation closes the loop.
	if found != "" {
		resp = r.POST("/rpc/cancel_invitation",
			map[string]any{"p_user_id": r.userID, "p_invite_id": found},
			withBearer(r.token))
		r.CheckStatus(resp.status, 200, "cancel_invitation 200")
		_ = resp.JSON(&payload)
		r.CheckEq(payload["success"], true, "cancel_invitation success=true")
	}

	// Non-member sending an invite → success=false with permission error.
	otherOrg := "00000000-0000-0000-0000-000000000000"
	resp = r.POST("/rpc/send_invitation",
		map[string]any{
			"p_user_id":         r.userID,
			"p_organization_id": otherOrg,
			"p_email":           randomEmail(),
			"p_role":            "staff",
		},
		withBearer(r.token))
	r.CheckStatus(resp.status, 200, "send_invitation other-org 200")
	_ = resp.JSON(&payload)
	r.CheckEq(payload["success"], false, "send_invitation rejected for non-member")
}
