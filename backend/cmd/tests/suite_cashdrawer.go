package main

import "fmt"

// suiteCashDrawer exercises the cash-drawer session lifecycle:
//   POST /data/cash_drawers      → create a drawer
//   POST /cash-drawers/{id}/sessions/open   → open session
//   POST /cash-drawers/sessions/{id}/movements  → record paid_in movement
//   GET  /cash-drawers/sessions/{id}        → fetch session detail
//   POST /cash-drawers/sessions/{id}/close  → close session
//   GET  /cash-drawers/{id}/sessions        → EOD list confirms closed session
//
// Run:
//
//	go run ./cmd/tests --cashdrawer

func suiteCashDrawer(r *Runner) {
	if !bootstrapOrgAndLocation(r) {
		r.fail("cashdrawer: could not bootstrap org")
		return
	}
	if r.locationID == "" {
		r.fail("cashdrawer: no location available [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")
		return
	}

	// -----------------------------------------------------------------------
	// Step 1: create a cash drawer for the location (via data layer)
	// -----------------------------------------------------------------------
	drawerName := "Test Drawer " + randomString(6)
	resp := r.POST("/data/cash_drawers",
		map[string]any{
			"location_id": r.locationID,
			"name":        drawerName,
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "cashdrawer: create drawer 201") {
		r.fail(fmt.Sprintf("cashdrawer: create drawer body: %s", resp.String()))
		return
	}
	var drawerRows []map[string]any
	if err := resp.JSON(&drawerRows); err != nil || len(drawerRows) == 0 {
		r.fail(fmt.Sprintf("cashdrawer: drawer body parse error: %v (%s)", err, resp.String()))
		return
	}
	drawerID, _ := drawerRows[0]["id"].(string)
	r.Check(drawerID != "", "cashdrawer: drawer has id")

	// -----------------------------------------------------------------------
	// Step 2: open a session
	// -----------------------------------------------------------------------
	resp = r.POST("/cash-drawers/"+drawerID+"/sessions/open",
		map[string]any{
			"opening_float_cents": 10000,
			"is_blind_close":      false,
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "cashdrawer: open session 201") {
		r.fail(fmt.Sprintf("cashdrawer: open session body: %s", resp.String()))
		return
	}
	var sess map[string]any
	if err := resp.JSON(&sess); err != nil {
		r.fail(fmt.Sprintf("cashdrawer: session body parse error: %v (%s)", err, resp.String()))
		return
	}
	sessionID, _ := sess["id"].(string)
	r.Check(sessionID != "", "cashdrawer: session has id")
	r.CheckEq(sess["status"], "open", "cashdrawer: session status=open after open")

	// Duplicate open → 409
	resp = r.POST("/cash-drawers/"+drawerID+"/sessions/open",
		map[string]any{"opening_float_cents": 5000},
		withBearer(r.token))
	r.CheckStatus(resp.status, 409, "cashdrawer: duplicate open → 409")

	// -----------------------------------------------------------------------
	// Step 3: record a paid_in movement
	// -----------------------------------------------------------------------
	resp = r.POST("/cash-drawers/sessions/"+sessionID+"/movements",
		map[string]any{
			"movement_type": "paid_in",
			"amount_cents":  2000,
			"reason":        "cash float top-up",
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "cashdrawer: paid_in movement 201") {
		r.fail(fmt.Sprintf("cashdrawer: movement body: %s", resp.String()))
		return
	}
	var movement map[string]any
	if err := resp.JSON(&movement); err != nil {
		r.fail(fmt.Sprintf("cashdrawer: movement body parse error: %v", err))
		return
	}
	r.CheckEq(movement["movement_type"], "paid_in", "cashdrawer: movement_type=paid_in")
	r.Check(movement["id"] != nil, "cashdrawer: movement has id")

	// -----------------------------------------------------------------------
	// Step 4: fetch session detail (movements_count should be >= 1)
	// -----------------------------------------------------------------------
	resp = r.GET("/cash-drawers/sessions/"+sessionID, withBearer(r.token))
	if !r.CheckStatus(resp.status, 200, "cashdrawer: get session 200") {
		r.fail(fmt.Sprintf("cashdrawer: get session body: %s", resp.String()))
		return
	}
	var detail map[string]any
	_ = resp.JSON(&detail)
	r.CheckEq(detail["status"], "open", "cashdrawer: session still open before close")

	// -----------------------------------------------------------------------
	// Step 5: close session (requires can_settle — owner has this capability)
	// -----------------------------------------------------------------------
	resp = r.POST("/cash-drawers/sessions/"+sessionID+"/close",
		map[string]any{
			"declared_closing_cents": 12000,
			"notes":                  "end-of-day close",
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 200, "cashdrawer: close session 200") {
		r.fail(fmt.Sprintf("cashdrawer: close session body: %s", resp.String()))
		return
	}
	var closedSess map[string]any
	_ = resp.JSON(&closedSess)
	r.CheckEq(closedSess["status"], "closed", "cashdrawer: session status=closed after close")

	// -----------------------------------------------------------------------
	// Step 6: EOD list — GET /cash-drawers/{drawer_id}/sessions?status=closed
	// -----------------------------------------------------------------------
	resp = r.GET("/cash-drawers/"+drawerID+"/sessions?status=closed", withBearer(r.token))
	if !r.CheckStatus(resp.status, 200, "cashdrawer: list closed sessions 200") {
		r.fail(fmt.Sprintf("cashdrawer: list sessions body: %s", resp.String()))
		return
	}
	var sessions []map[string]any
	_ = resp.JSON(&sessions)
	found := false
	for _, s := range sessions {
		if fmt.Sprint(s["id"]) == sessionID {
			found = true
		}
	}
	r.Check(found, "cashdrawer: closed session appears in EOD list")
}
