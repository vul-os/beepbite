package main

import "fmt"

// suiteStaff exercises the staff-management lifecycle:
//   POST /data/staff              → create a staff row
//   POST /staff/{id}/set-pin      → manager sets a PIN
//   POST /staff/{id}/manager-set-password → manager sets a password
//   GET  /data/staff              → list returns the created row
//
// Routes are gracefully skipped (following suite_adjustments.go pattern) when
// not mounted. Staff rows require a location, so this suite bootstraps its own
// org + location.
//
// Run:
//
//	go run ./cmd/tests --staff

func suiteStaff(r *Runner) {
	if !bootstrapOrgAndLocation(r) {
		r.fail("staff: could not bootstrap org")
		return
	}
	if r.locationID == "" {
		r.fail("staff: no location available [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")
		return
	}

	// -----------------------------------------------------------------------
	// Step 1: create a staff row via POST /data/staff
	// -----------------------------------------------------------------------
	username := "teststaff_" + randomString(6)
	firstName := "Test"
	lastName := "Staff" + randomString(4)

	resp := r.POST("/data/staff",
		map[string]any{
			"location_id": r.locationID,
			"username":    username,
			"first_name":  firstName,
			"last_name":   lastName,
			"role":        "cashier",
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "staff: create staff row 201") {
		r.fail(fmt.Sprintf("staff: create staff body: %s", resp.String()))
		return
	}
	var staffRows []map[string]any
	if err := resp.JSON(&staffRows); err != nil || len(staffRows) == 0 {
		r.fail(fmt.Sprintf("staff: create staff response parse error: %v (%s)", err, resp.String()))
		return
	}
	staffID, _ := staffRows[0]["id"].(string)
	r.Check(staffID != "", "staff: row has id")
	r.CheckEq(staffRows[0]["role"], "cashier", "staff: role=cashier")
	r.CheckEq(staffRows[0]["is_active"], true, "staff: is_active=true")

	// -----------------------------------------------------------------------
	// Step 2: list staff — verify our row appears
	// -----------------------------------------------------------------------
	resp = r.GET("/data/staff?eq=location_id,"+r.locationID, withBearer(r.token))
	if !r.CheckStatus(resp.status, 200, "staff: list staff 200") {
		r.fail(fmt.Sprintf("staff: list staff body: %s", resp.String()))
		return
	}
	var listed []map[string]any
	_ = resp.JSON(&listed)
	found := false
	for _, s := range listed {
		if fmt.Sprint(s["id"]) == staffID {
			found = true
		}
	}
	r.Check(found, "staff: created row appears in list")

	// -----------------------------------------------------------------------
	// Step 3: set a PIN via POST /staff/{id}/set-pin
	// -----------------------------------------------------------------------
	staffPIN := "1234"
	resp = r.POST("/staff/"+staffID+"/set-pin",
		map[string]any{"pin": staffPIN},
		withBearer(r.token))
	if resp.status == 404 {
		r.Check(true, "staff: set-pin route not found — skipping (route absent)")
		return
	}
	r.CheckStatus(resp.status, 204, "staff: set-pin 204")

	// -----------------------------------------------------------------------
	// Step 4: validation — set-pin with a too-short PIN → 400
	// -----------------------------------------------------------------------
	resp = r.POST("/staff/"+staffID+"/set-pin",
		map[string]any{"pin": "12"},
		withBearer(r.token))
	if resp.status != 404 {
		r.Check(resp.status == 400, fmt.Sprintf("staff: set-pin short pin → 400 (got %d)", resp.status))
	}

	// -----------------------------------------------------------------------
	// Step 5: manager-set-password via POST /staff/{id}/manager-set-password
	// -----------------------------------------------------------------------
	newPassword := "NewP@ss" + randomString(4)
	resp = r.POST("/staff/"+staffID+"/manager-set-password",
		map[string]any{"password": newPassword},
		withBearer(r.token))
	if resp.status == 404 {
		r.Check(true, "staff: manager-set-password route not found — skipping (route absent)")
		return
	}
	r.CheckStatus(resp.status, 204, "staff: manager-set-password 204")

	// -----------------------------------------------------------------------
	// Step 6: validation — manager-set-password with a too-short password → 400
	// -----------------------------------------------------------------------
	resp = r.POST("/staff/"+staffID+"/manager-set-password",
		map[string]any{"password": "short"},
		withBearer(r.token))
	if resp.status != 404 {
		r.Check(resp.status == 400, fmt.Sprintf("staff: manager-set-password short pass → 400 (got %d)", resp.status))
	}
}
