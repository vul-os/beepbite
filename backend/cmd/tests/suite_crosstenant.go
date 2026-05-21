package main

import "fmt"

// suiteCrossTenant is the Wave 15 / Now-25 Layer 3 adversarial cross-tenant
// suite. It provisions TWO fully independent organizations (A and B), each with
// its own owner, location, kitchen station, cash drawer, staff, and order. Then,
// holding ONLY org-A's bearer token, it probes every org-B resource it can reach
// and asserts each probe is rejected — never a 200 that leaks org-B data.
//
// The bar (per probe): the response is 403, 404, a hard 4xx, OR a 200 whose body
// provably does NOT contain the org-B row (e.g. an empty array under RLS). What
// is NOT allowed is a 200 that returns the org-B object/row. Helper assertProbe
// encodes exactly that contract.
//
// Run:
//
//	go run ./cmd/tests --crosstenant
func suiteCrossTenant(r *Runner) {
	// ---------------------------------------------------------------------
	// Provision org A and org B as separate tenants. Each call returns a
	// fully populated tenant fixture (token, org, location, station, drawer,
	// staff, order). If either tenant can't be bootstrapped we bail.
	// ---------------------------------------------------------------------
	a := provisionTenant(r, "A")
	if a == nil || a.token == "" || a.orgID == "" {
		r.fail("crosstenant: could not provision org A")
		return
	}
	b := provisionTenant(r, "B")
	if b == nil || b.token == "" || b.orgID == "" {
		r.fail("crosstenant: could not provision org B")
		return
	}
	if a.locationID == "" || b.locationID == "" {
		r.fail("crosstenant: a location for both tenants is required [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")
		return
	}

	r.Check(a.orgID != b.orgID, "crosstenant: org A and org B are distinct tenants")

	// From here on, every request uses org-A's token (atk) against org-B's
	// resource identifiers. None may return org-B data.
	atk := a.token

	// ---------------------------------------------------------------------
	// 1. GET org-B location via the data layer (RLS-scoped read).
	// ---------------------------------------------------------------------
	assertProbe(r, "crosstenant: GET org-B location does not leak",
		r.GET("/data/locations?eq=id,"+b.locationID, withBearer(atk)), b.locationID)

	// 1b. single=true variant — must be 404, not the org-B object.
	resp := r.GET("/data/locations?eq=id,"+b.locationID+"&single=true", withBearer(atk))
	r.Check(resp.status != 200 || !containsID(resp, b.locationID),
		fmt.Sprintf("crosstenant: GET org-B location single=true is not a 200 leak (got %d)", resp.status))

	// ---------------------------------------------------------------------
	// 2. GET org-B kitchen station.
	// ---------------------------------------------------------------------
	if b.stationID != "" {
		assertProbe(r, "crosstenant: GET org-B station does not leak",
			r.GET("/data/kitchen_stations?eq=id,"+b.stationID, withBearer(atk)), b.stationID)
		// Also probe the KDS station tickets route directly.
		tk := r.GET("/kds/stations/"+b.stationID+"/tickets", withBearer(atk))
		r.Check(tk.status != 200 || !containsID(tk, b.orderID),
			fmt.Sprintf("crosstenant: GET org-B station KDS tickets is not a leak (got %d)", tk.status))
	}

	// ---------------------------------------------------------------------
	// 3. GET org-B order.
	// ---------------------------------------------------------------------
	if b.orderID != "" {
		assertProbe(r, "crosstenant: GET org-B order does not leak",
			r.GET("/data/orders?eq=id,"+b.orderID, withBearer(atk)), b.orderID)
	}

	// ---------------------------------------------------------------------
	// 4. GET org-B staff.
	// ---------------------------------------------------------------------
	if b.staffID != "" {
		assertProbe(r, "crosstenant: GET org-B staff does not leak",
			r.GET("/data/staff?eq=id,"+b.staffID, withBearer(atk)), b.staffID)
	}

	// ---------------------------------------------------------------------
	// 5. GET org-B cash drawer.
	// ---------------------------------------------------------------------
	if b.drawerID != "" {
		assertProbe(r, "crosstenant: GET org-B cash drawer does not leak",
			r.GET("/data/cash_drawers?eq=id,"+b.drawerID, withBearer(atk)), b.drawerID)
	}

	// ---------------------------------------------------------------------
	// 6. GET org-B payout-adjacent rows. Payouts ride on order_payments /
	//    cash_drawer_sessions; probe both for an org-B leak.
	// ---------------------------------------------------------------------
	if b.sessionID != "" {
		assertProbe(r, "crosstenant: GET org-B cash drawer session does not leak",
			r.GET("/data/cash_drawer_sessions?eq=id,"+b.sessionID, withBearer(atk)), b.sessionID)
		// Cash drawer session detail route (org-scoped service handler).
		sd := r.GET("/cash-drawers/sessions/"+b.sessionID, withBearer(atk))
		r.Check(sd.status != 200 || !containsID(sd, b.sessionID),
			fmt.Sprintf("crosstenant: GET org-B cash session detail is not a 200 leak (got %d)", sd.status))
	}

	// ---------------------------------------------------------------------
	// 7. GET org-B audit_log rows (filtered to org-B's order entity).
	// ---------------------------------------------------------------------
	if b.orderID != "" {
		al := r.GET("/data/audit_log?eq=entity_id,"+b.orderID+"&limit=10", withBearer(atk))
		// 404 means route absent (allowed); otherwise must not contain org-B order.
		r.Check(al.status == 404 || al.status != 200 || !containsID(al, b.orderID),
			fmt.Sprintf("crosstenant: GET org-B audit_log is not a 200 leak (got %d)", al.status))
	}

	// ---------------------------------------------------------------------
	// 8. POST an order against org-B's location_id using org-A's token.
	//    Server must refuse to create an order in a foreign location.
	// ---------------------------------------------------------------------
	if a.itemID != "" {
		ord := r.POST("/pos/orders",
			map[string]any{
				"location_id": b.locationID, // foreign location
				"order_type":  "dine_in",
				"items": []map[string]any{
					{"item_id": a.itemID, "quantity": 1},
				},
			},
			withBearer(atk))
		r.Check(ord.status >= 400,
			fmt.Sprintf("crosstenant: POST order against org-B location rejected (got %d, want 4xx)", ord.status))
	}
	// Same probe via the data layer (raw insert into org-B location).
	rawOrd := r.POST("/data/orders",
		map[string]any{
			"location_id":     b.locationID,
			"organization_id": b.orgID,
			"order_type":      "dine_in",
			"status":          "open",
		},
		withBearer(atk))
	r.Check(rawOrd.status >= 400,
		fmt.Sprintf("crosstenant: POST /data/orders into org-B rejected (got %d, want 4xx)", rawOrd.status))

	// ---------------------------------------------------------------------
	// 9. Bump an org-B KDS ticket (if one exists) with org-A's token.
	// ---------------------------------------------------------------------
	if b.ticketID != "" {
		bump := r.POST("/kds/tickets/"+b.ticketID+"/bump", map[string]any{}, withBearer(atk))
		r.Check(bump.status >= 400,
			fmt.Sprintf("crosstenant: bump org-B KDS ticket rejected (got %d, want 4xx)", bump.status))
	} else {
		r.Check(true, "crosstenant: org-B had no KDS ticket to bump (skipped — no station routing match)")
	}

	// ---------------------------------------------------------------------
	// 10. Close org-B's open cash drawer session with org-A's token.
	// ---------------------------------------------------------------------
	if b.sessionID != "" {
		close := r.POST("/cash-drawers/sessions/"+b.sessionID+"/close",
			map[string]any{"declared_closing_cents": 10000, "notes": "cross-tenant close attempt"},
			withBearer(atk))
		r.Check(close.status >= 400,
			fmt.Sprintf("crosstenant: close org-B cash session rejected (got %d, want 4xx)", close.status))
	}

	// ---------------------------------------------------------------------
	// 11. Read org-B reviews via the data layer.
	// ---------------------------------------------------------------------
	rev := r.GET("/data/reviews?eq=location_id,"+b.locationID, withBearer(atk))
	r.Check(rev.status == 404 || rev.status != 200 || !containsID(rev, b.locationID),
		fmt.Sprintf("crosstenant: GET org-B reviews is not a 200 leak (got %d)", rev.status))

	// ---------------------------------------------------------------------
	// 12. Read org-B invoices (supplier_invoices via data layer; /billing/invoices
	//     is org-scoped to the caller so it cannot target org-B by id, but the
	//     data-layer read can be filtered to org-B and must not leak).
	// ---------------------------------------------------------------------
	inv := r.GET("/data/supplier_invoices?eq=location_id,"+b.locationID, withBearer(atk))
	r.Check(inv.status == 404 || inv.status != 200 || !containsID(inv, b.locationID),
		fmt.Sprintf("crosstenant: GET org-B supplier_invoices is not a 200 leak (got %d)", inv.status))

	// Sanity: org-A CAN still see its OWN location (the probes above aren't just
	// blanket-denying everything).
	own := r.GET("/data/locations?eq=id,"+a.locationID, withBearer(atk))
	r.Check(own.status == 200 && containsID(own, a.locationID),
		fmt.Sprintf("crosstenant: org-A can still read its OWN location (got %d)", own.status))
}

// tenant captures everything provisionTenant builds for one organization.
type tenant struct {
	token      string
	orgID      string
	locationID string
	itemID     string
	stationID  string
	drawerID   string
	sessionID  string
	staffID    string
	orderID    string
	ticketID   string
}

// provisionTenant builds an isolated org with an owner, location, menu item,
// kitchen station (+routing), cash drawer (+open session), staff row, and a POS
// order (which fans out to a KDS ticket). It uses a scratch Runner so it does
// not clobber the caller's shared state, but reuses the established bootstrap
// and menu helpers. Returns nil only if the org/user bootstrap itself fails.
func provisionTenant(r *Runner, label string) *tenant {
	// Use a scratch runner that shares the HTTP client + base URL + reporting
	// counters, so PASS/FAIL lines from helpers still surface, but org/location
	// state lands on the scratch (not the shared caller state).
	scratch := &Runner{
		base:     r.base,
		verbose:  r.verbose,
		http:     r.http,
		cfg:      r.cfg,
		curSuite: r.curSuite,
	}

	if !bootstrapOrgAndLocation(scratch) {
		r.fail("crosstenant: bootstrap org " + label + " failed")
		return nil
	}
	// Fold the helper's case counts back into the real runner so the report is
	// accurate.
	mergeCounts(r, scratch)

	t := &tenant{
		token:      scratch.token,
		orgID:      scratch.orgID,
		locationID: scratch.locationID,
	}
	if t.locationID == "" {
		return t // caller will detect the empty location and skip.
	}

	// Menu item (needed for orders + station routing).
	scratch.itemID = ""
	scratch.categoryID = ""
	before := scratch.cases
	suiteMenu(scratch)
	mergeCountsDelta(r, scratch, before)
	t.itemID = scratch.itemID

	tk := scratch.token

	// Kitchen station.
	st := scratch.POST("/data/kitchen_stations",
		map[string]any{
			"location_id":  t.locationID,
			"name":         "XT Station " + label + " " + randomString(4),
			"station_type": "prep",
			"sort_order":   99,
		},
		withBearer(tk))
	if st.status == 201 {
		var rows []map[string]any
		_ = st.JSON(&rows)
		if len(rows) > 0 {
			t.stationID, _ = rows[0]["id"].(string)
		}
	}
	if t.stationID != "" && t.itemID != "" {
		_ = scratch.POST("/data/item_station_routing",
			map[string]any{"item_id": t.itemID, "station_id": t.stationID},
			withBearer(tk))
	}

	// Staff row.
	staff := scratch.POST("/data/staff",
		map[string]any{
			"location_id": t.locationID,
			"username":    "xt_" + label + "_" + randomString(6),
			"first_name":  "XT" + label,
			"last_name":   "Staff" + randomString(4),
			"role":        "cashier",
		},
		withBearer(tk))
	if staff.status == 201 {
		var rows []map[string]any
		_ = staff.JSON(&rows)
		if len(rows) > 0 {
			t.staffID, _ = rows[0]["id"].(string)
		}
	}

	// Cash drawer + open session.
	dr := scratch.POST("/data/cash_drawers",
		map[string]any{"location_id": t.locationID, "name": "XT Drawer " + label + " " + randomString(4)},
		withBearer(tk))
	if dr.status == 201 {
		var rows []map[string]any
		_ = dr.JSON(&rows)
		if len(rows) > 0 {
			t.drawerID, _ = rows[0]["id"].(string)
		}
	}
	if t.drawerID != "" {
		open := scratch.POST("/cash-drawers/"+t.drawerID+"/sessions/open",
			map[string]any{"opening_float_cents": 10000, "is_blind_close": false},
			withBearer(tk))
		if open.status == 201 {
			var s map[string]any
			_ = open.JSON(&s)
			t.sessionID, _ = s["id"].(string)
		}
	}

	// POS order (fans out a KDS ticket when routing matched).
	if t.itemID != "" {
		ord := scratch.POST("/pos/orders",
			map[string]any{
				"location_id": t.locationID,
				"order_type":  "dine_in",
				"items":       []map[string]any{{"item_id": t.itemID, "quantity": 1}},
			},
			withBearer(tk))
		if ord.status == 201 {
			var o map[string]any
			_ = ord.JSON(&o)
			t.orderID, _ = o["order_id"].(string)
			if ids, ok := o["kds_ticket_ids"].([]any); ok && len(ids) > 0 {
				t.ticketID, _ = ids[0].(string)
			}
		}
	}

	return t
}

// assertProbe asserts that a cross-tenant read response does NOT leak the given
// foreign id. A leak is a 200 whose body contains foreignID. Anything else
// (403, 404, other 4xx, or a 200 with the id absent — e.g. an empty RLS-scoped
// array) is a PASS.
func assertProbe(r *Runner, label string, resp *response, foreignID string) {
	leaked := resp.status == 200 && containsID(resp, foreignID)
	r.Check(!leaked, fmt.Sprintf("%s (status %d, leaked=%v)", label, resp.status, leaked))
}

// containsID reports whether the response body contains the given id substring.
// Cheap and sufficient: the ids are random UUIDs, so a substring match is a
// reliable signal that the foreign row was returned.
func containsID(resp *response, id string) bool {
	if id == "" || len(resp.body) == 0 {
		return false
	}
	return indexBytesString(resp.body, id) >= 0
}

func indexBytesString(b []byte, s string) int {
	// Avoid importing strings/bytes churn at call sites; tiny manual search.
	n, m := len(b), len(s)
	if m == 0 {
		return 0
	}
	for i := 0; i+m <= n; i++ {
		if string(b[i:i+m]) == s {
			return i
		}
	}
	return -1
}

// mergeCounts folds a scratch runner's full case counters into the real runner.
func mergeCounts(real, scratch *Runner) {
	real.cases += scratch.cases
	real.passed += scratch.passed
	real.failed += scratch.failed
	real.errs = append(real.errs, scratch.errs...)
	scratch.cases, scratch.passed, scratch.failed = 0, 0, 0
	scratch.errs = nil
}

// mergeCountsDelta folds only the cases the scratch runner accumulated since
// `before` (used when a helper like suiteMenu runs on the scratch runner).
func mergeCountsDelta(real, scratch *Runner, before int) {
	_ = before
	mergeCounts(real, scratch)
}
