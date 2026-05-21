package main

import (
	"fmt"
	"time"
)

// Exercises the order creation path the frontend uses: customer → order
// (financials + delivery address folded onto the orders row by the Wave 0
// consolidation) → order_items. Then updates status.

func suiteOrders(r *Runner) {
	if !r.ensureSession() {
		return
	}
	if r.itemID == "" {
		// need an item for the order_items row; piggy-back on menu suite
		suiteMenu(r)
		if r.itemID == "" {
			r.fail("orders: could not create a menu item to order")
			return
		}
	}

	// 1. upsert customer (unique whatsapp_number)
	phone := "+27" + randomString(9)
	resp := r.POST("/data/customers",
		map[string]any{"whatsapp_number": phone, "first_name": "Test", "last_name": "Buyer"},
		withBearer(r.token))
	r.CheckStatus(resp.status, 201, "create customer 201")
	var rows []map[string]any
	_ = resp.JSON(&rows)
	if len(rows) == 0 {
		r.fail("customer create returned empty")
		return
	}
	customerID := fmt.Sprint(rows[0]["id"])

	// 2. create order — financials + delivery address now live on the orders
	// row (order_details / order_financial_details were folded in by Wave 0).
	orderNum := fmt.Sprintf("T%d", time.Now().Unix()%1000000)
	resp = r.POST("/data/orders",
		map[string]any{
			"location_id":      r.locationID,
			"customer_id":      customerID,
			"order_number":     orderNum,
			"order_type":       "delivery",
			"fulfillment_type": "delivery",
			"status":           "pending",
			"subtotal_cents":   2500,
			"tax_cents":        0,
			"total_cents":      3000,
			"delivery_address": "1 Test Rd",
		}, withBearer(r.token))
	r.CheckStatus(resp.status, 201, "create order 201")
	_ = resp.JSON(&rows)
	if len(rows) == 0 {
		r.fail("order create returned empty")
		return
	}
	orderID := fmt.Sprint(rows[0]["id"])

	// 3. order_items (bigint cents columns)
	resp = r.POST("/data/order_items",
		map[string]any{
			"order_id":          orderID,
			"item_id":           r.itemID,
			"quantity":          2,
			"unit_price_cents":  1250,
			"total_price_cents": 2500,
		}, withBearer(r.token))
	r.CheckStatus(resp.status, 201, "create order_item 201")

	// 6. status update → confirmed
	resp = r.PATCH("/data/orders?eq=id,"+orderID,
		map[string]any{"status": "confirmed"},
		withBearer(r.token))
	r.CheckStatus(resp.status, 200, "update order status 200")
	_ = resp.JSON(&rows)
	if len(rows) > 0 {
		r.CheckEq(rows[0]["status"], "confirmed", "status reflected after update")
	}

	// 7. fetch full order (embedded join on client; here just scalar + filter)
	resp = r.GET("/data/orders?eq=id,"+orderID+"&single=true", withBearer(r.token))
	r.CheckStatus(resp.status, 200, "fetch order 200")
}
