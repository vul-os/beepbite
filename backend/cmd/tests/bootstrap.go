package main

import "fmt"

// ensureSession makes sure the runner has a live session + a known org/location
// so that feature suites can be run without requiring --auth to precede them.
// Signs up a fresh burner user if we don't have one; the trigger handle_new_user
// gives the new account its own organization + location.
func (r *Runner) ensureSession() bool {
	if r.token != "" && r.orgID != "" && r.locationID != "" {
		return true
	}
	if r.token == "" {
		email := randomEmail()
		pass := "testpassword123!"
		resp := r.POST("/auth/signup", map[string]any{"email": email, "password": pass})
		if !r.CheckStatus(resp.status, 201, "bootstrap signup") {
			return false
		}
		var s sessionResp
		_ = resp.JSON(&s)
		r.token = s.AccessToken
		r.refresh = s.RefreshToken
		r.userID = s.User.ID
		r.userEmail = email
		r.userPass = pass
	}

	// Look up the org created by the signup trigger.
	if r.orgID == "" {
		resp := r.GET("/data/organizations?eq=is_active,true&limit=1", withBearer(r.token))
		if !r.CheckStatus(resp.status, 200, "bootstrap fetch orgs") {
			return false
		}
		var rows []map[string]any
		_ = resp.JSON(&rows)
		if len(rows) == 0 {
			r.fail("bootstrap: no organization created by trigger")
			return false
		}
		r.orgID = fmt.Sprint(rows[0]["id"])
	}

	// Fetch default location.
	if r.locationID == "" {
		resp := r.GET("/data/locations?eq=organization_id,"+r.orgID+"&limit=1", withBearer(r.token))
		if !r.CheckStatus(resp.status, 200, "bootstrap fetch locations") {
			return false
		}
		var rows []map[string]any
		_ = resp.JSON(&rows)
		if len(rows) == 0 {
			r.fail("bootstrap: no default location")
			return false
		}
		r.locationID = fmt.Sprint(rows[0]["id"])
	}
	return true
}
