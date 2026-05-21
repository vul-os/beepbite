package main

import "fmt"

// suitePOS exercises the POS order creation + charge flow:
//   POST /pos/orders   → creates an order with items
//   POST /pos/orders/{id}/charge (single tender)
//   POST /pos/orders/{id}/charge (split tender)
//   Asserts order_payments rows via the charge response.
//
// Run:
//
//	go run ./cmd/tests --pos

func suitePOS(r *Runner) {
	// Each suite run gets its own isolated org/user/location to avoid
	// cross-suite state pollution and the bootstrap trigger gap.
	if !bootstrapOrgAndLocation(r) {
		r.fail("pos: could not bootstrap org")
		return
	}
	if r.locationID == "" {
		// BUG-ORGSCOPE-MEMBERSHIP-RLS: location creation blocked by RLS.
		// Record as known-fail and skip the rest of the suite.
		r.fail("pos: no location available [KNOWN-FAIL: BUG-ORGSCOPE-MEMBERSHIP-RLS]")
		return
	}
	// Create a menu item so we have something to order.
	r.itemID = "" // reset so suiteMenu creates fresh
	r.categoryID = ""
	suiteMenu(r)
	if r.itemID == "" {
		r.fail("pos: could not create a menu item")
		return
	}

	// -----------------------------------------------------------------------
	// Step 1: create order via POST /pos/orders (single item, dine_in)
	// -----------------------------------------------------------------------
	resp := r.POST("/pos/orders",
		map[string]any{
			"location_id": r.locationID,
			"order_type":  "dine_in",
			"items": []map[string]any{
				{"item_id": r.itemID, "quantity": 2},
			},
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "pos: create order 201") {
		r.fail(fmt.Sprintf("pos: create order body: %s", resp.String()))
		return
	}

	var order map[string]any
	if err := resp.JSON(&order); err != nil {
		r.fail(fmt.Sprintf("pos: create order not json: %v (%s)", err, resp.String()))
		return
	}
	orderID, _ := order["order_id"].(string)
	r.Check(orderID != "", "pos: order has order_id")
	r.Check(order["order_number"] != nil, "pos: order has order_number")
	r.Check(order["total"] != nil, "pos: order has total")

	// -----------------------------------------------------------------------
	// Step 2: single-tender charge via POST /pos/orders/{id}/charge
	// -----------------------------------------------------------------------
	resp = r.POST("/pos/orders/"+orderID+"/charge",
		map[string]any{
			"payment_method_code": "cash",
			"amount_paid_cents":   3000,
			"change_given_cents":  500,
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 200, "pos: single charge 200") {
		r.fail(fmt.Sprintf("pos: single charge body: %s", resp.String()))
		return
	}
	var chargeResp map[string]any
	if err := resp.JSON(&chargeResp); err != nil {
		r.fail(fmt.Sprintf("pos: charge not json: %v (%s)", err, resp.String()))
		return
	}
	r.CheckEq(chargeResp["order_id"], orderID, "pos: charge.order_id matches")
	r.CheckEq(chargeResp["payment_status"], "paid", "pos: charge payment_status=paid")

	paymentIDs, _ := chargeResp["payment_ids"].([]any)
	r.Check(len(paymentIDs) == 1, "pos: single charge → one order_payment row")

	// -----------------------------------------------------------------------
	// Step 3: split-tender charge on a fresh order
	// -----------------------------------------------------------------------
	resp = r.POST("/pos/orders",
		map[string]any{
			"location_id": r.locationID,
			"order_type":  "dine_in",
			"items": []map[string]any{
				{"item_id": r.itemID, "quantity": 1},
			},
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 201, "pos: create order2 201") {
		return
	}
	var order2 map[string]any
	_ = resp.JSON(&order2)
	orderID2, _ := order2["order_id"].(string)

	resp = r.POST("/pos/orders/"+orderID2+"/charge",
		map[string]any{
			"payments": []map[string]any{
				{"payment_method_code": "cash", "amount_paid_cents": 1000},
				{"payment_method_code": "cash", "amount_paid_cents": 500},
			},
		},
		withBearer(r.token))
	if !r.CheckStatus(resp.status, 200, "pos: split charge 200") {
		r.fail(fmt.Sprintf("pos: split charge body: %s", resp.String()))
		return
	}
	var splitResp map[string]any
	_ = resp.JSON(&splitResp)
	splitIDs, _ := splitResp["payment_ids"].([]any)
	r.Check(len(splitIDs) == 2, "pos: split charge → two order_payment rows")
	r.CheckEq(splitResp["payment_status"], "paid", "pos: split charge payment_status=paid")

	// -----------------------------------------------------------------------
	// Step 4: duplicate charge on already-paid order → 409
	// -----------------------------------------------------------------------
	resp = r.POST("/pos/orders/"+orderID+"/charge",
		map[string]any{
			"payment_method_code": "cash",
			"amount_paid_cents":   1000,
		},
		withBearer(r.token))
	r.CheckStatus(resp.status, 409, "pos: double charge → 409 conflict")
}
