package main

// suiteOnboarding exercises the signup → onboarding → POS-readiness flow.
//
// This suite performs the two REST calls the frontend onboarding flow makes
// (POST /data/organizations then POST /data/organization_members) on a fresh
// user account, then verifies profile visibility, check_invites, and location
// creation.
//
// Run:
//
//	go run ./cmd/tests --onboarding
//
// Known failure (BUG-ORGSCOPE-MEMBERSHIP-RLS, documented in
// docs/onboarding-verification.md):
//
//	Steps 7-8 (POST/GET /data/locations) fail because RequireOrgScope's
//	poolQuerier.queryMemberships runs without setting app.current_user_id,
//	so the organization_members SELECT policy returns 0 rows. The middleware
//	then sets db.Scope.OrgID="" which makes current_org_id() NULL, causing
//	the locations INSERT WITH CHECK to reject the row and SELECT to return [].

import "fmt"

func suiteOnboarding(r *Runner) {
	email := randomEmail()
	password := "testpassword123!"

	// -------------------------------------------------------------------
	// Step 1: POST /auth/signup → 201, access_token + user.id
	// -------------------------------------------------------------------
	resp := r.POST("/auth/signup", map[string]any{"email": email, "password": password})
	if !r.CheckStatus(resp.status, 201, "step1: signup 201") {
		return
	}

	var sess sessionResp
	if err := resp.JSON(&sess); err != nil {
		r.fail(fmt.Sprintf("step1: signup body not json: %v (%s)", err, resp.String()))
		return
	}
	r.Check(sess.AccessToken != "", "step1: signup returned access_token")
	r.Check(sess.User.ID != "", "step1: signup returned user.id")

	token := sess.AccessToken
	userID := sess.User.ID

	// Store on runner so --all chaining works.
	r.token = token
	r.refresh = sess.RefreshToken
	r.userID = userID
	r.userEmail = email
	r.userPass = password

	// -------------------------------------------------------------------
	// Step 2: POST /data/organizations → 201, created_by = user.id
	// -------------------------------------------------------------------
	orgName := "Onboard Suite " + randomString(6)
	resp = r.POST("/data/organizations",
		map[string]any{"name": orgName},
		withBearer(token))
	if !r.CheckStatus(resp.status, 201, "step2: create org 201") {
		return
	}

	var orgRows []map[string]any
	if err := resp.JSON(&orgRows); err != nil {
		r.fail(fmt.Sprintf("step2: org body not json: %v (%s)", err, resp.String()))
		return
	}
	if !r.Check(len(orgRows) > 0, "step2: org response has at least one row") {
		return
	}

	orgRow := orgRows[0]
	orgID, _ := orgRow["id"].(string)
	createdBy, _ := orgRow["created_by"].(string)
	r.Check(orgID != "", "step2: org has id")
	r.CheckEq(createdBy, userID, "step2: created_by equals user.id")

	r.orgID = orgID

	// -------------------------------------------------------------------
	// Step 3: GET /data/organizations → 200, org visible to creator
	// -------------------------------------------------------------------
	resp = r.GET("/data/organizations", withBearer(token))
	if !r.CheckStatus(resp.status, 200, "step3: GET orgs 200") {
		return
	}
	var orgs []map[string]any
	_ = resp.JSON(&orgs)
	found := false
	for _, o := range orgs {
		if fmt.Sprint(o["id"]) == orgID {
			found = true
		}
	}
	r.Check(found, "step3: created org visible in GET /data/organizations")

	// -------------------------------------------------------------------
	// Step 4: POST /data/organization_members → 201, capabilities populated
	// -------------------------------------------------------------------
	resp = r.POST("/data/organization_members",
		map[string]any{
			"organization_id": orgID,
			"profile_id":      userID,
			"role":            "owner",
		},
		withBearer(token))
	if !r.CheckStatus(resp.status, 201, "step4: create member 201") {
		return
	}

	var memRows []map[string]any
	if err := resp.JSON(&memRows); err != nil {
		r.fail(fmt.Sprintf("step4: member body not json: %v (%s)", err, resp.String()))
		return
	}
	if !r.Check(len(memRows) > 0, "step4: member response has at least one row") {
		return
	}

	caps, _ := memRows[0]["capabilities"].(map[string]any)
	r.Check(caps != nil, "step4: capabilities field present")
	r.CheckEq(caps["can_void"], true, "step4: can_void = true (trigger 019)")
	r.CheckEq(caps["can_comp"], true, "step4: can_comp = true")
	r.CheckEq(caps["can_settle"], true, "step4: can_settle = true")
	r.CheckEq(caps["can_view_reports"], true, "step4: can_view_reports = true")

	// Re-sign-in so the token's RequireOrgScope lookup has a live membership.
	resp = r.POST("/auth/signin", map[string]any{"email": email, "password": password})
	r.CheckStatus(resp.status, 200, "step4: re-signin after member insert 200")
	var sess2 sessionResp
	_ = resp.JSON(&sess2)
	if sess2.AccessToken != "" {
		token = sess2.AccessToken
		r.token = token
	}

	// -------------------------------------------------------------------
	// Step 5: GET /data/profiles?id=eq.<user-id>&single=true → 200
	// -------------------------------------------------------------------
	resp = r.GET("/data/profiles?id=eq."+userID+"&single=true", withBearer(token))
	r.CheckStatus(resp.status, 200, "step5: GET profile 200")
	var profile map[string]any
	_ = resp.JSON(&profile)
	r.CheckEq(fmt.Sprint(profile["id"]), userID, "step5: profile.id matches user.id")

	// -------------------------------------------------------------------
	// Step 6: POST /rpc/check_invites → 200, returns [] for fresh user
	// -------------------------------------------------------------------
	resp = r.POST("/rpc/check_invites",
		map[string]any{"p_user_id": userID},
		withBearer(token))
	r.CheckStatus(resp.status, 200, "step6: check_invites 200")
	var invites []any
	_ = resp.JSON(&invites)
	r.Check(invites != nil && len(invites) == 0, "step6: check_invites returns [] for fresh user")

	// -------------------------------------------------------------------
	// Step 7: POST /data/locations → 201
	//
	// KNOWN FAILING: BUG-ORGSCOPE-MEMBERSHIP-RLS
	// RequireOrgScope's poolQuerier.queryMemberships runs without
	// app.current_user_id set so RLS on organization_members returns 0 rows.
	// db.Scope.OrgID is set to "" causing current_org_id() = NULL, which
	// fails the locations_insert WITH CHECK.
	// See docs/onboarding-verification.md for full analysis.
	// -------------------------------------------------------------------
	resp = r.POST("/data/locations",
		map[string]any{
			"organization_id": orgID,
			"name":            "Main Branch",
			"region_id":       firstActiveRegionID(),
		},
		withBearer(token))
	// This check is expected to FAIL until BUG-ORGSCOPE-MEMBERSHIP-RLS is fixed.
	r.CheckStatus(resp.status, 201, "step7: create location 201 [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")

	var locRows []map[string]any
	_ = resp.JSON(&locRows)
	locID := ""
	if len(locRows) > 0 {
		locID, _ = locRows[0]["id"].(string)
		r.locationID = locID
	}

	// -------------------------------------------------------------------
	// Step 8: GET /data/locations → 200, location visible
	//
	// KNOWN FAILING: same root cause as step 7. GET returns [] because
	// current_org_id() = NULL means locations_select_member is always false.
	// -------------------------------------------------------------------
	resp = r.GET("/data/locations?eq=organization_id,"+orgID, withBearer(token))
	r.CheckStatus(resp.status, 200, "step8: GET locations 200 [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")

	var locs []map[string]any
	_ = resp.JSON(&locs)
	if locID != "" {
		found = false
		for _, l := range locs {
			if fmt.Sprint(l["id"]) == locID {
				found = true
			}
		}
		r.Check(found, "step8: created location visible in GET /data/locations [KNOWN-FAIL]")
	} else {
		// Location wasn't created (expected under the bug), skip the visibility check.
		r.Check(true, "step8: skipped visibility check (location not created in step7)")
	}
}

// firstActiveRegionID returns a hard-coded South Africa region UUID that is
// seeded by migration 014. If your test environment uses a different seed,
// change this value (or query the DB).
func firstActiveRegionID() string {
	return "5377a030-9e34-4f61-8d18-c202e76df3cc"
}
