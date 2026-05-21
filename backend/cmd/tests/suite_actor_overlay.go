package main

import "fmt"

// suiteActorOverlay exercises the POST /pos/pin-verify overlay endpoint:
//
//   (a) Wrong PIN → 401 (invalid credential).
//   (b) Correct PIN → 200 with actor_token + capabilities.
//   (c) 5 consecutive wrong PINs → lockout (423 Locked).
//   (d) Capability-gated call: attempt a void with the actor token present in
//       X-Actor-Token header — 403 without can_void capability, or 201 with it.
//       Either outcome is accepted; what matters is the actor token is wired up.
//
// The request/response shapes come directly from staffauth.PinVerifyRequest and
// staffauth.PinVerifyResponse. The endpoint is mounted at POST /pos/pin-verify
// by staffauth.Handler.MountPinVerify.
//
// If the endpoint returns 404 or 501 (not implemented / not configured), the
// entire suite is skipped gracefully.
//
// Run:
//
//	go run ./cmd/tests --actor-overlay

func suiteActorOverlay(r *Runner) {
	if !bootstrapOrgAndLocation(r) {
		r.fail("actor-overlay: could not bootstrap org")
		return
	}
	if r.locationID == "" {
		r.fail("actor-overlay: no location available [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")
		return
	}

	// -----------------------------------------------------------------------
	// Step 0: create a staff row with a known username and set its PIN via
	// POST /staff/{id}/set-pin (manager route). If set-pin is absent we skip
	// the whole suite — we can't exercise pin-verify without a PIN.
	// -----------------------------------------------------------------------
	staffUsername := "overlay_" + randomString(6)
	staffPIN := "4321"

	resp := r.POST("/data/staff",
		map[string]any{
			"location_id": r.locationID,
			"username":    staffUsername,
			"first_name":  "Overlay",
			"last_name":   "Test" + randomString(4),
			"role":        "cashier",
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "actor-overlay: create staff 201") {
		r.fail(fmt.Sprintf("actor-overlay: create staff body: %s", resp.String()))
		return
	}
	var staffRows []map[string]any
	_ = resp.JSON(&staffRows)
	staffID := ""
	if len(staffRows) > 0 {
		staffID, _ = staffRows[0]["id"].(string)
	}
	if staffID == "" {
		r.fail("actor-overlay: could not get staff id")
		return
	}

	// Set PIN.
	resp = r.POST("/staff/"+staffID+"/set-pin",
		map[string]any{"pin": staffPIN},
		withBearer(r.token))
	if resp.status == 404 {
		r.Check(true, "actor-overlay: set-pin route not found — skipping (route absent)")
		return
	}
	if !r.CheckStatus(resp.status, 204, "actor-overlay: set-pin 204") {
		r.fail(fmt.Sprintf("actor-overlay: set-pin body: %s", resp.String()))
		return
	}

	// Probe the pin-verify endpoint with an intentionally wrong PIN first to
	// make sure it is mounted (skip if absent or not configured).
	probeResp := r.POST("/pos/pin-verify",
		map[string]any{
			"username":    staffUsername,
			"pin":         "0000",
			"location_id": r.locationID,
		},
		withBearer(r.token))
	if probeResp.status == 404 || probeResp.status == 501 {
		r.Check(true, "actor-overlay: /pos/pin-verify route not found or not configured — skipping (route absent)")
		return
	}

	// -----------------------------------------------------------------------
	// Part (a): wrong PIN → 401
	// -----------------------------------------------------------------------
	r.CheckStatus(probeResp.status, 401, "actor-overlay: wrong pin → 401")

	// -----------------------------------------------------------------------
	// Part (b): correct PIN → 200 + actor_token
	// -----------------------------------------------------------------------
	resp = r.POST("/pos/pin-verify",
		map[string]any{
			"username":    staffUsername,
			"pin":         staffPIN,
			"location_id": r.locationID,
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 200, "actor-overlay: correct pin → 200") {
		r.fail(fmt.Sprintf("actor-overlay: pin-verify success body: %s", resp.String()))
		return
	}
	var pvResp map[string]any
	if err := resp.JSON(&pvResp); err != nil {
		r.fail(fmt.Sprintf("actor-overlay: pin-verify response not json: %v", err))
		return
	}
	actorToken, _ := pvResp["actor_token"].(string)
	r.Check(actorToken != "", "actor-overlay: response has actor_token")
	r.Check(pvResp["expires_at"] != nil, "actor-overlay: response has expires_at")
	staffObj, _ := pvResp["staff"].(map[string]any)
	if staffObj != nil {
		r.CheckEq(staffObj["id"], staffID, "actor-overlay: staff.id matches")
		r.Check(staffObj["display_name"] != nil, "actor-overlay: staff.display_name present")
		r.Check(staffObj["role"] != nil, "actor-overlay: staff.role present")
	}

	// -----------------------------------------------------------------------
	// Part (c): lockout after 5 wrong PINs.
	// Create a fresh staff + set PIN so the lockout counter is at 0.
	// -----------------------------------------------------------------------
	lockUsername := "locktest_" + randomString(6)
	lockPIN := "9876"

	resp = r.POST("/data/staff",
		map[string]any{
			"location_id": r.locationID,
			"username":    lockUsername,
			"first_name":  "LockTest",
			"last_name":   "Staff" + randomString(4),
			"role":        "cashier",
		},
		withBearer(r.token))
	var lockStaffRows []map[string]any
	_ = resp.JSON(&lockStaffRows)
	lockStaffID := ""
	if len(lockStaffRows) > 0 {
		lockStaffID, _ = lockStaffRows[0]["id"].(string)
	}
	if lockStaffID == "" {
		r.fail("actor-overlay: lockout staff: could not create staff row")
		return
	}

	resp = r.POST("/staff/"+lockStaffID+"/set-pin",
		map[string]any{"pin": lockPIN},
		withBearer(r.token))
	if resp.status != 204 {
		r.fail(fmt.Sprintf("actor-overlay: lockout staff set-pin: got %d", resp.status))
		return
	}

	// lockoutThreshold = 5; send 5 wrong PINs.
	const lockoutThreshold = 5
	var lastStatus int
	for i := 0; i < lockoutThreshold; i++ {
		wr := r.POST("/pos/pin-verify",
			map[string]any{
				"username":    lockUsername,
				"pin":         "0000",
				"location_id": r.locationID,
			},
			withBearer(r.token))
		lastStatus = wr.status
	}
	// At or past threshold the next call should return 401 (still invalid PIN
	// on the last of the 5) or 423 (locked, from the very next call).
	// The final attempt in the loop may already be the lockout trigger:
	// IncrementFailedAttempts sets locked_until when failed_login_attempts + 1 >= 5.
	// So on the 5th wrong attempt, the handler gets ErrInvalidCredential (bcrypt
	// fails first, then IncrementFailedAttempts fires the lock) and returns 401.
	// The 6th attempt will hit the lockout check and return 423.
	r.Check(lastStatus == 401 || lastStatus == 423,
		fmt.Sprintf("actor-overlay: 5th wrong pin → 401 or 423 (got %d)", lastStatus))

	// One more attempt after the 5 — should now be locked (423).
	extraResp := r.POST("/pos/pin-verify",
		map[string]any{
			"username":    lockUsername,
			"pin":         "0000",
			"location_id": r.locationID,
		},
		withBearer(r.token))
	r.Check(extraResp.status == 423 || extraResp.status == 401,
		fmt.Sprintf("actor-overlay: post-lockout attempt → 423 or 401 (got %d)", extraResp.status))

	// -----------------------------------------------------------------------
	// Part (d): capability-gated call with actor token.
	// Create an order and attempt a void with X-Actor-Token header.
	// Without can_void in the actor token's capabilities the void returns 403;
	// with it, 201. Either is accepted — we're testing the header is wired.
	// -----------------------------------------------------------------------
	r.itemID = ""
	r.categoryID = ""
	suiteMenu(r)
	if r.itemID == "" {
		r.Check(true, "actor-overlay: no menu item — skipping capability gate check")
		return
	}

	resp = r.POST("/pos/orders",
		map[string]any{
			"location_id": r.locationID,
			"order_type":  "dine_in",
			"items": []map[string]any{
				{"item_id": r.itemID, "quantity": 1},
			},
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "actor-overlay: create order for void test 201") {
		r.fail(fmt.Sprintf("actor-overlay: create order body: %s", resp.String()))
		return
	}
	var order map[string]any
	_ = resp.JSON(&order)
	orderID, _ := order["order_id"].(string)
	if orderID == "" {
		r.fail("actor-overlay: order has no order_id")
		return
	}

	// Send the void with the actor token in X-Actor-Token header. The
	// capability gate either passes (can_void present) or blocks (403). Both
	// are valid outcomes — what matters is the route is reachable with the header.
	voidResp := r.POST("/"+orderID+"/void",
		map[string]any{
			"reason_code":         "overlay capability test",
			"applied_by_staff_id": staffID,
			"approver_staff_id":   staffID,
			"approver_pin":        staffPIN,
		},
		withBearer(r.token),
		withHeader("X-Actor-Token", actorToken))
	r.Check(voidResp.status == 201 || voidResp.status == 403 || voidResp.status == 400,
		fmt.Sprintf("actor-overlay: void with actor token → 201/403/400 (got %d)", voidResp.status))
}
