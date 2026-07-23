package main

import "fmt"

// bootstrapOrgAndLocation signs up a fresh user, creates an org, inserts an
// owner membership (so RequireOrgScope can resolve the org), re-signs in (to
// get a token whose claims carry the membership), and then creates a location
// for the org. It stores the resulting state on the runner.
//
// This is different from ensureSession: ensureSession relies on a database
// trigger that auto-creates an org (which does not actually exist in this
// codebase). bootstrapOrgAndLocation performs the explicit onboarding steps
// that the frontend does, matching the flow tested by suiteOnboarding.
//
// Returns true on success. On failure it logs the error via r.fail and
// returns false so callers can bail immediately.
func bootstrapOrgAndLocation(r *Runner) bool {
	email := randomEmail()
	password := "testpassword123!"

	// 1. signup
	resp := r.POST("/auth/signup", map[string]any{"email": email, "password": password})
	if !r.CheckStatus(resp.status, 201, "bootstrap: signup 201") {
		return false
	}
	var sess sessionResp
	if err := resp.JSON(&sess); err != nil {
		r.fail(fmt.Sprintf("bootstrap: signup body: %v", err))
		return false
	}
	token := sess.AccessToken
	userID := sess.User.ID
	r.token = token
	r.refresh = sess.RefreshToken
	r.userID = userID
	r.userEmail = email
	r.userPass = password

	// 2. create org
	orgName := "Bootstrap Org " + randomString(6)
	resp = r.POST("/data/organizations",
		map[string]any{"name": orgName},
		withBearer(token))
	if !r.CheckStatus(resp.status, 201, "bootstrap: create org 201") {
		r.fail(fmt.Sprintf("bootstrap: create org body: %s", resp.String()))
		return false
	}
	var orgRows []map[string]any
	if err := resp.JSON(&orgRows); err != nil || len(orgRows) == 0 {
		r.fail(fmt.Sprintf("bootstrap: org body: %v (%s)", err, resp.String()))
		return false
	}
	orgID, _ := orgRows[0]["id"].(string)
	r.orgID = orgID

	// 3. create owner membership (so RequireOrgScope can find the org)
	resp = r.POST("/data/organization_members",
		map[string]any{
			"organization_id": orgID,
			"profile_id":      userID,
			"role":            "owner",
		},
		withBearer(token))
	if !r.CheckStatus(resp.status, 201, "bootstrap: create member 201") {
		r.fail(fmt.Sprintf("bootstrap: create member body: %s", resp.String()))
		return false
	}

	// 4. re-sign-in so the session token carries the new membership
	resp = r.POST("/auth/signin", map[string]any{"email": email, "password": password})
	if !r.CheckStatus(resp.status, 200, "bootstrap: re-signin 200") {
		return false
	}
	var sess2 sessionResp
	_ = resp.JSON(&sess2)
	if sess2.AccessToken != "" {
		token = sess2.AccessToken
		r.token = token
		r.refresh = sess2.RefreshToken
	}

	// 5. create location. (There is no locations.region_id column / regions
	// table in the schema — an earlier migration added both and a later one
	// dropped them — so no region_id is sent; sending one 400s the insert.)
	// currency_code is set so orders on this location resolve a real, seeded
	// currency (locations.currency_code FKs to currencies); without it the
	// order's currency is empty and POST /pos/orders fails the currency FK.
	resp = r.POST("/data/locations",
		map[string]any{
			"organization_id":             orgID,
			"name":                        "Main Branch",
			"currency_code":               "ZAR",
			"on_delivery_payment_methods": []string{"cash"},
		},
		withBearer(token))
	if resp.status == 201 {
		var locRows []map[string]any
		_ = resp.JSON(&locRows)
		if len(locRows) > 0 {
			r.locationID, _ = locRows[0]["id"].(string)
		}
	}

	// Fall back to any existing location for this org if creation somehow
	// returned no row.
	if r.locationID == "" {
		resp2 := r.GET("/data/locations?eq=organization_id,"+orgID+"&limit=1", withBearer(token))
		var locs []map[string]any
		_ = resp2.JSON(&locs)
		if len(locs) > 0 {
			r.locationID, _ = locs[0]["id"].(string)
		}
	}

	return true
}
