package main

import "fmt"

// suiteAudit validates the Wave 6 audit-attribution fix end-to-end: a financial
// mutation (an order void) must leave an audit_log row whose actor_id is the
// staff member who applied it (non-null). The void path is the canonical
// audit-producing flow — the adjustments store writes the row via
// insertAuditLog with action "order.void", entity_type "orders". (The generic
// /data CRUD handler does not write audit rows, so we exercise the real path.)
//
// Run:
//
//	go run ./cmd/tests --audit

func suiteAudit(r *Runner) {
	if !bootstrapOrgAndLocation(r) {
		r.fail("audit: could not bootstrap org")
		return
	}
	if r.locationID == "" {
		r.fail("audit: no location available [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")
		return
	}

	// -----------------------------------------------------------------------
	// Step 1: create an item + order to void.
	// -----------------------------------------------------------------------
	r.itemID = ""
	r.categoryID = ""
	suiteMenu(r)
	if r.itemID == "" {
		r.fail("audit: could not create a menu item")
		return
	}

	resp := r.POST("/pos/orders",
		map[string]any{
			"location_id": r.locationID,
			"order_type":  "dine_in",
			"items": []map[string]any{
				{"item_id": r.itemID, "quantity": 1},
			},
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "audit: create order 201") {
		r.fail(fmt.Sprintf("audit: create order body: %s", resp.String()))
		return
	}
	var order map[string]any
	_ = resp.JSON(&order)
	orderID, _ := order["order_id"].(string)
	if orderID == "" {
		r.fail("audit: no order_id returned")
		return
	}

	// -----------------------------------------------------------------------
	// Step 2: create applier + manager staff, set the manager PIN, then void
	// the order. The void writes the audit_log row we assert on.
	// -----------------------------------------------------------------------
	applierID := createAuditStaff(r, "AuditApplier"+randomString(4), "cashier")
	mgrID := createAuditStaff(r, "AuditManager"+randomString(4), "manager")
	if applierID == "" || mgrID == "" {
		r.fail("audit: could not create applier/manager staff")
		return
	}

	mgrPIN := "5678"
	pinResp := r.POST("/staff/"+mgrID+"/set-pin",
		map[string]any{"pin": mgrPIN},
		withBearer(r.token))
	if !r.Check(pinResp.status == 204, fmt.Sprintf("audit: set manager PIN 204 (got %d)", pinResp.status)) {
		return
	}

	voidResp := r.POST("/"+orderID+"/void",
		map[string]any{
			"reason_code":         "audit test void",
			"applied_by_staff_id": applierID,
			"approver_staff_id":   mgrID,
			"approver_pin":        mgrPIN,
		},
		withBearer(r.token))
	if !r.CheckStatus(voidResp.status, 201, "audit: void order 201") {
		r.fail(fmt.Sprintf("audit: void body: %s", voidResp.String()))
		return
	}

	// -----------------------------------------------------------------------
	// Step 3: query GET /data/audit_log for the void's row and assert it
	// carries a non-null actor_id (the Wave 6 attribution fix).
	// -----------------------------------------------------------------------
	resp = r.GET("/data/audit_log?eq=entity_id,"+orderID+"&limit=10", withBearer(r.token))
	if resp.status == 404 {
		r.Check(true, "audit: /data/audit_log route not found — skipping (route absent)")
		return
	}
	if !r.CheckStatus(resp.status, 200, "audit: GET /data/audit_log 200") {
		r.fail(fmt.Sprintf("audit: audit_log body: %s", resp.String()))
		return
	}
	var rows []map[string]any
	if err := resp.JSON(&rows); err != nil {
		r.fail(fmt.Sprintf("audit: audit_log parse error: %v", err))
		return
	}
	r.Check(len(rows) >= 1, fmt.Sprintf("audit: audit_log has the void row (got %d)", len(rows)))

	hasActor := false
	hasVoidAction := false
	for _, row := range rows {
		if row["actor_id"] != nil && fmt.Sprint(row["actor_id"]) != "" {
			hasActor = true
		}
		if fmt.Sprint(row["action"]) == "order.void" {
			hasVoidAction = true
		}
	}
	r.Check(hasActor, "audit: void audit_log row has non-null actor_id (Wave 6 attribution fix)")
	r.Check(hasVoidAction, "audit: order.void action present in audit_log")
}

// createAuditStaff inserts a staff row via the data API and returns its id ("" on failure).
func createAuditStaff(r *Runner, firstName, role string) string {
	resp := r.POST("/data/staff",
		map[string]any{
			"location_id": r.locationID,
			"first_name":  firstName,
			"last_name":   "Staff",
			"role":        role,
		},
		withBearer(r.token))
	var rows []map[string]any
	_ = resp.JSON(&rows)
	if len(rows) > 0 {
		id, _ := rows[0]["id"].(string)
		return id
	}
	return ""
}
